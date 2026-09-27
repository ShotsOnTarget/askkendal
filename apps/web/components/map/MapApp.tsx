"use client";

import type { RiverStatus, RiverStation } from "@askkendal/ingest/river";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate, relativeAge } from "@/lib/format";
import { themeColor } from "@/lib/themes";
import type { DataStatus, MapDecision } from "@/lib/types";
import { Icon, ThemeTag, Wordmark } from "../ui";
import { InfoPanel, type Selection } from "./InfoPanel";
import type { LayerName, VoxelViewer, ViewerPick } from "./viewer";

const Map2D = dynamic(() => import("./Map2D"), { ssr: false });

type Mode = "3d" | "2d";
const MODE_KEY = "askkendal:mode";
const KENT_STATION = "730506"; // River Kent at Victoria Bridge

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

export default function MapApp({ decisions, latest, status }: { decisions: MapDecision[]; latest: MapDecision[]; status: DataStatus }) {
  const box = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<VoxelViewer | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [viewerState, setViewerState] = useState<"loading" | "ready" | "error">("loading");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<LayerName, boolean>>({ decisions: true, river: true, labels: true });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [river, setRiver] = useState<RiverStatus | null>(null);
  const [riverError, setRiverError] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(true);
  const [debug, setDebug] = useState<string | null>(null);

  const located = useMemo(() => decisions.filter((d) => d.lat !== null && d.lng !== null), [decisions]);
  const byId = useMemo(() => new Map(decisions.concat(latest).map((d) => [d.id, d])), [decisions, latest]);
  const kent = river?.stations.find((s) => s.id === KENT_STATION) ?? river?.stations.find((s) => s.river === "River Kent") ?? null;

  // Choose 3D or 2D once, on the client.
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(MODE_KEY) as Mode | null;
      } catch {
        return null;
      }
    })();
    const webgl2 = (() => {
      try {
        return !!document.createElement("canvas").getContext("webgl2");
      } catch {
        return false;
      }
    })();
    const lowPower = (navigator.hardwareConcurrency ?? 4) <= 2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.matchMedia("(max-width: 640px)").matches) setAdvisorOpen(false);
    setMode(!webgl2 ? "2d" : saved ?? (lowPower || reduced ? "2d" : "3d"));
    if (new URLSearchParams(window.location.search).has("debug")) setDebug("");
  }, []);

  const chooseMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: fine */
    }
  };

  const selectDecision = useCallback((d: MapDecision, fly = true) => {
    setSelection({ kind: "decision", item: d });
    viewerRef.current?.select(d.id);
    if (fly && d.lat !== null && d.lng !== null) viewerRef.current?.focusOn(d.lat, d.lng);
  }, []);

  const selectGauge = useCallback((s: RiverStation) => {
    setSelection({ kind: "gauge", station: s });
    viewerRef.current?.select(null);
  }, []);

  const onPick = useCallback(
    (p: ViewerPick) => {
      if (p.kind === "beacon") {
        const d = byId.get(p.id);
        if (d) selectDecision(d, false);
      } else if (p.kind === "gauge") {
        const s = river?.stations.find((x) => x.id === p.id);
        if (s) selectGauge(s);
      } else if (p.kind === "place") {
        const nearby = located
          .map((d) => ({ d, m: distanceM(p.lat, p.lon, d.lat!, d.lng!) }))
          .filter((x) => x.m <= 300)
          .sort((a, b) => a.m - b.m)
          .map((x) => x.d);
        viewerRef.current?.select(null);
        setSelection({ kind: "place", cls: p.cls, feature: p.feature, lat: p.lat, lon: p.lon, nearby });
      } else {
        viewerRef.current?.select(null);
        setSelection(null);
      }
    },
    [byId, located, river, selectDecision, selectGauge],
  );
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Create the 3D viewer when in 3D mode.
  useEffect(() => {
    if (mode !== "3d" || !box.current) return;
    let cancelled = false;
    let viewer: VoxelViewer | null = null;
    setViewerState("loading");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    import("./viewer")
      .then(({ VoxelViewer }) =>
        VoxelViewer.create({
          container: box.current!,
          baseUrl: "/voxel",
          reducedMotion: reduced,
          coarsePointer: coarse,
          onPick: (p) => onPickRef.current(p),
          onError: (msg) => {
            setViewerError(msg);
            setViewerState("error");
            chooseMode("2d");
          },
          onReady: () => setViewerState("ready"),
        }),
      )
      .then((v) => {
        if (cancelled) {
          v.dispose();
          return;
        }
        viewer = v;
        viewerRef.current = v;
        if (new URLSearchParams(window.location.search).has("debug")) (window as unknown as { __askkendal?: VoxelViewer }).__askkendal = v;
      })
      .catch((err: Error) => {
        setViewerError(err.message);
        setViewerState("error");
      });
    return () => {
      cancelled = true;
      viewer?.dispose();
      viewerRef.current = null;
    };
  }, [mode]);

  // Push data into the viewer whenever it (re)appears or data changes.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.setBeacons(located.map((d) => ({ id: d.id, lat: d.lat!, lng: d.lng!, color: themeColor(d.theme), urgency: d.urgency })));
    if (river) {
      v.setGauges(
        river.stations.map((s) => ({ id: s.id, label: s.label, lat: s.lat, lon: s.lon, value: s.value, relative: s.relative, status: s.status })),
      );
      v.setWaterLevel(kent?.relative ?? null);
    }
    (Object.keys(layers) as LayerName[]).forEach((k) => v.setLayer(k, layers[k]));
    v.select(selection?.kind === "decision" ? selection.item.id : null);
  }, [viewerState, located, river, kent, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // River levels: live from the Environment Agency via our cached API route, every 5 minutes.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/flood")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: RiverStatus) => {
          if (alive) {
            setRiver(data);
            setRiverError(false);
          }
        })
        .catch(() => alive && setRiverError(true));
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Deep link: /?item=123 opens that item.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("item"));
    const d = id ? byId.get(id) : undefined;
    if (d && viewerState !== "loading") selectDecision(d);
  }, [viewerState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Developer overlay: ?debug shows draw calls and triangles.
  useEffect(() => {
    if (debug === null || mode !== "3d") return;
    const t = setInterval(() => {
      const s = viewerRef.current?.stats();
      if (s) setDebug(`view ${s.viewH} m · ${s.level === "d" ? "detail" : "overview"} · ${s.chunks} chunks · ${s.drawCalls} draws · ${s.drawnTriangles.toLocaleString()} tris`);
    }, 500);
    return () => clearInterval(t);
  }, [debug, mode]);

  const toggleLayer = (k: LayerName) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <div className="sky relative h-dvh w-full overflow-hidden text-ink">
      <div ref={box} className="absolute inset-0" />
      {mode === "2d" && (
        <Map2D
          decisions={located}
          stations={river?.stations ?? []}
          showDecisions={layers.decisions}
          showRiver={layers.river}
          selectedId={selection?.kind === "decision" ? selection.item.id : null}
          onSelectDecision={(d) => selectDecision(d, false)}
          onSelectGauge={selectGauge}
        />
      )}

      {/* Top-left: brand and advisor */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-[min(360px,calc(100vw-24px))] flex-col gap-3 sm:left-5 sm:top-5 [padding-top:env(safe-area-inset-top)]">
        <header className="slab settle pointer-events-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="focus-ring rounded-[2px]">
              <Wordmark className="text-[26px]" />
            </Link>
            <nav aria-label="Main" className="flex items-center gap-3 text-sm font-semibold text-ink-2">
              <Link href="/decisions" className="focus-ring rounded-[2px] underline-offset-4 [@media(hover:hover)]:hover:underline">
                Decisions
              </Link>
              <Link href="/about" className="focus-ring rounded-[2px] underline-offset-4 [@media(hover:hover)]:hover:underline">
                About
              </Link>
            </nav>
          </div>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-2">What the councils are deciding about Kendal, on a model of the town.</p>
          <p className="mt-1 text-[10px] text-ink-3 lg:hidden">
            Map ©{" "}
            <a className="underline focus-ring" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap contributors
            </a>{" "}
            · River data: Environment Agency
          </p>
        </header>

        {!status.ok && (
          <p role="status" className="slab settle pointer-events-auto bg-amber/30 px-4 py-2.5 text-sm font-semibold [animation-delay:80ms]">
            {status.message} The map still works; council items will return shortly.
          </p>
        )}

        <section aria-label="Latest for Kendal" className="slab settle pointer-events-auto overflow-hidden [animation-delay:120ms]">
          <button
            type="button"
            onClick={() => setAdvisorOpen((o) => !o)}
            aria-expanded={advisorOpen}
            className="focus-ring flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="font-display text-xs font-bold uppercase tracking-[0.12em] text-ink-2 [font-stretch:112%]">Latest for Kendal</span>
            <span className="text-xs font-semibold text-ink-3">{advisorOpen ? "Hide" : `Show ${latest.length}`}</span>
          </button>
          <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: advisorOpen ? "1fr" : "0fr" }}>
            <ol className="min-h-0 overflow-hidden">
              {latest.length === 0 && <li className="px-4 pb-3 text-sm text-ink-2">No items yet. Run the ingestion to fill the map.</li>}
              {latest.map((d) => (
                <li key={d.id} className="border-t border-ink/8">
                  <button
                    type="button"
                    onClick={() => selectDecision(d)}
                    className="focus-ring group grid w-full grid-cols-[10px_1fr] gap-x-3 px-4 py-2.5 text-left [@media(hover:hover)]:hover:bg-paper-2"
                  >
                    <span className="mt-1.5 size-2.5 rounded-[2px]" style={{ background: themeColor(d.theme) }} aria-hidden="true" />
                    <span>
                      <span className="block text-[14px] font-semibold leading-snug">{d.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-3 tabular">
                        {formatDate(d.publishedAt)}
                        {d.lat === null ? " · not on the map" : d.locationName ? ` · ${d.locationName}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      {/* Top-right: live river reading */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 hidden sm:right-5 sm:top-5 sm:block">
        {kent ? (
          <button type="button" onClick={() => selectGauge(kent)} className="slab settle pointer-events-auto focus-ring px-4 py-2.5 text-left [animation-delay:200ms]">
            <span className="flex items-center gap-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3 [font-stretch:112%]">
              <Icon name="river" className="size-4 text-river" /> River Kent · Victoria Bridge
            </span>
            <span className="mt-0.5 flex items-baseline gap-2">
              <span className="font-display text-2xl font-extrabold tabular tracking-[-0.02em] text-river">{kent.value?.toFixed(2)} m</span>
              <span className={`text-sm font-semibold ${kent.status === "high" ? "text-alert" : "text-ink-2"}`}>
                {kent.status === "high" ? "High" : kent.status === "low" ? "Low" : kent.status === "normal" ? "Normal" : ""}
              </span>
            </span>
            <span className="block text-xs text-ink-3">
              {relativeAge(kent.measuredAt)}
              {river && river.warnings.length > 0 ? ` · ${river.warnings.length} flood alert${river.warnings.length > 1 ? "s" : ""} nearby` : " · no flood alerts"}
            </span>
          </button>
        ) : (
          riverError && <p className="slab pointer-events-auto px-4 py-2.5 text-sm text-ink-2">River levels unavailable right now.</p>
        )}
      </div>

      {/* Right: details */}
      {selection && (
        <div className="pointer-events-none absolute left-3 right-3 bottom-[76px] z-20 flex max-h-[58vh] sm:left-auto sm:bottom-24 sm:right-5 sm:top-32 sm:max-h-none sm:w-[380px] sm:items-start">
          <InfoPanel selection={selection} onClose={() => { setSelection(null); viewerRef.current?.select(null); }} onSelectDecision={(d) => selectDecision(d)} />
        </div>
      )}

      {/* List view: every item on the map as text, for screen readers and small screens */}
      {listOpen && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[76px] top-3 z-30 flex justify-center sm:bottom-24 sm:top-24">
          <section aria-label="Everything on the map" className="slab slide-in-right pointer-events-auto flex w-full max-w-xl flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="font-display text-lg font-bold [font-stretch:110%]">Everything on the map</h2>
              <button type="button" className="block-btn !min-h-9 !min-w-9 !px-0" onClick={() => setListOpen(false)} aria-label="Close list">
                <Icon name="close" className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 pb-4">
              <h3 className="mt-1 font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">Council items ({located.length})</h3>
              <ul className="mt-1 divide-y divide-ink/10">
                {located.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="focus-ring w-full py-2 text-left" onClick={() => { setListOpen(false); selectDecision(d); }}>
                      <span className="block text-sm font-semibold">{d.title}</span>
                      <span className="flex flex-wrap gap-x-3 text-xs text-ink-3">
                        <span className="tabular">{formatDate(d.publishedAt)}</span>
                        {d.locationName && <span>{d.locationName}</span>}
                        <ThemeTag theme={d.theme} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <h3 className="mt-4 font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">River gauges ({river?.stations.length ?? 0})</h3>
              <ul className="mt-1 divide-y divide-ink/10">
                {(river?.stations ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" className="focus-ring w-full py-2 text-left" onClick={() => { setListOpen(false); selectGauge(s); }}>
                      <span className="block text-sm font-semibold">{s.label}</span>
                      <span className="text-xs text-ink-3 tabular">
                        {s.river ?? "Gauge"} · {s.value?.toFixed(2)} m · {s.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}

      {/* Bottom: toolbar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 sm:pb-5 [padding-bottom:max(12px,env(safe-area-inset-bottom))]">
        <div role="toolbar" aria-label="Map controls" className="slab settle pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto p-1.5 [animation-delay:240ms] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" className="block-btn" aria-pressed={layers.decisions} onClick={() => toggleLayer("decisions")}>
            <Icon name="flag" className="size-4" />
            <span className="hidden sm:inline">Decisions</span>
            <span className="sr-only sm:hidden">Decisions layer</span>
          </button>
          <button type="button" className="block-btn" aria-pressed={layers.river} onClick={() => toggleLayer("river")}>
            <Icon name="river" className="size-4" />
            <span className="hidden sm:inline">River</span>
            <span className="sr-only sm:hidden">River layer</span>
          </button>
          {mode === "3d" && (
            <button type="button" className="block-btn" aria-pressed={layers.labels} onClick={() => toggleLayer("labels")}>
              <Icon name="label" className="size-4" />
              <span className="hidden sm:inline">Names</span>
              <span className="sr-only sm:hidden">Place names</span>
            </button>
          )}
          <span className="mx-1 h-7 w-px shrink-0 bg-ink/15" aria-hidden="true" />
          {mode === "3d" && (
            <>
              <button type="button" className="block-btn !px-0" aria-label="Rotate left" onClick={() => viewerRef.current?.rotate(-1)}>
                <Icon name="rotate-left" />
              </button>
              <button type="button" className="block-btn !px-0" aria-label="Rotate right" onClick={() => viewerRef.current?.rotate(1)}>
                <Icon name="rotate-right" />
              </button>
              <button type="button" className="block-btn !px-0" aria-label="Zoom out" onClick={() => viewerRef.current?.zoomBy(1.35)}>
                <Icon name="minus" />
              </button>
              <button type="button" className="block-btn !px-0" aria-label="Zoom in" onClick={() => viewerRef.current?.zoomBy(0.74)}>
                <Icon name="plus" />
              </button>
              <button type="button" className="block-btn !px-0" aria-label="Back to the town centre" onClick={() => viewerRef.current?.resetView()}>
                <Icon name="home" />
              </button>
              <span className="mx-1 h-7 w-px shrink-0 bg-ink/15" aria-hidden="true" />
            </>
          )}
          <button
            type="button"
            className="block-btn"
            onClick={() => chooseMode(mode === "3d" ? "2d" : "3d")}
            aria-label={mode === "3d" ? "Switch to flat map" : "Switch to voxel model"}
          >
            <Icon name={mode === "3d" ? "map" : "cube"} className="size-4" />
            <span className="hidden sm:inline">{mode === "3d" ? "Flat map" : "Voxel view"}</span>
          </button>
          <button type="button" className="block-btn" aria-pressed={listOpen} onClick={() => setListOpen((o) => !o)}>
            <Icon name="list" className="size-4" />
            <span className="hidden sm:inline">List</span>
            <span className="sr-only sm:hidden">List view</span>
          </button>
        </div>
      </div>

      {/* Loading and errors for the 3D view */}
      {mode === "3d" && viewerState === "loading" && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 font-display text-sm font-bold uppercase tracking-[0.14em] text-ink-3 [font-stretch:115%]">
          Building Kendal…
        </p>
      )}
      {viewerError && (
        <p role="alert" className="slab absolute left-1/2 top-20 z-30 -translate-x-1/2 px-4 py-2 text-sm">
          {viewerError} Showing the flat map instead.
        </p>
      )}

      {/* Attribution: required by the OpenStreetMap licence and the Open Government Licence */}
      <p className="pointer-events-auto absolute bottom-1 right-2 z-10 hidden text-[10px] text-ink-3 lg:block">
        Map data ©{" "}
        <a className="underline focus-ring" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors
        </a>
        {" · "}River data: Environment Agency (OGL){" · "}Sorted by Jev (AI)
      </p>
      {debug !== null && <p className="absolute right-2 top-2 z-40 rounded-[2px] bg-ink px-2 py-1 font-mono text-[11px] text-paper">{debug || "…"}</p>}
    </div>
  );
}
