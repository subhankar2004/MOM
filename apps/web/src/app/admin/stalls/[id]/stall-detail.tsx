'use client';

import { ArrowLeft, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { RouteStatusChip, StallStatusChip } from '@/components/admin/stall-chips';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { selectStall } from '@/lib/vendor-stall';
import {
  CHECKLIST_ITEMS,
  checklistDone,
  parseTags,
  useAdminStall,
  useRefreshSettlement,
  useRegisterMember,
  useSetUpSettlement,
  useTestActivate,
  useUpdateStall,
  type AdminStallDetail,
  type Checklist,
  type SettlementInput,
} from '@/lib/admin-stalls';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t save. Check your connection and try again.';

/** One stall: status, go-live checklist, owners, details and UPI payouts (spec §6.3 A3). */
export function StallDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useAdminStall(id);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        as="h1"
        title={missing ? 'Stall not found' : "Can't load this stall"}
        description={
          missing ? 'It may have been removed.' : 'Check your internet connection, then try again.'
        }
        action={
          missing ? (
            <Link href="/admin/stalls" className="font-semibold underline">
              All stalls
            </Link>
          ) : (
            <Button onClick={() => query.refetch()}>Try again</Button>
          )
        }
      />
    );
  }
  return <Detail data={query.data} />;
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId}>
      <Card className="flex flex-col gap-3 p-4">
        <h2 id={headingId} className="font-display text-xl font-bold">
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}

