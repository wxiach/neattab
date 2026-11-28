import type { SemanticSearchHit } from '@/lib/ai';
import { buildReadingRows, collectFolderItems, type BuiltRoot } from '@/lib/bookmarks';
import { searchBookmarks, type SearchableBookmark } from '@/lib/search';
import { READING_FOLDER_RE } from '@/lib/storage';
import type { BookmarkItem, FolderNode } from '@/lib/types';

export type ViewRow =
  | (BookmarkItem & { kind: 'link' })
  | { kind: 'folder'; id: string; title: string; count: number };

export interface ViewSection {
  id: string;
  title: string;
  editable: boolean;
  items: Array<BookmarkItem & { kind: 'link' }>;
}

export interface CrumbEntry {
  title: string;
  folderId?: string;
}

export interface ComputedView {
  filter: 'folder' | 'search';
  rows: ViewRow[];
  sections?: ViewSection[];
  group: boolean;
  reading?: boolean;
  splitSections?: boolean;
  crumb: CrumbEntry[];
  hits?: number;
}

export interface DragState {
  id: string;
  title: string;
  isFolder: boolean;
}

export interface DropIndicator {
  id: string;
  mode: 'into' | 'before' | 'after';
}

export interface EditTarget {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  isFolder: boolean;
}

export interface DeleteTarget {
  id: string;
  title: string;
  isFolder: boolean;
  descendantCount: number;
}

export interface CreateTarget {
  parentId: string;
  dialogTitle: string;
}

export function normalizeFolderId(id: string, map: Map<string, FolderNode>): string {
  if (!id || id === '__favorites__') return id;
  let cur = map.get(id) || null;
  while (cur && cur.depth > 2) {
    cur = map.get(cur.parentId) || null;
  }
  return cur ? cur.id : '';
}

export function computeDefaultFolderId(built: BuiltRoot, candidateId: string): string {
  const norm = normalizeFolderId(candidateId, built.folderMap);
  if (norm === '__favorites__' || (norm && built.folderMap.has(norm))) return norm;

  const first = built.tops.find((t) => t.children.length > 0) || built.tops[0];
  return first ? first.id : '__favorites__';
}

export function getAncestorChain(id: string, map: Map<string, FolderNode>): FolderNode[] {
  const chain: FolderNode[] = [];
  let cur = id ? map.get(id) || null : null;
  while (cur) {
    chain.unshift(cur);
    cur = map.get(cur.parentId) || null;
  }
  return chain;
}

/** 收集当前数据源下全部去重后的可搜索书签（附完整目录路径），自动跳过根目录重复收藏副本。 */
export function collectSearchableBookmarks(tree: BuiltRoot): SearchableBookmark[] {
  const entries: SearchableBookmark[] = [];
  const seenUrls = new Set<string>();

  const walk = (folder: FolderNode, prefix: string) => {
    const path = prefix ? `${prefix} / ${folder.title}` : folder.title;
    for (const it of folder.items) {
      seenUrls.add(it.url);
      entries.push({ item: it, folderPath: path });
    }
    for (const child of folder.children) {
      walk(child, path);
    }
  };

  for (const top of tree.tops) {
    walk(top, '');
  }

  for (const it of tree.loose) {
    if (!seenUrls.has(it.url)) {
      entries.push({ item: it, folderPath: '未分组' });
    }
  }

  return entries;
}

