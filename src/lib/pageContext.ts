export interface PageContext {
  description: string;
  h1: string;
  excerpt: string;
}

const EMPTY_CTX: PageContext = { description: '', h1: '', excerpt: '' };

function scrapeActivePage(): PageContext {
  const clean = (s: string | null | undefined, max: number) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);

  const metaSel = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];
  let description = '';
  for (const sel of metaSel) {
    const el = document.querySelector(sel);
    const val = clean(el?.getAttribute('content'), 220);
    if (val) {
      description = val;
      break;
    }
  }

  let h1 = '';
  for (const el of document.querySelectorAll('h1')) {
    const val = clean(el.textContent, 100);
    if (val) {
      h1 = val;
      break;
    }
  }

  const root =
    document.querySelector('main, article, [role="main"]') ||
    document.body;
  let excerpt = '';
  if (root) {
    const SKIP_TAGS = new Set([
      'SCRIPT',
      'STYLE',
      'NOSCRIPT',
      'SVG',
      'NAV',
      'FOOTER',
      'ASIDE',
      'INPUT',
      'TEXTAREA',
      'SELECT',
      'BUTTON',
      'TEMPLATE',
    ]);
    const chunks: string[] = [];
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== root) {
          if (SKIP_TAGS.has(p.tagName) || p.hidden || p.getAttribute('aria-hidden') === 'true') {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (total < 420) {
      const next = walker.nextNode();
      if (!next) break;
      const text = (next.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      chunks.push(text);
      total += text.length + 1;
    }
    excerpt = chunks.join(' ').slice(0, 420).trim();
  }

  return { description, h1, excerpt };
}

/** 仅在用户点击工具栏图标时，通过 activeTab + scripting 提取当前页轻量文本摘要（不抓表单/密码）。 */
export async function extractActiveTabContext(tabId: number | undefined): Promise<PageContext> {
  if (
    tabId == null ||
    typeof chrome === 'undefined' ||
    !chrome.scripting?.executeScript
  ) {
    return EMPTY_CTX;
  }

  const timeout = new Promise<PageContext>((resolve) => setTimeout(() => resolve(EMPTY_CTX), 300));
  const run = chrome.scripting
    .executeScript({
      target: { tabId },
      func: scrapeActivePage,
    })
    .then((results) => {
      const val = results?.[0]?.result as PageContext | undefined;
      if (!val || typeof val !== 'object') return EMPTY_CTX;
      return {
        description: String(val.description || ''),
        h1: String(val.h1 || ''),
        excerpt: String(val.excerpt || ''),
      };
    })
    .catch(() => EMPTY_CTX);

  return Promise.race([run, timeout]);
}
