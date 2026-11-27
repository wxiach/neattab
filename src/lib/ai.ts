import type { PageContext } from './pageContext.ts';
import type { AiConfig, ClassifierFolder, PageKind } from './types.ts';

export const DEEPSEEK_ORIGIN = 'https://api.deepseek.com/*';
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-flash', label: 'deepseek-flash（V4.1 Flash · 推荐）' },
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro（V4 Pro）' },
] as const;

export async function hasDeepSeekPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [DEEPSEEK_ORIGIN] });
  } catch {
    return false;
  }
}

export async function requestDeepSeekPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return true;
  try {
    const already = await hasDeepSeekPermission();
    if (already) return true;
    return await chrome.permissions.request({ origins: [DEEPSEEK_ORIGIN] });
  } catch {
    return false;
  }
}

export function isAiReady(ai: AiConfig | undefined): boolean {
  return Boolean(ai && ai.enabled && ai.apiKey.trim().length > 0);
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

function parseJsonLoose<T>(raw: string): T | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced && fenced[1] ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      try {
        return JSON.parse(candidate.slice(objStart, objEnd + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callDeepSeekJson<T>(
  ai: AiConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ data: T; latencyMs: number }> {
  const apiKey = ai.apiKey.trim();
  if (!apiKey) throw new Error('未填写 DeepSeek API Key');

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  const onExternalAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const model = ai.model || 'deepseek-flash';
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.1,
    max_tokens: opts.maxTokens ?? 200,
    response_format: { type: 'json_object' },
    messages,
  };
  if (model === 'deepseek-flash' || model === 'deepseek-v4-pro') {
    payload.thinking = { type: 'disabled' };
  }

  const started = performance.now();
  try {
    const res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as DeepSeekResponse;
        if (errBody?.error?.message) msg = errBody.error.message;
      } catch {
        /* 忽略 */
      }
      if (res.status === 401) throw new Error('API Key 无效或已失效');
      if (res.status === 402) throw new Error('DeepSeek 账户余额不足');
      if (res.status === 429) throw new Error('请求过于频繁，请稍后重试');
      throw new Error(msg);
    }

    const body = (await res.json()) as DeepSeekResponse;
    const content = body.choices?.[0]?.message?.content || '';
    const parsed = parseJsonLoose<T>(content);
    if (!parsed) throw new Error('AI 返回格式无法解析');
    return { data: parsed, latencyMs };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (controller.signal.aborted) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new Error('请求超时，请检查网络');
    }
    throw err instanceof Error ? err : new Error('网络请求失败');
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

export async function testDeepSeekConnection(
  ai: AiConfig,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  try {
    const { latencyMs } = await callDeepSeekJson<{ ok?: boolean }>(
      ai,
      [
        { role: 'system', content: 'Return strictly valid JSON: {"ok":true}' },
        { role: 'user', content: 'ping' },
      ],
      { maxTokens: 16, timeoutMs: 8000 },
    );
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '连接失败' };
  }
}

export interface SuggestedNewFolder {
  parentId: string;
  name: string;
}

export interface BookmarkAiSuggestion {
  folderId: string;
  title: string;
  reason: string;
  newFolder?: SuggestedNewFolder;
  latencyMs: number;
}

export async function suggestBookmarkWithDeepSeek(params: {
  ai: AiConfig;
  url: string;
  rawTitle: string;
  pageKind: PageKind;
  folders: ClassifierFolder[];
  pageContext?: PageContext;
  signal?: AbortSignal;
}): Promise<BookmarkAiSuggestion> {
  const { ai, url, rawTitle, pageKind, folders, pageContext, signal } = params;
  const folderLines = folders
    .filter((f) => !f.isRoot)
    .map((f) => `${f.id}|${f.pathLabel}`)
    .join('\n');

  const systemPrompt = [
    '你是浏览器书签整理助手。结合网页标题、网址、页面内容摘要与已有目录列表，返回严格 JSON：',
    '{"folderId":"已有目录ID","title":"精简清晰的书签名称","reason":"10字以内简短理由","newFolder":null}',
    '规则：',
    '1. 优先从给定已有目录列表中选最贴切的 folderId（优先叶子目录，帖子/文章类优先选「阅读清单」类目录）。',
    '2. 仅当所有已有目录都明显不匹配该网站主题时，才把 newFolder 设为 {"parentId":"上级一级目录ID或空字符串","name":"建议新分类名(2-8字)"}；否则 newFolder 必须为 null，切勿随意新建分类。',
    '3. title 去掉未读数、营销口号、重复网站尾缀；若原标题含糊（如「首页/登录/工作台」），结合页面简介或正文给出准确简洁的名称（4-24 字，不凭空捏造）。',
    '4. GitHub 仓库保留 owner/repo，内部系统（如 OA/ERP/UAT）保留公司名与系统缩写。',
  ].join('\n');

  const userLines = [
    `页面类型：${pageKind.label}`,
    `原始标题：${rawTitle}`,
    `网址：${url}`,
  ];
  if (pageContext?.h1) userLines.push(`页面主标题：${pageContext.h1}`);
  if (pageContext?.description) userLines.push(`页面简介：${pageContext.description}`);
  if (pageContext?.excerpt) userLines.push(`正文节选：${pageContext.excerpt}`);
  userLines.push('可选目录（格式：ID|路径）：', folderLines || '(无子目录)');

  const { data, latencyMs } = await callDeepSeekJson<{
    folderId?: string;
    title?: string;
    reason?: string;
    newFolder?: { parentId?: string; name?: string } | null;
  }>(
    ai,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userLines.join('\n') },
    ],
    { maxTokens: 200, timeoutMs: 8500, signal },
  );

  const validIds = new Set(folders.map((f) => f.id));
  const topIds = new Set(folders.filter((f) => f.depth === 1).map((f) => f.id));
  const folderId = typeof data.folderId === 'string' && validIds.has(data.folderId.trim()) ? data.folderId.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
  const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 32) : 'DeepSeek 推荐';

  let newFolder: SuggestedNewFolder | undefined;
  if (data.newFolder && typeof data.newFolder === 'object' && typeof data.newFolder.name === 'string') {
    const cleanName = data.newFolder.name.trim().slice(0, 20);
    const pid = typeof data.newFolder.parentId === 'string' ? data.newFolder.parentId.trim() : '';
    const safePid = pid && topIds.has(pid) ? pid : '';
    const dupExists = folders.some(
      (f) => !f.isRoot && f.title.toLowerCase() === cleanName.toLowerCase() && (safePid ? f.depth === 2 : f.depth === 1),
    );
    if (cleanName.length >= 2 && !dupExists) {
      newFolder = { parentId: safePid, name: cleanName };
    }
  }

  return { folderId, title, reason, newFolder, latencyMs };
}

