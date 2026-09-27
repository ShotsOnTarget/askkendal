"use client";

import type { FeatureInfo } from "@askkendal/voxel/format";
import type { RiverStation } from "@askkendal/ingest/river";
import Link from "next/link";
import { formatDate, formatTime } from "@/lib/format";
import { SOURCE_NAMES } from "@/lib/themes";
import type { MapDecision } from "@/lib/types";
import { Icon, ThemeTag, UrgencyMeter } from "../ui";

export type Selection =
  | { kind: "decision"; item: MapDecision }
  | { kind: "gauge"; station: RiverStation }
  | { kind: "place"; cls: number; feature: FeatureInfo | null; lat: number; lon: number; nearby: MapDecision[] };

const CLASS_WORDS = ["Open ground", "Green space", "Road", "Water", "Building"];

function placeTitle(s: Extract<Selection, { kind: "place" }>): { title: string; subtitle: string; search: string | null } {
  const f = s.feature;
  if (f?.t === "b") {
    if (f.n) return { title: f.n, subtitle: f.s ? `Building on or near ${f.s}` : "Building", search: f.n };
    return { title: f.s ? `A building on ${f.s}` : "A building", subtitle: "OpenStreetMap has no name for this building.", search: f.s ?? null };
  }
  if (f?.n) {
    const kind = f.t === "r" ? "Street" : f.t === "w" ? "River or beck" : "Green space";
    return { title: f.n, subtitle: kind, search: f.n };
  }
  return { title: CLASS_WORDS[s.cls] ?? "Somewhere in Kendal", subtitle: "No name in OpenStreetMap for this spot.", search: null };
}

export function InfoPanel({ selection, onClose, onSelectDecision }: { selection: Selection; onClose: () => void; onSelectDecision: (d: MapDecision) => void }) {
  return (
    <section
      aria-live="polite"
      aria-label="Details"
      className="slab slide-in-right pointer-events-auto flex max-h-full flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3 [font-stretch:112%]">
          {selection.kind === "decision" ? "Council item" : selection.kind === "gauge" ? "River gauge" : "On the map"}
        </p>
        <button type="button" onClick={onClose} className="block-btn -mr-1 -mt-1 !min-h-9 !min-w-9 !px-0" aria-label="Close details">
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <div className="overflow-y-auto overscroll-contain px-4 pb-4">
        {selection.kind === "decision" && <DecisionDetail d={selection.item} />}
        {selection.kind === "gauge" && <GaugeDetail s={selection.station} />}
        {selection.kind === "place" && <PlaceDetail s={selection} onSelectDecision={onSelectDecision} />}
      </div>
    </section>
  );
}

function DecisionDetail({ d }: { d: MapDecision }) {
  const byRules = d.judgeModel === "rules";
  return (
    <article>
      <h2 className="mt-1 font-display text-xl font-bold leading-tight tracking-[-0.012em] [font-stretch:108%]">{d.title}</h2>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <time className="tabular" dateTime={d.publishedAt ?? undefined}>{formatDate(d.publishedAt)}</time>
        <span>{SOURCE_NAMES[d.sourceKey] ?? d.sourceKey}</span>
        {d.locationName && <span>Near {d.locationName}</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ThemeTag theme={d.theme} />
        <UrgencyMeter value={d.urgency} label={d.urgencyLabel} />
      </div>
      {d.summary && <p className="mt-3 text-[15px] leading-relaxed text-ink">{d.summary}</p>}
      <a
        href={d.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block-btn block-btn-primary focus-ring mt-4 w-full"
      >
        Read the original
        <Icon name="external" className="size-4" />
      </a>
      <p className="mt-3 rounded-[4px] bg-paper-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
        {byRules
          ? "Theme and map position were set by simple keyword rules and may be wrong."
          : "Theme, impact and map position were sorted by Jev, an AI model. They can be wrong."}{" "}
        The summary is the first paragraph of the original. The original is the record.
      </p>
    </article>
  );
}

function GaugeDetail({ s }: { s: RiverStation }) {
  const status =
    s.status === "high" ? "Above its typical range" : s.status === "low" ? "Below its typical range" : s.status === "normal" ? "Within its typical range" : "Typical range not published";
  return (
    <div>
      <h2 className="mt-1 font-display text-xl font-bold leading-tight [font-stretch:108%]">{s.label}</h2>
      <p className="mt-1 text-sm text-ink-3">{s.river ?? "River level gauge"}</p>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-4xl font-extrabold tabular tracking-[-0.02em] text-river">{s.value?.toFixed(2) ?? "–"}</span>
        <span className="text-sm font-semibold text-ink-2">metres</span>
      </p>
      <p className={`mt-1 text-sm font-semibold ${s.status === "high" ? "text-alert" : "text-ink-2"}`}>{status}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-3">Typical range</dt>
        <dd className="tabular">{s.typicalLow !== null && s.typicalHigh !== null ? `${s.typicalLow.toFixed(2)} to ${s.typicalHigh.toFixed(2)} m` : "Not published"}</dd>
        <dt className="text-ink-3">Highest on record</dt>
        <dd className="tabular">{s.maxOnRecord !== null ? `${s.maxOnRecord.toFixed(2)} m, ${formatDate(s.maxOnRecordAt)}` : "Not published"}</dd>
        <dt className="text-ink-3">Reading taken</dt>
        <dd className="tabular">{s.measuredAt ? `${formatTime(s.measuredAt)}, ${formatDate(s.measuredAt)}` : "Unknown"}</dd>
      </dl>
      <a
        href={`https://check-for-flooding.service.gov.uk/station/${s.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block-btn focus-ring mt-4 w-full"
      >
        Environment Agency page
        <Icon name="external" className="size-4" />
      </a>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        The water on the model rises and falls with the Victoria Bridge gauge, within its typical range. It never shows flooding. For flood warnings use the
        Environment Agency service.
      </p>
    </div>
  );
}

function PlaceDetail({ s, onSelectDecision }: { s: Extract<Selection, { kind: "place" }>; onSelectDecision: (d: MapDecision) => void }) {
  const { title, subtitle, search } = placeTitle(s);
  return (
    <div>
      <h2 className="mt-1 font-display text-xl font-bold leading-tight [font-stretch:108%]">{title}</h2>
      <p className="mt-1 text-sm text-ink-3">{subtitle}</p>
      <h3 className="mt-4 font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3 [font-stretch:112%]">Council items within 300 m</h3>
      {s.nearby.length ? (
        <ul className="mt-2 divide-y divide-ink/10">
          {s.nearby.slice(0, 6).map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onSelectDecision(d)} className="focus-ring w-full rounded-[2px] py-2 text-left">
                <span className="block text-sm font-semibold leading-snug">{d.title}</span>
                <span className="text-xs text-ink-3 tabular">{formatDate(d.publishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-2">Nothing on the map close to here yet.</p>
      )}
      {search && (
        <Link href={`/decisions?q=${encodeURIComponent(search)}&scope=area`} className="block-btn focus-ring mt-4 w-full">
          Search council items for “{search}”
        </Link>
      )}
      {s.feature?.o && (
        <a
          href={`https://www.openstreetmap.org/${{ w: "way", r: "relation", n: "node" }[s.feature.o[0]] ?? "way"}/${s.feature.o.slice(1)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-3 underline decoration-ink/20 underline-offset-2 focus-ring"
        >
          View on OpenStreetMap <Icon name="external" className="size-3" />
        </a>
      )}
    </div>
  );
}
