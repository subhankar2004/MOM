'use client';

import { formatINR } from '@mom/shared';
import Image from 'next/image';
import { memo } from 'react';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { VegDot } from '@/components/ui/veg-dot';
import { cn } from '@/lib/cn';

export interface MenuItemData {
  id: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageUrl?: string | null;
  /** false = sold out */
  available: boolean;
}

/**
 * One dish on a stall's menu (spec §6.1 S3). Memoised: changing one dish's quantity
 * doesn't re-render the other 49 rows.
 */
export const MenuItemRow = memo(function MenuItemRow({
  item,
  quantity,
  onQuantityChange,
  onOpen,
  orderingDisabled = false,
}: {
  item: MenuItemData;
  quantity: number;
  onQuantityChange: (item: MenuItemData, next: number) => void;
  /** Open the dish's detail sheet. */
  onOpen?: (item: MenuItemData) => void;
  /** The stall is closed or paused: browse only. */
  orderingDisabled?: boolean;
}) {
  const soldOut = !item.available;
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <VegDot veg={item.isVeg} />
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="text-left font-semibold underline-offset-4 hover:underline"
            >
              {item.name}
            </button>
          ) : (
            <h3 className="font-semibold">{item.name}</h3>
          )}
        </div>
        <p className="tabular mt-0.5 font-display text-lg font-bold">
          {formatINR(item.pricePaise, { compact: true })}
        </p>
        {item.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{item.description}</p>}
      </div>
      <div className="flex w-28 shrink-0 flex-col items-center">
        {item.imageUrl && (
          <button
            type="button"
            onClick={() => onOpen?.(item)}
            tabIndex={-1}
            aria-hidden
            className={cn(
              'relative -mb-4 size-24 overflow-hidden rounded-(--radius-control) bg-surface-2',
              soldOut && 'grayscale',
            )}
          >
            {/* Fixed 96 px box (no layout shift), loaded only when scrolled near. */}
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="96px"
              loading="lazy"
              className="object-cover"
              unoptimized
            />
          </button>
        )}
        <div className="relative">
          <QtyStepper
            itemName={item.name}
            value={quantity}
            onChange={(n) => onQuantityChange(item, n)}
            disabled={soldOut || orderingDisabled}
          />
        </div>
        {soldOut && <span className="mt-1 text-xs font-semibold text-ink-muted">Sold out</span>}
      </div>
    </div>
  );
});
