import { Bookmark, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { FlatFolder } from '@/lib/types';
import { cn } from '@/lib/cn';

export interface PendingFolder {
  value: string;
  title: string;
  parentId?: string;
  displayLabel?: string;
}

export interface NoticeState {
  title: string;
  subtitle: string;
  actions?: Array<{ label: string; outline?: boolean; onClick: () => void }>;
}

export function PopupHeader({
  isEditing,
  aiStatus,
  aiError,
  aiEnabled,
  canRetryAi,
  badgeText,
  badgeVariant,
  onRetryAi,
}: {
  isEditing: boolean;
  aiStatus: 'idle' | 'loading' | 'done' | 'error';
  aiError: string;
  aiEnabled: boolean;
  canRetryAi: boolean;
  badgeText: string;
  badgeVariant: 'info' | 'warning' | 'success' | 'danger' | 'default';
  onRetryAi: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 bg-background border-b border-line">
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="shrink-0 w-6 h-6 bg-accent-soft text-accent inline-flex items-center justify-center">
          <Bookmark className="w-3.5 h-3.5 fill-current" />
        </span>
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] truncate">
          {isEditing ? '编辑收藏' : '收藏当前页'}
        </span>
      </span>

      <div className="flex items-center gap-1.5 shrink-0">
        {aiStatus === 'loading' ? (
          <Badge variant="info">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI 分析中…
          </Badge>
        ) : (
          badgeText && (
            <Badge variant={badgeVariant}>
              {aiStatus === 'done' && <Sparkles className="w-3 h-3" />}
              {badgeText}
            </Badge>
          )
        )}

        {aiEnabled && canRetryAi && (
          <button
            type="button"
            disabled={aiStatus === 'loading'}
            title={aiStatus === 'error' ? `重试 AI（${aiError}）` : '用 AI 重新推荐分组与命名'}
            onClick={onRetryAi}
            className="inline-flex items-center gap-1 h-6 px-1.5 border border-line2 bg-surface text-[11px] font-medium text-ink2 hover:text-accent hover:border-accent-line cursor-pointer disabled:opacity-45"
          >
            <RefreshCw className={cn('w-3 h-3', aiStatus === 'loading' && 'animate-spin')} />
            <span>{isEditing ? 'AI 优化' : '重试'}</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function PopupNoticeView({ notice }: { notice: NoticeState }) {
  return (
    <div className="px-5 py-7 text-center">
      <p className="m-0 mb-1.5 text-[13.5px] font-semibold text-ink">{notice.title}</p>
      {notice.subtitle && <p className="m-0 text-xs leading-relaxed text-ink2">{notice.subtitle}</p>}
      {notice.actions && notice.actions.length > 0 && (
        <div className="mt-4 flex justify-center gap-2">
          {notice.actions.map((a) => (
            <Button key={a.label} variant={a.outline ? 'outline' : 'default'} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderQuickPicks({
  aiNewFolder,
  offerReading,
  readingFolderName,
  readingPendingValue,
  quickPicks,
  selectedFolder,
  onSelectAiNewFolder,
  onSelectReadingNewFolder,
  onSelectFolder,
}: {
  aiNewFolder: PendingFolder | null;
  offerReading: boolean;
  readingFolderName: string;
  readingPendingValue: string;
  quickPicks: FlatFolder[];
  selectedFolder: string;
  onSelectAiNewFolder: () => void;
  onSelectReadingNewFolder: () => void;
  onSelectFolder: (id: string) => void;
}) {
  if (quickPicks.length <= 1 && !offerReading && !aiNewFolder) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-0.5">
      {aiNewFolder && (
        <button
          type="button"
          onClick={onSelectAiNewFolder}
          className={cn(
            'inline-flex items-center h-[22px] px-2 border border-dashed border-accent-line bg-surface shadow-[var(--badge-shadow)] text-accent text-[11px] font-medium leading-none cursor-pointer hover:bg-accent-soft',
            selectedFolder === aiNewFolder.value && 'bg-accent-soft',
          )}
        >
          + 建「{aiNewFolder.displayLabel || aiNewFolder.title}」
        </button>
      )}

      {offerReading && (
        <button
          type="button"
          onClick={onSelectReadingNewFolder}
          className={cn(
            'inline-flex items-center h-[22px] px-2 border border-dashed border-accent-line bg-surface shadow-[var(--badge-shadow)] text-accent text-[11px] font-medium leading-none cursor-pointer hover:bg-accent-soft',
            selectedFolder === readingPendingValue && 'bg-accent-soft',
          )}
        >
          + 建「{readingFolderName}」
        </button>
      )}

      {quickPicks.map((f) => {
        const active = f.id === selectedFolder;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelectFolder(f.id)}
            className={cn(
              'inline-flex items-center h-[22px] px-2 border shadow-[var(--badge-shadow)] text-[11px] font-medium leading-none cursor-pointer transition-colors',
              active
                ? 'border-accent-line bg-accent-soft text-accent'
                : 'border-line2 bg-surface text-ink2 hover:border-line3 hover:text-ink',
            )}
          >
            {f.title}
          </button>
        );
      })}
    </div>
  );
}
