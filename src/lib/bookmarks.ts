import { canFavicon, hasExt } from './storage.ts';
import type { BookmarkItem, FolderNode } from './types.ts';

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isLink(node: chrome.bookmarks.BookmarkTreeNode | null | undefined): node is chrome.bookmarks.BookmarkTreeNode & { url: string } {
  return Boolean(node && node.url && !/^javascript:/i.test(node.url));
}

export function isHttpUrl(raw: string | undefined): boolean {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function findNode(
  node: chrome.bookmarks.BookmarkTreeNode | null | undefined,
  id: string,
): chrome.bookmarks.BookmarkTreeNode | null {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function countLinks(node: chrome.bookmarks.BookmarkTreeNode): number {
  let n = 0;
  for (const c of node.children || []) {
    if (c.url) n += 1;
    else n += countLinks(c);
  }
  return n;
}

export function faviconSrc(url: string): string {
  if (!canFavicon || !url) return '';
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;
}

export interface BuiltRoot {
  resolvedRootId: string;
  rootName: string;
  tops: FolderNode[];
  loose: BookmarkItem[];
  folderMap: Map<string, FolderNode>;
  itemIndex: Map<string, { item: BookmarkItem; group: string }>;
}

function itemOf(node: chrome.bookmarks.BookmarkTreeNode & { url: string }, group: string): BookmarkItem {
  return {
    id: node.id,
    title: (node.title || node.url || '').trim() || hostOf(node.url),
    url: node.url,
    host: hostOf(node.url),
    group,
    dateAdded: node.dateAdded || 0,
  };
}

export function buildRootTree(rootNode: chrome.bookmarks.BookmarkTreeNode): BuiltRoot {
  const folderMap = new Map<string, FolderNode>();
  const itemIndex = new Map<string, { item: BookmarkItem; group: string }>();

  const buildFolder = (
    node: chrome.bookmarks.BookmarkTreeNode,
    parentId: string,
    depth: number,
    topTitle: string,
  ): FolderNode => {
    const title = (node.title || '未命名').trim();
    const groupTitle = depth === 1 ? title : topTitle;
    const items: BookmarkItem[] = [];
    const children: FolderNode[] = [];
    let totalCount = 0;

    for (const c of node.children || []) {
      if (isLink(c)) {
        const it = itemOf(c, '');
        items.push(it);
        itemIndex.set(it.id, { item: it, group: groupTitle });
        totalCount += 1;
      } else if (!c.url) {
        const child = buildFolder(c, node.id, depth + 1, groupTitle);
        children.push(child);
        totalCount += child.totalCount;
      }
    }

    const folder: FolderNode = { id: node.id, title, parentId, depth, items, children, totalCount };
    folderMap.set(folder.id, folder);
    return folder;
  };

  const tops: FolderNode[] = [];
  const loose: BookmarkItem[] = [];
  for (const child of rootNode.children || []) {
    if (isLink(child)) {
      const it = itemOf(child, '');
      loose.push(it);
      itemIndex.set(it.id, { item: it, group: '未分组' });
      continue;
    }
    if (child.url) continue;
    tops.push(buildFolder(child, rootNode.id, 1, ''));
  }

  return {
    resolvedRootId: rootNode.id,
    rootName: (rootNode.title || '收藏夹').trim(),
    tops,
    loose,
    folderMap,
    itemIndex,
  };
}

export function collectFolderItems(
  folder: FolderNode,
  groupTitle: string,
  filterFn: ((it: BookmarkItem) => boolean) | null,
  out: BookmarkItem[],
): void {
  for (const it of folder.items) {
    if (!filterFn || filterFn(it)) out.push({ ...it, group: groupTitle });
  }
  for (const c of folder.children) {
    collectFolderItems(c, groupTitle, filterFn, out);
  }
}

export function formatAddedTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= todayStart) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= todayStart - 86400000) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildReadingRows(items: BookmarkItem[]): BookmarkItem[] {
  const sorted = [...items].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  const byHost = new Map<string, BookmarkItem[]>();
  for (const it of sorted) {
    const key = it.host || '其他站点';
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key)!.push({ ...it, group: key, subText: formatAddedTime(it.dateAdded) || key });
  }
  return [...byHost.values()].flat();
}

