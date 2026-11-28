import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Star, Trash2 } from 'lucide-react';
import { Dialog, DialogHeader, DialogPopup } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Favicon } from './Favicon';
import { findNode } from '@/lib/bookmarks';
import {
  applyDuplicateCleanup,
  scanDuplicateBookmarks,
  type DuplicateAction,
  type DuplicateCleanupAction,
  type DuplicateCleanupResult,
  type DuplicateGroup,
} from '@/lib/dedup';
import { exportRoot } from '@/lib/transfer';
import { cn } from '@/lib/cn';

interface EntryChoice {
  selected: boolean;
  action: DuplicateAction;
}

interface GroupState {
  group: DuplicateGroup;
  keepId: string;
  choices: Record<string, EntryChoice>;
}

function formatDate(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildInitialGroupStates(groups: DuplicateGroup[]): GroupState[] {
  return groups.map((group) => {
    const choices: Record<string, EntryChoice> = {};
    for (const entry of group.entries) {
      if (entry.id === group.defaultKeepId) continue;
      choices[entry.id] = { selected: true, action: 'delete' };
    }
    return {
      group,
      keepId: group.defaultKeepId,
      choices,
    };
  });
}

export function DedupDialog({
  open,
  onOpenChange,
  rootId,
  favorites,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootId: string;
  favorites: string[];
  onDone: (res: DuplicateCleanupResult) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [states, setStates] = useState<GroupState[]>([]);
  const [backupBefore, setBackupBefore] = useState(false);

  const runScan = useCallback(async () => {
    if (typeof chrome === 'undefined' || typeof chrome.bookmarks?.getTree !== 'function') {
      setStates([]);
      setErrorMsg('当前环境不支持读取浏览器书签。');
      return;
    }
    setScanning(true);
    setErrorMsg('');
    try {
      const [treeRoot] = await chrome.bookmarks.getTree();
      const rootNode = findNode(treeRoot, rootId) || treeRoot?.children?.[0];
      if (!rootNode) {
        setStates([]);
        setErrorMsg('未找到当前数据源目录。');
        return;
      }
      const result = scanDuplicateBookmarks(rootNode);
      setStates(buildInitialGroupStates(result.groups));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '扫描重复书签失败');
    } finally {
      setScanning(false);
    }
  }, [rootId]);

  useEffect(() => {
    if (open) {
      setBackupBefore(false);
      runScan();
    }
  }, [open, runScan]);

  const stats = useMemo(() => {
    let totalExtras = 0;
    let selectedCount = 0;
    let moveCount = 0;
    let deleteCount = 0;
    let restorableGroups = 0;

    for (const st of states) {
      if (st.group.scope === 'folder' && !st.group.inRoot) {
        restorableGroups += 1;
      }
      for (const entry of st.group.entries) {
        if (entry.id === st.keepId) continue;
        totalExtras += 1;
        const c = st.choices[entry.id];
        if (!c?.selected) continue;
        selectedCount += 1;
        if (c.action === 'restore_favorite') moveCount += 1;
        else deleteCount += 1;
      }
    }
    return { totalExtras, selectedCount, moveCount, deleteCount, restorableGroups };
  }, [states]);

  const allSelected = stats.totalExtras > 0 && stats.selectedCount === stats.totalExtras;

  const handleToggleAll = () => {
    const next = !allSelected;
    setStates((prev) =>
      prev.map((st) => {
        const nextChoices: Record<string, EntryChoice> = {};
        for (const [id, c] of Object.entries(st.choices)) {
          nextChoices[id] = { ...c, selected: next };
        }
        return { ...st, choices: nextChoices };
      }),
    );
  };

  const handlePresetRestore = () => {
    setStates((prev) =>
      prev.map((st) => {
        if (st.group.scope !== 'folder' || st.group.inRoot) return st;
        const nextChoices: Record<string, EntryChoice> = {};
        let assignedRestore = false;
        for (const entry of st.group.entries) {
          if (entry.id === st.keepId) continue;
          const prevChoice = st.choices[entry.id] || { selected: true, action: 'delete' as DuplicateAction };
          if (!assignedRestore) {
            nextChoices[entry.id] = { selected: true, action: 'restore_favorite' };
            assignedRestore = true;
          } else {
            nextChoices[entry.id] = { ...prevChoice, action: 'delete' };
          }
        }
        return { ...st, choices: nextChoices };
      }),
    );
  };

  const handlePresetDeleteAll = () => {
    setStates((prev) =>
      prev.map((st) => {
        const nextChoices: Record<string, EntryChoice> = {};
        for (const [id, c] of Object.entries(st.choices)) {
          nextChoices[id] = { ...c, action: 'delete' };
        }
        return { ...st, choices: nextChoices };
      }),
    );
  };

  const handleSetKeep = (groupKey: string, nextKeepId: string) => {
    setStates((prev) =>
      prev.map((st) => {
        if (st.group.key !== groupKey || st.keepId === nextKeepId) return st;
        const oldKeepId = st.keepId;
        const oldActionOfNext = st.choices[nextKeepId];
        const nextChoices: Record<string, EntryChoice> = { ...st.choices };
        delete nextChoices[nextKeepId];
        // 原保留项转为多余副本，继承被替换项的勾选状态（默认删除）
        nextChoices[oldKeepId] = {
          selected: true,
          action: oldActionOfNext?.action === 'restore_favorite' ? 'restore_favorite' : 'delete',
        };
        return { ...st, keepId: nextKeepId, choices: nextChoices };
      }),
    );
  };

  const handleToggleEntry = (groupKey: string, entryId: string, selected: boolean) => {
    setStates((prev) =>
      prev.map((st) => {
        if (st.group.key !== groupKey) return st;
        const cur = st.choices[entryId];
        if (!cur) return st;
        return {
          ...st,
          choices: { ...st.choices, [entryId]: { ...cur, selected } },
        };
      }),
    );
  };

  const handleChangeAction = (groupKey: string, entryId: string, action: DuplicateAction) => {
    setStates((prev) =>
      prev.map((st) => {
        if (st.group.key !== groupKey) return st;
        const nextChoices: Record<string, EntryChoice> = {};
        for (const [id, c] of Object.entries(st.choices)) {
          if (id === entryId) {
            nextChoices[id] = { selected: true, action };
          } else if (action === 'restore_favorite' && c.action === 'restore_favorite') {
            // 同一个 URL 根目录只需一份收藏副本，其余多余副本保持删除
            nextChoices[id] = { ...c, action: 'delete' };
          } else {
            nextChoices[id] = c;
          }
        }
        return { ...st, choices: nextChoices };
      }),
    );
  };

  const handleApply = async () => {
    if (applying || stats.selectedCount === 0) return;
    setApplying(true);
    setErrorMsg('');
    try {
      if (backupBefore) {
        await exportRoot(rootId, favorites);
      }
      const actions: DuplicateCleanupAction[] = [];
      for (const st of states) {
        for (const entry of st.group.entries) {
          if (entry.id === st.keepId) continue;
          const choice = st.choices[entry.id];
          if (!choice?.selected) continue;
          actions.push({ id: entry.id, url: entry.url, action: choice.action });
        }
      }
      const res = await applyDuplicateCleanup(rootId, actions);
      onOpenChange(false);
      onDone(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '执行清理失败，请重试');
    } finally {
      setApplying(false);
    }
  };

  const actionButtonLabel = useMemo(() => {
    const parts: string[] = [];
    if (stats.moveCount > 0) parts.push(`移回 ${stats.moveCount} 条收藏`);
    if (stats.deleteCount > 0) parts.push(`删除 ${stats.deleteCount} 条`);
    return parts.length ? `执行清理（${parts.join(' · ')}）` : '执行清理';
  }, [stats.moveCount, stats.deleteCount]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[760px] h-[min(620px,calc(100vh-56px))] flex flex-col overflow-hidden">
        <DialogHeader
          title="重复书签清理"
          extra={
            <Button variant="outline" size="xs" disabled={scanning || applying} onClick={runScan}>
              <RefreshCw className={cn('w-3.5 h-3.5', scanning && 'animate-spin')} />
              重新扫描
            </Button>
          }
        />

        {/* 工具条 */}
        {!scanning && states.length > 0 && (
          <div className="flex-none flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-line bg-background">
            <div className="flex items-center gap-2 text-xs text-ink2">
              <span>
                发现 <strong className="text-ink tabular-nums">{states.length}</strong> 组重复，共{' '}
                <strong className="text-ink tabular-nums">{stats.totalExtras}</strong> 条多余副本
              </span>
              {stats.restorableGroups > 0 && (
                <Badge variant="warning">
                  {stats.restorableGroups} 组不在我的收藏
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {stats.restorableGroups > 0 && (
                <>
                  <Button variant="outline" size="xs" disabled={applying} onClick={handlePresetRestore}>
                    <Star className="w-3 h-3 text-amber" />
                    未收藏项移回我的收藏
                  </Button>
                  <Button variant="outline" size="xs" disabled={applying} onClick={handlePresetDeleteAll}>
                    <Trash2 className="w-3 h-3 text-ink2" />
                    全部设为删除
                  </Button>
                </>
              )}
              <Button variant="outline" size="xs" disabled={applying} onClick={handleToggleAll}>
                {allSelected ? '取消全选' : '全选'}
              </Button>
            </div>
          </div>
        )}

        {/* 主体列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
          {scanning ? (
            <div className="h-full flex items-center justify-center gap-2 text-[13px] text-ink2 p-8">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>正在扫描当前数据源书签…</span>
            </div>
          ) : errorMsg ? (
            <div className="p-6 text-center text-[13px] text-danger">{errorMsg}</div>
          ) : states.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
              <CheckCircle2 className="w-7 h-7 text-emerald" />
              <p className="m-0 text-[13.5px] font-medium text-ink">没有发现重复书签</p>
              <p className="m-0 text-[12.5px] text-ink2 max-w-[400px]">
                根目录「收藏夹栏」中的正常收藏副本不会计为重复。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {states.map((st) => {
                const { group, keepId, choices } = st;
                const canRestore = group.scope === 'folder' && !group.inRoot;
                return (
                  <div key={group.key} className="px-5 py-3.5 space-y-2">
                    {/* 分组头：图标 + URL + 来源标签 */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Favicon url={group.url} fallbackText={group.host || group.entries[0]?.title || '?'} className="w-5 h-5 p-[2px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-medium text-ink truncate">
                            {group.entries.find((e) => e.id === keepId)?.title || group.entries[0]?.title}
                          </span>
                          <Badge variant="muted">{group.entries.length} 份</Badge>
                          {group.scope === 'root' ? (
                            <Badge variant="default">根目录重复</Badge>
                          ) : group.inRoot ? (
                            <Badge variant="info">已在我的收藏</Badge>
                          ) : (
                            <Badge variant="warning">未在我的收藏</Badge>
                          )}
                        </div>
                        <div className="text-[11.5px] font-mono text-ink3 truncate">{group.url}</div>
                      </div>
                    </div>

                    {/* 每条副本行 */}
                    <div className="border border-line bg-background divide-y divide-line">
                      {group.entries.map((entry) => {
                        const isKeep = entry.id === keepId;
                        const choice = choices[entry.id];
                        const dateStr = formatDate(entry.dateAdded);

                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              'flex items-center gap-2.5 px-3 py-2 text-[12.5px]',
                              isKeep ? 'bg-surface' : choice?.selected ? 'bg-background' : 'bg-background opacity-60',
                            )}
                          >
                            {isKeep ? (
                              <span className="w-4 h-4 shrink-0 inline-flex items-center justify-center" aria-hidden="true">
                                <span className="w-1.5 h-1.5 bg-emerald" />
                              </span>
                            ) : (
                              <Checkbox
                                checked={Boolean(choice?.selected)}
                                disabled={applying}
                                aria-label={`选择处理 ${entry.folderPath} 中的副本`}
                                onCheckedChange={(checked) => handleToggleEntry(group.key, entry.id, checked)}
                              />
                            )}

                            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-ink font-medium truncate">{entry.folderPath}</span>
                              {entry.title !== group.entries.find((e) => e.id === keepId)?.title && (
                                <span className="text-ink2 text-xs truncate">「{entry.title}」</span>
                              )}
                              {dateStr && <span className="text-[11px] font-mono text-ink3">{dateStr}</span>}
                            </div>

                            {isKeep ? (
                              <Badge variant="success">保留</Badge>
                            ) : (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={applying}
                                  onClick={() => handleSetKeep(group.key, entry.id)}
                                  className="h-6 px-2 border border-transparent bg-transparent text-[11.5px] text-ink3 hover:bg-hover hover:text-ink cursor-pointer transition-colors"
                                >
                                  改留此项
                                </button>
                                {canRestore ? (
                                  <div className="inline-flex border border-line2 bg-surface">
                                    <button
                                      type="button"
                                      disabled={applying}
                                      onClick={() => handleChangeAction(group.key, entry.id, 'restore_favorite')}
                                      className={cn(
                                        'h-6 px-2 text-[11.5px] cursor-pointer transition-colors',
                                        choice?.action === 'restore_favorite'
                                          ? 'bg-amber-soft text-amber font-medium'
                                          : 'text-ink2 hover:bg-hover hover:text-ink',
                                      )}
                                    >
                                      移回收藏
                                    </button>
                                    <button
                                      type="button"
                                      disabled={applying}
                                      onClick={() => handleChangeAction(group.key, entry.id, 'delete')}
                                      className={cn(
                                        'h-6 px-2 border-l border-line2 text-[11.5px] cursor-pointer transition-colors',
                                        choice?.action !== 'restore_favorite'
                                          ? 'bg-danger-soft text-danger font-medium'
                                          : 'text-ink2 hover:bg-hover hover:text-ink',
                                      )}
                                    >
                                      删除
                                    </button>
                                  </div>
                                ) : (
                                  <Badge variant="danger">删除</Badge>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部确认区 */}
        <div className="flex-none px-5 py-3 border-t border-line bg-background flex flex-wrap items-center justify-between gap-3">
          {states.length > 0 ? (
            <label className="inline-flex items-center gap-2 text-xs text-ink2 cursor-pointer select-none">
              <Checkbox
                checked={backupBefore}
                disabled={applying}
                onCheckedChange={setBackupBefore}
              />
              <span>执行前先下载 JSON 备份</span>
            </label>
          ) : (
            <span className="text-xs text-ink3">根目录的收藏副本会自动保留，不计为重复。</span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            {states.length > 0 && (
              <Button disabled={stats.selectedCount === 0 || applying} onClick={handleApply}>
                {applying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    处理中…
                  </>
                ) : (
                  actionButtonLabel
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
