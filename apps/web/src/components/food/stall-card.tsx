import { formatINR } from '@mom/shared';
import { Banknote, MapPin, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CongestionMeter, type CongestionLevel } from '@/components/ui/congestion-meter';
import { StatusChip } from '@/components/ui/status-chip';
import { VegDot } from '@/components/ui/veg-dot';
import { cn } from '@/lib/cn';

export interface StallCardData {
  name: string;
  cuisineTags: string[];
  location: string;
  isVegOnly: boolean;
  open: boolean;
  /** Shown when closed, e.g. "Opens 5:00 PM" */
  opensLabel?: string;
  congestion: CongestionLevel;
  waitMinutes: number;
  upi: boolean;
  cash: boolean;
  startingPricePaise?: number;
}

/** One stall in the home list (#11). Closed stalls get a quieter dashed card; text keeps full contrast. */
export function StallCard({ stall }: { stall: StallCardData }) {
  return (
    <Card className={cn('flex flex-col gap-3 p-4', !stall.open && 'border-dashed bg-surface-2')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-2xl leading-tight font-bold">
            <span className="truncate">{stall.name}</span>
            {stall.isVegOnly && <VegDot veg />}
          </h3>
          <p className="truncate text-sm text-ink-muted">{stall.cuisineTags.join(', ')}</p>
        </div>
        {stall.open ? (
          <StatusChip tone="success">Open</StatusChip>
        ) : (
          <StatusChip tone="neutral">Closed</StatusChip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {stall.open ? (
          <CongestionMeter level={stall.congestion} waitMinutes={stall.waitMinutes} />
        ) : (
          <span className="font-semibold">{stall.opensLabel}</span>
        )}
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <MapPin size={14} aria-hidden />
          {stall.location}
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-ink-muted">
        <span className="flex items-center gap-3">
          {stall.upi && (
            <span className="inline-flex items-center gap-1">
              <Smartphone size={14} aria-hidden /> UPI
            </span>
          )}
          {stall.cash && (
            <span className="inline-flex items-center gap-1">
              <Banknote size={14} aria-hidden /> Cash
            </span>
          )}
        </span>
        {stall.startingPricePaise !== undefined && (
          <span>from {formatINR(stall.startingPricePaise, { compact: true })}</span>
        )}
      </div>
    </Card>
  );
}
