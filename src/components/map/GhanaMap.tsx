"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SimBadge, STATUS_COLOR } from "@/components/ui/primitives";
import { ghs, ghsCompact } from "@/lib/format";
import { useSnapshots, useTick } from "@/lib/hooks/useSim";
import { BRANCH_BY_ID, BRANCHES } from "@/lib/network/branches";
import { SUPPLY_HUBS, hubFor, transferStatus, transfersForDay } from "@/lib/network/supply";
import { TENANT } from "@/config/platform";
import { useApp } from "@/store/app";
import { sims } from "@/store/sims";
import BranchCard from "./BranchCard";
import { filterBranches, onFlyTo, useMapFilters } from "./mapState";
import MapToolbar from "./MapToolbar";
import NationalDashboard from "./NationalDashboard";

// maplibre v6 resolves its worker relative to import.meta.url, which bundlers rewrite;
// emit the worker as a static asset and point the library at it explicitly.
setWorkerUrl(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

const GHANA_BOUNDS: [[number, number], [number, number]] = [
  [-3.3, 4.7],
  [1.25, 11.2],
];
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-8.5, 2.2],
  [6.5, 13.6],
];
const SEV = { closed: 0, normal: 1, warning: 2, critical: 3 } as const;
const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
/** Building footprint (metres) per conceptual format, used for the fly-in extrusion. */
const FOOTPRINT = { A: [11, 10, 4.5], B: [16, 13, 5], C: [24, 17, 7.5] } as const;
/** Sequential blue (dark mode): low → recedes toward the surface, high → bright. */
const SEQ = ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"];

/** Keep Ghana clear of the floating dashboard (left) and toolbar (right) on wide screens. */
/** Map style can reload while hidden; defer mutations until it is ready (returns true when deferred). */
function deferUntilStyleReady(map: MLMap, retry: () => void) {
  if (map.isStyleLoaded()) return false;
  map.once("idle", retry);
  return true;
}

function fitPadding(el: HTMLElement | null) {
  const w = el?.clientWidth ?? 1200;
  return w > 900 ? { top: 40, bottom: 60, left: 360, right: 60 } : { top: 30, bottom: 120, left: 20, right: 20 };
}

