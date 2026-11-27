import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FolderGit2, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Dialog, DialogHeader, DialogPopup } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { NativeSelect } from './ui/select';
import { Favicon } from './Favicon';
import {
  auditFolderStructure,
  batchSuggestRenames,
  isAiReady,
  requestDeepSeekPermission,
  type AuditFolderSummary,
  type BatchRenameInput,
  type BatchRenameSuggestion,
  type FolderAuditSuggestion,
} from '@/lib/ai';
import { isInsideFolder } from '@/lib/bookmarks';
import { exportRoot } from '@/lib/transfer';
import type { AiConfig, BookmarkItem, FolderNode } from '@/lib/types';
import { cn } from '@/lib/cn';

interface EditableRow extends BatchRenameSuggestion {
  selected: boolean;
  draftTitle: string;
  draftFolderId: string;
}

interface SelectableAuditRow extends FolderAuditSuggestion {
  selected: boolean;
}

interface ScopeOption {
  id: string;
  label: string;
  items: BatchRenameInput[];
}

interface FlatFolderOption {
  id: string;
  pathLabel: string;
}

function collectFlatFolders(tops: FolderNode[]): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];
  const walk = (folder: FolderNode, prefix: string) => {
    const pathLabel = prefix ? `${prefix} / ${folder.title}` : folder.title;
    out.push({ id: folder.id, pathLabel });
    for (const c of folder.children) walk(c, pathLabel);
  };
  for (const t of tops) walk(t, '');
  return out;
}

function collectAuditFolders(tops: FolderNode[]): AuditFolderSummary[] {
  const out: AuditFolderSummary[] = [];
  const walk = (folder: FolderNode, prefix: string) => {
    const path = prefix ? `${prefix} / ${folder.title}` : folder.title;
    out.push({
      id: folder.id,
      parentId: folder.parentId,
      depth: folder.depth,
      title: folder.title,
      path,
      directCount: folder.items.length,
      totalCount: folder.totalCount,
      samples: folder.items.slice(0, 12).map((it) => ({
        id: it.id,
        title: it.title,
        host: it.host,
      })),
    });
    for (const c of folder.children) walk(c, path);
  };
  for (const t of tops) walk(t, '');
  return out;
}

function collectScopeItems(
  tops: FolderNode[],
  loose: BookmarkItem[],
  rootId: string,
  currentFolderId: string,
  favorites: string[],
): ScopeOption[] {
  const options: ScopeOption[] = [];

  const walk = (folder: FolderNode, prefix: string, out: BatchRenameInput[]) => {
    const path = prefix ? `${prefix} / ${folder.title}` : folder.title;
    for (const it of folder.items) {
      out.push({ id: it.id, title: it.title, url: it.url, folderId: folder.id, folderPath: path });
    }
    for (const c of folder.children) walk(c, path, out);
  };

  const allItems: BatchRenameInput[] = [];
  for (const it of loose) {
    allItems.push({ id: it.id, title: it.title, url: it.url, folderId: rootId, folderPath: '根目录' });
  }
  for (const t of tops) walk(t, '', allItems);

  const favSet = new Set(favorites);
  const favItems = allItems.filter((it) => favSet.has(it.id) || loose.some((l) => l.id === it.id));
  if (favItems.length) {
    options.push({ id: '__favorites__', label: `我的收藏（${favItems.length} 条）`, items: favItems });
  }

  for (const t of tops) {
    const tItems: BatchRenameInput[] = [];
    walk(t, '', tItems);
    if (tItems.length) {
      options.push({ id: t.id, label: `${t.title}（${tItems.length} 条）`, items: tItems });
    }
    for (const sub of t.children) {
      const sItems: BatchRenameInput[] = [];
      walk(sub, t.title, sItems);
      if (sItems.length) {
        options.push({ id: sub.id, label: `　${t.title} / ${sub.title}（${sItems.length} 条）`, items: sItems });
      }
    }
  }

  options.push({ id: '__all__', label: `全部书签（${allItems.length} 条）`, items: allItems });

  const curIdx = options.findIndex((o) => o.id === currentFolderId);
  if (curIdx > 0) {
    const [cur] = options.splice(curIdx, 1);
    options.unshift({ ...cur, label: `当前分组 · ${cur.label}` });
  }
  return options;
}

const AUDIT_BADGE: Record<
  FolderAuditSuggestion['type'],
  { label: string; variant: 'warning' | 'danger' | 'info' | 'success' }
