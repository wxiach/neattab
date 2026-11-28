import React from 'react';
import { Folder, FolderOpen, Plus, Settings, Star, Trash2 } from 'lucide-react';
import type { FolderNode } from '@/lib/types';
import { cn } from '@/lib/cn';
import type { DragState, DropIndicator } from '@/pages/newtab/newtabTypes';

export function SidebarNav({
  tops,
  rootId,
  folderId,
  query,
  favCount,
  expanded,
  activeAncestors,
  canEdit,
  drag,
  trashOver,
  dropIndicator,
  isDescendant,
  onSelectFolder,
  onOpenSettings,
  onOpenCreate,
  onOpenEdit,
  onOpenDelete,
  onStartDrag,
  onEndDrag,
  onTrashOverChange,
  onDropIndicatorChange,
  onMoveInto,
  onMoveRel,
}: {
  tops: FolderNode[];
  rootId: string;
  folderId: string;
  query: string;
  favCount: number;
  expanded: Set<string>;
  activeAncestors: Set<string>;
  canEdit: boolean;
  drag: DragState | null;
  trashOver: boolean;
  dropIndicator: DropIndicator | null;
  isDescendant: (id: string, maybeAncestorId: string) => boolean;
  onSelectFolder: (id: string, toggle?: boolean) => void;
  onOpenSettings: () => void;
  onOpenCreate: (parentId: string, dialogTitle: string) => void;
  onOpenEdit: (node: { id: string; title: string; isFolder: boolean }) => void;
  onOpenDelete: (node: { id: string; title: string; isFolder: boolean }) => void;
  onStartDrag: (id: string, isFolder: boolean, title: string, e: React.DragEvent) => void;
  onEndDrag: () => void;
  onTrashOverChange: (over: boolean) => void;
  onDropIndicatorChange: (next: DropIndicator | null) => void;
  onMoveInto: (id: string, parentId: string) => void;
  onMoveRel: (id: string, targetId: string, pos: 'before' | 'after') => void;
}) {
  const resolveNavDrop = (
    e: React.DragEvent,
    targetEl: HTMLElement,
    node: FolderNode,
  ): '' | 'into' | 'before' | 'after' => {
    if (!drag || drag.id === node.id) return '';
    if (!drag.isFolder) return 'into';
    if (isDescendant(node.id, drag.id)) return '';

    const rect = targetEl.getBoundingClientRect();
    const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    if (relY < 0.28) return 'before';
    if (relY > 0.72) return 'after';
    return 'into';
  };

  const renderBranch = (folder: FolderNode): React.ReactNode => {
    const isTop = folder.depth === 1;
    const canExpand = isTop && folder.children.length > 0;
    const isOpen = canExpand && (expanded.has(folder.id) || activeAncestors.has(folder.id));
    const isActive = !query && (folderId === folder.id || (!isTop && activeAncestors.has(folder.id)));
    const dropMode = dropIndicator?.id === folder.id ? dropIndicator.mode : null;

    return (
      <div key={folder.id}>
        <div
          className={cn('relative group/row', drag?.id === folder.id && 'opacity-40')}
          draggable={canEdit}
          onDragStart={(e) => canEdit && onStartDrag(folder.id, true, folder.title, e)}
          onDragEnd={onEndDrag}
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            onOpenEdit({ id: folder.id, title: folder.title, isFolder: true });
          }}
          onDragOver={(e) => {
            if (!canEdit) return;
            const mode = resolveNavDrop(e, e.currentTarget, folder);
            if (!mode) {
              if (dropIndicator?.id === folder.id) onDropIndicatorChange(null);
              return;
            }
            e.preventDefault();
            onDropIndicatorChange({ id: folder.id, mode });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node) && dropIndicator?.id === folder.id) {
              onDropIndicatorChange(null);
            }
          }}
          onDrop={(e) => {
            if (!canEdit || !drag) return;
            const mode = resolveNavDrop(e, e.currentTarget, folder);
            onDropIndicatorChange(null);
            if (!mode) return;
            e.preventDefault();
            e.stopPropagation();
            if (mode === 'into') onMoveInto(drag.id, folder.id);
            else onMoveRel(drag.id, folder.id, mode);
          }}
        >
          <button
            type="button"
            onClick={() => onSelectFolder(folder.id, true)}
            style={
              isTop
                ? { height: 'var(--nav-h)', fontSize: 'var(--fs-title)' }
                : { height: 'var(--nav-sub-h)', paddingLeft: 'var(--nav-indent-base)', fontSize: 'var(--fs-sub)' }
            }
            className={cn(
              'relative w-full flex items-center border border-transparent bg-transparent text-left cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2',
              isTop ? 'gap-2.5 px-2.5 font-semibold text-ink' : 'gap-2 pr-2.5 my-0.5 text-ink2',
              isActive
                ? 'bg-surface border-line shadow-[var(--shadow-sm)] text-ink font-medium'
                : 'hover:bg-hover hover:text-ink',
              dropMode === 'into' && 'bg-accent-soft border-accent-line',
              dropMode === 'before' && 'shadow-[inset_0_2px_0_0_var(--blue)]',
              dropMode === 'after' && 'shadow-[inset_0_-2px_0_0_var(--blue)]',
            )}
          >
            {isTop &&
              (isOpen ? (
                <FolderOpen className="w-4 h-4 shrink-0 text-ink3" />
              ) : (
                <Folder className="w-4 h-4 shrink-0 text-ink3" />
              ))}
            {!isTop && isActive && (
              <span aria-hidden="true" className="absolute left-[18px] w-1.5 h-1.5 bg-accent" />
            )}

            <span className="min-w-0 truncate">{folder.title}</span>
            <span
              style={{ fontSize: 'var(--fs-meta)' }}
              className={cn(
                'ml-auto px-1.5 py-[1px] font-mono font-normal tabular-nums transition-opacity',
                isActive ? 'bg-subtle text-ink2' : 'bg-hover text-ink3',
                canEdit && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0',
              )}
            >
              {folder.totalCount}
            </span>
          </button>

          {canEdit && (
            <button
              type="button"
              title={`在「${folder.title}」下新建子分组`}
              aria-label={`在「${folder.title}」下新建子分组`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCreate(folder.id, '新建子分组');
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-[22px] h-[22px] border border-transparent text-ink3 opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto hover:bg-surface hover:border-line2 hover:text-ink cursor-pointer transition-opacity"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        {isOpen && <div className="py-0.5">{folder.children.map((c) => renderBranch(c))}</div>}
      </div>
    );
  };

  return (
    <aside className="no-print sticky top-[var(--topbar-h)] h-[calc(100vh-var(--topbar-h))] max-[960px]:static max-[960px]:h-auto flex flex-col pt-[var(--side-pt)] pb-[18px] max-[960px]:py-3 max-[960px]:border-b max-[960px]:border-line">
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        <nav aria-label="收藏夹分组">
          <button
            type="button"
            onClick={() => onSelectFolder('__favorites__', true)}
            style={{ height: 'var(--nav-h)', fontSize: 'var(--fs-title)' }}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 border border-transparent font-semibold text-left cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2',
              !query && folderId === '__favorites__'
                ? 'bg-surface border-line shadow-[var(--shadow-sm)] text-ink'
                : 'bg-transparent text-ink hover:bg-hover',
            )}
          >
            <Star className="w-4 h-4 shrink-0 text-amber" />
            <span className="min-w-0 truncate">我的收藏</span>
            <span
              style={{ fontSize: 'var(--fs-meta)' }}
              className={cn(
                'ml-auto px-1.5 py-[1px] font-mono font-normal tabular-nums',
                !query && folderId === '__favorites__' ? 'bg-subtle text-ink2' : 'bg-hover text-ink3',
              )}
            >
              {favCount}
            </span>
          </button>

          {(tops.length > 0 || canEdit) && (
            <>
              <div className="h-px my-3 mx-1.5 bg-line" />
              <div className="flex items-center justify-between px-1 pb-1.5 pl-2.5">
                <span style={{ fontSize: 'var(--fs-meta)' }} className="font-medium text-ink3">
                  分组
                </span>
                {canEdit && (
                  <button
                    type="button"
                    title="新建一级分组"
                    aria-label="新建一级分组"
                    onClick={() => onOpenCreate(rootId, '新建一级分组')}
                    className="inline-flex items-center justify-center w-[22px] h-[22px] border border-transparent text-ink3 hover:bg-surface hover:border-line2 hover:text-ink cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            </>
          )}

          {tops.map((top) => renderBranch(top))}
        </nav>
      </div>

      {/* 侧栏底部：系统设置 + 拖拽浮动删除区 */}
      <div className="relative flex-none mt-3 pt-3 border-t border-line">
        <button
          type="button"
          title="系统设置"
          aria-label="系统设置"
          onClick={onOpenSettings}
          style={{ height: 'var(--nav-h)', fontSize: 'var(--fs-sub)' }}
          className={cn(
            'w-full inline-flex items-center gap-2 px-2.5 border border-transparent bg-transparent text-ink2 cursor-pointer transition-all hover:bg-surface hover:border-line hover:text-ink',
            drag && 'opacity-0 pointer-events-none',
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span>系统设置</span>
        </button>

        {canEdit && (
          <div
            aria-hidden={!drag}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              onTrashOverChange(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) onTrashOverChange(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const cur = drag;
              onEndDrag();
              if (cur) onOpenDelete({ id: cur.id, title: cur.title, isFolder: cur.isFolder });
            }}
            style={{ height: 'calc(var(--nav-h) + 22px)' }}
            className={cn(
              'trash-zone absolute left-0 right-0 bottom-0 z-20 flex items-center justify-center gap-2 transition-all duration-150',
              drag ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none translate-y-2',
              trashOver && 'over scale-[1.02]',
            )}
          >
            <Trash2 className="w-4 h-4 shrink-0 pointer-events-none" />
            <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium pointer-events-none">
              拖到此处删除
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
