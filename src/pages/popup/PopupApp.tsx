import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Favicon } from '@/components/Favicon';
import {
  FolderQuickPicks,
  PopupHeader,
  PopupNoticeView,
  type NoticeState,
  type PendingFolder,
} from '@/components/popup/PopupParts';
import { isAiReady, suggestBookmarkWithDeepSeek } from '@/lib/ai';
import { extractActiveTabContext, type PageContext } from '@/lib/pageContext';
import { buildRootTree, findNode } from '@/lib/bookmarks';
import {
  addFavoriteCopyToRoot,
  removeFavoriteCopyFromRoot,
  syncEditedBookmarkCopies,
} from '@/lib/favSync';
import {
  buildFolders,
  cleanTitle,
  detectPageKind,
  findReadingFolder,
  parseUrl,
} from '@/lib/urlRules';
import { applyFont, applyTheme, DEFAULTS, loadPrefs, savePrefs } from '@/lib/storage';
import type { FlatFolder, PageKind, Prefs, UrlInfo } from '@/lib/types';

const NEW_PREFIX = '__new__:';
const READING_DEFAULT_NAME = '阅读清单';

function getTitleToggleLabel(isUsingClean: boolean, hasAiTitle: boolean): string {
  if (isUsingClean) {
    return hasAiTitle ? 'AI 精简 · 还原原标题' : '已精简 · 还原';
  }
  return hasAiTitle ? '使用 AI 名称' : '使用精简名';
}

