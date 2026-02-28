"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTerrainGrid } from "./useTerrainGrid";
import {
  YOSEMITE_BBOX,
  MESH_WIDTH,
  MESH_HEIGHT,
  MESH_RES,
} from "@/data/trailBbox";
import { sensorData } from "@/data/sensors";
import { droneData } from "@/data/drones";
import { incidentData } from "@/data/incidents";
import { landmarkData } from "@/data/landmarks";
import { yosemiteH } from "@/lib/elevation/fallbackTerrain";
import {
  demGridToVertexHeights,
  latLonToMesh,
  heightAtMeshPos,
} from "@/lib/coordMapping";
import type { ElevationResponse, BBox } from "@/types/elevation";
import type { DangerZone } from "@/types/backend";
import type {
  HotspotPredictionResponse,
  PlacementSuggestions,
} from "@/types/hotspots";
import type { IncidentMarker } from "@/types/markers";

export interface CameraControls {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  topView: () => void;
}

interface Props {
  layers: {
    sensors: boolean;
    drones: boolean;
    incidents: boolean;
    zones: boolean;
    landmarks: boolean;
    hotspots: boolean;
    osm: boolean;
  };
  viewMode: "3d" | "wireframe";
  focusMode?: boolean;
  boxZoomMode?: boolean;
  dangerZones?: DangerZone[];
  hotspotData?: HotspotPredictionResponse | null;
  placementData?: PlacementSuggestions | null;
  incidentMarkers?: IncidentMarker[];
  onControlsReady?: (ctrl: CameraControls) => void;
}

// ── Satellite tile loading ────────────────────────────────────────────────────

const SAT_ZOOM = 13;

// lat → Web Mercator tile fraction (y increases downward = south)
function lat2merc(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

// Fetch satellite tiles, stitch, then crop to the exact bbox pixels.
// Returns a CanvasTexture that maps 1:1 to PlaneGeometry default UVs — no UV math needed.
async function fetchSatTexture(bbox: BBox): Promise<THREE.Texture | null> {
  try {
    const z = SAT_ZOOM,
      n = 2 ** z,
      TS = 256;

    // Tile range with 1-tile padding so edges are never cut
    const xMin = Math.floor(((bbox.west + 180) / 360) * n) - 1;
    const xMax = Math.floor(((bbox.east + 180) / 360) * n) + 1;
    const yMin = Math.floor(lat2merc(bbox.north) * n) - 1;
    const yMax = Math.floor(lat2merc(bbox.south) * n) + 1;

    const cols = xMax - xMin + 1;
    const rows = yMax - yMin + 1;

    console.log(
      `[SAT] zoom=${z} grid=${cols}×${rows} (${cols * rows} tiles)  xMin=${xMin} yMin=${yMin}`,
    );

    // Stitch all tiles into one canvas
    const raw = document.createElement("canvas");
    raw.width = cols * TS;
    raw.height = rows * TS;
    const ctx = raw.getContext("2d")!;

    // Esri World Imagery — free, no key, browser CORS ✓, URL: /{z}/{y}/{x}
    let ok = 0,
      fail = 0;
    await Promise.all(
      Array.from({ length: rows * cols }, (_, i) => {
        const tx = xMin + (i % cols);
        const ty = yMin + Math.floor(i / cols);
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
        return fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`${r.status}`);
            return r.blob();
          })
          .then((b) => createImageBitmap(b))
          .then((bmp) => {
            ctx.drawImage(bmp, (tx - xMin) * TS, (ty - yMin) * TS);
            ok++;
          })
          .catch((e) => {
            console.warn(`[SAT] tile z=${z} y=${ty} x=${tx} FAILED:`, e);
            fail++;
          });
      }),
    );

    console.log(
      `[SAT] fetch done: ${ok} ok, ${fail} failed. Raw canvas: ${raw.width}×${raw.height}px`,
    );

    // Pixel coords of the exact bbox edges within the stitched canvas
    const pxL = (((bbox.west + 180) / 360) * n - xMin) * TS;
    const pxR = (((bbox.east + 180) / 360) * n - xMin) * TS;
    const pyT = (lat2merc(bbox.north) * n - yMin) * TS; // north = smaller y (top)
    const pyB = (lat2merc(bbox.south) * n - yMin) * TS; // south = larger y (bottom)

    const cropW = Math.round(pxR - pxL);
    const cropH = Math.round(pyB - pyT);

    console.log(
      `[SAT] crop: pxL=${pxL.toFixed(1)} pxR=${pxR.toFixed(1)} pyT=${pyT.toFixed(1)} pyB=${pyB.toFixed(1)}  → ${cropW}×${cropH}px`,
    );

    // Crop to exact bbox pixels
    const crop = document.createElement("canvas");
    crop.width = cropW;
    crop.height = cropH;
    crop
      .getContext("2d")!
      .drawImage(
        raw,
        Math.round(pxL),
        Math.round(pyT),
        cropW,
        cropH,
        0,
        0,
        cropW,
        cropH,
      );

    console.log(`[SAT] texture ready: ${crop.width}×${crop.height}px`);

    // CanvasTexture flipY=true (default): canvas top (north) → texture v=1, canvas bottom (south) → v=0
    // PlaneGeometry (after rotateX): UV v=0 = south, v=1 = north — perfect 1:1 match
    return new THREE.CanvasTexture(crop);
  } catch (e) {
    console.error("[SAT] fetchSatTexture threw:", e);
    return null;
  }
}

