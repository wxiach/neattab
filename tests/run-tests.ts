import assert from 'node:assert/strict';
import {
  buildRootTree,
} from '../src/lib/bookmarks.ts';
import {
  detectPageKind,
  parseUrl,
} from '../src/lib/urlRules.ts';
import {
  addFavoriteCopyToRoot,
  collectGroupedUrls,
  migrateLegacyLocalFavorites,
  removeFavoriteCopyFromRoot,
  syncEditedBookmarkCopies,
} from '../src/lib/favSync.ts';
import {
  applyDuplicateCleanup,
  scanDuplicateBookmarks,
} from '../src/lib/dedup.ts';
import {
  applyFolderAudit,
  collectScopeItems,
} from '../src/lib/batchApply.ts';
import {
  applyImport,
  buildExportData,
  parseImportText,
} from '../src/lib/transfer.ts';

// 1. URL parsing & page kind detection tests
const u1 = parseUrl('https://www.v2ex.com/t/1259639#reply105');
const u2 = parseUrl('https://www.v2ex.com/');
assert.equal(detectPageKind(u1).kind, 'content');
assert.equal(u1.trimHash, '#reply105');
assert.equal(detectPageKind(u2).kind, 'site');
assert.equal(u2.trimHash, '');
console.log('PASS urlRules parseUrl & detectPageKind');

// 2. Transfer lossless import/export tests with mock chrome.bookmarks
type Node = chrome.bookmarks.BookmarkTreeNode;

