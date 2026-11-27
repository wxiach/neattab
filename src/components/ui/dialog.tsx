import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export interface DialogPopupProps {
  className?: string;
  children: React.ReactNode;
}

export function DialogPopup({ className, children }: DialogPopupProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-60 bg-black/36" />
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4 pointer-events-none">
        <BaseDialog.Popup
          className={cn(
            'pointer-events-auto w-full max-w-[400px] border border-line2 bg-surface text-ink shadow-[var(--shadow-md)] focus:outline-none',
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      </div>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({
  title,
  extra,
  onClose,
  className,
}: {
  title: React.ReactNode;
  extra?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <BaseDialog.Title className="m-0 text-[15px] font-semibold text-ink truncate">
          {title}
        </BaseDialog.Title>
        {extra}
      </div>
      <BaseDialog.Close
        onClick={onClose}
        aria-label="关闭"
        title="关闭（Esc）"
        className="inline-flex items-center justify-center w-8 h-8 border border-transparent text-ink2 hover:bg-background hover:border-line hover:text-ink cursor-pointer transition-colors"
      >
        <X className="w-4 h-4" />
      </BaseDialog.Close>
    </div>
  );
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <BaseDialog.Description
      className={cn('m-0 text-[12.5px] leading-relaxed text-ink2', className)}
      {...props}
    />
  );
}
