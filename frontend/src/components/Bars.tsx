/** Soothing horizontal & vertical bar charts. */
export function Bars({ items, format }: { items: { label: string; value: number; secondary?: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = format ?? ((n: number) => n.toLocaleString());
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 truncate font-medium text-slate-400 sm:w-32" title={i.label}>
            {i.label}
          </span>
          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all duration-300"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
            {i.secondary ? (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-rose-500/85"
                style={{ width: `${(i.secondary / max) * 100}%` }}
              />
            ) : null}
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-slate-300">{fmt(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars (SVG) for time series. */
export function ColumnChart({ points, height = 132 }: { points: { label: string; value: number; secondary?: number }[]; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / Math.max(points.length, 1);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Daily chart">
      <defs>
        <linearGradient id="devpilotBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {points.map((p, i) => {
        const h = (p.value / max) * (height - 8);
        const eh = ((p.secondary ?? 0) / max) * (height - 8);
        return (
          <g key={p.label}>
            <title>{`${p.label}: ${p.value}${p.secondary ? ` (${p.secondary} errors)` : ""}`}</title>
            <rect x={i * w + w * 0.18} y={height - h} width={w * 0.64} height={h} rx="2" fill="url(#devpilotBarGrad)" />
            {eh > 0 && <rect x={i * w + w * 0.18} y={height - eh} width={w * 0.64} height={eh} rx="2" fill="#f43f5e" />}
          </g>
        );
      })}
    </svg>
  );
}
