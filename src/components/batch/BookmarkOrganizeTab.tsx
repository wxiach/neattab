import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Favicon } from '@/components/Favicon';
import {
  batchSuggestRenames,
  requestDeepSeekPermission,
  type BatchRenameSuggestion,
} from '@/lib/ai';
import {
  applyBookmarkRenames,
  type FlatFolderOption,
  type ScopeOption,
} from '@/lib/batchApply';
import type { AiConfig } from '@/lib/types';
import { cn } from '@/lib/cn';

interface EditableRow extends BatchRenameSuggestion {
  selected: boolean;
  draftTitle: string;
  draftFolderId: string;
}

function getReasonBadgeVariant(folderMod: boolean, isMod: boolean): 'warning' | 'info' | 'muted' {
  if (folderMod) return 'warning';
  if (isMod) return 'info';
  return 'muted';
}

export function BookmarkOrganizeTab({
  open,
  ai,
  rootId,
  scopes,
  flatFolders,
  busy,
  onBusyChange,
  onCancel,
  onApplied,
}: {
  open: boolean;
  ai: AiConfig;
  rootId: string;
  scopes: ScopeOption[];
  flatFolders: FlatFolderOption[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onApplied: (count: number) => void;
}) {
  const [scopeId, setScopeId] = useState(scopes[0]?.id || '__all__');
  const [includeCategory, setIncludeCategory] = useState(true);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'running' | 'review' | 'applying'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setScopeId(scopes[0]?.id || '__all__');
      setRows([]);
      setPhase('idle');
      setErrorMsg('');
      setProgress({ done: 0, total: 0 });
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open, scopes]);

  useEffect(() => {
    onBusyChange(phase === 'running' || phase === 'applying');
  }, [phase, onBusyChange]);

  const activeScope = scopes.find((s) => s.id === scopeId) || scopes[0];

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

  const handleStart = async () => {
    if (!activeScope || activeScope.items.length === 0) return;

    setErrorMsg('');
    const granted = await requestDeepSeekPermission();
    if (!granted) {
      setErrorMsg('未授予模型接口网络权限，请重试并允许。');
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

  const handleApply = async () => {
    const toUpdate = rows.filter((r) => r.selected && r.draftTitle.trim() && isRowModified(r));
    if (toUpdate.length === 0) return;

    setPhase('applying');
    try {
      const ok = await applyBookmarkRenames(
        rootId,
        toUpdate.map((r) => ({
          id: r.id,
          url: r.url,
          originalTitle: r.originalTitle,
          nextTitle: r.draftTitle,
          originalFolderId: r.originalFolderId,
          nextFolderId: r.draftFolderId,
        })),
        includeCategory,
      );
      onApplied(ok);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '部分书签写入失败，请重试');
      setPhase('review');
    }
  };

  return (
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
          <Checkbox checked={includeCategory} disabled={busy} onCheckedChange={setIncludeCategory} />
          <span>同时建议调整分类</span>
        </label>

        {phase === 'running' ? (
          <Button variant="danger-outline" onClick={() => abortRef.current?.abort()}>
            停止生成（{progress.done}/{progress.total}）
          </Button>
        ) : (
          <Button disabled={!activeScope || activeScope.items.length === 0 || busy} onClick={handleStart}>
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
                    setRows((prev) => prev.map((r) => (visIds.has(r.id) ? { ...r, selected: checked } : r)));
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
            <p className="m-0 text-[13.5px] font-medium text-ink">选择要整理的分组，点击「开始分析」</p>
            <p className="m-0 max-w-[460px] text-[12.5px] leading-relaxed text-ink2">
              AI 会按批给出更简洁的建议名称（勾选「同时建议调整分类」时一并推荐目录），逐条确认后才写回浏览器。
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
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, selected: checked } : x)))
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
                      <Badge variant={getReasonBadgeVariant(folderMod, isMod)}>{row.reason}</Badge>
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
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={selectedCount === 0 || busy} onClick={handleApply}>
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
  );
}
