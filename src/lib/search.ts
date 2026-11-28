import { pinyin } from 'pinyin-pro';
import type { BookmarkItem } from './types.ts';

export interface SearchableBookmark {
  item: BookmarkItem;
  /** 完整所属目录路径（如「开发 / 前端 / 组件库」或「未分组」）。 */
  folderPath: string;
}

export interface SearchMatch {
  item: BookmarkItem;
  folderPath: string;
  score: number;
}

interface PinyinForms {
  full: string;
  initials: string;
  syllables: string[];
}

const CJK_RE = /[\u4e00-\u9fff]/;
const ASCII_TOKEN_RE = /^[a-z0-9]+$/;
const pinyinCache = new Map<string, PinyinForms>();

/** 提取文本的拼音全拼、首字母与音节数组，按文本缓存避免重复计算。 */
function getPinyinForms(text: string): PinyinForms {
  if (!text || !CJK_RE.test(text)) {
    return { full: '', initials: '', syllables: [] };
  }

  const cached = pinyinCache.get(text);
  if (cached) return cached;

  const rawSyllables = pinyin(text, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  });

  const syllables: string[] = [];
  let initials = '';

  for (const part of rawSyllables) {
    const clean = part.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) continue;
    syllables.push(clean);
    initials += clean[0];
  }

  const forms: PinyinForms = {
    full: syllables.join(''),
    initials,
    syllables,
  };
  pinyinCache.set(text, forms);
  return forms;
}

/**
 * 提取文本中的英文/数字词列表（保留驼峰切分，如 GitHub -> ['github', 'git', 'hub']，OpenAI -> ['openai', 'open', 'ai']）。
 */
function extractAsciiWords(rawText: string): string[] {
  const words: string[] = [];
  const rawChunks = rawText.match(/[A-Za-z0-9]+/g) || [];

  for (const chunk of rawChunks) {
    const lower = chunk.toLowerCase();
    words.push(lower);

    // 拆分驼峰词段（如 GitHub -> git, hub；OpenAI -> open, ai）
    const camelParts = chunk.match(/[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[0-9]+/g);
    if (camelParts && camelParts.length > 1) {
      for (const p of camelParts) {
        const pl = p.toLowerCase();
        if (pl !== lower) words.push(pl);
      }
    }
  }

  return words;
}

/**
 * 计算 Damerau-Levenshtein 编辑距离（支持替换、插入、删除与相邻字符换位，如 githbu <-> github）。
 * 超过 maxDist 时提前剪枝，保证数百条书签实时搜索 0ms 响应。
 */
export function damerauDistance(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    let rowMin = maxDist + 1;

    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );

      // 相邻两字符互换（如 githbu -> github）只计 1 次编辑距离
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }

      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDist) return maxDist + 1;
  }

  return dp[m][n];
}

/**
 * 缩写/子序列匹配（仅用于标题和域名）：
 * - 2 字符缩写（如 gh -> GitHub）要求全部命中词首或驼峰首字母，防止 ai 误匹配 mail / wxiach；
 * - 3 字符以上要求较高紧密度或命中多个词首。
 */
function abbreviationScore(token: string, rawText: string): number {
  if (token.length < 2) return 0;

  const words = extractAsciiWords(rawText);
  if (words.length === 0) return 0;

  // 1. 词首字母缩写匹配（如 gh -> GitHub、vsc -> VS Code）
  const wordInitials = rawText
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g)
    ?.map((w) => w[0].toLowerCase())
    .join('') || '';

  if (wordInitials) {
    const idx = wordInitials.indexOf(token);
    if (idx === 0) return 72;
    if (idx > 0 && token.length >= 3) return 60;
  }

  // 2 字符查询不再做松散子序列，避免大量噪音
  if (token.length < 3) return 0;

  // 2. 3+ 字符紧凑子序列匹配
  const lower = rawText.toLowerCase();
  let ti = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  let boundaryHits = 0;

  for (let i = 0; i < lower.length && ti < token.length; i += 1) {
    if (lower[i] !== token[ti]) continue;

    if (firstIdx < 0) firstIdx = i;
    lastIdx = i;

    const prev = i > 0 ? lower[i - 1] : ' ';
    const isCamel = i > 0 && /[a-z]/.test(rawText[i - 1]) && /[A-Z]/.test(rawText[i]);
    if (i === 0 || /[\s\-_./]/.test(prev) || isCamel) {
      boundaryHits += 1;
    }
    ti += 1;
  }

  if (ti < token.length) return 0;

  const span = lastIdx - firstIdx + 1;
  const density = token.length / span;
  if (density < 0.48 && boundaryHits < 2) return 0;

  return 38 + Math.round(density * 18) + boundaryHits * 4;
}

/** 允许的最大编辑距离：短词不模糊、长词允许 1~2 次错字/换位。 */
function allowedFuzzyDistance(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  return 2;
}

