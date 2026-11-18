'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs` (for "waiting 4 min" labels). */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
