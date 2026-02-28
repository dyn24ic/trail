'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useTerrainGrid } from './useTerrainGrid';
import { YOSEMITE_BBOX, MESH_SIZE, MESH_RES } from '@/data/trailBbox';
import { sensorData } from '@/data/sensors';
import { droneData } from '@/data/drones';
import { incidentData } from '@/data/incidents';
import { landmarkData } from '@/data/landmarks';
import { yosemiteH } from '@/lib/elevation/fallbackTerrain';
import { demGridToVertexHeights, latLonToMesh, heightAtMeshPos } from '@/lib/coordMapping';
import type { ElevationResponse, BBox } from '@/types/elevation';

interface Props {
  layers: {
    sensors: boolean; drones: boolean; incidents: boolean;
    zones: boolean; landmarks: boolean; osm: boolean;
  };
  viewMode: '3d' | 'wireframe';
}

// ── OSM tile loading ──────────────────────────────────────────────────────────

interface OSMTexResult { tex: THREE.Texture }

async function loadOSMTexture(bbox: BBox): Promise<OSMTexResult | null> {
  try {
    const z = 11, n = 2 ** z;

    const lat2merc = (lat: number) => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    };

    const xMin = Math.floor((bbox.west + 180) / 360 * n);
    const xMax = Math.floor((bbox.east + 180) / 360 * n);
    const yMin = Math.floor(lat2merc(bbox.north) * n);
    const yMax = Math.floor(lat2merc(bbox.south) * n);

    const cols = xMax - xMin + 1;
    const rows = yMax - yMin + 1;
    const TS = 256;

    const canvas = document.createElement('canvas');
    canvas.width = cols * TS;
    canvas.height = rows * TS;
    const ctx = canvas.getContext('2d')!;

    await Promise.all(
      Array.from({ length: rows * cols }, (_, i) => {
        const tx = xMin + (i % cols);
        const ty = yMin + Math.floor(i / cols);
        return fetch(`/api/osm-tile?z=${z}&x=${tx}&y=${ty}`)
          .then(r => r.blob())
          .then(b => createImageBitmap(b))
          .then(bmp => ctx.drawImage(bmp, (tx - xMin) * TS, (ty - yMin) * TS))
          .catch(() => {});
      })
    );

    // Compute UV sub-region that matches exactly the bbox
    const u0 = ((bbox.west + 180) / 360 * n - xMin) / cols;
    const u1 = ((bbox.east + 180) / 360 * n - xMin) / cols;
    // Canvas y=0=north → texture flipY=true → tex v=1=canvas top (north)
    const cv0 = (lat2merc(bbox.north) * n - yMin) / rows;
    const cv1 = (lat2merc(bbox.south) * n - yMin) / rows;

    const tex = new THREE.CanvasTexture(canvas);
    tex.offset.set(u0, 1 - cv1);
    tex.repeat.set(u1 - u0, cv1 - cv0);
    return { tex };
  } catch {
    return null;
  }
}

// ── Text sprite ───────────────────────────────────────────────────────────────

