'use strict';

// 首帧同步恢复主题与字体缓存，避免 React 挂载前出现白屏闪动或字形跳变
(() => {
  const FALLBACK = '"Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';
  const LEGACY = {
    yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
    dengxian: '"DengXian", "DengXian Light", "Microsoft YaHei UI", "Segoe UI", sans-serif',
    serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
    kai: '"KaiTi", "Kaiti SC", "STKaiti", "楷体", serif',
    mono: '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", ui-monospace, monospace',
  };
  try {
    const root = document.documentElement;
    const t = localStorage.getItem('nav_theme');
    if (t === 'light' || t === 'dark') {
      root.dataset.theme = t;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.dataset.theme = 'dark';
    }
    const f = localStorage.getItem('nav_font') || '';
    let stack = '';
    if (LEGACY[f]) {
      stack = LEGACY[f];
    } else if (f.startsWith('sys:')) {
      const fam = f.slice(4).trim();
      if (fam) {
        const safe = fam.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        stack = `"${safe}", ${FALLBACK}`;
      }
    }
    if (stack) {
      root.style.setProperty('--font', stack);
      root.style.setProperty('--default-font-family', stack);
    }
  } catch {
    /* 受限环境忽略 */
  }
})();
