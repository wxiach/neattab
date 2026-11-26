'use strict';

/**
 * NAV — 本地分类器纯逻辑模块（供 popup.js 与离线测试共用）
 * 包含：URL 解析与回复锚点清理、站点入口/内容页形态识别、本地 TF-IDF 朴素贝叶斯在线分类模型。
 */
(() => {
  const READING_FOLDER_RE = (window.NAV && window.NAV.READING_FOLDER_RE) || /阅读|稍后|待看|文章|帖子|read\s*later|reading|inbox/i;

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

  const CONCEPT_LEXICON = [
    ['sem:test_env', /\b(uat|sit|staging|sandbox|test|qa|preprod)\b|测试|预发|联调|验收/i, 3.8],
    ['sem:prod_env', /\b(erp|oa|sso|portal|prod|ierp)\b|正式|生产|门户|集团|企业邮箱/i, 3.2],
    ['sem:dev_ops', /\b(gitlab|github|gitee|jenkins|k8s|docker|devops|developer|dev|sdk|api|console|cloud|admin)\b|开发|运维|云原生|代码|管理中心/i, 3.0],
    ['sem:docs_flow', /\b(kdocs|docs\.qq|feishu|notion|yuque|confluence|wiki|sheet|ticket|form)\b|文档|清单|申请表|审批|流程|工单|常见问题|配置/i, 3.0],
    ['sem:community', /\b(v2ex|nga|reddit|twitter|x\.com|youtube|bilibili|xiaohongshu|weibo|douyin|zhihu|tieba|linux|forum|bbs)\b|摸鱼|社区|玩家|论坛|视频|微博|抖音|小红书|哔哩/i, 3.6],
    ['sem:tool', /\b(copilot|meeting|calc|convert|translate|query|tool)\b|工具|会议|预约|查询/i, 3.0],
    ['sem:personal', /\b(gmail|mail\.google|clientarea|blog|me|profile)\b|个人|用户中心|邮箱|博客/i, 2.8],
  ];

  const CONCEPT_LABELS = {
    test_env: '测试环境语义',
    prod_env: '生产系统语义',
    dev_ops: '开发运维语义',
    docs_flow: '文档流程语义',
    community: '社区娱乐语义',
    tool: '实用工具语义',
    personal: '个人常用语义',
  };

  function parseUrl(raw) {
    try {
      const u = new URL(raw);
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
        raw,
        cleanUrl: trimHash ? `${u.origin}${u.pathname}${u.search}` : raw,
        trimHash,
        origin: u.origin.toLowerCase(),
        host,
        port: u.port || '',
        base,
        sub,
        isIp,
        pathname: u.pathname.toLowerCase(),
        search: u.search.toLowerCase(),
        path: `${u.pathname}${u.search}${u.hash}`.toLowerCase(),
      };
    } catch {
      return { ok: false, raw: '', cleanUrl: '', trimHash: '', origin: '', host: '', port: '', base: '', sub: '', isIp: false, pathname: '', search: '', path: '' };
    }
  }

  function detectPageKind(u) {
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

  const addFeat = (map, key, w) => map.set(key, (map.get(key) || 0) + w);

  function extractFeatures(urlStr, title) {
    const feats = new Map();
    const u = urlStr ? parseUrl(urlStr) : { ok: false };

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

  function describeFeature(key) {
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

  function buildFolders(rootNode) {
    const list = [
      {
        id: rootNode.id,
        title: (rootNode.title || '收藏夹栏').trim(),
        pathLabel: `${(rootNode.title || '收藏夹栏').trim()}（根目录）`,
        depth: 0,
        isRoot: true,
        items: (rootNode.children || []).filter((c) => c.url && !/^javascript:/i.test(c.url)),
      },
    ];
    const walk = (node, depth, prefix) => {
      for (const child of node.children || []) {
        if (child.url) continue;
        const title = (child.title || '未命名').trim();
        const pathLabel = prefix ? `${prefix} / ${title}` : title;
        const direct = (child.children || []).filter((c) => c.url && !/^javascript:/i.test(c.url));
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

  const findReadingFolder = (folders) => folders.find((f) => !f.isRoot && READING_FOLDER_RE.test(f.title)) || null;

  function trainLocalModel(folders, feedbackSamples) {
    const classes = folders.filter((f) => !f.isRoot);
    const classMap = new Map();
    const docFreq = new Map();

    for (const f of classes) {
      classMap.set(f.id, { folder: f, counts: new Map(), docCount: 0, weightedSum: 0, norm: 1 });
    }

    const ingest = (folderId, feats, sampleWeight, isDoc) => {
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
      for (const it of f.items) ingest(f.id, extractFeatures(it.url, it.title), 1.0, true);
    }

    if (Array.isArray(feedbackSamples)) {
      for (const fb of feedbackSamples) {
        if (!fb || !fb.folderId || !classMap.has(fb.folderId)) continue;
        ingest(fb.folderId, extractFeatures(fb.url, fb.title), fb.corrected ? 2.6 : 1.3, true);
      }
    }

    const numClasses = Math.max(classes.length, 1);
    for (const cls of classMap.values()) {
      for (const k of cls.counts.keys()) docFreq.set(k, (docFreq.get(k) || 0) + 1);
    }

    const idf = new Map();
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

    function predict(urlStr, title, lastFolderId) {
      if (classes.length === 0) return { best: folders[0] || null, confidence: 0, reason: '默认分组', candidates: [] };

      const feats = extractFeatures(urlStr, title);
      let queryNormSq = 0;
      const qWeighted = new Map();
      for (const [k, w] of feats) {
        const tw = w * (idf.get(k) || 1);
        qWeighted.set(k, tw);
        queryNormSq += tw * tw;
      }
      const queryNorm = Math.sqrt(queryNormSq) || 1;

      const results = [];
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
        const score = nbDelta * 0.28 + cosine * 6.0 + prior * 0.12 + (cls.folder.depth === 2 ? 0.15 : 0);
        results.push({ folder: cls.folder, score, topFeatKey });
      }

      if (!results.length) {
        const last = folders.find((f) => f.id === lastFolderId);
        if (last) return { best: last, confidence: 0, reason: '冷启动 · 上次分组', candidates: [last] };
        const fallback = classes.find((f) => !f.hasChildren) || classes[0] || folders[0];
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

  window.NAV = window.NAV || {};
  window.NAV.classifier = { parseUrl, detectPageKind, buildFolders, findReadingFolder, trainLocalModel };
})();
