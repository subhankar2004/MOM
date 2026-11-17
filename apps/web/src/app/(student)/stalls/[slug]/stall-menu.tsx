'use client';

import { formatINR } from '@mom/shared';
import { ArrowLeft, Banknote, Clock, MapPin, Smartphone, UtensilsCrossed } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CategoryNav, MENU_SCROLL_OFFSET } from '@/components/food/category-nav';
import { MenuItemRow, type MenuItemData } from '@/components/food/menu-item-row';
import { Button, ButtonLink } from '@/components/ui/button';
import { CongestionMeter } from '@/components/ui/congestion-meter';
import { EmptyState } from '@/components/ui/empty-state';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { VegDot } from '@/components/ui/veg-dot';
import { ApiError } from '@/lib/api-client';
import { cartStore, quantityIn, useCart } from '@/lib/cart';
import { useStallMenu, type StallMenu } from '@/lib/menu';
import { closingSoonLabel, formatTime, opensLabel } from '@/lib/time';

function MenuSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the menu
      </span>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-16" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex justify-between gap-4 py-2">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-10 w-24" />
        </div>
      ))}
    </div>
  );
}

function StallHeader({ stall, now }: { stall: StallMenu['stall']; now: Date }) {
  const { state, closesAt, nextOpensAt } = stall.availability;
  const closingSoon = state === 'open' ? closingSoonLabel(closesAt ? new Date(closesAt) : null, now) : null;
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-3xl leading-tight font-black">
          {stall.name}
          {stall.isVegOnly && <VegDot veg size={20} />}
        </h1>
        {state === 'open' && <StatusChip tone="success">Open</StatusChip>}
        {state === 'paused' && <StatusChip tone="warning">Paused</StatusChip>}
        {state === 'closed' && <StatusChip tone="neutral">Closed</StatusChip>}
      </div>
      {stall.description && <p className="text-ink-muted">{stall.description}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {state === 'open' && (
          <CongestionMeter level={stall.congestion.level} waitMinutes={stall.congestion.waitMinutes} />
        )}
        {state === 'open' && closesAt && (
          <span className="inline-flex items-center gap-1 text-ink-muted">
            <Clock size={14} aria-hidden />
            {closingSoon ? (
              <span className="font-semibold text-warning">{closingSoon}</span>
            ) : (
              `Open until ${formatTime(new Date(closesAt))}`
            )}
          </span>
        )}
        {stall.location && (
          <span className="inline-flex items-center gap-1 text-ink-muted">
            <MapPin size={14} aria-hidden />
            {stall.location}
          </span>
        )}
        <span className="inline-flex items-center gap-3 text-ink-muted">
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
      </div>
      {state === 'closed' && (
        <p role="status" className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-sm">
          <span className="font-semibold">
            Closed right now. {opensLabel(nextOpensAt ? new Date(nextOpensAt) : null, now)}.
          </span>{' '}
          You can look through the menu; ordering opens when the stall does.
        </p>
      )}
      {state === 'paused' && (
        <p role="status" className="rounded-(--radius-control) bg-warning-soft px-4 py-3 text-sm">
          <span className="font-semibold">Not taking new orders right now.</span> The stall is busy — check
          back in a few minutes.
        </p>
      )}
    </header>
  );
}

