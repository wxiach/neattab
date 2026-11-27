import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, className, ...rest }: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-accent bg-accent'
          : 'border-line2 bg-background hover:border-line3',
        className,
      )}
      {...rest}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 bg-surface shadow-[var(--shadow-sm)] transition-transform duration-150',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </BaseSwitch.Root>
  );
}
