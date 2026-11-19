'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './button';

/**
 * A two-tap button for small destructive actions: the first tap turns it into "Confirm …",
 * the second does it. Goes back after 4 seconds if not confirmed.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  loading,
  label,
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  /** Accessible name when the visible text alone isn't enough (e.g. "Remove Ravi from Dosa Corner"). */
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Button
      variant="danger"
      size="sm"
      loading={loading}
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
    >
      {confirmLabel}
    </Button>
  ) : (
    <Button variant="ghost" size="sm" aria-label={label} onClick={() => setArmed(true)}>
      {children}
    </Button>
  );
}
