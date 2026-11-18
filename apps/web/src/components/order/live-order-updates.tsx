'use client';

import { usePathname } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useOrderEvents } from '@/lib/order-events';
import { alertOrderReady } from '@/lib/ready-alert';
import { useSession } from '@/lib/session';

/**
 * Mounted once in the student app: keeps orders live on every page and, when an order
 * becomes ready while the student is elsewhere in the app, tells them right away.
 * (The order's own page shows its full-screen "Ready" state instead.)
 */
export function LiveOrderUpdates() {
  const { status } = useSession();
  const pathname = usePathname();
  const toast = useToast();
  useOrderEvents(status === 'signed-in', (event) => {
    if (event.status !== 'ready' || pathname === `/orders/${event.orderId}`) return;
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
