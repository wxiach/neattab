import { READING_FOLDER_RE } from './storage.ts';
import type { ClassifierFolder, PageKind, UrlInfo } from './types.ts';

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

const GITHUB_RESERVED = new Set([
  'explore', 'settings', 'notifications', 'marketplace', 'pulls', 'issues', 'trending',
  'topics', 'search', 'login', 'signup', 'join', 'pricing', 'features', 'sponsors',
  'orgs', 'organizations', 'new', 'codespaces', 'copilot', 'enterprise', 'about',
]);

const GENERIC_LEFT_RE =
  /^(?:首页|主页|登录|登陆|门户|用户中心|个人中心|收件箱|工作台|控制台|欢迎|home|inbox|login|sign\s*in|dashboard)$/i;

const SITE_TAIL_NOISE_RE =
  /(?:^|[\s\u4e00-\u9fa5])(?:首页|主页|官方网站|官网|门户首页|登录|登陆|欢迎登录|干杯|bilibili|记录美好生活|发现新鲜事|有问题.*答案|你的生活.*(?:指南|社区)|创意工作者|人人都有|数字战斗力|玩家社区|在线文档|一站式|领先的|专业的|全球最大|official\s*site|home\s*page|sign\s*in|log\s*in|welcome)/i;

const CONTENT_SITE_SUFFIX_RE =
  /(?:_哔哩哔哩_bilibili|_bilibili|\s*[-–—|·]\s*(?:哔哩哔哩|V2EX|知乎|YouTube|Reddit|小红书|微博|抖音|NGA玩家社区|NGA|稀土掘金|掘金|少数派|虎嗅|36氪|博客园|CSDN博客|CSDN|思否|SegmentFault|简书|微信公众号|虎扑|百度贴吧|贴吧|GitHub))$/i;

const HOME_PATH_RE = /^\/(?:|home|explore|index(?:\.[a-z]+)?|discover|recommend|ys)\/?$/i;

function stripUnreadPrefix(s: string): string {
  let out = String(s || '').replace(/\s+/g, ' ').trim();
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/^\[\d+\+?\]\s*/, '')
      .replace(/^【\d+条?新消息】\s*/, '')
      .replace(/^[•·●★☆]\s+/, '')
      .trim();
  }
  return out;
}

function cleanCodeHostTitle(title: string, u: UrlInfo): string {
  const segs = (u.rawPathname || '/').split('/').filter(Boolean);
  if (u.host === 'github.com') {
    if (segs.length === 0) return 'GitHub';
    const first = segs[0].toLowerCase();
    if (!GITHUB_RESERVED.has(first)) {
      if (segs.length === 1) return `GitHub · ${segs[0]}`;
      const owner = segs[0];
      const repo = segs[1];
      if (segs.length === 2) return `${owner}/${repo}`;
      const third = segs[2].toLowerCase();
      if ((third === 'issues' || third === 'pull' || third === 'discussions') && /^\d+$/.test(segs[3] || '')) {
        const num = segs[3];
        const core = title
          .replace(/\s*·\s*GitHub$/i, '')
          .replace(
            new RegExp(
              `\\s*·\\s*${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              'i',
            ),
            '',
          )
          .replace(/\s*(?:by\s+\S+\s*)?·\s*(?:Issue|Pull Request|Discussion)\s*#\d+$/i, '')
          .trim();
        return core ? `${core} (#${num} · ${repo})` : `${owner}/${repo} #${num}`;
      }
      if (third === 'releases') return `Releases · ${repo}`;
      if ((third === 'blob' || third === 'tree') && segs.length >= 5) {
        return `${segs[segs.length - 1]} · ${repo}`;
      }
    }
    return title.replace(/^GitHub\s*[-–—·]\s*/i, '').replace(/\s*[-–—·]\s*GitHub$/i, '').trim() || 'GitHub';
  }

  if (u.host === 'gitee.com') {
    if (segs.length === 0) return 'Gitee';
    const first = segs[0].toLowerCase();
    if (segs.length === 2 && !GITHUB_RESERVED.has(first)) return `${segs[0]}/${segs[1]}`;
    return title.replace(/\s*[-–—·]\s*Gitee(?:\.com)?$/i, '').trim() || 'Gitee';
  }

  if (/gitlab/i.test(u.host) || /\s*[-–—·]\s*GitLab$/i.test(title)) {
    const stripped = title.replace(/\s*[-–—·]\s*GitLab$/i, '').trim();
    if (stripped.includes(' / ')) {
      const parts = stripped.split(/\s*\/\s*/).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return `${last} · GitLab`;
    }
    return stripped ? `${stripped} · GitLab` : 'GitLab';
  }

  return '';
}

export function cleanTitle(rawTitle: string, urlInfo?: UrlInfo | null, pageKind?: PageKind | null): string {
  const base = stripUnreadPrefix(rawTitle);
  const u: UrlInfo = urlInfo?.ok ? urlInfo : parseUrl('');
  if (!base) return u.host || '';

  if (u.ok) {
    const codeName = cleanCodeHostTitle(base, u);
    if (codeName) return codeName;
    if (u.host === 'mail.google.com' && /gmail/i.test(base)) return 'Gmail';
  }

  if (pageKind?.kind === 'content') {
    const stripped = base.replace(CONTENT_SITE_SUFFIX_RE, '').trim();
    return stripped.length >= 2 ? stripped : base;
  }

  if (/^哔哩哔哩\s*\(.*bilibili/i.test(base)) return '哔哩哔哩';

  const sepMatch =
    base.match(/^(.+?)\s+(?:[-–—|｜›])\s+(.+)$/) ||
    base.match(/^([\u4e00-\u9fa5A-Za-z0-9]{2,12})[-–—|｜](.{4,})$/);
  if (sepMatch) {
    const left = sepMatch[1].trim();
    const right = sepMatch[2].trim();
    if (GENERIC_LEFT_RE.test(left) && right.length >= 2 && right.length <= 18 && !SITE_TAIL_NOISE_RE.test(right)) {
      return right;
    }
    const isHome = HOME_PATH_RE.test(u.pathname || '/');
    const noisyTail =
      SITE_TAIL_NOISE_RE.test(right) || (isHome && (right.length >= 10 || /[!！，,。~～]/.test(right)));
    if (noisyTail && left.length >= 2 && !GENERIC_LEFT_RE.test(left)) {
      return left;
    }
  }

  return base;
}

export function buildFolders(rootNode: chrome.bookmarks.BookmarkTreeNode): ClassifierFolder[] {
  const list: ClassifierFolder[] = [
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
      if (subs.length) walk(child, depth + 1, pathLabel);
    }
  };
  walk(rootNode, 1, '');
  return list;
}

export function findReadingFolder(folders: ClassifierFolder[]): ClassifierFolder | null {
  return folders.find((f) => !f.isRoot && READING_FOLDER_RE.test(f.title)) || null;
}
