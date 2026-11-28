import type { AuditFolderSummary, BatchRenameInput, FolderAuditSuggestion } from './ai.ts';
import { isInsideFolder } from './bookmarks.ts';
import { collectGroupedUrls, syncEditedBookmarkCopies } from './favSync.ts';
import { exportRoot } from './transfer.ts';
import type { BookmarkItem, FolderNode } from './types.ts';

export interface ScopeOption {
  id: string;
  label: string;
  items: BatchRenameInput[];
}

export interface FlatFolderOption {
  id: string;
  pathLabel: string;
}

export interface BookmarkRenameChange {
  id: string;
  url: string;
  originalTitle: string;
  nextTitle: string;
  originalFolderId: string;
  nextFolderId: string;
}

/** 扁平化收集所有子分组路径，供重归类下拉选择。 */
export function collectFlatFolders(tops: FolderNode[]): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];

  const walk = (folder: FolderNode, prefix: string) => {
    const pathLabel = prefix ? `${prefix} / ${folder.title}` : folder.title;
    out.push({ id: folder.id, pathLabel });
    for (const child of folder.children) {
      walk(child, pathLabel);
    }
  };

  for (const top of tops) {
    walk(top, '');
  }
  return out;
}

/** 收集用于全局目录体检的目录摘要信息。 */
export function collectAuditFolders(tops: FolderNode[]): AuditFolderSummary[] {
  const out: AuditFolderSummary[] = [];

  const walk = (folder: FolderNode, prefix: string) => {
    const path = prefix ? `${prefix} / ${folder.title}` : folder.title;
    out.push({
      id: folder.id,
      parentId: folder.parentId,
      depth: folder.depth,
      title: folder.title,
      path,
      directCount: folder.items.length,
      totalCount: folder.totalCount,
      samples: folder.items.slice(0, 12).map((it) => ({
        id: it.id,
        title: it.title,
        host: it.host,
      })),
    });

    for (const child of folder.children) {
      walk(child, path);
    }
  };

  for (const top of tops) {
    walk(top, '');
  }
  return out;
}

/**
 * 构建批量整理的可选范围列表：
 * - 根目录中的收藏副本绝不纳入「全部书签」或「我的收藏」，防止被 AI 移出根目录导致丢失收藏。
 */
export function collectScopeItems(
  tops: FolderNode[],
  loose: BookmarkItem[],
  rootId: string,
  currentFolderId: string,
): ScopeOption[] {
  const options: ScopeOption[] = [];

  const walk = (folder: FolderNode, prefix: string, out: BatchRenameInput[]) => {
    const path = prefix ? `${prefix} / ${folder.title}` : folder.title;
    for (const it of folder.items) {
      out.push({ id: it.id, title: it.title, url: it.url, folderId: folder.id, folderPath: path });
    }
    for (const child of folder.children) {
      walk(child, path, out);
    }
  };

  const groupedItems: BatchRenameInput[] = [];
  for (const top of tops) {
    walk(top, '', groupedItems);
  }

  const groupedUrlSet = collectGroupedUrls(tops);
  const looseUrlSet = new Set(loose.map((it) => it.url));

  // 仅保留不在任何子分组中的纯未分组书签，跳过根目录收藏副本
  const pureLooseItems: BatchRenameInput[] = loose
    .filter((it) => !groupedUrlSet.has(it.url))
    .map((it) => ({ id: it.id, title: it.title, url: it.url, folderId: rootId, folderPath: '未分组' }));

  const allItems: BatchRenameInput[] = [...pureLooseItems, ...groupedItems];

  const favItems: BatchRenameInput[] = [
    ...pureLooseItems,
    ...groupedItems.filter((it) => looseUrlSet.has(it.url)),
  ];
  if (favItems.length > 0) {
    options.push({ id: '__favorites__', label: `我的收藏（${favItems.length} 条）`, items: favItems });
  }

  for (const top of tops) {
    const topItems: BatchRenameInput[] = [];
    walk(top, '', topItems);
    if (topItems.length > 0) {
      options.push({ id: top.id, label: `${top.title}（${topItems.length} 条）`, items: topItems });
    }

    for (const sub of top.children) {
      const subItems: BatchRenameInput[] = [];
      walk(sub, top.title, subItems);
      if (subItems.length > 0) {
        options.push({
          id: sub.id,
          label: `　${top.title} / ${sub.title}（${subItems.length} 条）`,
          items: subItems,
        });
      }
    }
  }

  options.push({ id: '__all__', label: `全部书签（${allItems.length} 条）`, items: allItems });

  const curIdx = options.findIndex((o) => o.id === currentFolderId);
  if (curIdx > 0) {
    const [cur] = options.splice(curIdx, 1);
    options.unshift({ ...cur, label: `当前分组 · ${cur.label}` });
  }
  return options;
}

