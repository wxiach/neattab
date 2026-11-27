import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/** 对齐 coss ui <Badge>：细描边 + 微浮雕阴影 + 语意浅底色 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 h-5 px-1.5 border text-[11px] font-medium leading-none whitespace-nowrap select-none shadow-[var(--badge-shadow)]',
  {
    variants: {
      variant: {
        default: 'border-line2 bg-surface text-ink2',
        info: 'border-accent-line bg-accent-soft text-accent',
        warning: 'border-amber-line bg-amber-soft text-amber',
        success: 'border-emerald-line bg-emerald-soft text-emerald',
        danger: 'border-danger-line bg-danger-soft text-danger',
        muted: 'border-line bg-background text-ink3 shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
