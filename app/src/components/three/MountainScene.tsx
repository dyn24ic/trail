'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mountainH } from '@/lib/elevation/fallbackTerrain';

export default function MountainScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030A10, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030A10, 0.018);

    const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(14, 9, 20);
    camera.lookAt(0, 3.5, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0x0D1E35, 1.2));
    const moon = new THREE.DirectionalLight(0x4D7ACC, 0.9);
    moon.position.set(-8, 12, 4);
    scene.add(moon);
    const rimLeft = new THREE.DirectionalLight(0xFF6020, 0.25);
    rimLeft.position.set(8, 2, -6);
    scene.add(rimLeft);
    const rimTop = new THREE.DirectionalLight(0x203050, 0.5);
    rimTop.position.set(0, 15, 0);
    scene.add(rimTop);

    // Stars
    {
      const count = 4000;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 90 + Math.random() * 30;
        pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.abs(Math.sin(phi) * Math.sin(theta)) + 5;
        pos[i * 3 + 2] = r * Math.cos(phi);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(geo,
        new THREE.PointsMaterial({ color: 0xCCDDFF, size: 0.28, transparent: true, opacity: 0.85, sizeAttenuation: true })
      ));
    }

    // Terrain
    const RES = 128, SIZE = 22;
    const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES - 1, RES - 1);
    terrainGeo.rotateX(-Math.PI / 2);
    const tPos = terrainGeo.attributes.position;
    const vColors = new Float32Array(tPos.count * 3);

    for (let i = 0; i < tPos.count; i++) {
      const x = tPos.getX(i), z = tPos.getZ(i);
      const h = mountainH(x, z);
      tPos.setY(i, h);
      const t = Math.min(1, h / 8.5);
      let r, g, b;
      if      (t < 0.08) { r=0.06; g=0.09; b=0.07; }
      else if (t < 0.2)  { r=0.05+t*0.2; g=0.12+t*0.3; b=0.07+t*0.1; }
      else if (t < 0.45) { r=0.18+t*0.4; g=0.17+t*0.35; b=0.13+t*0.28; }
      else if (t < 0.72) { r=0.38+t*0.28; g=0.35+t*0.22; b=0.33+t*0.2; }
      else if (t < 0.88) { r=0.55+t*0.2; g=0.54+t*0.18; b=0.58+t*0.15; }
      else               { r=0.72+(t-0.88)*1.5; g=0.74+(t-0.88)*1.2; b=0.88+(t-0.88)*0.8; }
      vColors[i*3]=r; vColors[i*3+1]=g; vColors[i*3+2]=b;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(vColors, 3));
    terrainGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));

    // Trail path
    function surfaceY(x: number, z: number) { return mountainH(x, z) + 0.1; }
    const waypoints = [
      new THREE.Vector3( 0.0,  surfaceY(0.0,-2.5), -2.5),
      new THREE.Vector3( 0.3,  surfaceY(0.3,-2.0), -2.0),
      new THREE.Vector3( 0.6,  surfaceY(0.6,-1.4), -1.4),
      new THREE.Vector3( 1.0,  surfaceY(1.0,-0.9), -0.9),
      new THREE.Vector3( 1.5,  surfaceY(1.5,-0.4), -0.4),
      new THREE.Vector3( 1.9,  surfaceY(1.9, 0.2),  0.2),
      new THREE.Vector3( 2.1,  surfaceY(2.1, 0.8),  0.8),
      new THREE.Vector3( 2.0,  surfaceY(2.0, 1.5),  1.5),
      new THREE.Vector3( 1.5,  surfaceY(1.5, 2.2),  2.2),
      new THREE.Vector3( 0.8,  surfaceY(0.8, 3.0),  3.0),
      new THREE.Vector3(-0.2,  surfaceY(-0.2, 3.8), 3.8),
      new THREE.Vector3(-1.2,  surfaceY(-1.2, 4.5), 4.5),
    ];
    const curve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);
    const TRAIL_PTS = 320;
    const curvePts = curve.getPoints(TRAIL_PTS - 1);
    const trailPos = new Float32Array(TRAIL_PTS * 3);
    curvePts.forEach((p, i) => { trailPos[i*3]=p.x; trailPos[i*3+1]=p.y; trailPos[i*3+2]=p.z; });
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);

    const trailLine = new THREE.Line(trailGeo,
      new THREE.LineBasicMaterial({ color: 0xFF8C42, transparent: true, opacity: 0.95 }));
    const glowLine = new THREE.Line(trailGeo,
      new THREE.LineBasicMaterial({ color: 0xFFAA60, transparent: true, opacity: 0.22 }));
    scene.add(glowLine, trailLine);

    // Marker
    const markerMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xFFE0A0 })
    );
    markerMesh.visible = false;
    scene.add(markerMesh);

    const haloMat = new THREE.MeshBasicMaterial({ color: 0xFF8C42, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const haloMesh = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 20), haloMat);
    haloMesh.visible = false;
    scene.add(haloMesh);

    // Sensor dots
    const sensorPositions: [number, number][] = [
      [-3.5, 2.0], [-1.8, 0.5], [0.8, -1.0], [2.5, 0.5],
      [1.5, 3.5],  [-0.5, 4.5], [3.5, 2.0], [-3.0, -1.0],
    ];
    const sensorDots: { ring: THREE.Mesh; phase: number }[] = [];
    sensorPositions.forEach(([sx, sz], i) => {
      const sy = surfaceY(sx, sz);
      scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x22FF88 })
      )).position.set(sx, sy, sz);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.16, 12),
        new THREE.MeshBasicMaterial({ color: 0x22FF88, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      );
      ring.position.set(sx, sy + 0.01, sz);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
      sensorDots.push({ ring, phase: (i / sensorPositions.length) * Math.PI * 2 });
    });

    // Animation
    let drawCount = 0;
    let trailDone = false;
    let camAngle = Math.atan2(camera.position.z, camera.position.x);
    const camRadius = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);
    let startTime: number | null = null;
    let rafId: number;

    function tick(ts: number) {
      rafId = requestAnimationFrame(tick);
      if (!startTime) startTime = ts;
      const t = (ts - startTime) / 1000;

      if (t > 2.2 && !trailDone) {
        drawCount = Math.min(drawCount + 4, TRAIL_PTS);
        trailGeo.setDrawRange(0, drawCount);
        if (drawCount >= TRAIL_PTS) trailDone = true;
        const idx = drawCount - 1;
        if (idx >= 0) {
          const p = curvePts[Math.min(idx, curvePts.length - 1)];
          markerMesh.position.copy(p);
          markerMesh.visible = true;
          haloMesh.position.set(p.x, p.y + 0.02, p.z);
          haloMesh.rotation.x = -Math.PI / 2;
          haloMesh.visible = true;
          markerMesh.scale.setScalar(0.9 + Math.sin(t * 9) * 0.1);
          haloMat.opacity = 0.25 + Math.sin(t * 5) * 0.15;
        }
      } else if (trailDone) {
        markerMesh.scale.setScalar(0.9 + Math.sin(t * 3) * 0.08);
        haloMat.opacity = 0.25 + Math.sin(t * 2.5) * 0.12;
      }

      sensorDots.forEach(({ ring, phase }) => {
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 1.8 + phase) * 0.18;
        ring.scale.setScalar(1 + Math.sin(t * 1.4 + phase) * 0.35);
      });

      camAngle += 0.00055;
      camera.position.x = Math.cos(camAngle) * camRadius;
      camera.position.z = Math.sin(camAngle) * camRadius;
      camera.lookAt(0, 3.5, 0);

      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="mountain-canvas" />;
}
