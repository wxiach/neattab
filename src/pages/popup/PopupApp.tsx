import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Loader2, RefreshCw, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Favicon } from '@/components/Favicon';
import {
  isAiReady,
  suggestBookmarkWithDeepSeek,
} from '@/lib/ai';
import { extractActiveTabContext, type PageContext } from '@/lib/pageContext';
import { findNode } from '@/lib/bookmarks';
import {
  buildFolders,
  cleanTitle,
  detectPageKind,
  findReadingFolder,
  parseUrl,
  trainLocalModel,
} from '@/lib/classifier';
import { applyFont, applyTheme, DEFAULTS, loadPrefs, savePrefs } from '@/lib/storage';
import type { ClassifierFolder, PageKind, Prefs, UrlInfo } from '@/lib/types';
import { cn } from '@/lib/cn';

const MAX_FEEDBACK = 200;
const NEW_PREFIX = '__new__:';
const READING_DEFAULT_NAME = '阅读清单';

interface PendingFolder {
  value: string;
  title: string;
  parentId?: string;
  displayLabel?: string;
}

interface NoticeState {
  title: string;
  subtitle: string;
  actions?: Array<{ label: string; outline?: boolean; onClick: () => void }>;
}

export function PopupApp() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [ready, setReady] = useState(false);

  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [urlInfo, setUrlInfo] = useState<UrlInfo | null>(null);
  const [pageKind, setPageKind] = useState<PageKind>({ kind: 'site', label: '站点入口' });
  const [existing, setExisting] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [rootNode, setRootNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [folders, setFolders] = useState<ClassifierFolder[]>([]);
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);

  const [rawTitle, setRawTitle] = useState('');
  const [cleanName, setCleanName] = useState('');
  const [aiSuggestedTitle, setAiSuggestedTitle] = useState('');
  const [title, setTitle] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [predictedId, setPredictedId] = useState('');
  const [quickPicks, setQuickPicks] = useState<ClassifierFolder[]>([]);
  const [offerReading, setOfferReading] = useState(false);
  const [aiNewFolder, setAiNewFolder] = useState<PendingFolder | null>(null);

  const [badgeText, setBadgeText] = useState('');
  const [badgeVariant, setBadgeVariant] = useState<'info' | 'warning' | 'success' | 'danger' | 'default'>('info');
  const [reasonLine, setReasonLine] = useState('');
  const [matchHint, setMatchHint] = useState('');

  const [favChecked, setFavChecked] = useState(false);
  const [trimHashLabel, setTrimHashLabel] = useState('');
  const [cleanHashChecked, setCleanHashChecked] = useState(true);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [saving, setSaving] = useState(false);

  const userTouchedTitleRef = useRef(false);
  const userTouchedFolderRef = useRef(false);
  const pageCtxRef = useRef<PageContext | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const runDeepSeek = useCallback(
    async (
      args: {
        ai: Prefs['ai'];
        tabId?: number;
        url: string;
        origTitle: string;
        kind: PageKind;
        folderList: ClassifierFolder[];
      },
      forceOverwrite: boolean,
    ) => {
      if (!isAiReady(args.ai)) return;
      aiAbortRef.current?.abort();
      const ac = new AbortController();
      aiAbortRef.current = ac;

      setAiStatus('loading');
      setAiError('');

      try {
        if (!pageCtxRef.current && args.tabId != null) {
          pageCtxRef.current = await extractActiveTabContext(args.tabId);
        }
        if (ac.signal.aborted) return;

        const res = await suggestBookmarkWithDeepSeek({
          ai: args.ai,
          url: args.url,
          rawTitle: args.origTitle,
          pageKind: args.kind,
          folders: args.folderList,
          pageContext: pageCtxRef.current || undefined,
          signal: ac.signal,
        });

        if (ac.signal.aborted) return;

        if (res.title) {
          setAiSuggestedTitle(res.title);
          if (forceOverwrite || !userTouchedTitleRef.current) {
            setTitle(res.title);
          }
        }

        const readBody = Boolean(
          pageCtxRef.current &&
            (pageCtxRef.current.description || pageCtxRef.current.h1 || pageCtxRef.current.excerpt),
        );

        if (res.newFolder) {
          const parentFolder = res.newFolder.parentId
            ? args.folderList.find((f) => f.id === res.newFolder!.parentId)
            : null;
          const val = `${NEW_PREFIX}${res.newFolder.parentId || ''}:${res.newFolder.name}`;
          const displayLabel = parentFolder
            ? `${parentFolder.title} / ${res.newFolder.name}`
            : res.newFolder.name;
          const pendingItem: PendingFolder = {
            value: val,
            title: res.newFolder.name,
            parentId: res.newFolder.parentId || undefined,
            displayLabel,
          };
          setAiNewFolder(pendingItem);
          setPendingFolders((prev) =>
            prev.some((p) => p.value === val) ? prev : [pendingItem, ...prev],
          );
          if (forceOverwrite || !userTouchedFolderRef.current) {
            setSelectedFolder(val);
            setPredictedId(val);
          }
          setReasonLine(
            readBody
              ? `DeepSeek 已分析内容 · 建议新建「${displayLabel}」`
              : `DeepSeek 建议新建「${displayLabel}」`,
          );
        } else if (res.folderId) {
          setAiNewFolder(null);
          const folder = args.folderList.find((f) => f.id === res.folderId);
          if (forceOverwrite || !userTouchedFolderRef.current) {
            setSelectedFolder(res.folderId);
            setPredictedId(res.folderId);
          }
          if (folder) {
            setQuickPicks((prev) => {
              const merged = [folder, ...prev.filter((f) => f.id !== folder.id)];
              return merged.slice(0, 4);
            });
            setReasonLine(
              readBody
                ? `DeepSeek 已分析页面内容 · 推荐「${folder.pathLabel}」`
                : `DeepSeek 推荐「${folder.pathLabel}」`,
            );
          }
        }

        setMatchHint(res.reason || 'DeepSeek 智能推荐');
        setBadgeText(`DeepSeek · ${res.latencyMs}ms`);
        setBadgeVariant('success');
        setAiStatus('done');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAiStatus('error');
        setAiError(err instanceof Error ? err.message : 'DeepSeek 请求失败');
      } finally {
        if (aiAbortRef.current === ac) aiAbortRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const loadedPrefs = await loadPrefs();
      if (!alive) return;
      setPrefs(loadedPrefs);
      applyTheme(loadedPrefs.theme);
      applyFont(loadedPrefs.font);

      let activeTab: chrome.tabs.Tab | null = null;
      try {
        [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        activeTab = null;
      }
      if (!alive) return;

      const uInfo = activeTab?.url ? parseUrl(activeTab.url) : parseUrl('');
      if (!activeTab || !uInfo.ok) {
        setNotice({
          title: '当前页面不支持收藏',
          subtitle: '仅支持收藏 http / https 网页。',
          actions: [
            {
              label: '打开书签主页',
              onClick: () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
                window.close();
              },
            },
            { label: '关闭', outline: true, onClick: () => window.close() },
          ],
        });
        setReady(true);
        return;
      }

      let treeRoot: chrome.bookmarks.BookmarkTreeNode | undefined;
      try {
        [treeRoot] = await chrome.bookmarks.getTree();
      } catch {
        setNotice({ title: '无法读取收藏夹', subtitle: '请确认已授予书签权限。' });
        setReady(true);
        return;
      }
      if (!alive) return;

      const root = findNode(treeRoot, loadedPrefs.rootId) || treeRoot?.children?.[0] || null;
      if (!root) {
        setNotice({ title: '未找到收藏夹目录', subtitle: '请在系统设置中重新选择数据来源。' });
        setReady(true);
        return;
      }

      const kind = detectPageKind(uInfo);
      const folderList = buildFolders(root);
      const folderMap = new Map(folderList.map((f) => [f.id, f]));

      let hitExisting: chrome.bookmarks.BookmarkTreeNode | null = null;
      try {
        const queries = [chrome.bookmarks.search({ url: activeTab.url! })];
        if (uInfo.trimHash && uInfo.cleanUrl !== activeTab.url) {
          queries.push(chrome.bookmarks.search({ url: uInfo.cleanUrl }));
        }
        const hits = (await Promise.all(queries)).flat();
        hitExisting = hits.find((h) => h.parentId && folderMap.has(h.parentId)) || hits[0] || null;
      } catch {
        hitExisting = null;
      }
      if (!alive) return;

      setTab(activeTab);
      setUrlInfo(uInfo);
      setPageKind(kind);
      setRootNode(root);
      setFolders(folderList);
      setExisting(hitExisting);

      const hashInfo = hitExisting?.url ? parseUrl(hitExisting.url) : uInfo;
      if (hashInfo.trimHash) {
        setTrimHashLabel(`去掉锚点 ${hashInfo.trimHash}（从开头打开）`);
        setCleanHashChecked(true);
      } else {
        setTrimHashLabel('');
      }

      if (hitExisting) {
        const origT = (hitExisting.title || activeTab.title || uInfo.host).trim();
        const cleanedT = cleanTitle(origT, uInfo, kind);
        setRawTitle(origT);
        setCleanName(cleanedT);
        setTitle(origT);
        setBadgeText('已收藏');
        setBadgeVariant('info');
        const curF = hitExisting.parentId ? folderMap.get(hitExisting.parentId) : undefined;
        setReasonLine(curF ? `当前位于「${curF.pathLabel}」` : '当前已保存在其它目录');
        setSelectedFolder(curF ? curF.id : root.id);
        setFavChecked(loadedPrefs.favorites.includes(hitExisting.id));
      } else {
        const rec = trainLocalModel(folderList, loadedPrefs.mlFeedback).predict(
          uInfo.cleanUrl,
          activeTab.title || '',
          loadedPrefs.lastFolderId,
        );
        const readingFolder = findReadingFolder(folderList);

        let chosenVal = rec.best ? rec.best.id : root.id;
        let reason = `推荐归入「${rec.best ? rec.best.pathLabel : root.title}」`;
        let hint = rec.reason;
        let badge = rec.confidence ? `本地模型 ${rec.confidence}%` : '本地模型';
        let quick = [...rec.candidates];
        let wantReading = false;
        const pending: PendingFolder[] = [];

        if (kind.kind === 'content') {
          if (readingFolder) {
            chosenVal = readingFolder.id;
            reason = `识别为具体内容，优先归入「${readingFolder.pathLabel}」`;
            hint = '内容页 · 优先阅读清单';
            badge = '阅读清单';
            quick = [readingFolder, ...rec.candidates];
          } else {
            chosenVal = `${NEW_PREFIX}${READING_DEFAULT_NAME}`;
            pending.push({ value: chosenVal, title: READING_DEFAULT_NAME });
            reason = '识别为帖子/文章，建议与站点入口分开存放';
            hint = '建议新建阅读清单';
            badge = '内容页';
            wantReading = true;
          }
        }

        const dedupQuick = quick.filter((f, idx, arr) => f && arr.findIndex((x) => x.id === f.id) === idx);
        const origT = (activeTab.title || '').trim() || uInfo.host;
        const cleanedT = cleanTitle(origT, uInfo, kind);

        setPendingFolders(pending);
        setPredictedId(chosenVal);
        setSelectedFolder(chosenVal);
        setQuickPicks(dedupQuick);
        setOfferReading(wantReading);
        setRawTitle(origT);
        setCleanName(cleanedT);
        setTitle(cleanedT);
        setReasonLine(reason);
        setMatchHint(hint);
        setBadgeText(badge);
        setBadgeVariant('info');

        // 0ms 先出本地兜底，后台提取当前页内容摘要并请求 DeepSeek（未手动编辑则静默更新）
        if (isAiReady(loadedPrefs.ai)) {
          runDeepSeek(
            {
              ai: loadedPrefs.ai,
              tabId: activeTab.id,
              url: uInfo.cleanUrl,
              origTitle: origT,
              kind,
              folderList,
            },
            false,
          );
        }
      }

      setReady(true);
      requestAnimationFrame(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      });
    })();

    return () => {
      alive = false;
      aiAbortRef.current?.abort();
    };
  }, [runDeepSeek]);

  const ensurePendingFolder = (name: string) => {
    const clean = name.trim();
    if (!clean) return '';
    const exists = folders.find((f) => f.depth === 1 && f.title === clean);
    if (exists) {
      setSelectedFolder(exists.id);
      return exists.id;
    }
    const value = `${NEW_PREFIX}${clean}`;
    setPendingFolders((prev) => (prev.some((p) => p.value === value) ? prev : [{ value, title: clean }, ...prev]));
    setSelectedFolder(value);
    return value;
  };

  const confirmNewFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      newFolderInputRef.current?.focus();
      return;
    }
    userTouchedFolderRef.current = true;
    const val = ensurePendingFolder(name);
    if (val) {
      setReasonLine(val.startsWith(NEW_PREFIX) ? `保存时将创建分组「${name}」并存入` : `将归入「${name}」`);
    }
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const handleSave = async () => {
    if (!tab || !rootNode || !selectedFolder || saving) return;
    const finalTitle = title.trim() || tab.title || tab.url || '';
    let finalUrl = existing?.url || tab.url || '';
    if (trimHashLabel && cleanHashChecked) {
      const targetInfo = existing?.url ? parseUrl(existing.url) : urlInfo;
      if (targetInfo?.trimHash) finalUrl = targetInfo.cleanUrl;
    }

    setSaving(true);
    try {
      let parentId = selectedFolder;
      let targetName = '';
      if (selectedFolder.startsWith(NEW_PREFIX)) {
        const pf = pendingFolders.find((p) => p.value === selectedFolder);
        const newName = pf ? pf.title : selectedFolder.slice(NEW_PREFIX.length).trim();
        const createParentId = pf?.parentId || rootNode.id;
        const createdFolder = await chrome.bookmarks.create({ parentId: createParentId, title: newName });
        parentId = createdFolder.id;
        targetName = pf?.displayLabel || newName;
      } else {
        const target = folders.find((f) => f.id === parentId);
        targetName = target ? target.pathLabel : '收藏夹';
      }

      let id = '';
      if (existing) {
        id = existing.id;
        const patch: { title?: string; url?: string } = {};
        if (finalTitle !== existing.title) patch.title = finalTitle;
        if (finalUrl !== existing.url) patch.url = finalUrl;
        if (Object.keys(patch).length) await chrome.bookmarks.update(id, patch);
        if (parentId !== existing.parentId) await chrome.bookmarks.move(id, { parentId });
      } else {
        const created = await chrome.bookmarks.create({ parentId, title: finalTitle, url: finalUrl });
        id = created.id;
      }

      const corrected = Boolean(predictedId) && selectedFolder !== predictedId;
      const favs = [...prefs.favorites];
      const idx = favs.indexOf(id);
      if (favChecked && idx < 0) favs.unshift(id);
      else if (!favChecked && idx >= 0) favs.splice(idx, 1);

      const nextFeedback = [
        { url: finalUrl, title: finalTitle, folderId: parentId, corrected },
        ...prefs.mlFeedback.filter((i) => i && i.url !== finalUrl),
      ].slice(0, MAX_FEEDBACK);

      await savePrefs({ favorites: favs, mlFeedback: nextFeedback, lastFolderId: parentId });

      setNotice({
        title: existing ? '已更新收藏' : '已加入收藏',
        subtitle: `分组：${targetName}${corrected ? '（已学习本次选择）' : ''}`,
      });
      setTimeout(() => window.close(), 560);
    } catch {
      setSaving(false);
      setNotice({ title: '保存失败', subtitle: '请检查浏览器书签权限后重试。' });
    }
  };

  const handleRemove = async () => {
    if (!existing || saving) return;
    setSaving(true);
    try {
      await chrome.bookmarks.remove(existing.id);
      const favs = prefs.favorites.filter((id) => id !== existing.id);
      await savePrefs({ favorites: favs });
      setNotice({ title: '已移除书签', subtitle: existing.title || '' });
      setTimeout(() => window.close(), 480);
    } catch {
      setSaving(false);
      setNotice({ title: '移除失败', subtitle: '该书签可能已被删除。' });
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (newFolderOpen) {
          setNewFolderOpen(false);
          setNewFolderName('');
          return;
        }
        window.close();
      } else if (e.key === 'Enter' && !notice && !newFolderOpen) {
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const preferredClean = aiSuggestedTitle || cleanName;
  const showTitleToggle = Boolean(rawTitle && preferredClean && rawTitle !== preferredClean);
  const isUsingClean = title.trim() === preferredClean;
  const aiEnabled = isAiReady(prefs.ai);

  return (
    <div className="flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-between gap-2 px-4 py-3 bg-background border-b border-line">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-6 h-6 bg-accent-soft text-accent inline-flex items-center justify-center">
            <Bookmark className="w-3.5 h-3.5 fill-current" />
          </span>
          <span className="text-[13.5px] font-semibold tracking-[-0.01em] truncate">
            {existing ? '编辑收藏' : '收藏当前页'}
          </span>
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {aiStatus === 'loading' ? (
            <Badge variant="info">
              <Loader2 className="w-3 h-3 animate-spin" />
              DeepSeek 思考中…
            </Badge>
          ) : (
            badgeText && (
              <Badge variant={badgeVariant}>
                {aiStatus === 'done' && <Sparkles className="w-3 h-3" />}
                {badgeText}
              </Badge>
            )
          )}

          {aiEnabled && ready && !notice && urlInfo?.ok && (
            <button
              type="button"
              disabled={aiStatus === 'loading'}
              title={aiStatus === 'error' ? `重试 DeepSeek（${aiError}）` : '用 DeepSeek 重新推荐分组与命名'}
              onClick={() => {
                userTouchedTitleRef.current = false;
                userTouchedFolderRef.current = false;
                runDeepSeek(
                  {
                    ai: prefs.ai,
                    tabId: tab?.id,
                    url: urlInfo.cleanUrl,
                    origTitle: rawTitle,
                    kind: pageKind,
                    folderList: folders,
                  },
                  true,
                );
              }}
              className="inline-flex items-center gap-1 h-6 px-1.5 border border-line2 bg-surface text-[11px] font-medium text-ink2 hover:text-accent hover:border-accent-line cursor-pointer disabled:opacity-45"
            >
              <RefreshCw className={cn('w-3 h-3', aiStatus === 'loading' && 'animate-spin')} />
              <span>{existing ? 'AI 优化' : '重试'}</span>
            </button>
          )}
        </div>
      </header>

      {notice ? (
        <div className="px-5 py-7 text-center">
          <p className="m-0 mb-1.5 text-[13.5px] font-semibold text-ink">{notice.title}</p>
          {notice.subtitle && <p className="m-0 text-xs leading-relaxed text-ink2">{notice.subtitle}</p>}
          {notice.actions && notice.actions.length > 0 && (
            <div className="mt-4 flex justify-center gap-2">
              {notice.actions.map((a) => (
                <Button key={a.label} variant={a.outline ? 'outline' : 'default'} onClick={a.onClick}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : !ready ? (
        <div className="px-5 py-10 flex items-center justify-center gap-2 text-xs text-ink3">
          <Loader2 className="w-4 h-4 animate-spin" />
          读取中…
        </div>
      ) : (
        <div className="px-4 pt-3.5 pb-4 flex flex-col gap-3">
          {/* 页面预览 */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 bg-background border border-line">
            <Favicon
              url={tab?.url || ''}
              fallbackText={urlInfo?.host || '?'}
              className="w-7 h-7 p-1 text-xs"
            />
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[11.5px] text-ink2 truncate">{urlInfo?.host}</span>
                <Badge variant={pageKind.kind === 'content' ? 'warning' : 'default'}>{pageKind.label}</Badge>
              </div>
              <div className="text-[11px] text-ink3 truncate">
                {aiStatus === 'error' ? `${reasonLine}（DeepSeek：${aiError}）` : reasonLine}
              </div>
            </div>
          </div>

          {/* 名称 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="title-input" className="text-xs font-semibold text-ink2">
                名称
              </label>
              {showTitleToggle && (
                <button
                  type="button"
                  onClick={() => {
                    userTouchedTitleRef.current = true;
                    setTitle(isUsingClean ? rawTitle : preferredClean);
                    titleInputRef.current?.focus();
                    titleInputRef.current?.select();
                  }}
                  className="p-0 border-0 bg-transparent text-[11px] text-ink3 underline underline-offset-2 decoration-line3 hover:text-accent cursor-pointer"
                >
                  {isUsingClean ? (aiSuggestedTitle ? 'AI 精简 · 还原原标题' : '已精简 · 还原') : aiSuggestedTitle ? '使用 AI 名称' : '使用精简名'}
                </button>
              )}
            </div>
            <Input
              ref={titleInputRef}
              id="title-input"
              value={title}
              onChange={(e) => {
                userTouchedTitleRef.current = true;
                setTitle(e.target.value);
              }}
              placeholder="书签名称"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* 分组 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="folder-select" className="text-xs font-semibold text-ink2">
                分组
              </label>
              {matchHint && <span className="text-[11px] text-accent truncate">{matchHint}</span>}
            </div>

            <div className="flex items-stretch gap-1.5">
              <NativeSelect
                id="folder-select"
                aria-label="目标分组"
                value={selectedFolder}
                onChange={(e) => {
                  userTouchedFolderRef.current = true;
                  setSelectedFolder(e.target.value);
                }}
              >
                {pendingFolders.map((pf) => (
                  <option key={pf.value} value={pf.value}>
                    ＋ 新建：{pf.displayLabel || pf.title}
                  </option>
                ))}
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.isRoot ? f.pathLabel : `${'　'.repeat(Math.max(0, f.depth - 1))}${f.title}`}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2.5 shrink-0"
                title="新建一级分组"
                onClick={() => {
                  setNewFolderOpen((v) => !v);
                  requestAnimationFrame(() => newFolderInputRef.current?.focus());
                }}
              >
                + 新建
              </Button>
            </div>

            {newFolderOpen && (
              <div className="flex items-stretch gap-1.5">
                <Input
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      confirmNewFolder();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setNewFolderOpen(false);
                      setNewFolderName('');
                    }
                  }}
                  placeholder="输入新分组名称…"
                  className="h-8 text-[12.5px]"
                />
                <Button size="xs" className="h-8" onClick={confirmNewFolder}>
                  确定
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  className="h-8"
                  onClick={() => {
                    setNewFolderOpen(false);
                    setNewFolderName('');
                  }}
                >
                  取消
                </Button>
              </div>
            )}

            {(quickPicks.length > 1 || offerReading || aiNewFolder) && (
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {aiNewFolder && (
                  <button
                    type="button"
                    onClick={() => {
                      userTouchedFolderRef.current = true;
                      setSelectedFolder(aiNewFolder.value);
                      setReasonLine(`保存时将新建「${aiNewFolder.displayLabel || aiNewFolder.title}」并存入`);
                    }}
                    className={cn(
                      'inline-flex items-center h-[22px] px-2 border border-dashed border-accent-line bg-surface shadow-[var(--badge-shadow)] text-accent text-[11px] font-medium leading-none cursor-pointer hover:bg-accent-soft',
                      selectedFolder === aiNewFolder.value && 'bg-accent-soft',
                    )}
                  >
                    + 建「{aiNewFolder.displayLabel || aiNewFolder.title}」
                  </button>
                )}
                {offerReading && (
                  <button
                    type="button"
                    onClick={() => {
                      userTouchedFolderRef.current = true;
                      ensurePendingFolder(READING_DEFAULT_NAME);
                      setReasonLine(`保存时将自动创建「${READING_DEFAULT_NAME}」并存入`);
                    }}
                    className={cn(
                      'inline-flex items-center h-[22px] px-2 border border-dashed border-accent-line bg-surface shadow-[var(--badge-shadow)] text-accent text-[11px] font-medium leading-none cursor-pointer hover:bg-accent-soft',
                      selectedFolder === `${NEW_PREFIX}${READING_DEFAULT_NAME}` && 'bg-accent-soft',
                    )}
                  >
                    + 建「{READING_DEFAULT_NAME}」
                  </button>
                )}
                {quickPicks.map((f) => {
                  const active = f.id === selectedFolder;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        userTouchedFolderRef.current = true;
                        setSelectedFolder(f.id);
                      }}
                      className={cn(
                        'inline-flex items-center h-[22px] px-2 border shadow-[var(--badge-shadow)] text-[11px] font-medium leading-none cursor-pointer transition-colors',
                        active
                          ? 'border-accent-line bg-accent-soft text-accent'
                          : 'border-line2 bg-surface text-ink2 hover:border-line3 hover:text-ink',
                      )}
                    >
                      {f.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 复选框 */}
          <div className="flex flex-col gap-2 pt-0.5">
            <label className="inline-flex items-center gap-2 text-[12.5px] text-ink2 cursor-pointer select-none">
              <Checkbox checked={favChecked} onCheckedChange={setFavChecked} />
              <Star className="w-3.5 h-3.5 text-amber fill-amber" />
              <span>同时加入「我的收藏」</span>
            </label>

            {trimHashLabel && (
              <label className="inline-flex items-center gap-2 text-[12.5px] text-ink2 cursor-pointer select-none">
                <Checkbox checked={cleanHashChecked} onCheckedChange={setCleanHashChecked} />
                <span>{trimHashLabel}</span>
              </label>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-line">
            {existing ? (
              <Button variant="danger-outline" disabled={saving} onClick={handleRemove}>
                移除
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => window.close()}>
                取消
              </Button>
              <Button disabled={saving} onClick={handleSave}>
                {existing ? '更新' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
