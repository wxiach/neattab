import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn('relative w-full', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          'w-full h-9 pl-3 pr-9 appearance-none border border-line2 bg-background text-[13px] text-ink font-sans cursor-pointer transition-[background-color,border-color,box-shadow] duration-120 hover:border-line3 focus:outline-none focus:bg-surface focus:border-accent-line focus:shadow-[0_0_0_2px_var(--blue-soft)] disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink3"
      />
    </div>
  ),
);
NativeSelect.displayName = 'NativeSelect';
