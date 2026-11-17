'use client';

import { formatINR } from '@mom/shared';
import { useQuery } from '@tanstack/react-query';
import { Bell, Clock, Phone, Plus, ShoppingBag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MenuItemRow, type MenuItemData } from '@/components/food/menu-item-row';
import { StallCard } from '@/components/food/stall-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CongestionMeter } from '@/components/ui/congestion-meter';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Logo } from '@/components/ui/logo';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Stat } from '@/components/ui/stat';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs } from '@/components/ui/tabs';
import { TextField } from '@/components/ui/text-field';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useToast } from '@/components/ui/toast';
import { TokenTicket } from '@/components/ui/token-ticket';
import { VegDot } from '@/components/ui/veg-dot';
import { apiRequest, ApiError, API_URL } from '@/lib/api-client';
import type { PublicStall } from '@/lib/stalls';

const SHOWCASE_NOW = new Date('2026-11-16T12:00:00+05:30');
const sampleStall = (over: Partial<PublicStall>): PublicStall => ({
  id: over.slug ?? 'x',
  slug: 'x',
  name: 'Stall',
  description: null,
  location: null,
  photoUrl: null,
  cuisineTags: [],
  isVegOnly: false,
  availability: { state: 'open', reason: 'hours', closesAt: null, nextOpensAt: null },
  congestion: { level: 'low', waitMinutes: 8 },
  payments: { upi: true, cash: true },
  startingPricePaise: 3000,
  dishes: [],
  ...over,
});
const STALLS: PublicStall[] = [
  sampleStall({
    slug: 'dosa-corner',
    name: 'Dosa Corner',
    cuisineTags: ['South Indian', 'Breakfast'],
    location: 'Near Main Gate',
    isVegOnly: true,
    availability: { state: 'open', reason: 'hours', closesAt: '2026-11-16T07:00:00Z', nextOpensAt: null },
  }),
  sampleStall({
    slug: 'chowmein-junction',
    name: 'Chowmein Junction',
    cuisineTags: ['Chinese', 'Fast Food'],
    location: 'Hostel Road',
    congestion: { level: 'busy', waitMinutes: 24 },
    payments: { upi: false, cash: true },
    startingPricePaise: 5000,
  }),
  sampleStall({
    slug: 'chai-and-rolls',
    name: 'Chai & Rolls',
    cuisineTags: ['Snacks', 'Beverages'],
    location: 'Behind Academic Block',
    availability: { state: 'paused', reason: 'paused', closesAt: null, nextOpensAt: null },
  }),
  sampleStall({
    slug: 'odia-thali-ghar',
    name: 'Odia Thali Ghar',
    cuisineTags: ['Odia', 'Meals'],
    location: 'Opposite Library',
    availability: { state: 'closed', reason: 'hours', closesAt: null, nextOpensAt: '2026-11-16T13:30:00Z' },
    startingPricePaise: 2000,
  }),
];

const MENU: MenuItemData[] = [
  {
    id: 'm1',
    name: 'Masala Dosa',
    description: 'Crisp dosa with spiced potato filling, sambar and coconut chutney',
    pricePaise: 6000,
    isVeg: true,
    available: true,
  },
  { id: 'm2', name: 'Chicken Chowmein', pricePaise: 8000, isVeg: false, available: true },
  { id: 'm3', name: 'Paneer Dosa', pricePaise: 8000, isVeg: true, available: false },
];

