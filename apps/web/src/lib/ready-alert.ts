'use client';

import { useEffect } from 'react';
import { playTones, unlockAudio } from './chime';

/**
 * "Your food is ready": a buzz and a short two-tone chime. Both are best effort — vibration
 * isn't supported on iPhones, and browsers may block sound until the page has been tapped.
 */
export function alertOrderReady(): void {
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    /* not supported */
  }
  // The page may have been tapped (e.g. "Place order"), which lets the chime play.
  void unlockAudio().then((ok) => ok && playTones([880, 1320]));
}

/**
 * While `message` is set and the tab is in the background, the tab title alternates with it,
 * so a student who switched apps sees "Token #12 is ready" in the tab strip.
 */
export function useTitleFlash(message: string | null): void {
  useEffect(() => {
    if (!message) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? message : original;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [message]);
}
