/**
 * The Indian food-type mark: a green square with a dot for vegetarian, a brown square
 * with a triangle for non-vegetarian (FSSAI style). Has an accessible name.
 */
export function VegDot({ veg, size = 16 }: { veg: boolean; size?: number }) {
  const label = veg ? 'Vegetarian' : 'Non-vegetarian';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="2"
        fill="none"
        strokeWidth="1.6"
        className={veg ? 'stroke-veg' : 'stroke-nonveg'}
      />
      {veg ? (
        <circle cx="8" cy="8" r="3.6" className="fill-veg" />
      ) : (
        <path d="M8 4.2 12 11.3H4z" className="fill-nonveg" />
      )}
    </svg>
  );
}