> = {
  merge: { label: '合并', variant: 'warning' },
  delete_empty: { label: '清理空目录', variant: 'danger' },
  rename: { label: '改名', variant: 'info' },
  create: { label: '新建 / 拆分', variant: 'success' },
};

async function isFolderTrulyEmpty(folderId: string): Promise<boolean> {
  try {
    const [node] = await chrome.bookmarks.getSubTree(folderId);
    if (!node) return false;
    const hasAnyLink = (n: chrome.bookmarks.BookmarkTreeNode): boolean => {
      if (n.url) return true;
      return (n.children || []).some(hasAnyLink);
    };
    return !hasAnyLink(node);
  } catch {
    return false;
  }
}

export function BatchRenameDialog({
  open,
  onOpenChange,
  ai,
  rootId,
  tops,
  loose,
  favorites,
  currentFolderId,
  onOpenAiSettings,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ai: AiConfig;
  rootId: string;
  tops: FolderNode[];
  loose: BookmarkItem[];
  favorites: string[];
  currentFolderId: string;
  onOpenAiSettings: () => void;
  onApplied: (count: number) => void;
}) {
  const flatFolders = useMemo(() => collectFlatFolders(tops), [tops]);
  const auditFolders = useMemo(() => collectAuditFolders(tops), [tops]);
  const scopes = useMemo(
    () => collectScopeItems(tops, loose, rootId, currentFolderId, favorites),
    [tops, loose, rootId, currentFolderId, favorites],
  );

  const [modeTab, setModeTab] = useState<'bookmarks' | 'structure'>('bookmarks');

  // Tab 1: 书签整理状态
  const [scopeId, setScopeId] = useState(scopes[0]?.id || '__all__');
  const [includeCategory, setIncludeCategory] = useState(true);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'running' | 'review' | 'applying'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  // Tab 2: 目录结构体检状态
  const [auditPhase, setAuditPhase] = useState<'idle' | 'running' | 'review' | 'applying'>('idle');
  const [auditSummary, setAuditSummary] = useState('');
  const [auditRows, setAuditRows] = useState<SelectableAuditRow[]>([]);
  const [auditErr, setAuditErr] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setScopeId(scopes[0]?.id || '__all__');
      setRows([]);
      setPhase('idle');
      setErrorMsg('');
      setProgress({ done: 0, total: 0 });
      setAuditPhase('idle');
      setAuditSummary('');
      setAuditRows([]);
      setAuditErr('');
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open, scopes]);

  const activeScope = scopes.find((s) => s.id === scopeId) || scopes[0];
  const aiConfigured = isAiReady(ai);
  const busy = phase === 'running' || phase === 'applying' || auditPhase === 'running' || auditPhase === 'applying';

  /* ---------------- Tab 1 逻辑 ---------------- */

  const isRowModified = (r: EditableRow) =>
    r.draftTitle.trim() !== r.originalTitle ||
    (includeCategory && r.draftFolderId !== r.originalFolderId);

  const visibleRows = useMemo(
    () => (onlyChanged ? rows.filter((r) => isRowModified(r) || r.changed) : rows),
    [rows, onlyChanged, includeCategory],
  );

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected && r.draftTitle.trim() && isRowModified(r)).length,
    [rows, includeCategory],
  );

  const changedCount = useMemo(() => rows.filter((r) => r.changed).length, [rows]);
  const allVisibleChecked = visibleRows.length > 0 && visibleRows.every((r) => r.selected);

  const handleStartBookmarks = async () => {
    if (!activeScope || activeScope.items.length === 0) return;
    setErrorMsg('');
    const granted = await requestDeepSeekPermission();
    if (!granted) {
      setErrorMsg('未授予 api.deepseek.com 网络权限，请重试并允许。');
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRows([]);
    setPhase('running');
    setProgress({ done: 0, total: activeScope.items.length });

    try {
      await batchSuggestRenames({
        ai,
        items: activeScope.items,
        includeCategory: includeCategory && flatFolders.length > 0,
        folders: flatFolders,
        batchSize: 15,
        signal: ac.signal,
        onProgress: (done, total, batch) => {
          setProgress({ done, total });
          setRows((prev) => [
            ...prev,
            ...batch.map((item) => ({
              ...item,
              selected: item.changed,
              draftTitle: item.suggestedTitle,
              draftFolderId: item.suggestedFolderId,
            })),
          ]);
        },
      });
      setPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase((cur) => (cur === 'running' ? 'review' : cur));
      } else {
        setErrorMsg(err instanceof Error ? err.message : '生成建议失败');
        setPhase('review');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleApplyBookmarks = async () => {
    const toUpdate = rows.filter((r) => r.selected && r.draftTitle.trim() && isRowModified(r));
    if (!toUpdate.length) return;
    setPhase('applying');
    let ok = 0;
    try {
      for (const row of toUpdate) {
        const nextTitle = row.draftTitle.trim();
        if (nextTitle !== row.originalTitle) {
          await chrome.bookmarks.update(row.id, { title: nextTitle });
        }
        if (includeCategory && row.draftFolderId && row.draftFolderId !== row.originalFolderId) {
          await chrome.bookmarks.move(row.id, { parentId: row.draftFolderId });
        }
        ok += 1;
      }
      onOpenChange(false);
      onApplied(ok);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `部分写入失败（已完成 ${ok} 条）`);
      setPhase('review');
    }
  };

  /* ---------------- Tab 2 目录结构体检逻辑 ---------------- */

  const selectedAuditCount = useMemo(() => auditRows.filter((r) => r.selected).length, [auditRows]);

  const handleStartAudit = async () => {
    if (auditFolders.length === 0) return;
    setAuditErr('');
    const granted = await requestDeepSeekPermission();
    if (!granted) {
      setAuditErr('未授予 api.deepseek.com 网络权限，请重试并允许。');
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setAuditRows([]);
    setAuditSummary('');
    setAuditPhase('running');

    try {
      const res = await auditFolderStructure({
        ai,
        rootId,
        folders: auditFolders,
        signal: ac.signal,
      });
      setAuditSummary(res.summary);
      setAuditRows(res.suggestions.map((s) => ({ ...s, selected: true })));
      setAuditPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setAuditPhase('idle');
      } else {
        setAuditErr(err instanceof Error ? err.message : '目录体检失败');
        setAuditPhase('review');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleApplyAudit = async () => {
    const selected = auditRows.filter((r) => r.selected);
    if (!selected.length) return;
    setAuditPhase('applying');
    setAuditErr('');

    try {
      // 执行任何目录结构变更前，自动下载完整 JSON 备份兜底
      await exportRoot(rootId, favorites);
    } catch {
      /* 即使下载提示被拦也继续确认？不，这里仅记录不阻断 */
    }

    let ok = 0;
    try {
      // 1. 先执行新建/拆分
      for (const act of selected.filter((a) => a.type === 'create')) {
        if (!act.newName) continue;
        const created = await chrome.bookmarks.create({
          parentId: act.parentId || rootId,
          title: act.newName,
        });
        for (const bid of act.moveBookmarkIds || []) {
          try {
            await chrome.bookmarks.move(bid, { parentId: created.id });
          } catch {
            /* 忽略已被移动/删除的节点 */
          }
        }
        ok += 1;
      }

      // 2. 执行目录改名
      for (const act of selected.filter((a) => a.type === 'rename')) {
        if (!act.folderId || !act.newName) continue;
        try {
          await chrome.bookmarks.update(act.folderId, { title: act.newName });
          ok += 1;
        } catch {
          /* 忽略 */
        }
      }

      // 3. 执行安全合并：先将源目录所有子项移入目标目录，确认已无书签后再删除空壳
      for (const act of selected.filter((a) => a.type === 'merge')) {
        if (!act.sourceId || !act.targetId || act.sourceId === act.targetId) continue;
        if (await isInsideFolder(act.targetId, act.sourceId)) continue;
        try {
          const [srcNode] = await chrome.bookmarks.getSubTree(act.sourceId);
          for (const child of srcNode?.children || []) {
            await chrome.bookmarks.move(child.id, { parentId: act.targetId });
          }
          if (await isFolderTrulyEmpty(act.sourceId)) {
            await chrome.bookmarks.removeTree(act.sourceId);
          }
          ok += 1;
        } catch {
          /* 忽略 */
        }
      }

      // 4. 清理空目录：逐一二次校验确认不含任何书签才删除
      for (const act of selected.filter((a) => a.type === 'delete_empty')) {
        if (!act.folderId) continue;
        if (await isFolderTrulyEmpty(act.folderId)) {
          try {
            await chrome.bookmarks.removeTree(act.folderId);
            ok += 1;
          } catch {
            /* 忽略 */
          }
        }
      }

      onOpenChange(false);
      onApplied(ok);
    } catch (err) {
      setAuditErr(err instanceof Error ? err.message : `部分执行失败（已完成 ${ok} 项）`);
      setAuditPhase('review');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[860px] h-[min(650px,calc(100vh-48px))] flex flex-col overflow-hidden">
        <DialogHeader
          title="AI 智能整理"
          extra={<Badge variant="info">DeepSeek</Badge>}
        />

        {!aiConfigured ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
            <Sparkles className="w-7 h-7 text-accent" />
            <p className="m-0 text-sm font-semibold text-ink">尚未启用 DeepSeek AI 助手</p>
            <p className="m-0 max-w-[380px] text-[12.5px] leading-relaxed text-ink2">
              请先在「系统设置 → AI 助手」中填写你的 DeepSeek API Key 并开启开关，即可使用批量整理与目录体检。
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                onOpenChange(false);
                onOpenAiSettings();
              }}
            >
              前往配置 DeepSeek
            </Button>
          </div>
        ) : (
          <>
            {/* 双模式切换 Tab */}
            <div className="flex items-center border-b border-line bg-background px-5 gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setModeTab('bookmarks')}
                className={cn(
                  'relative h-10 px-3 text-[13px] font-sans cursor-pointer transition-colors disabled:opacity-50',
                  modeTab === 'bookmarks' ? 'text-ink font-semibold' : 'text-ink2 hover:text-ink',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  书签整理（重命名 / 归类）
                </span>
                {modeTab === 'bookmarks' && (
                  <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-accent" />
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setModeTab('structure')}
                className={cn(
                  'relative h-10 px-3 text-[13px] font-sans cursor-pointer transition-colors disabled:opacity-50',
                  modeTab === 'structure' ? 'text-ink font-semibold' : 'text-ink2 hover:text-ink',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  目录体检（合并 / 清理 / 改名 / 拆分）
                </span>
                {modeTab === 'structure' && (
                  <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-accent" />
                )}
              </button>
            </div>

            {modeTab === 'bookmarks' ? (
              <>
                <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-surface border-b border-line">
                  <div className="flex-1 min-w-[200px]">
                    <NativeSelect
                      aria-label="选择整理范围"
                      value={scopeId}
                      disabled={busy}
                      onChange={(e) => setScopeId(e.target.value)}
                    >
                      {scopes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink2 cursor-pointer select-none">
                    <Checkbox
                      checked={includeCategory}
                      disabled={busy}
                      onCheckedChange={setIncludeCategory}
                    />
                    <span>同时建议调整分类</span>
                  </label>

                  {phase === 'running' ? (
                    <Button variant="danger-outline" onClick={() => abortRef.current?.abort()}>
                      停止生成（{progress.done}/{progress.total}）
                    </Button>
                  ) : (
                    <Button
                      disabled={!activeScope || activeScope.items.length === 0 || busy}
                      onClick={handleStartBookmarks}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {rows.length > 0 ? '重新分析' : '开始分析'}
                    </Button>
                  )}
                </div>

                {(phase === 'running' || rows.length > 0 || errorMsg) && (
                  <div className="px-5 py-2 border-b border-line bg-background flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-ink2">
                      {phase === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
                      <span>
                        {phase === 'running'
                          ? `正在分析书签 ${progress.done} / ${progress.total}…`
                          : `共分析 ${rows.length} 条 · 建议调整 ${changedCount} 条 · 已勾选 ${selectedCount} 条`}
                      </span>
                      {errorMsg && <Badge variant="danger">{errorMsg}</Badge>}
                    </div>

                    {rows.length > 0 && (
                      <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-1.5 text-ink2 cursor-pointer select-none">
                          <Checkbox checked={onlyChanged} onCheckedChange={setOnlyChanged} />
                          <span>仅看有改动</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-ink2 cursor-pointer select-none">
                          <Checkbox
                            checked={allVisibleChecked}
                            onCheckedChange={(checked) => {
                              const visIds = new Set(visibleRows.map((r) => r.id));
                              setRows((prev) =>
                                prev.map((r) => (visIds.has(r.id) ? { ...r, selected: checked } : r)),
                              );
                            }}
                          />
                          <span>全选当前列表</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
                  {rows.length === 0 && phase === 'idle' ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
                      <p className="m-0 text-[13.5px] font-medium text-ink">
                        选择要整理的分组，点击「开始分析」
                      </p>
                      <p className="m-0 max-w-[460px] text-[12.5px] leading-relaxed text-ink2">
                        DeepSeek 会按批给出更简洁的建议名称（勾选「同时建议调整分类」时一并推荐更合适的目录）。所有建议均先展示前后对比，逐条确认后才会写回浏览器。
                      </p>
                    </div>
                  ) : visibleRows.length === 0 && phase !== 'running' ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
                      <p className="m-0 text-[13.5px] font-medium text-ink">这些书签的名称与分类已经很整齐了</p>
                      <p className="m-0 text-[12.5px] text-ink2">
                        取消勾选「仅看有改动」可查看全部 {rows.length} 条书签。
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-line">
                      {visibleRows.map((row) => {
                        const titleMod = row.draftTitle.trim() !== row.originalTitle;
                        const folderMod = includeCategory && row.draftFolderId !== row.originalFolderId;
                        const isMod = titleMod || folderMod;
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-[20px_24px_minmax(0,1fr)_16px_minmax(0,1.25fr)_auto] items-center gap-2.5 px-5 py-2.5 hover:bg-background/60"
                          >
                            <Checkbox
                              checked={row.selected}
                              disabled={phase === 'applying'}
                              onCheckedChange={(checked) =>
                                setRows((prev) =>
                                  prev.map((x) => (x.id === row.id ? { ...x, selected: checked } : x)),
                                )
                              }
                              aria-label={`选择 ${row.originalTitle}`}
                            />

                            <Favicon url={row.url} fallbackText={row.originalTitle} className="w-6 h-6 p-0.5 text-[11px]" />

                            <div className="min-w-0">
                              <div className="text-[12.5px] text-ink2 truncate" title={row.originalTitle}>
                                {row.originalTitle}
                              </div>
                              <div className="text-[11px] text-ink3 truncate" title={row.originalFolderPath}>
                                {row.originalFolderPath}
                              </div>
                            </div>

                            <ArrowRight className="w-3.5 h-3.5 text-ink3 shrink-0" />

                            <div className="min-w-0 flex flex-col gap-1.5">
                              <Input
                                value={row.draftTitle}
                                disabled={phase === 'applying'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setRows((prev) =>
                                    prev.map((x) => {
                                      if (x.id !== row.id) return x;
                                      const mod =
                                        val.trim() !== x.originalTitle ||
                                        (includeCategory && x.draftFolderId !== x.originalFolderId);
                                      return { ...x, draftTitle: val, selected: mod };
                                    }),
                                  );
                                }}
                                className="h-8 text-[12.5px] px-2.5"
                              />
                              {includeCategory && flatFolders.length > 0 && (
                                <NativeSelect
                                  aria-label="建议目标分类"
                                  value={row.draftFolderId}
                                  disabled={phase === 'applying'}
                                  onChange={(e) => {
                                    const fid = e.target.value;
                                    setRows((prev) =>
                                      prev.map((x) => {
                                        if (x.id !== row.id) return x;
                                        const mod =
                                          x.draftTitle.trim() !== x.originalTitle || fid !== x.originalFolderId;
                                        return { ...x, draftFolderId: fid, selected: mod };
                                      }),
                                    );
                                  }}
                                  className={cn(
                                    'h-7 text-[11.5px] pl-2.5 pr-7',
                                    folderMod && 'border-accent-line bg-accent-soft text-accent',
                                  )}
                                >
                                  {row.originalFolderId === rootId && <option value={rootId}>根目录</option>}
                                  {flatFolders.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.pathLabel}
                                    </option>
                                  ))}
                                </NativeSelect>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {row.reason && (
                                <Badge variant={folderMod ? 'warning' : isMod ? 'info' : 'muted'}>
                                  {row.reason}
                                </Badge>
                              )}
                              {isMod && (
                                <button
                                  type="button"
                                  title="还原为原名称与原分类"
                                  onClick={() =>
                                    setRows((prev) =>
                                      prev.map((x) =>
                                        x.id === row.id
                                          ? {
                                              ...x,
                                              draftTitle: x.originalTitle,
                                              draftFolderId: x.originalFolderId,
                                              selected: false,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className="inline-flex items-center justify-center w-6 h-6 text-ink3 hover:text-ink hover:bg-hover cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-line bg-background flex items-center justify-between gap-3">
                  <span className="text-xs text-ink2">仅会更新已勾选且有变化的书签，原网址与收藏时间保持不变。</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                      取消
                    </Button>
                    <Button disabled={selectedCount === 0 || busy} onClick={handleApplyBookmarks}>
                      {phase === 'applying' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          写入中…
                        </>
                      ) : (
                        `应用所选（${selectedCount} 项）`
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              /* ---------------- Tab 2: 目录体检 ---------------- */
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-surface border-b border-line">
                  <div className="text-[12.5px] text-ink2">
                    共检测 <strong className="text-ink font-semibold">{auditFolders.length}</strong> 个分类目录，识别可合并、空目录、待改名与可拆分结构。
                  </div>
                  {auditPhase === 'running' ? (
                    <Button variant="danger-outline" onClick={() => abortRef.current?.abort()}>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      体检中 · 取消
                    </Button>
                  ) : (
                    <Button disabled={auditFolders.length === 0 || busy} onClick={handleStartAudit}>
                      <FolderGit2 className="w-3.5 h-3.5" />
                      {auditRows.length > 0 || auditSummary ? '重新体检' : '开始目录体检'}
                    </Button>
                  )}
                </div>

                {(auditSummary || auditErr) && (
                  <div className="px-5 py-2.5 border-b border-line bg-background flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-ink2">{auditSummary}</span>
                    {auditErr && <Badge variant="danger">{auditErr}</Badge>}
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
                  {auditPhase === 'idle' ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
                      <p className="m-0 text-[13.5px] font-medium text-ink">
                        点击「开始目录体检」，全面诊断分类结构
                      </p>
                      <p className="m-0 max-w-[480px] text-[12.5px] leading-relaxed text-ink2">
                        DeepSeek 会纵览全部目录与书签样本，提出合并重复/过碎分类、清理空目录、规范分类命名或拆分过载目录的建议。执行前将自动下载完整 JSON 备份，且绝不删除任何书签。
                      </p>
                    </div>
                  ) : auditPhase === 'running' ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 gap-2 text-xs text-ink2">
                      <Loader2 className="w-5 h-5 animate-spin text-accent" />
                      <span>正在分析全局目录结构…</span>
                    </div>
                  ) : auditRows.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
                      <p className="m-0 text-[13.5px] font-medium text-ink">当前目录结构已经很清晰</p>
                      <p className="m-0 text-[12.5px] text-ink2">未发现需要合并或清理的分类。</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-line">
                      {auditRows.map((row) => {
                        const badge = AUDIT_BADGE[row.type];
                        return (
                          <label
                            key={row.uid}
                            className="flex items-start gap-3 px-5 py-3 hover:bg-background/60 cursor-pointer select-none"
                          >
                            <Checkbox
                              checked={row.selected}
                              disabled={auditPhase === 'applying'}
                              onCheckedChange={(checked) =>
                                setAuditRows((prev) =>
                                  prev.map((x) => (x.uid === row.uid ? { ...x, selected: checked } : x)),
                                )
                              }
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                                <Badge variant={badge.variant}>{badge.label}</Badge>
                                {row.type === 'merge' && (
                                  <span>
                                    「<strong>{row.sourcePath}</strong>」（{row.sourceCount ?? 0} 项）→ 并入「
                                    <strong>{row.targetPath}</strong>」
                                  </span>
                                )}
                                {row.type === 'delete_empty' && (
                                  <span>
                                    清理空分类「<strong>{row.folderPath}</strong>」
                                  </span>
                                )}
                                {row.type === 'rename' && (
                                  <span>
                                    「<strong>{row.folderPath}</strong>」→ 改名为「<strong>{row.newName}</strong>」
                                  </span>
                                )}
                                {row.type === 'create' && (
                                  <span>
                                    在「<strong>{row.parentPath}</strong>」下新建「<strong>{row.newName}</strong>」
                                    {row.moveCount ? `（并移入 ${row.moveCount} 条书签）` : ''}
                                  </span>
                                )}
                              </div>
                              <p className="m-0 text-xs text-ink2">{row.reason}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-line bg-background flex items-center justify-between gap-3">
                  <span className="text-xs text-ink2">
                    执行前会自动下载完整 JSON 备份；合并时所有书签会安全迁入目标目录，不删书签。
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                      取消
                    </Button>
                    <Button disabled={selectedAuditCount === 0 || busy} onClick={handleApplyAudit}>
                      {auditPhase === 'applying' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          执行中…
                        </>
                      ) : (
                        `备份并应用所选（${selectedAuditCount} 项）`
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
