import { cn } from '@/lib/cn';

/**
 * MOM's signature element: the order token as a counter ticket with notched sides.
 * The big number is what the student shows at the stall.
 */
export function TokenTicket({
  token,
  stallName,
  pickupCode,
  status,
  className,
}: {
  token: number;
  stallName: string;
  pickupCode?: string;
  status?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('ticket w-full max-w-xs rounded-(--radius-card) bg-haldi text-haldi-ink', className)}
      aria-label={`Token ${token} at ${stallName}${pickupCode ? `, pickup code ${pickupCode}` : ''}`}
      role="img"
    >
      <div className="flex flex-col items-center px-6 pt-5 pb-4">
        <span className="text-sm font-semibold">Your token</span>
        <span className="tabular font-display text-[5.5rem] leading-none font-black tracking-tight">
          #{token}
        </span>
        <span className="mt-1 text-center font-semibold">{stallName}</span>
      </div>
      <div className="mx-5 border-t-2 border-dashed border-haldi-ink/30" aria-hidden />
      <div className="flex items-center justify-between px-6 py-3 text-sm">
        <span>
          Pickup code{' '}
          <span className="tabular font-display text-xl font-bold tracking-widest">
            {pickupCode ?? '— — — —'}
          </span>
        </span>
        {status && <span className="font-semibold">{status}</span>}
      </div>
    </div>
  );
}
