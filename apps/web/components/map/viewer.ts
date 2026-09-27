import * as THREE from "three";
import { CHUNK, CLASS, HEIGHT, POS_SCALE } from "@askkendal/voxel/constants";
import type { FeatureInfo, VoxelLabel, VoxelManifest } from "@askkendal/voxel/format";
import type { MeshBuffers } from "@askkendal/voxel/mesher";
import { toLatLon, toWorld } from "@askkendal/voxel/project";
import type { Level, PickResult, WorkerRequest, WorkerResponse } from "./voxel.worker";

/**
 * The voxel Kendal viewer. Imperative Three.js, driven by React through a small API.
 *
 * Performance rules (see README):
 * - render on demand: nothing is drawn unless the camera, a layer or the data changed;
 * - one draw call per chunk; chunks stream in around the camera and are freed when far away;
 * - geometry is built in a Web Worker; the main thread only uploads buffers;
 * - flat colours, no lights, no shadows, no post-processing; pixel ratio capped at 1.5;
 * - map markers are instanced meshes updated in place;
 * - picking walks the grid in the worker instead of ray-testing triangles.
 */

export interface BeaconItem {
  id: number;
  lat: number;
  lng: number;
  color: string;
  urgency: number | null;
}

export interface GaugeItem {
  id: string;
  label: string;
  lat: number;
  lon: number;
  value: number | null;
  relative: number | null;
  status: "low" | "normal" | "high" | "unknown";
}

export type ViewerPick =
  | { kind: "beacon"; id: number }
  | { kind: "gauge"; id: string }
  | { kind: "place"; cls: number; feature: FeatureInfo | null; lat: number; lon: number }
  | { kind: "none" };

export interface ViewerOptions {
  container: HTMLElement;
  baseUrl: string;
  reducedMotion: boolean;
  coarsePointer: boolean;
  onPick: (p: ViewerPick) => void;
  onError: (message: string) => void;
  onReady?: () => void;
}

export type LayerName = "decisions" | "river" | "labels";

const ELEVATION = THREE.MathUtils.degToRad(30);
const DETAIL_MAX_VIEW = 1200; // metres of view height below which full detail streams in
const MIN_VIEW = 160;
const MAX_VIEW = 6500;
const MAX_DETAIL_CHUNKS = 520;
const MAX_INFLIGHT = 6;
const LOD_DROP = -0.35; // low-detail town sits just under the detailed one
const BEACON_CAPACITY = 512;
const GAUGE_CAPACITY = 32;
const POLE = 22; // beacon pole height in metres at scale 1
// Amber marks council items on the map (the design system reserves it for this); selected turns Kendal Green.
const BEACON_COLOR = new THREE.Color("#f2b33d");
const BEACON_SELECTED = new THREE.Color("#4f9a45");

