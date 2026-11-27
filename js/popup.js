'use strict';

/**
 * NAV — 工具栏快捷收藏弹窗 UI 与交互（依赖 shared.js 与 classifier.js）。
 */
(() => {
  const { DEFAULTS, $, el, applyTheme, applyFont, findNode, makeFavicon } = window.NAV;
  const { parseUrl, detectPageKind, cleanTitle, buildFolders, findReadingFolder, trainLocalModel } = window.NAV.classifier;

  const MAX_FEEDBACK = 200;
  const NEW_PREFIX = '__new__:';
  const READING_DEFAULT_NAME = '阅读清单';

  const els = {
    popTitle: $('#pop-title'),
    popBadge: $('#pop-badge'),
    popForm: $('#pop-form'),
    fvSlot: $('#fv-slot'),
    pageHost: $('#page-host'),
    kindTag: $('#kind-tag'),
    pageReason: $('#page-reason'),
    titleInput: $('#title-input'),
    titleToggle: $('#title-toggle'),
    folderSelect: $('#folder-select'),
    newFolderBtn: $('#new-folder-btn'),
    newFolderBox: $('#new-folder-box'),
    newFolderName: $('#new-folder-name'),
    newFolderOk: $('#new-folder-ok'),
    newFolderCancel: $('#new-folder-cancel'),
    matchHint: $('#match-hint'),
    quickPicks: $('#quick-picks'),
    favToggle: $('#fav-toggle'),
    cleanHashRow: $('#clean-hash-row'),
    cleanHashToggle: $('#clean-hash-toggle'),
    cleanHashLabel: $('#clean-hash-label'),
    removeBtn: $('#remove-btn'),
    cancelBtn: $('#cancel-btn'),
    saveBtn: $('#save-btn'),
    popMsg: $('#pop-msg'),
    msgT: $('#msg-t'),
    msgS: $('#msg-s'),
    msgActions: $('#msg-actions'),
  };

  const ctx = {
    prefs: { ...DEFAULTS },
    tab: null,
    urlInfo: null,
    pageKind: null,
    existing: null,
    rootNode: null,
    folders: [],
    folderMap: new Map(),
    predictedId: '',
    pendingFolders: [],
    rawTitle: '',
    cleanName: '',
  };

  function renderFolderSelect(selectedValue) {
    const frag = document.createDocumentFragment();
    for (const pf of ctx.pendingFolders) {
      const opt = el('option', '', `＋ 新建：${pf.title}`);
      opt.value = pf.value;
      if (pf.value === selectedValue) opt.selected = true;
      frag.append(opt);
    }
    for (const f of ctx.folders) {
      const label = f.isRoot ? f.pathLabel : `${'　'.repeat(Math.max(0, f.depth - 1))}${f.title}`;
      const opt = el('option', '', label);
      opt.value = f.id;
      if (f.id === selectedValue) opt.selected = true;
      frag.append(opt);
    }
    els.folderSelect.replaceChildren(frag);
  }

  function syncQuickPickActive() {
    const cur = els.folderSelect.value;
    els.quickPicks.querySelectorAll('.qpick').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === cur);
    });
  }

  function ensurePendingFolder(name) {
    const clean = (name || '').trim();
    if (!clean) return '';
    const exists = ctx.folders.find((f) => f.depth === 1 && f.title === clean);
    if (exists) {
      renderFolderSelect(exists.id);
      syncQuickPickActive();
      return exists.id;
    }
    const value = `${NEW_PREFIX}${clean}`;
    if (!ctx.pendingFolders.some((p) => p.value === value)) {
      ctx.pendingFolders.unshift({ value, title: clean });
    }
    renderFolderSelect(value);
    syncQuickPickActive();
    return value;
  }

  function renderQuickPicks(candidates, selectedId, offerReading) {
    const list = candidates.filter((f, idx, arr) => f && arr.findIndex((x) => x.id === f.id) === idx);
    if (list.length <= 1 && !offerReading) {
      els.quickPicks.hidden = true;
      return;
    }
    const frag = document.createDocumentFragment();
    if (offerReading) {
      const val = `${NEW_PREFIX}${READING_DEFAULT_NAME}`;
      const btn = el('button', 'qpick create', `+ 建「${READING_DEFAULT_NAME}」`);
      btn.type = 'button';
      btn.dataset.id = val;
      if (selectedId === val) btn.classList.add('on');
      btn.addEventListener('click', () => {
        ensurePendingFolder(READING_DEFAULT_NAME);
        els.pageReason.textContent = `保存时将自动创建「${READING_DEFAULT_NAME}」并存入`;
      });
      frag.append(btn);
    }
    for (const f of list) {
      const btn = el('button', 'qpick', f.title);
      btn.type = 'button';
      btn.dataset.id = f.id;
      if (f.id === selectedId) btn.classList.add('on');
      btn.addEventListener('click', () => {
        els.folderSelect.value = f.id;
        syncQuickPickActive();
      });
      frag.append(btn);
    }
    els.quickPicks.replaceChildren(frag);
    els.quickPicks.hidden = false;
  }

  function closeNewFolderInput() {
    els.newFolderBox.hidden = true;
    els.newFolderName.value = '';
  }

  function confirmNewFolderInput() {
    const name = els.newFolderName.value.trim();
    if (!name) return els.newFolderName.focus();
    const val = ensurePendingFolder(name);
    if (val) {
      els.pageReason.textContent = val.startsWith(NEW_PREFIX)
        ? `保存时将创建分组「${name}」并存入`
        : `将归入「${name}」`;
    }
    closeNewFolderInput();
    els.saveBtn.focus();
  }

  function showMessage(title, subtitle, actions = []) {
    els.popForm.hidden = true;
    els.popMsg.hidden = false;
    els.msgT.textContent = title;
    els.msgS.textContent = subtitle || '';
    const frag = document.createDocumentFragment();
    for (const a of actions) {
      const b = el('button', `btn${a.ghost ? ' ghost' : ''}`, a.label);
      b.type = 'button';
      b.addEventListener('click', a.run);
      frag.append(b);
    }
    els.msgActions.replaceChildren(frag);
  }

  async function syncFavorite(bookmarkId, wantFav) {
    const favs = Array.isArray(ctx.prefs.favorites) ? [...ctx.prefs.favorites] : [];
    const idx = favs.indexOf(bookmarkId);
    if (wantFav && idx < 0) favs.unshift(bookmarkId);
    else if (!wantFav && idx >= 0) favs.splice(idx, 1);
    ctx.prefs.favorites = favs;
    await chrome.storage.local.set({ favorites: favs });
  }

  async function recordFeedback(url, title, folderId, corrected) {
    const prev = Array.isArray(ctx.prefs.mlFeedback) ? ctx.prefs.mlFeedback : [];
    const next = [{ url, title, folderId, corrected: !!corrected }, ...prev.filter((i) => i && i.url !== url)].slice(
      0,
      MAX_FEEDBACK,
    );
    ctx.prefs.mlFeedback = next;
    await chrome.storage.local.set({ mlFeedback: next, lastFolderId: folderId });
  }

  async function handleSave() {
    const title = els.titleInput.value.trim() || ctx.tab.title || ctx.tab.url;
    const selectedVal = els.folderSelect.value;
    if (!selectedVal) return;

    let finalUrl = ctx.existing ? ctx.existing.url : ctx.tab.url;
    if (!els.cleanHashRow.hidden && els.cleanHashToggle.checked) {
      const targetInfo = ctx.existing ? parseUrl(ctx.existing.url) : ctx.urlInfo;
      if (targetInfo && targetInfo.trimHash) finalUrl = targetInfo.cleanUrl;
    }

    els.saveBtn.disabled = true;
    try {
      let parentId = selectedVal;
      let targetName = '';
      if (selectedVal.startsWith(NEW_PREFIX)) {
        const newName = selectedVal.slice(NEW_PREFIX.length).trim();
        const createdFolder = await chrome.bookmarks.create({ parentId: ctx.rootNode.id, title: newName });
        parentId = createdFolder.id;
        targetName = newName;
      } else {
        const target = ctx.folderMap.get(parentId);
        targetName = target ? target.pathLabel : '收藏夹';
      }

      let id = '';
      if (ctx.existing) {
        id = ctx.existing.id;
        const patch = {};
        if (title !== ctx.existing.title) patch.title = title;
        if (finalUrl !== ctx.existing.url) patch.url = finalUrl;
        if (Object.keys(patch).length) await chrome.bookmarks.update(id, patch);
        if (parentId !== ctx.existing.parentId) await chrome.bookmarks.move(id, { parentId });
      } else {
        const created = await chrome.bookmarks.create({ parentId, title, url: finalUrl });
        id = created.id;
      }

      const corrected = !!ctx.predictedId && selectedVal !== ctx.predictedId;
      await syncFavorite(id, els.favToggle.checked);
      await recordFeedback(finalUrl, title, parentId, corrected);

      showMessage(
        ctx.existing ? '已更新收藏' : '已加入收藏',
        `分组：${targetName}${corrected ? '（已学习本次选择）' : ''}`,
      );
      setTimeout(() => window.close(), 560);
    } catch {
      els.saveBtn.disabled = false;
      showMessage('保存失败', '请检查浏览器书签权限后重试。');
    }
  }

  async function handleRemove() {
    if (!ctx.existing) return;
    els.removeBtn.disabled = true;
    try {
      await chrome.bookmarks.remove(ctx.existing.id);
      await syncFavorite(ctx.existing.id, false);
      showMessage('已移除书签', ctx.existing.title || '');
      setTimeout(() => window.close(), 480);
    } catch {
      els.removeBtn.disabled = false;
      showMessage('移除失败', '该书签可能已被删除。');
    }
  }

  function syncTitleToggle() {
    if (!els.titleToggle) return;
    if (!ctx.rawTitle || !ctx.cleanName || ctx.rawTitle === ctx.cleanName) {
      els.titleToggle.hidden = true;
      return;
    }
    const cur = els.titleInput.value.trim();
    els.titleToggle.hidden = false;
    els.titleToggle.textContent = cur === ctx.cleanName ? '已精简 · 还原' : '使用精简名';
  }

  if (els.titleToggle) {
    els.titleToggle.addEventListener('click', () => {
      const cur = els.titleInput.value.trim();
      els.titleInput.value = cur === ctx.cleanName ? ctx.rawTitle : ctx.cleanName;
      syncTitleToggle();
      els.titleInput.focus();
      els.titleInput.select();
    });
  }
  els.titleInput.addEventListener('input', syncTitleToggle);

  els.folderSelect.addEventListener('change', syncQuickPickActive);
  els.newFolderBtn.addEventListener('click', () => {
    if (els.newFolderBox.hidden) {
      els.newFolderBox.hidden = false;
      els.newFolderName.focus();
    } else {
      closeNewFolderInput();
    }
  });
  els.newFolderOk.addEventListener('click', confirmNewFolderInput);
  els.newFolderCancel.addEventListener('click', closeNewFolderInput);
  els.newFolderName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmNewFolderInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeNewFolderInput();
    }
  });

  els.saveBtn.addEventListener('click', handleSave);
  els.removeBtn.addEventListener('click', handleRemove);
  els.cancelBtn.addEventListener('click', () => window.close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.newFolderBox.hidden) return closeNewFolderInput();
      window.close();
      return;
    }
    if (e.key === 'Enter' && !els.popForm.hidden && els.newFolderBox.hidden) {
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      handleSave();
    }
  });

  (async () => {
    try {
      Object.assign(ctx.prefs, await chrome.storage.local.get(DEFAULTS));
    } catch {
      /* 使用默认偏好 */
    }
    applyTheme(ctx.prefs.theme);
    applyFont(ctx.prefs.font);

    let tab = null;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
      tab = null;
    }

    const urlInfo = tab && tab.url ? parseUrl(tab.url) : { ok: false };
    if (!tab || !urlInfo.ok) {
      showMessage('当前页面不支持收藏', '仅支持收藏 http / https 网页。', [
        {
          label: '打开书签主页',
          run: () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
            window.close();
          },
        },
        { label: '关闭', ghost: true, run: () => window.close() },
      ]);
      return;
    }

    ctx.tab = tab;
    ctx.urlInfo = urlInfo;
    ctx.pageKind = detectPageKind(urlInfo);

    let treeRoot;
    try {
      [treeRoot] = await chrome.bookmarks.getTree();
    } catch {
      showMessage('无法读取收藏夹', '请确认已授予书签权限。');
      return;
    }

    const rootNode = findNode(treeRoot, ctx.prefs.rootId) || (treeRoot.children || [])[0];
    if (!rootNode) {
      showMessage('未找到收藏夹目录', '请在设置中重新选择数据来源。');
      return;
    }

    ctx.rootNode = rootNode;
    ctx.folders = buildFolders(rootNode);
    ctx.folderMap = new Map(ctx.folders.map((f) => [f.id, f]));

    try {
      const queries = [chrome.bookmarks.search({ url: tab.url })];
      if (urlInfo.trimHash && urlInfo.cleanUrl !== tab.url) {
        queries.push(chrome.bookmarks.search({ url: urlInfo.cleanUrl }));
      }
      const hits = (await Promise.all(queries)).flat();
      ctx.existing = hits.find((h) => ctx.folderMap.has(h.parentId)) || hits[0] || null;
    } catch {
      ctx.existing = null;
    }

    els.fvSlot.replaceChildren(makeFavicon(tab.url, urlInfo.host));
    els.pageHost.textContent = urlInfo.host;
    els.kindTag.textContent = ctx.pageKind.label;
    els.kindTag.classList.toggle('is-content', ctx.pageKind.kind === 'content');
    els.kindTag.hidden = false;

    const hashInfo = ctx.existing ? parseUrl(ctx.existing.url) : urlInfo;
    if (hashInfo && hashInfo.trimHash) {
      els.cleanHashLabel.textContent = `去掉锚点 ${hashInfo.trimHash}（从开头打开）`;
      els.cleanHashToggle.checked = true;
      els.cleanHashRow.hidden = false;
    }

    if (ctx.existing) {
      els.popTitle.textContent = '编辑收藏';
      els.popBadge.textContent = '已收藏';
      els.popBadge.hidden = false;
      ctx.rawTitle = (ctx.existing.title || tab.title || urlInfo.host).trim();
      ctx.cleanName = cleanTitle(ctx.rawTitle, urlInfo, ctx.pageKind);
      els.titleInput.value = ctx.rawTitle;
      syncTitleToggle();
      const curFolder = ctx.folderMap.get(ctx.existing.parentId);
      els.pageReason.textContent = curFolder ? `当前位于「${curFolder.pathLabel}」` : '当前已保存在其它目录';
      renderFolderSelect(curFolder ? curFolder.id : rootNode.id);
      els.favToggle.checked = Array.isArray(ctx.prefs.favorites) && ctx.prefs.favorites.includes(ctx.existing.id);
      els.saveBtn.textContent = '更新';
      els.removeBtn.hidden = false;
    } else {
      const rec = trainLocalModel(ctx.folders, ctx.prefs.mlFeedback).predict(
        urlInfo.cleanUrl,
        tab.title || '',
        ctx.prefs.lastFolderId,
      );
      const readingFolder = findReadingFolder(ctx.folders);

      let chosenVal = rec.best ? rec.best.id : rootNode.id;
      let reasonLine = `推荐归入「${rec.best ? rec.best.pathLabel : rootNode.title}」`;
      let hintText = rec.reason;
      let badgeText = rec.confidence ? `本地模型 ${rec.confidence}%` : '本地模型';
      let quickList = [...rec.candidates];
      let offerReading = false;

      if (ctx.pageKind.kind === 'content') {
        if (readingFolder) {
          chosenVal = readingFolder.id;
          reasonLine = `识别为具体内容，优先归入「${readingFolder.pathLabel}」`;
          hintText = '内容页 · 优先阅读清单';
          badgeText = '阅读清单';
          quickList = [readingFolder, ...rec.candidates];
        } else {
          chosenVal = `${NEW_PREFIX}${READING_DEFAULT_NAME}`;
          ctx.pendingFolders.push({ value: chosenVal, title: READING_DEFAULT_NAME });
          reasonLine = '识别为帖子/文章，建议与站点入口分开存放';
          hintText = '建议新建阅读清单';
          badgeText = '内容页';
          offerReading = true;
        }
      }

      ctx.predictedId = chosenVal;
      ctx.rawTitle = (tab.title || '').trim() || urlInfo.host;
      ctx.cleanName = cleanTitle(ctx.rawTitle, urlInfo, ctx.pageKind);
      els.popTitle.textContent = '收藏当前页';
      els.popBadge.textContent = badgeText;
      els.popBadge.hidden = false;
      els.titleInput.value = ctx.cleanName;
      syncTitleToggle();
      els.pageReason.textContent = reasonLine;
      els.matchHint.textContent = hintText;
      renderFolderSelect(chosenVal);
      renderQuickPicks(quickList, chosenVal, offerReading);
      els.saveBtn.textContent = '保存';
    }

    els.titleInput.focus();
    els.titleInput.select();
  })();
})();
