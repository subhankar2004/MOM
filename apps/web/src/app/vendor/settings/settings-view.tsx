'use client';

import { Banknote, ImagePlus, Plus, Settings, Smartphone, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusChip } from '@/components/ui/status-chip';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatTime, opensLabel } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { uploadStallPhoto } from '@/lib/vendor-menu';
import {
  copyDayToAll,
  hoursProblems,
  useReplaceHours,
  useStallSettings,
  useUpdateSettings,
  WEEKDAYS,
  type HoursSlot,
  type SettingsPatch,
  type StallSettings,
} from '@/lib/vendor-settings';
import { useCurrentStall } from '@/lib/vendor-stall';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t save. Check your connection and try again.';

/** Stall settings (spec §6.2 V6, V7). Owners only: counter staff see a note instead. */
export function SettingsView() {
  const { current: stall } = useCurrentStall();
  if (stall.memberRole === 'staff') {
    return (
      <EmptyState
        as="h1"
        icon={<Settings size={36} aria-hidden />}
        title="Stall settings"
        description="Only the stall owner can change hours, payments and the stall's details."
      />
    );
  }
  return <SettingsPage stallId={stall.id} />;
}

function SettingsPage({ stallId }: { stallId: string }) {
  const query = useStallSettings(stallId);
  const update = useUpdateSettings(stallId);
  const toast = useToast();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        as="h1"
        title="Can't load your settings"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => query.refetch()}>Try again</Button>}
      />
    );
  }

  const data = query.data;
  const save = (patch: SettingsPatch, done?: string) =>
    update.mutate(patch, {
      onSuccess: () => done && toast(done, 'success'),
      onError: (err) => toast(errorText(err), 'error'),
    });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Settings</h1>
      <StatusSection data={data} save={save} busy={update.isPending} />
      <PaymentsSection data={data} save={save} busy={update.isPending} />
      <HoursSection key={JSON.stringify(data.hours)} stallId={stallId} hours={data.hours} />
      <KitchenSection
        key={`${data.settings.avgPrepMinutes}-${data.settings.parallelCapacity}`}
        data={data}
        save={save}
        busy={update.isPending}
      />
      <ProfileSection
        key={`${data.settings.photoKey}-${data.settings.description}-${data.settings.location}`}
        stallId={stallId}
        data={data}
        save={save}
        busy={update.isPending}
      />
    </div>
  );
}

type Save = (patch: SettingsPatch, done?: string) => void;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-(--radius-card) border border-border bg-surface p-4">
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** What students see right now, in words. */
function statusText(
  data: StallSettings,
  now: Date,
): { chip: string; tone: 'success' | 'warning' | 'neutral'; line: string } {
  const a = data.availability;
  if (a.state === 'paused')
    return { chip: 'Paused', tone: 'warning', line: 'Open, but not taking new orders.' };
  if (a.state === 'open') {
    if (a.reason === 'override')
      return { chip: 'Open', tone: 'success', line: 'Opened by you. Back to your hours at midnight.' };
    return {
      chip: 'Open',
      tone: 'success',
      line: a.closesAt
        ? `Open until ${formatTime(new Date(a.closesAt))}, by your hours.`
        : 'Open by your hours.',
    };
  }
  if (a.reason === 'inactive') {
    return {
      chip: 'Closed',
      tone: 'neutral',
      line:
        data.settings.status === 'suspended'
          ? 'Suspended by the MOM team. Students can’t see your stall.'
          : 'Not live yet. The MOM team will switch your stall on.',
    };
  }
  if (a.reason === 'override')
    return { chip: 'Closed', tone: 'neutral', line: 'Closed by you. Back to your hours at midnight.' };
  const next = a.nextOpensAt ? new Date(a.nextOpensAt) : null;
  return {
    chip: 'Closed',
    tone: 'neutral',
    line: next
      ? `${opensLabel(next, now)}, by your hours.`
      : 'No opening hours set. Add them below, or open now.',
  };
}

const MODES: Array<{ value: boolean | null; label: string }> = [
  { value: null, label: 'Follow hours' },
  { value: true, label: 'Open now' },
  { value: false, label: 'Closed now' },
];

