import { ImageResponse } from 'next/og';

// PNG app icons generated at build time from the logo (no binary files in the repo).
const VARIANTS = {
  '192': { size: 192, padding: 0.08 },
  '512': { size: 512, padding: 0.08 },
  maskable: { size: 512, padding: 0.22 },
};
type Variant = keyof typeof VARIANTS;

export const dynamic = 'force-static';
export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, ctx: RouteContext<'/pwa-icon/[variant]'>) {
  const { variant } = await ctx.params;
  const spec = VARIANTS[variant as Variant];
  if (!spec) return new Response('Not found', { status: 404 });
  const inner = Math.round(spec.size * (1 - spec.padding * 2));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#2B3484',
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 48 48">
        <path
          d="M8 6h32a4 4 0 0 1 4 4v10a4 4 0 0 0 0 8v10a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V28a4 4 0 0 0 0-8V10a4 4 0 0 1 4-4Z"
          fill="#F5B700"
        />
        <path
          d="M13 33V19.5c0-.3.2-.5.5-.5h2.6c.3 0 .5.2.5.5v1.3c.9-1.4 2.4-2.1 4.1-2.1 1.9 0 3.3.8 4.1 2.3 1-1.5 2.6-2.3 4.6-2.3 3.1 0 5.1 2 5.1 5.4V33h-3.7v-9.2c0-1.6-.8-2.5-2.2-2.5-1.5 0-2.5 1-2.5 2.9V33h-3.7v-9.2c0-1.6-.8-2.5-2.2-2.5-1.5 0-2.5 1-2.5 2.9V33Z"
          fill="#1C2150"
        />
      </svg>
    </div>,
    { width: spec.size, height: spec.size },
  );
}
