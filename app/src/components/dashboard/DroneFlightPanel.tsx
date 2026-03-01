'use client';

import { useRef, useEffect } from 'react';
import type { DroneSearchUpdate } from '@/data/dronePath';

interface DroneFlightPanelProps {
  update: DroneSearchUpdate | null;
}

export default function DroneFlightPanel({ update }: DroneFlightPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const victimFoundRef = useRef(false);
  const victimDroneIdRef = useRef<string | null>(null);

  // Sync victim state to refs (avoids stale closures in RAF)
  useEffect(() => {
    victimFoundRef.current = update?.victimFound ?? false;
    victimDroneIdRef.current = update?.victimDroneId ?? null;
  }, [update]);

  // Continuous thermal canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    let rafId: number;
    let t = 0;

    const drawFrame = () => {
      t += 0.04;

      // ── Background thermal noise ────────────────────────────────────
      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = Math.random() * 45;
        data[i]     = Math.floor(n * 0.15);        // R — very low
        data[i + 1] = Math.floor(n * 0.20);        // G — low
        data[i + 2] = Math.floor(n * 0.85) + 8;   // B — dominant (cold)
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      // ── Victim heat signature blob ───────────────────────────────────
      const victimFound = victimFoundRef.current;
      const cx = W * 0.56;
      const cy = H * 0.44;
      const flicker = victimFound
        ? 0.80 + Math.sin(t * 3.1) * 0.12 + Math.random() * 0.08
        : 0.20 + Math.random() * 0.06;
      const blobR = victimFound ? 26 + Math.sin(t * 2) * 3 : 6;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, blobR);
      if (victimFound) {
        grad.addColorStop(0,   `rgba(255,255,210,${flicker})`);
        grad.addColorStop(0.2, `rgba(255,230,60,${flicker * 0.92})`);
        grad.addColorStop(0.5, `rgba(255,110,10,${flicker * 0.75})`);
        grad.addColorStop(0.8, `rgba(200,20,0,${flicker * 0.35})`);
        grad.addColorStop(1,   'rgba(150,0,0,0)');
      } else {
        grad.addColorStop(0,   `rgba(80,80,240,${flicker})`);
        grad.addColorStop(1,   'rgba(40,40,200,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, blobR, 0, Math.PI * 2);
      ctx.fill();

      // ── HUD overlays ─────────────────────────────────────────────────
      const hudColor = victimFound ? 'rgba(255,80,0,0.85)' : 'rgba(0,255,180,0.6)';

      // Crosshair
      ctx.strokeStyle = 'rgba(0,255,180,0.45)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 14, H / 2); ctx.lineTo(W / 2 - 5, H / 2);
      ctx.moveTo(W / 2 + 5,  H / 2); ctx.lineTo(W / 2 + 14, H / 2);
      ctx.moveTo(W / 2, H / 2 - 14); ctx.lineTo(W / 2, H / 2 - 5);
      ctx.moveTo(W / 2, H / 2 + 5);  ctx.lineTo(W / 2, H / 2 + 14);
      ctx.stroke();

      // Corner brackets
      ctx.strokeStyle = 'rgba(0,255,180,0.28)';
      ctx.lineWidth = 0.5;
      const br = 12;
      [[4,4],[W-4,4],[4,H-4],[W-4,H-4]].forEach(([bx,by]) => {
        const sx = bx < W/2 ? 1 : -1, sy = by < H/2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(bx, by + sy * br); ctx.lineTo(bx, by); ctx.lineTo(bx + sx * br, by);
        ctx.stroke();
      });

      // Drone ID label (top-left)
      const droneId = victimDroneIdRef.current ?? 'D2';
      ctx.font = '6px monospace';
      ctx.fillStyle = 'rgba(0,255,180,0.65)';
      ctx.fillText(`THERMAL · ${droneId}`, 5, 9);

      // Scale bar (bottom-left)
      ctx.strokeStyle = 'rgba(0,255,180,0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(5, H - 6); ctx.lineTo(22, H - 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,255,180,0.4)';
      ctx.fillText('50m', 24, H - 4);

      // Alert text when victim found
      if (victimFound) {
        ctx.font = 'bold 7px monospace';
        ctx.fillStyle = hudColor;
        ctx.fillText('◉ HEAT SIG CONFIRMED', 5, H - 4);
      }

      // Scan line
      const scanY = ((t * 18) % H) | 0;
      ctx.fillStyle = 'rgba(0,255,180,0.04)';
      ctx.fillRect(0, scanY, W, 2);

      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);  // run once — refs handle live state

  const victimFound = update?.victimFound ?? false;
  const drones = update?.drones ?? [];

  return (
    <div style={{
      background: 'rgba(4,11,11,0.92)',
      border: `1px solid ${victimFound ? 'rgba(255,80,0,0.7)' : 'rgba(0,255,200,0.3)'}`,
      borderRadius: '6px',
      fontFamily: "'Share Tech Mono', monospace",
      fontSize: '11px',
      color: '#b0d8c8',
      backdropFilter: 'blur(8px)',
      overflow: 'hidden',
      boxShadow: victimFound
        ? '0 0 24px rgba(255,80,0,0.25), 0 2px 12px rgba(0,0,0,0.6)'
        : '0 2px 12px rgba(0,0,0,0.5)',
      transition: 'border-color 0.5s, box-shadow 0.5s',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: `1px solid ${victimFound ? 'rgba(255,80,0,0.3)' : 'rgba(0,255,200,0.12)'}`,
        background: victimFound ? 'rgba(255,80,0,0.06)' : 'transparent',
      }}>
        <span style={{ color: victimFound ? '#ff5000' : '#00ffc8', letterSpacing: '0.1em' }}>
          ◈ DRONE SEARCH
        </span>
        <span style={{
          fontSize: '10px',
          padding: '2px 7px',
          borderRadius: '3px',
          background: victimFound ? 'rgba(255,80,0,0.2)' : 'rgba(0,255,200,0.1)',
          border: `1px solid ${victimFound ? 'rgba(255,80,0,0.5)' : 'rgba(0,255,200,0.3)'}`,
          color: victimFound ? '#ff6020' : '#00ffc8',
          letterSpacing: '0.08em',
          animation: victimFound ? 'none' : undefined,
        }}>
          {victimFound ? 'VICTIM LOCATED ⚡' : 'ACTIVE 🔴'}
        </span>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', gap: '10px', padding: '8px 10px' }}>
        {/* Left — Fleet status list */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            { id: 'D1', label: 'DELTA-1', color: '#FFD84A' },
            { id: 'D2', label: 'DELTA-2', color: '#00ffc8' },
            { id: 'D3', label: 'DELTA-3', color: '#BF80FF' },
          ].map(cfg => {
            const ds = drones.find(d => d.id === cfg.id);
            const progress = ds?.progress ?? 0;
            const status = ds?.status ?? 'searching';
            const found = status === 'found';

            return (
              <div key={cfg.id}>
                {/* Row header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '3px',
                }}>
                  <span style={{ color: cfg.color, fontSize: '10px' }}>◈</span>
                  <span style={{ color: cfg.color, fontSize: '10px', letterSpacing: '0.06em' }}>{cfg.id}</span>
                  <span style={{
                    fontSize: '9px',
                    letterSpacing: '0.06em',
                    color: found ? '#ff6020' : 'rgba(176,216,200,0.55)',
                    fontWeight: found ? 'bold' : 'normal',
                  }}>
                    {found ? '★ VICTIM FOUND' : 'SEARCHING'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'rgba(176,216,200,0.4)' }}>
                    {Math.round(progress * 100)}%
                  </span>
                </div>
                {/* Progress bar */}
                <div style={{
                  height: '4px',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round(progress * 100)}%`,
                    background: found
                      ? 'linear-gradient(90deg, #ff6020, #ffb060)'
                      : cfg.color,
                    borderRadius: '2px',
                    transition: 'width 0.4s linear',
                    boxShadow: found ? `0 0 6px ${cfg.color}` : undefined,
                  }} />
                </div>
              </div>
            );
          })}

          {/* Victim coords if found */}
          {victimFound && update?.victimLat != null && (
            <div style={{
              marginTop: '4px',
              padding: '4px 6px',
              background: 'rgba(255,80,0,0.1)',
              border: '1px solid rgba(255,80,0,0.3)',
              borderRadius: '3px',
              fontSize: '9px',
              color: '#ff8040',
              letterSpacing: '0.04em',
            }}>
              ◉ VICTIM AT {update.victimLat.toFixed(4)}°N {Math.abs(update.victimLon ?? 0).toFixed(4)}°W
            </div>
          )}
        </div>

        {/* Right — Thermal canvas HUD */}
        <div style={{ flexShrink: 0 }}>
          <div style={{
            fontSize: '9px',
            color: 'rgba(176,216,200,0.4)',
            letterSpacing: '0.08em',
            marginBottom: '3px',
            textAlign: 'center',
          }}>
            IR CAMERA
          </div>
          <div style={{
            border: `1px solid ${victimFound ? 'rgba(255,80,0,0.5)' : 'rgba(0,255,200,0.2)'}`,
            borderRadius: '3px',
            overflow: 'hidden',
            lineHeight: 0,
            transition: 'border-color 0.5s',
          }}>
            <canvas
              ref={canvasRef}
              width={160}
              height={120}
              style={{ display: 'block', imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
