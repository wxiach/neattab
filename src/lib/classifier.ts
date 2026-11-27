import { READING_FOLDER_RE } from './storage.ts';
import type { ClassifierFolder, FeedbackSample, PageKind, UrlInfo } from './types.ts';

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

const PATH_STOP = new Set(['index', 'html', 'htm', 'php', 'jsp', 'aspx', 'home', 'page', 'login', 'auth']);
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

const CONCEPT_LEXICON: ReadonlyArray<[string, RegExp, number]> = [
  ['sem:test_env', /\b(uat|sit|staging|sandbox|test|qa|preprod)\b|测试|预发|联调|验收/i, 3.8],
  ['sem:prod_env', /\b(erp|oa|sso|portal|prod|ierp)\b|正式|生产|门户|集团|企业邮箱/i, 3.2],
  ['sem:dev_ops', /\b(gitlab|github|gitee|jenkins|k8s|docker|devops|developer|dev|sdk|api|console|cloud|admin)\b|开发|运维|云原生|代码|管理中心/i, 3.0],
  ['sem:docs_flow', /\b(kdocs|docs\.qq|feishu|notion|yuque|confluence|wiki|sheet|ticket|form)\b|文档|清单|申请表|审批|流程|工单|常见问题|配置/i, 3.0],
  ['sem:community', /\b(v2ex|nga|reddit|twitter|x\.com|youtube|bilibili|xiaohongshu|weibo|douyin|zhihu|tieba|linux|forum|bbs)\b|摸鱼|社区|玩家|论坛|视频|微博|抖音|小红书|哔哩/i, 3.6],
  ['sem:tool', /\b(copilot|meeting|calc|convert|translate|query|tool)\b|工具|会议|预约|查询/i, 3.0],
  ['sem:personal', /\b(gmail|mail\.google|clientarea|blog|me|profile)\b|个人|用户中心|邮箱|博客/i, 2.8],
];

const CONCEPT_LABELS: Record<string, string> = {
  test_env: '测试环境语义',
  prod_env: '生产系统语义',
  dev_ops: '开发运维语义',
  docs_flow: '文档流程语义',
  community: '社区娱乐语义',
  tool: '实用工具语义',
  personal: '个人常用语义',
};

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

const addFeat = (map: Map<string, number>, key: string, w: number) => map.set(key, (map.get(key) || 0) + w);

function extractFeatures(urlStr: string, title: string): Map<string, number> {
  const feats = new Map<string, number>();
  const u = urlStr ? parseUrl(urlStr) : parseUrl('');

  if (u.ok) {
    addFeat(feats, `org:${u.origin}`, 4.5);
    addFeat(feats, `host:${u.host}`, 2.6);
    if (u.port) addFeat(feats, `port:${u.port}`, 2.4);
    if (!u.isIp && u.base) addFeat(feats, `base:${u.base}`, 2.4);
    if (u.sub) {
      for (const s of u.sub.split('.')) if (s.length >= 2) addFeat(feats, `sub:${s}`, 1.6);
    }
    for (const m of u.path.matchAll(/[a-z][a-z0-9_-]{1,20}/g)) {
      if (!PATH_STOP.has(m[0])) addFeat(feats, `path:${m[0]}`, 0.9);
    }
  }

  const rawTitle = (title || '').toLowerCase();
  for (const m of rawTitle.matchAll(/[a-z0-9]{2,20}/g)) addFeat(feats, `en:${m[0]}`, 1.8);
  for (const m of rawTitle.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const seg = m[0];
    for (let i = 0; i < seg.length - 1; i += 1) addFeat(feats, `zh2:${seg.slice(i, i + 2)}`, 1.1);
    for (let i = 0; i < seg.length - 2; i += 1) addFeat(feats, `zh3:${seg.slice(i, i + 3)}`, 1.2);
  }

  const combined = `${rawTitle} ${u.host || ''} ${u.path || ''}`;
  for (const [concept, re, w] of CONCEPT_LEXICON) {
    if (re.test(combined)) addFeat(feats, concept, w);
  }
  return feats;
}

