"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useScroll, useSpring } from "framer-motion";
import { mountainH } from "@/lib/elevation/fallbackTerrain";

export default function MountainScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { scrollYProgress } = useScroll();
  const smoothScroll = useSpring(scrollYProgress, {
    stiffness: 50,
    damping: 20,
    restDelta: 0.001,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x030a10, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030a10, 0.02);

    const camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      400,
    );

    // Initial camera state
    const CAM_START = new THREE.Vector3(18, 12, 24);
    const CAM_LOOK_START = new THREE.Vector3(0, 2, 0);
    camera.position.copy(CAM_START);
    camera.lookAt(CAM_LOOK_START);

    // Lighting
    scene.add(new THREE.AmbientLight(0x0d1e35, 1.5));
    const moon = new THREE.DirectionalLight(0x4d7acc, 1.2);
    moon.position.set(-10, 20, 5);
    scene.add(moon);

    const rimLeft = new THREE.DirectionalLight(0xff6020, 0.4);
    rimLeft.position.set(10, 2, -5);
    scene.add(rimLeft);

    const rimTop = new THREE.DirectionalLight(0x203050, 0.6);
    rimTop.position.set(0, 15, 0);
    scene.add(rimTop);

    // Stars
    {
      const count = 3000;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 100 + Math.random() * 50;
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)) + 10;
        pos[i * 3 + 2] = r * Math.cos(phi);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(
        new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            color: 0xccddff,
            size: 0.3,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true,
          }),
        ),
      );
    }

    // Terrain
    const RES = 96,
      SIZE = 28;
    const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES - 1, RES - 1);
    terrainGeo.rotateX(-Math.PI / 2);
    const tPos = terrainGeo.attributes.position;
    const vColors = new Float32Array(tPos.count * 3);

    for (let i = 0; i < tPos.count; i++) {
      const x = tPos.getX(i),
        z = tPos.getZ(i);
      const h = mountainH(x * 0.8, z * 0.8);
      tPos.setY(i, h);

      const t = Math.min(1, h / 9.0);
      let r, g, b;
      if (t < 0.05) {
        r = 0.03;
        g = 0.06;
        b = 0.05;
      } else if (t < 0.2) {
        r = 0.05 + t * 0.1;
        g = 0.1 + t * 0.15;
        b = 0.08 + t * 0.05;
      } else if (t < 0.5) {
        r = 0.15 + t * 0.2;
        g = 0.18 + t * 0.2;
        b = 0.2 + t * 0.3;
      } else {
        r = 0.6 + (t - 0.5);
        g = 0.65 + (t - 0.5);
        b = 0.8 + (t - 0.5);
      }
      vColors[i * 3] = r;
      vColors[i * 3 + 1] = g;
      vColors[i * 3 + 2] = b;
    }
    terrainGeo.setAttribute("color", new THREE.BufferAttribute(vColors, 3));
    terrainGeo.computeVertexNormals();
    scene.add(
      new THREE.Mesh(
        terrainGeo,
        new THREE.MeshLambertMaterial({ vertexColors: true }),
      ),
    );

    // Trail calculation
    function surfaceY(x: number, z: number) {
      return mountainH(x * 0.8, z * 0.8);
    }

    const waypoints = [
      new THREE.Vector3(0.0, surfaceY(0.0, -3.5) + 0.1, -3.5),
      new THREE.Vector3(1.2, surfaceY(1.2, -2.5) + 0.1, -2.5),
      new THREE.Vector3(2.5, surfaceY(2.5, -1.0) + 0.2, -1.0),
      new THREE.Vector3(1.8, surfaceY(1.8, 0.5) + 0.3, 0.5),
      new THREE.Vector3(0.0, surfaceY(0.0, 1.2) + 0.5, 1.2),
      new THREE.Vector3(-1.5, surfaceY(-1.5, 2.0) + 0.8, 2.0),
      new THREE.Vector3(-2.0, surfaceY(-2.0, 3.5) + 1.2, 3.5),
    ];
    const curve = new THREE.CatmullRomCurve3(
      waypoints,
      false,
      "catmullrom",
      0.2,
    );

    const TRAIL_PTS = 400;
    const curvePts = curve.getPoints(TRAIL_PTS - 1);
    const trailPos = new Float32Array(TRAIL_PTS * 3);
    curvePts.forEach((p, i) => {
      trailPos[i * 3] = p.x;
      trailPos[i * 3 + 1] = p.y;
      trailPos[i * 3 + 2] = p.z;
    });

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);

    const trailMat = new THREE.LineBasicMaterial({
      color: 0xff8c42,
      transparent: true,
      opacity: 1.0,
      linewidth: 2,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    scene.add(trailLine);

    // Drone Group
    const droneGroup = new THREE.Group();
    const droneBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    const coneGeo = new THREE.ConeGeometry(0.8, 2.5, 4, 1, true);
    coneGeo.translate(0, -1.25, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x22ff88,
      transparent: true,
      opacity: 0.0,
      wireframe: true,
      depthWrite: false,
    });
    const scanCone = new THREE.Mesh(coneGeo, coneMat);
    droneGroup.add(droneBody);
    droneGroup.add(scanCone);
    droneGroup.visible = false;
    scene.add(droneGroup);

    // Sensors
    const sensorPositions: [number, number][] = [
      [-3.0, 1.5],
      [-1.5, 0.0],
      [1.0, -1.5],
      [3.0, 0.5],
      [1.5, 3.0],
      [-1.0, 4.0],
      [3.5, 2.5],
      [-3.5, -1.5],
    ];
    const sensors: { mesh: THREE.Mesh; phase: number; baseScale: number }[] =
      [];

    sensorPositions.forEach(([sx, sz], i) => {
      const sy = surfaceY(sx, sz);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({
          color: 0x22ff88,
          transparent: true,
          opacity: 0,
        }),
      );
      mesh.position.set(sx, sy, sz);
      scene.add(mesh);
      sensors.push({ mesh, phase: i * 0.5, baseScale: 1 });
    });

    let rafId: number;
    const clock = new THREE.Clock();

    function animate() {
      const time = clock.getElapsedTime();
      const scroll = smoothScroll.get();

      let targetPos = new THREE.Vector3();
      let targetLook = new THREE.Vector3();

      if (scroll < 0.1) {
        const angle = scroll * 0.5;
        targetPos.set(
          CAM_START.x * Math.cos(angle) + CAM_START.z * Math.sin(angle),
          CAM_START.y - scroll * 5,
          CAM_START.z * Math.cos(angle) - CAM_START.x * Math.sin(angle),
        );
        targetLook.copy(CAM_LOOK_START);
      } else {
        // Accelerate the flight progress:
        // Starts at 0.1 (10% scroll), finishes at 0.85 (85% scroll)
        // Range is 0.75 instead of previous 0.7, but starting earlier makes it feel more responsive
        const flightProgress = Math.min(1, Math.max(0, (scroll - 0.1) / 0.75));
        const pointOnCurve = curve.getPointAt(flightProgress);

        targetPos.copy(pointOnCurve).add(new THREE.Vector3(5, 4, 5));
        targetLook.copy(pointOnCurve);

        if (flightProgress > 0.01) {
          droneGroup.visible = true;
          droneGroup.position.copy(pointOnCurve);
          scanCone.rotation.y = time * 2;
          (scanCone.material as THREE.MeshBasicMaterial).opacity =
            0.15 + Math.sin(time * 10) * 0.05;

          const drawIndex = Math.floor(flightProgress * TRAIL_PTS);
          trailGeo.setDrawRange(0, drawIndex);
        } else {
          droneGroup.visible = false;
          trailGeo.setDrawRange(0, 0);
        }
      }

      camera.position.lerp(targetPos, 0.08);
      camera.up.set(0, 1, 0);

      const currentLook = new THREE.Vector3();
      camera.getWorldDirection(currentLook);
      const targetDir = new THREE.Vector3()
        .subVectors(targetLook, camera.position)
        .normalize();
      const smoothDir = currentLook.lerp(targetDir, 0.08);
      camera.lookAt(new THREE.Vector3().copy(camera.position).add(smoothDir));

      const sensorsVisible = scroll > 0.15;
      sensors.forEach((s) => {
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        if (sensorsVisible) {
          const active = (Math.sin(time * 3 + s.phase) + 1) / 2;
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0.8 * active, 0.1);
          s.mesh.position.y = THREE.MathUtils.lerp(
            s.mesh.position.y,
            surfaceY(s.mesh.position.x, s.mesh.position.z) + 0.5,
            0.05,
          );
        } else {
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0, 0.1);
        }
      });

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    }

    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, [smoothScroll]); // Eslint usually warns about missing deps but smoothScroll is a ref-like object

  return <canvas ref={canvasRef} className="mountain-canvas" />;
}
