import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronRight,
  Folder,
  FolderOpen,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Dialog, DialogDescription, DialogHeader, DialogPopup } from '@/components/ui/dialog';
import { Favicon } from '@/components/Favicon';
import { SettingsContent, type SettingsTab } from '@/components/SettingsContent';
import { BatchRenameDialog } from '@/components/BatchRenameDialog';
import {
  buildReadingRows,
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
  getExtensionVersion,
  hasExt,
  loadPrefs,
  READING_FOLDER_RE,
  resolveTheme,
  savePrefs,
  systemDarkMq,
} from '@/lib/storage';
import type { BookmarkItem, FolderNode, Prefs } from '@/lib/types';
import { cn } from '@/lib/cn';

type ViewRow =
  | (BookmarkItem & { kind: 'link' })
  | { kind: 'folder'; id: string; title: string; count: number };

interface ViewSection {
  id: string;
  title: string;
  editable: boolean;
  items: Array<BookmarkItem & { kind: 'link' }>;
}

interface CrumbEntry {
  title: string;
  folderId?: string;
}

interface ComputedView {
  filter: 'folder' | 'search';
  rows: ViewRow[];
  sections?: ViewSection[];
  group: boolean;
  reading?: boolean;
  splitSections?: boolean;
  crumb: CrumbEntry[];
  hits?: number;
}

interface DragState {
  id: string;
  title: string;
  isFolder: boolean;
}

interface EditTarget {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  isFolder: boolean;
}

interface DeleteTarget {
  id: string;
  title: string;
  isFolder: boolean;
  descendantCount: number;
}