export interface RootOption {
  id: string;
  label: string;
  isTop: boolean;
}

export async function getRootOptions(): Promise<{ options: RootOption[]; firstId: string }> {
  if (!hasExt) return { options: [{ id: '1', label: '收藏夹栏', isTop: true }], firstId: '1' };
  try {
    const [treeRoot] = await chrome.bookmarks.getTree();
    const options: RootOption[] = [];
    for (const top of treeRoot.children || []) {
      options.push({
        id: top.id,
        label: `${top.title || '根目录'}（${countLinks(top)}）`,
        isTop: true,
      });
      for (const sub of top.children || []) {
        if (!sub.url) {
          options.push({
            id: sub.id,
            label: `　${sub.title || '未命名'}（${countLinks(sub)}）`,
            isTop: false,
          });
        }
      }
    }
    return { options, firstId: options[0]?.id || '1' };
  } catch {
    return { options: [{ id: '1', label: '收藏夹栏', isTop: true }], firstId: '1' };
  }
}

export async function isInsideFolder(targetId: string, folderId: string): Promise<boolean> {
  let cur: string | undefined = targetId;
  while (cur) {
    if (cur === folderId) return true;
    try {
      const nodes: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.get(cur);
      cur = nodes[0]?.parentId;
    } catch {
      return false;
    }
  }
  return false;
}

export async function countBookmarkDescendants(id: string): Promise<number> {
  try {
    const [node] = await chrome.bookmarks.getSubTree(id);
    let n = 0;
    const walk = (cur: chrome.bookmarks.BookmarkTreeNode) => {
      for (const c of cur.children || []) {
        n += 1;
        walk(c);
      }
    };
    walk(node);
    return n;
  } catch {
    return 0;
  }
}

export interface FolderSelectOption {
  id: string;
  label: string;
}

export async function getEditableFolderOptions(rootId: string, excludeId = ''): Promise<FolderSelectOption[]> {
  const out: FolderSelectOption[] = [];
  if (!hasExt) return out;
  try {
    const [treeRoot] = await chrome.bookmarks.getTree();
    const root = findNode(treeRoot, rootId) || (treeRoot.children || [])[0];
    if (!root) return out;
    out.push({ id: root.id, label: `${(root.title || '收藏夹栏').trim()}（根目录）` });
    const walk = (node: chrome.bookmarks.BookmarkTreeNode, depth: number) => {
      for (const c of node.children || []) {
        if (c.url || c.id === excludeId) continue;
        out.push({ id: c.id, label: `${'　'.repeat(depth)}${(c.title || '未命名').trim()}` });
        walk(c, depth + 1);
      }
    };
    walk(root, 1);
  } catch {
    /* 忽略 */
  }
  return out;
}

export async function moveBookmarkBefore(id: string, targetId: string): Promise<void> {
  const [src] = await chrome.bookmarks.get(id);
  const [dst] = await chrome.bookmarks.get(targetId);
  if (!src || !dst || dst.index == null) return;
  let index = dst.index;
  if (src.parentId === dst.parentId && src.index != null && src.index < dst.index) index += 1;
  await chrome.bookmarks.move(id, { parentId: dst.parentId, index });
}

export async function moveBookmarkRelative(
  id: string,
  targetId: string,
  position: 'before' | 'after',
): Promise<void> {
  if (!id || !targetId || id === targetId) return;
  const [src] = await chrome.bookmarks.get(id);
  const [dst] = await chrome.bookmarks.get(targetId);
  if (!src || !dst || dst.index == null || !dst.parentId) return;
  if (!src.url && (await isInsideFolder(dst.parentId, id))) return;
  const index = position === 'after' ? dst.index + 1 : dst.index;
  await chrome.bookmarks.move(id, { parentId: dst.parentId, index });
}
