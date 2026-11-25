'use strict';

/**
 * NAV — 新标签页编辑模块：右键菜单、模态对话框、书签增删改移与拖拽状态。
 */
(() => {
  const { hasExt, el } = window.NAV;

  window.NAV.createEditor = ({ state, currentFolderId, loadBookmarks, toggleFavorite }) => {
    const canEdit =
      hasExt && !!chrome.bookmarks.update && !!chrome.bookmarks.removeTree && !!chrome.bookmarks.create;

    let menuEl = null;
    let dialogEl = null;
    let dragId = '';
    let dragIsFolder = false;

    const closeMenu = () => {
      if (menuEl) {
        menuEl.remove();
        menuEl = null;
      }
    };

    const closeDialog = () => {
      if (dialogEl) {
        dialogEl.remove();
        dialogEl = null;
      }
    };

    async function folderOptions() {
      const out = [];
      try {
        const [root] = await chrome.bookmarks.getTree();
        const walk = (node, depth) => {
          for (const c of node.children || []) {
            if (c.url) continue;
            out.push({ id: c.id, title: (c.title || '未命名').trim(), depth });
            walk(c, depth + 1);
          }
        };
        walk(root, 0);
      } catch {
        /* 读不到目录就退化为空列表 */
      }
      return out;
    }

    function openMenu(x, y, items) {
      closeMenu();
      const menu = el('div', 'menu');
      menu.setAttribute('role', 'menu');
      for (const it of items) {
        if (it === '-') {
          menu.append(el('div', 'menu-sep'));
          continue;
        }
        const b = el('button', 'menu-item', it.label);
        b.type = 'button';
        if (it.danger) b.classList.add('danger');
        b.addEventListener('click', () => {
          closeMenu();
          it.run();
        });
        menu.append(b);
      }
      document.body.append(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
      menuEl = menu;
    }

    function openDialog({ title, desc, body, confirmText = '确定', danger = false, onConfirm, focus }) {
      closeDialog();
      const overlay = el('div', 'overlay');
      const box = el('div', 'dialog');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.append(el('h3', 'dlg-title', title));
      if (desc) box.append(el('p', 'dlg-desc', desc));
      if (body) box.append(body);

      const actions = el('div', 'dlg-actions');
      const cancel = el('button', 'btn ghost', '取消');
      cancel.type = 'button';
      const ok = el('button', `btn${danger ? ' danger' : ''}`, confirmText);
      ok.type = 'button';
      actions.append(cancel, ok);
      box.append(actions);
      overlay.append(box);

      const submit = () => {
        closeDialog();
        onConfirm();
      };
      cancel.addEventListener('click', closeDialog);
      ok.addEventListener('click', submit);
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) closeDialog();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeDialog();
        }
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
          e.preventDefault();
          submit();
        }
      });

      document.body.append(overlay);
      dialogEl = overlay;
      (focus || ok).focus();
    }

    async function isInside(targetId, folderId) {
      let cur = targetId;
      while (cur) {
        if (cur === folderId) return true;
        try {
          const [node] = await chrome.bookmarks.get(cur);
          cur = node ? node.parentId : '';
        } catch {
          return false;
        }
      }
      return false;
    }

    async function doUpdate(id, title) {
      try {
        await chrome.bookmarks.update(id, { title });
      } catch {
        /* 失败则保持原样 */
      }
      await loadBookmarks();
    }

    async function doRemove(node) {
      try {
        if (node.isFolder) await chrome.bookmarks.removeTree(node.id);
        else await chrome.bookmarks.remove(node.id);
      } catch {
        /* 忽略 */
      }
      await loadBookmarks();
    }

    async function doMove(id, parentId) {
      if (!id || !parentId || id === parentId) return;
      try {
        const [src] = await chrome.bookmarks.get(id);
        if (src && !src.url && (await isInside(parentId, id))) return;
        await chrome.bookmarks.move(id, { parentId });
      } catch {
        /* 忽略 */
      }
      dragId = '';
      dragIsFolder = false;
      await loadBookmarks();
    }

    async function doCreate(parentId, title) {
      try {
        await chrome.bookmarks.create({ parentId, title });
      } catch {
        /* 忽略 */
      }
      await loadBookmarks();
    }

    async function doMoveBefore(id, targetId) {
      try {
        const [src] = await chrome.bookmarks.get(id);
        const [dst] = await chrome.bookmarks.get(targetId);
        if (!src || !dst) return;
        let index = dst.index;
        if (src.parentId === dst.parentId && src.index < dst.index) index -= 1;
        await chrome.bookmarks.move(id, { parentId: dst.parentId, index });
      } catch {
        /* 忽略 */
      }
      dragId = '';
      await loadBookmarks();
    }

    async function countDescendants(id) {
      try {
        const [node] = await chrome.bookmarks.getSubTree(id);
        let n = 0;
        const walk = (cur) => {
          for (const c of cur.children || []) {
            n += 1;
            walk(c);
          }
        };
        walk(node);
        return n;
      } catch {
        return 0;
      }
    }

    function renameDialog(node) {
      const input = el('input', 'dlg-input');
      input.value = node.title;
      openDialog({
        title: '重命名',
        body: input,
        confirmText: '保存',
        focus: input,
        onConfirm: () => {
          const value = input.value.trim();
          if (value && value !== node.title) doUpdate(node.id, value);
        },
      });
    }

    async function deleteDialog(node) {
      let desc = '删除后无法撤销。';
      if (node.isFolder) {
        const n = await countDescendants(node.id);
        desc = n ? `连同里面的 ${n} 项一起删除，无法撤销。` : '这是一个空分组，删除后无法撤销。';
      }
      openDialog({
        title: `删除「${node.title}」？`,
        desc,
        confirmText: '删除',
        danger: true,
        onConfirm: () => doRemove(node),
      });
    }

    async function moveDialog(node) {
      const folders = await folderOptions();
      const select = el('select', 'dlg-select');
      for (const f of folders) {
        if (f.id === node.id) continue;
        const opt = el('option', '', `${'　'.repeat(f.depth)}${f.title}`);
        opt.value = f.id;
        select.append(opt);
      }
      const target = currentFolderId();
      if (target) select.value = target;
      openDialog({
        title: '移动到',
        body: select,
        confirmText: '移动',
        focus: select,
        onConfirm: () => doMove(node.id, select.value),
      });
    }

    function createDialog(parentId) {
      if (!parentId) return;
      const input = el('input', 'dlg-input');
      input.placeholder = '新分组名称';
      openDialog({
        title: '新建分组',
        body: input,
        confirmText: '创建',
        focus: input,
        onConfirm: () => {
          const value = input.value.trim();
          if (value) doCreate(parentId, value);
        },
      });
    }

    function nodeMenu(node, x, y) {
      const items = [];
      if (!node.isFolder) {
        const isFav = state.favorites.includes(node.id);
        items.push({ label: isFav ? '取消收藏' : '收藏', run: () => toggleFavorite(node.id) });
      }
      items.push(
        { label: '重命名', run: () => renameDialog(node) },
        { label: '移动到…', run: () => moveDialog(node) },
        '-',
        { label: '删除', danger: true, run: () => deleteDialog(node) },
      );
      if (node.isFolder) items.splice(1, 0, { label: '新建子分组', run: () => createDialog(node.id) });
      openMenu(x, y, items);
    }

    document.addEventListener('pointerdown', (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuEl) closeMenu();
    });

    return {
      canEdit,
      hasDialog: () => !!dialogEl,
      closeMenu,
      nodeMenu,
      createDialog,
      doMove,
      doMoveBefore,
      getDrag: () => ({ id: dragId, isFolder: dragIsFolder }),
      startDrag: (id, isFolder, e) => {
        dragId = id;
        dragIsFolder = isFolder;
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', id);
        } catch {
          /* 受限上下文忽略 */
        }
      },
      endDrag: () => {
        dragId = '';
        dragIsFolder = false;
      },
    };
  };
})();