const VERTEX = /* glsl */ `
attribute vec3 acolor;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vColor = acolor;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Voxel look for free: per-cell brightness jitter and cell edge lines drawn in the shader,
// faded out when cells become too small on screen to avoid shimmer.
const FRAGMENT = /* glsl */ `
uniform float uCell;
uniform float uLines;
varying vec3 vColor;
varying vec3 vWorld;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 an = abs(n);
  vec3 q = vWorld / uCell;
  float jitter = (hash(floor(q - n * 0.02)) - 0.5) * 0.07;
  vec3 f = abs(fract(q) - 0.5);
  vec3 w = fwidth(q);
  vec3 e = smoothstep(vec3(0.5) - w * 1.25, vec3(0.5), f);
  float line = an.y > 0.5 ? max(e.x, e.z) : (an.x > 0.5 ? max(e.y, e.z) : max(e.x, e.y));
  float fade = 1.0 - smoothstep(0.1, 0.28, max(max(w.x, w.z), w.y));
  vec3 c = vColor * (1.0 + jitter) * (1.0 - line * uLines * fade);
  gl_FragColor = vec4(c, 1.0);
}`;

interface Chunk {
  level: Level;
  cx: number;
  cz: number;
  land: THREE.Mesh;
  water: THREE.Mesh | null;
  triangles: number;
}

interface LabelEl {
  label: VoxelLabel | { n: string; x: number; z: number; k: "gauge"; p: number; y: number };
  el: HTMLDivElement;
  w: number;
}

export class VoxelViewer {
  private readonly opts: ViewerOptions;
  private readonly manifest: VoxelManifest;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 12000);
  private readonly worker: Worker;
  private readonly labelLayer: HTMLDivElement;
  private readonly detailGroup = new THREE.Group();
  private readonly lodGroup = new THREE.Group();
  private readonly landMaterials: Record<Level, THREE.ShaderMaterial>;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private width = 1;
  private height = 1;
  private target = new THREE.Vector2();
  private viewH = 820;
  private azimuthStep = 0;
  private azimuth = Math.PI / 4;
  private anim: { from: number; to: number; start: number; dur: number; kind: "az" } | null = null;
  private moveAnim: { fx: number; fz: number; tx: number; tz: number; fv: number; tv: number; start: number; dur: number } | null = null;
  private pulse: { id: number; start: number } | null = null;

  private chunks = new Map<string, Chunk>();
  private requested = new Set<string>();
  private queue: Array<{ level: Level; cx: number; cz: number; key: string }> = [];
  private inflight = 0;
  private reqId = 0;
  private picks = new Map<number, (r: PickResult) => void>();
  private lodCover = new Map<string, number>();
  private waterY: number = HEIGHT.waterSurface;
  private level: Level = "d";
  private lodRequested = false;

  private beaconPoles: THREE.InstancedMesh;
  private beaconHeads: THREE.InstancedMesh;
  private beacons: Array<BeaconItem & { x: number; z: number; color3: THREE.Color }> = [];
  private selectedBeacon: number | null = null;
  private gauges: THREE.InstancedMesh;
  private gaugeItems: Array<GaugeItem & { x: number; z: number; h: number }> = [];
  private layers: Record<LayerName, boolean> = { decisions: true, river: true, labels: true };
  private labels: LabelEl[] = [];
  private gaugeLabels: LabelEl[] = [];

  private frame = 0;
  private chunkCheck = 0;
  private disposed = false;
  private readyFired = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; moved: boolean } | null = null;
  private pinchDist = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly cleanup: Array<() => void> = [];

  static async create(opts: ViewerOptions): Promise<VoxelViewer> {
    const [manifest, labels] = await Promise.all([
      fetch(`${opts.baseUrl}/manifest.json`).then((r) => {
        if (!r.ok) throw new Error(`The voxel town is missing (manifest HTTP ${r.status}). Run pnpm voxel:build.`);
        return r.json() as Promise<VoxelManifest>;
      }),
      fetch(`${opts.baseUrl}/labels.json`).then((r) => (r.ok ? (r.json() as Promise<VoxelLabel[]>) : [])),
    ]);
    return new VoxelViewer(opts, manifest, labels);
  }

  private constructor(opts: ViewerOptions, manifest: VoxelManifest, labels: VoxelLabel[]) {
    this.opts = opts;
    this.manifest = manifest;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !opts.coarsePointer,
      alpha: true,
      powerPreference: opts.coarsePointer ? "default" : "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.className = "focus-ring absolute inset-0 h-full w-full touch-none";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute(
      "aria-label",
      "Voxel map of Kendal. Drag to move, scroll or pinch to zoom, Q and E to rotate, arrow keys to pan. A list view of everything on the map is available from the toolbar.",
    );
    opts.container.appendChild(canvas);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "pointer-events-none absolute inset-0 overflow-hidden";
    this.labelLayer.setAttribute("aria-hidden", "true");
    opts.container.appendChild(this.labelLayer);

    const makeLand = (cell: number, lines: number) =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uCell: { value: cell }, uLines: { value: lines } },
      });
    this.landMaterials = { d: makeLand(manifest.detail.cell, 0.16), l: makeLand(manifest.lod.cell, 0.1) };
    this.waterMaterial = makeLand(manifest.detail.cell, 0.06);

    this.scene.add(this.lodGroup, this.detailGroup);

    // Beacons: a pole and a voxel head, instanced, coloured per decision theme.
    const shadeGeometry = (g: THREE.BufferGeometry) => {
      const geo = g.toNonIndexed();
      const normal = geo.getAttribute("normal");
      const colors = new Float32Array(normal.count * 3);
      for (let i = 0; i < normal.count; i++) {
        const ny = normal.getY(i);
        const nx = normal.getX(i);
        const s = ny > 0.5 ? 1 : ny < -0.5 ? 0.5 : nx > 0.5 ? 0.82 : nx < -0.5 ? 0.66 : normal.getZ(i) > 0 ? 0.9 : 0.6;
        colors.set([s, s, s], i * 3);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.deleteAttribute("uv");
      return geo;
    };
    const pole = shadeGeometry(new THREE.BoxGeometry(1, POLE, 1).translate(0, POLE / 2, 0));
    const head = shadeGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    const beaconMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.beaconPoles = new THREE.InstancedMesh(pole, new THREE.MeshBasicMaterial({ color: 0x2a303c, vertexColors: true }), BEACON_CAPACITY);
    this.beaconHeads = new THREE.InstancedMesh(head, beaconMat, BEACON_CAPACITY);
    for (const m of [this.beaconPoles, this.beaconHeads]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.beaconHeads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BEACON_CAPACITY * 3), 3);
    const gaugeGeo = shadeGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    this.gauges = new THREE.InstancedMesh(gaugeGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), GAUGE_CAPACITY);
    this.gauges.count = 0;
    this.gauges.frustumCulled = false;
    this.gauges.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GAUGE_CAPACITY * 3), 3);
    this.scene.add(this.beaconPoles, this.beaconHeads, this.gauges);

    this.labels = labels.map((l) => this.makeLabel(l));

    // Start over the town centre (Highgate / Market Place).
    const centre = toWorld(54.3265, -2.7465);
    this.target.set(centre.x, centre.z);

    this.worker = new Worker(new URL("./voxel.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorker(ev.data);
    this.worker.onerror = (ev) => opts.onError(`Map worker failed: ${ev.message}`);
    this.post({ type: "init", base: new URL(opts.baseUrl, window.location.href).href.replace(/\/$/, ""), manifest });

    this.bindInput(canvas);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(opts.container);
    this.cleanup.push(() => ro.disconnect());
    const lost = (e: Event) => {
      e.preventDefault();
      opts.onError("The 3D view lost its graphics context.");
    };
    canvas.addEventListener("webglcontextlost", lost);
    this.cleanup.push(() => canvas.removeEventListener("webglcontextlost", lost));

    this.resize();
  }

  // ------------------------------------------------------------------ public API

  setLayer(name: LayerName, visible: boolean) {
    this.layers[name] = visible;
    this.beaconPoles.visible = this.beaconHeads.visible = this.layers.decisions;
    this.gauges.visible = this.layers.river;
    this.requestRender();
  }

  setBeacons(items: BeaconItem[]) {
    const seen = new Map<string, number>();
    this.beacons = items.slice(0, BEACON_CAPACITY).map((b) => {
      const w = toWorld(b.lat, b.lng);
      const key = `${Math.round(w.x / 6)}:${Math.round(w.z / 6)}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      // Several items at one place fan out in a small circle.
      const a = n * 2.4;
      const r = n ? 7 + n * 1.5 : 0;
      return { ...b, x: w.x + Math.cos(a) * r, z: w.z + Math.sin(a) * r, color3: new THREE.Color(b.color) };
    });
    this.beaconPoles.count = this.beaconHeads.count = this.beacons.length;
    this.updateMarkers();
    this.requestRender();
  }

  select(id: number | null) {
    this.selectedBeacon = id;
    this.pulse = id !== null && !this.opts.reducedMotion ? { id, start: performance.now() } : null;
    this.updateMarkers();
    this.requestRender();
  }

  setGauges(items: GaugeItem[]) {
    this.gaugeItems = items.slice(0, GAUGE_CAPACITY).map((g) => {
      const w = toWorld(g.lat, g.lon);
      const rel = g.relative === null ? 0.3 : Math.max(-0.2, Math.min(1.6, g.relative));
      return { ...g, x: w.x, z: w.z, h: 8 + rel * 16 };
    });
    this.gauges.count = this.gaugeItems.length;
    for (const l of this.gaugeLabels) l.el.remove();
    this.gaugeLabels = this.gaugeItems.map((g) =>
      this.makeLabel({ n: `${g.label} ${g.value === null ? "–" : `${g.value.toFixed(2)} m`}`, x: g.x, z: g.z, k: "gauge", p: 0, y: 0 }),
    );
    this.updateMarkers();
    this.requestRender();
  }

  /**
   * Move the water surface with the river. `relative` is 0 at the bottom and 1 at the top of the
   * gauge's typical range. Capped below the banks: the model never shows flooding.
   */
  setWaterLevel(relative: number | null) {
    const h = HEIGHT;
    const r = relative === null ? null : Math.max(0, Math.min(1, relative));
    this.waterY = r === null ? h.waterSurface : h.waterMin + (h.waterMax - h.waterMin) * r;
    this.post({ type: "water", y: this.waterY });
    for (const c of this.chunks.values()) {
      if (c.water) {
        c.water.position.y = this.waterY + (c.level === "l" ? LOD_DROP : 0);
        c.water.updateMatrix();
      }
    }
    this.requestRender();
  }

  rotate(dir: 1 | -1) {
    this.azimuthStep = (this.azimuthStep + dir + 4) % 4;
    const to = Math.PI / 4 + this.azimuthStep * (Math.PI / 2);
    let from = this.azimuth;
    // Take the short way round.
    while (to - from > Math.PI) from += Math.PI * 2;
    while (from - to > Math.PI) from -= Math.PI * 2;
    if (this.opts.reducedMotion) {
      this.azimuth = to;
      this.anim = null;
    } else {
      this.anim = { from, to, start: performance.now(), dur: 320, kind: "az" };
    }
    this.requestRender();
  }

  zoomBy(factor: number) {
    this.setView(this.viewH * factor);
    this.scheduleChunks();
    this.requestRender();
  }

  resetView() {
    const centre = toWorld(54.3265, -2.7465);
    this.flyTo(centre.x, centre.z, 820);
  }

  focusOn(lat: number, lng: number) {
    const w = toWorld(lat, lng);
    this.flyTo(w.x, w.z, Math.min(this.viewH, 700));
  }

  stats() {
    let triangles = 0;
    let detail = 0;
    for (const c of this.chunks.values()) {
      if (c.level === "d") detail++;
      triangles += c.triangles;
    }
    return {
      viewH: Math.round(this.viewH),
      level: this.level,
      chunks: this.chunks.size,
      detailChunks: detail,
      loadedTriangles: triangles,
      drawCalls: this.renderer.info.render.calls,
      drawnTriangles: this.renderer.info.render.triangles,
      gpuGeometries: this.renderer.info.memory.geometries,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.chunkCheck);
    this.worker.terminate();
    for (const f of this.cleanup) f();
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const m of [this.beaconPoles, this.beaconHeads, this.gauges]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
    Object.values(this.landMaterials).forEach((m) => m.dispose());
    this.waterMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  // ------------------------------------------------------------------ camera

  private flyTo(x: number, z: number, viewH: number) {
    if (this.opts.reducedMotion) {
      this.target.set(x, z);
      this.setView(viewH);
      this.scheduleChunks();
      this.requestRender();
      return;
    }
    this.moveAnim = { fx: this.target.x, fz: this.target.y, tx: x, tz: z, fv: this.viewH, tv: viewH, start: performance.now(), dur: 420 };
    this.requestRender();
  }

  private setView(v: number) {
    this.viewH = Math.max(MIN_VIEW, Math.min(MAX_VIEW, v));
  }

  private clampTarget() {
    const m = this.manifest;
    const minX = m.gridMin.x;
    const minZ = m.gridMin.z;
    const maxX = minX + m.detail.width * m.detail.cell;
    const maxZ = minZ + m.detail.height * m.detail.cell;
    this.target.set(Math.max(minX, Math.min(maxX, this.target.x)), Math.max(minZ, Math.min(maxZ, this.target.y)));
  }

  private updateCamera() {
    const aspect = this.width / this.height;
    const halfH = this.viewH / 2;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    const cosE = Math.cos(ELEVATION);
    const dist = 5000;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * cosE * dist,
      Math.sin(ELEVATION) * dist,
      this.target.y + Math.cos(this.azimuth) * cosE * dist,
    );
    this.camera.lookAt(this.target.x, 0, this.target.y);
    this.camera.updateMatrixWorld();
  }

  private groundPoint(px: number, py: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  private panPixels(dx: number, dy: number) {
    const mpp = this.viewH / this.height;
    const az = this.azimuth;
    const rightX = Math.cos(az);
    const rightZ = -Math.sin(az);
    const fwdX = -Math.sin(az);
    const fwdZ = -Math.cos(az);
    const k = mpp / Math.sin(ELEVATION);
    this.target.x += -dx * mpp * rightX + dy * k * fwdX;
    this.target.y += -dx * mpp * rightZ + dy * k * fwdZ;
    this.clampTarget();
    this.scheduleChunks();
    this.requestRender();
  }

  private zoomAt(px: number, py: number, factor: number) {
    this.updateCamera();
    const before = this.groundPoint(px, py);
    this.setView(this.viewH * factor);
    this.updateCamera();
    const after = this.groundPoint(px, py);
    if (before && after) {
      this.target.x += before.x - after.x;
      this.target.y += before.z - after.z;
      this.clampTarget();
    }
    this.scheduleChunks();
    this.requestRender();
  }

  // ------------------------------------------------------------------ input

  private bindInput(canvas: HTMLCanvasElement) {
    const rect = () => canvas.getBoundingClientRect();
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };

    on("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const r = rect();
      this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (this.pointers.size === 1) this.dragStart = { x: e.clientX, y: e.clientY, moved: false };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.dragStart) this.dragStart.moved = true;
      }
    });
    on("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const r = rect();
      const cur = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        if (this.dragStart && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 5) this.dragStart.moved = true;
        if (this.dragStart?.moved) this.panPixels(cur.x - prev.x, cur.y - prev.y);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0 && d > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.pinchDist / d);
        this.pinchDist = d;
      }
    });
    const end = (e: PointerEvent) => {
      const had = this.pointers.delete(e.pointerId);
      if (had && this.pointers.size === 0 && this.dragStart && !this.dragStart.moved && e.type === "pointerup") {
        const r = rect();
        void this.pickAt(e.clientX - r.left, e.clientY - r.top);
      }
      if (this.pointers.size === 0) this.dragStart = null;
      if (this.pointers.size < 2) this.pinchDist = 0;
    };
    on("pointerup", end);
    on("pointercancel", end);
    on(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = rect();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(delta * 0.0015));
      },
      { passive: false },
    );
    on("keydown", (e) => {
      const step = 80;
      const keys: Record<string, () => void> = {
        ArrowLeft: () => this.panPixels(step, 0),
        ArrowRight: () => this.panPixels(-step, 0),
        ArrowUp: () => this.panPixels(0, step),
        ArrowDown: () => this.panPixels(0, -step),
        "+": () => this.zoomBy(0.8),
        "=": () => this.zoomBy(0.8),
        "-": () => this.zoomBy(1.25),
        q: () => this.rotate(-1),
        e: () => this.rotate(1),
      };
      const fn = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    });
  }

  private async pickAt(px: number, py: number) {
    this.updateCamera();
    // Markers first: they are small, so give them a generous screen-space target.
    let best: ViewerPick = { kind: "none" };
    let bestD = 24;
    const s = this.markerScale();
    if (this.layers.decisions) {
      for (const b of this.beacons) {
        const p = this.project(b.x, (POLE + 4) * s, b.z);
        const d = p ? Math.hypot(p.x - px, p.y - py) : Infinity;
        if (d < bestD) {
          bestD = d;
          best = { kind: "beacon", id: b.id };
        }
      }
    }
    if (this.layers.river) {
      for (const g of this.gaugeItems) {
        const p = this.project(g.x, HEIGHT.waterFloor + g.h * s, g.z);
        const d = p ? Math.hypot(p.x - px, p.y - py) : Infinity;
        if (d < bestD) {
          bestD = d;
          best = { kind: "gauge", id: g.id };
        }
      }
    }
    if (best.kind !== "none") {
      this.opts.onPick(best);
      return;
    }
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const req = ++this.reqId;
    const result = await new Promise<PickResult>((resolve) => {
      this.picks.set(req, resolve);
      this.post({ type: "pick", req, o: [origin.x, origin.y, origin.z], d: [direction.x, direction.y, direction.z] });
    });
    if (!result.hit || result.x === undefined || result.z === undefined) {
      this.opts.onPick({ kind: "none" });
      return;
    }
    const ll = toLatLon(result.x, result.z);
    this.opts.onPick({ kind: "place", cls: result.cls ?? CLASS.GROUND, feature: result.feature ?? null, lat: ll.lat, lon: ll.lon });
  }

  // ------------------------------------------------------------------ chunks

  private post(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private onWorker(msg: WorkerResponse) {
    if (this.disposed) return;
    if (msg.type === "pick") {
      this.picks.get(msg.req)?.(msg.result);
      this.picks.delete(msg.req);
      return;
    }
    if (msg.type === "error") {
      this.inflight = Math.max(0, this.inflight - 1);
      console.warn("[voxel]", msg.message);
      this.pump();
      return;
    }
    this.inflight--;
    const key = `${msg.level}:${msg.cx}:${msg.cz}`;
    if (!this.requested.has(key)) {
      this.pump();
      return;
    }
    const chunk = this.buildChunk(msg.level, msg.cx, msg.cz, msg.land, msg.water);
    this.chunks.set(key, chunk);
    (msg.level === "d" ? this.detailGroup : this.lodGroup).add(chunk.land);
    if (chunk.water) (msg.level === "d" ? this.detailGroup : this.lodGroup).add(chunk.water);
    if (msg.level === "d") this.coverLod(msg.cx, msg.cz, 1);
    else this.applyLodVisibility();
    if (!this.readyFired && msg.level === "l") {
      this.readyFired = true;
      this.opts.onReady?.();
    }
    this.pump();
    this.requestRender();
  }

  private buildChunk(level: Level, cx: number, cz: number, land: MeshBuffers, water: MeshBuffers): Chunk {
    const cell = level === "d" ? this.manifest.detail.cell : this.manifest.lod.cell;
    const size = CHUNK * cell;
    const drop = level === "l" ? LOD_DROP : 0;
    const sphere = new THREE.Sphere(
      new THREE.Vector3((size / 2) * POS_SCALE, 0, (size / 2) * POS_SCALE),
      Math.hypot(size / 2, size / 2, 12) * POS_SCALE,
    );
    const make = (b: MeshBuffers, material: THREE.Material, y: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
      g.setAttribute("acolor", new THREE.BufferAttribute(b.colors, 3, true));
      g.setIndex(new THREE.BufferAttribute(b.indices, 1));
      g.boundingSphere = sphere.clone();
      const mesh = new THREE.Mesh(g, material);
      mesh.scale.setScalar(1 / POS_SCALE);
      mesh.position.set(this.manifest.gridMin.x + cx * size, y, this.manifest.gridMin.z + cz * size);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      return mesh;
    };
    const landMesh = make(land, this.landMaterials[level], drop);
    const waterMesh = water.quads ? make(water, this.waterMaterial, this.waterY + drop) : null;
    return { level, cx, cz, land: landMesh, water: waterMesh, triangles: (land.quads + water.quads) * 2 };
  }

  private disposeChunk(c: Chunk) {
    c.land.removeFromParent();
    c.land.geometry.dispose();
    if (c.water) {
      c.water.removeFromParent();
      c.water.geometry.dispose();
    }
  }

  /** Hide a low-detail chunk once every detailed chunk on top of it has arrived. */
  private coverLod(cx: number, cz: number, delta: number) {
    const f = this.manifest.lod.cell / this.manifest.detail.cell;
    const key = `${Math.floor(cx / f)}:${Math.floor(cz / f)}`;
    this.lodCover.set(key, (this.lodCover.get(key) ?? 0) + delta);
    this.applyLodVisibility();
  }

  private applyLodVisibility() {
    const f = this.manifest.lod.cell / this.manifest.detail.cell;
    const maxCx = Math.ceil(this.manifest.detail.width / CHUNK);
    const maxCz = Math.ceil(this.manifest.detail.height / CHUNK);
    for (const c of this.chunks.values()) {
      if (c.level !== "l") continue;
      let visible = true;
      if (this.level === "d") {
        const need = Math.min(f, maxCx - c.cx * f) * Math.min(f, maxCz - c.cz * f);
        visible = (this.lodCover.get(`${c.cx}:${c.cz}`) ?? 0) < need;
      }
      c.land.visible = visible;
      if (c.water) c.water.visible = visible;
    }
  }

  private scheduleChunks() {
    if (this.chunkCheck) return;
    this.chunkCheck = window.setTimeout(() => {
      this.chunkCheck = 0;
      this.updateChunks();
    }, 60);
  }

  private updateChunks() {
    if (this.disposed) return;
    this.updateCamera();
    const m = this.manifest;
    const newLevel: Level = this.viewH <= DETAIL_MAX_VIEW ? "d" : "l";
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.detailGroup.visible = newLevel === "d";
      this.applyLodVisibility();
    }

    if (!this.lodRequested) {
      this.lodRequested = true;
      const n = Math.ceil(m.lod.width / CHUNK);
      const nz = Math.ceil(m.lod.height / CHUNK);
      for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < n; cx++) this.enqueue("l", cx, cz);
    }

    if (this.level === "d") {
      const pts = [
        this.groundPoint(0, 0),
        this.groundPoint(this.width, 0),
        this.groundPoint(0, this.height),
        this.groundPoint(this.width, this.height),
      ].filter(Boolean) as THREE.Vector3[];
      if (pts.length) {
        const size = CHUNK * m.detail.cell;
        const minX = Math.min(...pts.map((p) => p.x)) - 20;
        const maxX = Math.max(...pts.map((p) => p.x)) + 20;
        const minZ = Math.min(...pts.map((p) => p.z)) - 20;
        const maxZ = Math.max(...pts.map((p) => p.z)) + 20;
        const nx = Math.ceil(m.detail.width / CHUNK);
        const nz = Math.ceil(m.detail.height / CHUNK);
        const cx0 = Math.max(0, Math.floor((minX - m.gridMin.x) / size));
        const cx1 = Math.min(nx - 1, Math.floor((maxX - m.gridMin.x) / size));
        const cz0 = Math.max(0, Math.floor((minZ - m.gridMin.z) / size));
        const cz1 = Math.min(nz - 1, Math.floor((maxZ - m.gridMin.z) / size));
        const tcx = (this.target.x - m.gridMin.x) / size;
        const tcz = (this.target.y - m.gridMin.z) / size;
        // The visible ground is a rotated quadrilateral; keep chunks whose centre is inside it
        // (expanded by half a chunk diagonal) rather than everything in its bounding box.
        const quad = [pts[0], pts[1], pts[3], pts[2]];
        const margin = size * 0.75;
        const edgeDist = (i: number, x: number, z: number) => {
          const a = quad[i];
          const b = quad[(i + 1) % 4];
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          return (ex * (z - a.z) - ez * (x - a.x)) / (Math.hypot(ex, ez) || 1);
        };
        const qx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
        const qz = (quad[0].z + quad[1].z + quad[2].z + quad[3].z) / 4;
        const orient = Math.sign(edgeDist(0, qx, qz)) || 1; // which side of each edge is "inside"
        const inside = (x: number, z: number) => {
          for (let i = 0; i < 4; i++) if (edgeDist(i, x, z) * orient < -margin) return false;
          return true;
        };
        const wanted: Array<[number, number, number]> = [];
        for (let cz = cz0; cz <= cz1; cz++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const wx = m.gridMin.x + (cx + 0.5) * size;
            const wz = m.gridMin.z + (cz + 0.5) * size;
            if (pts.length === 4 && !inside(wx, wz)) continue;
            wanted.push([cx, cz, Math.hypot(cx + 0.5 - tcx, cz + 0.5 - tcz)]);
          }
        }
        wanted.sort((a, b) => a[2] - b[2]);
        // Newest view first: drop queued detail requests that are no longer wanted.
        const wantedKeys = new Set(wanted.map(([cx, cz]) => `d:${cx}:${cz}`));
        this.queue = this.queue.filter((q) => q.level === "l" || wantedKeys.has(q.key));
        for (const q of [...this.requested]) {
          if (q.startsWith("d:") && !wantedKeys.has(q) && !this.chunks.has(q)) this.requested.delete(q);
        }
        for (const [cx, cz] of wanted) this.enqueue("d", cx, cz, true);
        this.evict(tcx, tcz, wantedKeys);
      }
    }
    this.pump();
  }

  private enqueue(level: Level, cx: number, cz: number, front = false) {
    const key = `${level}:${cx}:${cz}`;
    if (this.requested.has(key)) return;
    this.requested.add(key);
    const item = { level, cx, cz, key };
    if (front) this.queue.splice(this.queue.findIndex((q) => q.level === "l") >>> 0, 0, item);
    else this.queue.push(item);
  }

  private pump() {
    while (this.inflight < MAX_INFLIGHT && this.queue.length) {
      const next = this.queue.shift()!;
      this.inflight++;
      this.post({ type: "mesh", req: ++this.reqId, level: next.level, cx: next.cx, cz: next.cz });
    }
  }

  private evict(tcx: number, tcz: number, keep: Set<string>) {
    const detail = [...this.chunks.entries()].filter(([, c]) => c.level === "d");
    if (detail.length <= MAX_DETAIL_CHUNKS) return;
    detail
      .filter(([k]) => !keep.has(k))
      .sort((a, b) => Math.hypot(b[1].cx - tcx, b[1].cz - tcz) - Math.hypot(a[1].cx - tcx, a[1].cz - tcz))
      .slice(0, detail.length - MAX_DETAIL_CHUNKS)
      .forEach(([k, c]) => {
        this.disposeChunk(c);
        this.chunks.delete(k);
        this.requested.delete(k);
        this.coverLod(c.cx, c.cz, -1);
      });
  }

  // ------------------------------------------------------------------ markers and labels

  /** Markers grow when zoomed out so they stay clickable. */
  private markerScale() {
    return Math.max(1.2, this.viewH / 520);
  }

  private updateMarkers(now = performance.now()) {
    const s = this.markerScale();
    let pulsing = false;
    this.beacons.forEach((b, i) => {
      this.tmpMatrix.makeScale(s, s, s).setPosition(b.x, 0, b.z);
      this.beaconPoles.setMatrixAt(i, this.tmpMatrix);
      let size = (6 + (b.urgency ?? 1) * 1.6) * s;
      const selected = b.id === this.selectedBeacon;
      if (selected && this.pulse) {
        const t = (now - this.pulse.start) / 1600;
        if (t < 1) {
          size *= 1 + 0.35 * Math.sin(t * Math.PI * 3) ** 2;
          pulsing = true;
        } else this.pulse = null;
      } else if (selected) size *= 1.3;
      this.tmpMatrix.makeScale(size, size, size).setPosition(b.x, POLE * s, b.z);
      this.beaconHeads.setMatrixAt(i, this.tmpMatrix);
      this.beaconHeads.setColorAt(i, selected ? BEACON_SELECTED : BEACON_COLOR);
    });
    this.beaconPoles.instanceMatrix.needsUpdate = true;
    this.beaconHeads.instanceMatrix.needsUpdate = true;
    if (this.beaconHeads.instanceColor) this.beaconHeads.instanceColor.needsUpdate = true;

    const colors = { high: new THREE.Color("#c8452e"), normal: new THREE.Color("#3a86c8"), low: new THREE.Color("#8fbfe6"), unknown: new THREE.Color("#8a8f98") };
    this.gaugeItems.forEach((g, i) => {
      this.tmpMatrix.makeScale(3 * s, g.h * s, 3 * s).setPosition(g.x, HEIGHT.waterFloor, g.z);
      this.gauges.setMatrixAt(i, this.tmpMatrix);
      this.gauges.setColorAt(i, colors[g.status]);
    });
    this.gauges.instanceMatrix.needsUpdate = true;
    if (this.gauges.instanceColor) this.gauges.instanceColor.needsUpdate = true;
    return pulsing;
  }

  private makeLabel(label: LabelEl["label"]): LabelEl {
    const el = document.createElement("div");
    el.className = "map-label";
    el.dataset.kind = label.k;
    el.textContent = label.n;
    el.style.display = "none";
    this.labelLayer.appendChild(el);
    const perChar = label.k === "place" ? 9.5 : label.k === "gauge" ? 6.8 : 6.6;
    return { label, el, w: label.n.length * perChar + 10 };
  }

  private project(x: number, y: number, z: number) {
    this.tmp.set(x, y, z).project(this.camera);
    if (this.tmp.x < -1.1 || this.tmp.x > 1.1 || this.tmp.y < -1.1 || this.tmp.y > 1.1) return null;
    return { x: (this.tmp.x + 1) * 0.5 * this.width, y: (1 - this.tmp.y) * 0.5 * this.height };
  }

  private updateLabels() {
    const placed: Array<[number, number, number, number]> = [];
    const fits = (x: number, y: number, w: number, h: number) => {
      for (const [a, b, c, d] of placed) if (x < c && x + w > a && y < d && y + h > b) return false;
      placed.push([x, y, x + w, y + h]);
      return true;
    };
    const v = this.viewH;
    const s = this.markerScale();
    for (const [i, l] of this.gaugeLabels.entries()) {
      const g = this.gaugeItems[i];
      const p = this.layers.river && g ? this.project(g.x, HEIGHT.waterFloor + g.h * s, g.z) : null;
      if (p && fits(p.x - l.w / 2, p.y - 26, l.w, 18)) {
        l.el.style.display = "";
        l.el.style.transform = `translate(${Math.round(p.x - l.w / 2)}px, ${Math.round(p.y - 26)}px)`;
      } else l.el.style.display = "none";
    }
    let shown = 0;
    for (const l of this.labels) {
      const { k, p: prio } = l.label;
      const allowed =
        this.layers.labels &&
        shown < 70 &&
        (k === "place" ? v < 6000 : k === "water" ? v < 4200 : k === "landmark" ? v < 2300 : prio <= 3 ? v < 2600 : v < 1300);
      const p = allowed ? this.project(l.label.x, 0, l.label.z) : null;
      if (p && fits(p.x - l.w / 2, p.y - 8, l.w, 16)) {
        l.el.style.display = "";
        l.el.style.transform = `translate(${Math.round(p.x - l.w / 2)}px, ${Math.round(p.y - 8)}px)`;
        shown++;
      } else l.el.style.display = "none";
    }
  }

  // ------------------------------------------------------------------ rendering

  private resize() {
    const r = this.opts.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.width, this.height, false);
    this.scheduleChunks();
    this.requestRender();
  }

  requestRender() {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (now: number) => {
    this.frame = 0;
    let animating = false;
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.start) / this.anim.dur);
      const e = 1 - (1 - t) ** 4;
      this.azimuth = this.anim.from + (this.anim.to - this.anim.from) * e;
      if (t >= 1) this.anim = null;
      else animating = true;
      this.scheduleChunks();
    }
    if (this.moveAnim) {
      const a = this.moveAnim;
      const t = Math.min(1, (now - a.start) / a.dur);
      const e = 1 - (1 - t) ** 4;
      this.target.set(a.fx + (a.tx - a.fx) * e, a.fz + (a.tz - a.fz) * e);
      this.setView(a.fv + (a.tv - a.fv) * e);
      if (t >= 1) this.moveAnim = null;
      else animating = true;
      this.scheduleChunks();
    }
    if (this.updateMarkers(now)) animating = true;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    if (animating) this.requestRender();
  };
}
