import { READING_FOLDER_RE } from './storage.ts';
import type { FlatFolder, PageKind, UrlInfo } from './types.ts';

const MULTI_TLD = new Set([
  'com.cn',
  'org.cn',
  'net.cn',
  'gov.cn',
  'edu.cn',
  'co.uk',
  'co.jp',
  'com.hk',
  'com.tw',
]);

const REPLY_HASH_RE = /^#(reply|comment|floor|post|msg|c|r)[-_]?\d+$/i;

const CONTENT_PATH_PATTERNS = [
  /^\/t\/\d+/i,
  /^\/(topic|thread|article|articles|post|posts|blog|archives|note|notes|news)\/[^/]+/i,
  /^\/p\/[a-z0-9_-]{4,}/i,
  /^\/question\/\d+/i,
  /^\/video\/(bv|av)[a-z0-9]+/i,
  /^\/watch$/i,
  /^\/r\/[^/]+\/comments\//i,
  /^\/[^/]+\/status\/\d+/i,
  /^\/explore\/[a-f0-9]{16,}/i,
  /^\/discovery\/item\//i,
  /^\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i,
  /^\/\d{4}\/\d{2}\//i,
  /read\.php/i,
];

const WORK_DOC_HOST_RE = /(kdocs\.cn|docs\.qq\.com|feishu\.cn|yuque\.com|notion\.so|confluence\.atlassian\.com)$/i;

export function parseUrl(raw: string | undefined): UrlInfo {
  try {
    const u = new URL(String(raw || ''));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

    let base = host;
    let sub = '';
    if (!isIp) {
      const parts = host.split('.');
      if (parts.length >= 3 && MULTI_TLD.has(parts.slice(-2).join('.'))) {
        base = parts.slice(-3).join('.');
        sub = parts.slice(0, -3).join('.');
      } else if (parts.length >= 2) {
        base = parts.slice(-2).join('.');
        sub = parts.slice(0, -2).join('.');
      }
    }

    const trimHash = REPLY_HASH_RE.test(u.hash) ? u.hash : '';
    return {
      ok: u.protocol === 'http:' || u.protocol === 'https:',
      raw: String(raw || ''),
      cleanUrl: trimHash ? `${u.origin}${u.pathname}${u.search}` : String(raw || ''),
      trimHash,
      origin: u.origin.toLowerCase(),
      host,
      port: u.port || '',
      base,
      sub,
      isIp,
      rawPathname: u.pathname || '/',
      pathname: u.pathname.toLowerCase(),
      search: u.search.toLowerCase(),
      path: `${u.pathname}${u.search}${u.hash}`.toLowerCase(),
    };
  } catch {
    return {
      ok: false,
      raw: '',
      cleanUrl: '',
      trimHash: '',
      origin: '',
      host: '',
      port: '',
      base: '',
      sub: '',
      isIp: false,
      rawPathname: '',
      pathname: '',
      search: '',
      path: '',
    };
  }
}

export function detectPageKind(u: UrlInfo | null | undefined): PageKind {
  if (!u || !u.ok) return { kind: 'site', label: '站点入口' };
  if (u.isIp || WORK_DOC_HOST_RE.test(u.host)) return { kind: 'site', label: '系统 / 文档' };

  const isYoutube = u.pathname === '/watch' && /[?&]v=/.test(u.search);
  const isNga = /read\.php/i.test(u.pathname) && /[?&]tid=/.test(u.search);
  const hit = CONTENT_PATH_PATTERNS.some((re) => {
    if (re.source === '^\\/watch$') return isYoutube;
    if (re.source === 'read\\.php') return isNga;
    return re.test(u.pathname);
  });
  return hit ? { kind: 'content', label: '内容 / 帖子' } : { kind: 'site', label: '站点入口' };
}

export function buildFolders(rootNode: chrome.bookmarks.BookmarkTreeNode): FlatFolder[] {
  const list: FlatFolder[] = [
    {
      id: rootNode.id,
      title: (rootNode.title || '收藏夹栏').trim(),
      pathLabel: `${(rootNode.title || '收藏夹栏').trim()}（根目录）`,
      depth: 0,
      isRoot: true,
      items: (rootNode.children || []).filter((c) => Boolean(c.url) && !/^javascript:/i.test(c.url || '')),
    },
  ];

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, depth: number, prefix: string) => {
    for (const child of node.children || []) {
      if (child.url) continue;
      const title = (child.title || '未命名').trim();
      const pathLabel = prefix ? `${prefix} / ${title}` : title;
      const direct = (child.children || []).filter((c) => Boolean(c.url) && !/^javascript:/i.test(c.url || ''));
      const subs = (child.children || []).filter((c) => !c.url);
      list.push({
        id: child.id,
        title,
        parentTitle: prefix,
        pathLabel,
        depth,
        hasChildren: subs.length > 0,
        items: direct,
      });
      if (subs.length > 0) walk(child, depth + 1, pathLabel);
    }
  };

  walk(rootNode, 1, '');
  return list;
}

export function findReadingFolder(folders: FlatFolder[]): FlatFolder | null {
  return folders.find((f) => !f.isRoot && READING_FOLDER_RE.test(f.title)) || null;
}
