import { findNode, hostOf, isLink } from './bookmarks.ts';
import { rootCopyInsertIndex } from './favSync.ts';

export type DuplicateScope = 'folder' | 'root';
export type DuplicateAction = 'delete' | 'restore_favorite';

export interface DuplicateEntry {
  id: string;
  title: string;
  url: string;
  folderId: string;
  folderPath: string;
  dateAdded: number;
  order: number;
}

export interface DuplicateGroup {
  key: string;
  scope: DuplicateScope;
  url: string;
  host: string;
  /** 该 URL 当前是否已存在于数据源根目录（「我的收藏」）。 */
  inRoot: boolean;
  /** 按建议保留优先级排序，首项为默认保留项（优先更早收藏时间）。 */
  entries: DuplicateEntry[];
  defaultKeepId: string;
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  groupCount: number;
  extraCount: number;
  restorableGroupCount: number;
}

export interface DuplicateCleanupAction {
  id: string;
  url: string;
  action: DuplicateAction;
}

export interface DuplicateCleanupResult {
  movedToFav: number;
  deleted: number;
}

function sortDuplicateEntries(entries: DuplicateEntry[]): DuplicateEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = a.dateAdded > 0 ? a.dateAdded : Number.POSITIVE_INFINITY;
    const bTime = b.dateAdded > 0 ? b.dateAdded : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.order - b.order;
  });
}

/**
 * 扫描数据源目录下的重复书签：
 * - 根目录 1 份 + 子分组 1 份属于「我的收藏」正常副本，不视为重复；
 * - 子分组中同 URL 出现 >= 2 份视为分组重复（若该 URL 当前不在根目录，可将多余副本移回根目录恢复收藏）；
 * - 根目录中同 URL 出现 >= 2 份视为根目录重复。
 */
export function scanDuplicateBookmarks(rootNode: chrome.bookmarks.BookmarkTreeNode): DuplicateScanResult {
  const rootLabel = `${rootNode.title || '收藏夹栏'}（根目录）`;
  const looseByUrl = new Map<string, DuplicateEntry[]>();
  const looseUrlSet = new Set<string>();
  const folderByUrl = new Map<string, DuplicateEntry[]>();
  let order = 0;

  for (const child of rootNode.children || []) {
    if (isLink(child)) {
      looseUrlSet.add(child.url);
      const list = looseByUrl.get(child.url) || [];
      list.push({
        id: child.id,
        title: child.title || hostOf(child.url) || child.url,
        url: child.url,
        folderId: rootNode.id,
        folderPath: rootLabel,
        dateAdded: child.dateAdded || 0,
        order: order++,
      });
      looseByUrl.set(child.url, list);
    }
  }

  const walkFolder = (node: chrome.bookmarks.BookmarkTreeNode, prefix: string) => {
    const name = node.title || '未命名分组';
    const path = prefix ? `${prefix} / ${name}` : name;
    for (const child of node.children || []) {
      if (isLink(child)) {
        const list = folderByUrl.get(child.url) || [];
        list.push({
          id: child.id,
          title: child.title || hostOf(child.url) || child.url,
          url: child.url,
          folderId: node.id,
          folderPath: path,
          dateAdded: child.dateAdded || 0,
          order: order++,
        });
        folderByUrl.set(child.url, list);
      } else if (!child.url) {
        walkFolder(child, path);
      }
    }
  };

  for (const child of rootNode.children || []) {
    if (!child.url) walkFolder(child, '');
  }

  const groups: DuplicateGroup[] = [];

  for (const [url, list] of folderByUrl) {
    if (list.length < 2) continue;
    const entries = sortDuplicateEntries(list);
    groups.push({
      key: `folder:${url}`,
      scope: 'folder',
      url,
      host: hostOf(url),
      inRoot: looseUrlSet.has(url),
      entries,
      defaultKeepId: entries[0].id,
    });
  }

  for (const [url, list] of looseByUrl) {
    if (list.length < 2) continue;
    const entries = sortDuplicateEntries(list);
    groups.push({
      key: `root:${url}`,
      scope: 'root',
      url,
      host: hostOf(url),
      inRoot: true,
      entries,
      defaultKeepId: entries[0].id,
    });
  }

  // 优先展示可移回「我的收藏」的分组重复项，其次其余分组重复，最后根目录重复
  const priority = (g: DuplicateGroup): number => {
    if (g.scope === 'folder' && !g.inRoot) return 0;
    if (g.scope === 'folder') return 1;
    return 2;
  };
  groups.sort((a, b) => priority(a) - priority(b));

  const extraCount = groups.reduce((acc, g) => acc + (g.entries.length - 1), 0);
  const restorableGroupCount = groups.filter((g) => g.scope === 'folder' && !g.inRoot).length;

  return {
    groups,
    groupCount: groups.length,
    extraCount,
    restorableGroupCount,
  };
}

function dedupApiReady(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.bookmarks?.getTree === 'function' &&
    typeof chrome.bookmarks?.move === 'function' &&
    typeof chrome.bookmarks?.remove === 'function'
  );
}

/**
 * 执行用户确认后的去重操作：
 * - restore_favorite：将多余副本移回数据源根目录（所有文件夹之前），恢复为「我的收藏」；
 *   若根目录已存在同 URL，则直接删除多余副本避免再次重复。
 * - delete：删除多余副本。
 */
export async function applyDuplicateCleanup(
  rootId: string,
  actions: DuplicateCleanupAction[],
): Promise<DuplicateCleanupResult> {
  if (!actions.length || !dedupApiReady()) return { movedToFav: 0, deleted: 0 };

  const [treeRoot] = await chrome.bookmarks.getTree();
  const rootNode = findNode(treeRoot, rootId) || treeRoot?.children?.[0];
  if (!rootNode) return { movedToFav: 0, deleted: 0 };

  const looseUrlSet = new Set<string>();
  for (const c of rootNode.children || []) {
    if (isLink(c)) looseUrlSet.add(c.url);
  }
  let insertIdx = rootCopyInsertIndex(rootNode);

  const seenIds = new Set<string>();
  let movedToFav = 0;
  let deleted = 0;

  for (const item of actions) {
    if (!item.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    if (item.action === 'restore_favorite') {
      if (item.url && !looseUrlSet.has(item.url)) {
        await chrome.bookmarks.move(item.id, { parentId: rootNode.id, index: insertIdx });
        insertIdx += 1;
        looseUrlSet.add(item.url);
        movedToFav += 1;
      } else {
        await chrome.bookmarks.remove(item.id);
        deleted += 1;
      }
    } else {
      await chrome.bookmarks.remove(item.id);
      deleted += 1;
    }
  }

  return { movedToFav, deleted };
}
