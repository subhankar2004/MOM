'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

const LENGTH = 6;

/**
 * Six one-digit boxes for the login code.
 * - typing moves forward, Backspace moves back, arrow keys move between boxes
 * - pasting "482913" (or "Your code is 482913") fills every box
 * - `autocomplete="one-time-code"` lets iOS/Android offer the code from the SMS
 * - on Android Chrome, the Web OTP API fills it automatically when supported
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  describedBy,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  function set(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(clean);
    if (clean.length === LENGTH) onComplete(clean);
    return clean;
  }

  useEffect(() => {
    refs.current[0]?.focus();
    // Web OTP API (Android Chrome): reads the code from the SMS with the user's consent.
    if (!('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const code = (cred as (Credential & { code?: string }) | null)?.code;
        if (code) set(code);
      })
      .catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the step appears
  }, []);

  function onInput(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '');
    if (!digit) return;
    if (digit.length > 1) {
      // autofill / fast typing delivered several digits into one box
      const clean = set(value.slice(0, index) + digit);
      refs.current[Math.min(clean.length, LENGTH - 1)]?.focus();
      return;
    }
    const next = (value.slice(0, index) + digit + value.slice(index + 1)).slice(0, LENGTH);
    set(next);
    refs.current[Math.min(index + 1, LENGTH - 1)]?.focus();
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').match(/\d{6}/)?.[0] ?? e.clipboardData.getData('text');
    e.preventDefault();
    const clean = set(pasted);
    refs.current[Math.min(clean.length, LENGTH - 1)]?.focus();
  }

  return (
    <div
      className="flex justify-between gap-2"
      role="group"
      aria-label="6-digit code"
      aria-describedby={describedBy}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? LENGTH : 1}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          aria-invalid={invalid || undefined}
          className={cn(
            'tabular h-14 w-full min-w-0 rounded-(--radius-control) border-2 bg-surface text-center font-display text-3xl font-bold text-ink',
            'focus:border-brand focus:outline-none disabled:opacity-60',
            invalid ? 'border-danger' : 'border-border',
          )}
        />
      ))}
    </div>
  );
}
