import * as React from 'react';
import { cn } from '@/lib/cn';

/** 对齐 coss ui <Kbd>：等宽轻量键帽 + 细描边 + 微浮雕底影 */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5 font-mono text-[11px] font-medium leading-none text-ink2 border border-line2 bg-surface shadow-[var(--kbd-shadow)] whitespace-nowrap select-none',
        className,
      )}
      {...props}
    />
  );
}
