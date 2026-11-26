'use strict';

/**
 * NAV — 新标签页居中设置弹窗模块。
 */
(() => {
  const { hasExt, DEFAULTS, $, applyTheme, applyFont, paintSeg, populateRootSelect, createFontPicker } = window.NAV;

  window.NAV.createSettingsModal = ({ state, savePrefs, loadBookmarks, closeMenu }) => {
    const overlay = $('#settings-overlay');
    const triggerBtn = $('#settings');
    const closeBtn = $('#set-close');
    const doneBtn = $('#set-done');
    const rootSel = $('#set-root');
    const exportBtn = $('#set-export');
    const importBtn = $('#set-import');
    const openModeSeg = $('#set-openMode');
    const themeSeg = $('#set-theme');
    const resetBtn = $('#set-reset');
    const savedEl = $('#set-saved');
    const verEl = $('#set-ver');

    let savedTimer = 0;

    function flash(msg = '已保存') {
      if (!savedEl) return;
      savedEl.textContent = msg;
      savedEl.classList.add('on');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => savedEl.classList.remove('on'), 1400);
    }

    const fontPicker = createFontPicker({
      picker: $('#font-picker'),
      trigger: $('#font-trigger'),
      cur: $('#font-cur'),
      panel: $('#font-panel'),
      search: $('#font-search'),
      list: $('#font-list'),
      scrollBox: $('.sdlg-body'),
      bottomEl: $('.sdlg-foot'),
      maxHeight: 192,
      getValue: () => state.font,
      onSelect: (val) => {
        state.font = val;
        applyFont(val);
        savePrefs({ font: val });
        flash();
      },
    });

    const isOpen = () => !!overlay && !overlay.hidden;

    function sync() {
      paintSeg(openModeSeg, state.openMode);
      paintSeg(themeSeg, state.theme);
      fontPicker.syncLabel();
      if (verEl) {
        const m = hasExt && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
        verEl.textContent = m ? `v${m.version}` : '';
      }
    }

    async function open() {
      if (!overlay) {
        location.href = 'options.html';
        return;
      }
      closeMenu();
      fontPicker.close();
      sync();
      await Promise.all([populateRootSelect(rootSel, state.rootId), fontPicker.load()]);
      overlay.hidden = false;
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      if (!overlay || overlay.hidden) return;
      fontPicker.close();
      overlay.hidden = true;
      if (triggerBtn) triggerBtn.focus();
    }

    if (overlay) {
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) close();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (doneBtn) doneBtn.addEventListener('click', close);
    if (triggerBtn) triggerBtn.addEventListener('click', open);

    if (rootSel) {
      rootSel.addEventListener('change', () => {
        state.rootId = rootSel.value;
        savePrefs({ rootId: state.rootId });
        loadBookmarks();
        flash();
      });
    }

    if (exportBtn && window.NAV.transfer) {
      exportBtn.addEventListener('click', async () => {
        try {
          await window.NAV.transfer.exportRoot(state.rootId, state.favorites);
          flash('已导出 JSON');
        } catch {
          flash('导出失败');
        }
      });
    }

    if (importBtn && window.NAV.transfer) {
      importBtn.addEventListener('click', () => {
        fontPicker.close();
        window.NAV.transfer.openImportDialog({
          getRootId: () => state.rootId,
          getFavorites: () => state.favorites,
          onDone: (res) => {
            if (res && res.mode === 'replace') {
              if (Array.isArray(res.favorites)) state.favorites = res.favorites;
              if (state.expanded) state.expanded.clear();
            }
            loadBookmarks();
            flash(res && res.mode === 'replace' ? '已备份并替换导入' : '已追加导入');
          },
        });
      });
    }

    if (openModeSeg) {
      openModeSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        state.openMode = btn.dataset.value;
        paintSeg(openModeSeg, state.openMode);
        savePrefs({ openMode: state.openMode });
        flash();
      });
    }

    if (themeSeg) {
      themeSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        state.theme = btn.dataset.value;
        paintSeg(themeSeg, state.theme);
        applyTheme(state.theme);
        savePrefs({ theme: state.theme });
        flash();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const patch = {
          rootId: DEFAULTS.rootId,
          openMode: DEFAULTS.openMode,
          theme: DEFAULTS.theme,
          font: DEFAULTS.font,
        };
        Object.assign(state, patch);
        savePrefs(patch);
        applyTheme(state.theme);
        applyFont(state.font);
        fontPicker.close();
        sync();
        if (rootSel && rootSel.querySelector(`option[value="${DEFAULTS.rootId}"]`)) {
          rootSel.value = DEFAULTS.rootId;
        }
        loadBookmarks();
        flash('已恢复默认');
      });
    }

    return {
      isOpen,
      sync,
      open,
      close,
      handleEscape: () => {
        if (window.NAV.transfer && window.NAV.transfer.isDialogOpen()) window.NAV.transfer.closeDialog();
        else if (fontPicker.isOpen()) fontPicker.close(true);
        else close();
      },
    };
  };
})();
