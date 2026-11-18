'use client';

import { QRCodeSVG } from 'qrcode.react';

/**
 * The pickup QR (spec §5). Always black on white with a quiet zone — even in dark mode —
 * because scanners need the contrast. 220 px ≈ 5–6 cm on a phone: easy to scan at 30 cm.
 */
export function PickupQr({ payload, token }: { payload: string; token: number }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="rounded-(--radius-card) bg-white p-3 shadow-sm ring-1 ring-black/10">
        <QRCodeSVG
          value={payload}
          size={220}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          title={`Pickup QR code for token ${token}`}
          role="img"
          aria-label={`Pickup QR code for token ${token}`}
          data-testid="pickup-qr"
        />
      </div>
      <figcaption className="text-sm text-ink-muted">
        Show this at the counter to collect your food
      </figcaption>
    </figure>
  );
}
