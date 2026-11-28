import { useMemo, useState } from 'react';
import { FolderGit2, Sparkles } from 'lucide-react';
import { Dialog, DialogHeader, DialogPopup } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookmarkOrganizeTab } from '@/components/batch/BookmarkOrganizeTab';
import { FolderAuditTab } from '@/components/batch/FolderAuditTab';
import { isAiReady } from '@/lib/ai';
import {
  collectAuditFolders,
  collectFlatFolders,
  collectScopeItems,
} from '@/lib/batchApply';
import type { AiConfig, BookmarkItem, FolderNode } from '@/lib/types';
import { cn } from '@/lib/cn';

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
    () => collectScopeItems(tops, loose, rootId, currentFolderId),
    [tops, loose, rootId, currentFolderId],
  );

  const [modeTab, setModeTab] = useState<'bookmarks' | 'structure'>('bookmarks');
  const [busy, setBusy] = useState(false);

  const aiConfigured = isAiReady(ai);

  const handleDone = (count: number) => {
    onOpenChange(false);
    onApplied(count);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[860px] h-[min(650px,calc(100vh-48px))] flex flex-col overflow-hidden">
        <DialogHeader title="AI 智能整理" />

        {!aiConfigured ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
            <Sparkles className="w-7 h-7 text-accent" />
            <p className="m-0 text-sm font-semibold text-ink">尚未启用 AI 模型</p>
            <p className="m-0 max-w-[380px] text-[12.5px] leading-relaxed text-ink2">
              请先在「系统设置 → 模型配置」中填写 API Key 并开启开关，即可使用批量整理与目录体检。
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                onOpenChange(false);
                onOpenAiSettings();
              }}
            >
              前往模型配置
            </Button>
          </div>
        ) : (
          <>
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
              <BookmarkOrganizeTab
                open={open}
                ai={ai}
                rootId={rootId}
                scopes={scopes}
                flatFolders={flatFolders}
                busy={busy}
                onBusyChange={setBusy}
                onCancel={() => onOpenChange(false)}
                onApplied={handleDone}
              />
            ) : (
              <FolderAuditTab
                open={open}
                ai={ai}
                rootId={rootId}
                favorites={favorites}
                auditFolders={auditFolders}
                busy={busy}
                onBusyChange={setBusy}
                onCancel={() => onOpenChange(false)}
                onApplied={handleDone}
              />
            )}
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