/** 仅在拼音音节起点处做匹配，避免 "ai" 误命中 "kai(开发)" / "dai(代码)" / "cai(采购)"。 */
function scorePinyinOnField(token: string, rawText: string): number {
  const py = getPinyinForms(rawText);
  if (!py.full) return 0;

  let best = 0;

  // 1. 首字母匹配（如 tyc -> 天眼查、jswd -> 金山文档）
  if (py.initials) {
    const initIdx = py.initials.indexOf(token);
    if (initIdx === 0) best = Math.max(best, 94);
    else if (initIdx > 0 && token.length >= 2) best = Math.max(best, 80);
  }

  // 2. 音节边界前缀匹配（只从每个汉字的拼音开头比对，绝不从韵母中间截断匹配）
  for (let i = 0; i < py.syllables.length; i += 1) {
    const joinedFromBoundary = py.syllables.slice(i).join('');
    if (joinedFromBoundary.startsWith(token)) {
      best = Math.max(best, i === 0 ? 92 : 78);
      break;
    }
  }

  // 3. 长拼音全拼容错（长度 >= 4，如 tianyanch -> tianyancha）
  if (token.length >= 4 && best < 72) {
    const maxD = allowedFuzzyDistance(token.length);
    const dFull = damerauDistance(token, py.full, maxD);
    if (dFull <= maxD) {
      best = Math.max(best, 72 - dFull * 12);
    }
  }

  return best;
}

interface FieldScoreOptions {
  includePinyin: boolean;
  allowAbbreviation: boolean;
  allowShortMidSubstring: boolean;
}

/** 对单个字段计算某个查询词的匹配得分（0 表示未命中）。 */
function scoreTokenOnField(token: string, rawText: string, opts: FieldScoreOptions): number {
  if (!rawText) return 0;
  const lower = rawText.toLowerCase();
  const isAsciiToken = ASCII_TOKEN_RE.test(token);

  // 1. 直接子串 / 词首匹配
  if (isAsciiToken && token.length <= 2 && !opts.allowShortMidSubstring) {
    // 1~2 位短英文词要求命中整词或词首（含驼峰如 OpenAI 中的 AI），避免 ai 误匹配 gmail / mail
    const words = extractAsciiWords(rawText);
    for (const w of words) {
      if (w === token) return 118;
      if (w.startsWith(token)) return 96;
    }
  } else {
    const directIdx = lower.indexOf(token);
    if (directIdx >= 0) {
      if (lower === token) return 120;
      if (directIdx === 0) return 105;
      const prev = lower[directIdx - 1];
      if (/[\s\-_./]/.test(prev)) return 96;
      return 86;
    }
  }

  // 2. 拼音匹配（仅音节边界与首字母）
  let best = 0;
  if (opts.includePinyin && isAsciiToken) {
    best = Math.max(best, scorePinyinOnField(token, rawText));
  }

  // 3. 词级容错匹配（支持打错字母、漏字、多字与相邻字母换位）
  const maxDist = allowedFuzzyDistance(token.length);
  if (maxDist > 0 && best < 80) {
    if (isAsciiToken) {
      const words = extractAsciiWords(rawText);
      for (const word of words) {
        if (word.length < 3) continue;
        const compareTarget = word.length > token.length + maxDist ? word.slice(0, token.length) : word;
        const d = damerauDistance(token, compareTarget, maxDist);
        if (d <= maxDist) {
          const score = 76 - d * 14 + (compareTarget === word ? 4 : 0);
          if (score > best) best = score;
        }
      }
    } else if (CJK_RE.test(token) && token.length >= 3) {
      const winLen = token.length;
      for (let i = 0; i <= lower.length - winLen; i += 1) {
        const slice = lower.slice(i, i + winLen);
        const d = damerauDistance(token, slice, 1);
        if (d <= 1) {
          best = Math.max(best, 74 - d * 14);
        }
      }
    }
  }

  // 4. 缩写子序列匹配（仅标题与域名）
  if (opts.allowAbbreviation && isAsciiToken && best < 60) {
    best = Math.max(best, abbreviationScore(token, rawText));
  }

  return best;
}

/**
 * 本地即时搜索书签：
 * - 空格分词，所有词均须命中（不限顺序）；
 * - 综合匹配标题、域名、网址与所属目录路径，按相关度降序返回。
 */
export function searchBookmarks(entries: SearchableBookmark[], rawQuery: string): SearchMatch[] {
  const tokens = rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const matches: Array<SearchMatch & { order: number }> = [];

  for (let idx = 0; idx < entries.length; idx += 1) {
    const entry = entries[idx];
    let totalScore = 0;
    let allMatched = true;

    for (const token of tokens) {
      const isShortAscii = ASCII_TOKEN_RE.test(token) && token.length <= 2;

      const titleScore =
        scoreTokenOnField(token, entry.item.title, {
          includePinyin: true,
          allowAbbreviation: true,
          allowShortMidSubstring: false,
        }) * 1.0;

      const hostScore =
        scoreTokenOnField(token, entry.item.host, {
          includePinyin: false,
          allowAbbreviation: true,
          allowShortMidSubstring: false,
        }) * 0.82;

      // 1~2 位短英文词不扫完整 URL 路径，避免命中 https / 参数中的无关字母
      const urlScore = isShortAscii
        ? 0
        : scoreTokenOnField(token, entry.item.url, {
            includePinyin: false,
            allowAbbreviation: false,
            allowShortMidSubstring: true,
          }) * 0.56;

      const folderScore =
        scoreTokenOnField(token, entry.folderPath, {
          includePinyin: true,
          allowAbbreviation: false,
          allowShortMidSubstring: false,
        }) * 0.55;

      const tokenBest = Math.max(titleScore, hostScore, urlScore, folderScore);
      if (tokenBest <= 0) {
        allMatched = false;
        break;
      }
      totalScore += tokenBest;
    }

    if (allMatched) {
      matches.push({
        item: entry.item,
        folderPath: entry.folderPath,
        score: Math.round(totalScore),
        order: idx,
      });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.order - b.order;
  });

  return matches.map(({ item, folderPath, score }) => ({ item, folderPath, score }));
}
