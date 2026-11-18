'use client';

import { useEffect } from 'react';

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
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.21);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    /* audio blocked */
  }
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