export interface BatchRenameInput {
  id: string;
  title: string;
  url: string;
  folderId: string;
  folderPath: string;
}

export interface BatchRenameSuggestion {
  id: string;
  url: string;
  originalFolderId: string;
  originalFolderPath: string;
  suggestedFolderId: string;
  suggestedFolderPath: string;
  folderChanged: boolean;
  originalTitle: string;
  suggestedTitle: string;
  titleChanged: boolean;
  reason: string;
  changed: boolean;
}

export async function batchSuggestRenames(params: {
  ai: AiConfig;
  items: BatchRenameInput[];
  includeCategory?: boolean;
  folders?: Array<{ id: string; pathLabel: string }>;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, batchResults: BatchRenameSuggestion[]) => void;
}): Promise<BatchRenameSuggestion[]> {
  const { ai, items, includeCategory = false, folders = [], signal, onProgress } = params;
  const batchSize = params.batchSize ?? 15;
  const all: BatchRenameSuggestion[] = [];

  const folderById = new Map(folders.map((f) => [f.id, f.pathLabel]));
  const folderLines = folders.map((f) => `${f.id}|${f.pathLabel}`).join('\n');

  const systemPrompt = includeCategory
    ? [
        '你是书签批量整理助手。为每条书签给出更简洁直观的名称，并在当前分类明显不合适时建议更贴切的目录，返回严格 JSON：',
        '{"items":[{"id":"原ID","title":"建议名称","folderId":"建议目录ID","reason":"8字以内改动理由"}]}',
        '规则：',
        '1. 名称去掉未读数、SEO 营销语、多余的「首页/官网/登录」、冗余站点后缀；保留公司/环境名（OA/ERP/UAT）、GitHub owner/repo 与核心主题。',
        '2. folderId 必须来自给定可选目录列表；若原目录已合理，直接返回原 folderId，不要为了移动而移动。',
        '3. 名称与目录都无需调整时，原样返回原 title 与原 folderId（reason 填"无需调整"）。',
        '4. 严禁遗漏或改写 id，必须为输入的每一条返回结果。',
      ].join('\n')
    : [
        '你是书签批量命名规范化助手。为每条书签给出更简洁、直观、易扫描的名称，返回严格 JSON：',
        '{"items":[{"id":"原ID","title":"建议名称","reason":"8字以内改动理由"}]}',
        '规则：',
        '1. 去掉未读数、SEO 营销语、多余的「首页/官网/登录」、冗余站点后缀。',
        '2. 保留关键识别信息（如公司/环境名 OA/ERP/UAT、GitHub 的 owner/repo、具体工具或文档主题）。',
        '3. 原标题已经足够简洁清晰时，直接保持原标题不变（reason 填"已简洁"）。',
        '4. 严禁遗漏或改写 id，必须为输入的每一条返回结果。',
      ].join('\n');

  for (let offset = 0; offset < items.length; offset += batchSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunk = items.slice(offset, offset + batchSize);
    const payload = chunk.map((it) => ({
      id: it.id,
      folderId: it.folderId,
      folder: it.folderPath,
      title: it.title,
      url: it.url,
    }));

    const userContent = includeCategory
      ? `可选目录（ID|路径）：\n${folderLines}\n\n待整理书签：\n${JSON.stringify(payload)}`
      : JSON.stringify(payload);

    const { data } = await callDeepSeekJson<{
      items?: Array<{ id?: string; title?: string; folderId?: string; reason?: string }>;
    }>(
      ai,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      { maxTokens: Math.min(2200, chunk.length * 100 + 160), timeoutMs: 25000, signal },
    );

    const byId = new Map<string, { title: string; folderId: string; reason: string }>();
    for (const row of Array.isArray(data.items) ? data.items : []) {
      if (row && typeof row.id === 'string' && typeof row.title === 'string' && row.title.trim()) {
        const fid = typeof row.folderId === 'string' ? row.folderId.trim() : '';
        byId.set(row.id, {
          title: row.title.trim().slice(0, 80),
          folderId: fid && folderById.has(fid) ? fid : '',
          reason: typeof row.reason === 'string' ? row.reason.trim().slice(0, 28) : '',
        });
      }
    }

    const batchResults: BatchRenameSuggestion[] = chunk.map((src) => {
      const hit = byId.get(src.id);
      const suggestedTitle = hit ? hit.title : src.title;
      const titleChanged = suggestedTitle !== src.title;
      const suggestedFolderId = includeCategory && hit?.folderId ? hit.folderId : src.folderId;
      const folderChanged = includeCategory && suggestedFolderId !== src.folderId;
      const suggestedFolderPath = folderById.get(suggestedFolderId) || src.folderPath;
      const changed = titleChanged || folderChanged;
      return {
        id: src.id,
        url: src.url,
        originalFolderId: src.folderId,
        originalFolderPath: src.folderPath,
        suggestedFolderId,
        suggestedFolderPath,
        folderChanged,
        originalTitle: src.title,
        suggestedTitle,
        titleChanged,
        reason: hit?.reason || (changed ? (folderChanged && !titleChanged ? '建议归类' : '精简整理') : '无需调整'),
        changed,
      };
    });

    all.push(...batchResults);
    onProgress?.(Math.min(offset + chunk.length, items.length), items.length, batchResults);
  }

  return all;
}