const SWATCHES = [
  ['bg', 'Page'],
  ['surface', 'Surface'],
  ['surface-2', 'Surface 2'],
  ['border', 'Border'],
  ['ink', 'Ink'],
  ['ink-muted', 'Ink muted'],
  ['brand', 'Brand'],
  ['haldi', 'Haldi'],
  ['veg', 'Veg'],
  ['nonveg', 'Non-veg'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['danger', 'Danger'],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-8" aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="font-display text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ApiStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiRequest<{ status: string; version: string }>('/health'),
    retry: false,
  });
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4" aria-live="polite">
      {health.isPending && <Spinner label="Checking the API" />}
      {health.isSuccess && <StatusChip tone="success">Connected</StatusChip>}
      {health.isError && <StatusChip tone="danger">Not reachable</StatusChip>}
      <span className="text-sm text-ink-muted">
        {health.isSuccess && `API ${health.data.version} at ${API_URL}`}
        {health.isError &&
          (health.error instanceof ApiError ? health.error.message : 'Unknown error') +
            ' Start it with npm run dev.'}
        {health.isPending && `Calling ${API_URL}/health`}
      </span>
      <Button variant="secondary" size="sm" onClick={() => health.refetch()} className="ml-auto">
        Check again
      </Button>
    </Card>
  );
}

