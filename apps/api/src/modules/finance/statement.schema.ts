import { z } from 'zod';

const paise = z.number().int();

/** Response shape of a stall statement (admin and the stall owner see the same). */
export const statementSchema = z.object({
  stall: z.object({ id: z.uuid(), name: z.string() }),
  period: z.object({ from: z.string(), to: z.string() }),
  openingPaise: paise,
  lines: z.array(
    z.object({
      at: z.date(),
      kind: z.enum(['cash_order_fees', 'adjustment', 'settlement']),
      description: z.string(),
      amountPaise: paise,
      balancePaise: paise,
      orderId: z.string().nullable(),
    }),
  ),
  closingPaise: paise,
  totals: z.object({ feesPaise: paise, adjustmentsPaise: paise, settledPaise: paise }),
  upi: z.object({
    transferredPaise: paise,
    releasedPaise: paise,
    reversedPaise: paise,
    heldNowPaise: paise,
    failedTransfers: z.number().int(),
  }),
  settlements: z.array(
    z.object({
      id: z.uuid(),
      amountPaise: paise,
      periodStart: z.string(),
      periodEnd: z.string(),
      note: z.string().nullable(),
      createdAt: z.date(),
    }),
  ),
});

export const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