function StatusSection({ data, save, busy }: { data: StallSettings; save: Save; busy: boolean }) {
  const now = useNow(30_000);
  const status = statusText(data, now);
  const s = data.settings;
  return (
    <Section title="Open or closed">
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <StatusChip tone={status.tone}>{status.chip}</StatusChip>
        <p>{status.line}</p>
      </div>
      <div
        role="radiogroup"
        aria-label="Opening"
        className="mt-4 grid grid-cols-3 gap-1 rounded-(--radius-control) bg-surface-2 p-1"
      >
        {MODES.map((m) => {
          const checked = s.isOpenOverride === m.value;
          return (
            <button
              key={m.label}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={busy}
              onClick={() => !checked && save({ isOpenOverride: m.value })}
              className={cn(
                'min-h-11 rounded-(--radius-control) px-2 text-sm font-semibold transition-colors',
                checked ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="font-semibold">Take new orders</p>
          <p className="text-sm text-ink-muted">
            Pause when the kitchen is full. Orders already placed carry on.
          </p>
        </div>
        <Switch
          label="Take new orders"
          on={s.acceptingOrders}
          offText="Paused"
          disabled={busy}
          onToggle={() =>
            save(
              { acceptingOrders: !s.acceptingOrders },
              s.acceptingOrders ? 'New orders paused' : 'Taking new orders again',
            )
          }
        />
      </div>
    </Section>
  );
}

function PaymentsSection({ data, save, busy }: { data: StallSettings; save: Save; busy: boolean }) {
  const s = data.settings;
  const upiReady = s.routeStatus === 'activated';
  const upiNote: Record<StallSettings['settings']['routeStatus'], string> = {
    activated: 'Paid online; settled to your bank account.',
    not_started: 'Settlement account pending. The MOM team will set it up with you.',
    pending: 'Settlement account pending. Razorpay is checking your details.',
    rejected: 'Settlement account needs attention. Contact the MOM team.',
    suspended: 'Settlement account suspended. Contact the MOM team.',
  };
  return (
    <Section title="Payment methods" description="What students can pay with at checkout.">
      <ul className="flex flex-col divide-y divide-border">
        <li className="flex items-center gap-3 pb-3">
          <Smartphone size={22} aria-hidden className="shrink-0 text-ink-muted" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">UPI</p>
            <p className={cn('text-sm', upiReady ? 'text-ink-muted' : 'text-warning')}>
              {upiNote[s.routeStatus]}
            </p>
          </div>
          <Switch
            label="Accept UPI"
            on={s.upiEnabled && upiReady}
            disabled={busy || (!upiReady && !s.upiEnabled)}
            onToggle={() =>
              save({ upiEnabled: !s.upiEnabled }, s.upiEnabled ? 'UPI turned off' : 'UPI turned on')
            }
          />
        </li>
        <li className="flex items-center gap-3 pt-3">
          <Banknote size={22} aria-hidden className="shrink-0 text-ink-muted" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Cash</p>
            <p className="text-sm text-ink-muted">Paid at the counter; students pay a small cash fee.</p>
          </div>
          <Switch
            label="Accept cash"
            on={s.cashEnabled}
            disabled={busy}
            onToggle={() =>
              save({ cashEnabled: !s.cashEnabled }, s.cashEnabled ? 'Cash turned off' : 'Cash turned on')
            }
          />
        </li>
      </ul>
    </Section>
  );
}

function HoursSection({ stallId, hours }: { stallId: string; hours: HoursSlot[] }) {
  const [slots, setSlots] = useState(hours);
  const replace = useReplaceHours(stallId);
  const toast = useToast();
  const problems = hoursProblems(slots);
  const dirty = JSON.stringify(slots) !== JSON.stringify(hours);

  const change = (index: number, patch: Partial<HoursSlot>) =>
    setSlots((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const sorted = (list: HoursSlot[]) =>
    [...list].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));

  return (
    <Section
      title="Opening hours"
      description="India time. A slot that closes after midnight (like 6 PM to 1 AM) is fine."
    >
      <ul className="flex flex-col divide-y divide-border">
        {WEEKDAYS.map((day, d) => {
          const weekday = d + 1;
          const daySlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.weekday === weekday);
          return (
            <li key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <p className="w-28 shrink-0 pt-2.5 font-semibold">{day}</p>
              <div className="flex flex-1 flex-col gap-2">
                {daySlots.length === 0 && <p className="pt-2.5 text-sm text-ink-muted">Closed</p>}
                {daySlots.map(({ s, i }) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${day} opens`}
                        value={s.opensAt}
                        onChange={(e) => change(i, { opensAt: e.target.value })}
                        className="h-11 min-w-0 flex-1 rounded-(--radius-control) border border-border bg-surface px-2"
                      />
                      <span aria-hidden className="text-ink-muted">
                        to
                      </span>
                      <input
                        type="time"
                        aria-label={`${day} closes`}
                        value={s.closesAt}
                        onChange={(e) => change(i, { closesAt: e.target.value })}
                        className="h-11 min-w-0 flex-1 rounded-(--radius-control) border border-border bg-surface px-2"
                      />
                      <IconButton
                        label={`Remove ${day} ${s.opensAt}–${s.closesAt}`}
                        icon={<Trash2 size={18} aria-hidden />}
                        onClick={() => setSlots((all) => all.filter((_, j) => j !== i))}
                      />
                    </div>
                    {problems.get(i) && <p className="text-sm font-medium text-danger">{problems.get(i)}</p>}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus size={16} aria-hidden />}
                    onClick={() =>
                      setSlots((all) => {
                        const last = all.filter((s) => s.weekday === weekday).at(-1);
                        const next = last
                          ? { weekday, opensAt: last.closesAt, closesAt: '22:00' }
                          : { weekday, opensAt: '08:00', closesAt: '20:00' };
                        return [...all, next];
                      })
                    }
                  >
                    Add hours
                    <span className="sr-only"> on {day}</span>
                  </Button>
                  {daySlots.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSlots((all) => copyDayToAll(all, weekday))}
                    >
                      Use for every day
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={!dirty || problems.size > 0}
          loading={replace.isPending}
          onClick={() =>
            replace.mutate(sorted(slots), {
              onSuccess: () => toast('Opening hours saved', 'success'),
              onError: (err) => toast(errorText(err), 'error'),
            })
          }
        >
          Save hours
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setSlots(hours)}>
            Undo changes
          </Button>
        )}
      </div>
    </Section>
  );
}

function KitchenSection({ data, save, busy }: { data: StallSettings; save: Save; busy: boolean }) {
  const [prep, setPrep] = useState(String(data.settings.avgPrepMinutes));
  const [capacity, setCapacity] = useState(String(data.settings.parallelCapacity));
  const prepN = Number(prep);
  const capN = Number(capacity);
  const prepError =
    Number.isInteger(prepN) && prepN >= 1 && prepN <= 120 ? undefined : 'Between 1 and 120 minutes';
  const capError = Number.isInteger(capN) && capN >= 1 && capN <= 50 ? undefined : 'Between 1 and 50';
  const dirty = prepN !== data.settings.avgPrepMinutes || capN !== data.settings.parallelCapacity;
  return (
    <Section title="Kitchen speed" description="Used to show students how long they'll wait.">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!prepError && !capError)
            save({ avgPrepMinutes: prepN, parallelCapacity: capN }, 'Kitchen speed saved');
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Minutes to prepare an order"
            inputMode="numeric"
            value={prep}
            onChange={(e) => setPrep(e.target.value.replace(/\D/g, ''))}
            error={prepError}
          />
          <TextField
            label="Orders you can cook at once"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))}
            error={capError}
          />
        </div>
        <div>
          <Button type="submit" disabled={!dirty || Boolean(prepError || capError)} loading={busy && dirty}>
            Save kitchen speed
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ProfileSection({
  stallId,
  data,
  save,
  busy,
}: {
  stallId: string;
  data: StallSettings;
  save: Save;
  busy: boolean;
}) {
  const s = data.settings;
  const [description, setDescription] = useState(s.description ?? '');
  const [location, setLocation] = useState(s.location ?? '');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { photo: useId(), description: useId() };
  const dirty = description.trim() !== (s.description ?? '') || location.trim() !== (s.location ?? '');

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const { key } = await uploadStallPhoto(stallId, file, 'cover');
      save({ photoKey: key }, 'Stall photo updated');
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The photo couldn't be uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Section title="Stall details" description="Shown to students on your stall's page.">
      <div className="flex items-center gap-3">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-(--radius-control) border border-border bg-surface-2">
          {s.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.photoUrl} alt="Stall photo" className="size-full object-cover" />
          ) : (
            <ImagePlus size={28} aria-hidden className="absolute inset-0 m-auto text-ink-muted" />
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
              <Spinner size={22} label="Uploading photo" />
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          <span id={ids.photo} className="text-sm font-semibold">
            Stall photo
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-labelledby={ids.photo}
            className="sr-only"
            onChange={(e) => void choosePhoto(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={uploading || busy}
              onClick={() => fileRef.current?.click()}
            >
              {s.photoUrl ? 'Replace photo' : 'Add photo'}
            </Button>
            {s.photoUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={uploading || busy}
                onClick={() => save({ photoKey: null }, 'Stall photo removed')}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      {photoError && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {photoError}
        </p>
      )}
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(
            { description: description.trim() || null, location: location.trim() || null },
            'Details saved',
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.description} className="text-sm font-semibold">
            Description
          </label>
          <textarea
            id={ids.description}
            value={description}
            maxLength={300}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-base"
          />
        </div>
        <TextField
          label="Where to find you"
          hint="For example: Near the library gate"
          value={location}
          maxLength={120}
          onChange={(e) => setLocation(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={!dirty} loading={busy && dirty}>
            Save details
          </Button>
        </div>
      </form>
    </Section>
  );
}
