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
    openMode: DEFAULTS.openMode,
    theme: DEFAULTS.theme,
    font: DEFAULTS.font,
    rootName: '收藏夹',
    tops: [],
    loose: [],
    view: { topId: '', subId: '' },
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
    newFolder: $('#new-folder'),
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

  function collect(node, group, out) {
    for (const c of node.children || []) {
      if (isLink(c)) out.push(itemOf(c, group));
      else if (!c.url) collect(c, group, out);
    }
    return out;
  }

  function buildRoot(rootNode) {
    state.rootName = (rootNode.title || '收藏夹').trim();
    els.collSource.textContent = state.rootName;

    const tops = [];
    const loose = [];
    for (const child of rootNode.children || []) {
      if (isLink(child)) {
        loose.push(itemOf(child, ''));
        continue;
      }
      if (child.url) continue;
      const top = { id: child.id, title: (child.title || '未命名').trim(), items: [], children: [] };
      for (const sub of child.children || []) {
        if (isLink(sub)) top.items.push(itemOf(sub, ''));
        else if (!sub.url) {
          top.children.push({ id: sub.id, title: (sub.title || '未命名').trim(), items: collect(sub, '', []) });
        }
      }
      tops.push(top);
    }

    state.loose = loose;
    state.tops = tops;

    state.itemIndex = new Map();
    for (const it of loose) state.itemIndex.set(it.id, { item: it, group: '未分组' });
    for (const t of tops) {
      for (const it of t.items) state.itemIndex.set(it.id, { item: it, group: t.title });
      for (const ch of t.children) {
        for (const it of ch.items) state.itemIndex.set(it.id, { item: it, group: t.title });
      }
    }
    state.favorites = state.favorites.filter((id) => state.itemIndex.has(id));
  }

  const countOf = (top) => top.items.length + top.children.reduce((n, c) => n + c.items.length, 0);
  const findTop = (id) => state.tops.find((t) => t.id === id) || null;

  function findSub(id) {
    for (const t of state.tops) {
      const sub = t.children.find((c) => c.id === id);
      if (sub) return { top: t, sub };
    }
    return null;
  }

  function currentFolderId() {
    if (state.view.subId) return state.view.subId;
    if (state.view.topId && state.view.topId !== '__favorites__') return state.view.topId;
    return '';
  }

  function defaultView() {
    const saved = state.view && state.view.topId ? state.view : null;
    if (saved) {
      if (saved.subId && findSub(saved.subId)) return saved;
      if (findTop(saved.topId)) return { topId: saved.topId, subId: '' };
    }
    const first = state.tops.find((t) => t.children.length) || state.tops[0];
    return first ? { topId: first.id, subId: '' } : { topId: '__favorites__', subId: '' };
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
        for (const it of t.items) if (matchRow(it, q)) rows.push({ ...it, kind: 'link', group: t.title });
        for (const c of t.children) {
          for (const it of c.items) if (matchRow(it, q)) rows.push({ ...it, kind: 'link', group: t.title });
        }
      }
      state.filter = 'search';
      return { rows, group: true, crumb: ['搜索'], hits: rows.length };
    }

    state.filter = 'folder';
    const v = state.view;
    if (v.subId) {
      const hit = findSub(v.subId);
      if (hit) {
        return {
          rows: hit.sub.items.map((it) => ({ ...it, kind: 'link', group: '' })),
          group: false,
          crumb: [{ title: hit.top.title, topId: hit.top.id }, { title: hit.sub.title }],
        };
      }
    }

    if (v.topId === '__favorites__') {
      const rows = [];
      const seen = new Set();
      for (const it of state.loose) {
        rows.push({ ...it, kind: 'link', group: '未分组' });
        seen.add(it.id);
      }
      for (const id of state.favorites) {
        if (seen.has(id)) continue;
        const hit = state.itemIndex.get(id);
        if (hit) {
          rows.push({ ...hit.item, kind: 'link', group: hit.group });
          seen.add(id);
        }
      }
      return { rows, group: rows.length > 0, crumb: [{ title: '我的收藏' }] };
    }

    const top = findTop(v.topId) || findTop((defaultView() || {}).topId);
    if (!top) return { rows: [], group: false, crumb: [{ title: state.rootName }] };

    // 「阅读清单」先按站点分段，站点内部按收藏时间由新到旧排序
    if (READING_FOLDER_RE.test(top.title) && top.children.length === 0) {
      const rows = buildReadingRows(top.items);
      return { rows, group: rows.length > 0, crumb: [{ title: top.title }] };
    }

    const rows = [
      ...top.items.map((it) => ({ ...it, kind: 'link', group: '' })),
      ...top.children.map((c) => ({ kind: 'folder', id: c.id, title: c.title, count: c.items.length })),
    ];
    return {
      rows,
      group: false,
      splitSections: top.items.length > 0 && top.children.length > 0,
      crumb: [{ title: top.title }],
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

  const editor = window.NAV.createEditor({ state, currentFolderId, loadBookmarks, toggleFavorite });
  const settingsModal = window.NAV.createSettingsModal({
    state,
    savePrefs,
    loadBookmarks,
    closeMenu: editor.closeMenu,
  });

  /* ---------------- 渲染 ---------------- */

  function wireNavEdit(btn, node, allowFolderDrop) {
    if (!editor.canEdit) return;
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => editor.startDrag(node.id, true, e));
    btn.addEventListener('dragend', editor.endDrag);
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      editor.nodeMenu({ id: node.id, title: node.title, isFolder: true }, e.clientX, e.clientY);
    });
    btn.addEventListener('dragover', (e) => {
      const drag = editor.getDrag();
      if (!drag.id || (!allowFolderDrop && drag.isFolder)) return;
      e.preventDefault();
      btn.classList.add('drop-into');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('drop-into'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('drop-into');
      const drag = editor.getDrag();
      if (drag.id && (allowFolderDrop || !drag.isFolder)) editor.doMove(drag.id, node.id);
    });
  }

  function renderNav() {
    const frag = document.createDocumentFragment();

    const fav = el('button', 'n-item');
    fav.type = 'button';
    fav.dataset.top = '__favorites__';
    if (!state.q && !state.view.subId && state.view.topId === '__favorites__') fav.classList.add('on');
    fav.append(icon(PHOSPHOR.star, 15, 'fico'), el('span', 'nm', '我的收藏'));
    const favCount = new Set([...state.favorites, ...state.loose.map((it) => it.id)]).size;
    fav.append(el('span', 'n', String(favCount)));
    frag.append(fav);

    if (state.tops.length) {
      frag.append(el('div', 'n-div'), el('div', 'n-label', '分组'));
    }

    for (const t of state.tops) {
      const open = state.expanded.has(t.id) || t.children.some((c) => c.id === state.view.subId);
      const btn = el('button', 'n-item');
      btn.type = 'button';
      btn.dataset.top = t.id;
      if (open) btn.classList.add('open');
      if (!state.q && !state.view.subId && state.view.topId === t.id) btn.classList.add('on');
      btn.append(icon(open && t.children.length ? PHOSPHOR.folderOpen : PHOSPHOR.folder, 15, 'fico'));
      btn.append(el('span', 'nm', t.title), el('span', 'n', String(countOf(t))));
      wireNavEdit(btn, t, true);
      frag.append(btn);

      if (open && t.children.length) {
        const kids = el('div', 'n-kids');
        for (const c of t.children) {
          const sb = el('button', 'n-sub');
          sb.type = 'button';
          sb.dataset.top = t.id;
          sb.dataset.sub = c.id;
          if (!state.q && state.view.subId === c.id) sb.classList.add('on');
          sb.append(el('span', 'nm', c.title), el('span', 'n', String(c.items.length)));
          wireNavEdit(sb, c, false);
          kids.append(sb);
        }
        frag.append(kids);
      }
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
      if (!last && entry && entry.topId) {
        const btn = el('button', 'bc-link', label);
        btn.type = 'button';
        btn.addEventListener('click', () => selectTop(entry.topId));
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
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          editor.nodeMenu({ id: it.id, title: it.title, isFolder: true }, e.clientX, e.clientY);
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

    a.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      openUrl(it.url, false);
    });

    if (editor.canEdit) {
      a.draggable = true;
      a.addEventListener('dragstart', (e) => {
        editor.startDrag(it.id, false, e);
        a.classList.add('dragging');
      });
      a.addEventListener('dragend', () => {
        editor.endDrag();
        a.classList.remove('dragging');
      });
      a.addEventListener('dragover', (e) => {
        const drag = editor.getDrag();
        if (!drag.id || drag.isFolder || drag.id === it.id || state.filter === 'search') return;
        e.preventDefault();
        a.classList.add('drop-into');
      });
      a.addEventListener('dragleave', () => a.classList.remove('drop-into'));
      a.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        a.classList.remove('drop-into');
        const drag = editor.getDrag();
        if (drag.id && !drag.isFolder && drag.id !== it.id && state.filter !== 'search') {
          editor.doMoveBefore(drag.id, it.id);
        }
      });
      a.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        editor.nodeMenu({ id: it.id, title: it.title, isFolder: false }, e.clientX, e.clientY);
      });
    }
    return a;
  }

  function renderEmptyState() {
    els.emptyS.replaceChildren();
    if (state.filter === 'search') {
      els.emptyT.textContent = '没有匹配的书签';
      els.emptyS.append(document.createTextNode('按 '), el('kbd', '', 'Esc'), document.createTextNode(' 清空搜索，或换个关键词试试'));
    } else if (state.view.topId === '__favorites__') {
      els.emptyT.textContent = '还没有收藏的书签';
      els.emptyS.textContent = '在任意书签上右键选择「收藏」，即可固定到这里';
    } else {
      els.emptyT.textContent = '这个分组是空的';
      els.emptyS.append(document.createTextNode('按 '), el('kbd', '', '/'), document.createTextNode(' 搜索全部收藏'));
    }
  }

  function renderRows(view) {
    // 切换视图时重置键盘选中索引
    state.rows = view.rows;
    state.sel = -1;

    const frag = document.createDocumentFragment();
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
  }

  function render() {
    const view = computeView();
    const hasQuery = state.q.length > 0;
    if (els.search) els.search.classList.toggle('has-q', hasQuery);
    if (els.searchClear) els.searchClear.hidden = !hasQuery;
    if (els.newFolder) els.newFolder.disabled = !editor.canEdit || !currentFolderId() || state.filter === 'search';
    renderNav();
    renderBc(view.crumb, view.hits);
    renderRows(view);
  }

  /* ---------------- 导航与键盘交互 ---------------- */

  function openUrl(url, forceNew) {
    if (forceNew || state.openMode === 'tab') window.open(url, '_blank', 'noopener');
    else location.href = url;
  }

  function selectTop(id, toggle = false) {
    if (id === '__favorites__') {
      state.view = { topId: id, subId: '' };
      state.q = '';
      els.q.value = '';
      persistView();
      render();
      return;
    }
    const top = findTop(id);
    if (!top) return;
    const already = !state.view.subId && state.view.topId === id;
    if (toggle && already && top.children.length) {
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
    } else {
      state.expanded.add(id);
    }
    state.view = { topId: id, subId: '' };
    state.q = '';
    els.q.value = '';
    persistView();
    render();
  }

  function selectSub(topId, subId) {
    state.view = { topId, subId };
    state.expanded.add(topId);
    state.q = '';
    els.q.value = '';
    persistView();
    render();
  }

  function openFolder(id) {
    const hit = findSub(id);
    if (hit) selectSub(hit.top.id, id);
    else if (findTop(id)) selectTop(id);
  }

  function moveSel(delta) {
    if (!state.rows.length) return;
    const next = Math.min(state.rows.length - 1, Math.max(0, state.sel + delta));
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
    const sub = e.target.closest('.n-sub');
    if (sub) {
      selectSub(sub.dataset.top, sub.dataset.sub);
      return;
    }
    const top = e.target.closest('.n-item');
    if (top) selectTop(top.dataset.top, true);
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

  if (els.newFolder) {
    els.newFolder.addEventListener('click', () => editor.createDialog(currentFolderId()));
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
      } else if (state.view.subId) {
        selectTop(state.view.topId);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!state.rows.length) return;
      e.preventDefault();
      moveSel(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (!inField && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      if (!state.rows.length) return;
      e.preventDefault();
      moveSel(e.key === 'ArrowRight' ? 1 : -1);
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
      if (state.view.topId) state.expanded.add(state.view.topId);
    } else {
      if (state.view.subId && !findSub(state.view.subId)) state.view.subId = '';
      if (!findTop(state.view.topId) && state.view.topId !== '__favorites__') state.view = defaultView();
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
      if (prefs.view && prefs.view.topId) state.view = { ...prefs.view };
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