/** A stall's menu (spec §6.1 S3): browse by category, open a dish, add to the cart. */
export function StallMenuView() {
  const { slug } = useParams<{ slug: string }>();
  const menu = useStallMenu(slug);
  const cart = useCart();
  const [openItem, setOpenItem] = useState<MenuItemData | null>(null);
  const [pending, setPending] = useState<{ item: MenuItemData; quantity: number } | null>(null);

  const stall = menu.data?.stall;
  const orderingDisabled = stall ? stall.availability.state !== 'open' : true;

  const changeQuantity = useCallback(
    (item: MenuItemData, quantity: number) => {
      if (!stall) return;
      const result = cartStore.setQuantity(
        { id: stall.id, slug: stall.slug, name: stall.name },
        { itemId: item.id, name: item.name, pricePaise: item.pricePaise, isVeg: item.isVeg },
        quantity,
      );
      if (result === 'other-stall') setPending({ item, quantity });
    },
    [stall],
  );
  const openDetails = useCallback((item: MenuItemData) => setOpenItem(item), []);

  if (menu.isPending) return <MenuSkeleton />;
  if (menu.isError) {
    const notFound = menu.error instanceof ApiError && menu.error.status === 404;
    return (
      <EmptyState
        as="h1"
        icon={<UtensilsCrossed size={36} aria-hidden />}
        title={notFound ? "This stall isn't on MOM" : "Couldn't load the menu"}
        description={
          notFound
            ? 'It may have closed down or changed its name.'
            : 'Check your internet connection, then try again.'
        }
        action={
          notFound ? (
            <ButtonLink href="/">See all stalls</ButtonLink>
          ) : (
            <Button onClick={() => menu.refetch()}>Try again</Button>
          )
        }
      />
    );
  }

  const { categories } = menu.data;
  const now = new Date(menu.dataUpdatedAt);
  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 self-start text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> All stalls
      </Link>
      <StallHeader stall={menu.data.stall} now={now} />

      {itemCount === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed size={36} aria-hidden />}
          title="No dishes yet"
          description="This stall hasn't put its menu on MOM yet."
        />
      ) : (
        <>
          <CategoryNav categories={categories} />
          {categories.map((c) => (
            <section
              key={c.id}
              id={`cat-${c.id}`}
              aria-labelledby={`cat-${c.id}-title`}
              style={{ scrollMarginTop: MENU_SCROLL_OFFSET }}
            >
              <h2 id={`cat-${c.id}-title`} className="font-display text-2xl font-bold">
                {c.name} <span className="text-base font-normal text-ink-muted">({c.items.length})</span>
              </h2>
              <ul className="divide-y divide-border">
                {c.items.map((item) => (
                  <li key={item.id}>
                    <MenuItemRow
                      item={item}
                      quantity={quantityIn(cart, item.id)}
                      onQuantityChange={changeQuantity}
                      onOpen={openDetails}
                      orderingDisabled={orderingDisabled}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <Sheet open={openItem !== null} onClose={() => setOpenItem(null)} title={openItem?.name ?? ''}>
        {openItem && (
          <div className="flex flex-col gap-4">
            {openItem.imageUrl && (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-(--radius-card) bg-surface-2">
                <Image
                  src={openItem.imageUrl}
                  alt={openItem.name}
                  fill
                  sizes="(min-width: 640px) 512px, 100vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <VegDot veg={openItem.isVeg} />
              <span className="text-sm text-ink-muted">
                {openItem.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
              </span>
            </div>
            {openItem.description && <p>{openItem.description}</p>}
            <div className="flex items-center justify-between gap-4">
              <span className="tabular font-display text-2xl font-bold">
                {formatINR(openItem.pricePaise, { compact: true })}
              </span>
              {openItem.available ? (
                <QtyStepper
                  itemName={openItem.name}
                  value={quantityIn(cart, openItem.id)}
                  onChange={(n) => changeQuantity(openItem, n)}
                  disabled={orderingDisabled}
                />
              ) : (
                <span className="font-semibold text-ink-muted">Sold out</span>
              )}
            </div>
            {orderingDisabled && openItem.available && (
              <p className="text-sm text-ink-muted">Ordering opens when the stall does.</p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={pending !== null} onClose={() => setPending(null)} title="Start a new cart?">
        <div className="flex flex-col gap-4">
          <p>
            Your cart has dishes from <span className="font-semibold">{cart.stall?.name}</span>. You can order
            from one stall at a time — adding {pending?.item.name} will remove them.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                if (pending && stall) {
                  cartStore.replaceWith(
                    { id: stall.id, slug: stall.slug, name: stall.name },
                    {
                      itemId: pending.item.id,
                      name: pending.item.name,
                      pricePaise: pending.item.pricePaise,
                      isVeg: pending.item.isVeg,
                    },
                    pending.quantity,
                  );
                }
                setPending(null);
              }}
            >
              Start new cart
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep current cart
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
