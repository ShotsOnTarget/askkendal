"use client";

import type { RiverStation } from "@askkendal/ingest/river";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapDecision } from "@/lib/types";

/**
 * Flat map fallback: OpenFreeMap vector tiles, no API key.
 * Used when WebGL 2 is missing, on low-power devices, with reduced motion, or on request.
 */
export default function Map2D({
  decisions,
  stations,
  showDecisions,
  showRiver,
  selectedId,
  onSelectDecision,
  onSelectGauge,
}: {
  decisions: MapDecision[];
  stations: RiverStation[];
  showDecisions: boolean;
  showRiver: boolean;
  selectedId: number | null;
  onSelectDecision: (d: MapDecision) => void;
  onSelectGauge: (s: RiverStation) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const latest = useRef({ onSelectDecision, onSelectGauge, decisions, stations });
  latest.current = { onSelectDecision, onSelectGauge, decisions, stations };

  useEffect(() => {
    let cancelled = false;
    let instance: MlMap | null = null;
    void import("maplibre-gl").then((ml) => {
      if (cancelled || !box.current) return;
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const m = new ml.Map({
        container: box.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [-2.7465, 54.3265],
        zoom: 14.2,
        attributionControl: { compact: true },
      });
      instance = m;
      m.addControl(new ml.NavigationControl({ showCompass: true }), "bottom-right");
      m.on("load", () => {
        m.addSource("decisions", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addSource("gauges", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "decisions",
          type: "circle",
          source: "decisions",
          paint: {
            "circle-radius": ["case", ["get", "selected"], 11, 8],
            "circle-color": ["case", ["get", "selected"], "#4f9a45", "#f2b33d"],
            "circle-stroke-color": "#1f2430",
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "gauges",
          type: "circle",
          source: "gauges",
          paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
        for (const layer of ["decisions", "gauges"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        m.on("click", "decisions", (e) => {
          const id = Number(e.features?.[0]?.properties?.id);
          const d = latest.current.decisions.find((x) => x.id === id);
          if (d) latest.current.onSelectDecision(d);
        });
        m.on("click", "gauges", (e) => {
          const id = String(e.features?.[0]?.properties?.id);
          const s = latest.current.stations.find((x) => x.id === id);
          if (s) latest.current.onSelectGauge(s);
        });
        if (!cancelled) setMap(m);
      });
    });
    return () => {
      cancelled = true;
      instance?.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    (map.getSource("decisions") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: showDecisions
        ? decisions
            .filter((d) => d.lat !== null && d.lng !== null)
            .map((d) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [d.lng!, d.lat!] },
              properties: { id: d.id, selected: d.id === selectedId },
            }))
        : [],
    });
    (map.getSource("gauges") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: showRiver
        ? stations.map((s) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
            properties: { id: s.id, color: s.status === "high" ? "#c8452e" : "#3a86c8" },
          }))
        : [],
    });
  }, [map, decisions, stations, showDecisions, showRiver, selectedId]);

  // MapLibre styles its container as position: relative, so it fills a positioned wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" role="region" aria-label="Flat map of Kendal" />
    </div>
  );
}
