import type { Db } from '../../db/client.js';
import { ledgerEntries } from '../../db/schema/index.js';

/**
 * Records MOM's earnings from an order in the append-only ledger (spec §4.4):
 * the platform fee, plus the cash-handling fee for cash orders. Call it inside the
 * transaction that confirms the money: UPI payment captured (#15) or cash received at
 * hand-over (#21). Never for an order that might still not be paid.
 */
export async function recordOrderFees(
  db: Db,
  order: { id: string; stallId: string; platformFeePaise: number; cashFeePaise: number },
): Promise<void> {
  const rows = [
    { entryType: 'platform_fee' as const, amountPaise: order.platformFeePaise },
    { entryType: 'cash_fee' as const, amountPaise: order.cashFeePaise },
  ].filter((r) => r.amountPaise > 0);
  if (rows.length === 0) return;
  await db
    .insert(ledgerEntries)
    .values(
      rows.map((r) => ({ ...r, stallId: order.stallId, orderId: order.id, direction: 'credit' as const })),
    );
}
