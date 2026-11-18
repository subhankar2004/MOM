'use client';

/**
 * Short alert tones made with Web Audio (no sound files to download). Browsers only allow
 * sound after the person has tapped the page, so the stall console has a "Turn on sound"
 * button that calls `unlockAudio()`.
 */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      ctx = new Ctx();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Call from a tap/click. Resolves true when sound can play. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  try {
    await c.resume();
  } catch {
    return false;
  }
  return c.state === 'running';
}

export function audioUnlocked(): boolean {
  return ctx?.state === 'running';
}

/** Plays the tones one after another (best effort: silent if sound is blocked). */
export function playTones(frequencies: number[], gap = 0.22): void {
  const c = context();
  if (!c || c.state !== 'running') return;
  try {
    frequencies.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = freq;
      const start = c.currentTime + i * gap;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.21);
    });
  } catch {
    // audio blocked
  }
}
