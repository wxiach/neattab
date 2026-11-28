import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bookmark,
  ChevronDown,
  CopyMinus,
  Download,
  Layers,
  Loader2,
  Moon,
  Search,
  Sparkles,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogHeader, DialogPopup } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu';
import { SettingsContent, type SettingsTab } from '@/components/SettingsContent';
import { BatchRenameDialog } from '@/components/BatchRenameDialog';
import { DedupDialog } from '@/components/DedupDialog';
import { ImportDialog } from '@/components/ImportDialog';
import { exportRoot } from '@/lib/transfer';
import {
  CreateFolderDialog,
  DeleteConfirmDialog,
  EditItemDialog,
} from '@/components/newtab/BookmarkDialogs';
import { SidebarNav } from '@/components/newtab/SidebarNav';
import { BookmarkSheet } from '@/components/newtab/BookmarkSheet';
import {
  isAiReady,
  requestDeepSeekPermission,
  semanticSearchBookmarks,
  type SemanticSearchHit,
} from '@/lib/ai';
import {
  buildRootTree,
  collectFolderItems,
  countBookmarkDescendants,
  findNode,
  getEditableFolderOptions,
  isHttpUrl,
  isInsideFolder,
  moveBookmarkBefore,
  moveBookmarkRelative,
  type BuiltRoot,
  type FolderSelectOption,
} from '@/lib/bookmarks';
import {
  addFavoriteCopyToRoot,
  collectGroupedUrls,
  migrateLegacyLocalFavorites,
  removeFavoriteCopyFromRoot,
  syncEditedBookmarkCopies,
} from '@/lib/favSync';
import {
  applyFont,
  applyTheme,
  DEFAULT_AI,
  DEFAULTS,
  hasExt,
  loadPrefs,
  resolveTheme,
  savePrefs,
  systemDarkMq,
} from '@/lib/storage';
import type { BookmarkItem, Prefs } from '@/lib/types';
import { cn } from '@/lib/cn';
import {
  collectSearchableBookmarks,
  computeDefaultFolderId,
  computeNewtabView,
  getAncestorChain,
  normalizeFolderId,
  type CreateTarget,
  type DeleteTarget,
  type DragState,
  type DropIndicator,
  type EditTarget,
} from '@/pages/newtab/newtabTypes';

const EMPTY_ROOT: BuiltRoot = {
  resolvedRootId: '1',
  rootName: '收藏夹',
  tops: [],
  loose: [],
  folderMap: new Map(),
  itemIndex: new Map(),
};

