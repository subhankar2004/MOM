import { formatINR } from '@mom/shared';
import { Banknote, MapPin, Smartphone } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { CongestionMeter } from '@/components/ui/congestion-meter';
import { StatusChip } from '@/components/ui/status-chip';
import { VegDot } from '@/components/ui/veg-dot';
import { cn } from '@/lib/cn';
import type { PublicStall } from '@/lib/stalls';
import { closingSoonLabel, opensLabel } from '@/lib/time';

/** Photo, or a calm placeholder built from the stall's initials until photos arrive (#19). */
function StallPhoto({ stall, dimmed }: { stall: PublicStall; dimmed: boolean }) {
  const initials = stall.name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (
    <div
      className={cn(
        'relative size-20 shrink-0 overflow-hidden rounded-(--radius-control) bg-haldi-soft',
        dimmed && 'grayscale',
      )}
    >
      {stall.photoUrl ? (
        <Image src={stall.photoUrl} alt="" fill sizes="80px" className="object-cover" unoptimized />
      ) : (
        <span
          aria-hidden
          className="flex size-full items-center justify-center font-display text-3xl font-black text-ink/70"
        >
          {initials}
        </span>
      )}
    </div>
  );
}

/**
 * One stall on the home list (spec §6.1 S2). The whole card links to the stall's menu.
 * Closed stalls are greyed (photo in greyscale, dashed quiet card) but keep full-contrast text.
 */
export function StallCard({
  stall,
  now,
  matchedDishes = [],
}: {
  stall: PublicStall;
  now: Date;
  /** Dishes that matched the search, shown under the name. */
  matchedDishes?: string[];
}) {
  const { state } = stall.availability;
  const closed = state === 'closed';
  const closesAt = stall.availability.closesAt ? new Date(stall.availability.closesAt) : null;
  const nextOpensAt = stall.availability.nextOpensAt ? new Date(stall.availability.nextOpensAt) : null;
  const closingSoon = state === 'open' ? closingSoonLabel(closesAt, now) : null;

  return (
    <Link
      href={`/stalls/${stall.slug}`}
      className={cn(
        'flex gap-3 rounded-(--radius-card) border bg-surface p-3 transition-colors hover:border-ink-muted',
        closed ? 'border-dashed border-border bg-surface-2' : 'border-border',
      )}
    >
      <StallPhoto stall={stall} dimmed={closed} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-1.5 font-display text-xl leading-tight font-bold">
            <span className="truncate">{stall.name}</span>
            {stall.isVegOnly && <VegDot veg />}
          </h2>
          {state === 'open' && <StatusChip tone="success">Open</StatusChip>}
          {state === 'paused' && <StatusChip tone="warning">Paused</StatusChip>}
          {closed && <StatusChip tone="neutral">Closed</StatusChip>}
        </div>

        <p className="truncate text-sm text-ink-muted">{stall.cuisineTags.join(', ')}</p>
        {matchedDishes.length > 0 && (
          <p className="truncate text-sm">
            <span className="text-ink-muted">Has </span>
            <span className="font-semibold">{matchedDishes.slice(0, 3).join(', ')}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {state === 'open' && (
            <CongestionMeter level={stall.congestion.level} waitMinutes={stall.congestion.waitMinutes} />
          )}
          {state === 'paused' && <span className="font-semibold">Not taking orders right now</span>}
          {closed && <span className="font-semibold">{opensLabel(nextOpensAt, now)}</span>}
          {closingSoon && <span className="font-semibold text-warning">{closingSoon}</span>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span className="flex min-w-0 items-center gap-3">
            {stall.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin size={14} aria-hidden className="shrink-0" />
                <span className="truncate">{stall.location}</span>
              </span>
            )}
            {stall.payments.upi && (
              <span className="inline-flex items-center gap-1">
                <Smartphone size={14} aria-hidden /> UPI
              </span>
            )}
            {stall.payments.cash && (
              <span className="inline-flex items-center gap-1">
                <Banknote size={14} aria-hidden /> Cash
              </span>
            )}
          </span>
          {stall.startingPricePaise !== null && (
            <span className="whitespace-nowrap">
              from {formatINR(stall.startingPricePaise, { compact: true })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