function createMockChrome(initialRoot: Node) {
  let seq = 1000;
  const tree: Node = { id: '0', title: '', children: [structuredClone(initialRoot)] };
  let storageData: Record<string, unknown> = {};

  const findParentAndIdx = (
    cur: Node,
    id: string,
  ): { parent: Node; idx: number; node: Node } | null => {
    const kids = cur.children || [];
    for (let i = 0; i < kids.length; i += 1) {
      if (kids[i].id === id) return { parent: cur, idx: i, node: kids[i] };
      const hit = findParentAndIdx(kids[i], id);
      if (hit) return hit;
    }
    return null;
  };

  const findById = (cur: Node, id: string): Node | null => {
    if (cur.id === id) return cur;
    for (const c of cur.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  };

  return {
    getStorage: () => storageData,
    api: {
      bookmarks: {
        getTree: async () => [structuredClone(tree)],
        get: async (id: string) => {
          const hit = findById(tree, id);
          return hit ? [structuredClone(hit)] : [];
        },
        getSubTree: async (id: string) => {
          const hit = findById(tree, id);
          return hit ? [structuredClone(hit)] : [];
        },
        create: async (details: chrome.bookmarks.BookmarkCreateArg) => {
          const parent = findById(tree, details.parentId || '1');
          if (!parent) throw new Error('parent not found');
          const node: Node = {
            id: String(++seq),
            parentId: parent.id,
            title: details.title || '',
            dateAdded: Date.now(),
            ...(details.url ? { url: details.url } : { children: [] }),
          };
          parent.children = parent.children || [];
          parent.children.push(node);
          return structuredClone(node);
        },
        update: async (id: string, changes: { title?: string; url?: string }) => {
          const node = findById(tree, id);
          if (!node) throw new Error('not found');
          if (changes.title !== undefined) node.title = changes.title;
          if (changes.url !== undefined) node.url = changes.url;
          return structuredClone(node);
        },
        move: async (id: string, dest: { parentId?: string; index?: number }) => {
          const hit = findParentAndIdx(tree, id);
          if (!hit) throw new Error('not found');
          hit.parent.children!.splice(hit.idx, 1);
          const target = findById(tree, dest.parentId || hit.parent.id);
          if (!target) throw new Error('target not found');
          target.children = target.children || [];
          hit.node.parentId = target.id;
          const idx = typeof dest.index === 'number' ? Math.min(dest.index, target.children.length) : target.children.length;
          target.children.splice(idx, 0, hit.node);
          return structuredClone(hit.node);
        },
        remove: async (id: string) => {
          const hit = findParentAndIdx(tree, id);
          if (hit) hit.parent.children!.splice(hit.idx, 1);
        },
        removeTree: async (id: string) => {
          const hit = findParentAndIdx(tree, id);
          if (hit) hit.parent.children!.splice(hit.idx, 1);
        },
      },
      storage: {
        local: {
          set: async (patch: Record<string, unknown>) => {
            storageData = { ...storageData, ...patch };
          },
        },
      },
    },
  };
}

const seedRoot: Node = {
  id: '1',
  title: '收藏夹栏',
  children: [
    { id: '10', parentId: '1', title: 'Loose A', url: 'https://loose.example/', dateAdded: 111 },
    { id: '11', parentId: '1', title: 'Extensions', url: 'edge://extensions/', dateAdded: 222 },
    {
      id: '20',
      parentId: '1',
      title: '开发',
      children: [
        {
          id: '21',
          parentId: '20',
          title: '前端',
          children: [
            {
              id: '22',
              parentId: '21',
              title: '组件库',
              children: [
                { id: '30', parentId: '22', title: 'coss ui', url: 'https://coss.com/ui', dateAdded: 333 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const exported = buildExportData(seedRoot, ['30']);
assert.deepEqual(exported.favorites, ['https://loose.example/', 'https://coss.com/ui']);
assert.equal(exported.folders[0].children![0].children![0].items[0].title, 'coss ui');

const parsed = parseImportText('```json\n' + JSON.stringify(exported) + '\n```');
assert.equal(parsed.ok, true);

const mock = createMockChrome(seedRoot);
(globalThis as unknown as { chrome: unknown }).chrome = mock.api;

assert.equal(parsed.ok, true);
if (parsed.ok) {
  const rep = await applyImport('1', parsed.data, 'replace', ['30'], true);
  assert.equal(rep.mode, 'replace');
  const [afterTree] = await mock.api.bookmarks.getTree();
  const rootAfter = afterTree.children![0];
  // Non-http bookmark (edge://extensions/) must be preserved!
  const hasEdgeExt = (rootAfter.children || []).some((c) => c.url === 'edge://extensions/');
  assert.equal(hasEdgeExt, true);
  // Deep folder + dateAdded preserved!
  const cossNode = rootAfter.children!.find((c) => c.title === '开发')!.children![0].children![0].children![0];
  assert.equal(cossNode?.id, '30');
  assert.equal(cossNode?.dateAdded, 333);
  // Legacy favorite URL ('https://coss.com/ui') auto-copied to root bookmarks bar!
  const rootUrls = (rootAfter.children || []).filter((c) => c.url).map((c) => c.url);
  assert.equal(rootUrls.includes('https://loose.example/'), true);
  assert.equal(rootUrls.includes('https://coss.com/ui'), true);

  const app = await applyImport('1', parsed.data, 'append', ['30'], true);
  assert.equal(app.mode, 'append');
}

assert.equal(parseImportText('not json').ok, false);
assert.equal(parseImportText('{}').ok, false);
console.log('PASS transfer replace (order, dateAdded, favorites, non-http) & append');

// 3. Root-copy favorites tests (add/remove copy, dedup, edit sync, legacy migration)
function createRootCopyMock(initialRoot: Node) {
  let seq = 3000;
  const tree: Node = { id: '0', title: '', children: [structuredClone(initialRoot)] };
  const findById = (cur: Node, id: string): Node | null => {
    if (cur.id === id) return cur;
    for (const c of cur.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const findParentAndIdx = (cur: Node, id: string): { parent: Node; idx: number; node: Node } | null => {
    const kids = cur.children || [];
    for (let i = 0; i < kids.length; i += 1) {
      if (kids[i].id === id) return { parent: cur, idx: i, node: kids[i] };
      const hit = findParentAndIdx(kids[i], id);
      if (hit) return hit;
    }
    return null;
  };
  return {
    getRoot: () => tree.children![0],
    api: {
      bookmarks: {
        getTree: async () => [structuredClone(tree)],
        get: async (id: string) => {
          const hit = findById(tree, id);
          return hit ? [structuredClone(hit)] : [];
        },
        getSubTree: async (id: string) => {
          const hit = findById(tree, id);
          return hit ? [structuredClone(hit)] : [];
        },
        create: async (details: chrome.bookmarks.BookmarkCreateArg) => {
          const parent = findById(tree, details.parentId || '1');
          if (!parent) throw new Error('parent not found');
          const node: Node = {
            id: String(++seq),
            parentId: parent.id,
            title: details.title || '',
            dateAdded: Date.now(),
            ...(details.url ? { url: details.url } : { children: [] }),
          };
          parent.children = parent.children || [];
          const idx = typeof details.index === 'number' ? Math.min(details.index, parent.children.length) : parent.children.length;
          parent.children.splice(idx, 0, node);
          return structuredClone(node);
        },
        update: async (id: string, changes: { title?: string; url?: string }) => {
          const node = findById(tree, id);
          if (!node) throw new Error('not found');
          if (changes.title !== undefined) node.title = changes.title;
          if (changes.url !== undefined) node.url = changes.url;
          return structuredClone(node);
        },
        move: async (id: string, dest: { parentId?: string; index?: number }) => {
          const hit = findParentAndIdx(tree, id);
          if (!hit) throw new Error('not found');
          hit.parent.children!.splice(hit.idx, 1);
          const target = findById(tree, dest.parentId || hit.parent.id);
          if (!target) throw new Error('target not found');
          target.children = target.children || [];
          hit.node.parentId = target.id;
          const idx = typeof dest.index === 'number' ? Math.min(dest.index, target.children.length) : target.children.length;
          target.children.splice(idx, 0, hit.node);
          return structuredClone(hit.node);
        },
        remove: async (id: string) => {
          const hit = findParentAndIdx(tree, id);
          if (hit) hit.parent.children!.splice(hit.idx, 1);
        },
        removeTree: async (id: string) => {
          const hit = findParentAndIdx(tree, id);
          if (hit) hit.parent.children!.splice(hit.idx, 1);
        },
      },
    },
  };
}

const favMock = createRootCopyMock(seedRoot);
(globalThis as unknown as { chrome: unknown }).chrome = favMock.api;

// Add favorite copy to root (inserted before folders) & prevent duplicate copies
assert.equal(await addFavoriteCopyToRoot('1', { title: 'coss ui', url: 'https://coss.com/ui' }), true);
assert.equal(await addFavoriteCopyToRoot('1', { title: 'coss ui', url: 'https://coss.com/ui' }), false);
const rootChildren1 = favMock.getRoot().children!;
const copyIdx = rootChildren1.findIndex((c) => c.url === 'https://coss.com/ui');
const folderIdx = rootChildren1.findIndex((c) => !c.url);
assert.equal(copyIdx >= 0 && copyIdx < folderIdx, true);

// Edit original bookmark syncs title & url to root copy
await favMock.api.bookmarks.update('30', { title: 'coss ui v2', url: 'https://coss.com/ui/v2' });
await syncEditedBookmarkCopies('1', '30', 'https://coss.com/ui', { title: 'coss ui v2', url: 'https://coss.com/ui/v2' });
const updatedCopy = favMock.getRoot().children!.find((c) => c.url === 'https://coss.com/ui/v2');
assert.equal(updatedCopy?.title, 'coss ui v2');

// Remove copy from root keeps original in folder untouched
assert.equal(await removeFavoriteCopyFromRoot('1', 'https://coss.com/ui/v2'), true);
assert.equal(favMock.getRoot().children!.some((c) => c.url === 'https://coss.com/ui/v2'), false);
const builtAfterRemove = buildRootTree(favMock.getRoot());
assert.equal(collectGroupedUrls(builtAfterRemove.tops).has('https://coss.com/ui/v2'), true);

// Legacy local favorites auto-migration copies missing items into root
const migrated = await migrateLegacyLocalFavorites('1', ['30'], builtAfterRemove.loose, builtAfterRemove.itemIndex);
assert.equal(migrated, true);
assert.equal(favMock.getRoot().children!.some((c) => c.url === 'https://coss.com/ui/v2'), true);

console.log('PASS favSync root-copy add/remove, dedup, edit sync & legacy migration');

// 4. Duplicate bookmark scanning & cleanup (preserves normal favorite copies, restores misplaced favorites)
const dedupSeedRoot: Node = {
  id: '1',
  title: '收藏夹栏',
  children: [
    // Normal favorite copy (1 in root + 1 in folder) -> MUST NOT be flagged
    { id: 'r1', parentId: '1', title: 'Normal Fav', url: 'https://normal-fav.example/', dateAdded: 500 },
    // Root duplicate (2 in root)
    { id: 'r2', parentId: '1', title: 'Root Dup Older', url: 'https://root-dup.example/', dateAdded: 100 },
    { id: 'r3', parentId: '1', title: 'Root Dup Newer', url: 'https://root-dup.example/', dateAdded: 600 },
    // Already in root + 3 copies in subfolders
    { id: 'r4', parentId: '1', title: 'Triple Fav', url: 'https://triple.example/', dateAdded: 700 },
    {
      id: 'f1',
      parentId: '1',
      title: '开发',
      children: [
        { id: 'b1', parentId: 'f1', title: 'Normal Fav', url: 'https://normal-fav.example/', dateAdded: 200 },
        { id: 'b2', parentId: 'f1', title: 'Lost Fav Original', url: 'https://lost-fav.example/', dateAdded: 150 },
        { id: 'b3', parentId: 'f1', title: 'Triple 1', url: 'https://triple.example/', dateAdded: 120 },
      ],
    },
    {
      id: 'f2',
      parentId: '1',
      title: '工具',
      children: [
        { id: 'b4', parentId: 'f2', title: 'Lost Fav Misplaced', url: 'https://lost-fav.example/', dateAdded: 800 },
        { id: 'b5', parentId: 'f2', title: 'Triple 2', url: 'https://triple.example/', dateAdded: 300 },
        { id: 'b6', parentId: 'f2', title: 'Triple 3', url: 'https://triple.example/', dateAdded: 400 },
      ],
    },
  ],
};

const scan1 = scanDuplicateBookmarks(dedupSeedRoot);
assert.equal(scan1.groupCount, 3);
assert.equal(scan1.extraCount, 4);
assert.equal(scan1.restorableGroupCount, 1);
assert.equal(scan1.groups.some((g) => g.url === 'https://normal-fav.example/'), false);

// Restorable folder group comes first and keeps earliest dateAdded ('b2')
const lostGroup = scan1.groups[0];
assert.equal(lostGroup.url, 'https://lost-fav.example/');
assert.equal(lostGroup.scope, 'folder');
assert.equal(lostGroup.inRoot, false);
assert.equal(lostGroup.defaultKeepId, 'b2');

const dedupMock = createRootCopyMock(dedupSeedRoot);
(globalThis as unknown as { chrome: unknown }).chrome = dedupMock.api;

const cleanupRes = await applyDuplicateCleanup('1', [
  { id: 'b4', url: 'https://lost-fav.example/', action: 'restore_favorite' },
  { id: 'b5', url: 'https://triple.example/', action: 'restore_favorite' }, // already in root -> falls back to delete
  { id: 'b6', url: 'https://triple.example/', action: 'delete' },
  { id: 'r3', url: 'https://root-dup.example/', action: 'delete' },
]);
assert.equal(cleanupRes.movedToFav, 1);
assert.equal(cleanupRes.deleted, 3);

// Restored favorite ('b4') is now in root before folders
const dedupRootAfter = dedupMock.getRoot();
const restoredIdx = dedupRootAfter.children!.findIndex((c) => c.id === 'b4');
const firstDirIdx = dedupRootAfter.children!.findIndex((c) => !c.url);
assert.equal(restoredIdx >= 0 && restoredIdx < firstDirIdx, true);

// Zero duplicates remain after cleanup
const scan2 = scanDuplicateBookmarks(dedupRootAfter);
assert.equal(scan2.groupCount, 0);
assert.equal(scan2.extraCount, 0);

console.log('PASS dedup scan, favorite preservation, restore_favorite & delete cleanup');

// 5. Batch organize scope isolation & safe folder audit tests
const batchSeedRoot: Node = {
  id: '1',
  title: '收藏夹栏',
  children: [
    // Root favorite copy of grouped bookmark -> MUST be skipped in __all__
    { id: 'rf1', parentId: '1', title: 'Grouped Fav Copy', url: 'https://grouped.example/', dateAdded: 500 },
    // Pure ungrouped loose bookmark -> MUST be included
    { id: 'rl1', parentId: '1', title: 'Pure Loose', url: 'https://pure-loose.example/', dateAdded: 100 },
    {
      id: 'dirA',
      parentId: '1',
      title: '开发',
      children: [
        { id: 'bm1', parentId: 'dirA', title: 'Grouped Fav Original', url: 'https://grouped.example/', dateAdded: 200 },
      ],
    },
    {
      id: 'dirB',
      parentId: '1',
      title: '零散开发',
      children: [
        { id: 'bm2', parentId: 'dirB', title: 'Tool X', url: 'https://tool-x.example/', dateAdded: 300 },
      ],
    },
    {
      id: 'dirEmpty',
      parentId: '1',
      title: '空目录',
      children: [],
    },
  ],
};

const batchBuilt = buildRootTree(batchSeedRoot);
const batchScopes = collectScopeItems(batchBuilt.tops, batchBuilt.loose, '1', '__all__');
const allScope = batchScopes.find((s) => s.id === '__all__')!;
const favScope = batchScopes.find((s) => s.id === '__favorites__')!;

// Root favorite copy ('rf1') must never appear in AI organize scope
assert.equal(allScope.items.some((it) => it.id === 'rf1'), false);
assert.equal(allScope.items.some((it) => it.id === 'rl1'), true);
assert.equal(allScope.items.some((it) => it.id === 'bm1'), true);
assert.equal(favScope.items.some((it) => it.id === 'rf1'), false);
assert.equal(favScope.items.some((it) => it.id === 'bm1'), true);

const batchMock = createRootCopyMock(batchSeedRoot);
(globalThis as unknown as { chrome: unknown }).chrome = batchMock.api;

const auditApplied = await applyFolderAudit(
  '1',
  [
    { uid: '1', type: 'merge', sourceId: 'dirB', targetId: 'dirA', reason: '合并零散目录' },
    { uid: '2', type: 'delete_empty', folderId: 'dirEmpty', reason: '清理空目录' },
    // Safety check: non-empty dirA must NOT be deleted even if flagged delete_empty
    { uid: '3', type: 'delete_empty', folderId: 'dirA', reason: '误报测试' },
  ],
  [],
  true,
);
assert.equal(auditApplied, 2);

const batchRootAfter = batchMock.getRoot();
const dirAAfter = batchRootAfter.children!.find((c) => c.id === 'dirA')!;
assert.equal(Boolean(dirAAfter), true);
assert.equal(dirAAfter.children!.some((c) => c.id === 'bm2'), true);
assert.equal(batchRootAfter.children!.some((c) => c.id === 'dirB'), false);
assert.equal(batchRootAfter.children!.some((c) => c.id === 'dirEmpty'), false);

console.log('PASS batchApply scope isolation (skip root fav copy) & safe folder audit');
console.log('ALL TESTS PASSED');