interface CreateTarget {
  parentId: string;
  dialogTitle: string;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q, from);
  if (at < 0) return <>{text}</>;
  let key = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={key++}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

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
  const [dropIndicator, setDropIndicator] = useState<{ id: string; mode: 'into' | 'before' | 'after' } | null>(null);

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

  const ancestorChain = useCallback(
    (id: string) => {
      const chain: FolderNode[] = [];
      let cur = findFolder(id);
      while (cur) {
        chain.unshift(cur);
        cur = findFolder(cur.parentId);
      }
      return chain;
    },
    [findFolder],
  );

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

  const normalizeFolderId = useCallback(
    (id: string, map: Map<string, FolderNode>) => {
      if (!id || id === '__favorites__') return id;
      let cur = map.get(id) || null;
      while (cur && cur.depth > 2) cur = map.get(cur.parentId) || null;
      return cur ? cur.id : '';
    },
    [],
  );

  const computeDefaultFolderId = useCallback(
    (built: BuiltRoot, candidateId: string) => {
      const norm = normalizeFolderId(candidateId, built.folderMap);
      if (norm === '__favorites__' || (norm && built.folderMap.has(norm))) return norm;
      const first = built.tops.find((t) => t.children.length > 0) || built.tops[0];
      return first ? first.id : '__favorites__';
    },
    [normalizeFolderId],
  );

  const loadBookmarks = useCallback(
    async (overrideRootId?: string) => {
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
        const nextExp = new Set<string>([nextFid]);
        setExpanded(nextExp);
      }
    },
    [computeDefaultFolderId],
  );

  // 初始化偏好与订阅
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
      const chain = ancestorChain(fid);
      for (let i = 0; i < chain.length - 1; i += 1) nextExp.add(chain[i].id);

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
    [ancestorChain, normalizeFolderId, tree.folderMap],
  );

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

  // 计算当前视图
  const view = useMemo<ComputedView>(() => {
    const q = query.trim().toLowerCase();
    const matchRow = (it: BookmarkItem) =>
      it.title.toLowerCase().includes(q) || it.url.toLowerCase().includes(q);

    if (q) {
      const rows: ViewRow[] = [];
      const seenUrls = new Set<string>();
      for (const t of tree.tops) {
        const tmp: BookmarkItem[] = [];
        collectFolderItems(t, t.title, matchRow, tmp);
        for (const it of tmp) {
          seenUrls.add(it.url);
          rows.push({ ...it, kind: 'link' });
        }
      }
      const looseHits: ViewRow[] = [];
      for (const it of tree.loose) {
        if (matchRow(it) && !seenUrls.has(it.url)) {
          looseHits.push({ ...it, kind: 'link', group: '未分组' });
        }
      }
      const combined = [...looseHits, ...rows];
      return { filter: 'search', rows: combined, group: true, crumb: [{ title: '搜索' }], hits: combined.length };
    }

    if (folderId === '__favorites__') {
      const rows: ViewRow[] = [];
      for (const it of tree.loose) {
        if (!groupedUrlSet.has(it.url)) {
          rows.push({ ...it, kind: 'link', group: '未分组' });
        }
      }
      for (const t of tree.tops) {
        const tmp: BookmarkItem[] = [];
        collectFolderItems(t, t.title, (it) => looseUrlSet.has(it.url), tmp);
        for (const it of tmp) rows.push({ ...it, kind: 'link' });
      }
      return { filter: 'folder', rows, group: rows.length > 0, crumb: [{ title: '我的收藏' }] };
    }

    const activeFid = computeDefaultFolderId(tree, folderId);
    const folder = tree.folderMap.get(activeFid);
    if (!folder) {
      return { filter: 'folder', rows: [], group: false, crumb: [{ title: tree.rootName }] };
    }

    const crumb: CrumbEntry[] = ancestorChain(folder.id).map((f) => ({ title: f.title, folderId: f.id }));

    if (READING_FOLDER_RE.test(folder.title) && folder.children.length === 0) {
      const rows: ViewRow[] = buildReadingRows(folder.items).map((it) => ({ ...it, kind: 'link' }));
      return { filter: 'folder', rows, group: rows.length > 0, reading: true, crumb };
    }

    if (folder.depth >= 2 && folder.children.length > 0) {
      const sections: ViewSection[] = [];
      const rows: ViewRow[] = [];
      if (folder.items.length > 0) {
        const items = folder.items.map((it) => ({ ...it, kind: 'link' as const, group: '' }));
        sections.push({ id: folder.id, title: '直属书签', editable: false, items });
        rows.push(...items);
      }
      for (const c of folder.children) {
        const tmp: BookmarkItem[] = [];
        collectFolderItems(c, '', null, tmp);
        const items = tmp.map((it) => ({ ...it, kind: 'link' as const }));
        sections.push({ id: c.id, title: c.title, editable: true, items });
        rows.push(...items);
      }
      return { filter: 'folder', rows, sections, group: false, crumb };
    }

    const rows: ViewRow[] = [
      ...folder.items.map((it) => ({ ...it, kind: 'link' as const, group: '' })),
      ...folder.children.map((c) => ({ kind: 'folder' as const, id: c.id, title: c.title, count: c.totalCount })),
    ];
    return {
      filter: 'folder',
      rows,
      group: false,
      splitSections: folder.items.length > 0 && folder.children.length > 0,
      crumb,
    };
  }, [ancestorChain, computeDefaultFolderId, folderId, groupedUrlSet, looseUrlSet, query, tree]);

  // 搜索时默认选中第一条
  useEffect(() => {
    if (view.filter === 'search' && view.rows.length > 0) setSel(0);
    else setSel(-1);
  }, [view.filter, view.rows.length, query]);

  // 全局键盘快捷键
  useEffect(() => {
    const anyModal = settingsOpen || batchOpen || Boolean(editTarget) || Boolean(createTarget) || Boolean(deleteTarget);
    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModal) return;
      const active = document.activeElement as HTMLElement | null;
      const typing = active === searchInputRef.current;
      const inField = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);

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
          const next = prev < 0 ? (e.shiftKey ? len - 1 : 0) : (prev + (e.shiftKey ? -1 : 1) + len) % len;
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
        view.rows.length > 0 &&
        (typing || (!inField && !onInteractive))
      ) {
        e.preventDefault();
        const it = view.rows[sel >= 0 ? sel : 0];
        if (!it) return;
        if (it.kind === 'folder') selectFolder(it.id);
        else openUrl(it.url, e.ctrlKey || e.metaKey);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    batchOpen,
    createTarget,
    deleteTarget,
    editTarget,
    findFolder,
    folderId,
    openUrl,
    query,
    sel,
    selectFolder,
    settingsOpen,
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
    const orig = {
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
      if (Object.keys(patch).length) {
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

  /* ---------------- 侧边栏渲染 ---------------- */

  const activeAncestors = useMemo(() => {
    const set = new Set<string>();
    const chain = ancestorChain(folderId);
    for (let i = 0; i < chain.length - 1; i += 1) set.add(chain[i].id);
    return set;
  }, [ancestorChain, folderId]);

  const favCount = useMemo(() => {
    let n = 0;
    for (const it of tree.loose) {
      if (!groupedUrlSet.has(it.url)) n += 1;
    }
    for (const t of tree.tops) {
      const tmp: BookmarkItem[] = [];
      collectFolderItems(t, t.title, (it) => looseUrlSet.has(it.url), tmp);
      n += tmp.length;
    }
    return n;
  }, [groupedUrlSet, looseUrlSet, tree.loose, tree.tops]);

  const looseIdSet = useMemo(() => new Set(tree.loose.map((it) => it.id)), [tree.loose]);

  const resolveNavDrop = (e: React.DragEvent, targetEl: HTMLElement, node: FolderNode): '' | 'into' | 'before' | 'after' => {
    if (!drag || drag.id === node.id) return '';
    if (!drag.isFolder) return 'into';
    if (isDescendant(node.id, drag.id)) return '';
    const rect = targetEl.getBoundingClientRect();
    const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    if (relY < 0.28) return 'before';
    if (relY > 0.72) return 'after';
    return 'into';
  };

  const renderNavBranch = (folder: FolderNode): React.ReactNode => {
    const isTop = folder.depth === 1;
    const canExpand = isTop && folder.children.length > 0;
    const isOpen = canExpand && (expanded.has(folder.id) || activeAncestors.has(folder.id));
    const isActive = !query && (folderId === folder.id || (!isTop && activeAncestors.has(folder.id)));
    const dropMode = dropIndicator?.id === folder.id ? dropIndicator.mode : null;

    return (
      <div key={folder.id}>
        <div
          className={cn('relative group/row', drag?.id === folder.id && 'opacity-40')}
          draggable={canEdit}
          onDragStart={(e) => canEdit && startDrag(folder.id, true, folder.title, e)}
          onDragEnd={endDrag}
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            openEditDialog({ id: folder.id, title: folder.title, isFolder: true });
          }}
          onDragOver={(e) => {
            if (!canEdit) return;
            const mode = resolveNavDrop(e, e.currentTarget, folder);
            if (!mode) {
              if (dropIndicator?.id === folder.id) setDropIndicator(null);
              return;
            }
            e.preventDefault();
            setDropIndicator({ id: folder.id, mode });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node) && dropIndicator?.id === folder.id) {
              setDropIndicator(null);
            }
          }}
          onDrop={(e) => {
            if (!canEdit || !drag) return;
            const mode = resolveNavDrop(e, e.currentTarget, folder);
            setDropIndicator(null);
            if (!mode) return;
            e.preventDefault();
            e.stopPropagation();
            if (mode === 'into') doMoveInto(drag.id, folder.id);
            else doMoveRel(drag.id, folder.id, mode);
          }}
        >
          <button
            type="button"
            onClick={() => selectFolder(folder.id, true)}
            style={
              isTop
                ? { height: 'var(--nav-h)', fontSize: 'var(--fs-title)' }
                : { height: 'var(--nav-sub-h)', paddingLeft: 'var(--nav-indent-base)', fontSize: 'var(--fs-sub)' }
            }
            className={cn(
              'relative w-full flex items-center border border-transparent bg-transparent text-left cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2',
              isTop ? 'gap-2.5 px-2.5 font-semibold text-ink' : 'gap-2 pr-2.5 my-0.5 text-ink2',
              isActive
                ? 'bg-surface border-line shadow-[var(--shadow-sm)] text-ink font-medium'
                : 'hover:bg-hover hover:text-ink',
              dropMode === 'into' && 'bg-accent-soft border-accent-line',
              dropMode === 'before' && 'shadow-[inset_0_2px_0_0_var(--blue)]',
              dropMode === 'after' && 'shadow-[inset_0_-2px_0_0_var(--blue)]',
            )}
          >
            {isTop ? (
              isOpen ? (
                <FolderOpen className="w-4 h-4 shrink-0 text-ink3" />
              ) : (
                <Folder className="w-4 h-4 shrink-0 text-ink3" />
              )
            ) : (
              isActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-[18px] w-1.5 h-1.5 rounded-full bg-accent"
                />
              )
            )}
            <span className="min-w-0 truncate">{folder.title}</span>
            <span
              style={{ fontSize: 'var(--fs-meta)' }}
              className={cn(
                'ml-auto px-1.5 py-[1px] font-mono font-normal tabular-nums transition-opacity',
                isActive ? 'bg-subtle text-ink2' : 'bg-hover text-ink3',
                canEdit && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0',
              )}
            >
              {folder.totalCount}
            </span>
          </button>

          {canEdit && (
            <button
              type="button"
              title={`在「${folder.title}」下新建子分组`}
              aria-label={`在「${folder.title}」下新建子分组`}
              onClick={(e) => {
                e.stopPropagation();
                openCreateDialog(folder.id, '新建子分组');
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-[22px] h-[22px] border border-transparent text-ink3 opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto hover:bg-surface hover:border-line2 hover:text-ink cursor-pointer transition-opacity"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        {isOpen && (
          <div className="py-0.5">{folder.children.map((c) => renderNavBranch(c))}</div>
        )}
      </div>
    );
  };

  /* ---------------- 书签网格卡片渲染 ---------------- */

  const canReorderCard = view.filter !== 'search' && folderId !== '__favorites__' && !view.reading;
  const canDragCard = canEdit && folderId !== '__favorites__';
  const searchHighlight = view.filter === 'search' ? query.trim() : '';

  const renderCell = (it: ViewRow, idx: number) => {
    const isSel = view.filter === 'search' && sel === idx;
    const isDropInto = dropIndicator?.id === it.id && dropIndicator.mode === 'into';

    if (it.kind === 'folder') {
      return (
        <button
          key={`f-${it.id}`}
          type="button"
          data-row-idx={idx}
          onClick={() => selectFolder(it.id)}
          draggable={canEdit}
          onDragStart={(e) => canEdit && startDrag(it.id, true, it.title, e)}
          onDragEnd={endDrag}
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            openEditDialog({ id: it.id, title: it.title, isFolder: true });
          }}
          onDragOver={(e) => {
            if (!canEdit || !drag || drag.isFolder) return;
            e.preventDefault();
            setDropIndicator({ id: it.id, mode: 'into' });
          }}
          onDragLeave={() => {
            if (dropIndicator?.id === it.id) setDropIndicator(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropIndicator(null);
            if (drag && !drag.isFolder) doMoveInto(drag.id, it.id);
          }}
          style={{ padding: 'var(--cell-py) var(--cell-px)', gap: 'var(--cell-gap)' }}
          className={cn(
            'bm-cell group relative flex items-center min-w-0 bg-surface text-left cursor-pointer transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-[-2px]',
            drag?.id === it.id && 'opacity-40',
            isDropInto && 'relative z-[2] bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
            isSel && 'relative z-[2] bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
          )}
        >
          <span
            style={{ width: 'var(--ico-sz)', height: 'var(--ico-sz)' }}
            className="shrink-0 inline-flex items-center justify-center border border-line bg-background text-ink3"
          >
            <Folder className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium text-ink truncate">
              {it.title}
            </span>
            <span style={{ fontSize: 'var(--fs-meta)' }} className="text-ink3 tabular-nums truncate">
              {it.count} 项书签
            </span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-ink3 opacity-45 shrink-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
        </button>
      );
    }

    const isLoose = looseIdSet.has(it.id);
    const isFav = looseUrlSet.has(it.url);
    const canToggleStar = !isLoose || groupedUrlSet.has(it.url);

    return (
      <a
        key={`l-${it.id}`}
        href={it.url}
        title={`${it.title}\n${it.url}`}
        data-row-idx={idx}
        draggable={canDragCard}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-fav-btn]')) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          window.clearTimeout(openTimerRef.current);
          openTimerRef.current = window.setTimeout(() => openUrl(it.url, false), 150);
        }}
        onDragStart={(e) => canDragCard && startDrag(it.id, false, it.title, e)}
        onDragEnd={endDrag}
        onContextMenu={(e) => {
          if (!canEdit) return;
          window.clearTimeout(openTimerRef.current);
          e.preventDefault();
          openEditDialog({ id: it.id, title: it.title, url: it.url, isFolder: false });
        }}
        onDragOver={(e) => {
          if (!canEdit || !canReorderCard || !drag || drag.isFolder || drag.id === it.id) return;
          e.preventDefault();
          setDropIndicator({ id: it.id, mode: 'into' });
        }}
        onDragLeave={() => {
          if (dropIndicator?.id === it.id) setDropIndicator(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropIndicator(null);
          if (canEdit && canReorderCard && drag && !drag.isFolder && drag.id !== it.id) {
            doMoveBeforeCard(drag.id, it.id);
          }
        }}
        style={{ padding: 'var(--cell-py) var(--cell-px)', gap: 'var(--cell-gap)' }}
        className={cn(
          'bm-cell group relative flex items-center min-w-0 bg-surface text-inherit no-underline cursor-pointer transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-[-2px]',
          drag?.id === it.id && 'opacity-40',
          isDropInto && 'bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]',
          isSel && 'bg-accent-soft shadow-[inset_3px_0_0_0_var(--blue)]',
        )}
      >
        <Favicon
          url={it.url}
          fallbackText={it.host || it.title}
          className="w-[var(--ico-sz)] h-[var(--ico-sz)] p-[var(--ico-pad)] text-xs"
        />
        <span className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium text-ink truncate">
            <HighlightText text={it.title} query={searchHighlight} />
          </span>
          <span
            style={{ fontSize: 'var(--fs-meta)' }}
            className={cn('text-ink3 truncate tabular-nums', !it.subText && 'font-mono')}
          >
            <HighlightText text={it.subText || it.host} query={searchHighlight} />
          </span>
        </span>

        {canToggleStar && (
          <span
            data-fav-btn="true"
            role="button"
            tabIndex={0}
            title={isFav ? '取消收藏' : '加入「我的收藏」'}
            aria-label={isFav ? '取消收藏' : '加入「我的收藏」'}
            aria-pressed={isFav}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFavorite(it.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                toggleFavorite(it.id);
              }
            }}
            className={cn(
              'shrink-0 inline-flex items-center justify-center w-[calc(var(--fs-title)+12px)] h-[calc(var(--fs-title)+12px)] border border-transparent transition-all cursor-pointer hover:bg-surface hover:border-line2 hover:text-amber focus-visible:outline-2 focus-visible:outline-accent-line',
              isFav
                ? 'opacity-100 text-amber'
                : 'opacity-0 text-ink3 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            <Star className={cn('w-[var(--fs-title)] h-[var(--fs-title)]', isFav && 'fill-current')} />
          </span>
        )}
      </a>
    );
  };

  const renderGroupHead = (title: string, count: number, unit = '项', sec?: ViewSection, isFirst = false) => {
    const dropMode = sec && dropIndicator?.id === sec.id ? dropIndicator.mode : null;
    const resolveHeadDrop = (e: React.DragEvent): '' | 'into' | 'before' | 'after' => {
      if (!sec || !drag || drag.id === sec.id) return '';
      if (!drag.isFolder) return 'into';
      if (!sec.editable || isDescendant(sec.id, drag.id)) return '';
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
      return relY < 0.5 ? 'before' : 'after';
    };

    return (
      <div
        draggable={Boolean(canEdit && sec?.editable)}
        onDragStart={(e) => canEdit && sec?.editable && startDrag(sec.id, true, sec.title, e)}
        onDragEnd={endDrag}
        onContextMenu={(e) => {
          if (!canEdit || !sec?.editable) return;
          e.preventDefault();
          openEditDialog({ id: sec.id, title: sec.title, isFolder: true });
        }}
        onDragOver={(e) => {
          if (!canEdit || !sec) return;
          const mode = resolveHeadDrop(e);
          if (!mode) return;
          e.preventDefault();
          setDropIndicator({ id: sec.id, mode });
        }}
        onDragLeave={(e) => {
          if (sec && !e.currentTarget.contains(e.relatedTarget as Node) && dropIndicator?.id === sec.id) {
            setDropIndicator(null);
          }
        }}
        onDrop={(e) => {
          if (!canEdit || !sec || !drag) return;
          const mode = resolveHeadDrop(e);
          setDropIndicator(null);
          if (!mode) return;
          e.preventDefault();
          e.stopPropagation();
          if (mode === 'into') doMoveInto(drag.id, sec.id);
          else doMoveRel(drag.id, sec.id, mode);
        }}
        style={{ padding: 'var(--group-py-t) var(--group-px) var(--group-py-b)' }}
        className={cn(
          'group/head relative z-[1] flex items-baseline gap-2 bg-surface border-b border-line',
          !isFirst && 'border-t border-line',
          sec?.editable && 'hover:bg-hover active:cursor-grabbing transition-colors',
          dropMode === 'into' && 'bg-accent-soft',
          dropMode === 'before' && 'shadow-[inset_0_2px_0_0_var(--blue)]',
          dropMode === 'after' && 'shadow-[inset_0_-2px_0_0_var(--blue)]',
        )}
      >
        <span
          style={{ fontSize: 'var(--fs-group)' }}
          className={cn('font-semibold text-ink2 transition-colors', sec?.editable && 'group-hover/head:text-ink')}
        >
          {title}
        </span>
        <span style={{ fontSize: 'var(--fs-meta)' }} className="text-ink3 tabular-nums">
          {count} {unit}
        </span>
      </div>
    );
  };

  const renderSheetBody = () => {
    if (view.sections) {
      if (view.sections.length === 0) return renderEmpty();
      let idx = 0;
      return (
        <div role="list">
          {view.sections.map((sec, secIdx) => (
            <div key={sec.id}>
              {renderGroupHead(sec.title, sec.items.length, '项', sec, secIdx === 0)}
              {sec.items.length > 0 ? (
                <div className="bm-grid">
                  {sec.items.map((it) => {
                    const curIdx = idx++;
                    return renderCell(it, curIdx);
                  })}
                </div>
              ) : (
                <div
                  onContextMenu={(e) => {
                    if (!canEdit || !sec.editable) return;
                    e.preventDefault();
                    openEditDialog({ id: sec.id, title: sec.title, isFolder: true });
                  }}
                  onDragOver={(e) => {
                    if (!canEdit || !drag || drag.isFolder) return;
                    e.preventDefault();
                    setDropIndicator({ id: `empty-${sec.id}`, mode: 'into' });
                  }}
                  onDragLeave={() => {
                    if (dropIndicator?.id === `empty-${sec.id}`) setDropIndicator(null);
                  }}
                  onDrop={(e) => {
                    setDropIndicator(null);
                    if (!canEdit || !drag || drag.isFolder) return;
                    e.preventDefault();
                    e.stopPropagation();
                    doMoveInto(drag.id, sec.id);
                  }}
                  className={cn(
                    'px-5 py-4 text-xs text-ink3 border-b border-line',
                    dropIndicator?.id === `empty-${sec.id}` && 'bg-accent-soft text-accent',
                  )}
                >
                  暂无书签，拖入书签卡片即可归类
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    if (view.rows.length === 0) return renderEmpty();

    const blocks: React.ReactNode[] = [];
    const groupCounts = new Map<string, number>();
    let linkCount = 0;
    let folderCount = 0;
    for (const r of view.rows) {
      if (r.kind === 'folder') folderCount += 1;
      else {
        linkCount += 1;
        const k = r.group || '';
        groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
      }
    }

    let lastGroup: string | null = null;
    let curBucketKind: 'link' | 'folder' | null = null;
    let curItems: React.ReactNode[] = [];
    let blockKey = 0;

    const flush = () => {
      if (curItems.length) {
        blocks.push(
          <div key={`b-${blockKey++}`} className="bm-grid">
            {curItems}
          </div>,
        );
        curItems = [];
      }
    };

    view.rows.forEach((it, i) => {
      const kind = it.kind;
      const gKey = it.kind === 'link' ? it.group || '' : '';

      if (kind === 'link' && view.group && gKey !== lastGroup) {
        flush();
        const isFirstHead = blocks.length === 0;
        lastGroup = gKey;
        blocks.push(
          <React.Fragment key={`gh-${blockKey++}`}>
            {renderGroupHead(gKey || '未分组', groupCounts.get(gKey) || 0, '项', undefined, isFirstHead)}
          </React.Fragment>,
        );
        curBucketKind = null;
      }

      if (view.splitSections && curBucketKind !== kind) {
        flush();
        const isFirstHead = blocks.length === 0;
        blocks.push(
          <React.Fragment key={`sh-${blockKey++}`}>
            {renderGroupHead(
              kind === 'link' ? '直属书签' : '子分组',
              kind === 'link' ? linkCount : folderCount,
              kind === 'link' ? '项' : '个',
              undefined,
              isFirstHead,
            )}
          </React.Fragment>,
        );
        curBucketKind = null;
      }

      if (curBucketKind !== kind) {
        flush();
        curBucketKind = kind;
      }

      curItems.push(renderCell(it, i));
    });
    flush();

    return <div role="list">{blocks}</div>;
  };

  const renderEmpty = () => (
    <div className="px-6 py-14 text-center">
      <p className="m-0 mb-2 text-sm font-medium text-ink2">
        {view.filter === 'search'
          ? '没有匹配的书签'
          : folderId === '__favorites__'
            ? '还没有收藏的书签'
            : '这个分组是空的'}
      </p>
      <p className="m-0 text-xs text-ink3">
        {view.filter === 'search' ? (
          <>
            按 <Kbd>Esc</Kbd> 清空搜索，或换个关键词试试
          </>
        ) : folderId === '__favorites__' ? (
          '鼠标悬停书签卡片并点击右侧 ★，即可固定到这里'
        ) : (
          <>
            按 <Kbd>/</Kbd> 搜索全部收藏
          </>
        )}
      </p>
    </div>
  );

  const version = getExtensionVersion();

  return (
    <div className="min-h-screen flex flex-col bg-background text-ink">
      {/* 顶栏 */}
      <header className="no-print sticky top-0 z-20 h-[var(--topbar-h)] topbar-glass border-b border-line">
        <div className="nav-container nav-shell h-full items-center! max-[960px]:flex max-[960px]:justify-between">
          <div className="inline-flex items-center gap-2.5 min-w-0">
            <span
              style={{ width: 'var(--brand-sz)', height: 'var(--brand-sz)' }}
              className="shrink-0 bg-accent-soft text-accent inline-flex items-center justify-center"
            >
              <Bookmark className="w-4 h-4 fill-current" />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span style={{ fontSize: 'var(--brand-fs)' }} className="font-semibold leading-[1.2] tracking-[-0.01em] text-ink truncate">
                NeatTab
              </span>
              <span style={{ fontSize: 'var(--fs-meta)' }} className="leading-[1.2] text-ink3 truncate max-[720px]:hidden">
                {prefs.rootId === DEFAULTS.rootId ? '书签导航' : tree.rootName}
              </span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 min-w-0 max-[960px]:flex-1 max-[960px]:justify-end">
            <div
              style={{ width: 'min(var(--search-w), 60%)', height: 'var(--search-h)' }}
              className="max-[960px]:w-[min(300px,52vw)]! flex items-center gap-2 px-2.5 pl-3 border border-line bg-background transition-all hover:border-line2 focus-within:bg-surface focus-within:border-accent-line focus-within:shadow-[0_0_0_3px_var(--blue-soft)]"
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
              ) : (
                <Kbd className="text-ink3">/</Kbd>
              )}
            </div>

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
        {/* 左侧分组栏 */}
        <aside className="no-print sticky top-[var(--topbar-h)] h-[calc(100vh-var(--topbar-h))] max-[960px]:static max-[960px]:h-auto flex flex-col pt-[var(--side-pt)] pb-[18px] max-[960px]:py-3 max-[960px]:border-b max-[960px]:border-line">
          <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
            <nav aria-label="收藏夹分组">
              <button
                type="button"
                onClick={() => selectFolder('__favorites__', true)}
                style={{ height: 'var(--nav-h)', fontSize: 'var(--fs-title)' }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 border border-transparent font-semibold text-left cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2',
                  !query && folderId === '__favorites__'
                    ? 'bg-surface border-line shadow-[var(--shadow-sm)] text-ink'
                    : 'bg-transparent text-ink hover:bg-hover',
                )}
              >
                <Star className="w-4 h-4 shrink-0 text-amber" />
                <span className="min-w-0 truncate">我的收藏</span>
                <span
                  style={{ fontSize: 'var(--fs-meta)' }}
                  className={cn(
                    'ml-auto px-1.5 py-[1px] font-mono font-normal tabular-nums',
                    !query && folderId === '__favorites__' ? 'bg-subtle text-ink2' : 'bg-hover text-ink3',
                  )}
                >
                  {favCount}
                </span>
              </button>

              {(tree.tops.length > 0 || canEdit) && (
                <>
                  <div className="h-px my-3 mx-1.5 bg-line" />
                  <div className="flex items-center justify-between px-1 pb-1.5 pl-2.5">
                    <span style={{ fontSize: 'var(--fs-meta)' }} className="font-medium text-ink3">
                      分组
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        title="新建一级分组"
                        aria-label="新建一级分组"
                        onClick={() => openCreateDialog(tree.resolvedRootId || prefs.rootId, '新建一级分组')}
                        className="inline-flex items-center justify-center w-[22px] h-[22px] border border-transparent text-ink3 hover:bg-surface hover:border-line2 hover:text-ink cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </>
              )}

              {tree.tops.map((t) => renderNavBranch(t))}
            </nav>
          </div>

          {/* 侧栏底部：系统设置 + 拖拽浮动删除区 */}
          <div className="relative flex-none mt-3 pt-3 border-t border-line">
            <button
              type="button"
              title="系统设置"
              aria-label="系统设置"
              onClick={() => {
                setSettingsTab('general');
                setSettingsOpen(true);
              }}
              style={{ height: 'var(--nav-h)', fontSize: 'var(--fs-sub)' }}
              className={cn(
                'w-full inline-flex items-center gap-2 px-2.5 border border-transparent bg-transparent text-ink2 cursor-pointer transition-all hover:bg-surface hover:border-line hover:text-ink',
                drag && 'opacity-0 pointer-events-none',
              )}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>系统设置</span>
            </button>

            {canEdit && (
              <div
                aria-hidden={!drag}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  setTrashOver(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setTrashOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const cur = drag;
                  endDrag();
                  if (cur) openDeleteDialog({ id: cur.id, title: cur.title, isFolder: cur.isFolder });
                }}
                style={{ height: 'calc(var(--nav-h) + 22px)' }}
                className={cn(
                  'trash-zone absolute left-0 right-0 bottom-0 z-20 flex items-center justify-center gap-2 transition-all duration-150',
                  drag ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none translate-y-2',
                  trashOver && 'over scale-[1.02]',
                )}
              >
                <Trash2 className="w-4 h-4 shrink-0 pointer-events-none" />
                <span style={{ fontSize: 'var(--fs-title)' }} className="font-medium pointer-events-none">
                  拖到此处删除
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* 右侧主内容 */}
        <div className="min-w-0 min-h-[calc(100vh-var(--topbar-h))] flex flex-col pt-[var(--main-pt)]">
          <div className="flex items-center justify-between gap-3 mb-[var(--head-mb)] min-h-[var(--top-btn-sz)]">
            <div style={{ fontSize: 'var(--fs-title)' }} className="flex items-center gap-2 min-w-0 text-ink3 whitespace-nowrap">
              {view.filter === 'search' ? (
                <span style={{ fontSize: 'var(--fs-sub)' }} className="text-ink2 tabular-nums">
                  {view.hits ?? 0} 项结果
                </span>
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
          </div>

          <main className="bg-surface border border-line shadow-[var(--shadow-card)] overflow-hidden">
            {renderSheetBody()}
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
          <DialogHeader
            title="系统设置"
            extra={version ? <span className="font-mono text-[11.5px] text-ink3">{version}</span> : undefined}
          />
          <SettingsContent
            key={settingsTab}
            layout="modal"
            initialTab={settingsTab}
            prefs={prefs}
            onPatch={handlePatchPrefs}
            onImportDone={(res) => {
              if (res.mode === 'replace') {
                setPrefs((prev) => ({ ...prev, favorites: res.favorites }));
                setExpanded(new Set());
              }
              loadBookmarks();
              flash(res.mode === 'replace' ? '已备份并替换导入' : '已追加导入');
            }}
            onBookmarksChanged={() => loadBookmarks()}
            onOpenBatchRename={() => {
              setSettingsOpen(false);
              setBatchOpen(true);
            }}
            onFlash={flash}
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

      {/* AI 批量整理（重命名 / 分类）审核弹窗 */}
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
        onApplied={() => {
          loadBookmarks();
        }}
      />

      {/* 编辑书签 / 分组弹窗 */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogPopup className="max-w-[400px]">
          <DialogHeader title={editTarget?.isFolder ? '编辑分组' : '编辑书签'} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitEdit();
            }}
            className="p-5 space-y-3"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink2">名称</span>
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  setEditErr('');
                }}
                placeholder={editTarget?.isFolder ? '分组名称' : '书签名称'}
              />
            </label>

            {editTarget && !editTarget.isFolder && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink2">网址</span>
                <Input
                  type="url"
                  value={editUrl}
                  onChange={(e) => {
                    setEditUrl(e.target.value);
                    setEditErr('');
                  }}
                  placeholder="https://..."
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink2">
                {editTarget?.isFolder ? '上级分组' : '所属分组'}
              </span>
              <NativeSelect value={editParentId} onChange={(e) => setEditParentId(e.target.value)}>
                {editFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </label>

            {editErr && <p className="m-0 text-xs text-danger">{editErr}</p>}

            <div className="pt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditTarget(null)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </div>
          </form>
        </DialogPopup>
      </Dialog>

      {/* 新建分组弹窗 */}
      <Dialog open={Boolean(createTarget)} onOpenChange={(o) => !o && setCreateTarget(null)}>
        <DialogPopup className="max-w-[380px]">
          <DialogHeader title={createTarget?.dialogTitle || '新建分组'} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
            className="p-5 space-y-4"
          >
            <Input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="新分组名称"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={!createName.trim()}>
                创建
              </Button>
            </div>
          </form>
        </DialogPopup>
      </Dialog>

      {/* 删除二次确认弹窗 */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogPopup className="max-w-[380px]">
          <DialogHeader title={deleteTarget ? `删除「${deleteTarget.title}」？` : '确认删除'} />
          <div className="p-5 space-y-4">
            <DialogDescription>
              {deleteTarget?.isFolder
                ? deleteTarget.descendantCount > 0
                  ? `连同里面的 ${deleteTarget.descendantCount} 项一起删除，无法撤销。`
                  : '这是一个空分组，删除后无法撤销。'
                : '删除后无法撤销。'}
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                删除
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
