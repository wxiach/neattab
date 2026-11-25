/**
 * 预览用的极简 chrome.* 桩：只实现 NAV 真正用到的那几个接口，
 * 数据来自 tools/make_fixture.py 从真实 Bookmarks 文件导出的 tree.js。
 * 仅用于本地验证，不参与扩展运行。
 */
(() => {
  const root = window.__NAV_TREE__;
  if (!root) return;

  const noop = { addListener() {}, removeListener() {} };
  let store = {};
  let seq = 9000;

  const walk = (node, fn, parent) => {
    fn(node, parent);
    for (const c of node.children || []) walk(c, fn, node);
  };

  const find = (id) => {
    let hit = null;
    walk(root, (n) => {
      if (n.id === id) hit = n;
    });
    return hit;
  };

  const parentOf = (id) => {
    let hit = null;
    walk(root, (n, p) => {
      if (n.id === id) hit = p;
    });
    return hit;
  };

  const detach = (id) => {
    const p = parentOf(id);
    if (!p) return null;
    const i = (p.children || []).findIndex((c) => c.id === id);
    if (i < 0) return null;
    return p.children.splice(i, 1)[0];
  };

  const api = {
    getTree: () => Promise.resolve([root]),
    get: (id) => Promise.resolve(find(id) ? [find(id)] : []),
    getSubTree: (id) => Promise.resolve(find(id) ? [find(id)] : []),
    update: (id, patch) => {
      const n = find(id);
      if (n) Object.assign(n, patch);
      return Promise.resolve(n);
    },
    create: ({ parentId, title, url }) => {
      const p = find(parentId);
      const node = { id: String(++seq), title: title || '', url };
      if (p) (p.children || (p.children = [])).push(node);
      return Promise.resolve(node);
    },
    move: (id, { parentId, index }) => {
      const p = find(parentId);
      const node = detach(id);
      if (!p || !node) return Promise.reject(new Error('move failed'));
      p.children = p.children || [];
      const at = typeof index === 'number' ? Math.min(index, p.children.length) : p.children.length;
      p.children.splice(at, 0, node);
      return Promise.resolve(node);
    },
    remove: (id) => {
      detach(id);
      return Promise.resolve();
    },
    removeTree: (id) => {
      detach(id);
      return Promise.resolve();
    },
    onCreated: noop,
    onRemoved: noop,
    onChanged: noop,
    onMoved: noop,
    onChildrenReordered: noop,
  };

  window.chrome = {
    bookmarks: api,
    storage: {
      local: {
        get: (defaults) => Promise.resolve({ ...defaults, ...store }),
        set: (patch) => {
          store = { ...store, ...patch };
          return Promise.resolve();
        },
      },
      onChanged: noop,
    },
    fontSettings: {
      getFontList: () =>
        Promise.resolve([
          { fontId: 'Microsoft YaHei UI', displayName: '微软雅黑 UI' },
          { fontId: 'SimHei', displayName: '黑体' },
          { fontId: 'FangSong', displayName: '仿宋' },
          { fontId: 'Segoe UI', displayName: 'Segoe UI' },
          { fontId: 'Consolas', displayName: 'Consolas' },
        ]),
    },
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
    },
  };
})();
