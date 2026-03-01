'use client';

import type { HikeNode, HikeStats } from '@/lib/hikeRoute';

const DIFFICULTY_COLOR: Record<HikeStats['difficulty'], string> = {
  Easy:     '#22c55e',
  Moderate: '#eab308',
  Hard:     '#f97316',
  Expert:   '#ef4444',
};

interface Props {
  waypoints: HikeNode[];
  stats: HikeStats;
}

export default function HikeRoutePanel({ waypoints, stats }: Props) {
  const diffColor = DIFFICULTY_COLOR[stats.difficulty];

  // SVG elevation profile
  const W = 272;
  const H = 56;
  const nodesWithElev = waypoints.filter(n => n.elevation_m !== null);
  const elevations = nodesWithElev.map(n => n.elevation_m as number);
  const minElev = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElev = elevations.length > 0 ? Math.max(...elevations) : 1;
  const elevRange = maxElev - minElev || 1;

  // Build SVG points from waypoints using cumulative distances for X
  const totalDist = stats.totalDistanceKm || 1;
  const svgPoints: { x: number; y: number; elev: number | null }[] = waypoints.map((node, i) => {
    const x = (stats.cumulativeDistancesKm[i] / totalDist) * W;
    const elev = node.elevation_m;
    const y = elev !== null ? H - ((elev - minElev) / elevRange) * (H - 8) - 2 : H / 2;
    return { x, y, elev };
  });

  const polylinePoints = svgPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Filled area path
  const areaPath = svgPoints.length >= 2
    ? `M${svgPoints[0].x},${H} ` +
      svgPoints.map(p => `L${p.x},${p.y}`).join(' ') +
      ` L${svgPoints[svgPoints.length - 1].x},${H} Z`
    : '';

  function fmtTime(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div style={{
      background: 'rgba(4,11,11,0.92)',
      border: '1px solid rgba(0,255,200,0.25)',
      borderRadius: '6px',
      padding: '10px 12px',
      backdropFilter: 'blur(8px)',
      fontFamily: 'monospace',
      color: '#b0d8c8',
      fontSize: '11px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color: '#00ffc8', letterSpacing: '0.1em', fontWeight: 600 }}>◈ HIKE ROUTE</span>
        <span style={{
          background: `${diffColor}22`,
          border: `1px solid ${diffColor}88`,
          color: diffColor,
          borderRadius: '3px',
          padding: '1px 7px',
          fontSize: '10px',
          letterSpacing: '0.08em',
        }}>
          {stats.difficulty.toUpperCase()}
        </span>
      </div>

      {/* 2×2 Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '10px' }}>
        <StatCell label="Distance" value={`${stats.totalDistanceKm.toFixed(1)} km`} color="#22d3ee" />
        <StatCell label="Elev Gain" value={`+${Math.round(stats.elevationGainM)} m`} color="#22c55e" />
        <StatCell label="Elev Loss" value={`-${Math.round(stats.elevationLossM)} m`} color="#f97316" />
        <StatCell label="Est Time" value={fmtTime(stats.estimatedTimeMin)} color="#60a5fa" />
      </div>

      {/* SVG Elevation Profile */}
      {stats.hasElevationData ? (
        <div style={{ position: 'relative' }}>
          <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <linearGradient id="hike-elev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="rgba(0,255,200,0.4)" />
                <stop offset="100%" stopColor="rgba(0,255,200,0.04)" />
              </linearGradient>
            </defs>

            {/* Filled area */}
            {areaPath && (
              <path d={areaPath} fill="url(#hike-elev-grad)" />
            )}

            {/* Profile line */}
            {svgPoints.length >= 2 && (
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="#00ffc8"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            )}

            {/* Node circles */}
            {svgPoints.map((p, i) => {
              const isStart = i === 0;
              const isEnd   = i === svgPoints.length - 1;
              const fill    = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#00ffc8';
              const r       = (isStart || isEnd) ? 5 : 3.5;
              return (
                <circle key={i} cx={p.x} cy={p.y} r={r} fill={fill} stroke="#040b0b" strokeWidth={1.5} />
              );
            })}
          </svg>

          {/* Min/Max labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', fontSize: '9px', color: 'rgba(176,216,200,0.5)' }}>
            <span>{Math.round(minElev)} m</span>
            <span>{Math.round(maxElev)} m</span>
          </div>
        </div>
      ) : (
        <div style={{
          height: `${H}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: 'rgba(176,216,200,0.4)',
          border: '1px dashed rgba(0,255,200,0.15)',
          borderRadius: '3px',
        }}>
          elevation queries pending…
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(0,255,200,0.1)',
      borderRadius: '3px',
      padding: '4px 6px',
    }}>
      <div style={{ fontSize: '9px', color: 'rgba(176,216,200,0.5)', letterSpacing: '0.06em', marginBottom: '1px' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ color, fontWeight: 600, fontSize: '12px' }}>{value}</div>
    </div>
  );
}
