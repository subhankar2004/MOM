import { cn } from '@/lib/cn';

/**
 * A large on/off switch (≥ 44 px tall) with its state written next to it, so it never
 * depends on colour alone. `label` is the accessible name; `onText`/`offText` are visible.
 */
export function Switch({
  label,
  on,
  onToggle,
  onText = 'On',
  offText = 'Off',
  disabled,
  className,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  onText?: string;
  offText?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2 rounded-full px-2 disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-veg' : 'bg-border')}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform',
            on && 'translate-x-5',
          )}
        />
      </span>
      <span className="w-16 text-left text-sm font-medium">{on ? onText : offText}</span>
    </button>
  );
}
