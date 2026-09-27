import { themeColor, themeLabel, URGENCY_LABELS } from "@/lib/themes";

/** Four voxel squares: how much an item matters to residents (Jev score 0..3). */
export function UrgencyMeter({ value, label }: { value: number | null; label?: string | null }) {
  if (value === null) return <span className="text-xs text-ink-3">Impact not assessed</span>;
  const filled = Math.round(value) + 1;
  const text = label ?? URGENCY_LABELS[Math.round(value)] ?? "";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Impact on residents: ${text} (${value.toFixed(1)} of 3)`}>
      <span className="inline-flex gap-[2px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`size-[9px] rounded-[1px] ${
              i < filled ? (filled >= 4 ? "bg-alert" : filled === 3 ? "bg-amber-deep" : "bg-slate") : "bg-paper-3"
            }`}
          />
        ))}
      </span>
      <span className="text-xs font-semibold text-ink-2">{text}</span>
      <span className="sr-only">impact on residents</span>
    </span>
  );
}

export function ThemeTag({ theme }: { theme: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
      <span className="size-2.5 rounded-[2px]" style={{ background: themeColor(theme) }} aria-hidden="true" />
      {themeLabel(theme)}
    </span>
  );
}

type IconName = "rotate-left" | "rotate-right" | "plus" | "minus" | "home" | "list" | "map" | "cube" | "close" | "flag" | "river" | "label" | "external";

const PATHS: Record<IconName, string> = {
  "rotate-left": "M4 4v5h5M4.5 9A8 8 0 1 1 6 17.5",
  "rotate-right": "M20 4v5h-5M19.5 9A8 8 0 1 0 18 17.5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  home: "M4 11l8-7 8 7M6 10v10h12V10",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  close: "M6 6l12 12M18 6L6 18",
  flag: "M6 21V4M6 4h11l-2 4 2 4H6",
  river: "M3 8c3-2 6 2 9 0s6-2 9 0M3 14c3-2 6 2 9 0s6-2 9 0M3 20c3-2 6 2 9 0s6-2 9 0",
  label: "M4 7h16M4 12h10M4 17h7",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
};

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold leading-none tracking-[-0.02em] [font-stretch:125%] ${className}`}>
      Ask<span className="text-kendal">Kendal</span>
    </span>
  );
}
