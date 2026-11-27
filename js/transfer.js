'use strict';

/**
 * NAV — 书签 JSON 导入导出模块（newtab 设置弹窗与独立 options 页共用）
 * - 导出精简多级 JSON（含按 URL 映射的 favorites），便于备份或交由 AI 整理
 * - 导入支持选文件或直接粘贴（自动剥离 Markdown 代码块），按数组顺序串行写入
 * - 替换模式先自动下载备份，并复用已有 URL 节点移动，无损保留原有收藏时间与顺序
 */
(() => {
  const { hasExt, el, isLink, findNode, hostOf } = window.NAV;

  function dateStamp(withTime = false) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    if (!withTime) return day;
    return `${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function isHttpUrl(raw) {
    try {
      const u = new URL(String(raw || '').trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function exportFolder(node, depth) {
    const items = [];
    const children = [];
    for (const c of node.children || []) {
      if (isLink(c)) items.push({ title: (c.title || '').trim() || hostOf(c.url), url: c.url });
      else if (!c.url) children.push(exportFolder(c, depth + 1));
    }
    const out = { title: (node.title || '未命名').trim(), items };
    if (depth === 1 || children.length > 0) out.children = children;
    return out;
  }

  function buildExportData(rootNode, favoriteIds) {
    const favIdSet = new Set(Array.isArray(favoriteIds) ? favoriteIds : []);
    const favorites = [];
    const seenFav = new Set();
    const record = (node) => {
      if (isLink(node) && favIdSet.has(node.id) && !seenFav.has(node.url)) {
        seenFav.add(node.url);
        favorites.push(node.url);
      }
      for (const c of node.children || []) record(c);
    };
    record(rootNode);

    const loose = [];
    const folders = [];
    for (const child of rootNode.children || []) {
      if (isLink(child)) {
        loose.push({ title: (child.title || '').trim() || hostOf(child.url), url: child.url });
        continue;
      }
      if (child.url) continue;
      folders.push(exportFolder(child, 1));
    }

    return {
      version: 1,
      root: (rootNode.title || '收藏夹栏').trim(),
      exportedAt: new Date().toISOString(),
      favorites,
      loose,
      folders,
    };
  }

  function downloadJson(data, filename) {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportRoot(rootId, favoriteIds) {
    if (!hasExt) throw new Error('当前非扩展环境，无法读取书签');
    const [treeRoot] = await chrome.bookmarks.getTree();
    const rootNode = findNode(treeRoot, rootId) || (treeRoot.children || [])[0];
    if (!rootNode) throw new Error('未找到数据源目录');
    const data = buildExportData(rootNode, favoriteIds);
    downloadJson(data, `neattab-bookmarks-${dateStamp(false)}.json`);
    return data;
  }

  /** 从原始文本提取 JSON（自动兼容 AI 回复中的 ```json ... ``` 代码块）。 */
  function extractJsonText(raw) {
    const text = String(raw || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) return fenced[1].trim();
    return text;
  }

  function parseImportText(rawText) {
    const cleaned = extractJsonText(rawText);
    if (!cleaned) return { ok: false, error: '请选择文件或粘贴 JSON 内容' };

    let raw;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'JSON 解析失败，请检查格式是否完整' };
    }

    // 兼容直接粘贴 folders 数组
    const obj = Array.isArray(raw) ? { folders: raw } : raw;
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'JSON 根节点必须是对象或分组数组' };

    let skipped = 0;
    const normItem = (it) => {
      if (!it || typeof it !== 'object' || !isHttpUrl(it.url)) {
        skipped += 1;
        return null;
      }
      const url = String(it.url).trim();
      const title = String(it.title || '').trim() || hostOf(url) || url;
      return { title, url };
    };

    const loose = [];
    for (const it of Array.isArray(obj.loose) ? obj.loose : []) {
      const clean = normItem(it);
      if (clean) loose.push(clean);
    }

    const folders = [];
    let subCount = 0;
    let itemCount = loose.length;

    const parseFolder = (node, depth) => {
      if (!node || typeof node !== 'object') return null;
      const title = String(node.title || '').trim() || '未命名';
      const items = [];
      for (const it of Array.isArray(node.items) ? node.items : []) {
        const clean = normItem(it);
        if (clean) items.push(clean);
      }
      const children = [];
      for (const ch of Array.isArray(node.children) ? node.children : []) {
        const sub = parseFolder(ch, depth + 1);
        if (sub) children.push(sub);
      }
      if (depth >= 2) subCount += 1;
      itemCount += items.length;
      return { title, items, children };
    };

    for (const f of Array.isArray(obj.folders) ? obj.folders : []) {
      const top = parseFolder(f, 1);
      if (top) folders.push(top);
    }

    const hasFavorites = Array.isArray(obj.favorites);
    const favorites = [];
    const favSeen = new Set();
    for (const u of hasFavorites ? obj.favorites : []) {
      if (typeof u === 'string' && isHttpUrl(u)) {
        const trimmed = u.trim();
        if (!favSeen.has(trimmed)) {
          favSeen.add(trimmed);
          favorites.push(trimmed);
        }
      }
    }

    if (itemCount === 0 && folders.length === 0) {
      return { ok: false, error: '未识别到有效的书签或分组（请检查 folders / loose 字段）' };
    }

    return {
      ok: true,
      data: { loose, folders, favorites, hasFavorites },
      stats: { topCount: folders.length, subCount, itemCount, favCount: favorites.length, skipped },
    };
  }

  function indexExistingBookmarks(node, pool, nonHttp) {
    for (const c of node.children || []) {
      if (isLink(c)) {
        if (!pool.has(c.url)) pool.set(c.url, []);
        pool.get(c.url).push(c);
      } else if (c.url) {
        if (nonHttp) nonHttp.push(c);
      } else {
        indexExistingBookmarks(c, pool, nonHttp);
      }
    }
  }

  async function applyImport(rootId, parsedData, mode, currentFavorites) {
    if (!hasExt) throw new Error('当前非扩展环境，无法写入书签');
    const [treeRoot] = await chrome.bookmarks.getTree();
    const rootNode = findNode(treeRoot, rootId) || (treeRoot.children || [])[0];
    if (!rootNode) throw new Error('未找到目标目录');

    const createTree = async (parentId, folderList, placeFn) => {
      for (const f of folderList) {
        const created = await chrome.bookmarks.create({ parentId, title: f.title });
        for (const it of f.items) await placeFn(created.id, it);
        if (f.children && f.children.length) await createTree(created.id, f.children, placeFn);
      }
    };

    if (mode === 'append') {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const wrapTitle = `导入整理 ${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const wrap = await chrome.bookmarks.create({ parentId: rootNode.id, title: wrapTitle });
      const createLink = (parentId, it) => chrome.bookmarks.create({ parentId, title: it.title, url: it.url });
      for (const it of parsedData.loose) await createLink(wrap.id, it);
      await createTree(wrap.id, parsedData.folders, createLink);
      return { mode: 'append', wrapTitle };
    }

    // 替换模式：执行前自动下载当前目录备份 JSON，彻底兜底
    const backup = buildExportData(rootNode, currentFavorites);
    downloadJson(backup, `neattab-backup-${dateStamp(true)}.json`);

    // 建立已有书签池：优先 move 复用原节点，无损保留 dateAdded 与书签 ID；同时保全非 http/https 节点（如 edge:// 与小书签脚本）
    const pool = new Map();
    const preservedNonHttp = [];
    indexExistingBookmarks(rootNode, pool, preservedNonHttp);

    const urlToId = new Map();
    const placeItem = async (parentId, item) => {
      const queue = pool.get(item.url);
      let id = '';
      if (queue && queue.length) {
        const reused = queue.shift();
        await chrome.bookmarks.move(reused.id, { parentId });
        if ((reused.title || '') !== item.title) {
          await chrome.bookmarks.update(reused.id, { title: item.title });
        }
        id = reused.id;
      } else {
        const created = await chrome.bookmarks.create({ parentId, title: item.title, url: item.url });
        id = created.id;
      }
      if (!urlToId.has(item.url)) urlToId.set(item.url, id);
      return id;
    };

    // 阶段 1：在临时目录内按 JSON 精确顺序递归构建全部新结构
    const tmp = await chrome.bookmarks.create({ parentId: rootNode.id, title: '_neattab_import_tmp_' });
    for (const it of parsedData.loose) {
      await placeItem(tmp.id, it);
    }
    await createTree(tmp.id, parsedData.folders, placeItem);
    // 保留原有的非 http/https 书签（如浏览器内建页或小书签），避免替换阶段误删
    for (const special of preservedNonHttp) {
      await chrome.bookmarks.move(special.id, { parentId: tmp.id });
    }

    // 阶段 2：清理原目录中除临时目录外的旧节点
    const [treeAfterStage] = await chrome.bookmarks.getTree();
    const freshRoot = findNode(treeAfterStage, rootNode.id);
    for (const c of (freshRoot && freshRoot.children) || []) {
      if (c.id === tmp.id) continue;
      if (c.url) await chrome.bookmarks.remove(c.id);
      else await chrome.bookmarks.removeTree(c.id);
    }

    // 阶段 3：把临时目录里的子节点按原顺序提升到目标目录并移除临时目录
    const [treeBeforePromote] = await chrome.bookmarks.getTree();
    const freshTmp = findNode(treeBeforePromote, tmp.id);
    for (const c of (freshTmp && freshTmp.children) || []) {
      await chrome.bookmarks.move(c.id, { parentId: rootNode.id });
    }
    await chrome.bookmarks.remove(tmp.id);

    // 阶段 4：按 URL 还原「我的收藏」星标（若导入 JSON 未包含 favorites 字段，则沿用备份中的星标 URL）
    const favUrls = parsedData.hasFavorites ? parsedData.favorites : backup.favorites;
    const restoredFavs = [];
    for (const url of favUrls) {
      const id = urlToId.get(url);
      if (id && !restoredFavs.includes(id)) restoredFavs.push(id);
    }
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ favorites: restoredFavs, view: null, expanded: null });
    }
    return { mode: 'replace', favorites: restoredFavs };
  }

  /* ---------------- 通用直角导入弹窗 ---------------- */

  let activeOverlay = null;

  function closeDialog() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
  }

  function openImportDialog({ getRootId, getFavorites, onDone }) {
    closeDialog();

    const overlay = el('div', 'imp-overlay');
    const box = el('div', 'imp-dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '导入书签 JSON');

    const head = el('div', 'imp-head');
    head.append(el('h3', 'imp-title', '导入书签 JSON'));
    const fileBtn = el('button', 'btn ghost imp-file-btn', '选择文件…');
    fileBtn.type = 'button';
    const fileInput = el('input', 'imp-file-input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json,text/plain';
    head.append(fileBtn, fileInput);

    const textarea = el('textarea', 'imp-text');
    textarea.placeholder = '选择 .json 文件，或直接粘贴 AI 整理后的 JSON 文本（自动识别 ```json 代码块）…';
    textarea.spellcheck = false;

    const stat = el('div', 'imp-stat', '等待选择文件或粘贴 JSON…');

    const modes = el('div', 'imp-modes');
    let mode = 'replace';
    const makeRadio = (val, label, checked) => {
      const wrap = el('label', 'imp-radio');
      const r = el('input');
      r.type = 'radio';
      r.name = 'imp-mode';
      r.value = val;
      r.checked = checked;
      r.addEventListener('change', () => {
        mode = val;
        syncSubmitBtn();
      });
      wrap.append(r, el('span', '', label));
      return wrap;
    };
    modes.append(
      makeRadio('replace', '替换当前数据源目录（执行前自动先下载备份）', true),
      makeRadio('append', '追加为新分组（不改动现有书签）', false),
    );

    const foot = el('div', 'imp-foot');
    const cancelBtn = el('button', 'btn ghost', '取消');
    cancelBtn.type = 'button';
    const okBtn = el('button', 'btn', '备份并替换导入');
    okBtn.type = 'button';
    okBtn.disabled = true;
    foot.append(cancelBtn, okBtn);

    box.append(head, textarea, stat, modes, foot);
    overlay.append(box);

    let parsed = null;

    function syncSubmitBtn() {
      okBtn.disabled = !parsed || !parsed.ok;
      okBtn.textContent = mode === 'replace' ? '备份并替换导入' : '追加导入';
    }

    function validate() {
      const raw = textarea.value;
      if (!raw.trim()) {
        parsed = null;
        stat.className = 'imp-stat';
        stat.textContent = '等待选择文件或粘贴 JSON…';
        syncSubmitBtn();
        return;
      }
      parsed = parseImportText(raw);
      if (parsed.ok) {
        const s = parsed.stats;
        stat.className = 'imp-stat ok';
        stat.textContent =
          `已识别：${s.topCount} 个一级分组 · ${s.subCount} 个子分组 · ${s.itemCount} 条书签` +
          (s.favCount ? ` · ${s.favCount} 条星标` : '') +
          (s.skipped ? `（已跳过 ${s.skipped} 条无效链接）` : '');
      } else {
        stat.className = 'imp-stat err';
        stat.textContent = parsed.error;
      }
      syncSubmitBtn();
    }

    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || '');
        validate();
      };
      reader.readAsText(file, 'utf-8');
      fileInput.value = '';
    });

    textarea.addEventListener('input', validate);
    cancelBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) closeDialog();
    });

    okBtn.addEventListener('click', async () => {
      if (!parsed || !parsed.ok) return;
      okBtn.disabled = true;
      okBtn.textContent = '导入中…';
      try {
        const favs = typeof getFavorites === 'function' ? await getFavorites() : [];
        const res = await applyImport(getRootId(), parsed.data, mode, favs);
        closeDialog();
        if (onDone) onDone(res);
      } catch (err) {
        stat.className = 'imp-stat err';
        stat.textContent = (err && err.message) || '导入失败，请检查书签权限';
        syncSubmitBtn();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
      }
    });

    document.body.append(overlay);
    activeOverlay = overlay;
    textarea.focus();
  }

  window.NAV.transfer = {
    buildExportData,
    exportRoot,
    parseImportText,
    applyImport,
    openImportDialog,
    isDialogOpen: () => !!activeOverlay,
    closeDialog,
  };
})();
