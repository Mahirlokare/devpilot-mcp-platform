/** Simple CSS bar chart. Renders only the provided points. */
export function Bars({ items, format }: { items: { label: string; value: number; secondary?: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = format ?? ((n: number) => n.toLocaleString());
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-slate-400 sm:w-32" title={i.label}>
            {i.label}
          </span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-bg">
            <div className="h-full bg-sky-500/70" style={{ width: `${(i.value / max) * 100}%` }} />
            {i.secondary ? <div className="absolute inset-y-0 left-0 bg-red-500/80" style={{ width: `${(i.secondary / max) * 100}%` }} /> : null}
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-slate-300">{fmt(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars (SVG) for time series. */
export function ColumnChart({ points, height = 120 }: { points: { label: string; value: number; secondary?: number }[]; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / Math.max(points.length, 1);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Daily chart">
      {points.map((p, i) => {
        const h = (p.value / max) * (height - 4);
        const eh = ((p.secondary ?? 0) / max) * (height - 4);
        return (
          <g key={p.label}>
            <title>{`${p.label}: ${p.value}${p.secondary ? ` (${p.secondary} errors)` : ""}`}</title>
            <rect x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} fill="#0ea5e9" opacity={0.75} />
            {eh > 0 && <rect x={i * w + w * 0.15} y={height - eh} width={w * 0.7} height={eh} fill="#ef4444" />}
          </g>
        );
      })}
    </svg>
  );
}