function computeDefaultSelection(
  folderList: FlatFolder[],
  kind: PageKind,
  rootId: string,
  lastFolderId: string,
) {
  const lastFolder = folderList.find((f) => f.id === lastFolderId) || null;
  const firstFolder =
    folderList.find((f) => !f.isRoot && !f.hasChildren) ||
    folderList.find((f) => !f.isRoot) ||
    folderList[0] ||
    null;
  const fallbackFolder = lastFolder || firstFolder;
  const readingFolder = findReadingFolder(folderList);

  if (kind.kind === 'content') {
    if (readingFolder) {
      const quick = fallbackFolder ? [readingFolder, fallbackFolder] : [readingFolder];
      return {
        chosenVal: readingFolder.id,
        reason: `识别为具体内容，优先归入「${readingFolder.pathLabel}」`,
        hint: '内容页 · 优先阅读清单',
        badge: '阅读清单',
        quick,
        wantReading: false,
        pending: [] as PendingFolder[],
      };
    }

    const pendingVal = `${NEW_PREFIX}${READING_DEFAULT_NAME}`;
    return {
      chosenVal: pendingVal,
      reason: '识别为帖子/文章，建议与站点入口分开存放',
      hint: '建议新建阅读清单',
      badge: '内容页',
      quick: fallbackFolder ? [fallbackFolder] : [],
      wantReading: true,
      pending: [{ value: pendingVal, title: READING_DEFAULT_NAME }],
    };
  }

  return {
    chosenVal: fallbackFolder ? fallbackFolder.id : rootId,
    reason: lastFolder ? `默认归入上次使用的「${lastFolder.pathLabel}」` : '请选择保存分组',
    hint: '',
    badge: '',
    quick: [] as FlatFolder[],
    wantReading: false,
    pending: [] as PendingFolder[],
  };
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
  const [folders, setFolders] = useState<FlatFolder[]>([]);
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);

  const [rawTitle, setRawTitle] = useState('');
  const [cleanName, setCleanName] = useState('');
  const [aiSuggestedTitle, setAiSuggestedTitle] = useState('');
  const [title, setTitle] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [quickPicks, setQuickPicks] = useState<FlatFolder[]>([]);
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

  const runAiSuggestion = useCallback(
    async (
      args: {
        ai: Prefs['ai'];
        tabId?: number;
        url: string;
        origTitle: string;
        kind: PageKind;
        folderList: FlatFolder[];
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
          setPendingFolders((prev) => (prev.some((p) => p.value === val) ? prev : [pendingItem, ...prev]));

          if (forceOverwrite || !userTouchedFolderRef.current) {
            setSelectedFolder(val);
          }
          setReasonLine(
            readBody ? `AI 已分析内容 · 建议新建「${displayLabel}」` : `AI 建议新建「${displayLabel}」`,
          );
        } else if (res.folderId) {
          setAiNewFolder(null);
          const folder = args.folderList.find((f) => f.id === res.folderId);
          if (forceOverwrite || !userTouchedFolderRef.current) {
            setSelectedFolder(res.folderId);
          }
          if (folder) {
            setQuickPicks((prev) => [folder, ...prev.filter((f) => f.id !== folder.id)].slice(0, 4));
            setReasonLine(
              readBody ? `AI 已分析页面内容 · 推荐「${folder.pathLabel}」` : `AI 推荐「${folder.pathLabel}」`,
            );
          }
        }

        setMatchHint(res.reason || 'AI 智能推荐');
        setBadgeText(`AI · ${res.latencyMs}ms`);
        setBadgeVariant('success');
        setAiStatus('done');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAiStatus('error');
        setAiError(err instanceof Error ? err.message : 'AI 请求失败');
      } finally {
        if (aiAbortRef.current === ac) aiAbortRef.current = null;
      }
    },
    [],
  );

  // 初始化当前标签页信息与书签树
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

      const built = buildRootTree(root);
      const looseUrlSet = new Set(built.loose.map((it) => it.url));
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
        // 优先匹配子分组中的原件，再退回到根目录副本
        hitExisting =
          hits.find((h) => h.parentId && h.parentId !== root.id && folderMap.has(h.parentId)) ||
          hits.find((h) => h.parentId && folderMap.has(h.parentId)) ||
          hits[0] ||
          null;
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
        const curF = hitExisting.parentId ? folderMap.get(hitExisting.parentId) : undefined;

        setRawTitle(origT);
        setCleanName(cleanedT);
        setTitle(origT);
        setBadgeText('已收藏');
        setBadgeVariant('info');
        setReasonLine(curF ? `当前位于「${curF.pathLabel}」` : '当前已保存在其它目录');
        setSelectedFolder(curF ? curF.id : root.id);
        setFavChecked(looseUrlSet.has(hitExisting.url || uInfo.cleanUrl));
      } else {
        const def = computeDefaultSelection(folderList, kind, root.id, loadedPrefs.lastFolderId);
        const dedupQuick = def.quick.filter((f, idx, arr) => f && arr.findIndex((x) => x.id === f.id) === idx);
        const origT = (activeTab.title || '').trim() || uInfo.host;
        const cleanedT = cleanTitle(origT, uInfo, kind);

        setPendingFolders(def.pending);
        setSelectedFolder(def.chosenVal);
        setQuickPicks(dedupQuick);
        setOfferReading(def.wantReading);
        setRawTitle(origT);
        setCleanName(cleanedT);
        setTitle(cleanedT);
        setReasonLine(def.reason);
        setMatchHint(def.hint);
        setBadgeText(def.badge);
        setBadgeVariant('info');

        if (isAiReady(loadedPrefs.ai)) {
          runAiSuggestion(
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
  }, [runAiSuggestion]);

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

      if (existing) {
        const patch: { title?: string; url?: string } = {};
        if (finalTitle !== existing.title) patch.title = finalTitle;
        if (finalUrl !== existing.url) patch.url = finalUrl;
        if (Object.keys(patch).length > 0) {
          await chrome.bookmarks.update(existing.id, patch);
          if (existing.url) {
            await syncEditedBookmarkCopies(rootNode.id, existing.id, existing.url, patch);
          }
        }
        if (parentId !== existing.parentId) {
          await chrome.bookmarks.move(existing.id, { parentId });
        }
      } else {
        await chrome.bookmarks.create({ parentId, title: finalTitle, url: finalUrl });
      }

      if (parentId !== rootNode.id) {
        if (favChecked) {
          await addFavoriteCopyToRoot(rootNode.id, { title: finalTitle, url: finalUrl });
        } else {
          await removeFavoriteCopyFromRoot(rootNode.id, finalUrl);
        }
      }

      await savePrefs({ lastFolderId: parentId });
      setNotice({
        title: existing ? '已更新收藏' : '已加入收藏',
        subtitle: `分组：${targetName}`,
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
      <PopupHeader
        isEditing={Boolean(existing)}
        aiStatus={aiStatus}
        aiError={aiError}
        aiEnabled={aiEnabled}
        canRetryAi={Boolean(ready && !notice && urlInfo?.ok)}
        badgeText={badgeText}
        badgeVariant={badgeVariant}
        onRetryAi={() => {
          if (!urlInfo?.ok) return;
          userTouchedTitleRef.current = false;
          userTouchedFolderRef.current = false;
          runAiSuggestion(
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
      />

      {notice ? (
        <PopupNoticeView notice={notice} />
      ) : !ready ? (
        <div className="px-5 py-10 flex items-center justify-center gap-2 text-xs text-ink3">
          <Loader2 className="w-4 h-4 animate-spin" />
          读取中…
        </div>
      ) : (
        <div className="px-4 pt-3.5 pb-4 flex flex-col gap-3">
          {/* 页面预览 */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 bg-background border border-line">
            <Favicon url={tab?.url || ''} fallbackText={urlInfo?.host || '?'} className="w-7 h-7 p-1 text-xs" />
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[11.5px] text-ink2 truncate">{urlInfo?.host}</span>
                <Badge variant={pageKind.kind === 'content' ? 'warning' : 'default'}>{pageKind.label}</Badge>
              </div>
              <div className="text-[11px] text-ink3 truncate">
                {aiStatus === 'error' ? `${reasonLine}（AI：${aiError}）` : reasonLine}
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
                  {getTitleToggleLabel(isUsingClean, Boolean(aiSuggestedTitle))}
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

            <FolderQuickPicks
              aiNewFolder={aiNewFolder}
              offerReading={offerReading}
              readingFolderName={READING_DEFAULT_NAME}
              readingPendingValue={`${NEW_PREFIX}${READING_DEFAULT_NAME}`}
              quickPicks={quickPicks}
              selectedFolder={selectedFolder}
              onSelectAiNewFolder={() => {
                if (!aiNewFolder) return;
                userTouchedFolderRef.current = true;
                setSelectedFolder(aiNewFolder.value);
                setReasonLine(`保存时将新建「${aiNewFolder.displayLabel || aiNewFolder.title}」并存入`);
              }}
              onSelectReadingNewFolder={() => {
                userTouchedFolderRef.current = true;
                ensurePendingFolder(READING_DEFAULT_NAME);
                setReasonLine(`保存时将自动创建「${READING_DEFAULT_NAME}」并存入`);
              }}
              onSelectFolder={(id) => {
                userTouchedFolderRef.current = true;
                setSelectedFolder(id);
              }}
            />
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