function makeTextSprite(text: string, hexColor: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = '500 18px monospace';
  const tw = ctx.measureText(text).width;
  const w = Math.ceil(tw) + 20, h = 30;
  cv.width = w; cv.height = h;
  ctx.font = '500 18px monospace';
  ctx.fillStyle = 'rgba(4,11,11,0.85)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = hexColor;
  ctx.fillText(text, 10, 20);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((w / h) * 0.9, 0.9, 1);
  return sprite;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TerrainScene({ layers, viewMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elevData = useTerrainGrid(YOSEMITE_BBOX, MESH_RES);
  const elevRef = useRef<ElevationResponse | null>(null);
  const layersRef = useRef(layers);
  const viewModeRef = useRef(viewMode);

  useEffect(() => { elevRef.current = elevData; }, [elevData]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ──────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0x040B0B, 1);

    // ── Scene & Camera ────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040B0B);
    scene.fog = new THREE.FogExp2(0x040B0B, 0.018);

    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
    camera.position.set(8, 11, 16);

    // ── OrbitControls (no auto-rotate) ────────────────────────────────
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.5, 0);
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 3;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.zoomSpeed = 1.2;
    controls.update();

    // ── Arrow key panning ─────────────────────────────────────────────
    const keys = new Set<string>();
    const ARROW = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    const handleKeyDown = (e: KeyboardEvent) => { if (ARROW.has(e.key)) { e.preventDefault(); keys.add(e.key); } };
    const handleKeyUp   = (e: KeyboardEvent) => { keys.delete(e.key); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup',   handleKeyUp);

    // ── Resize ────────────────────────────────────────────────────────
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }

    // ── Lighting ──────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x0A1A15, 1.5));
    const dirLight = new THREE.DirectionalLight(0x3060A0, 1.0);
    dirLight.position.set(-5, 10, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x102010, 0.6);
    fillLight.position.set(5, 5, -4);
    scene.add(fillLight);

    // ── Terrain ───────────────────────────────────────────────────────
    const RES = MESH_RES, SZ = MESH_SIZE;
    const tGeo = new THREE.PlaneGeometry(SZ, SZ, RES - 1, RES - 1);
    tGeo.rotateX(-Math.PI / 2);
    const tPos = tGeo.attributes.position;
    const vCol = new Float32Array(tPos.count * 3);
    let heightsArray: Float32Array | null = null;

    function buildHeights(elev: ElevationResponse | null): Float32Array {
      if (elev && elev.grid.length === RES * RES) {
        return demGridToVertexHeights(elev.grid, RES, elev.minElev, elev.maxElev, 7.0);
      }
      const arr = new Float32Array(RES * RES);
      for (let row = 0; row < RES; row++) {
        for (let col = 0; col < RES; col++) {
          const x = (col / (RES - 1) - 0.5) * SZ;
          const z = (row / (RES - 1) - 0.5) * SZ;
          arr[row * RES + col] = yosemiteH(x, z);
        }
      }
      return arr;
    }

    function applyHeights(heights: Float32Array) {
      for (let i = 0; i < tPos.count; i++) {
        const x = tPos.getX(i), z = tPos.getZ(i);
        const col = Math.round((x / SZ + 0.5) * (RES - 1));
        const row = Math.round((z / SZ + 0.5) * (RES - 1));
        const h = heights[Math.max(0, Math.min(RES * RES - 1, row * RES + col))];
        tPos.setY(i, h);

        const t = Math.min(1, h / 7.0);
        let r, g, b;
        if      (t < 0.05) { r=0.05; g=0.09; b=0.06; }
        else if (t < 0.15) { r=0.07+t*0.25; g=0.13+t*0.4; b=0.06; }
        else if (t < 0.35) { r=0.15+t*0.45; g=0.16+t*0.4; b=0.10+t*0.3; }
        else if (t < 0.58) { r=0.32+t*0.35; g=0.30+t*0.28; b=0.26+t*0.22; }
        else if (t < 0.80) { r=0.48+t*0.2;  g=0.46+t*0.16; b=0.44+t*0.14; }
        else               { r=0.66+(t-0.8)*1.4; g=0.68+(t-0.8)*1.1; b=0.82+(t-0.8)*0.8; }
        vCol[i*3]=r; vCol[i*3+1]=g; vCol[i*3+2]=b;
      }
      tGeo.setAttribute('color', new THREE.BufferAttribute(vCol, 3));
      tGeo.computeVertexNormals();
      tPos.needsUpdate = true;
    }

    heightsArray = buildHeights(null);
    applyHeights(heightsArray);

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrainMesh = new THREE.Mesh(tGeo, terrainMat);
    scene.add(terrainMesh);

    const wireMat = new THREE.MeshBasicMaterial({ color: 0x00FF88, wireframe: true, transparent: true, opacity: 0.18 });
    scene.add(new THREE.Mesh(tGeo, wireMat));

    // ── Surface groups (repositioned when terrain changes) ────────────
    interface SurfGroup { wx: number; wz: number; group: THREE.Group }
    const surfGroups: SurfGroup[] = [];

    function repositionSurface() {
      if (!heightsArray) return;
      surfGroups.forEach(({ wx, wz, group }) => {
        group.position.y = heightAtMeshPos(wx, wz, heightsArray!, RES, SZ);
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
    const colorMap: Record<string, number> = { ok: 0x00FF88, warn: 0xFF8C42, alert: 0xFF3B3B, off: 0x445555 };
    const sensorAnims: { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; dot: THREE.Mesh }[] = [];

    sensorData.forEach(s => {
      const { x, z } = latLonToMesh(s.lat, s.lon, YOSEMITE_BBOX, SZ);
      const c = colorMap[s.state] ?? 0x00FF88;
      const g = addSurfGroup(x, z);

      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: c }));
      dot.position.y = 0.12;
      g.add(dot);

      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 14), mat);
      ring.position.y = 0.02;
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);

      sensorAnims.push({ ring, mat, phase: Math.random() * Math.PI * 2, dot });
    });

    // ── Drone markers ─────────────────────────────────────────────────
    const droneAnims: { mesh: THREE.Mesh; circle: THREE.Mesh; circleMat: THREE.MeshBasicMaterial; phase: number; baseAlt: number }[] = [];

    droneData.forEach(d => {
      const { x, z } = latLonToMesh(d.lat, d.lon, YOSEMITE_BBOX, SZ);
      const g = addSurfGroup(x, z);

      const drone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), new THREE.MeshBasicMaterial({ color: d.color }));
      drone.position.y = d.alt;
      g.add(drone);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, d.alt, 0),
      ]);
      g.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.3 })));

      const circleMat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
      const circle = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 24), circleMat);
      circle.position.y = 0.02;
      circle.rotation.x = -Math.PI / 2;
      g.add(circle);

      droneAnims.push({ mesh: drone, circle, circleMat, phase: Math.random() * Math.PI * 2, baseAlt: d.alt });
    });

    // ── Incident markers ──────────────────────────────────────────────
    const incidentAnims: { pulse: THREE.Mesh; pulseMat: THREE.MeshBasicMaterial; phase: number }[] = [];

    incidentData.forEach(inc => {
      const { x, z } = latLonToMesh(inc.lat, inc.lon, YOSEMITE_BBOX, SZ);
      const g = addSurfGroup(x, z);

      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshBasicMaterial({ color: inc.color }));
      dot.position.y = 0.16;
      g.add(dot);

      const pulseMat = new THREE.MeshBasicMaterial({ color: inc.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      const pulse = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 18), pulseMat);
      pulse.position.y = 0.02;
      pulse.rotation.x = -Math.PI / 2;
      g.add(pulse);

      incidentAnims.push({ pulse, pulseMat, phase: Math.random() * Math.PI * 2 });
    });

    // ── Search zones ──────────────────────────────────────────────────
    const zoneGroups: THREE.Group[] = [];

    function makeSearchZone(cx: number, cz: number, rx: number, rz: number, color: number) {
      const g = addSurfGroup(cx, cz);
      const geo = new THREE.PlaneGeometry(rx * 2, rz * 2);
      geo.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
      fill.position.y = 0.15;
      g.add(fill);
      const border = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      border.position.y = 0.15;
      g.add(border);
      zoneGroups.push(g);
    }

    incidentData.forEach((inc, i) => {
      const { x, z } = latLonToMesh(inc.lat, inc.lon, YOSEMITE_BBOX, SZ);
      makeSearchZone(x, z, i === 0 ? 2.5 : 2.0, i === 0 ? 2.0 : 1.8, inc.color);
    });
    {
      const { x, z } = latLonToMesh(37.7280, -119.550, YOSEMITE_BBOX, SZ);
      makeSearchZone(x, z, 3.0, 2.5, 0x4A9FD4);
    }

    // ── Landmark markers ──────────────────────────────────────────────
    const landmarkGroups: THREE.Group[] = [];

    landmarkData.forEach(lm => {
      const { x, z } = latLonToMesh(lm.lat, lm.lon, YOSEMITE_BBOX, SZ);
      const g = addSurfGroup(x, z);

      const stemGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1.4, 0),
      ]);
      g.add(new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: lm.color, transparent: true, opacity: 0.7 })));

      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: lm.color }));
      diamond.position.y = 1.4;
      g.add(diamond);

      const glowMat = new THREE.MeshBasicMaterial({ color: lm.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 16), glowMat);
      glow.position.y = 0.02;
      glow.rotation.x = -Math.PI / 2;
      g.add(glow);

      const sprite = makeTextSprite(lm.name, lm.colorHex);
      sprite.position.y = 2.1;
      g.add(sprite);

      landmarkGroups.push(g);
    });

    // ── Initial surface positioning ───────────────────────────────────
    repositionSurface();

    // ── OSM overlay ───────────────────────────────────────────────────
    const osmGeo = new THREE.PlaneGeometry(SZ, SZ, 1, 1);
    osmGeo.rotateX(-Math.PI / 2);
    const osmMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.78, side: THREE.DoubleSide });
    const osmMesh = new THREE.Mesh(osmGeo, osmMat);
    osmMesh.position.y = 0.05;
    osmMesh.visible = false;
    scene.add(osmMesh);

    let osmLoaded = false;
    loadOSMTexture(YOSEMITE_BBOX).then(result => {
      if (!result) return;
      osmMat.map = result.tex;
      osmMat.needsUpdate = true;
      osmLoaded = true;
    });

    // ── Render loop ───────────────────────────────────────────────────
    let startT: number | null = null;
    let prevElevSource: string | null = null;
    let rafId: number;

    function tick(ts: number) {
      rafId = requestAnimationFrame(tick);
      if (!startT) startT = ts;
      const t = (ts - startT) / 1000;
      const L = layersRef.current;
      const wf = viewModeRef.current === 'wireframe';

      // Arrow key panning
      if (keys.size > 0) {
        const speed = controls.getDistance() * 0.004;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0; dir.normalize();
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        if (keys.has('ArrowLeft'))  { controls.target.addScaledVector(right, -speed); camera.position.addScaledVector(right, -speed); }
        if (keys.has('ArrowRight')) { controls.target.addScaledVector(right,  speed); camera.position.addScaledVector(right,  speed); }
        if (keys.has('ArrowUp'))    { controls.target.addScaledVector(dir,    speed); camera.position.addScaledVector(dir,    speed); }
        if (keys.has('ArrowDown'))  { controls.target.addScaledVector(dir,   -speed); camera.position.addScaledVector(dir,   -speed); }
      }

      // Elevation update → reposition surface markers
      const elev = elevRef.current;
      if (elev && elev.source !== prevElevSource && elev.grid.length === RES * RES) {
        prevElevSource = elev.source;
        heightsArray = buildHeights(elev);
        applyHeights(heightsArray);
        repositionSurface();
        const badge = document.getElementById('source-badge');
        if (badge) {
          badge.className = `source-badge ${elev.source}`;
          badge.textContent = elev.source === 'opentopography' ? 'USGS / OpenTopo' :
            elev.source === 'usgs' ? 'USGS EPQS' : 'Procedural';
        }
      }

      // View mode
      terrainMat.wireframe = wf;
      terrainMat.vertexColors = !wf;
      terrainMat.color.set(wf ? 0x003322 : 0xffffff);
      wireMat.visible = wf;

      // Layer visibility
      zoneGroups.forEach(g  => { g.visible = L.zones; });
      landmarkGroups.forEach(g => { g.visible = L.landmarks; });
      osmMesh.visible = L.osm && osmLoaded;

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

      controls.update();
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
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return <canvas ref={canvasRef} className="terrain-canvas" />;
}
