import { findNode, isLink } from './bookmarks.ts';
import type { BookmarkItem, FolderNode } from './types.ts';

/**
 * 基于「收藏夹栏根目录（loose）书签副本」的跨设备收藏机制：
 * - 收藏一个分组内的书签时，在数据源根目录（默认「收藏夹栏」）复制一份真实书签；
 * - 取消收藏时移除根目录副本（原分组内的书签保留）；
 * - 随浏览器书签 / iCloud 书签原生跨电脑、跨浏览器（含 Safari）自动同步，零额外存储与配置。
 */

function bookmarksApiReady(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.bookmarks?.getTree === 'function' &&
    typeof chrome.bookmarks?.create === 'function' &&
    typeof chrome.bookmarks?.remove === 'function'
  );
}

/** 收集所有子分组（不含根目录散装项）中的书签 URL 集合。 */
export function collectGroupedUrls(tops: FolderNode[]): Set<string> {
  const urls = new Set<string>();
  const walk = (folder: FolderNode) => {
    for (const it of folder.items) urls.add(it.url);
    for (const c of folder.children) walk(c);
  };
  for (const t of tops) walk(t);
  return urls;
}

/** 查找数据源根目录下的直接子书签（loose）中所有匹配该 URL 的节点。 */
function findRootCopies(
  rootNode: chrome.bookmarks.BookmarkTreeNode,
  url: string,
): chrome.bookmarks.BookmarkTreeNode[] {
  return (rootNode.children || []).filter((c) => isLink(c) && c.url === url);
}

/** 计算新收藏副本在根目录的插入位置：紧跟现有散装书签末尾、位于所有子文件夹之前。 */
export function rootCopyInsertIndex(rootNode: chrome.bookmarks.BookmarkTreeNode): number {
  const children = rootNode.children || [];
  const firstFolderIdx = children.findIndex((c) => !c.url);
  return firstFolderIdx >= 0 ? firstFolderIdx : children.length;
}

/** 将一条书签复制到数据源根目录作为「我的收藏」（若根目录已存在同 URL 则不重复创建）。 */
export async function addFavoriteCopyToRoot(
  rootId: string,
  item: { title: string; url: string },
): Promise<boolean> {
  if (!item.url || !bookmarksApiReady()) return false;
  try {
    const [treeRoot] = await chrome.bookmarks.getTree();
    const rootNode = findNode(treeRoot, rootId) || treeRoot?.children?.[0];
    if (!rootNode) return false;
    if (findRootCopies(rootNode, item.url).length > 0) return false;

    const index = rootCopyInsertIndex(rootNode);
    await chrome.bookmarks.create({
      parentId: rootNode.id,
      index,
      title: item.title,
      url: item.url,
    });
    return true;
  } catch {
    return false;
  }
}

/** 从数据源根目录移除指定 URL 的收藏副本。 */
export async function removeFavoriteCopyFromRoot(rootId: string, url: string): Promise<boolean> {
  if (!url || !bookmarksApiReady()) return false;
  try {
    const [treeRoot] = await chrome.bookmarks.getTree();
    const rootNode = findNode(treeRoot, rootId) || treeRoot?.children?.[0];
    if (!rootNode) return false;
    const copies = findRootCopies(rootNode, url);
    if (copies.length === 0) return false;
    for (const copy of copies) {
      await chrome.bookmarks.remove(copy.id);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 编辑书签标题或网址时，同步更新数据源内与原 URL 匹配的其余副本（如分组原件 <-> 根目录收藏副本）。
 */
export async function syncEditedBookmarkCopies(
  rootId: string,
  editedId: string,
  oldUrl: string,
  patch: { title?: string; url?: string },
): Promise<void> {
  if (!oldUrl || (!patch.title && !patch.url) || !bookmarksApiReady()) return;
  if (typeof chrome.bookmarks.update !== 'function') return;
  try {
    const [treeRoot] = await chrome.bookmarks.getTree();
    const rootNode = findNode(treeRoot, rootId) || treeRoot?.children?.[0];
    if (!rootNode) return;

    const matches: chrome.bookmarks.BookmarkTreeNode[] = [];
    const walk = (node: chrome.bookmarks.BookmarkTreeNode) => {
      for (const c of node.children || []) {
        if (isLink(c)) {
          if (c.id !== editedId && c.url === oldUrl) matches.push(c);
        } else if (!c.url) {
          walk(c);
        }
      }
    };
    walk(rootNode);

    for (const m of matches) {
      const updateArg: { title?: string; url?: string } = {};
      if (patch.title !== undefined && m.title !== patch.title) updateArg.title = patch.title;
      if (patch.url !== undefined && m.url !== patch.url) updateArg.url = patch.url;
      if (Object.keys(updateArg).length > 0) {
        await chrome.bookmarks.update(m.id, updateArg);
      }
    }
  } catch {
    /* 忽略 */
  }
}

/**
 * 一次性迁移老版本存在 chrome.storage.local 中的星标 ID：
 * 将不在根目录中的旧星标书签复制到数据源根目录，随后由调用方清空本地旧数组。
 */
export async function migrateLegacyLocalFavorites(
  rootId: string,
  legacyFavIds: string[],
  loose: BookmarkItem[],
  itemIndex: Map<string, { item: BookmarkItem; group: string }>,
): Promise<boolean> {
  if (!legacyFavIds.length || !bookmarksApiReady()) return false;
  const looseUrlSet = new Set(loose.map((it) => it.url));
  const toCopy: BookmarkItem[] = [];
  const seen = new Set<string>();

  for (const id of legacyFavIds) {
    const hit = itemIndex.get(id)?.item;
    if (!hit || looseUrlSet.has(hit.url) || seen.has(hit.url)) continue;
    seen.add(hit.url);
    toCopy.push(hit);
  }

  let copiedAny = false;
  for (const it of toCopy) {
    const ok = await addFavoriteCopyToRoot(rootId, { title: it.title, url: it.url });
    if (ok) copiedAny = true;
  }
  return copiedAny;
}
