'use strict';

/**
 * NAV — 跨页共享模块（newtab / options / popup 共用）
 * 负责：DOM 工具、主题与字体无闪烁应用、站点图标兜底、目录树工具、可搜索系统字体选择器。
 */
(() => {
  const hasExt = typeof chrome !== 'undefined' && !!chrome.bookmarks;
  const canFavicon =
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.getURL === 'function';

  const DEFAULTS = {
    rootId: '1',
    openMode: 'tab', // tab | same
    theme: 'auto', // auto | light | dark
    font: 'system',
    view: null, // { topId, subId }
    expanded: null, // [topId]
    favorites: [], // [bookmarkId]
    lastFolderId: '',
    mlFeedback: [],
  };

  const READING_FOLDER_RE = /阅读|稍后|待看|文章|帖子|read\s*later|reading|inbox/i;

  const LEGACY_FONTS = {
    yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
    dengxian: '"DengXian", "DengXian Light", "Microsoft YaHei UI", "Segoe UI", sans-serif',
    serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
    kai: '"KaiTi", "Kaiti SC", "STKaiti", "楷体", serif',
    mono: '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", ui-monospace, monospace',
  };

  const FONT_FALLBACK = '"Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';

  const PHOSPHOR = {
    caret: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
    folder: 'M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z',
    folderOpen: 'M245,110.64A16,16,0,0,0,232,104H216V88a16,16,0,0,0-16-16H130.67L102.94,51.2a16.14,16.14,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V208h0a8,8,0,0,0,8,8H211.1a8,8,0,0,0,7.59-5.47l28.49-85.47A16.05,16.05,0,0,0,245,110.64ZM93.34,64,123.2,86.4A8,8,0,0,0,128,88h72v16H69.77a16,16,0,0,0-15.18,10.94L40,158.7V64Zm112,136H43.1l26.67-80H232Z',
    star: 'M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z',
    starFill: 'M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z',
    plus: 'M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z',
    trash: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
  };

  const $ = (sel) => document.querySelector(sel);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const icon = (d, size = 15, cls = '') => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 256 256');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('fill', 'currentColor');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  const isLink = (node) => !!node && !!node.url && !/^javascript:/i.test(node.url);

  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function resolveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return mq.matches ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    const next = resolveTheme(mode);
    const root = document.documentElement;
    if (root.dataset.theme !== next) {
      root.classList.add('theme-switching');
      root.dataset.theme = next;
      void root.offsetHeight;
      root.classList.remove('theme-switching');
    }
    try {
      localStorage.setItem('nav_theme', next);
    } catch {
      /* 受限环境忽略本地缓存 */
    }
    return next;
  }

  function applyFont(fontVal) {
    const root = document.documentElement;
    const val = fontVal || 'system';
    if (val === 'system') {
      root.style.removeProperty('--font');
    } else if (LEGACY_FONTS[val]) {
      root.style.setProperty('--font', LEGACY_FONTS[val]);
    } else if (val.startsWith('sys:')) {
      const fam = val.slice(4).trim();
      if (fam) {
        const safe = fam.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        root.style.setProperty('--font', `"${safe}", ${FONT_FALLBACK}`);
      } else {
        root.style.removeProperty('--font');
      }
    }
    try {
      localStorage.setItem('nav_font', val);
    } catch {
      /* 忽略 */
    }
  }

  // 首帧同步恢复缓存的主题与字体，消除异步 storage 返回前的闪白和字形跳变
  try {
    const cachedTheme = localStorage.getItem('nav_theme');
    if (cachedTheme === 'light' || cachedTheme === 'dark') {
      document.documentElement.dataset.theme = cachedTheme;
    } else if (mq.matches) {
      document.documentElement.dataset.theme = 'dark';
    }
    const cachedFont = localStorage.getItem('nav_font');
    if (cachedFont) applyFont(cachedFont);
  } catch {
    /* 忽略 */
  }

  function findNode(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const hit = findNode(c, id);
      if (hit) return hit;
    }
    return null;
  }

  function countLinks(node) {
    let n = 0;
    for (const c of node.children || []) {
      if (c.url) n += 1;
      else n += countLinks(c);
    }
    return n;
  }

  function letterTile(host) {
    const tile = el('span', 'fv fv-l');
    tile.textContent = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase();
    return tile;
  }

  function makeFavicon(url, host) {
    if (!canFavicon) return letterTile(host);
    let src;
    try {
      src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
    } catch {
      return letterTile(host);
    }
    const img = el('img', 'fv');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(letterTile(host)), { once: true });
    img.src = src;
    return img;
  }

  function paintSeg(container, value) {
    if (!container) return;
    container.querySelectorAll('button[data-value]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    });
  }

  async function populateRootSelect(selectEl, currentRootId) {
    if (!selectEl) return currentRootId;
    const frag = document.createDocumentFragment();
    if (!hasExt) {
      frag.append(new Option('收藏夹栏', '1'));
      selectEl.replaceChildren(frag);
      return '1';
    }
    try {
      const [treeRoot] = await chrome.bookmarks.getTree();
      let found = false;
      const visit = (node, depth) => {
        for (const child of node.children || []) {
          if (!child.children) continue;
          const n = countLinks(child);
          const label = `${'\u00a0\u00a0'.repeat(depth)}${child.title || '（未命名）'}${n ? `  · ${n}` : ''}`;
          const opt = el('option', '', label);
          opt.value = child.id;
          if (child.id === currentRootId) {
            opt.selected = true;
            found = true;
          }
          frag.append(opt);
          visit(child, depth + 1);
        }
      };
      visit(treeRoot, 0);
      if (!found && frag.firstChild) {
        frag.firstChild.selected = true;
        selectEl.replaceChildren(frag);
        return frag.firstChild.value;
      }
    } catch {
      frag.append(new Option('收藏夹栏', '1'));
    }
    selectEl.replaceChildren(frag);
    return currentRootId;
  }

  /** 创建向下悬浮的可搜索本机字体选择器（虚拟滚动，仅渲染可见行以消除大量字体卡顿）。 */
  function createFontPicker({ picker, trigger, cur, panel, search, list, getValue, onSelect, scrollBox, bottomEl, maxHeight = 192 }) {
    const ROW_H = 32;
    const OVERSCAN = 4;
    let entries = [{ value: 'system', name: '系统默认', family: '', searchKey: '系统默认 system' }];
    let filtered = entries;
    let loaded = false;
    let loadingPromise = null;
    let lastStart = -1;
    let lastEnd = -1;
    let rafId = 0;

    let spacer = null;
    let slice = null;

    const ensureViewport = () => {
      if (!list) return false;
      if (spacer && slice && list.contains(spacer)) return true;
      spacer = el('div', 'font-spacer');
      slice = el('div', 'font-slice');
      spacer.append(slice);
      list.replaceChildren(spacer);
      return true;
    };

    const labelOf = (val) => {
      const key = val || 'system';
      const hit = entries.find((f) => f.value === key);
      if (hit) return hit.name;
      if (key.startsWith('sys:')) return key.slice(4);
      return '系统默认';
    };

    const syncLabel = () => {
      if (cur) cur.textContent = labelOf(getValue());
    };

    function load() {
      if (loaded) return Promise.resolve();
      if (loadingPromise) return loadingPromise;
      loadingPromise = (async () => {
        const out = [{ value: 'system', name: '系统默认', family: '', searchKey: '系统默认 system' }];
        const hasApi =
          typeof chrome !== 'undefined' && chrome.fontSettings && typeof chrome.fontSettings.getFontList === 'function';
        if (hasApi) {
          try {
            const raw = await chrome.fontSettings.getFontList();
            const seen = new Set();
            const sys = [];
            for (const f of raw || []) {
              const id = (f && f.fontId ? f.fontId : '').trim();
              const name = (f && f.displayName ? f.displayName : id).trim();
              if (!id || id.startsWith('@') || seen.has(id)) continue;
              seen.add(id);
              sys.push({
                value: `sys:${id}`,
                name,
                family: id,
                searchKey: `${name} ${id}`.toLowerCase(),
              });
            }
            const isCjk = (s) => /[\u4e00-\u9fa5]/.test(s);
            sys.sort((a, b) => {
              const diff = (isCjk(a.name) ? 0 : 1) - (isCjk(b.name) ? 0 : 1);
              return diff || a.name.localeCompare(b.name, 'zh-CN');
            });
            out.push(...sys);
          } catch {
            /* 受限环境仅保留系统默认 */
          }
        }
        entries = out;
        filtered = out;
        loaded = true;
        syncLabel();
      })();
      return loadingPromise;
    }

    function position() {
      if (!panel || !trigger || panel.hidden) return;
      const rect = trigger.getBoundingClientRect();
      if (scrollBox) {
        const br = scrollBox.getBoundingClientRect();
        if (rect.bottom < br.top || rect.top > br.bottom) {
          close();
          return;
        }
      }
      const top = rect.bottom + 4;
      const bottomLimit = bottomEl ? bottomEl.getBoundingClientRect().top - 8 : window.innerHeight - 16;
      const rawAvail = Math.min(maxHeight, bottomLimit - top - 35);
      const snapped = Math.max(ROW_H * 4, Math.floor(rawAvail / ROW_H) * ROW_H);
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${top}px`;
      panel.style.width = `${rect.width}px`;
      if (list) list.style.maxHeight = `${snapped}px`;
      paintVisible(true);
    }

    function paintVisible(force = false) {
      if (!list || !panel || panel.hidden) return;
      if (!filtered.length) {
        spacer = null;
        slice = null;
        lastStart = -1;
        lastEnd = -1;
        list.replaceChildren(el('div', 'font-empty', '未找到匹配的系统字体'));
        return;
      }
      ensureViewport();
      spacer.style.height = `${filtered.length * ROW_H}px`;
      const viewH = list.clientHeight || maxHeight;
      const scrollTop = list.scrollTop;
      const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
      const end = Math.min(filtered.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
      if (!force && start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;

      const active = getValue() || 'system';
      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i += 1) {
        const f = filtered[i];
        const btn = el('button', 'font-opt');
        btn.type = 'button';
        btn.dataset.val = f.value;
        btn.setAttribute('role', 'option');
        const on = f.value === active;
        btn.setAttribute('aria-selected', String(on));
        if (on) btn.classList.add('on');
        if (f.family) {
          const safe = f.family.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          btn.style.fontFamily = `"${safe}", ${FONT_FALLBACK}`;
        }
        btn.append(el('span', 'font-opt-name', f.name));
        if (on) btn.append(el('span', 'font-opt-mark', '✓'));
        frag.append(btn);
      }
      slice.style.transform = `translateY(${start * ROW_H}px)`;
      slice.replaceChildren(frag);
    }

    function applyFilter(query = '') {
      const q = query.trim().toLowerCase();
      filtered = q ? entries.filter((f) => f.searchKey.includes(q)) : entries;
      lastStart = -1;
      lastEnd = -1;
      if (list) list.scrollTop = 0;
      paintVisible(true);
    }

    const isOpen = () => !!panel && !panel.hidden;

    async function open() {
      if (!panel || !trigger) return;
      await load();
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      if (search) search.value = '';
      filtered = entries;
      lastStart = -1;
      lastEnd = -1;
      position();
      if (list) {
        const active = getValue() || 'system';
        const activeIdx = filtered.findIndex((f) => f.value === active);
        if (activeIdx >= 0) {
          const visibleRows = Math.max(1, Math.round((list.clientHeight || maxHeight) / ROW_H));
          list.scrollTop = Math.max(0, (activeIdx - Math.floor((visibleRows - 1) / 2)) * ROW_H);
        } else {
          list.scrollTop = 0;
        }
        paintVisible(true);
      }
      if (search) search.focus();
    }

    function close(restoreFocus = false) {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) trigger.focus();
      }
    }

    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('.font-opt');
        if (!btn || !btn.dataset.val) return;
        onSelect(btn.dataset.val);
        syncLabel();
        close();
      });
      list.addEventListener(
        'scroll',
        () => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            paintVisible(false);
          });
        },
        { passive: true },
      );
    }

    if (trigger) {
      trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    }
    if (search) {
      search.addEventListener('input', () => applyFilter(search.value));
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      });
    }
    document.addEventListener('pointerdown', (e) => {
      if (isOpen() && picker && !picker.contains(e.target)) close();
    });
    window.addEventListener('resize', position);
    if (scrollBox) scrollBox.addEventListener('scroll', position);
    else window.addEventListener('scroll', position, { passive: true });

    return { load, syncLabel, open, close, isOpen };
  }

  window.NAV = {
    hasExt,
    canFavicon,
    DEFAULTS,
    READING_FOLDER_RE,
    PHOSPHOR,
    mq,
    $,
    el,
    icon,
    hostOf,
    isLink,
    resolveTheme,
    applyTheme,
    applyFont,
    findNode,
    countLinks,
    letterTile,
    makeFavicon,
    paintSeg,
    populateRootSelect,
    createFontPicker,
  };
})();
