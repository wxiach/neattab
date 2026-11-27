'use strict';

/**
 * NAV — 新标签页编辑模块：编辑/新建/删除对话框、书签增删改移与拖拽状态。
 */
(() => {
  const { hasExt, el, findNode } = window.NAV;

  function isHttpUrl(raw) {
    try {
      const u = new URL(String(raw || '').trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  window.NAV.createEditor = ({ state, loadBookmarks, onFolderCreated }) => {
    const canEdit =
      hasExt && !!chrome.bookmarks.update && !!chrome.bookmarks.removeTree && !!chrome.bookmarks.create;

    let dialogEl = null;
    let dragId = '';
    let dragTitle = '';
    let dragIsFolder = false;

    const closeDialog = () => {
      if (dialogEl) {
        dialogEl.remove();
        dialogEl = null;
      }
    };

    const resetDrag = () => {
      dragId = '';
      dragTitle = '';
      dragIsFolder = false;
      if (document.body) document.body.classList.remove('is-dragging');
    };

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
        if (onConfirm() === false) return;
        closeDialog();
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
      const target = focus || ok;
      target.focus();
      if (typeof target.select === 'function') target.select();
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

    async function folderOptions(excludeId) {
      const out = [];
      try {
        const [treeRoot] = await chrome.bookmarks.getTree();
        const root = findNode(treeRoot, state.resolvedRootId || state.rootId) || (treeRoot.children || [])[0];
        if (!root) return out;
        out.push({ id: root.id, label: `${(root.title || '收藏夹栏').trim()}（根目录）` });
        const walk = (node, depth) => {
          for (const c of node.children || []) {
            if (c.url || c.id === excludeId) continue;
            out.push({ id: c.id, label: `${'　'.repeat(depth)}${(c.title || '未命名').trim()}` });
            walk(c, depth + 1);
          }
        };
        walk(root, 1);
      } catch {
        /* 读不到目录就退化为空列表 */
      }
      return out;
    }

    async function doEdit(orig, { title, url, parentId }) {
      try {
        const patch = {};
        if (title !== (orig.title || '')) patch.title = title;
        if (orig.url && url && url !== orig.url) patch.url = url;
        if (Object.keys(patch).length) await chrome.bookmarks.update(orig.id, patch);

        if (parentId && parentId !== orig.parentId) {
          const blocked = !orig.url && (await isInside(parentId, orig.id));
          if (!blocked) {
            await chrome.bookmarks.move(orig.id, { parentId });
            if (state.expanded) state.expanded.add(parentId);
          }
        }
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
      try {
        if (!id || !parentId || id === parentId) return;
        const [src] = await chrome.bookmarks.get(id);
        if (src && !src.url && (await isInside(parentId, id))) return;
        await chrome.bookmarks.move(id, { parentId });
      } catch {
        /* 忽略 */
      } finally {
        resetDrag();
      }
      await loadBookmarks();
    }

    async function doCreate(parentId, title) {
      try {
        await chrome.bookmarks.create({ parentId, title });
        if (state.expanded) state.expanded.add(parentId);
      } catch {
        /* 忽略 */
      }
      await loadBookmarks();
      if (typeof onFolderCreated === 'function') onFolderCreated(parentId);
    }

    async function doMoveBefore(id, targetId) {
      try {
        const [src] = await chrome.bookmarks.get(id);
        const [dst] = await chrome.bookmarks.get(targetId);
        if (!src || !dst) return;
        // Chromium 的 chrome.bookmarks.move 按移除前坐标计算，同目录向后移时会自动减 1；
        // 因此向后拖拽时传 dst.index + 1，让拖拽项精准落到目标卡片所在位置（含末尾）
        let index = dst.index;
        if (src.parentId === dst.parentId && src.index < dst.index) index += 1;
        await chrome.bookmarks.move(id, { parentId: dst.parentId, index });
      } catch {
        /* 忽略 */
      } finally {
        resetDrag();
      }
      await loadBookmarks();
    }

    async function doMoveRelative(id, targetId, position) {
      try {
        if (!id || !targetId || id === targetId) return;
        const [src] = await chrome.bookmarks.get(id);
        const [dst] = await chrome.bookmarks.get(targetId);
        if (!src || !dst) return;
        if (!src.url && (await isInside(dst.parentId, id))) return;
        // Chromium 按移除前空隙坐标计算：插入到 dst 前恒为 dst.index，插入到 dst 后恒为 dst.index + 1
        const index = position === 'after' ? dst.index + 1 : dst.index;
        await chrome.bookmarks.move(id, { parentId: dst.parentId, index });
      } catch {
        /* 忽略 */
      } finally {
        resetDrag();
      }
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

    async function editDialog(node) {
      if (!canEdit || !node || !node.id) return;
      let fresh = null;
      try {
        const [hit] = await chrome.bookmarks.get(node.id);
        fresh = hit || null;
      } catch {
        fresh = null;
      }
      const orig = fresh || { id: node.id, title: node.title || '', url: node.url || '', parentId: '' };
      const isFolder = !orig.url;
      const folders = await folderOptions(isFolder ? orig.id : '');

      const fields = el('div', 'dlg-fields');

      const makeField = (labelText, control) => {
        const wrap = el('label', 'dlg-field');
        wrap.append(el('span', 'dlg-label', labelText), control);
        return wrap;
      };

      const titleInput = el('input', 'dlg-input');
      titleInput.value = orig.title || '';
      titleInput.placeholder = isFolder ? '分组名称' : '书签名称';
      fields.append(makeField('名称', titleInput));

      let urlInput = null;
      if (!isFolder) {
        urlInput = el('input', 'dlg-input mono');
        urlInput.type = 'url';
        urlInput.value = orig.url || '';
        urlInput.placeholder = 'https://...';
        urlInput.spellcheck = false;
        fields.append(makeField('网址', urlInput));
      }

      const selectWrap = el('div', 'select-wrap');
      const select = el('select', 'dlg-select');
      for (const f of folders) {
        const opt = el('option', '', f.label);
        opt.value = f.id;
        select.append(opt);
      }
      if (orig.parentId && folders.some((f) => f.id === orig.parentId)) {
        select.value = orig.parentId;
      }
      selectWrap.append(select);
      fields.append(makeField(isFolder ? '上级分组' : '所属分组', selectWrap));

      const errEl = el('p', 'dlg-err');
      errEl.hidden = true;
      fields.append(errEl);

      const showErr = (msg, target) => {
        errEl.textContent = msg;
        errEl.hidden = false;
        if (target) target.focus();
      };

      openDialog({
        title: isFolder ? '编辑分组' : '编辑书签',
        body: fields,
        confirmText: '保存',
        focus: titleInput,
        onConfirm: () => {
          const title = titleInput.value.trim();
          if (!title) {
            showErr('名称不能为空', titleInput);
            return false;
          }
          let url = orig.url || '';
          if (!isFolder && urlInput) {
            url = urlInput.value.trim();
            if (!isHttpUrl(url)) {
              showErr('请输入有效的 http:// 或 https:// 网址', urlInput);
              return false;
            }
          }
          doEdit(orig, { title, url, parentId: select.value });
          return true;
        },
      });
    }

    async function deleteDialog(node) {
      if (!canEdit || !node || !node.id) return;
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

    function createDialog(parentId, title = '新建分组') {
      if (!canEdit || !parentId) return;
      const input = el('input', 'dlg-input');
      input.placeholder = '新分组名称';
      openDialog({
        title,
        body: input,
        confirmText: '创建',
        focus: input,
        onConfirm: () => {
          const value = input.value.trim();
          if (value) doCreate(parentId, value);
        },
      });
    }

    return {
      canEdit,
      hasDialog: () => !!dialogEl,
      createDialog,
      editDialog,
      deleteDialog,
      doMove,
      doMoveBefore,
      doMoveRelative,
      getDrag: () => ({ id: dragId, title: dragTitle, isFolder: dragIsFolder }),
      startDrag: (id, isFolder, e, title = '') => {
        dragId = id;
        dragTitle = title;
        dragIsFolder = isFolder;
        if (document.body) document.body.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', id);
        } catch {
          /* 受限上下文忽略 */
        }
      },
      endDrag: resetDrag,
    };
  };
})();
