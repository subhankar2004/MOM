'use client';

import { Smartphone, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

const KEY = 'mom.hint.home-screen';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function shouldShow(): boolean {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    return touch && !standalone && localStorage.getItem(KEY) !== 'dismissed';
  } catch {
    return false;
  }
}

/**
 * "Add MOM to your home screen" — so the token is one tap away next time.
 * Phones only, once (dismiss is remembered). Shows an Install button where the browser
 * offers one (Chrome on Android), otherwise how to do it by hand.
 */
export function AddToHomeHint() {
  const eligible = useSyncExternalStore(
    () => () => {},
    shouldShow,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!eligible || dismissed) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, 'dismissed');
    } catch {
      // ignore
    }
    setDismissed(true);
  };
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  return (
    <aside
      aria-label="Tip"
      className="flex w-full items-start gap-3 rounded-(--radius-card) border border-border bg-surface p-3"
    >
      <Smartphone size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <p>
          <span className="font-semibold">Add MOM to your home screen</span> to open your token in one tap.{' '}
          {!installEvent &&
            (ios
              ? 'Tap Share, then “Add to Home Screen”.'
              : 'Open the browser menu, then “Add to Home screen”.')}
        </p>
        {installEvent && (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={async () => {
              await installEvent.prompt();
              dismiss();
            }}
          >
            Install MOM
          </Button>
        )}
      </div>
      <IconButton
        label="Hide this tip"
        icon={<X size={18} aria-hidden />}
        onClick={dismiss}
        className="size-9"
      />
    </aside>
  );
}
