import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsContent } from '@/components/SettingsContent';
import { BatchRenameDialog } from '@/components/BatchRenameDialog';
import { buildRootTree, findNode, type BuiltRoot } from '@/lib/bookmarks';
import {
  applyFont,
  applyTheme,
  DEFAULT_AI,
  DEFAULTS,
  getExtensionVersion,
  hasExt,
  loadPrefs,
  savePrefs,
  systemDarkMq,
} from '@/lib/storage';
import type { Prefs } from '@/lib/types';

const EMPTY_ROOT: BuiltRoot = {
  resolvedRootId: '1',
  rootName: '收藏夹',
  tops: [],
  loose: [],
  folderMap: new Map(),
  itemIndex: new Map(),
};

export function OptionsApp() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [tree, setTree] = useState<BuiltRoot>(EMPTY_ROOT);
  const [batchOpen, setBatchOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const flashTimerRef = useRef<number>(0);

  const flash = useCallback((msg = '已保存') => {
    setSavedMsg(msg);
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setSavedMsg(''), 1600);
  }, []);

  const loadTree = useCallback(async (rootId: string) => {
    if (!hasExt) return;
    try {
      const [raw] = await chrome.bookmarks.getTree();
      const rootNode = findNode(raw, rootId) || raw?.children?.[0];
      if (rootNode) setTree(buildRootTree(rootNode));
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    loadPrefs().then((loaded) => {
      setPrefs(loaded);
      applyTheme(loaded.theme);
      applyFont(loaded.font);
      loadTree(loaded.rootId);
    });
  }, [loadTree]);

  useEffect(() => {
    const onMq = () => applyTheme(prefs.theme);
    systemDarkMq?.addEventListener('change', onMq);
    return () => systemDarkMq?.removeEventListener('change', onMq);
  }, [prefs.theme]);

  const handlePatch = useCallback(
    (patch: Partial<Prefs>, msg = '已保存') => {
      if (patch.theme !== undefined) applyTheme(patch.theme);
      if (patch.font !== undefined) applyFont(patch.font);
      setPrefs((prev) => ({ ...prev, ...patch }));
      savePrefs(patch);
      flash(msg);
    },
    [flash],
  );

  const handleReset = () => {
    const patch: Partial<Prefs> = {
      rootId: DEFAULTS.rootId,
      openMode: DEFAULTS.openMode,
      theme: DEFAULTS.theme,
      font: DEFAULTS.font,
      ai: { ...DEFAULT_AI },
    };
    handlePatch(patch, '已恢复默认设置');
  };

  const version = getExtensionVersion();

  return (
    <div className="min-h-screen flex flex-col bg-background text-ink">
      <header className="sticky top-0 z-10 h-[62px] topbar-glass border-b border-line">
        <div className="w-[min(880px,calc(100%-56px))] max-sm:w-[calc(100%-32px)] mx-auto h-full flex items-center gap-3">
          <span className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-ink">
            <span className="w-7 h-7 bg-accent-soft text-accent inline-flex items-center justify-center">
              <Bookmark className="w-4 h-4 fill-current" />
            </span>
            <span>NeatTab</span>
          </span>
          <span className="w-px h-4 bg-line2" aria-hidden="true" />
          <span className="text-[13px] text-ink3">系统设置</span>

          <div className="ml-auto flex items-center gap-3">
            {version && <span className="font-mono text-[11px] text-ink3">{version}</span>}
            <a
              href="newtab.html"
              onClick={(e) => {
                if (window.history.length > 1) {
                  e.preventDefault();
                  window.history.back();
                }
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 border border-line2 bg-surface text-ink2 text-[12.5px] no-underline hover:bg-background hover:border-line3 hover:text-ink transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回</span>
            </a>
          </div>
        </div>
      </header>

      <main className="w-[min(880px,calc(100%-56px))] max-sm:w-[calc(100%-32px)] mx-auto pt-7 pb-12">
        <div className="mb-5 px-0.5">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em] text-ink">系统设置</h1>
          <p className="m-0 mt-1.5 text-[13px] text-ink2">改动即时生效，无需手动保存。</p>
        </div>

        <SettingsContent
          layout="page"
          prefs={prefs}
          onPatch={handlePatch}
          onImportDone={(res) => {
            loadTree(prefs.rootId);
            flash(res.mode === 'replace' ? '已备份并替换导入' : '已追加导入');
          }}
          onOpenBatchRename={() => {
            loadTree(prefs.rootId);
            setBatchOpen(true);
          }}
          onFlash={flash}
        />

        <BatchRenameDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          ai={prefs.ai}
          rootId={tree.resolvedRootId || prefs.rootId}
          tops={tree.tops}
          loose={tree.loose}
          favorites={prefs.favorites}
          currentFolderId="__all__"
          onOpenAiSettings={() => setBatchOpen(false)}
          onApplied={(count) => {
            loadTree(prefs.rootId);
            flash(`已整理 ${count} 条书签`);
          }}
        />

        <footer className="flex items-center gap-4 pt-5 px-1">
          <Button variant="link" onClick={handleReset}>
            恢复默认设置
          </Button>
          {savedMsg && <span className="text-xs text-accent">{savedMsg}</span>}
        </footer>
      </main>
    </div>
  );
}
