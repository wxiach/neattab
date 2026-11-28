import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderGit2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  auditFolderStructure,
  requestDeepSeekPermission,
  type AuditFolderSummary,
  type FolderAuditSuggestion,
} from '@/lib/ai';
import { applyFolderAudit } from '@/lib/batchApply';
import type { AiConfig } from '@/lib/types';

interface SelectableAuditRow extends FolderAuditSuggestion {
  selected: boolean;
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

function renderAuditDescription(row: FolderAuditSuggestion) {
  if (row.type === 'merge') {
    return (
      <span>
        「<strong>{row.sourcePath}</strong>」（{row.sourceCount ?? 0} 项）→ 并入「
        <strong>{row.targetPath}</strong>」
      </span>
    );
  }
  if (row.type === 'delete_empty') {
    return (
      <span>
        清理空分类「<strong>{row.folderPath}</strong>」
      </span>
    );
  }
  if (row.type === 'rename') {
    return (
      <span>
        「<strong>{row.folderPath}</strong>」→ 改名为「<strong>{row.newName}</strong>」
      </span>
    );
  }
  return (
    <span>
      在「<strong>{row.parentPath}</strong>」下新建「<strong>{row.newName}</strong>」
      {row.moveCount ? `（并移入 ${row.moveCount} 条书签）` : ''}
    </span>
  );
}

export function FolderAuditTab({
  open,
  ai,
  rootId,
  favorites,
  auditFolders,
  busy,
  onBusyChange,
  onCancel,
  onApplied,
}: {
  open: boolean;
  ai: AiConfig;
  rootId: string;
  favorites: string[];
  auditFolders: AuditFolderSummary[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onApplied: (count: number) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'review' | 'applying'>('idle');
  const [summary, setSummary] = useState('');
  const [rows, setRows] = useState<SelectableAuditRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setSummary('');
      setRows([]);
      setErrorMsg('');
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    onBusyChange(phase === 'running' || phase === 'applying');
  }, [phase, onBusyChange]);

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);

  const handleStart = async () => {
    if (auditFolders.length === 0) return;

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
    setSummary('');
    setPhase('running');

    try {
      const res = await auditFolderStructure({
        ai,
        rootId,
        folders: auditFolders,
        signal: ac.signal,
      });
      setSummary(res.summary);
      setRows(res.suggestions.map((s) => ({ ...s, selected: true })));
      setPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('idle');
      } else {
        setErrorMsg(err instanceof Error ? err.message : '目录体检失败');
        setPhase('review');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleApply = async () => {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) return;

    setPhase('applying');
    setErrorMsg('');
    try {
      const ok = await applyFolderAudit(rootId, selected, favorites);
      onApplied(ok);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '部分执行失败，请重试');
      setPhase('review');
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-surface border-b border-line">
        <div className="text-[12.5px] text-ink2">
          共检测 <strong className="text-ink font-semibold">{auditFolders.length}</strong> 个分类目录，识别可合并、空目录、待改名与可拆分结构。
        </div>
        {phase === 'running' ? (
          <Button variant="danger-outline" onClick={() => abortRef.current?.abort()}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            体检中 · 取消
          </Button>
        ) : (
          <Button disabled={auditFolders.length === 0 || busy} onClick={handleStart}>
            <FolderGit2 className="w-3.5 h-3.5" />
            {rows.length > 0 || summary ? '重新体检' : '开始目录体检'}
          </Button>
        )}
      </div>

      {(summary || errorMsg) && (
        <div className="px-5 py-2.5 border-b border-line bg-background flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-ink2">{summary}</span>
          {errorMsg && <Badge variant="danger">{errorMsg}</Badge>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {phase === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
            <p className="m-0 text-[13.5px] font-medium text-ink">点击「开始目录体检」，全面诊断分类结构</p>
            <p className="m-0 max-w-[480px] text-[12.5px] leading-relaxed text-ink2">
              AI 会纵览全部目录与书签样本，提出合并过碎分类、清理空目录、规范命名或拆分目录的建议。执行前自动下载备份，不删除书签。
            </p>
          </div>
        )}

        {phase === 'running' && (
          <div className="h-full flex flex-col items-center justify-center p-8 gap-2 text-xs text-ink2">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span>正在分析全局目录结构…</span>
          </div>
        )}

        {(phase === 'review' || phase === 'applying') && rows.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-2">
            <p className="m-0 text-[13.5px] font-medium text-ink">当前目录结构已经很清晰</p>
            <p className="m-0 text-[12.5px] text-ink2">未发现需要合并或清理的分类。</p>
          </div>
        )}

        {(phase === 'review' || phase === 'applying') && rows.length > 0 && (
          <div className="divide-y divide-line">
            {rows.map((row) => {
              const badge = AUDIT_BADGE[row.type];
              return (
                <label
                  key={row.uid}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-background/60 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={row.selected}
                    disabled={phase === 'applying'}
                    onCheckedChange={(checked) =>
                      setRows((prev) => prev.map((x) => (x.uid === row.uid ? { ...x, selected: checked } : x)))
                    }
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {renderAuditDescription(row)}
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
          执行前自动下载完整 JSON 备份；合并时所有书签会迁入目标目录，不删书签。
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={selectedCount === 0 || busy} onClick={handleApply}>
            {phase === 'applying' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                执行中…
              </>
            ) : (
              `备份并应用所选（${selectedCount} 项）`
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