export function NewtabApp() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [tree, setTree] = useState<BuiltRoot>(EMPTY_ROOT);
  const [folderId, setFolderId] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(-1);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(DEFAULTS.theme));

  // 弹窗状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [savedToast, setSavedToast] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [editFolders, setEditFolders] = useState<FolderSelectOption[]>([]);
  const [editErr, setEditErr] = useState('');

  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [createName, setCreateName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // 拖拽状态
  const [drag, setDrag] = useState<DragState | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  // 按需 AI 语义搜索状态
  const [aiSearchStatus, setAiSearchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiSearchErr, setAiSearchErr] = useState('');
  const [aiSearchHits, setAiSearchHits] = useState<SemanticSearchHit[]>([]);
  const aiSearchCacheRef = useRef<Map<string, SemanticSearchHit[]>>(new Map());
  const aiSearchAbortRef = useRef<AbortController | null>(null);

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const openTimerRef = useRef<number>(0);
  const flashTimerRef = useRef<number>(0);

  const canEdit =
    hasExt &&
    typeof chrome.bookmarks.update === 'function' &&
    typeof chrome.bookmarks.removeTree === 'function' &&
    typeof chrome.bookmarks.create === 'function';

  const flash = useCallback((msg = '已保存') => {
    setSavedToast(msg);
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setSavedToast(''), 1500);
  }, []);

  const findFolder = useCallback((id: string) => (id ? tree.folderMap.get(id) || null : null), [tree.folderMap]);

  const isDescendant = useCallback(
    (id: string, maybeAncestorId: string) => {
      let cur = findFolder(id);
      while (cur) {
        if (cur.id === maybeAncestorId) return true;
        cur = findFolder(cur.parentId);
      }
      return false;
    },
    [findFolder],
  );

  const loadBookmarks = useCallback(async (overrideRootId?: string) => {
    if (!hasExt) return;
    let rawTree: chrome.bookmarks.BookmarkTreeNode[];
    try {
      rawTree = await chrome.bookmarks.getTree();
    } catch {
      return;
    }

    const rid = overrideRootId ?? prefsRef.current.rootId;
    const rootNode = findNode(rawTree[0], rid) || rawTree[0]?.children?.[0];
    if (!rootNode) return;

    const built = buildRootTree(rootNode);
    setTree(built);

    // 一次性迁移老版本存在本地 storage 的星标到收藏夹栏根目录
    if (prefsRef.current.favorites.length > 0) {
      const legacy = prefsRef.current.favorites;
      prefsRef.current = { ...prefsRef.current, favorites: [] };
      setPrefs((prev) => ({ ...prev, favorites: [] }));
      savePrefs({ favorites: [] });

      const migrated = await migrateLegacyLocalFavorites(
        built.resolvedRootId,
        legacy,
        built.loose,
        built.itemIndex,
      );
      if (migrated) {
        try {
          const [freshTree] = await chrome.bookmarks.getTree();
          const freshRoot = findNode(freshTree, built.resolvedRootId) || freshTree?.children?.[0];
          if (freshRoot) setTree(buildRootTree(freshRoot));
        } catch {
          /* 忽略 */
        }
      }
    }

    const curFid = folderIdRef.current;
    const nextFid = computeDefaultFolderId(built, curFid);
    if (nextFid !== curFid) setFolderId(nextFid);

    if (expandedRef.current.size === 0 && nextFid && nextFid !== '__favorites__') {
      setExpanded(new Set<string>([nextFid]));
    }
  }, []);

  // 初始化偏好并监听外部书签与设置变更
  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await loadPrefs();
      if (!alive) return;

      setPrefs(loaded);
      setResolvedTheme(applyTheme(loaded.theme));
      applyFont(loaded.font);

      const savedFid = loaded.view?.folderId || loaded.view?.subId || loaded.view?.topId || '';
      if (savedFid) {
        folderIdRef.current = savedFid;
        setFolderId(savedFid);
      }
      if (Array.isArray(loaded.expanded)) {
        const expSet = new Set(loaded.expanded);
        expandedRef.current = expSet;
        setExpanded(expSet);
      }

      prefsRef.current = loaded;
      await loadBookmarks(loaded.rootId);
    })();

    const onMq = () => setResolvedTheme(applyTheme(prefsRef.current.theme));
    systemDarkMq?.addEventListener('change', onMq);

    if (!hasExt) {
      return () => {
        alive = false;
        systemDarkMq?.removeEventListener('change', onMq);
      };
    }

    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes.theme) setResolvedTheme(applyTheme(changes.theme.newValue || DEFAULTS.theme));
      if (changes.font) applyFont(changes.font.newValue || DEFAULTS.font);
      if (changes.rootId) loadBookmarks(changes.rootId.newValue || DEFAULTS.rootId);

      setPrefs((prev) => {
        const next = { ...prev };
        if (changes.theme) next.theme = changes.theme.newValue || DEFAULTS.theme;
        if (changes.font) next.font = changes.font.newValue || DEFAULTS.font;
        if (changes.openMode) next.openMode = changes.openMode.newValue || DEFAULTS.openMode;
        if (changes.favorites && Array.isArray(changes.favorites.newValue)) {
          next.favorites = changes.favorites.newValue.filter((x: unknown): x is string => typeof x === 'string');
        }
        if (changes.ai && typeof changes.ai.newValue === 'object') {
          next.ai = { ...DEFAULT_AI, ...changes.ai.newValue };
        }
        if (changes.rootId) next.rootId = changes.rootId.newValue || DEFAULTS.rootId;
        return next;
      });
    };

    let reloadTimer = 0;
    const scheduleReload = () => {
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => loadBookmarks(), 150);
    };

    chrome.storage?.onChanged?.addListener(onStorageChange);
    chrome.bookmarks.onRemoved?.addListener(scheduleReload);
    chrome.bookmarks.onCreated?.addListener(scheduleReload);
    chrome.bookmarks.onChanged?.addListener(scheduleReload);
    chrome.bookmarks.onMoved?.addListener(scheduleReload);

    return () => {
      alive = false;
      window.clearTimeout(reloadTimer);
      systemDarkMq?.removeEventListener('change', onMq);
      chrome.storage?.onChanged?.removeListener(onStorageChange);
      chrome.bookmarks.onRemoved?.removeListener(scheduleReload);
      chrome.bookmarks.onCreated?.removeListener(scheduleReload);
      chrome.bookmarks.onChanged?.removeListener(scheduleReload);
      chrome.bookmarks.onMoved?.removeListener(scheduleReload);
    };
  }, [loadBookmarks]);

  const handlePatchPrefs = useCallback(
    (patch: Partial<Prefs>, msg = '已保存') => {
      if (patch.theme !== undefined) setResolvedTheme(applyTheme(patch.theme));
      if (patch.font !== undefined) applyFont(patch.font);
      setPrefs((prev) => ({ ...prev, ...patch }));
      savePrefs(patch);
      if (patch.rootId !== undefined) loadBookmarks(patch.rootId);
      if (msg) flash(msg);
    },
    [flash, loadBookmarks],
  );

  const selectFolder = useCallback(
    (id: string, toggle = false) => {
      window.clearTimeout(openTimerRef.current);

      if (id === '__favorites__') {
        setFolderId('__favorites__');
        setQuery('');
        savePrefs({ view: { folderId: '__favorites__' }, expanded: [...expandedRef.current] });
        return;
      }

      const fid = normalizeFolderId(id, tree.folderMap);
      const folder = tree.folderMap.get(fid);
      if (!folder) return;

      const nextExp = new Set(expandedRef.current);
      const chain = getAncestorChain(fid, tree.folderMap);
      for (let i = 0; i < chain.length - 1; i += 1) {
        nextExp.add(chain[i].id);
      }

      const already = folderIdRef.current === fid;
      if (toggle && already && folder.depth === 1 && folder.children.length > 0) {
        if (nextExp.has(fid)) nextExp.delete(fid);
        else nextExp.add(fid);
      } else if (folder.depth === 1 && folder.children.length > 0) {
        nextExp.add(fid);
      }

      setExpanded(nextExp);
      setFolderId(fid);
      setQuery('');
      savePrefs({ view: { folderId: fid }, expanded: [...nextExp] });
    },
    [tree.folderMap],
  );

  const looseIdSet = useMemo(() => new Set(tree.loose.map((it) => it.id)), [tree.loose]);
  const looseUrlSet = useMemo(() => new Set(tree.loose.map((it) => it.url)), [tree.loose]);
  const groupedUrlSet = useMemo(() => collectGroupedUrls(tree.tops), [tree.tops]);

  const toggleFavorite = useCallback(
    async (id: string) => {
      const entry = tree.itemIndex.get(id);
      if (!entry) return;

      const { item } = entry;
      const rootId = tree.resolvedRootId || prefsRef.current.rootId;

      if (looseUrlSet.has(item.url)) {
        if (!groupedUrlSet.has(item.url)) {
          // 仅存于根目录且无子分组原件：走二次确认防误删
          setDeleteTarget({ id: item.id, title: item.title, isFolder: false, descendantCount: 0 });
          return;
        }
        const removed = await removeFavoriteCopyFromRoot(rootId, item.url);
        if (removed) {
          await loadBookmarks();
          flash('已移出「我的收藏」');
        }
      } else {
        const added = await addFavoriteCopyToRoot(rootId, { title: item.title, url: item.url });
        if (added) {
          await loadBookmarks();
          flash('已加入「我的收藏」');
        }
      }
    },
    [flash, groupedUrlSet, loadBookmarks, looseUrlSet, tree.itemIndex, tree.resolvedRootId],
  );

  const openUrl = useCallback((url: string, forceNew: boolean) => {
    if (forceNew || prefsRef.current.openMode === 'tab') {
      window.open(url, '_blank', 'noopener');
    } else {
      window.location.href = url;
    }
  }, []);

  const searchableBookmarks = useMemo(() => collectSearchableBookmarks(tree), [tree]);
  const aiSearchReady = isAiReady(prefs.ai);

  // 书签树变动时清空会话内语义搜索缓存，避免返回失效书签 ID
  useEffect(() => {
    aiSearchCacheRef.current.clear();
  }, [tree]);

  // 搜索词变动时中止旧请求，并按会话缓存恢复或重置语义结果
  useEffect(() => {
    aiSearchAbortRef.current?.abort();
    aiSearchAbortRef.current = null;
    setAiSearchErr('');

    const key = query.trim().toLowerCase();
    if (!key) {
      setAiSearchHits([]);
      setAiSearchStatus('idle');
      return;
    }

    const cached = aiSearchCacheRef.current.get(key);
    if (cached) {
      setAiSearchHits(cached);
      setAiSearchStatus('done');
    } else {
      setAiSearchHits([]);
      setAiSearchStatus('idle');
    }
  }, [query]);

  const triggerAiSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !aiSearchReady) return;

    const granted = await requestDeepSeekPermission();
    if (!granted) {
      setAiSearchStatus('error');
      setAiSearchErr('未授予模型接口访问权限');
      return;
    }

    aiSearchAbortRef.current?.abort();
    const ac = new AbortController();
    aiSearchAbortRef.current = ac;

    setAiSearchStatus('loading');
    setAiSearchErr('');

    try {
      const hits = await semanticSearchBookmarks({
        ai: prefsRef.current.ai,
        query: q,
        items: searchableBookmarks.map((e) => ({
          id: e.item.id,
          title: e.item.title,
          host: e.item.host,
          folderPath: e.folderPath,
        })),
        signal: ac.signal,
      });

      if (ac.signal.aborted) return;
      aiSearchCacheRef.current.set(q.toLowerCase(), hits);
      setAiSearchHits(hits);
      setAiSearchStatus('done');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setAiSearchStatus('error');
      setAiSearchErr(err instanceof Error ? err.message : 'AI 语义搜索失败');
    } finally {
      if (aiSearchAbortRef.current === ac) aiSearchAbortRef.current = null;
    }
  }, [aiSearchReady, query, searchableBookmarks]);

  const view = useMemo(
    () =>
      computeNewtabView({
        tree,
        searchable: searchableBookmarks,
        folderId,
        query,
        looseUrlSet,
        groupedUrlSet,
        aiHits: aiSearchHits,
      }),
    [aiSearchHits, folderId, groupedUrlSet, looseUrlSet, query, searchableBookmarks, tree],
  );

  const activeAncestors = useMemo(() => {
    const set = new Set<string>();
    const chain = getAncestorChain(folderId, tree.folderMap);
    for (let i = 0; i < chain.length - 1; i += 1) {
      set.add(chain[i].id);
    }
    return set;
  }, [folderId, tree.folderMap]);

  const favCount = useMemo(() => {
    let n = 0;
    for (const it of tree.loose) {
      if (!groupedUrlSet.has(it.url)) n += 1;
    }
    for (const top of tree.tops) {
      const tmp: BookmarkItem[] = [];
      collectFolderItems(top, top.title, (it) => looseUrlSet.has(it.url), tmp);
      n += tmp.length;
    }
    return n;
  }, [groupedUrlSet, looseUrlSet, tree.loose, tree.tops]);

  useEffect(() => {
    if (view.filter === 'search' && view.rows.length > 0) setSel(0);
    else setSel(-1);
  }, [view.filter, view.rows.length, query]);

  // 全局键盘快捷键
  useEffect(() => {
    const anyModal =
      settingsOpen ||
      batchOpen ||
      dedupOpen ||
      importOpen ||
      Boolean(editTarget) ||
      Boolean(createTarget) ||
      Boolean(deleteTarget);

    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModal) return;

      const active = document.activeElement as HTMLElement | null;
      const typing = active === searchInputRef.current;
      const inField = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      const inMenu = Boolean(active?.closest?.('[role="menu"]'));

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus({ preventScroll: true });
        searchInputRef.current?.select();
        return;
      }

      if (e.key === '/') {
        if (!inField) {
          e.preventDefault();
          searchInputRef.current?.focus({ preventScroll: true });
          searchInputRef.current?.select();
        } else if (typing && !query) {
          e.preventDefault();
        }
        return;
      }

      // 页面内无弹窗且未聚焦输入框或菜单时，直接敲字符自动聚焦搜索框开始检索
      if (
        !inField &&
        !inMenu &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.isComposing &&
        e.key.length === 1 &&
        e.key !== ' '
      ) {
        searchInputRef.current?.focus({ preventScroll: true });
        return;
      }

      if (e.key === 'Escape') {
        if (query) {
          setQuery('');
        } else if (typing) {
          searchInputRef.current?.blur();
        } else {
          const cur = findFolder(folderId);
          if (cur && findFolder(cur.parentId)) selectFolder(cur.parentId);
        }
        return;
      }

      if (e.key === 'Tab' && view.filter === 'search' && view.rows.length > 0) {
        e.preventDefault();
        setSel((prev) => {
          const len = view.rows.length;
          const step = e.shiftKey ? -1 : 1;
          const next = prev < 0 ? (e.shiftKey ? len - 1 : 0) : (prev + step + len) % len;
          requestAnimationFrame(() => {
            document.querySelector(`[data-row-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }

      const onInteractive = Boolean((e.target as HTMLElement)?.closest?.('button, a'));
      if (
        e.key === 'Enter' &&
        view.filter === 'search' &&
        (typing || (!inField && !onInteractive))
      ) {
        // Shift+Enter：随时触发 AI 语义搜索；本地 0 结果时直接按 Enter 也可触发
        if (aiSearchReady && aiSearchStatus !== 'loading') {
          if (e.shiftKey || (view.rows.length === 0 && aiSearchStatus !== 'done')) {
            e.preventDefault();
            triggerAiSearch();
            return;
          }
        }

        if (view.rows.length > 0) {
          e.preventDefault();
          const it = view.rows[sel >= 0 ? sel : 0];
          if (!it) return;
          if (it.kind === 'folder') selectFolder(it.id);
          else openUrl(it.url, e.ctrlKey || e.metaKey);
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    aiSearchReady,
    aiSearchStatus,
    batchOpen,
    createTarget,
    dedupOpen,
    deleteTarget,
    editTarget,
    findFolder,
    folderId,
    importOpen,
    openUrl,
    query,
    sel,
    selectFolder,
    settingsOpen,
    triggerAiSearch,
    view,
  ]);

  /* ---------------- 书签编辑 / 新建 / 删除 / 拖拽 ---------------- */

  const openEditDialog = async (node: { id: string; title: string; url?: string; isFolder: boolean }) => {
    if (!canEdit) return;
    let fresh: chrome.bookmarks.BookmarkTreeNode | null = null;
    try {
      [fresh] = await chrome.bookmarks.get(node.id);
    } catch {
      fresh = null;
    }

    const orig: EditTarget = {
      id: node.id,
      title: fresh?.title ?? node.title,
      url: fresh?.url ?? node.url,
      parentId: fresh?.parentId ?? '',
      isFolder: fresh ? !fresh.url : node.isFolder,
    };

    const opts = await getEditableFolderOptions(tree.resolvedRootId || prefs.rootId, orig.isFolder ? orig.id : '');
    setEditFolders(opts);
    setEditTarget(orig);
    setEditTitle(orig.title);
    setEditUrl(orig.url || '');
    setEditParentId(orig.parentId && opts.some((f) => f.id === orig.parentId) ? orig.parentId : opts[0]?.id || '');
    setEditErr('');
  };

  const submitEdit = async () => {
    if (!editTarget) return;

    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      setEditErr('名称不能为空');
      return;
    }

    let nextUrl = editTarget.url || '';
    if (!editTarget.isFolder) {
      nextUrl = editUrl.trim();
      if (!isHttpUrl(nextUrl)) {
        setEditErr('请输入有效的 http:// 或 https:// 网址');
        return;
      }
    }

    try {
      const patch: { title?: string; url?: string } = {};
      if (nextTitle !== editTarget.title) patch.title = nextTitle;
      if (!editTarget.isFolder && nextUrl !== editTarget.url) patch.url = nextUrl;

      if (Object.keys(patch).length > 0) {
        await chrome.bookmarks.update(editTarget.id, patch);
        if (!editTarget.isFolder && editTarget.url) {
          await syncEditedBookmarkCopies(
            tree.resolvedRootId || prefsRef.current.rootId,
            editTarget.id,
            editTarget.url,
            patch,
          );
        }
      }

      if (editParentId && editParentId !== editTarget.parentId) {
        const blocked = editTarget.isFolder && (await isInsideFolder(editParentId, editTarget.id));
        if (!blocked) {
          await chrome.bookmarks.move(editTarget.id, { parentId: editParentId });
          setExpanded((prev) => new Set(prev).add(editParentId));
        }
      }
    } catch {
      /* 忽略 */
    }

    setEditTarget(null);
    await loadBookmarks();
  };

  const openCreateDialog = (parentId: string, dialogTitle: string) => {
    if (!canEdit || !parentId) return;
    setCreateName('');
    setCreateTarget({ parentId, dialogTitle });
  };

  const submitCreate = async () => {
    if (!createTarget) return;
    const name = createName.trim();
    if (!name) return;

    const pid = createTarget.parentId;
    setCreateTarget(null);
    try {
      await chrome.bookmarks.create({ parentId: pid, title: name });
      setExpanded((prev) => new Set(prev).add(pid));
    } catch {
      /* 忽略 */
    }

    await loadBookmarks();
    const parent = findFolder(pid);
    if (parent && parent.depth >= 2 && folderIdRef.current !== parent.id) {
      selectFolder(parent.id);
    }
  };

  const openDeleteDialog = async (node: { id: string; title: string; isFolder: boolean }) => {
    if (!canEdit) return;
    const descendantCount = node.isFolder ? await countBookmarkDescendants(node.id) : 0;
    setDeleteTarget({ ...node, descendantCount });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    try {
      if (target.isFolder) await chrome.bookmarks.removeTree(target.id);
      else await chrome.bookmarks.remove(target.id);
    } catch {
      /* 忽略 */
    }
    await loadBookmarks();
  };

  const endDrag = () => {
    setDrag(null);
    setTrashOver(false);
    setDropIndicator(null);
  };

  const startDrag = (id: string, isFolder: boolean, title: string, e: React.DragEvent) => {
    window.clearTimeout(openTimerRef.current);
    setDrag({ id, isFolder, title });
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      /* 忽略 */
    }
  };

  const doMoveInto = async (id: string, parentId: string) => {
    try {
      if (!id || !parentId || id === parentId) return;
      const [src] = await chrome.bookmarks.get(id);
      if (src && !src.url && (await isInsideFolder(parentId, id))) return;
      await chrome.bookmarks.move(id, { parentId });
    } catch {
      /* 忽略 */
    } finally {
      endDrag();
    }
    await loadBookmarks();
  };

  const doMoveBeforeCard = async (id: string, targetId: string) => {
    try {
      await moveBookmarkBefore(id, targetId);
    } catch {
      /* 忽略 */
    } finally {
      endDrag();
    }
    await loadBookmarks();
  };

  const doMoveRel = async (id: string, targetId: string, pos: 'before' | 'after') => {
    try {
      await moveBookmarkRelative(id, targetId, pos);
    } catch {
      /* 忽略 */
    } finally {
      endDrag();
    }
    await loadBookmarks();
  };

  const handleOpenBookmarkDelayed = (url: string) => {
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => openUrl(url, false), 150);
  };

  const handleExport = async () => {
    try {
      await exportRoot(prefs.rootId, prefs.favorites);
      flash('已导出 JSON');
    } catch {
      flash('导出失败');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-ink">
      {/* 顶栏：左侧品牌 / 右侧整理、备份与主题切换 */}
      <header className="no-print sticky top-0 z-20 h-[var(--topbar-h)] topbar-glass border-b border-line">
        <div className="nav-container h-full flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2.5 min-w-0">
            <span
              style={{ width: 'var(--brand-sz)', height: 'var(--brand-sz)' }}
              className="shrink-0 bg-accent-soft text-accent inline-flex items-center justify-center"
            >
              <Bookmark className="w-4 h-4 fill-current" />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span
                style={{ fontSize: 'var(--brand-fs)' }}
                className="font-semibold leading-[1.2] tracking-[-0.01em] text-ink truncate"
              >
                NeatTab
              </span>
              <span
                style={{ fontSize: 'var(--fs-meta)' }}
                className="leading-[1.2] text-ink3 truncate max-[720px]:hidden"
              >
                {prefs.rootId === DEFAULTS.rootId ? '书签导航' : tree.rootName}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Menu>
              <MenuTrigger
                style={{ height: 'var(--top-btn-sz)', fontSize: 'var(--fs-sub)' }}
                className="inline-flex items-center gap-1.5 px-2.5 border border-transparent text-ink2 hover:bg-background hover:border-line hover:text-ink data-[popup-open]:bg-background data-[popup-open]:border-line data-[popup-open]:text-ink cursor-pointer transition-colors"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>整理</span>
                <ChevronDown className="w-3 h-3 text-ink3 shrink-0" />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem onClick={() => setBatchOpen(true)}>
                  <Sparkles className="w-3.5 h-3.5 text-ink3 shrink-0" />
                  <span>AI 智能整理</span>
                </MenuItem>
                <MenuItem onClick={() => setDedupOpen(true)}>
                  <CopyMinus className="w-3.5 h-3.5 text-ink3 shrink-0" />
                  <span>扫描重复书签</span>
                </MenuItem>
              </MenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                style={{ height: 'var(--top-btn-sz)', fontSize: 'var(--fs-sub)' }}
                className="inline-flex items-center gap-1.5 px-2.5 border border-transparent text-ink2 hover:bg-background hover:border-line hover:text-ink data-[popup-open]:bg-background data-[popup-open]:border-line data-[popup-open]:text-ink cursor-pointer transition-colors"
              >
                <Archive className="w-3.5 h-3.5 shrink-0" />
                <span>备份</span>
                <ChevronDown className="w-3 h-3 text-ink3 shrink-0" />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem onClick={handleExport}>
                  <Download className="w-3.5 h-3.5 text-ink3 shrink-0" />
                  <span>导出 JSON</span>
                </MenuItem>
                <MenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="w-3.5 h-3.5 text-ink3 shrink-0" />
                  <span>导入 JSON</span>
                </MenuItem>
              </MenuPopup>
            </Menu>

            <span aria-hidden="true" className="w-px h-4 mx-1 bg-line" />

            <button
              type="button"
              title="切换浅色 / 深色"
              aria-label="切换主题"
              onClick={() => {
                const next = resolvedTheme === 'dark' ? 'light' : 'dark';
                handlePatchPrefs({ theme: next }, '');
              }}
              style={{ width: 'var(--top-btn-sz)', height: 'var(--top-btn-sz)' }}
              className="inline-flex items-center justify-center border border-transparent text-ink2 hover:bg-background hover:border-line hover:text-ink cursor-pointer transition-colors"
            >
              {resolvedTheme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* 主体两栏 */}
      <div className="nav-container nav-shell flex-1">
        <SidebarNav
          tops={tree.tops}
          rootId={tree.resolvedRootId || prefs.rootId}
          folderId={folderId}
          query={query}
          favCount={favCount}
          expanded={expanded}
          activeAncestors={activeAncestors}
          canEdit={canEdit}
          drag={drag}
          trashOver={trashOver}
          dropIndicator={dropIndicator}
          isDescendant={isDescendant}
          onSelectFolder={selectFolder}
          onOpenSettings={() => {
            setSettingsTab('general');
            setSettingsOpen(true);
          }}
          onOpenCreate={openCreateDialog}
          onOpenEdit={openEditDialog}
          onOpenDelete={openDeleteDialog}
          onStartDrag={startDrag}
          onEndDrag={endDrag}
          onTrashOverChange={setTrashOver}
          onDropIndicatorChange={setDropIndicator}
          onMoveInto={doMoveInto}
          onMoveRel={doMoveRel}
        />

        {/* 右侧主内容 */}
        <div className="min-w-0 min-h-[calc(100vh-var(--topbar-h))] flex flex-col pt-[var(--main-pt)]">
          {/* 标题 / 面包屑与搜索栏同行对齐 */}
          <div className="flex items-center justify-between gap-4 mb-[var(--head-mb)] min-h-[var(--search-h)] max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5">
            <div style={{ fontSize: 'var(--fs-title)' }} className="flex items-center gap-2 min-w-0 text-ink3 whitespace-nowrap">
              {view.filter === 'search' ? (
                <>
                  <span style={{ fontSize: 'var(--fs-sub)' }} className="text-ink2 tabular-nums">
                    {view.hits ?? 0} 项结果
                  </span>
                  {aiSearchStatus === 'error' && aiSearchErr && (
                    <Badge variant="danger">{aiSearchErr}</Badge>
                  )}
                </>
              ) : (
                view.crumb.map((entry, idx) => {
                  const last = idx === view.crumb.length - 1;
                  return (
                    <React.Fragment key={`${entry.title}-${idx}`}>
                      {idx > 0 && <span className="text-line3">/</span>}
                      {!last && entry.folderId ? (
                        <button
                          type="button"
                          onClick={() => selectFolder(entry.folderId!)}
                          className="px-1.5 py-0.5 -mx-1.5 border-0 bg-transparent text-ink3 hover:bg-hover hover:text-ink cursor-pointer"
                        >
                          {entry.title}
                        </button>
                      ) : (
                        <span
                          style={last ? { fontSize: 'var(--fs-cur)' } : undefined}
                          className={cn(last && 'font-semibold tracking-[-0.01em] text-ink truncate')}
                        >
                          {entry.title}
                        </span>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </div>

            <div
              style={{ width: 'min(var(--search-w), 64%)', height: 'var(--search-h)' }}
              className="no-print shrink-0 max-[640px]:w-full! flex items-center gap-2 px-2.5 pl-3 border border-line bg-surface shadow-[var(--shadow-card)] transition-all hover:border-line2 focus-within:border-accent-line focus-within:shadow-[0_0_0_3px_var(--blue-soft)]"
            >
              <Search className="w-3.5 h-3.5 text-ink3 shrink-0" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索全部收藏…"
                autoComplete="off"
                spellCheck={false}
                aria-label="搜索全部收藏"
                style={{ fontSize: 'var(--fs-title)' }}
                className="flex-1 min-w-0 bg-transparent border-0 text-ink placeholder:text-ink3 outline-none"
              />
              {query ? (
                <div className="flex items-center gap-0.5 shrink-0">
                  {aiSearchReady && (
                    <button
                      type="button"
                      disabled={aiSearchStatus === 'loading'}
                      title={
                        aiSearchStatus === 'loading'
                          ? 'AI 语义搜索中…'
                          : 'AI 语义搜索（Shift+Enter）'
                      }
                      aria-label="AI 语义搜索"
                      onClick={triggerAiSearch}
                      className={cn(
                        'inline-flex items-center justify-center w-[22px] h-[22px] cursor-pointer transition-colors disabled:opacity-60',
                        aiSearchStatus === 'done' && aiSearchHits.length > 0
                          ? 'text-accent hover:bg-hover'
                          : 'text-ink3 hover:bg-hover hover:text-accent',
                      )}
                    >
                      {aiSearchStatus === 'loading' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    title="清空搜索（Esc）"
                    aria-label="清空搜索"
                    onClick={() => {
                      setQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="inline-flex items-center justify-center w-[22px] h-[22px] text-ink3 hover:bg-hover hover:text-ink cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <Kbd className="text-ink3">/</Kbd>
              )}
            </div>
          </div>

          <main className="bg-surface border border-line shadow-[var(--shadow-card)] overflow-hidden">
            <BookmarkSheet
              view={view}
              folderId={folderId}
              query={query}
              sel={sel}
              canEdit={canEdit}
              drag={drag}
              dropIndicator={dropIndicator}
              looseIdSet={looseIdSet}
              looseUrlSet={looseUrlSet}
              groupedUrlSet={groupedUrlSet}
              isDescendant={isDescendant}
              onSelectFolder={(id) => selectFolder(id)}
              onOpenBookmark={handleOpenBookmarkDelayed}
              onCancelPendingOpen={() => window.clearTimeout(openTimerRef.current)}
              onToggleFavorite={toggleFavorite}
              onOpenEdit={openEditDialog}
              onStartDrag={startDrag}
              onEndDrag={endDrag}
              onDropIndicatorChange={setDropIndicator}
              onMoveInto={doMoveInto}
              onMoveBeforeCard={doMoveBeforeCard}
              onMoveRel={doMoveRel}
              aiSearchReady={aiSearchReady}
              aiSearchStatus={aiSearchStatus}
            />
          </main>

          {/* 页底快捷操作提示 */}
          <footer
            aria-label="快捷操作说明"
            style={{ fontSize: 'var(--fs-meta)' }}
            className="no-print mt-auto flex flex-wrap items-center justify-center gap-x-[18px] gap-y-2 pt-7 pb-5 px-1 text-ink3 opacity-78 hover:opacity-100 transition-opacity"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>/</Kbd> 搜索
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>Tab</Kbd> 切结果
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>Enter</Kbd> 打开
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>右键</Kbd> 编辑
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>拖拽</Kbd> 排序 / 左下角删除
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>★</Kbd> 收藏
            </span>
          </footer>
        </div>
      </div>

      {/* 系统设置弹窗 */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogPopup className="max-w-[var(--dlg-settings-w)] h-[min(540px,calc(100vh-56px))] flex flex-col overflow-hidden">
          <DialogHeader title="系统设置" />
          <SettingsContent
            key={settingsTab}
            layout="modal"
            initialTab={settingsTab}
            prefs={prefs}
            onPatch={handlePatchPrefs}
          />
          <div className="flex-none flex items-center justify-between gap-3 px-5 py-3 border-t border-line bg-background">
            <div className="flex items-center gap-3">
              <Button
                variant="link"
                onClick={() => {
                  handlePatchPrefs(
                    {
                      rootId: DEFAULTS.rootId,
                      openMode: DEFAULTS.openMode,
                      theme: DEFAULTS.theme,
                      font: DEFAULTS.font,
                      ai: { ...DEFAULT_AI },
                    },
                    '已恢复默认设置',
                  );
                }}
              >
                恢复默认设置
              </Button>
              {savedToast && <span className="text-xs text-accent">{savedToast}</span>}
            </div>
            <Button onClick={() => setSettingsOpen(false)}>完成</Button>
          </div>
        </DialogPopup>
      </Dialog>

      <BatchRenameDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        ai={prefs.ai}
        rootId={tree.resolvedRootId || prefs.rootId}
        tops={tree.tops}
        loose={tree.loose}
        favorites={prefs.favorites}
        currentFolderId={folderId}
        onOpenAiSettings={() => {
          setSettingsTab('ai');
          setSettingsOpen(true);
        }}
        onApplied={(count) => {
          loadBookmarks();
          if (count > 0) flash(`已整理 ${count} 条书签`);
        }}
      />

      <DedupDialog
        open={dedupOpen}
        onOpenChange={setDedupOpen}
        rootId={prefs.rootId}
        favorites={prefs.favorites}
        onDone={(res) => {
          loadBookmarks();
          const parts: string[] = [];
          if (res.movedToFav > 0) parts.push(`已移回 ${res.movedToFav} 条到我的收藏`);
          if (res.deleted > 0) parts.push(`已删除 ${res.deleted} 条重复书签`);
          if (parts.length > 0) flash(parts.join('，'));
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        rootId={prefs.rootId}
        favorites={prefs.favorites}
        onDone={(res) => {
          if (res.mode === 'replace') {
            setPrefs((prev) => ({ ...prev, favorites: res.favorites }));
            setExpanded(new Set());
          }
          loadBookmarks();
          flash(res.mode === 'replace' ? '已备份并替换导入' : '已追加导入');
        }}
      />

      {!settingsOpen && savedToast && (
        <div
          role="status"
          className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-3.5 py-2 border border-line2 bg-surface text-[12.5px] text-ink shadow-[var(--shadow-md)]"
        >
          {savedToast}
        </div>
      )}

      <EditItemDialog
        target={editTarget}
        title={editTitle}
        url={editUrl}
        parentId={editParentId}
        folders={editFolders}
        error={editErr}
        onTitleChange={(val) => {
          setEditTitle(val);
          setEditErr('');
        }}
        onUrlChange={(val) => {
          setEditUrl(val);
          setEditErr('');
        }}
        onParentChange={setEditParentId}
        onClose={() => setEditTarget(null)}
        onSubmit={submitEdit}
      />

      <CreateFolderDialog
        target={createTarget}
        name={createName}
        onNameChange={setCreateName}
        onClose={() => setCreateTarget(null)}
        onSubmit={submitCreate}
      />

      <DeleteConfirmDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
