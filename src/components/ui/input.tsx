import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full h-9 px-3 border border-line2 bg-background text-[13px] text-ink font-sans placeholder:text-ink3 transition-[background-color,border-color,box-shadow] duration-120 hover:border-line3 focus:outline-none focus:bg-surface focus:border-accent-line focus:shadow-[0_0_0_2px_var(--blue-soft)] disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
