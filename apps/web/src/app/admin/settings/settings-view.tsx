'use client';

import { formatINR } from '@mom/shared';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import {
  bpsToPercent,
  feePreview,
  percentToBps,
  useCancelScheduled,
  useSaveSettings,
  useSettingsOverview,
  type PlatformSettings,
  type SettingsVersion,
} from '@/lib/admin-platform';
import { formatDateTime } from '@/lib/time';

/** Platform settings (spec §6.3 A7): fees, limits, the meter and MOM-wide switches. */
export function PlatformSettingsView() {
  const overview = useSettingsOverview();
  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <EmptyState
        as="h1"
        title="Can't load the settings"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => overview.refetch()}>Try again</Button>}
      />
    );
  }
  const { current, scheduled, history } = overview.data;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Settings</h1>
        <p className="text-ink-muted">
          Changes apply to orders placed after they take effect; orders already placed keep their fees.
        </p>
      </div>
      {scheduled.length > 0 && <Scheduled rows={scheduled} />}
      <SettingsForm
        // Start again from the settings in force after any save, schedule or cancel.
        key={`${current.id}-${scheduled.map((s) => s.id).join(',')}`}
        current={current}
        blocked={scheduled.length > 0}
      />
      <History rows={history} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-display text-xl font-bold">{title}</legend>
      {hint && <p className="-mt-2 text-sm text-ink-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

const num = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

function SettingsForm({ current, blocked }: { current: PlatformSettings; blocked: boolean }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [f, setF] = useState({
    platformFee: bpsToPercent(current.platformFeeBps),
    cashFee: bpsToPercent(current.cashFeeBps),
    maxOpenCashOrders: String(current.maxOpenCashOrders),
    cashStrikeLimit: String(current.cashStrikeLimit),
    orderExpiryMinutes: String(current.orderExpiryMinutes),
    low: String(current.congestionLowMaxMinutes),
    moderate: String(current.congestionModerateMaxMinutes),
    cashEnabledGlobally: current.cashEnabledGlobally,
    orderingPaused: current.orderingPaused,
    when: 'now' as 'now' | 'later',
    date: '',
    time: '06:00',
  });
  const [error, setError] = useState<string>();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const platformBps = percentToBps(f.platformFee);
  const cashBps = percentToBps(f.cashFee);
  const preview = platformBps !== null && cashBps !== null ? feePreview(platformBps, cashBps) : null;

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          if (platformBps === null || cashBps === null) {
            setError('Enter fees as a percentage, like 1 or 1.5');
            return;
          }
          if (f.when === 'later' && !f.date) {
            setError('Pick the date the change starts');
            return;
          }
          save.mutate(
            {
              platformFeeBps: platformBps,
              cashFeeBps: cashBps,
              maxOpenCashOrders: num(f.maxOpenCashOrders),
              cashStrikeLimit: num(f.cashStrikeLimit),
              orderExpiryMinutes: num(f.orderExpiryMinutes),
              congestionLowMaxMinutes: num(f.low),
              congestionModerateMaxMinutes: num(f.moderate),
              cashEnabledGlobally: f.cashEnabledGlobally,
              orderingPaused: f.orderingPaused,
              // India time, whatever the admin's computer is set to.
              ...(f.when === 'later' ? { effectiveFrom: `${f.date}T${f.time}:00+05:30` } : {}),
            },
            {
              onSuccess: () => toast(f.when === 'later' ? 'Change scheduled' : 'Settings saved', 'success'),
              onError: (err) => {
                const message = err instanceof ApiError ? err.message : 'That didn’t save. Try again.';
                // Field problems come back as details; show the first one in words.
                const details =
                  err instanceof ApiError && Array.isArray(err.details)
                    ? (err.details as Array<{ message: string }>)
                    : [];
                setError(details[0]?.message ?? message);
              },
            },
          );
        }}
      >
        <Section title="Fees" hint="Shown to students as separate lines on the bill.">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Platform fee, % (every order)"
              inputMode="decimal"
              value={f.platformFee}
              onChange={(e) => set('platformFee', e.target.value)}
            />
            <TextField
              label="Cash handling fee, % (cash orders)"
              inputMode="decimal"
              value={f.cashFee}
              onChange={(e) => set('cashFee', e.target.value)}
            />
          </div>
          <p className="rounded-(--radius-control) bg-surface-2 px-3 py-2 text-sm" aria-live="polite">
            {preview ? (
              <>
                On a ₹100 order: UPI{' '}
                <span className="tabular font-semibold">{formatINR(preview.upi.totalPaise)}</span> (fee{' '}
                {formatINR(preview.upi.platformFeePaise)}), cash{' '}
                <span className="tabular font-semibold">{formatINR(preview.cash.totalPaise)}</span> (fees{' '}
                {formatINR(preview.cash.platformFeePaise)} + {formatINR(preview.cash.cashFeePaise)}).
              </>
            ) : (
              'Enter both fees to see the bill on ₹100.'
            )}
          </p>
        </Section>

        <Section title="Limits">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="Open cash orders per student"
              inputMode="numeric"
              value={f.maxOpenCashOrders}
              onChange={(e) => set('maxOpenCashOrders', e.target.value)}
              hint="0 to 20"
            />
            <TextField
              label="Cash no-shows before cash is blocked"
              inputMode="numeric"
              value={f.cashStrikeLimit}
              onChange={(e) => set('cashStrikeLimit', e.target.value)}
              hint="1 to 20"
            />
            <TextField
              label="Minutes to pay by UPI"
              inputMode="numeric"
              value={f.orderExpiryMinutes}
              onChange={(e) => set('orderExpiryMinutes', e.target.value)}
              hint="5 to 60"
            />
          </div>
        </Section>

        <Section title="Busy meter" hint="The wait students see on each stall card.">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Not busy up to (minutes)"
              inputMode="numeric"
              value={f.low}
              onChange={(e) => set('low', e.target.value)}
            />
            <TextField
              label="Moderately busy up to (minutes)"
              inputMode="numeric"
              value={f.moderate}
              onChange={(e) => set('moderate', e.target.value)}
              hint="Longer waits show as Busy"
            />
          </div>
        </Section>

        <Section title="Switches for every stall">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Cash payments</p>
              <p className="text-sm text-ink-muted">Off: no stall takes cash, whatever its own setting.</p>
            </div>
            <Switch
              label="Cash payments for every stall"
              on={f.cashEnabledGlobally}
              onToggle={() => set('cashEnabledGlobally', !f.cashEnabledGlobally)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Pause all ordering</p>
              <p className="text-sm text-ink-muted">
                On: every stall shows as paused and no new orders are taken. Orders already placed carry on.
              </p>
            </div>
            <Switch
              label="Pause all ordering"
              on={f.orderingPaused}
              onText="Paused"
              offText="Off"
              onToggle={() => set('orderingPaused', !f.orderingPaused)}
            />
          </div>
        </Section>

        <Section title="When">
          <div role="radiogroup" aria-label="When the change starts" className="flex flex-wrap gap-4">
            {(
              [
                ['now', 'Now'],
                ['later', 'Later (e.g. new fees from Monday)'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="when"
                  checked={f.when === value}
                  onChange={() => set('when', value)}
                  className="size-5 accent-(--brand)"
                />
                {label}
              </label>
            ))}
          </div>
          {f.when === 'later' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Date"
                type="date"
                value={f.date}
                onChange={(e) => set('date', e.target.value)}
              />
              <TextField
                label="Time (India)"
                type="time"
                value={f.time}
                onChange={(e) => set('time', e.target.value)}
              />
            </div>
          )}
        </Section>

        {error && (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        )}
        {blocked && (
          <p className="text-sm text-ink-muted">
            Cancel the scheduled change above before saving another one.
          </p>
        )}
        <div>
          <Button type="submit" size="lg" loading={save.isPending} disabled={blocked}>
            {f.when === 'later' ? 'Schedule change' : 'Save settings'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Scheduled({ rows }: { rows: SettingsVersion[] }) {
  const cancel = useCancelScheduled();
  const toast = useToast();
  return (
    <Card className="flex flex-col gap-2 border-warning p-4">
      <h2 className="font-display text-xl font-bold">Scheduled</h2>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
          <p>
            From <span className="font-semibold">{formatDateTime(new Date(r.effectiveFrom))}</span>: platform
            fee {bpsToPercent(r.platformFeeBps)}%, cash fee {bpsToPercent(r.cashFeeBps)}%
            {!r.cashEnabledGlobally && ', cash off'}
            {r.orderingPaused && ', ordering paused'}
          </p>
          <ConfirmButton
            confirmLabel="Confirm cancel"
            loading={cancel.isPending}
            onConfirm={() =>
              cancel.mutate(r.id, {
                onSuccess: () => toast('Scheduled change cancelled', 'success'),
                onError: (err) => toast(err instanceof ApiError ? err.message : 'Couldn’t cancel', 'error'),
              })
            }
          >
            Cancel change
          </ConfirmButton>
        </div>
      ))}
    </Card>
  );
}

function History({ rows }: { rows: SettingsVersion[] }) {
  return (
    <section aria-labelledby="history" className="flex flex-col gap-2">
      <h2 id="history" className="font-display text-xl font-bold">
        Earlier versions
      </h2>
      <DataTable
        caption="Settings versions, newest first"
        rows={rows}
        rowKey={(r) => String(r.id)}
        columns={[
          { key: 'from', header: 'From', cell: (r) => formatDateTime(new Date(r.effectiveFrom)) },
          { key: 'fee', header: 'Platform fee', cell: (r) => `${bpsToPercent(r.platformFeeBps)}%` },
          { key: 'cash', header: 'Cash fee', cell: (r) => `${bpsToPercent(r.cashFeeBps)}%` },
          {
            key: 'switches',
            header: 'Switches',
            cell: (r) =>
              [!r.cashEnabledGlobally && 'cash off', r.orderingPaused && 'ordering paused']
                .filter(Boolean)
                .join(', ') || '—',
          },
        ]}
      />
      <p className="text-sm text-ink-muted">Who changed what is in the audit log.</p>
    </section>
  );
}
