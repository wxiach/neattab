'use strict';

/**
 * NAV — 新标签页核心模块：状态、目录树构建、视图计算、网格渲染、键盘导航与数据订阅。
 */
(() => {
  const {
    hasExt,
    DEFAULTS,
    READING_FOLDER_RE,
    PHOSPHOR,
    mq,
    $,
    el,
    icon,
    hostOf,
    isLink,
    resolveTheme,
    applyTheme,
    applyFont,
    findNode,
    makeFavicon,
  } = window.NAV;

  const state = {
    rootId: DEFAULTS.rootId,
    resolvedRootId: '',
    openMode: DEFAULTS.openMode,
    theme: DEFAULTS.theme,
    font: DEFAULTS.font,
    rootName: '收藏夹',
    tops: [],
    loose: [],
    folderMap: new Map(),
    view: { folderId: '' },
    expanded: new Set(),
    favorites: [],
    itemIndex: new Map(),
    q: '',
    rows: [],
    sel: -1,
    filter: 'folder', // folder | search
  };

  const els = {
    collSource: $('#coll-source'),
    nav: $('#nav'),
    bc: $('#bc'),
    search: $('#search'),
    q: $('#q'),
    searchClear: $('#search-clear'),
    sheet: $('.sheet'),
    rows: $('#rows'),
    empty: $('#empty'),
    emptyT: $('#empty-t'),
    emptyS: $('#empty-s'),
    trashZone: $('#trash-zone'),
    themeBtn: $('#theme-btn'),
  };

  function appendHighlighted(parent, text, query) {
    const raw = String(text || '');
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      parent.textContent = raw;
      return;
    }
    const lower = raw.toLowerCase();
    let from = 0;
    let at = lower.indexOf(q, from);
    if (at < 0) {
      parent.textContent = raw;
      return;
    }
    while (at >= 0) {
      if (at > from) parent.append(document.createTextNode(raw.slice(from, at)));
      parent.append(el('mark', '', raw.slice(at, at + q.length)));
      from = at + q.length;
      at = lower.indexOf(q, from);
    }
    if (from < raw.length) parent.append(document.createTextNode(raw.slice(from)));
  }

  /* ---------------- 持久化 ---------------- */

  function savePrefs(patch) {
    if (!hasExt || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.set(patch);
    } catch {
      /* 忽略 */
    }
  }

  function persistView() {
    savePrefs({ view: { ...state.view }, expanded: [...state.expanded] });
  }

  /* ---------------- 数据模型 ---------------- */

  function itemOf(node, group) {
    return {
      id: node.id,
      title: (node.title || node.url || '').trim() || hostOf(node.url),
      url: node.url,
      host: hostOf(node.url),
      group: group || '',
      dateAdded: node.dateAdded || 0,
    };
  }

  function buildFolderNode(node, parentId, depth, topTitle) {
    const title = (node.title || '未命名').trim();
    const groupTitle = depth === 1 ? title : topTitle;
    const items = [];
    const children = [];
    let totalCount = 0;

    for (const c of node.children || []) {
      if (isLink(c)) {
        const it = itemOf(c, '');
        items.push(it);
        state.itemIndex.set(it.id, { item: it, group: groupTitle });
        totalCount += 1;
      } else if (!c.url) {
        const child = buildFolderNode(c, node.id, depth + 1, groupTitle);
        children.push(child);
        totalCount += child.totalCount;
      }
    }

    const folder = { id: node.id, title, parentId, depth, items, children, totalCount };
    state.folderMap.set(folder.id, folder);
    return folder;
  }

  function buildRoot(rootNode) {
    state.resolvedRootId = rootNode.id;
    state.rootName = (rootNode.title || '收藏夹').trim();
    els.collSource.textContent = state.rootId === DEFAULTS.rootId ? '书签导航' : state.rootName;

    const tops = [];
    const loose = [];
    state.folderMap = new Map();
    state.itemIndex = new Map();

    for (const child of rootNode.children || []) {
      if (isLink(child)) {
        const it = itemOf(child, '');
        loose.push(it);
        state.itemIndex.set(it.id, { item: it, group: '未分组' });
        continue;
      }
      if (child.url) continue;
      tops.push(buildFolderNode(child, rootNode.id, 1, ''));
    }

    state.loose = loose;
    state.tops = tops;
    state.favorites = state.favorites.filter((id) => state.itemIndex.has(id));
  }

  const findFolder = (id) => (id ? state.folderMap.get(id) || null : null);

  function ancestorChain(id) {
    const chain = [];
    let cur = findFolder(id);
    while (cur) {
      chain.unshift(cur);
      cur = findFolder(cur.parentId);
    }
    return chain;
  }

  function isDescendant(id, maybeAncestorId) {
    let cur = findFolder(id);
    while (cur) {
      if (cur.id === maybeAncestorId) return true;
      cur = findFolder(cur.parentId);
    }
    return false;
  }

  function normalizeFolderId(id) {
    if (!id || id === '__favorites__') return id;
    let cur = findFolder(id);
    while (cur && cur.depth > 2) cur = findFolder(cur.parentId);
    return cur ? cur.id : '';
  }

  function defaultView() {
    const savedId = normalizeFolderId(state.view && state.view.folderId ? state.view.folderId : '');
    if (savedId === '__favorites__' || findFolder(savedId)) return { folderId: savedId };
    const first = state.tops.find((t) => t.children.length) || state.tops[0];
    return first ? { folderId: first.id } : { folderId: '__favorites__' };
  }

  function collectFolderItems(folder, groupTitle, filterFn, out) {
    for (const it of folder.items) {
      if (!filterFn || filterFn(it)) out.push({ ...it, kind: 'link', group: groupTitle });
    }
    for (const c of folder.children) {
      collectFolderItems(c, groupTitle, filterFn, out);
    }
  }

  /* ---------------- 视图计算 ---------------- */

  function formatAddedTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= todayStart) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (ts >= todayStart - 86400000) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function buildReadingRows(items) {
    const sorted = [...items].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    const byHost = new Map();
    for (const it of sorted) {
      const key = it.host || '其他站点';
      if (!byHost.has(key)) byHost.set(key, []);
      byHost.get(key).push({ ...it, kind: 'link', group: key, subText: formatAddedTime(it.dateAdded) || key });
    }
    return [...byHost.values()].flat();
  }

  const matchRow = (it, q) =>
    (it.title || '').toLowerCase().includes(q) || (it.url || '').toLowerCase().includes(q);

  function computeView() {
    const q = state.q.trim().toLowerCase();
    if (q) {
      const rows = [];
      for (const it of state.loose) {
        if (matchRow(it, q)) rows.push({ ...it, kind: 'link', group: '未分组' });
      }
      for (const t of state.tops) {
        collectFolderItems(t, t.title, (it) => matchRow(it, q), rows);
      }
      state.filter = 'search';
      return { rows, group: true, crumb: ['搜索'], hits: rows.length };
    }

    state.filter = 'folder';
    const fid = state.view.folderId;

    if (fid === '__favorites__') {
      const favSet = new Set(state.favorites);
      const rows = [];
      for (const it of state.loose) {
        rows.push({ ...it, kind: 'link', group: '未分组' });
      }
      for (const t of state.tops) {
        collectFolderItems(t, t.title, (it) => favSet.has(it.id), rows);
      }
      return { rows, group: rows.length > 0, crumb: [{ title: '我的收藏' }] };
    }

    const folder = findFolder(normalizeFolderId(fid)) || findFolder((defaultView() || {}).folderId);
    if (!folder) return { rows: [], group: false, crumb: [{ title: state.rootName }] };

    const crumb = ancestorChain(folder.id).map((f) => ({ title: f.title, folderId: f.id }));

    // 「阅读清单」先按站点分段，站点内部按收藏时间由新到旧排序
    if (READING_FOLDER_RE.test(folder.title) && folder.children.length === 0) {
      const rows = buildReadingRows(folder.items);
      return { rows, group: rows.length > 0, crumb };
    }

    // 二级分类下存在三级目录时，直接按三级分类平铺分段展示（无需再钻取一层）
    if (folder.depth >= 2 && folder.children.length > 0) {
      const sections = [];
      const rows = [];
      if (folder.items.length > 0) {
        const items = folder.items.map((it) => ({ ...it, kind: 'link', group: '' }));
        sections.push({ id: folder.id, title: '直属书签', editable: false, items });
        rows.push(...items);
      }
      for (const c of folder.children) {
        const items = [];
        collectFolderItems(c, '', null, items);
        sections.push({ id: c.id, title: c.title, editable: true, items });
        rows.push(...items);
      }
      return { rows, sections, group: false, crumb };
    }

    const rows = [
      ...folder.items.map((it) => ({ ...it, kind: 'link', group: '' })),
      ...folder.children.map((c) => ({ kind: 'folder', id: c.id, title: c.title, count: c.totalCount })),
    ];
    return {
      rows,
      group: false,
      splitSections: folder.items.length > 0 && folder.children.length > 0,
      crumb,
    };
  }

  /* ---------------- 挂接编辑与设置子模块 ---------------- */

  function toggleFavorite(id) {
    const i = state.favorites.indexOf(id);
    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.unshift(id);
    savePrefs({ favorites: [...state.favorites] });
    render();
  }

  const editor = window.NAV.createEditor({ state, loadBookmarks });
  const settingsModal = window.NAV.createSettingsModal({
    state,
    savePrefs,
    loadBookmarks,
  });

  if (els.trashZone && editor.canEdit) {
    els.trashZone.addEventListener('dragover', (e) => {
      const drag = editor.getDrag();
      if (!drag.id) return;
      e.preventDefault();
      els.trashZone.classList.add('over');
    });
    els.trashZone.addEventListener('dragleave', (e) => {
      if (!els.trashZone.contains(e.relatedTarget)) els.trashZone.classList.remove('over');
    });
    els.trashZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.trashZone.classList.remove('over');
      const drag = editor.getDrag();
      editor.endDrag();
      if (drag.id) editor.deleteDialog({ id: drag.id, title: drag.title, isFolder: drag.isFolder });
    });
  }

  /* ---------------- 渲染 ---------------- */

  function clearDropClass(elNode) {
    elNode.classList.remove('drop-into', 'drop-before', 'drop-after');
  }

  function resolveNavDrop(e, targetEl, node, drag) {
    if (!drag.id || drag.id === node.id) return '';
    if (!drag.isFolder) return 'into';
    if (isDescendant(node.id, drag.id)) return '';
    const rect = targetEl.getBoundingClientRect();
    const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    if (relY < 0.28) return 'before';
    if (relY > 0.72) return 'after';
    return 'into';
  }

  function wireNavEdit(rowEl, node) {
    if (!editor.canEdit) return;
    rowEl.draggable = true;
    rowEl.addEventListener('dragstart', (e) => {
      editor.startDrag(node.id, true, e, node.title);
      rowEl.classList.add('dragging');
    });
    rowEl.addEventListener('dragend', () => {
      editor.endDrag();
      rowEl.classList.remove('dragging');
    });
    rowEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      editor.editDialog({ id: node.id, title: node.title, isFolder: true });
    });
    rowEl.addEventListener('dragover', (e) => {
      const mode = resolveNavDrop(e, rowEl, node, editor.getDrag());
      clearDropClass(rowEl);
      if (!mode) return;
      e.preventDefault();
      rowEl.classList.add(`drop-${mode}`);
    });
    rowEl.addEventListener('dragleave', (e) => {
      if (!rowEl.contains(e.relatedTarget)) clearDropClass(rowEl);
    });
    rowEl.addEventListener('drop', (e) => {
      const drag = editor.getDrag();
      const mode = resolveNavDrop(e, rowEl, node, drag);
      clearDropClass(rowEl);
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'into') editor.doMove(drag.id, node.id);
      else editor.doMoveRelative(drag.id, node.id, mode);
    });
  }

  function renderNavBranch(folder, activeAncestors) {
    const frag = document.createDocumentFragment();
    const isTop = folder.depth === 1;
    // 左侧目录树最多展示到二级；三级及更深目录通过右侧子分组卡片与面包屑浏览
    const canExpand = isTop && folder.children.length > 0;
    const open = canExpand && (state.expanded.has(folder.id) || activeAncestors.has(folder.id));
    const isActive =
      !state.q && (state.view.folderId === folder.id || (!isTop && activeAncestors.has(folder.id)));

    const row = el('div', 'n-row');
    const btn = el('button', isTop ? 'n-item' : 'n-sub');
    btn.type = 'button';
    btn.dataset.folder = folder.id;
    if (open) btn.classList.add('open');
    if (isActive) btn.classList.add('on');

    if (isTop) {
      btn.append(icon(open ? PHOSPHOR.folderOpen : PHOSPHOR.folder, 15, 'fico'));
    }
    btn.append(el('span', 'nm', folder.title), el('span', 'n', String(folder.totalCount)));
    row.append(btn);

    if (editor.canEdit) {
      const subAdd = el('button', 'n-item-add');
      subAdd.type = 'button';
      subAdd.dataset.addSub = folder.id;
      subAdd.title = `在「${folder.title}」下新建子分组`;
      subAdd.setAttribute('aria-label', `在「${folder.title}」下新建子分组`);
      subAdd.append(icon(PHOSPHOR.plus, 12));
      row.append(subAdd);
    }

    wireNavEdit(row, folder);
    frag.append(row);

    if (open) {
      const kids = el('div', 'n-kids');
      for (const c of folder.children) kids.append(renderNavBranch(c, activeAncestors));
      frag.append(kids);
    }
    return frag;
  }

  function renderNav() {
    const frag = document.createDocumentFragment();

    const fav = el('button', 'n-item');
    fav.type = 'button';
    fav.dataset.folder = '__favorites__';
    if (!state.q && state.view.folderId === '__favorites__') fav.classList.add('on');
    fav.append(icon(PHOSPHOR.star, 15, 'fico'), el('span', 'nm', '我的收藏'));
    const favCount = new Set([...state.favorites, ...state.loose.map((it) => it.id)]).size;
    fav.append(el('span', 'n', String(favCount)));
    frag.append(fav);

    if (state.tops.length || editor.canEdit) {
      frag.append(el('div', 'n-div'));
      const head = el('div', 'n-head');
      head.append(el('span', 'n-label', '分组'));
      if (editor.canEdit) {
        const addBtn = el('button', 'n-add');
        addBtn.type = 'button';
        addBtn.title = '新建一级分组';
        addBtn.setAttribute('aria-label', '新建一级分组');
        addBtn.append(icon(PHOSPHOR.plus, 12));
        head.append(addBtn);
      }
      frag.append(head);
    }

    // 仅展开当前路径的祖先节点，当前节点本身遵循 state.expanded 以便点击折叠
    const activeAncestors = new Set();
    const chain = ancestorChain(state.view.folderId);
    for (let i = 0; i < chain.length - 1; i += 1) activeAncestors.add(chain[i].id);

    for (const t of state.tops) {
      frag.append(renderNavBranch(t, activeAncestors));
    }
    els.nav.replaceChildren(frag);
  }

  function renderBc(crumb, hits) {
    const frag = document.createDocumentFragment();
    if (state.filter === 'search') {
      frag.append(el('span', 'hits', `${hits ?? 0} 项结果`));
      els.bc.replaceChildren(frag);
      return;
    }
    crumb.forEach((entry, i) => {
      if (i) frag.append(el('span', 'sep', '/'));
      const label = typeof entry === 'string' ? entry : entry.title;
      const last = i === crumb.length - 1;
      if (!last && entry && entry.folderId) {
        const btn = el('button', 'bc-link', label);
        btn.type = 'button';
        btn.addEventListener('click', () => selectFolder(entry.folderId));
        frag.append(btn);
      } else {
        frag.append(el('span', last ? 'cur' : '', label));
      }
    });
    els.bc.replaceChildren(frag);
  }

  function groupHead(title, count, unit = '项') {
    const head = el('div', 'group-h');
    head.append(el('span', 'gh-t', title), el('span', 'gh-n', `${count} ${unit}`));
    return head;
  }

  function cellNode(it, i) {
    if (it.kind === 'folder') {
      const cell = el('button', 'cell folder');
      cell.type = 'button';
      cell.dataset.i = String(i);
      const icoBox = el('span', 'f-ico-box');
      icoBox.append(icon(PHOSPHOR.folder, 16, 'fico'));
      const box = el('span', 'cb');
      box.append(el('span', 'ct', it.title), el('span', 'cd', `${it.count} 项书签`));
      const go = el('span', 'go');
      go.append(icon(PHOSPHOR.caret, 12));
      cell.append(icoBox, box, go);

      cell.addEventListener('click', () => openFolder(it.id));

      if (editor.canEdit) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          editor.startDrag(it.id, true, e, it.title);
          cell.classList.add('dragging');
        });
        cell.addEventListener('dragend', () => {
          editor.endDrag();
          cell.classList.remove('dragging');
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          editor.editDialog({ id: it.id, title: it.title, isFolder: true });
        });
        cell.addEventListener('dragover', (e) => {
          const drag = editor.getDrag();
          if (!drag.id || drag.isFolder) return;
          e.preventDefault();
          cell.classList.add('drop-into');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop-into'));
        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('drop-into');
          const drag = editor.getDrag();
          if (drag.id && !drag.isFolder) editor.doMove(drag.id, it.id);
        });
      }
      return cell;
    }

    const q = state.filter === 'search' ? state.q.trim() : '';
    const a = el('a', 'cell');
    a.href = it.url;
    a.title = `${it.title}\n${it.url}`;
    a.dataset.i = String(i);
    a.append(makeFavicon(it.url, it.host));
    const box = el('span', 'cb');
    const titleEl = el('span', 'ct');
    appendHighlighted(titleEl, it.title, q);
    const domainEl = el('span', 'cd');
    appendHighlighted(domainEl, it.subText || it.host, q);
    box.append(titleEl, domainEl);
    a.append(box);

    const isLoose = state.loose.some((x) => x.id === it.id);
    if (!isLoose) {
      const isFav = state.favorites.includes(it.id);
      const favBtn = el('span', `fav-btn${isFav ? ' on' : ''}`);
      favBtn.setAttribute('role', 'button');
      favBtn.tabIndex = 0;
      favBtn.title = isFav ? '取消收藏' : '加入「我的收藏」';
      favBtn.setAttribute('aria-label', favBtn.title);
      favBtn.setAttribute('aria-pressed', String(isFav));
      favBtn.append(icon(isFav ? PHOSPHOR.starFill : PHOSPHOR.star, 14));
      favBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(it.id);
      });
      favBtn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      favBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite(it.id);
        }
      });
      a.append(favBtn);
    }

    let openTimer = 0;
    a.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn')) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      clearTimeout(openTimer);
      openTimer = setTimeout(() => openUrl(it.url, false), 150);
    });

    if (editor.canEdit) {
      a.draggable = true;
      a.addEventListener('dragstart', (e) => {
        clearTimeout(openTimer);
        editor.startDrag(it.id, false, e, it.title);
        a.classList.add('dragging');
      });
      a.addEventListener('dragend', () => {
        editor.endDrag();
        a.classList.remove('dragging');
      });
      a.addEventListener('contextmenu', (e) => {
        clearTimeout(openTimer);
        e.preventDefault();
        editor.editDialog({ id: it.id, title: it.title, url: it.url, isFolder: false });
      });
      const canReorderCard = state.filter !== 'search' && state.view.folderId !== '__favorites__';
      a.addEventListener('dragover', (e) => {
        const drag = editor.getDrag();
        if (!canReorderCard || !drag.id || drag.isFolder || drag.id === it.id) return;
        e.preventDefault();
        a.classList.add('drop-into');
      });
      a.addEventListener('dragleave', () => a.classList.remove('drop-into'));
      a.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        a.classList.remove('drop-into');
        const drag = editor.getDrag();
        if (canReorderCard && drag.id && !drag.isFolder && drag.id !== it.id) {
          editor.doMoveBefore(drag.id, it.id);
        }
      });
    }
    return a;
  }

  function renderEmptyState() {
    els.emptyS.replaceChildren();
    if (state.filter === 'search') {
      els.emptyT.textContent = '没有匹配的书签';
      els.emptyS.append(document.createTextNode('按 '), el('kbd', '', 'Esc'), document.createTextNode(' 清空搜索，或换个关键词试试'));
    } else if (state.view.folderId === '__favorites__') {
      els.emptyT.textContent = '还没有收藏的书签';
      els.emptyS.textContent = '鼠标悬停书签卡片并点击右侧 ★，即可固定到这里';
    } else {
      els.emptyT.textContent = '这个分组是空的';
      els.emptyS.append(document.createTextNode('按 '), el('kbd', '', '/'), document.createTextNode(' 搜索全部收藏'));
    }
  }

  function wireSectionHead(head, sec) {
    if (!editor.canEdit) return;
    if (sec.editable) {
      head.classList.add('editable');
      head.draggable = true;
      head.title = '右键编辑分类，拖拽可排序或拖至左下角删除';
      head.addEventListener('dragstart', (e) => {
        editor.startDrag(sec.id, true, e, sec.title);
        head.classList.add('dragging');
      });
      head.addEventListener('dragend', () => {
        editor.endDrag();
        head.classList.remove('dragging');
      });
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        editor.editDialog({ id: sec.id, title: sec.title, isFolder: true });
      });
    }

    const resolveHeadDrop = (e, drag) => {
      if (!drag.id || drag.id === sec.id) return '';
      if (!drag.isFolder) return 'into';
      if (!sec.editable || isDescendant(sec.id, drag.id)) return '';
      const rect = head.getBoundingClientRect();
      const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
      return relY < 0.5 ? 'before' : 'after';
    };

    head.addEventListener('dragover', (e) => {
      const mode = resolveHeadDrop(e, editor.getDrag());
      clearDropClass(head);
      if (!mode) return;
      e.preventDefault();
      head.classList.add(`drop-${mode}`);
    });
    head.addEventListener('dragleave', (e) => {
      if (!head.contains(e.relatedTarget)) clearDropClass(head);
    });
    head.addEventListener('drop', (e) => {
      const drag = editor.getDrag();
      const mode = resolveHeadDrop(e, drag);
      clearDropClass(head);
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'into') editor.doMove(drag.id, sec.id);
      else editor.doMoveRelative(drag.id, sec.id, mode);
    });
  }

  function wireSectionEmpty(slot, sec) {
    if (!editor.canEdit) return;
    if (sec.editable) {
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        editor.editDialog({ id: sec.id, title: sec.title, isFolder: true });
      });
    }
    slot.addEventListener('dragover', (e) => {
      const drag = editor.getDrag();
      if (!drag.id || drag.isFolder) return;
      e.preventDefault();
      slot.classList.add('drop-into');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-into'));
    slot.addEventListener('drop', (e) => {
      slot.classList.remove('drop-into');
      const drag = editor.getDrag();
      if (!drag.id || drag.isFolder) return;
      e.preventDefault();
      e.stopPropagation();
      editor.doMove(drag.id, sec.id);
    });
  }

  function renderRows(view) {
    // 切换视图时重置键盘选中索引
    state.rows = view.rows;
    state.sel = -1;

    const frag = document.createDocumentFragment();
    if (Array.isArray(view.sections)) {
      let idx = 0;
      for (const sec of view.sections) {
        const head = groupHead(sec.title, sec.items.length);
        wireSectionHead(head, sec);
        frag.append(head);
        if (sec.items.length) {
          const bucket = el('div', 'grid');
          for (const it of sec.items) {
            bucket.append(cellNode(it, idx));
            idx += 1;
          }
          frag.append(bucket);
        } else {
          const dropSlot = el('div', 'group-empty', '暂无书签，拖入书签卡片即可归类');
          wireSectionEmpty(dropSlot, sec);
          frag.append(dropSlot);
        }
      }
      els.rows.replaceChildren(frag);
      const empty = view.sections.length === 0;
      els.empty.hidden = !empty;
      els.rows.hidden = empty;
      if (empty) renderEmptyState();
      return;
    }

    const counts = new Map();
    let linkCount = 0;
    let folderCount = 0;
    for (const it of view.rows) {
      if (it.kind === 'folder') folderCount += 1;
      else {
        linkCount += 1;
        const key = it.group || '';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    let lastGroup = null;
    let bucket = null;
    let bucketKind = null;

    view.rows.forEach((it, i) => {
      const kind = it.kind === 'folder' ? 'folder' : 'link';
      const key = it.group || '';

      if (kind === 'link' && view.group && key !== lastGroup) {
        lastGroup = key;
        frag.append(groupHead(key || '未分组', counts.get(key)));
        bucket = null;
      }

      if (view.splitSections && bucketKind !== kind) {
        frag.append(kind === 'link' ? groupHead('直属书签', linkCount) : groupHead('子分组', folderCount, '个'));
        bucket = null;
      }

      if (!bucket || bucketKind !== kind) {
        bucket = el('div', 'grid');
        bucketKind = kind;
        frag.append(bucket);
      }
      bucket.append(cellNode(it, i));
    });

    els.rows.replaceChildren(frag);

    const empty = view.rows.length === 0;
    els.empty.hidden = !empty;
    els.rows.hidden = empty;
    if (empty) renderEmptyState();
    else if (state.filter === 'search') {
      state.sel = 0;
      const first = els.rows.querySelector('[data-i="0"]');
      if (first) first.classList.add('sel');
    }
  }

  function render() {
    const view = computeView();
    const hasQuery = state.q.length > 0;
    if (els.search) els.search.classList.toggle('has-q', hasQuery);
    if (els.searchClear) els.searchClear.hidden = !hasQuery;
    renderNav();
    renderBc(view.crumb, view.hits);
    renderRows(view);
  }

  /* ---------------- 导航与键盘交互 ---------------- */

  function openUrl(url, forceNew) {
    if (forceNew || state.openMode === 'tab') window.open(url, '_blank', 'noopener');
    else location.href = url;
  }

  function selectFolder(id, toggle = false) {
    if (id === '__favorites__') {
      state.view = { folderId: '__favorites__' };
      state.q = '';
      els.q.value = '';
      persistView();
      render();
      return;
    }
    const fid = normalizeFolderId(id);
    const folder = findFolder(fid);
    if (!folder) return;

    const chain = ancestorChain(fid);
    for (let i = 0; i < chain.length - 1; i += 1) state.expanded.add(chain[i].id);

    const already = state.view.folderId === fid;
    if (toggle && already && folder.depth === 1 && folder.children.length) {
      if (state.expanded.has(fid)) state.expanded.delete(fid);
      else state.expanded.add(fid);
    } else if (folder.depth === 1 && folder.children.length) {
      state.expanded.add(fid);
    }

    state.view = { folderId: fid };
    state.q = '';
    els.q.value = '';
    persistView();
    render();
  }

  function openFolder(id) {
    selectFolder(id, false);
  }

  function moveSel(delta, wrap = false) {
    const len = state.rows.length;
    if (!len) return;
    let next;
    if (wrap) {
      next = state.sel < 0 ? (delta > 0 ? 0 : len - 1) : (state.sel + delta + len) % len;
    } else {
      next = Math.min(len - 1, Math.max(0, state.sel + delta));
    }
    if (next === state.sel) return;
    const old = state.sel >= 0 ? els.rows.querySelector(`[data-i="${state.sel}"]`) : null;
    if (old) old.classList.remove('sel');
    state.sel = next;
    const row = els.rows.querySelector(`[data-i="${next}"]`);
    if (row) {
      row.classList.add('sel');
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function activateSel(forceNew) {
    const it = state.rows[state.sel >= 0 ? state.sel : 0];
    if (!it) return;
    if (it.kind === 'folder') openFolder(it.id);
    else openUrl(it.url, forceNew);
  }

  function focusSearch() {
    try {
      els.q.focus({ preventScroll: true });
    } catch {
      els.q.focus();
    }
  }

  els.nav.addEventListener('click', (e) => {
    if (e.target.closest('.n-add')) {
      editor.createDialog(state.resolvedRootId || state.rootId, '新建一级分组');
      return;
    }
    const subAdd = e.target.closest('.n-item-add');
    if (subAdd) {
      editor.createDialog(subAdd.dataset.addSub, '新建子分组');
      return;
    }
    const target = e.target.closest('[data-folder]');
    if (target) selectFolder(target.dataset.folder, true);
  });

  els.q.addEventListener('input', () => {
    state.q = els.q.value;
    render();
  });

  if (els.searchClear) {
    els.searchClear.addEventListener('click', () => {
      state.q = '';
      els.q.value = '';
      render();
      focusSearch();
    });
  }

  els.themeBtn.addEventListener('click', () => {
    state.theme = resolveTheme(state.theme) === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    settingsModal.sync();
    savePrefs({ theme: state.theme });
  });

  mq.addEventListener('change', () => applyTheme(state.theme));

  document.addEventListener('keydown', (e) => {
    if (settingsModal.isOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        settingsModal.handleEscape();
      }
      return;
    }
    if (editor.hasDialog()) return;

    const typing = document.activeElement === els.q;
    const inField =
      document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === '/') {
      if (!inField) {
        e.preventDefault();
        focusSearch();
        els.q.select();
      } else if (typing && !els.q.value) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (state.q) {
        state.q = '';
        els.q.value = '';
        render();
      } else if (typing) {
        els.q.blur();
      } else {
        const cur = findFolder(state.view.folderId);
        if (cur && findFolder(cur.parentId)) selectFolder(cur.parentId);
      }
      return;
    }
    if (e.key === 'Tab' && state.filter === 'search' && state.rows.length) {
      e.preventDefault();
      moveSel(e.shiftKey ? -1 : 1, true);
      return;
    }
    if (e.key === 'F2' && !inField && editor.canEdit && state.sel >= 0) {
      const it = state.rows[state.sel];
      if (it && it.id) {
        e.preventDefault();
        editor.editDialog({ id: it.id, title: it.title, url: it.url, isFolder: it.kind === 'folder' });
      }
      return;
    }
    if (e.key === 'Enter' && (state.sel >= 0 || (typing && state.rows.length))) {
      e.preventDefault();
      activateSel(e.ctrlKey || e.metaKey);
    }
  });

  /* ---------------- 加载与订阅 ---------------- */

  async function loadBookmarks() {
    if (!hasExt) return;
    let tree;
    try {
      tree = await chrome.bookmarks.getTree();
    } catch {
      return;
    }
    const root = findNode(tree[0], state.rootId) || (tree[0].children || [])[0];
    if (!root) return;
    buildRoot(root);

    if (state.expanded.size === 0) {
      state.view = defaultView();
      if (state.view.folderId && state.view.folderId !== '__favorites__') {
        state.expanded.add(state.view.folderId);
      }
    } else if (state.view.folderId !== '__favorites__' && !findFolder(state.view.folderId)) {
      state.view = defaultView();
    }
    render();
  }

  async function loadPrefs() {
    if (!hasExt || !chrome.storage || !chrome.storage.local) return;
    try {
      const prefs = await chrome.storage.local.get(DEFAULTS);
      Object.assign(state, {
        rootId: prefs.rootId || DEFAULTS.rootId,
        openMode: prefs.openMode || DEFAULTS.openMode,
        theme: prefs.theme || DEFAULTS.theme,
        font: prefs.font || DEFAULTS.font,
      });
      if (prefs.view) {
        // 兼容旧版 { topId, subId } 持久化结构
        const fid = prefs.view.folderId || prefs.view.subId || prefs.view.topId || '';
        if (fid) state.view = { folderId: fid };
      }
      if (Array.isArray(prefs.expanded)) state.expanded = new Set(prefs.expanded);
      if (Array.isArray(prefs.favorites)) state.favorites = prefs.favorites.filter((id) => typeof id === 'string');
    } catch {
      /* 使用默认值 */
    }
  }

  function subscribe() {
    if (!hasExt) return;
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.theme) {
          state.theme = changes.theme.newValue || DEFAULTS.theme;
          applyTheme(state.theme);
        }
        if (changes.font) {
          state.font = changes.font.newValue || DEFAULTS.font;
          applyFont(state.font);
        }
        if (changes.openMode) state.openMode = changes.openMode.newValue || DEFAULTS.openMode;
        if (changes.favorites && Array.isArray(changes.favorites.newValue)) {
          state.favorites = changes.favorites.newValue.filter((id) => typeof id === 'string');
          render();
        }
        if (changes.rootId) {
          state.rootId = changes.rootId.newValue || DEFAULTS.rootId;
          loadBookmarks();
        }
        settingsModal.sync();
      });
    }
    let timer = 0;
    for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) {
      if (chrome.bookmarks[ev]) {
        chrome.bookmarks[ev].addListener(() => {
          clearTimeout(timer);
          timer = setTimeout(loadBookmarks, 150);
        });
      }
    }
  }

  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    loadPrefs().then(() => {
      applyTheme(state.theme);
      applyFont(state.font);
      render();
    });
  });

  (async () => {
    await loadPrefs();
    applyTheme(state.theme);
    applyFont(state.font);
    subscribe();
    await loadBookmarks();
  })();
})();
