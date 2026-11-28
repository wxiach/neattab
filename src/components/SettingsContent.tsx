import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Segmented } from './ui/segmented';
import { NativeSelect } from './ui/select';
import { Switch } from './ui/switch';
import { FontPicker } from './FontPicker';
import { ImportDialog } from './ImportDialog';
import { DedupDialog } from './DedupDialog';
import { DEEPSEEK_MODELS, requestDeepSeekPermission, testDeepSeekConnection } from '@/lib/ai';
import { getRootOptions, type RootOption } from '@/lib/bookmarks';
import { getExtensionVersion } from '@/lib/storage';
import { exportRoot, type ImportResult } from '@/lib/transfer';
import type { AiConfig, OpenMode, Prefs, ThemeMode } from '@/lib/types';
import { cn } from '@/lib/cn';

export type SettingsTab = 'general' | 'data' | 'ai' | 'about';

const TAB_ITEMS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'data', label: '整理与备份' },
  { id: 'ai', label: '模型配置' },
  { id: 'about', label: '关于与权限' },
];

const PERMISSIONS_LIST: ReadonlyArray<{ key: string; desc: string }> = [
  { key: 'bookmarks', desc: '读写浏览器收藏夹（仅在编辑、拖拽、整理、去重或收藏时写入）' },
  { key: 'storage', desc: '保存本地设置、分类样本与 AI 助手配置' },
  { key: 'favicon', desc: '读取浏览器本地站点图标缓存' },
  { key: 'activeTab', desc: '点击工具栏图标时读取当前页标题与网址' },
  { key: 'scripting', desc: '启用 AI 时提取当前页简介与正文前 400 字摘要辅助分类（不读输入框）' },
  { key: 'fontSettings', desc: '列出本机已安装的系统字体' },
  { key: 'api.deepseek.com', desc: '可选权限：仅在启用 AI 助手时单独申请并访问' },
];

