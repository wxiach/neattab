import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  buildFolders,
  cleanTitle,
  detectPageKind,
  parseUrl,
  trainLocalModel,
} from '../src/lib/classifier.ts';
import {
  applyImport,
  buildExportData,
  parseImportText,
} from '../src/lib/transfer.ts';

// 1. Classifier & cleanTitle tests
const u1 = parseUrl('https://www.v2ex.com/t/1259639#reply105');
const u2 = parseUrl('https://www.v2ex.com/');
assert.equal(detectPageKind(u1).kind, 'content');
assert.equal(u1.trimHash, '#reply105');
assert.equal(detectPageKind(u2).kind, 'site');
assert.equal(u2.trimHash, '');

const gh = parseUrl('https://github.com/wxiach/neattab');
assert.equal(cleanTitle('GitHub - wxiach/neattab: bookmark new tab', gh, detectPageKind(gh)), 'wxiach/neattab');

// LOO-CV against tests/fixture-tree.js
const previewTreePath = path.resolve(process.cwd(), 'tests/fixture-tree.js');
if (fs.existsSync(previewTreePath)) {
  const sb: { window: { __NAV_TREE__?: chrome.bookmarks.BookmarkTreeNode } } = { window: {} };
  vm.runInNewContext(fs.readFileSync(previewTreePath, 'utf8'), sb);
  const root = sb.window.__NAV_TREE__!.children![0];
  const allFolders = buildFolders(root);
  const leafFolders = allFolders.filter((f) => !f.isRoot && f.items.length > 0);
  let total = 0;
  let top1 = 0;
  let top3 = 0;
  for (const tf of leafFolders) {
    for (const bm of tf.items) {
      total += 1;
      const heldOut = allFolders.map((f) =>
        f.id === tf.id ? { ...f, items: f.items.filter((x) => x.id !== bm.id) } : f,
      );
      const pred = trainLocalModel(heldOut, []).predict(bm.url || '', bm.title || '', '');
      if (pred.best?.id === tf.id) {
        top1 += 1;
        top3 += 1;
      } else if (pred.candidates.some((c) => c.id === tf.id)) {
        top3 += 1;
      }
    }
  }
  console.log(`PASS classifier | LOO-CV Top-1 ${top1}/${total}, Top-3 ${top3}/${total}`);
}

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
        move: async (id: string, dest: { parentId?: string; index?: number }) => {
          const hit = findParentAndIdx(tree, id);
          if (!hit) throw new Error('not found');
          hit.parent.children!.splice(hit.idx, 1);
          const target = findById(tree, dest.parentId || hit.parent.id);
          if (!target) throw new Error('target not found');
          target.children = target.children || [];
          hit.node.parentId = target.id;
          target.children.push(hit.node);
          return structuredClone(hit.node);
        },
        update: async (id: string, changes: { title?: string; url?: string }) => {
          const node = findById(tree, id);
          if (!node) throw new Error('not found');
          if (changes.title !== undefined) node.title = changes.title;
          if (changes.url !== undefined) node.url = changes.url;
          return structuredClone(node);
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
assert.deepEqual(exported.favorites, ['https://coss.com/ui']);
assert.equal(exported.folders[0].children![0].children![0].items[0].title, 'coss ui');

const parsed = parseImportText('```json\n' + JSON.stringify(exported) + '\n```');
assert.equal(parsed.ok, true);

const mock = createMockChrome(seedRoot);
(globalThis as unknown as { chrome: unknown }).chrome = mock.api;

assert.equal(parsed.ok, true);
if (parsed.ok) {
  const rep = await applyImport('1', parsed.data, 'replace', ['30'], true);
  assert.equal(rep.mode, 'replace');
  if (rep.mode === 'replace') {
    assert.deepEqual(rep.favorites, ['30']);
  }
  const [afterTree] = await mock.api.bookmarks.getTree();
  const rootAfter = afterTree.children![0];
  // Non-http bookmark (edge://extensions/) must be preserved!
  const hasEdgeExt = (rootAfter.children || []).some((c) => c.url === 'edge://extensions/');
  assert.equal(hasEdgeExt, true);
  // Deep folder + dateAdded preserved!
  const cossNode = rootAfter.children!.find((c) => c.title === '开发')!.children![0].children![0].children![0];
  assert.equal(cossNode?.id, '30');
  assert.equal(cossNode?.dateAdded, 333);

  const app = await applyImport('1', parsed.data, 'append', ['30'], true);
  assert.equal(app.mode, 'append');
}

assert.equal(parseImportText('not json').ok, false);
assert.equal(parseImportText('{}').ok, false);
console.log('PASS transfer replace (order, dateAdded, favorites, non-http) & append');
console.log('ALL TESTS PASSED');
