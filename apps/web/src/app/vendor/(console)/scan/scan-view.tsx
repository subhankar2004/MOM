'use client';

import { formatINR } from '@mom/shared';
import { CheckCircle2, Delete, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { QrScanner } from '@/components/vendor/qr-scanner';
import { ApiError } from '@/lib/api-client';
import { playTones } from '@/lib/chime';
import { cn } from '@/lib/cn';
import { useCurrentStall } from '@/lib/vendor-stall';
import { useHandOver, usePickupVerify, type PickupCheck } from '@/lib/vendor-orders';

function buzz(ok: boolean) {
  playTones(ok ? [1320] : [330, 260], 0.15);
  try {
    navigator.vibrate?.(ok ? 80 : [120, 80, 120]);
  } catch {
    /* not supported */
  }
}

/**
 * Pickup counter (spec §6.2 V4): scan the student's QR (or type token + pickup code),
 * see a big ✅/❌, then hand over in one tap — for cash, "Cash received ₹X" in the same tap.
 */
export function ScanView() {
  const { current: stall } = useCurrentStall();
  const verify = usePickupVerify(stall.id);
  const handOver = useHandOver(stall.id);
  const [result, setResult] = useState<PickupCheck | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  function check(input: { qr: string } | { tokenNo: number; pickupCode: string }) {
    setError(null);
    setDone(null);
    verify.mutate(input, {
      onSuccess: (r) => {
        setResult(r);
        buzz(r.valid);
        // Move focus to the result so screen readers and keyboards land on it.
        requestAnimationFrame(() => resultRef.current?.focus());
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Couldn’t check that. Try again.'),
    });
  }

  function reset() {
    setResult(null);
    setDone(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Scan</h1>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <QrScanner paused={result !== null || verify.isPending} onCode={(qr) => check({ qr })} />
          {!result && <ManualEntry busy={verify.isPending} onCheck={check} />}
          {error && (
            <p role="alert" className="font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        {result && (
          <div ref={resultRef} tabIndex={-1} className="outline-none" aria-live="assertive">
            <ResultCard
              result={result}
              done={done}
              busy={handOver.isPending}
              onHandOver={(cashReceived) =>
                result.valid &&
                handOver.mutate(
                  { orderId: result.order.id, cashReceived },
                  {
                    onSuccess: ({ order }) => setDone(`Token #${order.tokenNo} handed over`),
                    onError: (err) =>
                      setError(err instanceof ApiError ? err.message : 'That didn’t go through. Try again.'),
                  },
                )
              }
              onNext={reset}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  done,
  busy,
  onHandOver,
  onNext,
}: {
  result: PickupCheck;
  done: string | null;
  busy: boolean;
  onHandOver: (cashReceived: boolean) => void;
  onNext: () => void;
}) {
  const order = result.order;
  const ok = result.valid;
  return (
    <section
      aria-label={ok ? 'Order verified' : 'Order not valid'}
      className={cn(
        'flex flex-col gap-4 rounded-(--radius-card) border-4 bg-surface p-4',
        ok ? 'border-success' : 'border-danger',
      )}
    >
      <div className="flex items-center gap-3">
        {ok ? (
          <CheckCircle2 size={48} aria-hidden className="shrink-0 text-success" />
        ) : (
          <XCircle size={48} aria-hidden className="shrink-0 text-danger" />
        )}
        <div>
          {order && <p className="font-display text-4xl font-black tabular">#{order.tokenNo}</p>}
          <p className={cn('text-lg font-semibold', ok ? 'text-success' : 'text-danger')}>
            {ok ? (done ? 'Handed over' : 'Valid order') : result.message}
          </p>
        </div>
      </div>

      {ok && result.warning === 'not_ready' && !done && (
        <StatusChip tone="warning">Not marked ready yet: check the food is done</StatusChip>
      )}

      {order && (
        <>
          <ul className="flex flex-col gap-1 text-lg">
            {order.items.map((i) => (
              <li key={i.name}>
                <span className="tabular font-bold">{i.quantity} ×</span> {i.name}
              </li>
            ))}
          </ul>
          {order.note && (
            <p className="rounded-(--radius-control) bg-haldi-soft px-3 py-2">Note: {order.note}</p>
          )}
          <p className="text-ink-muted">
            {order.paymentMethod === 'upi'
              ? `UPI paid · ${formatINR(order.totalPaise)}`
              : order.paymentStatus === 'paid_cash'
                ? `Cash paid · ${formatINR(order.totalPaise)}`
                : `Cash due · ${formatINR(order.totalPaise)}`}
          </p>
        </>
      )}

      {ok && !done && (
        <Button size="lg" fullWidth loading={busy} onClick={() => onHandOver(result.cashDuePaise > 0)}>
          {result.cashDuePaise > 0
            ? `Cash received ${formatINR(result.cashDuePaise)} · Hand over`
            : 'Hand over'}
        </Button>
      )}
      {done && (
        <p role="status" className="font-semibold">
          {done}
        </p>
      )}
      <Button variant={ok && !done ? 'ghost' : 'primary'} size="lg" fullWidth onClick={onNext}>
        {done || !ok ? 'Scan next' : 'Cancel'}
      </Button>
    </section>
  );
}

/** Token number, then the 4-digit pickup code; checks itself on the 4th digit. */
function ManualEntry({
  busy,
  onCheck,
}: {
  busy: boolean;
  onCheck: (input: { tokenNo: number; pickupCode: string }) => void;
}) {
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [field, setField] = useState<'token' | 'code'>('token');

  const submit = (finalCode = code) => {
    if (token && /^\d{4}$/.test(finalCode)) {
      onCheck({ tokenNo: Number(token), pickupCode: finalCode });
      setToken('');
      setCode('');
      setField('token');
    }
  };
  const type = (digit: string) => {
    if (field === 'token') {
      setToken((t) => (t.length < 4 ? (t + digit).replace(/^0+/, '') : t));
    } else {
      const next = (code + digit).slice(0, 4);
      setCode(next);
      if (next.length === 4) submit(next);
    }
  };
  const back = () => (field === 'token' ? setToken((t) => t.slice(0, -1)) : setCode((c) => c.slice(0, -1)));

  const box = (which: 'token' | 'code', label: string, value: string, max: number) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        value={value}
        inputMode="none"
        autoComplete="off"
        maxLength={max}
        size={4}
        onFocus={() => setField(which)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, max);
          if (which === 'token') setToken(digits.replace(/^0+/, ''));
          else {
            setCode(digits);
            if (digits.length === 4) submit(digits);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (which === 'token' && token) setField('code');
            else submit();
          }
        }}
        className={cn(
          'tabular h-14 w-full min-w-0 rounded-(--radius-control) border-2 bg-surface px-3 text-center font-display text-3xl font-bold tracking-widest',
          field === which ? 'border-brand' : 'border-border',
        )}
      />
    </label>
  );

  return (
    <section aria-label="Type token and pickup code" className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        No QR? Type the token, then the student&apos;s 4-digit pickup code.
      </p>
      <div className="flex gap-3">
        {box('token', 'Token', token, 4)}
        {box('code', 'Pickup code', code, 4)}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} variant="secondary" size="lg" disabled={busy} onClick={() => type(d)}>
            {d}
          </Button>
        ))}
        <Button variant="ghost" size="lg" disabled={busy} onClick={back} aria-label="Delete digit">
          <Delete size={22} aria-hidden />
        </Button>
        <Button variant="secondary" size="lg" disabled={busy} onClick={() => type('0')}>
          0
        </Button>
        {field === 'token' ? (
          <Button size="lg" disabled={!token || busy} onClick={() => setField('code')}>
            Next
          </Button>
        ) : (
          <Button size="lg" disabled={code.length !== 4 || busy} loading={busy} onClick={() => submit()}>
            Check
          </Button>
        )}
      </div>
    </section>
  );
}
