export type IconTone = 'normal' | 'dark-mono' | 'dark-color';

const toneCache = new Map<string, IconTone>();
let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * 根据 RGBA 像素数据判断图标在深色模式下的可读性：
 * - 极暗单色图标（如 GitHub、Apple、Vercel 等纯黑透明图标）返回 'dark-mono'，深色下反色变白；
 * - 偏暗彩色图标（无高亮像素、整体发暗）返回 'dark-color'，深色下配浅灰底框保留原色；
 * - 其余正常图标（含深底白字或明亮彩色图标）返回 'normal'。
 */
export function classifyIconPixels(data: Uint8ClampedArray): IconTone {
  let visibleCount = 0;
  let lumSum = 0;
  let chromaSum = 0;
  let brightCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= 48) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);

    visibleCount += 1;
    lumSum += lum;
    chromaSum += chroma;
    if (lum >= 175) brightCount += 1;
  }

  if (visibleCount === 0) return 'normal';

  const avgLum = lumSum / visibleCount;
  const avgChroma = chromaSum / visibleCount;
  const brightRatio = brightCount / visibleCount;

  // 若已有明显亮色区域（如黑底白字图标），深色模式下本来就清晰可读
  if (avgLum >= 82 || brightRatio >= 0.08) return 'normal';

  return avgChroma < 26 ? 'dark-mono' : 'dark-color';
}

export function getCachedIconTone(cacheKey: string): IconTone | undefined {
  return toneCache.get(cacheKey);
}

/** 采样已加载的 favicon 图像并缓存结果；若画布受跨域限制则降级为浅灰底框方案。 */
export function detectIconTone(img: HTMLImageElement, cacheKey: string): IconTone {
  const cached = toneCache.get(cacheKey);
  if (cached) return cached;

  if (typeof document === 'undefined' || !img.naturalWidth || !img.naturalHeight) {
    return 'normal';
  }

  try {
    if (!sharedCanvas) {
      sharedCanvas = document.createElement('canvas');
      sharedCanvas.width = 16;
      sharedCanvas.height = 16;
    }

    const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'normal';

    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    const tone = classifyIconPixels(data);
    toneCache.set(cacheKey, tone);
    return tone;
  } catch {
    // 若浏览器将内部 _favicon 标记为跨域污染，降级为浅灰底框确保暗色图标始终可见
    toneCache.set(cacheKey, 'dark-color');
    return 'dark-color';
  }
}