function Detail({ data }: { data: AdminStallDetail }) {
  const { stall } = data;
  const router = useRouter();
  const update = useUpdateStall(stall.id);
  const toast = useToast();
  const done = checklistDone(data.checklist);

  const setStatus = (status: 'draft' | 'active' | 'suspended', message: string) =>
    update.mutate(
      { status },
      { onSuccess: () => toast(message, 'success'), onError: (err) => toast(errorText(err), 'error') },
    );
  /** Opens the stall console on this stall (admins can manage any stall; changes are audited). */
  const openConsole = (path: Route) => {
    selectStall(stall.id);
    router.push(path);
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/stalls"
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> All stalls
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold">{stall.name}</h1>
          <StallStatusChip status={stall.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {stall.status === 'active' && (
            <a
              href={`/stalls/${stall.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold underline-offset-2 hover:underline"
            >
              Student page <ExternalLink size={14} aria-hidden />
            </a>
          )}
          {stall.status !== 'active' && (
            <Button loading={update.isPending} onClick={() => setStatus('active', `${stall.name} is live`)}>
              {stall.status === 'suspended' ? 'Make live again' : 'Go live'}
            </Button>
          )}
          {stall.status === 'active' && (
            <Button
              variant="danger"
              loading={update.isPending}
              onClick={() => setStatus('suspended', `${stall.name} suspended: hidden from students`)}
            >
              Suspend
            </Button>
          )}
          {stall.status === 'suspended' && (
            <Button variant="secondary" onClick={() => setStatus('draft', 'Moved back to draft')}>
              Move to draft
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`Ready to go live: ${done} of 5`}>
          <ChecklistView checklist={data.checklist} onFix={openConsole} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="secondary" size="sm" onClick={() => openConsole('/vendor/menu')}>
              Edit menu
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openConsole('/vendor/settings')}>
              Hours, photo &amp; payments
            </Button>
          </div>
          <p className="text-sm text-ink-muted">
            These open the stall console for {stall.name}. Changes you make there are recorded under your
            name.
          </p>
        </Section>
        <OwnersSection data={data} />
      </div>

      <DetailsSection key={JSON.stringify(stall)} data={data} />
      <SettlementSection data={data} />
    </div>
  );
}

const FIX: Partial<Record<keyof Checklist, Route>> = {
  menu: '/vendor/menu',
  hours: '/vendor/settings',
  photo: '/vendor/settings',
  payments: '/vendor/settings',
};

function ChecklistView({ checklist, onFix }: { checklist: Checklist; onFix: (path: Route) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {CHECKLIST_ITEMS.map(({ key, label }) => {
        const ok = checklist[key];
        const fix = FIX[key];
        return (
          <li key={key} className="flex min-h-10 items-center gap-2">
            {ok ? (
              <CheckCircle2 size={20} aria-hidden className="shrink-0 text-success" />
            ) : (
              <Circle size={20} aria-hidden className="shrink-0 text-ink-muted" />
            )}
            <span className={cn('flex-1', !ok && 'text-ink-muted')}>
              {label}
              <span className="sr-only">{ok ? ': done' : ': not yet'}</span>
            </span>
            {!ok &&
              (fix ? (
                <Button variant="ghost" size="sm" onClick={() => onFix(fix)}>
                  Fix
                </Button>
              ) : (
                <a href="#owners" className="px-3 text-sm font-semibold underline-offset-2 hover:underline">
                  Add
                </a>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

function OwnersSection({ data }: { data: AdminStallDetail }) {
  const register = useRegisterMember(data.stall.id);
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('owner');
  const [error, setError] = useState<string>();
  const roleId = useId();

  return (
    <Section title="Owner & staff" id="owners">
      {data.members.length + data.pending.length === 0 ? (
        <p className="text-ink-muted">No one yet. Register the owner&apos;s phone number below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.members.map((m) => (
            <li key={m.userId} className="flex min-h-11 items-center justify-between gap-2 py-1">
              <span>
                <span className="font-semibold">{m.name ?? 'No name yet'}</span>
                <span className="tabular block text-sm text-ink-muted">{m.phone}</span>
              </span>
              <span className="text-sm text-ink-muted">{m.role === 'owner' ? 'Owner' : 'Staff'}</span>
            </li>
          ))}
          {data.pending.map((p) => (
            <li key={p.phone} className="flex min-h-11 items-center justify-between gap-2 py-1">
              <span className="tabular">{p.phone}</span>
              <span className="text-sm text-ink-muted">
                {p.role === 'owner' ? 'Owner' : 'Staff'} · hasn&apos;t signed in yet
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-end"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          register.mutate(
            { phone, role },
            {
              onSuccess: (r) => {
                setPhone('');
                toast(
                  r.activeNow
                    ? `${r.phone} can manage this stall now`
                    : `${r.phone} registered: they get access when they sign in`,
                  'success',
                );
              },
              onError: (err) => setError(errorText(err)),
            },
          );
        }}
      >
        <TextField
          label="Phone number"
          leading="+91"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={error}
          className="min-w-0 flex-1"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-semibold">
            Role
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'staff')}
            className="h-12 rounded-(--radius-control) border border-border bg-surface px-3"
          >
            <option value="owner">Owner</option>
            <option value="staff">Counter staff</option>
          </select>
        </div>
        <Button type="submit" size="lg" loading={register.isPending} disabled={!phone.trim()}>
          Register
        </Button>
      </form>
      <p className="text-sm text-ink-muted">They sign in with this number and an SMS code; no password.</p>
    </Section>
  );
}

function DetailsSection({ data }: { data: AdminStallDetail }) {
  const s = data.stall;
  const update = useUpdateStall(s.id);
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const [slug, setSlug] = useState(s.slug);
  const [location, setLocation] = useState(s.location ?? '');
  const [description, setDescription] = useState(s.description ?? '');
  const [tags, setTags] = useState(s.cuisineTags.join(', '));
  const [vegOnly, setVegOnly] = useState(s.isVegOnly);
  const [error, setError] = useState<string>();
  const descriptionId = useId();

  return (
    <Section title="Details">
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          update.mutate(
            {
              name: name.trim(),
              slug: slug.trim(),
              location: location.trim() || null,
              description: description.trim() || null,
              cuisineTags: parseTags(tags),
              isVegOnly: vegOnly,
            },
            {
              onSuccess: () => toast('Details saved', 'success'),
              onError: (err) => setError(errorText(err)),
            },
          );
        }}
      >
        <TextField label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Web address"
          leading="/stalls/"
          value={slug}
          maxLength={40}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          hint="Lowercase letters, numbers and dashes"
        />
        <TextField
          label="Where is it?"
          value={location}
          maxLength={120}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Food types"
          hint="Comma separated, at most 6"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={descriptionId} className="text-sm font-semibold">
            Description
          </label>
          <textarea
            id={descriptionId}
            rows={2}
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-base"
          />
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={vegOnly}
            onChange={(e) => setVegOnly(e.target.checked)}
            className="size-5 accent-(--brand)"
          />
          Vegetarian only
        </label>
        {error && (
          <p role="alert" className="font-medium text-danger sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" loading={update.isPending}>
            Save details
          </Button>
        </div>
      </form>
    </Section>
  );
}

const EMPTY_SETTLEMENT = {
  email: '',
  phone: '',
  legalBusinessName: '',
  businessType: 'proprietorship' as 'individual' | 'proprietorship',
  contactName: '',
  street1: '',
  city: 'Burla',
  state: 'ODISHA',
  postalCode: '768018',
  accountNumber: '',
  ifsc: '',
  beneficiaryName: '',
};

function SettlementSection({ data }: { data: AdminStallDetail }) {
  const { stall } = data;
  const setUp = useSetUpSettlement(stall.id);
  const refresh = useRefreshSettlement(stall.id);
  const testActivate = useTestActivate(stall.id);
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_SETTLEMENT);
  const [error, setError] = useState<string>();
  const [showForm, setShowForm] = useState(stall.routeStatus === 'not_started');
  const active = stall.routeStatus === 'activated';
  const field = (key: keyof typeof EMPTY_SETTLEMENT) => ({
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const typeId = useId();

  return (
    <Section title="UPI payouts">
      <div className="flex flex-wrap items-center gap-2">
        <RouteStatusChip status={stall.routeStatus} />
        <p className="text-sm text-ink-muted">
          {active
            ? 'Razorpay pays this stall its UPI sales. Students can pay by UPI once the stall turns it on.'
            : 'UPI needs a Razorpay settlement account for the stall. Until then, students can only pay cash.'}
        </p>
      </div>
      {data.requirements && data.requirements.length > 0 && (
        <div className="rounded-(--radius-control) bg-warning-soft p-3 text-sm">
          <p className="font-semibold">Razorpay still needs:</p>
          <ul className="list-disc pl-5">
            {data.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {!active && (
        <div className="flex flex-wrap gap-2">
          {stall.razorpayAccountId && (
            <Button
              variant="secondary"
              size="sm"
              loading={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onSuccess: (d) =>
                    toast(
                      d.stall.routeStatus === 'activated'
                        ? 'Settlement account is active'
                        : 'Still in review',
                      'success',
                    ),
                  onError: (err) => toast(errorText(err), 'error'),
                })
              }
            >
              Check status
            </Button>
          )}
          {!showForm && (
            <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
              {stall.razorpayAccountId ? 'Update bank details' : 'Set up'}
            </Button>
          )}
          {data.canTestActivate && (
            <Button
              variant="ghost"
              size="sm"
              loading={testActivate.isPending}
              onClick={() =>
                testActivate.mutate(undefined, {
                  onSuccess: () => toast('Marked active (test mode)', 'success'),
                  onError: (err) => toast(errorText(err), 'error'),
                })
              }
            >
              Mark active (test mode)
            </Button>
          )}
        </div>
      )}
      {!active && showForm && (
        <form
          className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
          noValidate
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            setError(undefined);
            const input: SettlementInput = {
              account: {
                email: form.email.trim(),
                phone: form.phone,
                legalBusinessName: form.legalBusinessName.trim(),
                businessType: form.businessType,
                contactName: form.contactName.trim(),
                address: {
                  street1: form.street1.trim(),
                  city: form.city.trim(),
                  state: form.state.trim(),
                  postalCode: form.postalCode.trim(),
                },
              },
              bank: {
                accountNumber: form.accountNumber.trim(),
                ifsc: form.ifsc.trim().toUpperCase(),
                beneficiaryName: form.beneficiaryName.trim(),
              },
            };
            setUp.mutate(input, {
              onSuccess: () => {
                // Bank details leave the browser's memory as soon as Razorpay has them.
                setForm(EMPTY_SETTLEMENT);
                setShowForm(false);
                toast('Sent to Razorpay for review', 'success');
              },
              onError: (err) => setError(errorText(err)),
            });
          }}
        >
          <p className="text-sm text-ink-muted sm:col-span-2">
            The owner&apos;s details as Razorpay should see them. Bank details go straight to Razorpay; MOM
            keeps only the last 4 digits.
          </p>
          <TextField label="Owner's name" {...field('contactName')} />
          <TextField label="Business name (as on PAN or bank)" {...field('legalBusinessName')} />
          <TextField label="Email" type="email" {...field('email')} />
          <TextField label="Mobile" leading="+91" inputMode="tel" {...field('phone')} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={typeId} className="text-sm font-semibold">
              Business type
            </label>
            <select
              id={typeId}
              value={form.businessType}
              onChange={(e) =>
                setForm((f) => ({ ...f, businessType: e.target.value as 'individual' | 'proprietorship' }))
              }
              className="h-12 rounded-(--radius-control) border border-border bg-surface px-3"
            >
              <option value="proprietorship">Sole proprietorship</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <TextField label="Address" {...field('street1')} />
          <TextField label="City" {...field('city')} />
          <TextField label="State" {...field('state')} />
          <TextField label="PIN code" inputMode="numeric" maxLength={6} {...field('postalCode')} />
          <TextField label="Account holder name" {...field('beneficiaryName')} />
          <TextField label="Bank account number" inputMode="numeric" {...field('accountNumber')} />
          <TextField label="IFSC" hint="Like SBIN0001234" {...field('ifsc')} />
          {error && (
            <p role="alert" className="font-medium text-danger sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={setUp.isPending}>
              Send to Razorpay
            </Button>
            {stall.routeStatus !== 'not_started' && (
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}
