import * as React from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { cn } from '@/lib/cn';

export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuPopup({
  align = 'end',
  sideOffset = 6,
  className,
  children,
}: {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <BaseMenu.Popup
          className={cn(
            'min-w-[164px] py-1 border border-line2 bg-surface text-ink shadow-[var(--shadow-md)] focus:outline-none',
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink2 select-none cursor-pointer outline-none transition-colors data-[highlighted]:bg-hover data-[highlighted]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <BaseMenu.Separator className={cn('h-px my-1 bg-line', className)} />;
}
