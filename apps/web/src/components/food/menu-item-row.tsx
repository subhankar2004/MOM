'use client';

import { formatINR } from '@mom/shared';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { VegDot } from '@/components/ui/veg-dot';

export interface MenuItemData {
  id: string;
  name: string;
  description?: string;
  pricePaise: number;
  isVeg: boolean;
  available: boolean;
}

/** One dish on a stall's menu (#12). Photos arrive with image upload (#19). */
export function MenuItemRow({
  item,
  quantity,
  onQuantityChange,
}: {
  item: MenuItemData;
  quantity: number;
  onQuantityChange: (next: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <VegDot veg={item.isVeg} />
          <h4 className="font-semibold">{item.name}</h4>
        </div>
        <p className="tabular mt-0.5 font-display text-lg font-bold">
          {formatINR(item.pricePaise, { compact: true })}
        </p>
        {item.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{item.description}</p>}
      </div>
      <div className="flex flex-col items-center gap-1 pt-1">
        <QtyStepper
          itemName={item.name}
          value={quantity}
          onChange={onQuantityChange}
          disabled={!item.available}
        />
        {!item.available && <span className="text-xs font-semibold text-ink-muted">Sold out</span>}
      </div>
    </div>
  );
}
