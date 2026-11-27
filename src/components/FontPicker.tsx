import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FONT_FALLBACK, formatFontLabel } from '@/lib/storage';

interface FontOption {
  value: string;
  label: string;
  family: string;
  search: string;
}

const CJK_RE = /[\u4e00-\u9fff]/;
const ROW_H = 32;
const OVERSCAN = 4;

let cachedSystemFonts: FontOption[] | null = null;
let loadingPromise: Promise<FontOption[]> | null = null;

function loadSystemFonts(): Promise<FontOption[]> {
  if (cachedSystemFonts) return Promise.resolve(cachedSystemFonts);
  if (loadingPromise) return loadingPromise;
  if (typeof chrome === 'undefined' || !chrome.fontSettings?.getFontList) {
    cachedSystemFonts = [];
    return Promise.resolve([]);
  }
  loadingPromise = new Promise<chrome.fontSettings.FontName[]>((resolve) => {
    let settled = false;
    const finish = (list?: chrome.fontSettings.FontName[]) => {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(list) ? list : []);
    };
    try {
      const maybe = chrome.fontSettings.getFontList(finish) as unknown;
      if (maybe && typeof (maybe as Promise<chrome.fontSettings.FontName[]>).then === 'function') {
        (maybe as Promise<chrome.fontSettings.FontName[]>).then(finish, () => finish([]));
      }
    } catch {
      finish([]);
    }
  })
    .then((list) => {
      const seen = new Set<string>();
      const out: FontOption[] = [];
      for (const item of list || []) {
        const fam = (item.fontId || '').trim();
        const label = (item.displayName || fam).trim();
        if (!fam || fam.startsWith('@') || seen.has(fam)) continue;
        seen.add(fam);
        out.push({
          value: `sys:${fam}`,
          label,
          family: fam,
          search: `${label} ${fam}`.toLowerCase(),
        });
      }
      out.sort((a, b) => {
        const ca = CJK_RE.test(a.label) ? 0 : 1;
        const cb = CJK_RE.test(b.label) ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return a.label.localeCompare(b.label, 'zh-Hans-CN');
      });
      cachedSystemFonts = out;
      return out;
    })
    .catch(() => {
      cachedSystemFonts = [];
      return [];
    })
    .finally(() => {
      loadingPromise = null;
    });
  return loadingPromise;
}

export function FontPicker({
  value,
  onChange,
  maxHeight = 200,
}: {
  value: string;
  onChange: (val: string) => void;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [fonts, setFonts] = useState<FontOption[]>(cachedSystemFonts || []);
  const [loading, setLoading] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cachedSystemFonts) {
      loadSystemFonts().then((list) => setFonts(list));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!cachedSystemFonts) {
      setLoading(true);
      loadSystemFonts().then((list) => {
        setFonts(list);
        setLoading(false);
      });
    }
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const avail = Math.max(120, Math.min(maxHeight, spaceBelow - 38));
      setPanelPos({ top: rect.bottom + 4, left: rect.left, width: rect.width, maxH: avail });
    };
    updatePos();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, maxHeight]);

  const options = useMemo<FontOption[]>(() => {
    const base: FontOption[] = [
      { value: 'system', label: '系统默认', family: '', search: '系统默认 system default' },
      ...fonts,
    ];
    if (value?.startsWith('sys:') && !base.some((o) => o.value === value)) {
      const fam = value.slice(4);
      base.splice(1, 0, { value, label: fam, family: fam, search: fam.toLowerCase() });
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => o.search.includes(q));
  }, [fonts, value, query]);

  const effectiveMaxH = panelPos?.maxH ?? maxHeight;
  const totalH = options.length * ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(effectiveMaxH / ROW_H) + OVERSCAN * 2;
  const end = Math.min(options.length, start + visibleCount);
  const visibleItems = options.slice(start, end);

  const currentLabel = useMemo(() => {
    const hit = fonts.find((f) => f.value === value);
    return hit ? hit.label : formatFontLabel(value);
  }, [fonts, value]);

  return (
    <div ref={wrapRef} className="relative w-full max-w-[360px]">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setQuery('');
          setScrollTop(0);
        }}
        className={cn(
          'w-full h-9 px-3 flex items-center justify-between gap-2 border border-line2 bg-background text-[13px] text-ink font-sans cursor-pointer transition-[background-color,border-color,box-shadow] duration-120 hover:border-line3 focus-visible:outline-none focus-visible:bg-surface focus-visible:border-accent-line focus-visible:shadow-[0_0_0_2px_var(--blue-soft)]',
          open && 'bg-surface border-accent-line shadow-[0_0_0_2px_var(--blue-soft)]',
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('w-4 h-4 text-ink3 shrink-0 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && panelPos && (
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          className="z-[90] border border-line2 bg-surface shadow-[var(--shadow-md)]"
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setScrollTop(0);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            placeholder="搜索本机字体…"
            autoComplete="off"
            spellCheck={false}
            className="w-full h-[34px] px-2.5 border-0 border-b border-line bg-background text-[12.5px] text-ink placeholder:text-ink3 focus:outline-none focus:bg-surface"
          />

          <div
            ref={listRef}
            role="listbox"
            aria-label="本机系统字体"
            style={{ maxHeight: effectiveMaxH }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="overflow-y-auto [scrollbar-width:thin]"
          >
            {loading && fonts.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink3">读取本机字体中…</div>
            ) : options.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink3">未找到匹配的字体</div>
            ) : (
              <div style={{ height: totalH, position: 'relative' }}>
                {visibleItems.map((opt, idx) => {
                  const i = start + idx;
                  const active = opt.value === value;
                  const safeFam = opt.family.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={{
                        position: 'absolute',
                        top: i * ROW_H,
                        left: 0,
                        right: 0,
                        height: ROW_H,
                        fontFamily: opt.family ? `"${safeFam}", ${FONT_FALLBACK}` : undefined,
                      }}
                      className={cn(
                        'w-full px-3 flex items-center justify-between gap-2 text-left text-[13px] cursor-pointer hover:bg-hover',
                        active ? 'bg-accent-soft text-accent font-semibold' : 'text-ink',
                      )}
                    >
                      <span className="truncate">{opt.label}</span>
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
