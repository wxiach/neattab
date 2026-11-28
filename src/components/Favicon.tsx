import { useEffect, useState } from 'react';
import { faviconSrc } from '@/lib/bookmarks';
import { detectIconTone, type IconTone } from '@/lib/iconTone';
import { cn } from '@/lib/cn';

export function Favicon({
  url,
  fallbackText,
  className,
}: {
  url: string;
  fallbackText: string;
  className?: string;
}) {
  const src = faviconSrc(url);
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState<IconTone>('normal');
  const ch = (fallbackText || '?').trim().slice(0, 1).toUpperCase() || '?';

  useEffect(() => {
    setFailed(false);
    setTone('normal');
  }, [src]);

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 inline-flex items-center justify-center border border-line bg-subtle text-ink2 font-mono font-semibold select-none',
          className,
        )}
      >
        {ch}
      </span>
    );
  }

  // 把 padding 放到外层容器，避免对 dark-mono 反色时把图标底框一并反白
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center justify-center border border-line bg-[var(--ico-bg)] select-none overflow-hidden',
        tone === 'dark-color' && 'dark:bg-[var(--ico-bg-light)]',
        className,
      )}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        onLoad={(e) => setTone(detectIconTone(e.currentTarget, src))}
        className={cn(
          'w-full h-full object-contain',
          tone === 'dark-mono' && 'dark:invert dark:brightness-95',
        )}
      />
    </span>
  );
}
