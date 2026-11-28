import React from 'react';
import { ChevronRight, Folder, Star } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { Favicon } from '@/components/Favicon';
import { cn } from '@/lib/cn';
import type {
  ComputedView,
  DragState,
  DropIndicator,
  ViewRow,
  ViewSection,
} from '@/pages/newtab/newtabTypes';

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;

  const lower = text.toLowerCase();
  let at = lower.indexOf(q, 0);
  if (at < 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={key++}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function getEmptyState(filter: ComputedView['filter'], folderId: string) {
  if (filter === 'search') {
    return {
      title: '没有匹配的书签',
      hint: (
        <>
          按 <Kbd>Esc</Kbd> 清空搜索，或换个关键词试试
        </>
      ),
    };
  }
  if (folderId === '__favorites__') {
    return {
      title: '还没有收藏的书签',
      hint: '鼠标悬停书签卡片并点击右侧 ★，即可固定到这里',
    };
  }
  return {
    title: '这个分组是空的',
    hint: (
      <>
        按 <Kbd>/</Kbd> 搜索全部收藏
      </>
    ),
  };
}

export function BookmarkSheet({
  view,
  folderId,
  query,
  sel,
  canEdit,
  drag,
  dropIndicator,
  looseIdSet,
  looseUrlSet,
  groupedUrlSet,
  isDescendant,
  onSelectFolder,
  onOpenBookmark,
  onCancelPendingOpen,
  onToggleFavorite,
  onOpenEdit,
  onStartDrag,
  onEndDrag,
  onDropIndicatorChange,
  onMoveInto,
  onMoveBeforeCard,
  onMoveRel,
}: {
  view: ComputedView;
  folderId: string;
  query: string;
  sel: number;
  canEdit: boolean;
  drag: DragState | null;
  dropIndicator: DropIndicator | null;
  looseIdSet: Set<string>;
  looseUrlSet: Set<string>;
  groupedUrlSet: Set<string>;
  isDescendant: (id: string, maybeAncestorId: string) => boolean;
  onSelectFolder: (id: string) => void;
  onOpenBookmark: (url: string) => void;
  onCancelPendingOpen: () => void;
  onToggleFavorite: (id: string) => void;
  onOpenEdit: (node: { id: string; title: string; url?: string; isFolder: boolean }) => void;
  onStartDrag: (id: string, isFolder: boolean, title: string, e: React.DragEvent) => void;
  onEndDrag: () => void;
  onDropIndicatorChange: (next: DropIndicator | null) => void;
  onMoveInto: (id: string, parentId: string) => void;
  onMoveBeforeCard: (id: string, targetId: string) => void;
  onMoveRel: (id: string, targetId: string, pos: 'before' | 'after') => void;
}) {
  const canReorderCard = view.filter !== 'search' && folderId !== '__favorites__' && !view.reading;
  const canDragCard = canEdit && folderId !== '__favorites__';
  const searchHighlight = view.filter === 'search' ? query.trim() : '';

  const renderEmpty = () => {
    const empty = getEmptyState(view.filter, folderId);
    return (
      <div className="px-6 py-14 text-center">
        <p className="m-0 mb-2 text-sm font-medium text-ink2">{empty.title}</p>
        <p className="m-0 text-xs text-ink3">{empty.hint}</p>
      </div>
    );
  };

  const renderCell = (it: ViewRow, idx: number) => {
    const isSel = view.filter === 'search' && sel === idx;
    const isDropInto = dropIndicator?.id === it.id && dropIndicator.mode === 'into';

    if (it.kind === 'folder') {
      return (
        <button
          key={`f-${it.id}`}
          type="button"
          data-row-idx={idx}
          onClick={() => onSelectFolder(it.id)}
          draggable={canEdit}
          onDragStart={(e) => canEdit && onStartDrag(it.id, true, it.title, e)}
          onDragEnd={onEndDrag}
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            onOpenEdit({ id: it.id, title: it.title, isFolder: true });
          }}
          onDragOver={(e) => {
            if (!canEdit || !drag || drag.isFolder) return;
            e.preventDefault();
            onDropIndicatorChange({ id: it.id, mode: 'into' });
          }}
          onDragLeave={() => {
            if (dropIndicator?.id === it.id) onDropIndicatorChange(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDropIndicatorChange(null);
            if (drag && !drag.isFolder) onMoveInto(drag.id, it.id);
          }}
          style={{ padding: 'var(--cell-py) var(--cell-px)', gap: 'var(--cell-gap)' }}
          className={cn(
            'bm-cell group relative flex items-center min-w-0 bg-surface text-left cursor-pointer transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-[-2px]',
            drag?.id === it.id && 'opacity-40',
            isDropInto && 'relative z-[2] bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
            isSel && 'relative z-[2] bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
          )}
        >
          <span
            style={{ width: 'var(--ico-sz)', height: 'var(--ico-sz)' }}
            className="shrink-0 inline-flex items-center justify-center border border-line bg-background text-ink3"
          >
            <Folder className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium text-ink truncate">
              {it.title}
            </span>
            <span style={{ fontSize: 'var(--fs-meta)' }} className="text-ink3 tabular-nums truncate">
              {it.count} 项书签
            </span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-ink3 opacity-45 shrink-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
        </button>
      );
    }

    const isLoose = looseIdSet.has(it.id);
    const isFav = looseUrlSet.has(it.url);
    const canToggleStar = !isLoose || groupedUrlSet.has(it.url);

    return (
      <a
        key={`l-${it.id}`}
        href={it.url}
        title={`${it.title}\n${it.url}`}
        data-row-idx={idx}
        draggable={canDragCard}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-fav-btn]')) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          onOpenBookmark(it.url);
        }}
        onDragStart={(e) => canDragCard && onStartDrag(it.id, false, it.title, e)}
        onDragEnd={onEndDrag}
        onContextMenu={(e) => {
          if (!canEdit) return;
          onCancelPendingOpen();
          e.preventDefault();
          onOpenEdit({ id: it.id, title: it.title, url: it.url, isFolder: false });
        }}
        onDragOver={(e) => {
          if (!canEdit || !canReorderCard || !drag || drag.isFolder || drag.id === it.id) return;
          e.preventDefault();
          onDropIndicatorChange({ id: it.id, mode: 'into' });
        }}
        onDragLeave={() => {
          if (dropIndicator?.id === it.id) onDropIndicatorChange(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDropIndicatorChange(null);
          if (canEdit && canReorderCard && drag && !drag.isFolder && drag.id !== it.id) {
            onMoveBeforeCard(drag.id, it.id);
          }
        }}
        style={{ padding: 'var(--cell-py) var(--cell-px)', gap: 'var(--cell-gap)' }}
        className={cn(
          'bm-cell group relative flex items-center min-w-0 bg-surface text-inherit no-underline cursor-pointer transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-[-2px]',
          drag?.id === it.id && 'opacity-40',
          isDropInto && 'bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
          isSel && 'bg-accent-soft shadow-[inset_3px_0_0_0_var(--blue)]',
        )}
      >
        <Favicon
          url={it.url}
          fallbackText={it.host || it.title}
          className="w-[var(--ico-sz)] h-[var(--ico-sz)] p-[var(--ico-pad)] text-xs"
        />
        <span className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium text-ink truncate">
            <HighlightText text={it.title} query={searchHighlight} />
          </span>
          <span
            style={{ fontSize: 'var(--fs-meta)' }}
            className={cn('text-ink3 truncate tabular-nums', !it.subText && 'font-mono')}
          >
            <HighlightText text={it.subText || it.host} query={searchHighlight} />
          </span>
        </span>

        {canToggleStar && (
          <span
            data-fav-btn="true"
            role="button"
            tabIndex={0}
            title={isFav ? '取消收藏' : '加入「我的收藏」'}
            aria-label={isFav ? '取消收藏' : '加入「我的收藏」'}
            aria-pressed={isFav}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite(it.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(it.id);
              }
            }}
            className={cn(
              'shrink-0 inline-flex items-center justify-center w-[calc(var(--fs-title)+12px)] h-[calc(var(--fs-title)+12px)] border border-transparent transition-all cursor-pointer hover:bg-surface hover:border-line2 hover:text-amber focus-visible:outline-2 focus-visible:outline-accent-line',
              isFav
                ? 'opacity-100 text-amber'
                : 'opacity-0 text-ink3 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            <Star className={cn('w-[var(--fs-title)] h-[var(--fs-title)]', isFav && 'fill-current')} />
          </span>
        )}
      </a>
    );
  };

  const renderGroupHead = (
    title: string,
    count: number,
    unit = '项',
    sec?: ViewSection,
    isFirst = false,
  ) => {
    const dropMode = sec && dropIndicator?.id === sec.id ? dropIndicator.mode : null;
    const resolveHeadDrop = (e: React.DragEvent): '' | 'into' | 'before' | 'after' => {
      if (!sec || !drag || drag.id === sec.id) return '';
      if (!drag.isFolder) return 'into';
      if (!sec.editable || isDescendant(sec.id, drag.id)) return '';
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
      return relY < 0.5 ? 'before' : 'after';
    };

    return (
      <div
        draggable={Boolean(canEdit && sec?.editable)}
        onDragStart={(e) => canEdit && sec?.editable && onStartDrag(sec.id, true, sec.title, e)}
        onDragEnd={onEndDrag}
        onContextMenu={(e) => {
          if (!canEdit || !sec?.editable) return;
          e.preventDefault();
          onOpenEdit({ id: sec.id, title: sec.title, isFolder: true });
        }}
        onDragOver={(e) => {
          if (!canEdit || !sec) return;
          const mode = resolveHeadDrop(e);
          if (!mode) return;
          e.preventDefault();
          onDropIndicatorChange({ id: sec.id, mode });
        }}
        onDragLeave={(e) => {
          if (sec && !e.currentTarget.contains(e.relatedTarget as Node) && dropIndicator?.id === sec.id) {
            onDropIndicatorChange(null);
          }
        }}
        onDrop={(e) => {
          if (!canEdit || !sec || !drag) return;
          const mode = resolveHeadDrop(e);
          onDropIndicatorChange(null);
          if (!mode) return;
          e.preventDefault();
          e.stopPropagation();
          if (mode === 'into') onMoveInto(drag.id, sec.id);
          else onMoveRel(drag.id, sec.id, mode);
        }}
        style={{ padding: 'var(--group-py-t) var(--group-px) var(--group-py-b)' }}
        className={cn(
          'group/head relative z-[1] flex items-baseline gap-2 bg-surface border-b border-line',
          !isFirst && 'border-t border-line',
          sec?.editable && 'hover:bg-hover active:cursor-grabbing transition-colors',
          dropMode === 'into' && 'bg-accent-soft',
          dropMode === 'before' && 'shadow-[inset_0_2px_0_0_var(--blue)]',
          dropMode === 'after' && 'shadow-[inset_0_-2px_0_0_var(--blue)]',
        )}
      >
        <span
          style={{ fontSize: 'var(--fs-group)' }}
          className={cn('font-semibold text-ink2 transition-colors', sec?.editable && 'group-hover/head:text-ink')}
        >
          {title}
        </span>
        <span style={{ fontSize: 'var(--fs-meta)' }} className="text-ink3 tabular-nums">
          {count} {unit}
        </span>
      </div>
    );
  };

  // 模式 A：二级目录下按三级子目录分段平铺
  if (view.sections) {
    if (view.sections.length === 0) return renderEmpty();
    let idx = 0;

    return (
      <div role="list">
        {view.sections.map((sec, secIdx) => (
          <div key={sec.id}>
            {renderGroupHead(sec.title, sec.items.length, '项', sec, secIdx === 0)}
            {sec.items.length > 0 ? (
              <div className="bm-grid">
                {sec.items.map((it) => {
                  const curIdx = idx++;
                  return renderCell(it, curIdx);
                })}
              </div>
            ) : (
              <div
                onContextMenu={(e) => {
                  if (!canEdit || !sec.editable) return;
                  e.preventDefault();
                  onOpenEdit({ id: sec.id, title: sec.title, isFolder: true });
                }}
                onDragOver={(e) => {
                  if (!canEdit || !drag || drag.isFolder) return;
                  e.preventDefault();
                  onDropIndicatorChange({ id: `empty-${sec.id}`, mode: 'into' });
                }}
                onDragLeave={() => {
                  if (dropIndicator?.id === `empty-${sec.id}`) onDropIndicatorChange(null);
                }}
                onDrop={(e) => {
                  onDropIndicatorChange(null);
                  if (!canEdit || !drag || drag.isFolder) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onMoveInto(drag.id, sec.id);
                }}
                className={cn(
                  'px-5 py-4 text-xs text-ink3 border-b border-line',
                  dropIndicator?.id === `empty-${sec.id}` && 'bg-accent-soft text-accent',
                )}
              >
                暂无书签，拖入书签卡片即可归类
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // 模式 B：搜索 / 我的收藏 / 阅读清单 / 一级混合网格
  if (view.rows.length === 0) return renderEmpty();

  const groupCounts = new Map<string, number>();
  let linkCount = 0;
  let folderCount = 0;
  for (const r of view.rows) {
    if (r.kind === 'folder') {
      folderCount += 1;
    } else {
      linkCount += 1;
      const k = r.group || '';
      groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
    }
  }

  const blocks: React.ReactNode[] = [];
  let lastGroup: string | null = null;
  let curBucketKind: 'link' | 'folder' | null = null;
  let curItems: React.ReactNode[] = [];
  let blockKey = 0;

  const flush = () => {
    if (curItems.length > 0) {
      blocks.push(
        <div key={`b-${blockKey++}`} className="bm-grid">
          {curItems}
        </div>,
      );
      curItems = [];
    }
  };

  view.rows.forEach((it, i) => {
    const kind = it.kind;
    const gKey = it.kind === 'link' ? it.group || '' : '';

    if (kind === 'link' && view.group && gKey !== lastGroup) {
      flush();
      const isFirstHead = blocks.length === 0;
      lastGroup = gKey;
      blocks.push(
        <React.Fragment key={`gh-${blockKey++}`}>
          {renderGroupHead(gKey || '未分组', groupCounts.get(gKey) || 0, '项', undefined, isFirstHead)}
        </React.Fragment>,
      );
      curBucketKind = null;
    }

    if (view.splitSections && curBucketKind !== kind) {
      flush();
      const isFirstHead = blocks.length === 0;
      blocks.push(
        <React.Fragment key={`sh-${blockKey++}`}>
          {renderGroupHead(
            kind === 'link' ? '直属书签' : '子分组',
            kind === 'link' ? linkCount : folderCount,
            kind === 'link' ? '项' : '个',
            undefined,
            isFirstHead,
          )}
        </React.Fragment>,
      );
      curBucketKind = null;
    }

    if (curBucketKind !== kind) {
      flush();
      curBucketKind = kind;
    }

    curItems.push(renderCell(it, i));
  });
  flush();

  return <div role="list">{blocks}</div>;
}
