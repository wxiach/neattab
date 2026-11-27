import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, id, className, ...rest }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2 disabled:opacity-45 disabled:cursor-not-allowed',
        checked
          ? 'border-accent bg-accent text-white'
          : 'border-line2 bg-surface hover:border-line3',
        className,
      )}
      {...rest}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center">
        <Check className="w-3 h-3 stroke-[2.5]" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