export type FolderAuditActionType = 'merge' | 'delete_empty' | 'rename' | 'create';

export interface FolderAuditSuggestion {
  uid: string;
  type: FolderAuditActionType;
  reason: string;
  // merge
  sourceId?: string;
  sourcePath?: string;
  sourceCount?: number;
  targetId?: string;
  targetPath?: string;
  // delete_empty / rename
  folderId?: string;
  folderPath?: string;
  newName?: string;
  // create
  parentId?: string;
  parentPath?: string;
  moveBookmarkIds?: string[];
  moveCount?: number;
}

export interface AuditFolderSummary {
  id: string;
  parentId: string;
  depth: number;
  title: string;
  path: string;
  directCount: number;
  totalCount: number;
  samples: Array<{ id: string; title: string; host: string }>;
}

export async function auditFolderStructure(params: {
  ai: AiConfig;
  rootId: string;
  folders: AuditFolderSummary[];
  signal?: AbortSignal;
}): Promise<{ summary: string; suggestions: FolderAuditSuggestion[] }> {
  const { ai, rootId, folders, signal } = params;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const allBookmarkIds = new Set<string>();
  for (const f of folders) {
    for (const s of f.samples) allBookmarkIds.add(s.id);
  }

  const isDescendant = (id: string, maybeAnc: string) => {
    let cur = byId.get(id);
    while (cur) {
      if (cur.id === maybeAnc) return true;
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  const systemPrompt = [
    '你是书签目录结构规划师。分析用户的完整书签目录树，提出克制、高价值的目录结构优化建议，返回严格 JSON：',
    '{"summary":"一句话总体评价","suggestions":[...]}',
    '每条 suggestion 只能是以下 4 种格式之一：',
    '1. 合并重复或过碎目录：{"type":"merge","sourceId":"被合并目录ID","targetId":"目标目录ID","reason":"15字内理由"}',
    '2. 清理空目录：{"type":"delete_empty","folderId":"totalCount为0的空目录ID","reason":"15字内理由"}',
    '3. 规范目录名称：{"type":"rename","folderId":"目录ID","newName":"新名称","reason":"15字内理由"}',
    '4. 拆分过载目录或新建缺失分类：{"type":"create","parentId":"上级目录ID或根目录ID","newName":"新分类名","moveBookmarkIds":["要移入的书签ID"],"reason":"15字内理由"}',
    '原则：',
    '- 严禁编造不存在的目录 ID 或书签 ID；不要为了改而改，结构已合理可返回空数组。',
    '- merge 时 targetId 不能是 sourceId 或其子目录；delete_empty 只能用于 totalCount 为 0 的目录。',
    '- 最多给出 12 条最值得执行的建议。',
  ].join('\n');

  const compactTree = folders.map((f) => ({
    id: f.id,
    parentId: f.parentId,
    depth: f.depth,
    path: f.path,
    directCount: f.directCount,
    totalCount: f.totalCount,
    samples: f.samples.slice(0, 12),
  }));

  const { data } = await callDeepSeekJson<{
    summary?: string;
    suggestions?: Array<Record<string, unknown>>;
  }>(
    ai,
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `根目录 ID：${rootId}\n当前目录结构：\n${JSON.stringify(compactTree)}`,
      },
    ],
    { maxTokens: 2000, timeoutMs: 25000, signal },
  );

  const suggestions: FolderAuditSuggestion[] = [];
  const seenKey = new Set<string>();
  let seq = 0;

  for (const raw of Array.isArray(data.suggestions) ? data.suggestions : []) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || '');
    const reason = String(raw.reason || '').trim().slice(0, 48) || '结构优化';

    if (type === 'merge') {
      const sourceId = String(raw.sourceId || '').trim();
      const targetId = String(raw.targetId || '').trim();
      const src = byId.get(sourceId);
      const dst = byId.get(targetId);
      if (!src || !dst || sourceId === targetId || isDescendant(targetId, sourceId)) continue;
      const k = `merge:${sourceId}:${targetId}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      suggestions.push({
        uid: `aud-${++seq}`,
        type: 'merge',
        sourceId,
        sourcePath: src.path,
        sourceCount: src.totalCount,
        targetId,
        targetPath: dst.path,
        reason,
      });
    } else if (type === 'delete_empty') {
      const folderId = String(raw.folderId || '').trim();
      const f = byId.get(folderId);
      if (!f || f.totalCount > 0) continue;
      const k = `del:${folderId}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      suggestions.push({
        uid: `aud-${++seq}`,
        type: 'delete_empty',
        folderId,
        folderPath: f.path,
        reason,
      });
    } else if (type === 'rename') {
      const folderId = String(raw.folderId || '').trim();
      const newName = String(raw.newName || '').trim().slice(0, 24);
      const f = byId.get(folderId);
      if (!f || !newName || newName === f.title) continue;
      const k = `ren:${folderId}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      suggestions.push({
        uid: `aud-${++seq}`,
        type: 'rename',
        folderId,
        folderPath: f.path,
        newName,
        reason,
      });
    } else if (type === 'create') {
      const pid = String(raw.parentId || rootId).trim();
      const validParent = pid === rootId || byId.has(pid);
      const parentId = validParent ? pid : rootId;
      const newName = String(raw.newName || '').trim().slice(0, 24);
      if (!newName) continue;
      const moveBookmarkIds = Array.isArray(raw.moveBookmarkIds)
        ? raw.moveBookmarkIds
            .map((x) => String(x || '').trim())
            .filter((id) => allBookmarkIds.has(id))
        : [];
      const k = `cre:${parentId}:${newName.toLowerCase()}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      const parentPath = parentId === rootId ? '根目录' : byId.get(parentId)?.path || '根目录';
      suggestions.push({
        uid: `aud-${++seq}`,
        type: 'create',
        parentId,
        parentPath,
        newName,
        moveBookmarkIds,
        moveCount: moveBookmarkIds.length,
        reason,
      });
    }
  }

  // 兜底补充遗漏的纯空目录建议
  for (const f of folders) {
    if (f.totalCount === 0 && !seenKey.has(`del:${f.id}`)) {
      seenKey.add(`del:${f.id}`);
      suggestions.push({
        uid: `aud-${++seq}`,
        type: 'delete_empty',
        folderId: f.id,
        folderPath: f.path,
        reason: '该分类目前为空',
      });
    }
  }

  return {
    summary: String(data.summary || '').trim() || (suggestions.length ? `发现 ${suggestions.length} 项可优化建议` : '当前目录结构很清晰，暂无需要调整的项。'),
    suggestions,
  };
}
