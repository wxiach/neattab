import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-sans font-medium transition-[background-color,border-color,color,opacity] duration-120 select-none cursor-pointer disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        default:
          'border border-ink bg-ink text-surface hover:opacity-90 shadow-[var(--shadow-sm)]',
        outline:
          'border border-line2 bg-surface text-ink2 hover:bg-background hover:border-line3 hover:text-ink shadow-[var(--shadow-sm)]',
        ghost:
          'border border-transparent bg-transparent text-ink2 hover:bg-hover hover:text-ink',
        danger:
          'border border-danger bg-danger text-white hover:bg-danger-hover hover:border-danger-hover shadow-[var(--shadow-sm)]',
        'danger-outline':
          'border border-danger-line bg-surface text-danger hover:bg-danger-soft',
        link:
          'border-0 bg-transparent text-ink3 underline underline-offset-4 decoration-line3 hover:text-ink p-0 h-auto',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs',
        sm: 'h-8 px-3 text-xs',
        default: 'h-[34px] px-3.5 text-[12.5px]',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
