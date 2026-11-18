'use client';

import { usePathname } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useOrderEvents } from '@/lib/order-events';
import { alertOrderReady } from '@/lib/ready-alert';
import { useSession } from '@/lib/session';

/**
 * Mounted once in the student app: keeps orders live on every page and, when an order
 * becomes ready while the student is elsewhere in the app, tells them right away.
 * Rejections are announced the same way. (The order's own page shows these itself.)
 */
export function LiveOrderUpdates() {
  const { status } = useSession();
  const pathname = usePathname();
  const toast = useToast();
  useOrderEvents(status === 'signed-in', (event) => {
    if (pathname === `/orders/${event.orderId}`) return;
    if (event.status === 'rejected') {
      toast(
        `${event.tokenNo ? `Token #${event.tokenNo}` : 'Your order'} was rejected by the stall. Open your orders for details.`,
        'error',
      );
      return;
    }
    if (event.status !== 'ready') return;
    alertOrderReady();
    toast(
      event.tokenNo
        ? `Token #${event.tokenNo} is ready. Go collect it!`
        : 'Your order is ready. Go collect it!',
      'success',
    );
  });
  return null;
}
