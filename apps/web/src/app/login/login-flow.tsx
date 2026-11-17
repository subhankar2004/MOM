'use client';

import type { MeResponse } from '@mom/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { OtpInput } from '@/components/auth/otp-input';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { homeFor, safeNextPath } from '@/lib/roles';
import { useSession, useSetSessionUser, type SessionUser } from '@/lib/session';

type Step = 'phone' | 'code' | 'name';

interface VerifyResponse extends MeResponse {
  isNewUser: boolean;
}

/** Turns an API error into one sentence for the person, preferring the field message. */
function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  const first = Array.isArray(error.details)
    ? (error.details[0] as { message?: string } | undefined)
    : undefined;
  return error.code === 'VALIDATION_ERROR' && first?.message ? first.message : error.message;
}

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : digits;
}

function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const session = useSession();
  const setSessionUser = useSetSessionUser();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [resendAt, setResendAt] = useState<number | null>(null);
  const secondsLeft = useSecondsLeft(resendAt);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorId = useId();

  const goHome = (user: SessionUser) => router.replace(next ?? homeFor(user.role));

  // Already signed in (and named)? Skip the form.
  useEffect(() => {
    if (step === 'phone' && session.user?.name) router.replace(next ?? homeFor(session.user.role));
  }, [session.user, step, next, router]);

  // Move focus to each step's heading so screen readers announce the change.
  useEffect(() => {
    if (step !== 'code') headingRef.current?.focus();
  }, [step]);

  const requestCode = useMutation({
    mutationFn: () =>
      apiRequest<{ expiresInSeconds: number; resendAfterSeconds: number }>('/v1/auth/otp/request', {
        method: 'POST',
        body: { phone },
      }),
    onSuccess: (res) => {
      setCode('');
      setResendAt(Date.now() + res.resendAfterSeconds * 1000);
      setStep('code');
    },
    onError: (err) => {
      const retry =
        err instanceof ApiError ? (err.details as { retryAfterSeconds?: number } | undefined) : undefined;
      if (retry?.retryAfterSeconds && retry.retryAfterSeconds <= 60) {
        setResendAt(Date.now() + retry.retryAfterSeconds * 1000);
      }
    },
  });

  const verify = useMutation({
    mutationFn: (otp: string) =>
      apiRequest<VerifyResponse>('/v1/auth/otp/verify', { method: 'POST', body: { phone, code: otp } }),
    onSuccess: ({ user, isNewUser }) => {
      setSessionUser(user);
      if (isNewUser) setStep('name');
      else goHome(user);
    },
    onError: () => setCode(''),
  });

  const saveName = useMutation({
    mutationFn: () => apiRequest<MeResponse>('/v1/me', { method: 'PATCH', body: { name } }),
    onSuccess: ({ user }) => {
      setSessionUser(user);
      goHome(user);
    },
  });

  function submitPhone(e: FormEvent) {
    e.preventDefault();
    requestCode.mutate();
  }

  if (step === 'phone') {
    const error = requestCode.isError ? messageOf(requestCode.error) : undefined;
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-6" noValidate>
        <div className="flex flex-col gap-2">
          <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-black outline-none">
            Sign in to order
          </h1>
          <p className="text-ink-muted">We&apos;ll text a 6-digit code to your mobile number.</p>
        </div>
        <TextField
          label="Mobile number"
          leading="+91"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={error}
          maxLength={16}
          required
          autoFocus
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={requestCode.isPending}
          disabled={phone.replace(/\D/g, '').length < 10 || secondsLeft > 0}
        >
          {secondsLeft > 0 ? `Send code in ${secondsLeft}s` : 'Send code'}
        </Button>
        <Link
          href="/"
          className="text-center font-semibold text-ink-muted underline-offset-4 hover:underline"
        >
          Browse stalls without signing in
        </Link>
      </form>
    );
  }

  if (step === 'code') {
    const error = verify.isError
      ? messageOf(verify.error)
      : requestCode.isError
        ? messageOf(requestCode.error)
        : undefined;
    const codeDead =
      verify.error instanceof ApiError &&
      ['OTP_EXPIRED', 'OTP_TOO_MANY_ATTEMPTS'].includes(verify.error.code);
    return (
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => {
            setStep('phone');
            verify.reset();
          }}
          className="inline-flex items-center gap-1 self-start font-semibold text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={18} aria-hidden /> Change number
        </button>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-black">Enter the code</h1>
          <p className="text-ink-muted">
            Sent to <span className="tabular font-semibold text-ink">{formatPhone(phone)}</span>. It works for
            5 minutes.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) verify.mutate(code);
          }}
          className="flex flex-col gap-4"
        >
          <OtpInput
            value={code}
            onChange={(c) => {
              setCode(c);
              if (verify.isError) verify.reset();
            }}
            onComplete={(c) => verify.mutate(c)}
            invalid={verify.isError}
            disabled={verify.isPending || verify.isSuccess}
            describedBy={error ? errorId : undefined}
          />
          <p id={errorId} role="alert" className="min-h-6 text-sm font-medium text-danger">
            {error}
          </p>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={verify.isPending || verify.isSuccess}
            disabled={code.length < 6}
          >
            Sign in
          </Button>
        </form>
        <div className="text-center text-sm">
          {secondsLeft > 0 ? (
            <span className="text-ink-muted" aria-live="off">
              Didn&apos;t get it? You can ask for a new code in{' '}
              <span className="tabular">{secondsLeft}s</span>
            </span>
          ) : (
            <Button
              variant={codeDead ? 'primary' : 'ghost'}
              size="sm"
              loading={requestCode.isPending}
              onClick={() => {
                verify.reset();
                requestCode.mutate();
              }}
            >
              Send a new code
            </Button>
          )}
        </div>
      </div>
    );
  }

  const nameError = saveName.isError ? messageOf(saveName.error) : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        saveName.mutate();
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-black outline-none">
          What&apos;s your name?
        </h1>
        <p className="text-ink-muted">The stall calls this out when your food is ready.</p>
      </div>
      <TextField
        label="Your name"
        autoComplete="name"
        placeholder="Asha Mohanty"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={nameError}
        maxLength={60}
        required
        autoFocus
      />
      <Button type="submit" size="lg" fullWidth loading={saveName.isPending} disabled={!name.trim()}>
        Continue
      </Button>
    </form>
  );
}
