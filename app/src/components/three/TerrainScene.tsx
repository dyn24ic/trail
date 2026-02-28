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
import type { ElevationResponse } from '@/types/elevation';
import type { HotspotPredictionResponse, PlacementSuggestions } from '@/types/hotspots';

interface Props {
  layers: { sensors: boolean; drones: boolean; incidents: boolean; zones: boolean; landmarks: boolean; hotspots: boolean };
  viewMode: '3d' | 'wireframe';
  hotspotData?: HotspotPredictionResponse | null;
  placementData?: PlacementSuggestions | null;
}

function makeTextSprite(text: string, hexColor: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '500 18px monospace';
  ctx.font = font;
  const textW = ctx.measureText(text).width;
  const w = Math.ceil(textW) + 20;
  const h = 30;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(4,11,11,0.82)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = hexColor;
  ctx.fillText(text, 10, 20);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((w / h) * 0.9, 0.9, 1);
  return sprite;
}

export default function TerrainScene({ layers, viewMode, hotspotData, placementData }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elevData = useTerrainGrid(YOSEMITE_BBOX, MESH_RES);
  const elevRef = useRef<ElevationResponse | null>(null);
  const layersRef = useRef(layers);
  const viewModeRef = useRef(viewMode);
  const hotspotRef = useRef<HotspotPredictionResponse | null>(hotspotData ?? null);
  const placementRef = useRef<PlacementSuggestions | null>(placementData ?? null);

  useEffect(() => { elevRef.current = elevData; }, [elevData]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { hotspotRef.current = hotspotData ?? null; }, [hotspotData]);
  useEffect(() => { placementRef.current = placementData ?? null; }, [placementData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0x040B0B, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040B0B);
    scene.fog = new THREE.FogExp2(0x040B0B, 0.025);

    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
    camera.position.set(8, 11, 16);
    camera.lookAt(0, 1.5, 0);

    // ── OrbitControls ─────────────────────────────────────────────────
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.5, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 4;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.zoomSpeed = 1.2;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }

    // Lighting
    scene.add(new THREE.AmbientLight(0x0A1A15, 1.5));
    const dirLight = new THREE.DirectionalLight(0x3060A0, 1.0);
    dirLight.position.set(-5, 10, 4);
    scene.add(dirLight);
    const fill = new THREE.DirectionalLight(0x102010, 0.6);
    fill.position.set(5, 5, -4);
    scene.add(fill);

    // ── Build terrain ─────────────────────────────────────────────────
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

    // Wireframe overlay (always created, visibility toggled)
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00FF88, wireframe: true, transparent: true, opacity: 0.18,
    });
    const wireMesh = new THREE.Mesh(tGeo, wireMat);
    scene.add(wireMesh);

    // Helper: surface height at mesh x,z
    function surf(x: number, z: number): number {
      if (heightsArray) return heightAtMeshPos(x, z, heightsArray, RES, SZ) + 0.12;
      return yosemiteH(x, z) + 0.12;
    }

    // ── Sensor markers ────────────────────────────────────────────────
    const sensorMeshes: { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; dot: THREE.Mesh }[] = [];
    const colorMap: Record<string, number> = { ok: 0x00FF88, warn: 0xFF8C42, alert: 0xFF3B3B, off: 0x445555 };

    sensorData.forEach((s) => {
      const { x, z } = latLonToMesh(s.lat, s.lon, YOSEMITE_BBOX, SZ);
      const sy = surf(x, z);
      const c = colorMap[s.state] ?? 0x00FF88;

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshBasicMaterial({ color: c })
      );
      dot.position.set(x, sy, z);
      scene.add(dot);

      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 14), mat);
      ring.position.set(x, sy + 0.01, z);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
      sensorMeshes.push({ ring, mat, phase: Math.random() * Math.PI * 2, dot });
    });

    // ── Drone markers ─────────────────────────────────────────────────
    const droneMeshes: { mesh: THREE.Mesh; circle: THREE.Mesh; circleMat: THREE.MeshBasicMaterial; phase: number }[] = [];

    droneData.forEach((d) => {
      const { x, z } = latLonToMesh(d.lat, d.lon, YOSEMITE_BBOX, SZ);
      const dy = surf(x, z) + d.alt;
      const drone = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: d.color })
      );
      drone.position.set(x, dy, z);
      scene.add(drone);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, surf(x, z), z),
        new THREE.Vector3(x, dy, z),
      ]);
      scene.add(new THREE.Line(lineGeo,
        new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.3 })
      ));

      const circleMat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
      const circle = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 24), circleMat);
      circle.position.set(x, surf(x, z) + 0.02, z);
      circle.rotation.x = -Math.PI / 2;
      scene.add(circle);
      droneMeshes.push({ mesh: drone, circle, circleMat, phase: Math.random() * Math.PI * 2 });
    });

    // ── Incident markers ──────────────────────────────────────────────
    const incidentMeshes: { pulse: THREE.Mesh; pulseMat: THREE.MeshBasicMaterial; phase: number }[] = [];

    incidentData.forEach((inc) => {
      const { x, z } = latLonToMesh(inc.lat, inc.lon, YOSEMITE_BBOX, SZ);
      const iy = surf(x, z);
      scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 10, 10),
        new THREE.MeshBasicMaterial({ color: inc.color })
      )).position.set(x, iy, z);

      const pulseMat = new THREE.MeshBasicMaterial({ color: inc.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      const pulse = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 18), pulseMat);
      pulse.position.set(x, iy + 0.01, z);
      pulse.rotation.x = -Math.PI / 2;
      scene.add(pulse);
      incidentMeshes.push({ pulse, pulseMat, phase: Math.random() * Math.PI * 2 });
    });

    // ── Search zones ──────────────────────────────────────────────────
    const zoneMeshes: THREE.Object3D[] = [];
    function makeSearchZone(cx: number, cz: number, rx: number, rz: number, color: number) {
      const geo = new THREE.PlaneGeometry(rx * 2, rz * 2, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, surf(cx, cz) + 0.15, cz);
      scene.add(mesh);
      zoneMeshes.push(mesh);
      const border = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      border.position.copy(mesh.position);
      scene.add(border);
      zoneMeshes.push(border);
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
    const landmarkObjects: THREE.Object3D[] = [];

    landmarkData.forEach((lm) => {
      const { x, z } = latLonToMesh(lm.lat, lm.lon, YOSEMITE_BBOX, SZ);
      const ly = surf(x, z);

      // Pin stem
      const stemGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, ly, z),
        new THREE.Vector3(x, ly + 1.4, z),
      ]);
      const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: lm.color, transparent: true, opacity: 0.7 }));
      scene.add(stem);
      landmarkObjects.push(stem);

      // Diamond marker
      const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.15, 0),
        new THREE.MeshBasicMaterial({ color: lm.color }),
      );
      diamond.position.set(x, ly + 1.4, z);
      scene.add(diamond);
      landmarkObjects.push(diamond);

      // Glow ring
      const glowMat = new THREE.MeshBasicMaterial({ color: lm.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 16), glowMat);
      glow.position.set(x, ly + 0.01, z);
      glow.rotation.x = -Math.PI / 2;
      scene.add(glow);
      landmarkObjects.push(glow);

      // Text sprite
      const sprite = makeTextSprite(lm.name, lm.colorHex);
      sprite.position.set(x, ly + 2.1, z);
      scene.add(sprite);
      landmarkObjects.push(sprite);
    });

    // ── Hotspot + placement groups ────────────────────────────────────
    // Meters per Three.js unit (Yosemite bbox over MESH_SIZE world units)
    const LAT_M_PER_UNIT = (YOSEMITE_BBOX.north - YOSEMITE_BBOX.south) * 111120 / SZ;
    const LON_M_PER_UNIT = (YOSEMITE_BBOX.east - YOSEMITE_BBOX.west) * 111120 * Math.cos(37.76 * Math.PI / 180) / SZ;
    const M_PER_UNIT = (LAT_M_PER_UNIT + LON_M_PER_UNIT) / 2;

    const hotspotGroup = new THREE.Group();
    const placementGroup = new THREE.Group();
    scene.add(hotspotGroup);
    scene.add(placementGroup);

    // Per-frame animation entries for pulsing hotspot fill discs
    const hotspotAnims: { mat: THREE.MeshBasicMaterial; phase: number; base: number }[] = [];

    let prevHotspotKey = '';

    function clearGroup(g: THREE.Group) {
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        if ((c as THREE.Mesh).isMesh) {
          (c as THREE.Mesh).geometry.dispose();
          const m = (c as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose();
        } else if ((c as THREE.Line).isLine) {
          (c as THREE.Line).geometry.dispose();
          ((c as THREE.Line).material as THREE.Material).dispose();
        } else if ((c as THREE.Sprite).isSprite) {
          const sm = (c as THREE.Sprite).material as THREE.SpriteMaterial;
          sm.map?.dispose(); sm.dispose();
        }
      }
    }

    const RISK_COLORS: Record<string, number> = {
      low: 0x4A9FD4, moderate: 0xFFD84A, high: 0xFF8C42, extreme: 0xFF3B3B,
    };

    function buildHotspotMeshes(zones: HotspotPredictionResponse['hotspots']) {
      hotspotAnims.length = 0;
      zones.forEach((zone) => {
        const { x, z } = latLonToMesh(zone.lat, zone.lon, YOSEMITE_BBOX, SZ);
        const y = surf(x, z);
        const meshRadius = zone.radiusMeters / M_PER_UNIT;
        const color = RISK_COLORS[zone.riskLevel] ?? 0xFF8C42;

        // Filled disc (low opacity, pulsing)
        const fillMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false,
        });
        const fill = new THREE.Mesh(new THREE.CircleGeometry(meshRadius, 32), fillMat);
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(x, y + 0.08, z);
        hotspotGroup.add(fill);
        hotspotAnims.push({ mat: fillMat, phase: Math.random() * Math.PI * 2, base: 0.10 });

        // Outer ring
        const ringMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
        });
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(meshRadius * 0.88, meshRadius, 32),
          ringMat,
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.09, z);
        hotspotGroup.add(ring);

        // Label sprite above zone
        const colorHex = '#' + color.toString(16).padStart(6, '0');
        const label = makeTextSprite(zone.riskLevel.toUpperCase(), colorHex);
        label.position.set(x, y + 1.2, z);
        hotspotGroup.add(label);
      });
    }

    function buildPlacementMeshes(pl: PlacementSuggestions) {
      // Sensor suggestions — teal diamond + ring
      pl.sensors.forEach((s) => {
        const { x, z } = latLonToMesh(s.lat, s.lon, YOSEMITE_BBOX, SZ);
        const y = surf(x, z);

        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.09, 0),
          new THREE.MeshBasicMaterial({ color: 0x00FFCC }),
        );
        gem.position.set(x, y, z);
        placementGroup.add(gem);

        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00FFCC, transparent: true, opacity: 0.40, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.19, 14), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.01, z);
        placementGroup.add(ring);

        const sprite = makeTextSprite(s.label, '#00FFCC');
        sprite.position.set(x, y + 0.8, z);
        placementGroup.add(sprite);
      });

      // Call box suggestions — magenta wireframe box
      pl.callBoxes.forEach((cb) => {
        const { x, z } = latLonToMesh(cb.lat, cb.lon, YOSEMITE_BBOX, SZ);
        const y = surf(x, z);

        const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.18, 0.18, 0.18));
        const frame = new THREE.LineSegments(
          boxEdges,
          new THREE.LineBasicMaterial({ color: 0xFF44AA }),
        );
        frame.position.set(x, y + 0.09, z);
        placementGroup.add(frame);

        const sprite = makeTextSprite(cb.label, '#FF44AA');
        sprite.position.set(x, y + 0.9, z);
        placementGroup.add(sprite);
      });
    }

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

      // Elevation update
      const elev = elevRef.current;
      if (elev && elev.source !== prevElevSource && elev.grid.length === RES * RES) {
        prevElevSource = elev.source;
        heightsArray = buildHeights(elev);
        applyHeights(heightsArray);
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
      wireMesh.visible = wf;

      // Layer visibility
      zoneMeshes.forEach(o => { o.visible = L.zones; });
      landmarkObjects.forEach(o => { o.visible = L.landmarks; });

      // Sensor pulse
      sensorMeshes.forEach(({ ring, mat, phase, dot }) => {
        ring.visible = L.sensors;
        dot.visible = L.sensors;
        if (!L.sensors) return;
        mat.opacity = 0.12 + Math.sin(t * 1.8 + phase) * 0.15;
        ring.scale.setScalar(1 + Math.sin(t * 1.4 + phase) * 0.4);
      });

      // Drone bob + halo
      droneMeshes.forEach(({ mesh, circle, circleMat, phase }) => {
        mesh.visible = L.drones;
        circle.visible = L.drones;
        if (!L.drones) return;
        mesh.position.y += Math.sin(t * 2.2 + phase) * 0.003;
        circleMat.opacity = 0.08 + Math.sin(t * 1.5 + phase) * 0.07;
        circle.scale.setScalar(1 + Math.sin(t * 1.2 + phase) * 0.2);
      });

      // Incident pulse
      incidentMeshes.forEach(({ pulse, pulseMat, phase }) => {
        pulse.visible = L.incidents;
        if (!L.incidents) return;
        pulseMat.opacity = 0.2 + Math.sin(t * 3 + phase) * 0.2;
        pulse.scale.setScalar(1 + Math.sin(t * 2.5 + phase) * 0.5);
      });

      // Hotspot zones + placement suggestions
      const hKey = hotspotRef.current?.generatedAt ?? '';
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
    };
  }, []);

  return <canvas ref={canvasRef} className="terrain-canvas" />;
}