export function Showcase() {
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({ m1: 2 });
  const [tab, setTab] = useState<'new' | 'preparing' | 'ready'>('new');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const phoneError =
    phone && !/^[6-9]\d{9}$/.test(phone.replace(/\s/g, '')) ? 'Enter a 10-digit mobile number' : undefined;

  return (
    <main id="main" className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-4">
          <Logo />
          <h1 className="text-lg font-semibold text-ink-muted">Design system</h1>
        </div>
        <ThemeToggle />
      </header>

      <Section title="API connection">
        <ApiStatus />
      </Section>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map(([token, label]) => (
            <li key={token} className="flex items-center gap-3">
              <span
                className="size-10 shrink-0 rounded-(--radius-control) border border-border"
                style={{ background: `var(--${token})` }}
              />
              <span className="text-sm">
                <span className="block font-semibold">{label}</span>
                <span className="text-ink-muted">{token}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="font-display text-3xl font-black">Hot dosa, no queue.</p>
        <p className="font-display text-2xl font-bold">Chai &amp; Rolls is ready for you</p>
        <p className="max-w-prose">
          Order from the stall, pay by UPI or cash, and show your token at the counter when your food is
          ready. Body text is Schibsted Grotesk; headings and numbers are Big Shoulders.
        </p>
        <p className="text-sm text-ink-muted">
          Small print: prices include all stall charges; MOM&apos;s fee is shown at checkout.
        </p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<ShoppingBag size={18} aria-hidden />}>Place order</Button>
          <Button variant="haldi">Pay {formatINR(13130)}</Button>
          <Button variant="secondary">View menu</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Reject order</Button>
          <Button loading>Paying</Button>
          <Button disabled>Closed</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <IconButton label="Notifications" icon={<Bell size={20} aria-hidden />} />
          <IconButton label="Add stall" tone="brand" icon={<Plus size={20} aria-hidden />} />
        </div>
      </Section>

      <Section title="Labels and marks">
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip tone="success">Open</StatusChip>
          <StatusChip tone="neutral">Closed</StatusChip>
          <StatusChip tone="haldi" icon={<Clock size={12} aria-hidden />}>
            Preparing
          </StatusChip>
          <StatusChip tone="brand">Ready</StatusChip>
          <StatusChip tone="warning">Cash due</StatusChip>
          <StatusChip tone="danger">Rejected</StatusChip>
          <span className="inline-flex items-center gap-2 text-sm">
            <VegDot veg /> Veg
          </span>
          <span className="inline-flex items-center gap-2 text-sm">
            <VegDot veg={false} /> Non-veg
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <CongestionMeter level="low" waitMinutes={6} />
          <CongestionMeter level="moderate" waitMinutes={15} />
          <CongestionMeter level="busy" waitMinutes={26} />
        </div>
      </Section>

      <Section title="Form fields">
        <div className="grid max-w-md gap-4">
          <TextField
            label="Mobile number"
            leading="+91"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint="We'll send a 6-digit code by SMS."
            error={phoneError}
          />
          <TextField
            label="Note for the stall"
            placeholder="Less spicy, please"
            hint="Optional, up to 200 characters."
          />
        </div>
      </Section>

      <Section title="Stall cards">
        <div className="grid gap-3 sm:grid-cols-2">
          {STALLS.map((s) => (
            <StallCard
              key={s.slug}
              stall={s}
              now={SHOWCASE_NOW}
              matchedDishes={s.slug === 'dosa-corner' ? ['Masala Dosa'] : []}
            />
          ))}
        </div>
      </Section>

      <Section title="Menu">
        <Card className="divide-y divide-border px-4">
          {MENU.map((item) => (
            <MenuItemRow
              key={item.id}
              item={item}
              quantity={qty[item.id] ?? 0}
              onQuantityChange={(it, n) => setQty((q) => ({ ...q, [it.id]: n }))}
            />
          ))}
        </Card>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          Stepper on its own:{' '}
          <QtyStepper
            itemName="Masala Chai"
            value={qty.chai ?? 0}
            onChange={(n) => setQty((q) => ({ ...q, chai: n }))}
          />
        </div>
      </Section>

      <Section title="Token">
        <div className="flex flex-wrap items-start gap-6">
          <TokenTicket token={23} stallName="Dosa Corner" pickupCode="4271" status="Ready" />
          <TokenTicket token={7} stallName="Chai & Rolls" />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          label="Order board"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'new', label: 'New (3)' },
            { key: 'preparing', label: 'Preparing (2)' },
            { key: 'ready', label: 'Ready (1)' },
          ]}
        >
          <p className="text-ink-muted">
            {tab === 'new' && 'Tokens #24, #25 and #26 are waiting to be accepted.'}
            {tab === 'preparing' && 'Tokens #21 and #22 are being prepared.'}
            {tab === 'ready' && 'Token #20 is ready for pickup.'}
          </p>
        </Tabs>
      </Section>

      <Section title="Sheet and toasts">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open item details
          </Button>
          <Button variant="secondary" onClick={() => toast('Added Masala Dosa to your cart', 'success')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast('Payment failed. You were not charged.', 'error')}>
            Error toast
          </Button>
        </div>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Masala Dosa">
          <div className="flex flex-col gap-4">
            <p className="text-ink-muted">
              Crisp dosa with spiced potato filling, sambar and coconut chutney.
            </p>
            <Button fullWidth onClick={() => setSheetOpen(false)}>
              Add for {formatINR(6000, { compact: true })}
            </Button>
          </div>
        </Sheet>
      </Section>

      <Section title="Loading and empty">
        <Card className="flex flex-col gap-3 p-4" role="status" aria-busy="true">
          <span className="sr-only">Loading stalls</span>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10 w-full" />
        </Card>
        <Card>
          <EmptyState
            icon={<Phone size={36} aria-hidden />}
            title="No orders yet"
            description="Pick a stall, add a dish and your token shows up here."
            action={<Button>Browse stalls</Button>}
          />
        </Card>
      </Section>

      <Section title="Dashboard">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Orders today" value="128" hint="+18 vs last Monday" />
          <Stat label="Sales" value={formatINR(1846000, { compact: true })} />
          <Stat label="MOM earnings" value={formatINR(31240)} hint="Platform + cash fees" />
        </div>
        <DataTable
          caption="Recent orders"
          rowKey={(r) => r.token}
          columns={[
            {
              key: 'token',
              header: 'Token',
              cell: (r) => <span className="font-display text-lg font-bold">#{r.token}</span>,
            },
            { key: 'stall', header: 'Stall', cell: (r) => r.stall },
            {
              key: 'pay',
              header: 'Payment',
              cell: (r) =>
                r.cash ? (
                  <StatusChip tone="warning">Cash due</StatusChip>
                ) : (
                  <StatusChip tone="success">UPI paid</StatusChip>
                ),
            },
            { key: 'total', header: 'Total', align: 'right', cell: (r) => formatINR(r.total) },
          ]}
          rows={[
            { token: '23', stall: 'Dosa Corner', cash: false, total: 13130 },
            { token: '24', stall: 'Dosa Corner', cash: true, total: 13780 },
            { token: '7', stall: 'Chai & Rolls', cash: false, total: 3030 },
          ]}
        />
      </Section>
    </main>
  );
}
