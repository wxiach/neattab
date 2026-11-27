import { findNode, hostOf, isHttpUrl, isLink } from './bookmarks.ts';
import { hasExt } from './storage.ts';
import type { ExportBookmark, ExportData, ExportFolder } from './types.ts';

function dateStamp(withTime = false): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  if (!withTime) return day;
  return `${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function exportFolder(node: chrome.bookmarks.BookmarkTreeNode, depth: number): ExportFolder {
  const items: ExportBookmark[] = [];
  const children: ExportFolder[] = [];
  for (const c of node.children || []) {
    if (isLink(c)) items.push({ title: (c.title || '').trim() || hostOf(c.url), url: c.url });
    else if (!c.url) children.push(exportFolder(c, depth + 1));
  }
  const out: ExportFolder = { title: (node.title || '未命名').trim(), items };
  if (depth === 1 || children.length > 0) out.children = children;
  return out;
}

export function buildExportData(
  rootNode: chrome.bookmarks.BookmarkTreeNode,
  favoriteIds: string[],
): ExportData {
  const favIdSet = new Set(Array.isArray(favoriteIds) ? favoriteIds : []);
  const favorites: string[] = [];
  const seenFav = new Set<string>();
  const record = (node: chrome.bookmarks.BookmarkTreeNode) => {
    if (isLink(node) && favIdSet.has(node.id) && !seenFav.has(node.url)) {
      seenFav.add(node.url);
      favorites.push(node.url);
    }
    for (const c of node.children || []) record(c);
  };
  record(rootNode);

  const loose: ExportBookmark[] = [];
  const folders: ExportFolder[] = [];
  for (const child of rootNode.children || []) {
    if (isLink(child)) {
      loose.push({ title: (child.title || '').trim() || hostOf(child.url), url: child.url });
      continue;
    }
    if (child.url) continue;
    folders.push(exportFolder(child, 1));
  }

  return {
    version: 1,
    root: (rootNode.title || '收藏夹栏').trim(),
    exportedAt: new Date().toISOString(),
    favorites,
    loose,
    folders,
  };
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportRoot(rootId: string, favoriteIds: string[]): Promise<ExportData> {
  if (!hasExt) throw new Error('当前非扩展环境，无法读取书签');
  const [treeRoot] = await chrome.bookmarks.getTree();
  const rootNode = findNode(treeRoot, rootId) || (treeRoot.children || [])[0];
  if (!rootNode) throw new Error('未找到数据源目录');
  const data = buildExportData(rootNode, favoriteIds);
  downloadJson(data, `neattab-bookmarks-${dateStamp(false)}.json`);
  return data;
}

export function extractJsonText(raw: string): string {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  return text;
}

export interface ParsedImportFolder {
  title: string;
  items: ExportBookmark[];
  children: ParsedImportFolder[];
}

export interface ParsedImportData {
  loose: ExportBookmark[];
  folders: ParsedImportFolder[];
  favorites: string[];
  hasFavorites: boolean;
}

export interface ParseImportStats {
  topCount: number;
  subCount: number;
  itemCount: number;
  favCount: number;
  skipped: number;
}

export type ParseImportResult =
  | { ok: true; data: ParsedImportData; stats: ParseImportStats }
  | { ok: false; error: string };

export function parseImportText(rawText: string): ParseImportResult {
  const cleaned = extractJsonText(rawText);
  if (!cleaned) return { ok: false, error: '请选择文件或粘贴 JSON 内容' };

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'JSON 解析失败，请检查格式是否完整' };
  }

  const obj = (Array.isArray(raw) ? { folders: raw } : raw) as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'JSON 根节点必须是对象或分组数组' };

  let skipped = 0;
  const normItem = (it: unknown): ExportBookmark | null => {
    const rec = it as Record<string, unknown> | null;
    if (!rec || typeof rec !== 'object' || !isHttpUrl(String(rec.url || ''))) {
      skipped += 1;
      return null;
    }
    const url = String(rec.url).trim();
    const title = String(rec.title || '').trim() || hostOf(url) || url;
    return { title, url };
  };

  const loose: ExportBookmark[] = [];
  for (const it of Array.isArray(obj.loose) ? obj.loose : []) {
    const clean = normItem(it);
    if (clean) loose.push(clean);
  }

  const folders: ParsedImportFolder[] = [];
  let subCount = 0;
  let itemCount = loose.length;

  const parseFolder = (node: unknown, depth: number): ParsedImportFolder | null => {
    const rec = node as Record<string, unknown> | null;
    if (!rec || typeof rec !== 'object') return null;
    const title = String(rec.title || '').trim() || '未命名';
    const items: ExportBookmark[] = [];
    for (const it of Array.isArray(rec.items) ? rec.items : []) {
      const clean = normItem(it);
      if (clean) items.push(clean);
    }
    const children: ParsedImportFolder[] = [];
    for (const ch of Array.isArray(rec.children) ? rec.children : []) {
      const sub = parseFolder(ch, depth + 1);
      if (sub) children.push(sub);
    }
    if (depth >= 2) subCount += 1;
    itemCount += items.length;
    return { title, items, children };
  };

  for (const f of Array.isArray(obj.folders) ? obj.folders : []) {
    const top = parseFolder(f, 1);
    if (top) folders.push(top);
  }

  const hasFavorites = Array.isArray(obj.favorites);
  const favorites: string[] = [];
  const favSeen = new Set<string>();
  for (const u of hasFavorites ? (obj.favorites as unknown[]) : []) {
    if (typeof u === 'string' && isHttpUrl(u)) {
      const trimmed = u.trim();
      if (!favSeen.has(trimmed)) {
        favSeen.add(trimmed);
        favorites.push(trimmed);
      }
    }
  }

  if (itemCount === 0 && folders.length === 0) {
    return { ok: false, error: '未识别到有效的书签或分组（请检查 folders / loose 字段）' };
  }

  return {
    ok: true,
    data: { loose, folders, favorites, hasFavorites },
    stats: { topCount: folders.length, subCount, itemCount, favCount: favorites.length, skipped },
  };
}

function indexExistingBookmarks(
  node: chrome.bookmarks.BookmarkTreeNode,
  pool: Map<string, chrome.bookmarks.BookmarkTreeNode[]>,
  nonHttp: chrome.bookmarks.BookmarkTreeNode[],
): void {
  for (const c of node.children || []) {
    if (c.url && isHttpUrl(c.url)) {
      if (!pool.has(c.url)) pool.set(c.url, []);
      pool.get(c.url)!.push(c);
    } else if (c.url) {
      nonHttp.push(c);
    } else {
      indexExistingBookmarks(c, pool, nonHttp);
    }
  }
}

export type ImportResult =
  | { mode: 'append'; wrapTitle: string }
  | { mode: 'replace'; favorites: string[] };

export async function applyImport(
  rootId: string,
  parsedData: ParsedImportData,
  mode: 'replace' | 'append',
  currentFavorites: string[],
  skipDownload = false,
): Promise<ImportResult> {
  const extReady = typeof chrome !== 'undefined' && Boolean(chrome.bookmarks);
  if (!extReady) throw new Error('当前非扩展环境，无法写入书签');
  const [treeRoot] = await chrome.bookmarks.getTree();
  const rootNode = findNode(treeRoot, rootId) || (treeRoot.children || [])[0];
  if (!rootNode) throw new Error('未找到目标目录');

  const createTree = async (
    parentId: string,
    folderList: ParsedImportFolder[],
    placeFn: (pid: string, it: ExportBookmark) => Promise<unknown>,
  ) => {
    for (const f of folderList) {
      const created = await chrome.bookmarks.create({ parentId, title: f.title });
      for (const it of f.items) await placeFn(created.id, it);
      if (f.children.length) await createTree(created.id, f.children, placeFn);
    }
  };

  if (mode === 'append') {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const wrapTitle = `导入整理 ${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const wrap = await chrome.bookmarks.create({ parentId: rootNode.id, title: wrapTitle });
    const createLink = (parentId: string, it: ExportBookmark) =>
      chrome.bookmarks.create({ parentId, title: it.title, url: it.url });
    for (const it of parsedData.loose) await createLink(wrap.id, it);
    await createTree(wrap.id, parsedData.folders, createLink);
    return { mode: 'append', wrapTitle };
  }

  const backup = buildExportData(rootNode, currentFavorites);
  if (!skipDownload && typeof document !== 'undefined') {
    downloadJson(backup, `neattab-backup-${dateStamp(true)}.json`);
  }

  const pool = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
  const preservedNonHttp: chrome.bookmarks.BookmarkTreeNode[] = [];
  indexExistingBookmarks(rootNode, pool, preservedNonHttp);

  const urlToId = new Map<string, string>();
  const placeItem = async (parentId: string, item: ExportBookmark) => {
    const queue = pool.get(item.url);
    let id = '';
    if (queue && queue.length) {
      const reused = queue.shift()!;
      await chrome.bookmarks.move(reused.id, { parentId });
      if ((reused.title || '') !== item.title) {
        await chrome.bookmarks.update(reused.id, { title: item.title });
      }
      id = reused.id;
    } else {
      const created = await chrome.bookmarks.create({ parentId, title: item.title, url: item.url });
      id = created.id;
    }
    if (!urlToId.has(item.url)) urlToId.set(item.url, id);
    return id;
  };

  const tmp = await chrome.bookmarks.create({ parentId: rootNode.id, title: '_neattab_import_tmp_' });
  for (const it of parsedData.loose) await placeItem(tmp.id, it);
  await createTree(tmp.id, parsedData.folders, placeItem);
  for (const special of preservedNonHttp) {
    await chrome.bookmarks.move(special.id, { parentId: tmp.id });
  }

  const [treeAfterStage] = await chrome.bookmarks.getTree();
  const freshRoot = findNode(treeAfterStage, rootNode.id);
  for (const c of freshRoot?.children || []) {
    if (c.id === tmp.id) continue;
    if (c.url) await chrome.bookmarks.remove(c.id);
    else await chrome.bookmarks.removeTree(c.id);
  }

  const [treeBeforePromote] = await chrome.bookmarks.getTree();
  const freshTmp = findNode(treeBeforePromote, tmp.id);
  for (const c of freshTmp?.children || []) {
    await chrome.bookmarks.move(c.id, { parentId: rootNode.id });
  }
  await chrome.bookmarks.remove(tmp.id);

  const favUrls = parsedData.hasFavorites ? parsedData.favorites : backup.favorites;
  const restoredFavs: string[] = [];
  for (const url of favUrls) {
    const id = urlToId.get(url);
    if (id && !restoredFavs.includes(id)) restoredFavs.push(id);
  }
  if (chrome.storage?.local) {
    await chrome.storage.local.set({ favorites: restoredFavs, view: null, expanded: null });
  }
  return { mode: 'replace', favorites: restoredFavs };
}