export function SettingsContent({
  prefs,
  onPatch,
  onImportDone,
  onBookmarksChanged,
  onOpenBatchRename,
  onFlash,
  layout = 'modal',
  initialTab = 'general',
}: {
  prefs: Prefs;
  onPatch: (patch: Partial<Prefs>, msg?: string) => void;
  onImportDone: (res: ImportResult) => void;
  onBookmarksChanged?: () => void;
  onOpenBatchRename?: () => void;
  onFlash: (msg?: string) => void;
  layout?: 'modal' | 'page';
  initialTab?: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [roots, setRoots] = useState<RootOption[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);

  // DeepSeek 配置本地编辑态
  const [showKey, setShowKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(prefs.ai.apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setApiKeyDraft(prefs.ai.apiKey);
  }, [prefs.ai.apiKey]);

  useEffect(() => {
    getRootOptions().then(({ options }) => setRoots(options));
  }, [prefs.rootId]);

  const updateAi = async (nextPartial: Partial<AiConfig>, msg = '已保存') => {
    const nextAi: AiConfig = { ...prefs.ai, ...nextPartial };
    if (nextPartial.enabled) {
      const granted = await requestDeepSeekPermission();
      if (!granted) {
        setTestResult({ ok: false, text: '未授予 api.deepseek.com 访问权限，无法启用' });
        return;
      }
    }
    onPatch({ ai: nextAi }, msg);
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyDraft.trim();
    if (trimmed !== prefs.ai.apiKey) {
      updateAi({ apiKey: trimmed }, 'API Key 已保存');
    }
  };

  const handleTestAi = async () => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      setTestResult({ ok: false, text: '请先输入 DeepSeek API Key' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const granted = await requestDeepSeekPermission();
    if (!granted) {
      setTesting(false);
      setTestResult({ ok: false, text: '未授予 api.deepseek.com 访问权限' });
      return;
    }
    const aiCfg: AiConfig = { ...prefs.ai, apiKey: trimmed };
    if (trimmed !== prefs.ai.apiKey) {
      onPatch({ ai: aiCfg }, '已保存');
    }
    const res = await testDeepSeekConnection(aiCfg);
    setTesting(false);
    if (res.ok) {
      if (!prefs.ai.enabled) {
        onPatch({ ai: { ...aiCfg, enabled: true } }, '已启用 DeepSeek');
        setTestResult({ ok: true, text: `连接成功 · ${res.latencyMs}ms（已自动启用）` });
      } else {
        setTestResult({ ok: true, text: `连接成功 · ${res.latencyMs}ms` });
      }
    } else {
      setTestResult({ ok: false, text: res.error });
    }
  };

  const handleExport = async () => {
    try {
      await exportRoot(prefs.rootId, prefs.favorites);
      onFlash('已导出 JSON');
    } catch {
      onFlash('导出失败');
    }
  };

  const rowCls =
    layout === 'modal'
      ? 'grid grid-cols-[100px_minmax(0,1fr)] max-sm:grid-cols-1 gap-4 px-5 py-4 border-t border-line first:border-t-0'
      : 'grid grid-cols-[180px_minmax(0,1fr)] max-sm:grid-cols-1 gap-6 px-7 py-5 border-t border-line first:border-t-0';

  const labelCls = 'pt-1.5 max-sm:pt-0 text-[13px] font-semibold text-ink';
  const labelTextCls = 'pt-0.5 max-sm:pt-0 text-[13px] font-semibold text-ink';
  const hintCls = 'mt-2.5 text-[12.5px] leading-[1.68] text-ink2';

  const renderGeneral = () => (
    <>
      <section className={rowCls}>
        <div className={labelCls}>外观</div>
        <div className="min-w-0">
          <Segmented<ThemeMode>
            aria-label="外观"
            value={prefs.theme}
            options={[
              { value: 'auto', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            onChange={(theme) => onPatch({ theme })}
          />
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>字体</div>
        <div className="min-w-0">
          <FontPicker value={prefs.font} onChange={(font) => onPatch({ font })} />
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>打开方式</div>
        <div className="min-w-0">
          <Segmented<OpenMode>
            aria-label="打开方式"
            value={prefs.openMode}
            options={[
              { value: 'tab', label: '新标签页' },
              { value: 'same', label: '当前标签页' },
            ]}
            onChange={(openMode) => onPatch({ openMode })}
          />
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>数据来源</div>
        <div className="min-w-0 max-w-[340px]">
          <NativeSelect
            aria-label="数据来源"
            value={prefs.rootId}
            onChange={(e) => onPatch({ rootId: e.target.value })}
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
          <p className={hintCls}>仅展示所选目录下的书签。</p>
        </div>
      </section>
    </>
  );

  const renderData = () => (
    <>
      {onOpenBatchRename && (
        <section className={rowCls}>
          <div className={labelCls}>AI 整理</div>
          <div className="min-w-0">
            <Button variant="outline" onClick={onOpenBatchRename}>
              AI 智能整理
            </Button>
            <p className={hintCls}>批量重命名、归类与目录体检，执行前自动备份。</p>
          </div>
        </section>
      )}

      <section className={rowCls}>
        <div className={labelCls}>重复书签</div>
        <div className="min-w-0">
          <Button variant="outline" onClick={() => setDedupOpen(true)}>
            扫描重复书签
          </Button>
          <p className={hintCls}>自动保留根目录的收藏副本，多余项可删除或移回「我的收藏」。</p>
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>导入导出</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport}>
              导出 JSON
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              导入 JSON
            </Button>
          </div>
          <p className={hintCls}>替换导入前自动下载备份，保留原顺序与收藏时间。</p>
        </div>
      </section>
    </>
  );

  const renderAi = () => (
    <>
      <section className={rowCls}>
        <div className={labelTextCls}>启用状态</div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Switch
              checked={prefs.ai.enabled}
              onCheckedChange={(enabled) => updateAi({ enabled }, enabled ? '已启用 AI 助手' : '已关闭 AI 助手')}
              aria-label="启用 AI 智能分类与命名"
            />
            <span className="text-[13px] font-medium text-ink">
              {prefs.ai.enabled ? '已启用' : '未启用（仅使用本地模型）'}
            </span>
          </div>
          <p className={hintCls}>开启后用于智能收藏优化与批量整理。</p>
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>API Key</div>
        <div className="min-w-0 max-w-[380px]">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onBlur={handleSaveKey}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveKey();
                }}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs pr-9"
              />
              <button
                type="button"
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 text-ink3 hover:text-ink cursor-pointer"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Button variant="outline" size="default" disabled={testing} onClick={handleTestAi}>
              {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              测试连接
            </Button>
          </div>
          {testResult && (
            <div className="mt-2">
              <Badge
                variant={testResult.ok ? 'success' : 'danger'}
                className="h-auto py-1 leading-snug whitespace-normal break-words max-w-full"
              >
                {testResult.text}
              </Badge>
            </div>
          )}
          <p className={hintCls}>仅保存在本机浏览器存储中。</p>
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelCls}>模型</div>
        <div className="min-w-0 max-w-[340px]">
          <NativeSelect
            aria-label="AI 模型"
            value={prefs.ai.model}
            onChange={(e) => updateAi({ model: e.target.value })}
          >
            {DEEPSEEK_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </section>
    </>
  );

  const version = getExtensionVersion();

  const renderAbout = () => (
    <>
      {version && (
        <section className={rowCls}>
          <div className={labelTextCls}>当前版本</div>
          <div className="min-w-0 flex items-center gap-2 text-[13px] text-ink">
            <span>NeatTab</span>
            <span className="font-mono text-ink2">{version}</span>
          </div>
        </section>
      )}

      <section className={rowCls}>
        <div className={labelTextCls}>隐私说明</div>
        <div className="min-w-0">
          <p className="m-0 text-[13px] leading-[1.68] text-ink">
            默认完全在本地运行，不读取浏览历史，无任何统计追踪。仅当你主动开启 AI 助手时，才向对应模型接口发送当前书签标题、网址与目录名。
          </p>
        </div>
      </section>

      <section className={rowCls}>
        <div className={labelTextCls}>扩展权限</div>
        <div className="min-w-0">
          <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
            {PERMISSIONS_LIST.map((p) => (
              <li
                key={p.key}
                className="grid grid-cols-[124px_minmax(0,1fr)] max-sm:grid-cols-1 items-baseline gap-x-2.5 gap-y-1 text-[12.5px] leading-[1.6] text-ink2"
              >
                <code className="justify-self-start inline-flex items-center h-5 px-1.5 font-mono text-[11px] font-medium leading-none border border-line2 bg-background shadow-[var(--badge-shadow)] text-ink">
                  {p.key}
                </code>
                <span>{p.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );

  return (
    <>
      {layout === 'modal' ? (
        <div className="flex-1 min-h-0 grid grid-cols-[152px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[auto_minmax(0,1fr)]">
          <nav
            role="tablist"
            aria-label="设置分类"
            className="flex flex-col max-sm:flex-row max-sm:overflow-x-auto gap-0.5 p-2 bg-background border-r max-sm:border-r-0 max-sm:border-b border-line"
          >
            {TAB_ITEMS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'w-full max-sm:w-auto shrink-0 h-[34px] px-3 border text-left text-[13px] font-sans cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-[-2px]',
                    active
                      ? 'bg-surface border-line shadow-[var(--shadow-sm)] text-ink font-semibold'
                      : 'bg-transparent border-transparent text-ink2 font-medium hover:bg-hover hover:text-ink',
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
            {tab === 'general' && renderGeneral()}
            {tab === 'data' && renderData()}
            {tab === 'ai' && renderAi()}
            {tab === 'about' && renderAbout()}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="m-0 mb-2 ml-0.5 text-xs font-semibold text-ink3 tracking-[0.02em]">常规</h2>
            <div className="bg-surface border border-line shadow-[var(--shadow-card)]">{renderGeneral()}</div>
          </div>
          <div>
            <h2 className="m-0 mb-2 ml-0.5 text-xs font-semibold text-ink3 tracking-[0.02em]">整理与备份</h2>
            <div className="bg-surface border border-line shadow-[var(--shadow-card)]">{renderData()}</div>
          </div>
          <div>
            <h2 className="m-0 mb-2 ml-0.5 text-xs font-semibold text-ink3 tracking-[0.02em]">模型配置</h2>
            <div className="bg-surface border border-line shadow-[var(--shadow-card)]">{renderAi()}</div>
          </div>
          <div>
            <h2 className="m-0 mb-2 ml-0.5 text-xs font-semibold text-ink3 tracking-[0.02em]">关于与权限</h2>
            <div className="bg-surface border border-line shadow-[var(--shadow-card)]">{renderAbout()}</div>
          </div>
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        rootId={prefs.rootId}
        favorites={prefs.favorites}
        onDone={onImportDone}
      />

      <DedupDialog
        open={dedupOpen}
        onOpenChange={setDedupOpen}
        rootId={prefs.rootId}
        favorites={prefs.favorites}
        onDone={(res) => {
          onBookmarksChanged?.();
          const parts: string[] = [];
          if (res.movedToFav > 0) parts.push(`已移回 ${res.movedToFav} 条到我的收藏`);
          if (res.deleted > 0) parts.push(`已删除 ${res.deleted} 条重复书签`);
          if (parts.length > 0) onFlash(parts.join('，'));
        }}
      />
    </>
  );
}
