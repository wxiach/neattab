import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  'aria-label'?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-0.5 p-[3px] border border-line2 bg-background',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-7 px-3.5 text-[12.5px] font-sans cursor-pointer transition-[background-color,color,box-shadow] duration-120 focus-visible:outline-2 focus-visible:outline-accent-line focus-visible:outline-offset-1',
              active
                ? 'bg-surface text-ink font-semibold shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-ink2 font-normal hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
