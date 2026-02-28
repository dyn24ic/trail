'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useTerrainGrid } from './useTerrainGrid';
import { YOSEMITE_BBOX, MESH_SIZE, MESH_RES } from '@/data/trailBbox';
import { sensorData } from '@/data/sensors';
import { droneData } from '@/data/drones';
import { incidentData } from '@/data/incidents';
import { yosemiteH } from '@/lib/elevation/fallbackTerrain';
import { demGridToVertexHeights, latLonToMesh, heightAtMeshPos } from '@/lib/coordMapping';
import type { ElevationResponse } from '@/types/elevation';

interface Props {
  layers: { sensors: boolean; drones: boolean; incidents: boolean; zones: boolean };
}

export default function TerrainScene({ layers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elevData = useTerrainGrid(YOSEMITE_BBOX, MESH_RES);
  const elevRef = useRef<ElevationResponse | null>(null);
  const layersRef = useRef(layers);

  // Keep refs in sync
  useEffect(() => { elevRef.current = elevData; }, [elevData]);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0x040B0B, 1);

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040B0B);
    scene.fog = new THREE.FogExp2(0x040B0B, 0.025);

    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
    camera.position.set(8, 11, 16);
    camera.lookAt(0, 1.5, 0);

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

    // Initial: use procedural yosemiteH
    let heightsArray: Float32Array | null = null;

    function buildHeights(elev: ElevationResponse | null): Float32Array {
      if (elev && elev.grid.length === RES * RES) {
        return demGridToVertexHeights(elev.grid, RES, elev.minElev, elev.maxElev, 7.0);
      }
      // fallback: procedural
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
        // Convert mesh x,z → row,col in the heights array
        // heights row 0 = south (Three.js PlaneGeometry after rotateX is row-major south-to-north)
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
    const terrainMesh = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(terrainMesh);

    // Helper: surface height at mesh x,z
    function surf(x: number, z: number): number {
      if (heightsArray) return heightAtMeshPos(x, z, heightsArray, RES, SZ) + 0.12;
      return yosemiteH(x, z) + 0.12;
    }

    // ── Sensor markers ────────────────────────────────────────────────
    const sensorMeshes: { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; state: string; dot: THREE.Mesh }[] = [];
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
      sensorMeshes.push({ ring, mat, phase: Math.random() * Math.PI * 2, state: s.state, dot });
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
    function makeSearchZone(cx: number, cz: number, rx: number, rz: number, color: number) {
      const geo = new THREE.PlaneGeometry(rx * 2, rz * 2, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, surf(cx, cz) + 0.15, cz);
      scene.add(mesh);
      const border = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      border.position.copy(mesh.position);
      scene.add(border);
    }

    // Map incident positions to zone centers
    incidentData.forEach((inc, i) => {
      const { x, z } = latLonToMesh(inc.lat, inc.lon, YOSEMITE_BBOX, SZ);
      makeSearchZone(x, z, i === 0 ? 2.5 : 2.0, i === 0 ? 2.0 : 1.8, inc.color);
    });
    // Third zone (blue)
    {
      const { x, z } = latLonToMesh(37.7280, -119.550, YOSEMITE_BBOX, SZ);
      makeSearchZone(x, z, 3.0, 2.5, 0x4A9FD4);
    }

    // ── Camera ────────────────────────────────────────────────────────
    let camAngle = Math.atan2(camera.position.z, camera.position.x);
    const camR = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);

    // ── Render loop ───────────────────────────────────────────────────
    let startT: number | null = null;
    let prevElevSource: string | null = null;
    let rafId: number;

    function tick(ts: number) {
      rafId = requestAnimationFrame(tick);
      if (!startT) startT = ts;
      const t = (ts - startT) / 1000;
      const L = layersRef.current;

      // Update terrain if elevation data changed
      const elev = elevRef.current;
      if (elev && elev.source !== prevElevSource && elev.grid.length === RES * RES) {
        prevElevSource = elev.source;
        heightsArray = buildHeights(elev);
        applyHeights(heightsArray);
        // Update source badge
        const badge = document.getElementById('source-badge');
        if (badge) {
          badge.className = `source-badge ${elev.source}`;
          badge.textContent = elev.source === 'opentopography' ? 'USGS / OpenTopo' :
            elev.source === 'usgs' ? 'USGS EPQS' : 'Procedural';
        }
      }

      // Camera orbit
      camAngle += 0.0006;
      camera.position.x = Math.cos(camAngle) * camR;
      camera.position.z = Math.sin(camAngle) * camR;
      camera.lookAt(0, 1.5, 0);

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

      renderer.render(scene, camera);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas!);
    resize();
    requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="terrain-canvas" />;
}
