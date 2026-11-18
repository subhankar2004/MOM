'use client';

import { Camera, Flashlight, FlashlightOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

/**
 * The browser's own QR reader where there is one (Chrome on Android, desktop Chrome/Edge);
 * otherwise jsQR, a small JavaScript decoder loaded only when needed (iPhone Safari, Firefox).
 */
async function createDecoder(): Promise<Decoder> {
  const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      if ((await Native.getSupportedFormats()).includes('qr_code')) {
        const detector = new Native({ formats: ['qr_code'] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    // Downscale: QR codes on a phone screen decode fine at 640 px, and it's much faster.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

type CameraState = 'starting' | 'on' | 'denied' | 'unavailable';

/**
 * Live camera that reports each QR code it reads. Scanning stops while `paused` (a result is
 * on screen) so one code isn't read ten times. Back camera, torch where the phone has one.
 */
export function QrScanner({ paused, onCode }: { paused: boolean; onCode: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const [state, setState] = useState<CameraState>('starting');
  const [torch, setTorch] = useState<boolean | null>(null); // null = no torch
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (err) {
        if (!stopped) setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setState('on');

      const decode = await createDecoder();
      let last = '';
      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && video.readyState >= 2) {
          const text = await decode(video).catch(() => null);
          if (text && !pausedRef.current) {
            // The same code held in front of the camera counts once until the result is closed.
            if (text !== last) onCodeRef.current(text);
            last = text;
          }
        }
        if (pausedRef.current) last = '';
        timer = setTimeout(() => void tick(), 150);
      };
      void tick();
    }
    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [attempt]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-(--radius-card) bg-black sm:aspect-video">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera view for scanning pickup QR codes"
        className={cn('absolute inset-0 size-full object-cover', paused && 'opacity-40')}
      />
      {state === 'on' && (
        <>
          {/* Aiming frame */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto size-3/5 rounded-(--radius-card) border-4 border-white/80 sm:size-auto sm:h-3/4 sm:aspect-square"
          />
          {torch !== null && (
            <IconButton
              label={torch ? 'Turn torch off' : 'Turn torch on'}
              icon={torch ? <FlashlightOff size={20} aria-hidden /> : <Flashlight size={20} aria-hidden />}
              onClick={() => void toggleTorch()}
              className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
            />
          )}
        </>
      )}
      {state !== 'on' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <Camera size={32} aria-hidden />
          <p role={state === 'starting' ? undefined : 'alert'}>
            {state === 'starting'
              ? 'Starting the camera…'
              : state === 'denied'
                ? 'Camera access is blocked. Allow it in the browser settings, or type the token below.'
                : 'No camera found. Type the token and pickup code below.'}
          </p>
          {state === 'denied' && (
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
