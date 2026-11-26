'use strict';

/**
 * NAV — 独立设置页逻辑（复用于浏览器扩展管理页入口，共享 shared.js）。
 */
(() => {
  const { hasExt, DEFAULTS, mq, $, applyTheme, applyFont, paintSeg, populateRootSelect, createFontPicker } = window.NAV;

  const settings = {
    rootId: DEFAULTS.rootId,
    openMode: DEFAULTS.openMode,
    theme: DEFAULTS.theme,
    font: DEFAULTS.font,
  };

  const rootSelect = $('#root');
  const savedTag = $('#saved');
  let savedTimer = 0;

  function flashSaved(msg = '已保存') {
    savedTag.textContent = msg;
    savedTag.classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => savedTag.classList.remove('on'), 1400);
  }

  function save(patch) {
    Object.assign(settings, patch);
    if (!hasExt || !chrome.storage || !chrome.storage.local) return flashSaved();
    chrome.storage.local.set(patch).then(() => flashSaved());
  }

  function wireSeg(id, key, after) {
    const box = $(`#${id}`);
    paintSeg(box, settings[key]);
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      paintSeg(box, btn.dataset.value);
      save({ [key]: btn.dataset.value });
      if (after) after();
    });
  }

  const fontPicker = createFontPicker({
    picker: $('#font-picker'),
    trigger: $('#font-trigger'),
    cur: $('#font-cur'),
    panel: $('#font-panel'),
    search: $('#font-search'),
    list: $('#font-list'),
    maxHeight: 224,
    getValue: () => settings.font,
    onSelect: (val) => {
      save({ font: val });
      applyFont(val);
    },
  });

  rootSelect.addEventListener('change', () => save({ rootId: rootSelect.value }));

  const exportBtn = $('#export-btn');
  const importBtn = $('#import-btn');

  async function readFavorites() {
    if (!hasExt || !chrome.storage || !chrome.storage.local) return [];
    try {
      const res = await chrome.storage.local.get({ favorites: [] });
      return Array.isArray(res.favorites) ? res.favorites : [];
    } catch {
      return [];
    }
  }

  if (exportBtn && window.NAV.transfer) {
    exportBtn.addEventListener('click', async () => {
      try {
        await window.NAV.transfer.exportRoot(settings.rootId, await readFavorites());
        flashSaved('已导出 JSON');
      } catch {
        flashSaved('导出失败');
      }
    });
  }

  if (importBtn && window.NAV.transfer) {
    importBtn.addEventListener('click', () => {
      fontPicker.close();
      window.NAV.transfer.openImportDialog({
        getRootId: () => settings.rootId,
        getFavorites: readFavorites,
        onDone: async (res) => {
          await populateRootSelect(rootSelect, settings.rootId);
          flashSaved(res && res.mode === 'replace' ? '已备份并替换导入' : '已追加导入');
        },
      });
    });
  }

  $('#reset').addEventListener('click', () => {
    const patch = {
      rootId: DEFAULTS.rootId,
      openMode: DEFAULTS.openMode,
      theme: DEFAULTS.theme,
      font: DEFAULTS.font,
    };
    save(patch);
    paintSeg($('#openMode'), patch.openMode);
    paintSeg($('#theme'), patch.theme);
    applyTheme(patch.theme);
    applyFont(patch.font);
    fontPicker.syncLabel();
    fontPicker.close();
    if (rootSelect.querySelector('option[value="1"]')) rootSelect.value = '1';
  });

  function goBack(e) {
    if (e) e.preventDefault();
    if (history.length > 1) history.back();
    else location.href = 'newtab.html';
  }

  $('#back').addEventListener('click', goBack);
  mq.addEventListener('change', () => applyTheme(settings.theme));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (window.NAV.transfer && window.NAV.transfer.isDialogOpen()) {
      e.preventDefault();
      window.NAV.transfer.closeDialog();
      return;
    }
    if (fontPicker.isOpen()) {
      e.preventDefault();
      fontPicker.close(true);
      return;
    }
    goBack();
  });

  (async () => {
    if (hasExt && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get(settings);
      Object.assign(settings, stored);
    }
    applyTheme(settings.theme);
    applyFont(settings.font);
    wireSeg('openMode', 'openMode');
    wireSeg('theme', 'theme', () => applyTheme(settings.theme));

    const resolvedRoot = await populateRootSelect(rootSelect, settings.rootId);
    if (resolvedRoot !== settings.rootId) {
      settings.rootId = resolvedRoot;
      if (hasExt && chrome.storage && chrome.storage.local) chrome.storage.local.set({ rootId: resolvedRoot });
    }
    fontPicker.load();

    const m = hasExt && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
    if (m) $('#ver').textContent = `v${m.version}`;
  })();
})();