/** 实时递归核验目录子树内已不含任何书签链接。 */
export async function isFolderTrulyEmpty(folderId: string): Promise<boolean> {
  try {
    const [node] = await chrome.bookmarks.getSubTree(folderId);
    if (!node) return false;

    const hasAnyLink = (n: chrome.bookmarks.BookmarkTreeNode): boolean => {
      if (n.url) return true;
      return (n.children || []).some(hasAnyLink);
    };
    return !hasAnyLink(node);
  } catch {
    return false;
  }
}

/** 批量应用书签重命名与可选重归类，并同步更新根目录收藏副本的标题。 */
export async function applyBookmarkRenames(
  rootId: string,
  changes: BookmarkRenameChange[],
  includeCategory: boolean,
): Promise<number> {
  let ok = 0;

  for (const row of changes) {
    const nextTitle = row.nextTitle.trim();
    if (!nextTitle) continue;

    if (nextTitle !== row.originalTitle) {
      await chrome.bookmarks.update(row.id, { title: nextTitle });
      await syncEditedBookmarkCopies(rootId, row.id, row.url, { title: nextTitle });
    }

    if (includeCategory && row.nextFolderId && row.nextFolderId !== row.originalFolderId) {
      await chrome.bookmarks.move(row.id, { parentId: row.nextFolderId });
    }

    ok += 1;
  }

  return ok;
}

/**
 * 批量执行全局目录体检建议：
 * - 执行前自动下载 JSON 备份（单元测试可传 skipBackup = true）；
 * - 按 新建/拆分 → 改名 → 安全合并 → 清理空目录 顺序执行，移除目录前二次校验为空。
 */
export async function applyFolderAudit(
  rootId: string,
  suggestions: FolderAuditSuggestion[],
  favorites: string[],
  skipBackup = false,
): Promise<number> {
  if (suggestions.length === 0) return 0;

  if (!skipBackup) {
    try {
      await exportRoot(rootId, favorites);
    } catch {
      /* 下载提示被拦截时不阻断已确认的操作 */
    }
  }

  let ok = 0;

  // 1. 新建或拆分目录，并迁入指定书签
  for (const act of suggestions) {
    if (act.type !== 'create' || !act.newName) continue;

    const created = await chrome.bookmarks.create({
      parentId: act.parentId || rootId,
      title: act.newName,
    });
    for (const bid of act.moveBookmarkIds || []) {
      try {
        await chrome.bookmarks.move(bid, { parentId: created.id });
      } catch {
        /* 忽略已被移动或删除的节点 */
      }
    }
    ok += 1;
  }

  // 2. 目录改名
  for (const act of suggestions) {
    if (act.type !== 'rename' || !act.folderId || !act.newName) continue;
    try {
      await chrome.bookmarks.update(act.folderId, { title: act.newName });
      ok += 1;
    } catch {
      /* 忽略失效节点 */
    }
  }

  // 3. 安全合并：先迁出源目录全部子节点，二次复核为空后再移除旧目录
  for (const act of suggestions) {
    if (act.type !== 'merge' || !act.sourceId || !act.targetId || act.sourceId === act.targetId) {
      continue;
    }
    if (await isInsideFolder(act.targetId, act.sourceId)) continue;

    try {
      const [srcNode] = await chrome.bookmarks.getSubTree(act.sourceId);
      for (const child of srcNode?.children || []) {
        await chrome.bookmarks.move(child.id, { parentId: act.targetId });
      }
      if (await isFolderTrulyEmpty(act.sourceId)) {
        await chrome.bookmarks.removeTree(act.sourceId);
      }
      ok += 1;
    } catch {
      /* 忽略失效节点 */
    }
  }

  // 4. 清理空目录：逐一二次复核为空才删除
  for (const act of suggestions) {
    if (act.type !== 'delete_empty' || !act.folderId) continue;
    if (await isFolderTrulyEmpty(act.folderId)) {
      try {
        await chrome.bookmarks.removeTree(act.folderId);
        ok += 1;
      } catch {
        /* 忽略失效节点 */
      }
    }
  }

  return ok;
}