/** 派生当前主视图数据（搜索态 / 我的收藏 / 阅读清单 / 三级分段 / 普通目录）。 */
export function computeNewtabView({
  tree,
  searchable,
  folderId,
  query,
  looseUrlSet,
  groupedUrlSet,
  aiHits = [],
}: {
  tree: BuiltRoot;
  searchable: SearchableBookmark[];
  folderId: string;
  query: string;
  looseUrlSet: Set<string>;
  groupedUrlSet: Set<string>;
  aiHits?: SemanticSearchHit[];
}): ComputedView {
  const q = query.trim();

  // 1. 全局搜索（模糊容错 + 拼音 + 目录路径，按相关度排序；有 AI 语义结果时优先置顶分组展示）
  if (q) {
    const localMatches = searchBookmarks(searchable, q);

    if (aiHits.length > 0) {
      const entryById = new Map(searchable.map((e) => [e.item.id, e]));
      const aiRows: ViewRow[] = [];
      const aiIdSet = new Set<string>();

      for (const hit of aiHits) {
        const entry = entryById.get(hit.id);
        if (!entry || aiIdSet.has(hit.id)) continue;
        aiIdSet.add(hit.id);
        aiRows.push({
          ...entry.item,
          kind: 'link',
          group: 'AI 语义匹配',
          subText: `${hit.reason} · ${entry.folderPath}`,
        });
      }

      const localRows: ViewRow[] = [];
      for (const m of localMatches) {
        if (aiIdSet.has(m.item.id)) continue;
        localRows.push({
          ...m.item,
          kind: 'link',
          group: '本地匹配',
          subText: m.item.host ? `${m.folderPath} · ${m.item.host}` : m.folderPath,
        });
      }

      const combined = [...aiRows, ...localRows];
      return {
        filter: 'search',
        rows: combined,
        group: true,
        crumb: [{ title: '搜索' }],
        hits: combined.length,
      };
    }

    const rows: ViewRow[] = localMatches.map((m) => ({
      ...m.item,
      kind: 'link',
      group: m.folderPath,
      subText: m.item.host ? `${m.folderPath} · ${m.item.host}` : m.folderPath,
    }));

    return {
      filter: 'search',
      rows,
      group: false,
      crumb: [{ title: '搜索' }],
      hits: rows.length,
    };
  }

  // 2. 我的收藏（纯根目录未分组项 + 按所属一级分组归类的收藏书签）
  if (folderId === '__favorites__') {
    const rows: ViewRow[] = [];
    for (const it of tree.loose) {
      if (!groupedUrlSet.has(it.url)) {
        rows.push({ ...it, kind: 'link', group: '未分组' });
      }
    }

    for (const top of tree.tops) {
      const hits: BookmarkItem[] = [];
      collectFolderItems(top, top.title, (it) => looseUrlSet.has(it.url), hits);
      for (const it of hits) {
        rows.push({ ...it, kind: 'link' });
      }
    }

    return { filter: 'folder', rows, group: rows.length > 0, crumb: [{ title: '我的收藏' }] };
  }

  // 3. 普通分组视图
  const activeFid = computeDefaultFolderId(tree, folderId);
  const folder = tree.folderMap.get(activeFid);
  if (!folder) {
    return { filter: 'folder', rows: [], group: false, crumb: [{ title: tree.rootName }] };
  }

  const crumb: CrumbEntry[] = getAncestorChain(folder.id, tree.folderMap).map((f) => ({
    title: f.title,
    folderId: f.id,
  }));

  if (READING_FOLDER_RE.test(folder.title) && folder.children.length === 0) {
    const rows: ViewRow[] = buildReadingRows(folder.items).map((it) => ({ ...it, kind: 'link' }));
    return { filter: 'folder', rows, group: rows.length > 0, reading: true, crumb };
  }

  if (folder.depth >= 2 && folder.children.length > 0) {
    const sections: ViewSection[] = [];
    const rows: ViewRow[] = [];

    if (folder.items.length > 0) {
      const items = folder.items.map((it) => ({ ...it, kind: 'link' as const, group: '' }));
      sections.push({ id: folder.id, title: '直属书签', editable: false, items });
      rows.push(...items);
    }

    for (const child of folder.children) {
      const tmp: BookmarkItem[] = [];
      collectFolderItems(child, '', null, tmp);
      const items = tmp.map((it) => ({ ...it, kind: 'link' as const }));
      sections.push({ id: child.id, title: child.title, editable: true, items });
      rows.push(...items);
    }

    return { filter: 'folder', rows, sections, group: false, crumb };
  }

  const rows: ViewRow[] = [
    ...folder.items.map((it) => ({ ...it, kind: 'link' as const, group: '' })),
    ...folder.children.map((c) => ({
      kind: 'folder' as const,
      id: c.id,
      title: c.title,
      count: c.totalCount,
    })),
  ];

  return {
    filter: 'folder',
    rows,
    group: false,
    splitSections: folder.items.length > 0 && folder.children.length > 0,
    crumb,
  };
}