function styleUrl() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  return key ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}` : "https://tiles.openfreemap.org/styles/dark";
}

type Bbox = [number, number, number, number];
type RegionFC = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string; iso: string }>;

function ringsOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
}

/** Bounding box + area-weighted centroid of the largest ring (good-enough label point). */
function regionGeometry(fc: RegionFC) {
  const bboxes = new Map<string, Bbox>();
  const labels: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const f of fc.features) {
    let bb: Bbox = [180, 90, -180, -90];
    let best: number[][] = [];
    let bestArea = 0;
    for (const ring of ringsOf(f.geometry)) {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
        const [x2, y2] = ring[(i + 1) % ring.length];
        a += x * y2 - x2 * y;
      }
      if (Math.abs(a) > bestArea) {
        bestArea = Math.abs(a);
        best = ring;
      }
    }
    let cx = 0;
    let cy = 0;
    let A = 0;
    for (let i = 0; i < best.length; i++) {
      const [x, y] = best[i];
      const [x2, y2] = best[(i + 1) % best.length];
      const c = x * y2 - x2 * y;
      A += c;
      cx += (x + x2) * c;
      cy += (y + y2) * c;
    }
    A /= 2;
    bboxes.set(f.properties.name, bb);
    labels.push({ type: "Feature", properties: { name: f.properties.name }, geometry: { type: "Point", coordinates: A ? [cx / (6 * A), cy / (6 * A)] : [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] } });
  }
  return { bboxes, labels };
}

function footprintPolygon(lng: number, lat: number, wM: number, dM: number): GeoJSON.Polygon {
  const dLat = dM / 2 / 111320;
  const dLng = wM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function GhanaMap({ visible }: { visible: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const bboxesRef = useRef<Map<string, Bbox>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [styleTick, setStyleTick] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const tick = useTick();
  const snaps = useSnapshots();
  const { user, regionFilter, statusFilter, search, setFilters, section, phase, enteredBranchId, setPhase } = useApp();
  const { format, pinkberry, regionalPerformance } = useMapFilters();
  const visibleBranches = useMemo(() => filterBranches(snaps, { user, regionFilter, statusFilter, search, format, pinkberry }), [snaps, user, regionFilter, statusFilter, search, format, pinkberry]);
  const snapById = useMemo(() => new Map(snaps.map((s) => [s.branchId, s])), [snaps]);

  // ── init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!container.current) return;
    const map = new MLMap({
      container: container.current,
      style: styleUrl(),
      bounds: GHANA_BOUNDS,
      fitBoundsOptions: { padding: fitPadding(container.current) },
      maxBounds: MAX_BOUNDS,
      minZoom: 4.5,
      maxPitch: 70,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __ghanaMap?: MLMap }).__ghanaMap = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    map.on("error", (e) => {
      const msg = (e as unknown as { error?: Error }).error?.message ?? "";
      if (/style|Failed to fetch/i.test(msg)) setMapError("Basemap tiles could not be loaded — branch data is still shown.");
    });

    map.on("load", async () => {
      let regions: RegionFC = { type: "FeatureCollection", features: [] };
      try {
        regions = await (await fetch("/geo/ghana-regions.geojson")).json();
      } catch {
        /* regions optional */
      }
      const { bboxes, labels } = regionGeometry(regions);
      bboxesRef.current = bboxes;

      map.addSource("regions", { type: "geojson", data: regions, promoteId: "name" });
      map.addSource("region-labels", { type: "geojson", data: { type: "FeatureCollection", features: labels } });
      map.addLayer({ id: "region-fill", type: "fill", source: "regions", paint: { "fill-color": "#ffffff", "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.07, 0.015] } });
      map.addLayer({ id: "region-line", type: "line", source: "regions", paint: { "line-color": "rgba(255,255,255,0.28)", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.4] } });
      map.addLayer({ id: "region-selected", type: "line", source: "regions", filter: ["==", ["get", "name"], ""], paint: { "line-color": "#FFD400", "line-width": 2.2 } });
      map.addLayer({
        id: "region-label",
        type: "symbol",
        source: "region-labels",
        maxzoom: 8.5,
        layout: { "text-field": ["upcase", ["get", "name"]], "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 8, 12], "text-letter-spacing": 0.12, "text-allow-overlap": false },
        paint: { "text-color": "rgba(255,255,255,0.42)", "text-halo-color": "rgba(7,9,13,0.8)", "text-halo-width": 1.2 },
      });

      // Supply chain (shown in Central Kitchens section)
      map.addSource("supply-routes", { type: "geojson", data: EMPTY });
      map.addSource("supply-hubs", { type: "geojson", data: EMPTY });
      map.addSource("supply-trucks", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "supply-routes", type: "line", source: "supply-routes", layout: { visibility: "none", "line-cap": "round" }, paint: { "line-color": ["case", ["get", "active"], "#FFD400", "rgba(255,212,0,0.4)"], "line-width": ["case", ["get", "active"], 1.8, 1], "line-dasharray": [2, 2] } });
      map.addLayer({ id: "supply-trucks", type: "circle", source: "supply-trucks", layout: { visibility: "none" }, paint: { "circle-radius": 4.5, "circle-color": "#FFD400", "circle-stroke-color": "#07090d", "circle-stroke-width": 2 } });
      map.addLayer({ id: "supply-hubs", type: "circle", source: "supply-hubs", layout: { visibility: "none" }, paint: { "circle-radius": 10, "circle-color": ["case", ["get", "verified"], "#5AB350", "#0e1117"], "circle-stroke-color": ["case", ["get", "verified"], "#ffffff", "#5AB350"], "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "supply-hub-label", type: "symbol", source: "supply-hubs", layout: { visibility: "none", "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top" }, paint: { "text-color": "#d9f2d5", "text-halo-color": "#07090d", "text-halo-width": 1.5 } });

      // Branches
      map.addSource("branches", {
        type: "geojson",
        data: EMPTY,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 10,
        clusterProperties: { sev: ["max", ["get", "sev"]], sales: ["+", ["get", "sales"]] },
      });
      const sevColor = ["match", ["get", "sev"], 3, STATUS_COLOR.critical, 2, STATUS_COLOR.warning, 1, STATUS_COLOR.normal, STATUS_COLOR.closed] as unknown as string;
      map.addLayer({ id: "cluster", type: "circle", source: "branches", filter: ["has", "point_count"], paint: { "circle-color": "#0e1117", "circle-stroke-color": sevColor, "circle-stroke-width": 3, "circle-radius": ["step", ["get", "point_count"], 15, 5, 19, 15, 24], "circle-opacity": 0.92 } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "branches", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT_BOLD, "text-size": 12, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
      map.addLayer({ id: "branch-pulse", type: "circle", source: "branches", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "sev"], 3]], paint: { "circle-color": STATUS_COLOR.critical, "circle-radius": 10, "circle-opacity": 0.35 } });
      map.addLayer({
        id: "branch",
        type: "circle",
        source: "branches",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": sevColor,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5.5, 10, 7.5, 15, 10],
          "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#ffffff", "#07090d"],
          "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 2],
        },
      });
      map.addLayer({
        id: "branch-label",
        type: "symbol",
        source: "branches",
        filter: ["!", ["has", "point_count"]],
        minzoom: 8.5,
        layout: {
          "text-field": ["format", ["get", "name"], { "font-scale": 1, "text-font": ["literal", FONT_BOLD] }, "\n", {}, ["get", "salesLabel"], { "font-scale": 0.85, "text-font": ["literal", FONT], "text-color": "#9ec5f4" }],
          "text-font": FONT,
          "text-size": 12,
          "text-offset": [0, 1.25],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(7,9,13,0.9)", "text-halo-width": 1.6 },
      });

      // Fly-in building
      map.addSource("building", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "building", type: "fill-extrusion", source: "building", paint: { "fill-extrusion-color": "#EE1D25", "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 } });
      map.addLayer({ id: "building-roof", type: "fill-extrusion", source: "building", paint: { "fill-extrusion-color": "#f4f4f4", "fill-extrusion-height": ["+", ["get", "h"], 0.6], "fill-extrusion-base": ["get", "h"], "fill-extrusion-opacity": 0.95 } });

      // Interactions
      let hoveredRegion: string | null = null;
      map.on("mousemove", "region-fill", (e: MapLayerMouseEvent) => {
        const name = e.features?.[0]?.properties?.name as string | undefined;
        if (hoveredRegion && hoveredRegion !== name) map.setFeatureState({ source: "regions", id: hoveredRegion }, { hover: false });
        if (name) {
          hoveredRegion = name;
          map.setFeatureState({ source: "regions", id: name }, { hover: true });
        }
      });
      map.on("mouseleave", "region-fill", () => {
        if (hoveredRegion) map.setFeatureState({ source: "regions", id: hoveredRegion }, { hover: false });
        hoveredRegion = null;
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["branch", "cluster", "supply-hubs"] });
        if (hits.length) return;
        const region = map.queryRenderedFeatures(e.point, { layers: ["region-fill"] })[0]?.properties?.name as string | undefined;
        setActiveId(null);
        if (!region) return;
        const cur = useApp.getState().regionFilter;
        if (cur === region) {
          useApp.getState().setFilters({ regionFilter: null });
          map.fitBounds(GHANA_BOUNDS, { padding: fitPadding(container.current), duration: 900 });
        } else {
          useApp.getState().setFilters({ regionFilter: region });
          const bb = bboxesRef.current.get(region);
          if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 70, duration: 1100, maxZoom: 10 });
        }
      });
      map.on("click", "cluster", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource("branches") as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.3, duration: 700 });
      });
      map.on("click", "branch", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (!id) return;
        setActiveId(id);
        setHover(null);
        useApp.getState().selectBranch(id);
      });
      map.on("mousemove", "branch", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setHover({ id, x: e.point.x, y: e.point.y });
      });
      map.on("mouseleave", "branch", () => {
        map.getCanvas().style.cursor = "";
        setHover(null);
      });
      for (const l of ["cluster", "supply-hubs"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
      setLoaded(true);
    });

    // Pulse critical markers.
    let raf = 0;
    const pulse = (t: number) => {
      if (map.isStyleLoaded() && map.getLayer("branch-pulse")) {
        const k = (t % 1600) / 1600;
        map.setPaintProperty("branch-pulse", "circle-radius", 8 + k * 16);
        map.setPaintProperty("branch-pulse", "circle-opacity", 0.45 * (1 - k));
      }
      raf = requestAnimationFrame(pulse);
    };
    raf = requestAnimationFrame(pulse);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── branch data ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    if (deferUntilStyleReady(map, () => setStyleTick((n) => n + 1))) return;
    const selected = useApp.getState().selectedBranchId;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: visibleBranches.map(({ b, s }) => ({
        type: "Feature",
        properties: { id: b.id, name: b.name, sev: SEV[s.status], sales: s.salesToday, salesLabel: `${ghsCompact(s.salesToday)} today`, selected: b.id === selected },
        geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      })),
    };
    (map.getSource("branches") as GeoJSONSource | undefined)?.setData(fc);
  }, [loaded, visibleBranches, styleTick]);

  // ── regions: selection + performance choropleth ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    if (deferUntilStyleReady(map, () => setStyleTick((n) => n + 1))) return;
    map.setFilter("region-selected", ["==", ["get", "name"], regionFilter ?? ""]);
    if (!regionalPerformance) {
      map.setPaintProperty("region-fill", "fill-color", "#ffffff");
      map.setPaintProperty("region-fill", "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], 0.07, 0.015]);
      return;
    }
    const byRegion = new Map<string, number>();
    for (const s of snaps) {
      const r = BRANCH_BY_ID.get(s.branchId)!.region;
      byRegion.set(r, (byRegion.get(r) ?? 0) + s.salesToday);
    }
    const max = Math.max(1, ...byRegion.values());
    const match: unknown[] = ["match", ["get", "name"]];
    for (const name of bboxesRef.current.keys()) {
      const v = byRegion.get(name) ?? 0;
      match.push(name, v === 0 ? "#1b1f27" : SEQ[Math.min(SEQ.length - 1, Math.floor((Math.sqrt(v / max)) * (SEQ.length - 1) + 0.0001))]);
    }
    match.push("#1b1f27");
    map.setPaintProperty("region-fill", "fill-color", match as never);
    map.setPaintProperty("region-fill", "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], 0.75, 0.55]);
  }, [loaded, regionFilter, regionalPerformance, snaps, styleTick]);

  // ── supply chain layer (Central Kitchens section) ────────────────────
  const dayStart = useMemo(() => {
    const d = new Date(sims().clock);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }, []);
  const transfers = useMemo(() => transfersForDay(dayStart, sims().seed), [dayStart]);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    if (deferUntilStyleReady(map, () => setStyleTick((n) => n + 1))) return;
    const show = section === "central" && !enteredBranchId;
    for (const l of ["supply-routes", "supply-trucks", "supply-hubs", "supply-hub-label"]) map.setLayoutProperty(l, "visibility", show ? "visible" : "none");
    if (!show) return;
    const now = sims().clock;
    const hubs = new Map(SUPPLY_HUBS.map((h) => [h.id, h]));
    const visibleIds = new Set(visibleBranches.map(({ b }) => b.id));
    const activeTransfers = transfers.filter((t) => visibleIds.has(t.branchId) && transferStatus(t, now) === "in-transit");
    const activeBranches = new Set(activeTransfers.map((t) => t.branchId));
    (map.getSource("supply-hubs") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: SUPPLY_HUBS.map((h) => ({ type: "Feature", properties: { id: h.id, verified: h.verified, label: h.verified ? `${h.name} · named publicly` : `${h.name}` }, geometry: { type: "Point", coordinates: [h.lng, h.lat] } })),
    });
    (map.getSource("supply-routes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: BRANCHES.filter((b) => visibleIds.has(b.id)).map((b) => {
        const h = hubFor(b).hub;
        return { type: "Feature", properties: { active: activeBranches.has(b.id) }, geometry: { type: "LineString", coordinates: [[h.lng, h.lat], [b.lng, b.lat]] } };
      }),
    });
    (map.getSource("supply-trucks") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: activeTransfers.map((t) => {
        const h = hubs.get(t.hubId)!;
        const b = BRANCH_BY_ID.get(t.branchId)!;
        const k = Math.min(1, Math.max(0, (now - t.departAt) / (t.arriveAt - t.departAt)));
        return { type: "Feature", properties: { id: t.id }, geometry: { type: "Point", coordinates: [h.lng + (b.lng - h.lng) * k, h.lat + (b.lat - h.lat) * k] } };
      }),
    });
  }, [loaded, section, enteredBranchId, tick, transfers, visibleBranches, styleTick]);

  // ── refit Ghana around the supply panel when entering Central Kitchens ──
  const prevSection = useRef(section);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || enteredBranchId) return;
    const changed = prevSection.current !== section;
    prevSection.current = section;
    if (!changed && section !== "central") return;
    const w = container.current?.clientWidth ?? 1200;
    if (section === "central") map.fitBounds(GHANA_BOUNDS, { padding: w > 900 ? { top: 40, bottom: 60, left: 40, right: Math.min(500, w * 0.45) } : 20, duration: 900 });
    else if (section === "network") map.fitBounds(GHANA_BOUNDS, { padding: fitPadding(container.current), duration: 900 });
  }, [loaded, section, enteredBranchId]);

  // ── card follows its marker ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !activeId) {
      setCardPos(null);
      return;
    }
    const b = BRANCH_BY_ID.get(activeId)!;
    const update = () => {
      const p = map.project([b.lng, b.lat]);
      const el = map.getContainer();
      setCardPos({ x: Math.min(Math.max(p.x + 16, 8), el.clientWidth - 312), y: Math.min(Math.max(p.y - 120, 8), el.clientHeight - 470) });
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [loaded, activeId]);

  // ── fly requests from directory / dashboard ──────────────────────────
  useEffect(
    () =>
      onFlyTo((id) => {
        const map = mapRef.current;
        const b = BRANCH_BY_ID.get(id);
        if (!map || !b) return;
        setActiveId(id);
        map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 12.5), pitch: 0, bearing: 0, duration: 1600, essential: true });
      }),
    [],
  );

  // ── cinematic map → restaurant transition ────────────────────────────
  const lastPhase = useRef(phase);
  useEffect(() => {
    const map = mapRef.current;
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (phase === "flying" && enteredBranchId) {
      const b = BRANCH_BY_ID.get(enteredBranchId);
      if (!b) return;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (useApp.getState().phase === "flying") setPhase("exterior");
      };
      // Fail-safe: never strand the user on the map if tiles/animation stall.
      const failsafe = setTimeout(finish, 6000);
      if (!map || !loaded) {
        clearTimeout(failsafe);
        setTimeout(finish, 300);
        return;
      }
      const [w, d, h] = FOOTPRINT[b.floorPlanType];
      (map.getSource("building") as GeoJSONSource).setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { h }, geometry: footprintPolygon(b.lng, b.lat, w, d) }] });
      // Listen only after flyTo starts: interrupting a running animation fires moveend synchronously.
      map.flyTo({ center: [b.lng, b.lat], zoom: 17.6, pitch: 62, bearing: -25, duration: 2800, essential: true, curve: 1.6 });
      map.once("moveend", () => setTimeout(finish, 250));
      return () => clearTimeout(failsafe);
    }
    if (phase === "map" && prev !== "map" && map && loaded) {
      (map.getSource("building") as GeoJSONSource | undefined)?.setData(EMPTY);
      const sel = useApp.getState().selectedBranchId;
      const b = sel ? BRANCH_BY_ID.get(sel) : null;
      if (b) {
        map.jumpTo({ center: [b.lng, b.lat], zoom: 16, pitch: 55, bearing: -25 });
        map.flyTo({ center: [b.lng, b.lat], zoom: 11, pitch: 0, bearing: 0, duration: 1800, essential: true });
      } else map.fitBounds(GHANA_BOUNDS, { padding: fitPadding(container.current), pitch: 0, bearing: 0, duration: 1500 });
    }
  }, [phase, enteredBranchId, loaded, setPhase]);

  // ── resize when shown again ──────────────────────────────────────────
  useEffect(() => {
    if (visible) requestAnimationFrame(() => mapRef.current?.resize());
  }, [visible]);

  const active = activeId ? BRANCH_BY_ID.get(activeId) : null;
  const activeSnap = activeId ? snapById.get(activeId) : null;
  const hoverB = hover && hover.id !== activeId ? BRANCH_BY_ID.get(hover.id) : null;
  const hoverS = hover ? snapById.get(hover.id) : null;
  const flying = phase === "flying";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0e13]">
      <div ref={container} className="!absolute inset-0 h-full w-full" aria-label={`Map of Ghana showing ${TENANT.name} branches`} role="region" />
      {!flying && !(section === "branches" && !enteredBranchId) && (
        <>
          {section !== "central" && <NationalDashboard snaps={visibleBranches.map((x) => x.s)} />}
          {section !== "central" && <MapToolbar visibleCount={visibleBranches.length} />}
        </>
      )}
      {mapError && <div className="glass absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-lg px-3 py-1.5 text-[11px] text-amber-200">{mapError}</div>}

      {hoverB && hoverS && hover && !flying && (
        <div className="glass pointer-events-none absolute z-20 rounded-lg px-2.5 py-1.5 text-[11px]" style={{ left: hover.x + 14, top: hover.y - 10 }}>
          <div className="font-semibold text-white">{hoverB.name}</div>
          <div className="flex items-center gap-2 text-white/60">
            <span className="font-mono tabular-nums text-white">{ghs(hoverS.salesToday)}</span> today
            <span style={{ color: STATUS_COLOR[hoverS.status] }}>● {hoverS.status}</span>
          </div>
        </div>
      )}

      {active && activeSnap && cardPos && !flying && (
        <div
          className="absolute z-20 max-md:!left-1/2 max-md:!top-auto max-md:bottom-3 max-md:-translate-x-1/2"
          style={{ left: cardPos.x, top: cardPos.y }}
        >
          <BranchCard b={active} s={activeSnap} onClose={() => setActiveId(null)} />
        </div>
      )}

      {section === "central" && !enteredBranchId && !flying && (
        <div className="glass absolute left-3 top-3 z-10 rounded-lg px-3 py-2 text-[10.5px] text-white/70">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-white bg-[#5AB350]" /> Named publicly
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-[#5AB350] bg-[#0e1117]" /> Conceptual hub
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-yellow" /> Truck in transit
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[9.5px] text-white/40">
            Supply routes are conceptual demo logistics, not company routes <SimBadge />
          </div>
        </div>
      )}

      {flying && enteredBranchId && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center">
          <div className="glass animate-fade-in rounded-full px-4 py-2 text-xs text-white/80">
            Flying to <span className="font-semibold text-white">{BRANCH_BY_ID.get(enteredBranchId)?.name}</span> · generating restaurant from floor plan…
          </div>
        </div>
      )}
      {regionFilter && !flying && (
        <button type="button" onClick={() => (setFilters({ regionFilter: null }), mapRef.current?.fitBounds(GHANA_BOUNDS, { padding: fitPadding(container.current), duration: 900 }))} className="glass absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-white/80 hover:text-white max-md:top-auto max-md:bottom-[13.5rem]">
          Region: <span className="font-semibold text-brand-yellow">{regionFilter}</span> · clear ✕
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {active ? `Selected ${active.name}` : ""}
      </span>
    </div>
  );
}
