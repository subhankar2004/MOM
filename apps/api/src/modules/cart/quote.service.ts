import { calcFees, type FeeBreakdown } from '@mom/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { menuItems, stallHours, stalls } from '../../db/schema/index.js';
import { notFound } from '../../lib/errors.js';
import { getCurrentSettings } from '../settings/settings.service.js';
import { availability } from '../stalls/availability.js';

export interface QuoteRequest {
  stallId: string;
  items: Array<{ itemId: string; quantity: number; /** price the student saw */ pricePaise: number }>;
}

export type LineStatus = 'ok' | 'price_changed' | 'unavailable' | 'removed';

export interface QuoteLine {
  itemId: string;
  name: string | null;
  quantity: number;
  status: LineStatus;
  /** Current price (null when the dish no longer exists). */
  unitPricePaise: number | null;
  /** The price the student saw, when it changed. */
  previousPricePaise: number | null;
  lineTotalPaise: number;
}

export type QuoteProblem =
  'stall_closed' | 'stall_paused' | 'no_payment_method' | 'items_need_attention' | 'empty';

/**
 * Re-prices a cart from the database (spec §6.1 S4). The client's prices are only used to
 * detect changes — the server's price always wins, here and when the order is placed (#14).
 */
export async function quoteCart(db: Db, req: QuoteRequest, now: Date, cfg: { upiOnline: boolean }) {
  const [stall] = await db
    .select()
    .from(stalls)
    .where(and(eq(stalls.id, req.stallId), eq(stalls.status, 'active')));
  if (!stall) throw notFound('This stall is no longer on MOM');

  const ids = req.items.map((i) => i.itemId);
  const [rows, hours, settings] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(menuItems)
          .where(
            and(inArray(menuItems.id, ids), eq(menuItems.stallId, stall.id), isNull(menuItems.deletedAt)),
          )
      : Promise.resolve([]),
    db.select().from(stallHours).where(eq(stallHours.stallId, stall.id)),
    getCurrentSettings(db),
  ]);

  const lines: QuoteLine[] = req.items.map((wanted) => {
    const item = rows.find((r) => r.id === wanted.itemId);
    if (!item) {
      return {
        itemId: wanted.itemId,
        name: null,
        quantity: wanted.quantity,
        status: 'removed',
        unitPricePaise: null,
        previousPricePaise: null,
        lineTotalPaise: 0,
      };
    }
    const base = {
      itemId: item.id,
      name: item.name,
      quantity: wanted.quantity,
      unitPricePaise: item.pricePaise,
    };
    if (!item.isAvailable)
      return { ...base, status: 'unavailable', previousPricePaise: null, lineTotalPaise: 0 };
    const changed = item.pricePaise !== wanted.pricePaise;
    return {
      ...base,
      status: changed ? 'price_changed' : 'ok',
      previousPricePaise: changed ? wanted.pricePaise : null,
      lineTotalPaise: item.pricePaise * wanted.quantity,
    };
  });

  const orderable = lines.filter((l) => l.status === 'ok' || l.status === 'price_changed');
  const subtotalPaise = orderable.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const rates = { platformFeeBps: settings.platformFeeBps, cashFeeBps: settings.cashFeeBps };
  const upiAccepted = cfg.upiOnline && stall.upiEnabled && stall.routeStatus === 'activated';
  // MOM can switch cash off for every stall at once (spec A7).
  const cashAccepted = stall.cashEnabled && settings.cashEnabledGlobally;
  const options: { upi: FeeBreakdown | null; cash: FeeBreakdown | null } = {
    upi: upiAccepted && subtotalPaise > 0 ? calcFees(subtotalPaise, 'upi', rates) : null,
    cash: cashAccepted && subtotalPaise > 0 ? calcFees(subtotalPaise, 'cash', rates) : null,
  };

  const state = availability(
    {
      status: stall.status,
      isOpenOverride: stall.isOpenOverride,
      // A platform-wide pause (spec A7) makes every stall "paused".
      acceptingOrders: stall.acceptingOrders && !settings.orderingPaused,
      hours,
    },
    now,
  ).state;
  const problems: QuoteProblem[] = [];
  if (orderable.length === 0) problems.push('empty');
  if (state === 'closed') problems.push('stall_closed');
  if (state === 'paused') problems.push('stall_paused');
  if (!upiAccepted && !cashAccepted) problems.push('no_payment_method');
  if (lines.some((l) => l.status !== 'ok')) problems.push('items_need_attention');

  return {
    stall: { id: stall.id, slug: stall.slug, name: stall.name, state },
    lines,
    subtotalPaise,
    rates,
    options,
    problems,
    /** True when the student can go on to pay: open, something to order, and nothing to review. */
    canCheckout: problems.length === 0,
  };
}
