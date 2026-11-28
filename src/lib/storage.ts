import type { AiConfig, OpenMode, Prefs, ThemeMode } from './types.ts';

export const hasExt = typeof chrome !== 'undefined' && !!chrome.bookmarks;

export const canFavicon =
  typeof chrome !== 'undefined' && !!chrome.runtime && typeof chrome.runtime.getURL === 'function';

export const READING_FOLDER_RE = /阅读|稍后|待看|文章|帖子|read\s*later|reading|inbox/i;

export const DEFAULT_AI: AiConfig = {
  enabled: false,
  apiKey: '',
  model: 'deepseek-flash',
};

export const DEFAULTS: Prefs = {
  rootId: '1',
  openMode: 'tab',
  theme: 'auto',
  font: 'system',
  view: null,
  expanded: null,
  favorites: [],
  lastFolderId: '',
  ai: { ...DEFAULT_AI },
};

const LEGACY_FONTS: Record<string, string> = {
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
  dengxian: '"DengXian", "DengXian Light", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
  kai: '"KaiTi", "Kaiti SC", "STKaiti", "楷体", serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", ui-monospace, monospace',
};

export const FONT_FALLBACK =
  '"Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';

export const systemDarkMq =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function resolveTheme(mode: ThemeMode | string): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemDarkMq?.matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode | string): 'light' | 'dark' {
  const next = resolveTheme(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.dataset.theme !== next) {
      root.classList.add('theme-switching');
      root.dataset.theme = next;
      void root.offsetHeight;
      root.classList.remove('theme-switching');
    }
  }
  try {
    localStorage.setItem('nav_theme', next);
  } catch {
    /* 忽略受限环境 */
  }
  return next;
}

export function applyFont(fontVal: string | undefined): void {
  const val = fontVal || 'system';
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const body = document.body;
    let stack = '';
    if (val === 'system') {
      stack = '';
    } else if (LEGACY_FONTS[val]) {
      stack = LEGACY_FONTS[val];
    } else if (val.startsWith('sys:')) {
      const fam = val.slice(4).trim();
      if (fam) {
        const safe = fam.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        stack = `"${safe}", ${FONT_FALLBACK}`;
      }
    }

    if (stack) {
      root.style.setProperty('--font', stack);
      root.style.setProperty('--default-font-family', stack);
      if (body) body.style.fontFamily = stack;
    } else {
      root.style.removeProperty('--font');
      root.style.removeProperty('--default-font-family');
      if (body) body.style.removeProperty('font-family');
    }
  }
  try {
    localStorage.setItem('nav_font', val);
  } catch {
    /* 忽略 */
  }
}

export function formatFontLabel(val: string | undefined): string {
  if (!val || val === 'system') return '系统默认';
  if (val.startsWith('sys:')) return val.slice(4);
  const legacy: Record<string, string> = {
    yahei: '微软雅黑',
    dengxian: '等线',
    serif: '宋体',
    kai: '楷体',
    mono: '等宽字体',
  };
  return legacy[val] || '系统默认';
}

export function normalizePrefs(raw: Partial<Prefs> | undefined): Prefs {
  const aiRaw = (raw?.ai && typeof raw.ai === 'object' ? raw.ai : {}) as Partial<AiConfig>;
  return {
    rootId: typeof raw?.rootId === 'string' && raw.rootId ? raw.rootId : DEFAULTS.rootId,
    openMode: (raw?.openMode === 'same' ? 'same' : 'tab') as OpenMode,
    theme: (raw?.theme === 'light' || raw?.theme === 'dark' ? raw.theme : 'auto') as ThemeMode,
    font: typeof raw?.font === 'string' && raw.font ? raw.font : DEFAULTS.font,
    view: raw?.view ?? null,
    expanded: Array.isArray(raw?.expanded) ? raw.expanded.filter((x): x is string => typeof x === 'string') : null,
    favorites: Array.isArray(raw?.favorites) ? raw.favorites.filter((x): x is string => typeof x === 'string') : [],
    lastFolderId: typeof raw?.lastFolderId === 'string' ? raw.lastFolderId : '',
    ai: {
      enabled: Boolean(aiRaw.enabled),
      apiKey: typeof aiRaw.apiKey === 'string' ? aiRaw.apiKey.trim() : '',
      model:
        typeof aiRaw.model === 'string' && aiRaw.model.trim() && aiRaw.model.trim() !== 'deepseek-chat'
          ? aiRaw.model.trim()
          : DEFAULT_AI.model,
    },
  };
}

export async function loadPrefs(): Promise<Prefs> {
  if (!hasExt || !chrome.storage?.local) return normalizePrefs({});
  try {
    const stored = (await chrome.storage.local.get(DEFAULTS)) as Partial<Prefs>;
    return normalizePrefs(stored);
  } catch {
    return normalizePrefs({});
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  if (!hasExt || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set(patch);
  } catch {
    /* 忽略 */
  }
}

export function getExtensionVersion(): string {
  try {
    const m = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : null;
    return m?.version ? `v${m.version}` : '';
  } catch {
    return '';
  }
}