function describeFeature(key: string): string {
  const sep = key.indexOf(':');
  const kind = sep > 0 ? key.slice(0, sep) : '';
  const val = sep > 0 ? key.slice(sep + 1) : key;
  if (kind === 'org') return `同站点 ${val.replace(/^https?:\/\//, '')}`;
  if (kind === 'host') return `同域名 ${val}`;
  if (kind === 'port') return `同端口 :${val}`;
  if (kind === 'base') return `同主域 ${val}`;
  if (kind === 'sub') return `子域「${val}」`;
  if (kind === 'sem') return CONCEPT_LABELS[val] || '语义特征';
  if (kind === 'en' || kind === 'zh2' || kind === 'zh3') return `词特征「${val}」`;
  if (kind === 'path') return `路径「${val}」`;
  return val;
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

export interface LocalPrediction {
  best: ClassifierFolder | null;
  confidence: number;
  reason: string;
  candidates: ClassifierFolder[];
}

export function trainLocalModel(folders: ClassifierFolder[], feedbackSamples: FeedbackSample[] = []) {
  const classes = folders.filter((f) => !f.isRoot);
  interface ClassStats {
    folder: ClassifierFolder;
    counts: Map<string, number>;
    docCount: number;
    weightedSum: number;
    norm: number;
  }
  const classMap = new Map<string, ClassStats>();
  const docFreq = new Map<string, number>();

  for (const f of classes) {
    classMap.set(f.id, { folder: f, counts: new Map(), docCount: 0, weightedSum: 0, norm: 1 });
  }

  const ingest = (folderId: string, feats: Map<string, number>, sampleWeight: number, isDoc: boolean) => {
    const cls = classMap.get(folderId);
    if (!cls || feats.size === 0) return;
    if (isDoc) cls.docCount += sampleWeight;
    for (const [k, w] of feats) {
      cls.counts.set(k, (cls.counts.get(k) || 0) + w * sampleWeight);
    }
  };

  for (const f of classes) {
    const parts = f.title.split(/[与和、\s\-_/·]+/).filter(Boolean);
    ingest(f.id, extractFeatures('', `${f.title} ${parts.join(' ')}`), 2.4, false);
    for (const it of f.items) ingest(f.id, extractFeatures(it.url || '', it.title || ''), 1.0, true);
  }

  for (const fb of feedbackSamples) {
    if (!fb?.folderId || !classMap.has(fb.folderId)) continue;
    ingest(fb.folderId, extractFeatures(fb.url, fb.title), fb.corrected ? 2.6 : 1.3, true);
  }

  const numClasses = Math.max(classes.length, 1);
  for (const cls of classMap.values()) {
    for (const k of cls.counts.keys()) docFreq.set(k, (docFreq.get(k) || 0) + 1);
  }

  const idf = new Map<string, number>();
  const vocabSize = Math.max(docFreq.size, 1);
  for (const [k, df] of docFreq) idf.set(k, Math.log((numClasses + 1) / (df + 1)) + 1);

  let totalDocs = 0;
  for (const cls of classMap.values()) {
    totalDocs += cls.docCount;
    let weightedSum = 0;
    let sqSum = 0;
    for (const [k, raw] of cls.counts) {
      const tw = raw * (idf.get(k) || 1);
      weightedSum += tw;
      sqSum += tw * tw;
    }
    cls.weightedSum = weightedSum;
    cls.norm = Math.sqrt(sqSum) || 1;
  }

  const alpha = 0.35;

  function predict(urlStr: string, title: string, lastFolderId = ''): LocalPrediction {
    if (classes.length === 0) {
      return { best: folders[0] || null, confidence: 0, reason: '默认分组', candidates: [] };
    }

    const feats = extractFeatures(urlStr, title);
    let queryNormSq = 0;
    const qWeighted = new Map<string, number>();
    for (const [k, w] of feats) {
      const tw = w * (idf.get(k) || 1);
      qWeighted.set(k, tw);
      queryNormSq += tw * tw;
    }
    const queryNorm = Math.sqrt(queryNormSq) || 1;

    const results: Array<{ folder: ClassifierFolder; score: number; topFeatKey: string }> = [];
    for (const cls of classMap.values()) {
      let matched = 0;
      let dot = 0;
      let nbDelta = 0;
      let topFeatKey = '';
      let topFeatGain = 0;
      const denom = cls.weightedSum + alpha * vocabSize;
      const baseLog = Math.log(alpha / denom);

      for (const [k, qtw] of qWeighted) {
        const raw = cls.counts.get(k) || 0;
        if (raw <= 0) continue;
        matched += 1;
        const ctw = raw * (idf.get(k) || 1);
        dot += qtw * ctw;
        const gain = qtw * (Math.log((ctw + alpha) / denom) - baseLog);
        nbDelta += gain;
        if (gain > topFeatGain) {
          topFeatGain = gain;
          topFeatKey = k;
        }
      }
      if (!matched) continue;

      const cosine = dot / (queryNorm * cls.norm);
      const prior = Math.log(Math.sqrt(cls.docCount + 1) / Math.sqrt(totalDocs + numClasses));
      const leafBonus = !cls.folder.hasChildren && cls.folder.depth >= 2 ? 0.15 : 0;
      const score = nbDelta * 0.28 + cosine * 6.0 + prior * 0.12 + leafBonus;
      results.push({ folder: cls.folder, score, topFeatKey });
    }

    if (!results.length) {
      const last = folders.find((f) => f.id === lastFolderId);
      if (last) return { best: last, confidence: 0, reason: '冷启动 · 上次分组', candidates: [last] };
      const fallback = classes.find((f) => !f.hasChildren) || classes[0] || folders[0] || null;
      return { best: fallback, confidence: 0, reason: '冷启动 · 默认分组', candidates: fallback ? [fallback] : [] };
    }

    results.sort((a, b) => b.score - a.score);
    const maxS = results[0].score;
    const exps = results.map((r) => Math.exp(Math.max(-20, (r.score - maxS) * 1.15)));
    const expSum = exps.reduce((a, b) => a + b, 0) || 1;
    const confidence = Math.min(99, Math.max(25, Math.round((exps[0] / expSum) * 100)));
    const top = results[0];

    return {
      best: top.folder,
      confidence,
      reason: `${top.topFeatKey ? describeFeature(top.topFeatKey) : '综合特征匹配'} · ${confidence}%`,
      candidates: results.slice(0, 3).map((r) => r.folder),
    };
  }

  return { predict };
}
