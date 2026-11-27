import { useState } from 'react';
import { faviconSrc } from '@/lib/bookmarks';
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
  const [failed, setFailed] = useState(false);
  const src = faviconSrc(url);
  const ch = (fallbackText || '?').trim().slice(0, 1).toUpperCase() || '?';

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

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(
        'shrink-0 border border-line bg-[var(--ico-bg)] object-contain select-none',
        className,
      )}
    />
  );
}