// ── Text sprite ───────────────────────────────────────────────────────────────

function makeTextSprite(text: string, hexColor: string, scale = 1.0): THREE.Sprite {
  // Render at 4× logical resolution for crisp text at any zoom
  const DPR = 4;
  const PAD_X = 14,
    PAD_Y = 10;
  const FONT_SIZE = 15; // logical px
  const DOT_R = 5; // colored dot radius (logical)

  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d")!;

  // Measure at full res
  ctx.font = `600 ${FONT_SIZE * DPR}px -apple-system, "Segoe UI", sans-serif`;
  const tw = ctx.measureText(text).width;

  const logW = Math.ceil(tw / DPR) + PAD_X * 2 + DOT_R * 2 + 6;
  const logH = FONT_SIZE + PAD_Y * 2;
  cv.width = logW * DPR;
  cv.height = logH * DPR;

  // Background pill
  const r = (logH / 2) * DPR;
  ctx.beginPath();
  ctx.roundRect(0, 0, cv.width, cv.height, r);
  ctx.fillStyle = "rgba(3, 9, 9, 0.88)";
  ctx.fill();

  // Border
  ctx.beginPath();
  ctx.roundRect(1, 1, cv.width - 2, cv.height - 2, r - 1);
  ctx.strokeStyle = hexColor;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = DPR * 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Colored dot
  const dotX = PAD_X * DPR + DOT_R * DPR;
  const dotY = cv.height / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, DOT_R * DPR, 0, Math.PI * 2);
  ctx.fillStyle = hexColor;
  ctx.fill();

  // Text
  ctx.font = `600 ${FONT_SIZE * DPR}px -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#e8f4f4";
  ctx.textBaseline = "middle";
  ctx.fillText(text, dotX + DOT_R * DPR + 6 * DPR, dotY);

  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  // World scale uses logical dimensions so size stays consistent
  sprite.scale.set((logW / logH) * 1.1 * scale, 1.1 * scale, 1);
  return sprite;
}

export default function TerrainScene({
  layers,
  viewMode,
  focusMode,
  boxZoomMode,
  dangerZones,
  hotspotData,
  placementData,
  incidentMarkers,
  onControlsReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elevData = useTerrainGrid(YOSEMITE_BBOX, MESH_RES);
  const elevRef = useRef<ElevationResponse | null>(null);
  const layersRef = useRef(layers);
  const viewModeRef = useRef(viewMode);
  const focusModeRef = useRef(focusMode ?? false);
  const boxZoomModeRef = useRef(boxZoomMode ?? false);
  const dangerZonesRef = useRef<DangerZone[]>([]);
  const hotspotRef = useRef<HotspotPredictionResponse | null>(null);
  const placementRef = useRef<PlacementSuggestions | null>(null);

  useEffect(() => { elevRef.current = elevData; }, [elevData]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { focusModeRef.current = focusMode ?? false; }, [focusMode]);
  useEffect(() => { boxZoomModeRef.current = boxZoomMode ?? false; }, [boxZoomMode]);
  useEffect(() => { dangerZonesRef.current = dangerZones ?? []; }, [dangerZones]);
  useEffect(() => { hotspotRef.current = hotspotData ?? null; }, [hotspotData]);
  useEffect(() => { placementRef.current = placementData ?? null; }, [placementData]);
  const incidentMarkersRef = useRef<IncidentMarker[]>(incidentMarkers ?? incidentData);
  useEffect(() => { incidentMarkersRef.current = incidentMarkers ?? incidentData; }, [incidentMarkers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ──────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0x040b0b, 1);

    // ── Scene & Camera ────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040b0b);
    scene.fog = new THREE.FogExp2(0x040b0b, 0.018);

    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 300);
    camera.position.set(0, 22, 28);

    // ── OrbitControls (no auto-rotate) ────────────────────────────────
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.5, 0);
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.3;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    controls.zoomSpeed = 1.4;
    controls.update();

    // Expose camera control functions to the parent
    onControlsReady?.({
      zoomIn: () => {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, controls.getDistance() * 0.3);
        controls.update();
      },
      zoomOut: () => {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, -controls.getDistance() * 0.3);
        controls.update();
      },
      reset: () => {
        camera.position.set(0, 22, 28);
        controls.target.set(0, 1.5, 0);
        controls.update();
      },
      topView: () => {
        focusTween = {
          fromPos: camera.position.clone(),
          fromTarget: controls.target.clone(),
          toPos: new THREE.Vector3(0, 38, 0.001),
          toTarget: new THREE.Vector3(0, 1.5, 0),
          t: 0,
        };
      },
    });

    // ── Arrow key panning ─────────────────────────────────────────────
    const keys = new Set<string>();
    const ARROW = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (ARROW.has(e.key)) {
        e.preventDefault();
        keys.add(e.key);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // ── Resize ────────────────────────────────────────────────────────
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }

    // ── Lighting ──────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x0a1a15, 1.5));
    const dirLight = new THREE.DirectionalLight(0x3060a0, 1.0);
    dirLight.position.set(-5, 10, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x102010, 0.6);
    fillLight.position.set(5, 5, -4);
    scene.add(fillLight);

    // ── Terrain ───────────────────────────────────────────────────────
    const RES = MESH_RES,
      SZ_W = MESH_WIDTH,
      SZ_H = MESH_HEIGHT;
    const tGeo = new THREE.PlaneGeometry(SZ_W, SZ_H, RES - 1, RES - 1);
    tGeo.rotateX(-Math.PI / 2);
    const tPos = tGeo.attributes.position;
    const vCol = new Float32Array(tPos.count * 3);
    let heightsArray: Float32Array | null = null;

    // Sample terrain height at a world-space position (closure over heightsArray)
    function surf(wx: number, wz: number): number {
      return heightsArray
        ? heightAtMeshPos(wx, wz, heightsArray, RES, SZ_W, SZ_H)
        : 0;
    }

    // Metres per Three.js world unit for hotspot radius conversion
    const LAT_M_PER_UNIT =
      ((YOSEMITE_BBOX.north - YOSEMITE_BBOX.south) * 111120) / SZ_H;
    const LON_M_PER_UNIT =
      ((YOSEMITE_BBOX.east - YOSEMITE_BBOX.west) *
        111120 *
        Math.cos((37.76 * Math.PI) / 180)) /
      SZ_W;
    const M_PER_UNIT = (LAT_M_PER_UNIT + LON_M_PER_UNIT) / 2;

    function buildHeights(elev: ElevationResponse | null): Float32Array {
      if (elev && elev.grid.length === RES * RES) {
        return demGridToVertexHeights(
          elev.grid,
          RES,
          elev.minElev,
          elev.maxElev,
          4.5,
        );
      }
      const arr = new Float32Array(RES * RES);
      for (let row = 0; row < RES; row++) {
        for (let col = 0; col < RES; col++) {
          const x = (col / (RES - 1) - 0.5) * SZ_W;
          const z = (row / (RES - 1) - 0.5) * SZ_H;
          arr[row * RES + col] = yosemiteH(x, z);
        }
      }
      return arr;
    }

    function applyHeights(heights: Float32Array) {
      for (let i = 0; i < tPos.count; i++) {
        const x = tPos.getX(i),
          z = tPos.getZ(i);
        const col = Math.round((x / SZ_W + 0.5) * (RES - 1));
        const row = Math.round((z / SZ_H + 0.5) * (RES - 1));
        const h =
          heights[Math.max(0, Math.min(RES * RES - 1, row * RES + col))];
        tPos.setY(i, h);

        const t = Math.min(1, h / 4.5);
        let r, g, b;
        if (t < 0.05) {
          r = 0.05; g = 0.09; b = 0.06;
        } else if (t < 0.15) {
          r = 0.07 + t * 0.25; g = 0.13 + t * 0.4; b = 0.06;
        } else if (t < 0.35) {
          r = 0.15 + t * 0.45; g = 0.16 + t * 0.4; b = 0.1 + t * 0.3;
        } else if (t < 0.58) {
          r = 0.32 + t * 0.35; g = 0.3 + t * 0.28; b = 0.26 + t * 0.22;
        } else if (t < 0.8) {
          r = 0.48 + t * 0.2; g = 0.46 + t * 0.16; b = 0.44 + t * 0.14;
        } else {
          r = 0.66 + (t - 0.8) * 1.4;
          g = 0.68 + (t - 0.8) * 1.1;
          b = 0.82 + (t - 0.8) * 0.8;
        }
        vCol[i * 3] = r;
        vCol[i * 3 + 1] = g;
        vCol[i * 3 + 2] = b;
      }
      tGeo.setAttribute("color", new THREE.BufferAttribute(vCol, 3));
      tGeo.computeVertexNormals();
      tPos.needsUpdate = true;
    }

    // ── Terrain skirt ─────────────────────────────────────────────────
    const SKIRT_FLOOR = -4.5;
    let skirtMesh: THREE.Mesh | null = null;

    function rebuildSkirt() {
      if (skirtMesh) {
        scene.remove(skirtMesh);
        skirtMesh.geometry.dispose();
      }

      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      // Dark earthy base colour for the bottom of the walls + cap
      const BASE = [0.04, 0.07, 0.05] as const;

      function addEdge(getVI: (i: number) => number) {
        const base = pos.length / 3;
        for (let i = 0; i < RES; i++) {
          const vi = getVI(i);
          const x = tPos.getX(vi),
            y = tPos.getY(vi),
            z = tPos.getZ(vi);
          // top vertex — inherit terrain edge colour from vCol
          pos.push(x, y, z);
          col.push(vCol[vi * 3], vCol[vi * 3 + 1], vCol[vi * 3 + 2]);
          // bottom vertex — dark base
          pos.push(x, SKIRT_FLOOR, z);
          col.push(...BASE);
        }
        for (let i = 0; i < RES - 1; i++) {
          const t0 = base + i * 2,
            b0 = t0 + 1,
            t1 = base + (i + 1) * 2,
            b1 = t1 + 1;
          idx.push(t0, b0, t1, b0, b1, t1);
        }
      }

      addEdge((i) => i); // north (row=0)
      addEdge((i) => (RES - 1) * RES + i); // south (row=RES-1)
      addEdge((i) => i * RES); // west  (col=0)
      addEdge((i) => i * RES + (RES - 1)); // east  (col=RES-1)

      // Flat bottom cap — same dark base colour, both winding directions
      const b = pos.length / 3;
      pos.push(
        -SZ_W / 2, SKIRT_FLOOR, -SZ_H / 2,
         SZ_W / 2, SKIRT_FLOOR, -SZ_H / 2,
         SZ_W / 2, SKIRT_FLOOR,  SZ_H / 2,
        -SZ_W / 2, SKIRT_FLOOR,  SZ_H / 2,
      );
      for (let i = 0; i < 4; i++) col.push(...BASE);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3); // top face
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // bottom face (reverse)

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      skirtMesh = new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      scene.add(skirtMesh);
    }

    heightsArray = buildHeights(null);
    applyHeights(heightsArray);
    rebuildSkirt();

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrainMesh = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(
      tGeo,
      terrainMat,
    );
    scene.add(terrainMesh);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    scene.add(new THREE.Mesh(tGeo, wireMat));

    // ── Surface groups (repositioned when terrain changes) ────────────
    interface SurfGroup {
      wx: number;
      wz: number;
      group: THREE.Group;
    }
    const surfGroups: SurfGroup[] = [];

    function repositionSurface() {
      if (!heightsArray) return;
      surfGroups.forEach(({ wx, wz, group }) => {
        group.position.y = heightAtMeshPos(
          wx,
          wz,
          heightsArray!,
          RES,
          SZ_W,
          SZ_H,
        );
      });
    }

    function addSurfGroup(wx: number, wz: number): THREE.Group {
      const group = new THREE.Group();
      group.position.set(wx, 0, wz);
      scene.add(group);
      surfGroups.push({ wx, wz, group });
      return group;
    }

    // ── Sensor markers ────────────────────────────────────────────────
    const colorMap: Record<string, number> = {
      ok: 0x00ff88,
      warn: 0xff8c42,
      alert: 0xff3b3b,
      off: 0x445555,
    };
    const sensorAnims: {
      ring: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
      phase: number;
      dot: THREE.Mesh;
    }[] = [];

    sensorData.forEach((s) => {
      const { x, z } = latLonToMesh(s.lat, s.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
      const c = colorMap[s.state] ?? 0x00ff88;
      const g = addSurfGroup(x, z);

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8),
        new THREE.MeshBasicMaterial({ color: c }),
      );
      dot.position.y = 0.08;
      g.add(dot);

      const mat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.11, 14), mat);
      ring.position.y = 0.02;
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);

      sensorAnims.push({ ring, mat, phase: Math.random() * Math.PI * 2, dot });
    });

    // ── Drone markers ─────────────────────────────────────────────────
    const droneAnims: {
      mesh: THREE.Mesh;
      circle: THREE.Mesh;
      circleMat: THREE.MeshBasicMaterial;
      phase: number;
      baseAlt: number;
    }[] = [];

    droneData.forEach((d) => {
      const { x, z } = latLonToMesh(d.lat, d.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
      const g = addSurfGroup(x, z);

      const drone = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: d.color }),
      );
      drone.position.y = d.alt;
      g.add(drone);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, d.alt, 0),
      ]);
      g.add(
        new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({
            color: d.color,
            transparent: true,
            opacity: 0.3,
          }),
        ),
      );

      const circleMat = new THREE.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
      });
      const circle = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.6, 24),
        circleMat,
      );
      circle.position.y = 0.02;
      circle.rotation.x = -Math.PI / 2;
      g.add(circle);

      droneAnims.push({
        mesh: drone,
        circle,
        circleMat,
        phase: Math.random() * Math.PI * 2,
        baseAlt: d.alt,
      });
    });

    // ── Incident markers ──────────────────────────────────────────────
    const incidentAnims: {
      pulse: THREE.Mesh;
      pulseMat: THREE.MeshBasicMaterial;
      phase: number;
    }[] = [];

    incidentMarkersRef.current.forEach((inc) => {
      const { x, z } = latLonToMesh(
        inc.lat,
        inc.lon,
        YOSEMITE_BBOX,
        SZ_W,
        SZ_H,
      );
      const g = addSurfGroup(x, z);

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 10, 10),
        new THREE.MeshBasicMaterial({ color: inc.color }),
      );
      dot.position.y = 0.10;
      g.add(dot);

      const pulseMat = new THREE.MeshBasicMaterial({
        color: inc.color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.22, 18),
        pulseMat,
      );
      pulse.position.y = 0.02;
      pulse.rotation.x = -Math.PI / 2;
      g.add(pulse);

      incidentAnims.push({
        pulse,
        pulseMat,
        phase: Math.random() * Math.PI * 2,
      });
    });

    // ── Search zones ──────────────────────────────────────────────────
    const zoneGroups: THREE.Group[] = [];

    function makeSearchZone(
      cx: number,
      cz: number,
      rx: number,
      rz: number,
      color: number,
    ) {
      const g = addSurfGroup(cx, cz);
      const geo = new THREE.PlaneGeometry(rx * 2, rz * 2);
      geo.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
        }),
      );
      fill.position.y = 0.15;
      g.add(fill);
      const border = new THREE.LineLoop(
        geo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
        }),
      );
      border.position.y = 0.15;
      g.add(border);
      zoneGroups.push(g);
    }

    incidentMarkersRef.current.forEach((inc, i) => {
      const { x, z } = latLonToMesh(
        inc.lat,
        inc.lon,
        YOSEMITE_BBOX,
        SZ_W,
        SZ_H,
      );
      makeSearchZone(x, z, i === 0 ? 2.5 : 2.0, i === 0 ? 2.0 : 1.8, inc.color);
    });
    {
      const { x, z } = latLonToMesh(37.728, -119.55, YOSEMITE_BBOX, SZ_W, SZ_H);
      makeSearchZone(x, z, 3.0, 2.5, 0x4a9fd4);
    }

    // ── Backend terrain danger zones (loaded async, added lazily) ─────
    const backendZoneGroups: THREE.Group[] = [];
    let prevBackendZoneCount = 0;

    function hazardHex(score: number): number {
      if (score < 0.25) return 0x22c55e;
      if (score < 0.5) return 0xeab308;
      if (score < 0.75) return 0xf97316;
      return 0xef4444;
    }

    function addBackendZones() {
      const zones = dangerZonesRef.current;
      if (zones.length <= prevBackendZoneCount) return;
      const newZones = zones.slice(prevBackendZoneCount);
      prevBackendZoneCount = zones.length;

      newZones.forEach((zone) => {
        const { x, z } = latLonToMesh(
          zone.center.lat,
          zone.center.lon,
          YOSEMITE_BBOX,
          SZ_W,
          SZ_H,
        );
        // Convert lat/lon extents to mesh units
        const lonSpan = YOSEMITE_BBOX.east - YOSEMITE_BBOX.west;
        const latSpan = YOSEMITE_BBOX.north - YOSEMITE_BBOX.south;
        const rx = Math.max(
          0.4,
          ((zone.bounds.ne.lon - zone.bounds.sw.lon) / lonSpan) * SZ_W * 0.5,
        );
        const rz = Math.max(
          0.4,
          ((zone.bounds.ne.lat - zone.bounds.sw.lat) / latSpan) * SZ_H * 0.5,
        );
        const color = hazardHex(zone.hazard_score);

        const g = addSurfGroup(x, z);
        const geo = new THREE.PlaneGeometry(rx * 2, rz * 2);
        geo.rotateX(-Math.PI / 2);
        const fill = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
          }),
        );
        fill.position.y = 0.18;
        g.add(fill);
        const border = new THREE.LineLoop(
          geo,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.5,
          }),
        );
        border.position.y = 0.18;
        g.add(border);
        backendZoneGroups.push(g);
      });

      repositionSurface();
    }

    // ── Landmark markers ──────────────────────────────────────────────
    const landmarkGroups: THREE.Group[] = [];

    landmarkData.forEach((lm) => {
      const { x, z } = latLonToMesh(lm.lat, lm.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
      const g = addSurfGroup(x, z);

      const stemGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1.1, 0),
      ]);
      g.add(
        new THREE.Line(
          stemGeo,
          new THREE.LineBasicMaterial({
            color: lm.color,
            transparent: true,
            opacity: 0.7,
          }),
        ),
      );

      const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.10, 0),
        new THREE.MeshBasicMaterial({ color: lm.color }),
      );
      diamond.position.y = 1.1;
      g.add(diamond);

      const glowMat = new THREE.MeshBasicMaterial({
        color: lm.color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.19, 16),
        glowMat,
      );
      glow.position.y = 0.02;
      glow.rotation.x = -Math.PI / 2;
      g.add(glow);

      const sprite = makeTextSprite(lm.name, lm.colorHex);
      sprite.position.y = 1.7;
      g.add(sprite);

      landmarkGroups.push(g);
    });

    // ── Initial surface positioning ───────────────────────────────────
    repositionSurface();

    // ── Satellite drape ───────────────────────────────────────────────
    const satelliteMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
    let satelliteLoaded = false;

    fetchSatTexture(YOSEMITE_BBOX).then((tex) => {
      if (!tex) return;
      satelliteMat.map = tex;
      satelliteMat.needsUpdate = true;
      satelliteLoaded = true;
    });

    // ── Hotspot + placement groups ────────────────────────────────────
    const hotspotGroup = new THREE.Group();
    const placementGroup = new THREE.Group();
    scene.add(hotspotGroup);
    scene.add(placementGroup);

    // Per-frame animation entries for pulsing hotspot fill discs
    const hotspotAnims: {
      mat: THREE.MeshBasicMaterial;
      phase: number;
      base: number;
    }[] = [];

    let prevHotspotKey = "";

    function clearGroup(g: THREE.Group) {
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        if ((c as THREE.Mesh).isMesh) {
          (c as THREE.Mesh).geometry.dispose();
          const m = (c as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        } else if ((c as THREE.Line).isLine) {
          (c as THREE.Line).geometry.dispose();
          ((c as THREE.Line).material as THREE.Material).dispose();
        } else if ((c as THREE.Sprite).isSprite) {
          const sm = (c as THREE.Sprite).material as THREE.SpriteMaterial;
          sm.map?.dispose();
          sm.dispose();
        }
      }
    }

    const RISK_COLORS: Record<string, number> = {
      low: 0x4a9fd4,
      moderate: 0xffd84a,
      high: 0xff8c42,
      extreme: 0xff3b3b,
    };

    function buildHotspotMeshes(zones: HotspotPredictionResponse["hotspots"]) {
      hotspotAnims.length = 0;
      zones.forEach((zone) => {
        const { x, z } = latLonToMesh(zone.lat, zone.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
        const y = surf(x, z);
        const meshRadius = zone.radiusMeters / M_PER_UNIT;
        const color = RISK_COLORS[zone.riskLevel] ?? 0xff8c42;

        // Filled disc (low opacity, pulsing)
        const fillMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(meshRadius, 32),
          fillMat,
        );
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(x, y + 0.08, z);
        hotspotGroup.add(fill);
        hotspotAnims.push({
          mat: fillMat,
          phase: Math.random() * Math.PI * 2,
          base: 0.1,
        });

        // Outer ring
        const ringMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(meshRadius * 0.88, meshRadius, 32),
          ringMat,
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.09, z);
        hotspotGroup.add(ring);

        // Label sprite above zone
        const colorHex = "#" + color.toString(16).padStart(6, "0");
        const label = makeTextSprite(zone.riskLevel.toUpperCase(), colorHex, 0.7);
        label.position.set(x, y + 1.2, z);
        hotspotGroup.add(label);
      });
    }

    function buildPlacementMeshes(pl: PlacementSuggestions) {
      // Sensor suggestions — teal diamond + ring
      pl.sensors.forEach((s) => {
        const { x, z } = latLonToMesh(s.lat, s.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
        const y = surf(x, z);

        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.09, 0),
          new THREE.MeshBasicMaterial({ color: 0x00ffcc }),
        );
        gem.position.set(x, y, z);
        placementGroup.add(gem);

        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00ffcc,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.13, 0.19, 14),
          ringMat,
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.01, z);
        placementGroup.add(ring);

        const sprite = makeTextSprite(s.label, "#00FFCC");
        sprite.position.set(x, y + 0.8, z);
        placementGroup.add(sprite);
      });

      // Call box suggestions — magenta wireframe box
      pl.callBoxes.forEach((cb) => {
        const { x, z } = latLonToMesh(cb.lat, cb.lon, YOSEMITE_BBOX, SZ_W, SZ_H);
        const y = surf(x, z);

        const boxEdges = new THREE.EdgesGeometry(
          new THREE.BoxGeometry(0.18, 0.18, 0.18),
        );
        const frame = new THREE.LineSegments(
          boxEdges,
          new THREE.LineBasicMaterial({ color: 0xff44aa }),
        );
        frame.position.set(x, y + 0.09, z);
        placementGroup.add(frame);

        const sprite = makeTextSprite(cb.label, "#FF44AA");
        sprite.position.set(x, y + 0.9, z);
        placementGroup.add(sprite);
      });
    }

    // ── Yosemite boundary — hugs terrain, rebuilt when elevation loads ─
    const BSTEPS = 80; // more samples = smoother line on real DEM
    const hwX = SZ_W / 2, hwZ = SZ_H / 2;

    function terrainEdgePoints(
      x0: number, z0: number,
      x1: number, z1: number,
    ): THREE.Vector3[] {
      return Array.from({ length: BSTEPS + 1 }, (_, i) => {
        const t = i / BSTEPS;
        const ex = x0 + (x1 - x0) * t;
        const ez = z0 + (z1 - z0) * t;
        const ey = heightsArray
          ? heightAtMeshPos(ex, ez, heightsArray, RES, SZ_W, SZ_H) + 0.28
          : 0.28;
        return new THREE.Vector3(ex, ey, ez);
      });
    }

    const boundaryLineMat = new THREE.LineBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.85,
    });
    const boundaryLine = new THREE.Line(new THREE.BufferGeometry(), boundaryLineMat);
    scene.add(boundaryLine);

    function rebuildBoundary() {
      const pts = [
        ...terrainEdgePoints(-hwX, -hwZ,  hwX, -hwZ), // north
        ...terrainEdgePoints( hwX, -hwZ,  hwX,  hwZ), // east
        ...terrainEdgePoints( hwX,  hwZ, -hwX,  hwZ), // south
        ...terrainEdgePoints(-hwX,  hwZ, -hwX, -hwZ), // west
      ];
      boundaryLine.geometry.dispose();
      boundaryLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    rebuildBoundary();

    // ── Click-to-focus tween ──────────────────────────────────────────
    interface FocusTween {
      fromPos: THREE.Vector3;
      fromTarget: THREE.Vector3;
      toPos: THREE.Vector3;
      toTarget: THREE.Vector3;
      t: number;
    }
    let focusTween: FocusTween | null = null;

    function startFocusTween(hit: THREE.Vector3) {
      const ZOOM_DIST = 4.0;
      focusTween = {
        fromPos: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPos: new THREE.Vector3(
          hit.x,
          hit.y + ZOOM_DIST,
          hit.z + ZOOM_DIST * 0.5,
        ),
        toTarget: hit.clone(),
        t: 0,
      };
    }

    // ── Box-zoom (right-click drag, always active) ────────────────────
    // Raycast all 4 corners of the selection rect, compute world bounding box,
    // then calculate exact camera height so the area fills the screen.
    function startBoxZoomTween(
      sx: number, sy: number, // screen start (mousedown)
      ex: number, ey: number, // screen end   (mouseup)
      rect: DOMRectReadOnly,
    ) {
      const toNDC = (px: number, py: number) => new THREE.Vector2(
        ((px - rect.left) / rect.width) * 2 - 1,
        -((py - rect.top) / rect.height) * 2 + 1,
      );

      // Raycast the 4 corners of the drawn box to the terrain
      const corners = [
        toNDC(sx, sy), toNDC(ex, sy),
        toNDC(sx, ey), toNDC(ex, ey),
      ];
      const ray = new THREE.Raycaster();
      const pts: THREE.Vector3[] = [];
      for (const ndc of corners) {
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObject(terrainMesh);
        if (hits.length > 0) pts.push(hits[0].point);
      }
      if (pts.length < 2) return;

      // World bounding box of the selected region
      const bb = new THREE.Box3().setFromPoints(pts);
      const center = new THREE.Vector3();
      bb.getCenter(center);
      const size = new THREE.Vector3();
      bb.getSize(size);

      // Perspective math: half-height visible at distance d = d * tan(fov/2)
      // Solve for d so the region exactly fills the screen (with 10% padding)
      const fovRad = (camera.fov * Math.PI) / 180;
      const tanHalfFov = Math.tan(fovRad / 2);
      const distForHeight = (size.z / 2 * 1.1) / tanHalfFov;
      const distForWidth  = (size.x / 2 * 1.1) / (tanHalfFov * camera.aspect);
      const ZOOM_DIST = Math.max(distForHeight, distForWidth, 1.5);

      focusTween = {
        fromPos: camera.position.clone(),
        fromTarget: controls.target.clone(),
        // Nearly top-down: tiny z offset to avoid gimbal flip
        toPos: new THREE.Vector3(center.x, center.y + ZOOM_DIST, center.z + ZOOM_DIST * 0.04),
        toTarget: new THREE.Vector3(center.x, center.y, center.z),
        t: 0,
      };
    }

    let boxStart: { x: number; y: number } | null = null;
    let boxOverlay: HTMLDivElement | null = null;
    let boxDragged = false;

    let mouseDownXY = { x: 0, y: 0 };
    const onMouseDown = (e: MouseEvent) => {
      mouseDownXY = { x: e.clientX, y: e.clientY };
      if (e.button !== 0 || !boxZoomModeRef.current) return; // left-click + box mode only

      e.stopPropagation(); // prevent OrbitControls from starting an orbit
      boxStart = { x: e.clientX, y: e.clientY };
      boxDragged = false;
      controls.enabled = false;

      const parent = canvas!.parentElement;
      if (parent) {
        const overlay = document.createElement("div");
        overlay.id = "bz-overlay";
        overlay.style.cssText =
          "position:absolute;pointer-events:none;border:1.5px dashed rgba(0,255,200,0.8);background:rgba(0,255,200,0.05);box-sizing:border-box;";
        parent.appendChild(overlay);
        boxOverlay = overlay;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!boxStart || !boxOverlay) return;
      boxDragged = true;

      const rect = canvas!.getBoundingClientRect();
      const x1 = Math.min(boxStart.x, e.clientX) - rect.left;
      const y1 = Math.min(boxStart.y, e.clientY) - rect.top;
      const w = Math.abs(e.clientX - boxStart.x);
      const h = Math.abs(e.clientY - boxStart.y);

      boxOverlay.style.left = `${x1}px`;
      boxOverlay.style.top = `${y1}px`;
      boxOverlay.style.width = `${w}px`;
      boxOverlay.style.height = `${h}px`;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!boxStart) return;

      if (boxOverlay) { boxOverlay.remove(); boxOverlay = null; }
      controls.enabled = true;

      if (boxDragged && Math.abs(e.clientX - boxStart.x) > 8 && Math.abs(e.clientY - boxStart.y) > 8) {
        const rect = canvas!.getBoundingClientRect();
        startBoxZoomTween(boxStart.x, boxStart.y, e.clientX, e.clientY, rect);
      }

      boxStart = null;
      boxDragged = false;
    };

    const onClick = (e: MouseEvent) => {
      if (boxDragged) return; // suppress click after a box draw
      if (!focusModeRef.current) return;
      const dx = e.clientX - mouseDownXY.x,
        dy = e.clientY - mouseDownXY.y;
      if (dx * dx + dy * dy > 25) return; // 5px drag threshold

      const rect = canvas!.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(terrainMesh);
      if (hits.length > 0) startFocusTween(hits[0].point);
    };
    canvas.addEventListener("mousedown", onMouseDown, { capture: true });
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);

    // ── Render loop ───────────────────────────────────────────────────
    let startT: number | null = null;
    let prevElevSource: string | null = null;
    let rafId: number;

    function tick(ts: number) {
      rafId = requestAnimationFrame(tick);
      if (!startT) startT = ts;
      const t = (ts - startT) / 1000;
      const L = layersRef.current;
      const wf = viewModeRef.current === "wireframe";

      // Arrow key panning
      if (keys.size > 0) {
        const speed = controls.getDistance() * 0.004;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        const right = new THREE.Vector3()
          .crossVectors(dir, camera.up)
          .normalize();
        if (keys.has("ArrowLeft")) {
          controls.target.addScaledVector(right, -speed);
          camera.position.addScaledVector(right, -speed);
        }
        if (keys.has("ArrowRight")) {
          controls.target.addScaledVector(right, speed);
          camera.position.addScaledVector(right, speed);
        }
        if (keys.has("ArrowUp")) {
          controls.target.addScaledVector(dir, speed);
          camera.position.addScaledVector(dir, speed);
        }
        if (keys.has("ArrowDown")) {
          controls.target.addScaledVector(dir, -speed);
          camera.position.addScaledVector(dir, -speed);
        }
      }

      // Elevation update → reposition surface markers
      const elev = elevRef.current;
      if (
        elev &&
        elev.source !== prevElevSource &&
        elev.grid.length === RES * RES
      ) {
        prevElevSource = elev.source;
        heightsArray = buildHeights(elev);
        applyHeights(heightsArray);
        rebuildSkirt();
        rebuildBoundary();
        repositionSurface();
        const badge = document.getElementById("source-badge");
        if (badge) {
          badge.className = `source-badge ${elev.source}`;
          badge.textContent =
            elev.source === "opentopography"
              ? "USGS / OpenTopo"
              : elev.source === "usgs"
                ? "USGS EPQS"
                : "Procedural";
        }
      }

      // Material: satellite drape > wireframe > normal elevation colours
      if (L.osm && satelliteLoaded) {
        if (terrainMesh.material !== satelliteMat) {
          terrainMesh.material = satelliteMat;
        }
        wireMat.visible = wf;
      } else {
        if (terrainMesh.material !== terrainMat) {
          terrainMesh.material = terrainMat;
        }
        terrainMat.wireframe = wf;
        terrainMat.vertexColors = !wf;
        terrainMat.color.set(wf ? 0x003322 : 0xffffff);
        wireMat.visible = wf;
      }

      // Lazy-add backend danger zones when data arrives
      addBackendZones();

      // Layer visibility
      zoneGroups.forEach((g) => { g.visible = L.zones; });
      backendZoneGroups.forEach((g) => { g.visible = L.zones; });
      landmarkGroups.forEach((g) => { g.visible = L.landmarks; });

      // Scale all surface markers proportionally to camera distance
      // so labels & dots stay readable when zoomed out and uncluttered when zoomed in
      const dist = camera.position.distanceTo(controls.target);
      const markerScale = THREE.MathUtils.clamp(dist / 28, 0.12, 2.5);
      surfGroups.forEach(({ group }) => { group.scale.setScalar(markerScale); });

      // Sensor pulse
      sensorAnims.forEach(({ ring, mat, phase, dot }) => {
        const grp = dot.parent!;
        grp.visible = L.sensors;
        if (!L.sensors) return;
        mat.opacity = 0.12 + Math.sin(t * 1.8 + phase) * 0.15;
        ring.scale.setScalar(1 + Math.sin(t * 1.4 + phase) * 0.4);
      });

      // Drone bob
      droneAnims.forEach(({ mesh, circle, circleMat, phase, baseAlt }) => {
        const grp = mesh.parent!;
        grp.visible = L.drones;
        if (!L.drones) return;
        mesh.position.y = baseAlt + Math.sin(t * 2.2 + phase) * 0.15;
        circleMat.opacity = 0.08 + Math.sin(t * 1.5 + phase) * 0.07;
        circle.scale.setScalar(1 + Math.sin(t * 1.2 + phase) * 0.2);
      });

      // Incident pulse
      incidentAnims.forEach(({ pulse, pulseMat, phase }) => {
        const grp = pulse.parent!;
        grp.visible = L.incidents;
        if (!L.incidents) return;
        pulseMat.opacity = 0.2 + Math.sin(t * 3 + phase) * 0.2;
        pulse.scale.setScalar(1 + Math.sin(t * 2.5 + phase) * 0.5);
      });

      // Hotspot zones + placement suggestions
      const hKey = hotspotRef.current?.generatedAt ?? "";
      if (hKey !== prevHotspotKey) {
        prevHotspotKey = hKey;
        clearGroup(hotspotGroup);
        clearGroup(placementGroup);
        if (hotspotRef.current) {
          buildHotspotMeshes(hotspotRef.current.hotspots);
          if (placementRef.current) buildPlacementMeshes(placementRef.current);
        }
      }
      hotspotGroup.visible = L.hotspots;
      placementGroup.visible = L.hotspots;

      // Pulse hotspot fill discs
      if (L.hotspots) {
        hotspotAnims.forEach(({ mat, phase, base }) => {
          mat.opacity = base + Math.sin(t * 1.4 + phase) * 0.07;
        });
      }

      controls.update();

      // Focus tween
      if (focusTween) {
        focusTween.t = Math.min(1, focusTween.t + 0.025);
        const ease = 1 - Math.pow(1 - focusTween.t, 3); // cubic ease-out
        camera.position.lerpVectors(focusTween.fromPos, focusTween.toPos, ease);
        controls.target.lerpVectors(
          focusTween.fromTarget,
          focusTween.toTarget,
          ease,
        );
        controls.update();
        if (focusTween.t >= 1) focusTween = null;
      }

      // Camera floor — prevent clipping below terrain
      if (heightsArray) {
        const cx = Math.max(-SZ_W / 2, Math.min(SZ_W / 2, camera.position.x));
        const cz = Math.max(-SZ_H / 2, Math.min(SZ_H / 2, camera.position.z));
        const floor =
          heightAtMeshPos(cx, cz, heightsArray, RES, SZ_W, SZ_H) + 0.6;
        if (camera.position.y < floor) camera.position.y = floor;
      }

      renderer.render(scene, camera);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas!);
    resize();
    requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown, { capture: true });
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("click", onClick);
      if (boxOverlay) { boxOverlay.remove(); boxOverlay = null; }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="terrain-canvas"
      style={boxZoomMode ? { cursor: 'crosshair' } : undefined}
    />
  );
}
