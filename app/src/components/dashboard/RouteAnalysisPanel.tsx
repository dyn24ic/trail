'use client';

import { useState } from 'react';
import type { HybridRoute } from '@/types/backend';

interface Props {
  hybridRoute: HybridRoute;
  onDismiss: () => void;
}

function safetyBadgeColor(assessment: string): string {
  const a = assessment.toUpperCase();
  if (a.includes('LOW')) return '#22c55e';
  if (a.includes('MODERATE')) return '#eab308';
  if (a.includes('HIGH')) return '#f97316';
  return '#ef4444'; // EXTREME
}

function windDir(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export default function RouteAnalysisPanel({ hybridRoute, onDismiss }: Props) {
  const [turnByTurnOpen, setTurnByTurnOpen] = useState(false);
  const { mountainRoute, roadEtaMinutes, totalEtaMinutes, weatherPenaltyApplied, penaltyReason } = hybridRoute;
  const { analysis, weather, route } = mountainRoute;

  const safetyColour = safetyBadgeColor(analysis.safety_assessment);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(520px, calc(100% - 32px))',
        zIndex: 900,
        background: 'rgba(4,11,11,0.92)',
        border: '1.5px solid rgba(0,255,200,0.25)',
        borderRadius: '8px',
        backdropFilter: 'blur(8px)',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#7ab8b0',
        overflow: 'hidden',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(0,255,200,0.12)',
          background: 'rgba(0,255,200,0.04)',
        }}
      >
        <span style={{ color: '#00ffc8', fontWeight: 700, letterSpacing: '0.1em' }}>
          ◈ ROUTE ANALYSIS
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '3px',
              background: safetyColour + '22',
              border: `1px solid ${safetyColour}66`,
              color: safetyColour,
              fontSize: '10px',
              letterSpacing: '0.08em',
            }}
          >
            {analysis.safety_assessment}
          </span>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: '1px solid rgba(0,255,200,0.2)',
              color: '#7ab8b0',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: '3px',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

        {/* ETA row */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ color: 'rgba(122,184,176,0.6)', fontSize: '10px', marginBottom: '2px' }}>ROAD (AMBULANCE)</div>
            <div style={{ color: '#22d3ee', fontSize: '18px', fontWeight: 700 }}>
              {Math.round(roadEtaMinutes)} min
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ color: 'rgba(122,184,176,0.6)', fontSize: '10px', marginBottom: '2px' }}>MOUNTAIN (ON FOOT)</div>
            <div style={{ color: '#f97316', fontSize: '18px', fontWeight: 700 }}>
              {Math.round(route.eta_minutes)} min
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ color: 'rgba(122,184,176,0.6)', fontSize: '10px', marginBottom: '2px' }}>TOTAL ETA</div>
            <div style={{ color: '#00ffc8', fontSize: '18px', fontWeight: 700 }}>
              {Math.round(totalEtaMinutes)} min
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ color: 'rgba(122,184,176,0.6)', fontSize: '10px', marginBottom: '2px' }}>DISTANCE (FOOT)</div>
            <div style={{ color: '#7ab8b0', fontSize: '18px', fontWeight: 700 }}>
              {(route.total_distance_m / 1000).toFixed(2)} km
            </div>
          </div>
        </div>

        {/* Weather row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 10px',
            background: 'rgba(0,255,200,0.04)',
            borderRadius: '4px',
            border: '1px solid rgba(0,255,200,0.1)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '14px' }}>
            {weather.conditions.storm ? '⛈' : weather.conditions.heavy_rain ? '🌧' : weather.conditions.fog ? '🌫' : weather.conditions.snow ? '❄️' : '☀️'}
          </span>
          <span style={{ flex: 1 }}>{weather.description}</span>
          <span style={{ color: 'rgba(122,184,176,0.7)' }}>
            {Math.round(weather.wind_speed_ms * 3.6)} km/h {windDir(weather.wind_direction_deg)}
          </span>
          {weather.precipitation_mm_1h > 0 && (
            <span style={{ color: '#60a5fa' }}>💧 {weather.precipitation_mm_1h.toFixed(1)} mm/h</span>
          )}
        </div>

        {/* Weather penalty explanation */}
        {weatherPenaltyApplied && (
          <div
            style={{
              padding: '6px 10px',
              background: 'rgba(249,115,22,0.08)',
              border: '1px solid rgba(249,115,22,0.25)',
              borderRadius: '4px',
              color: '#f97316',
              fontSize: '11px',
            }}
          >
            ⚠ {penaltyReason}
          </div>
        )}

        {/* AI summary */}
        <div style={{ color: '#a0ccc8', lineHeight: 1.5 }}>{analysis.summary}</div>

        {/* Hazards */}
        {analysis.hazards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ color: 'rgba(122,184,176,0.6)', fontSize: '10px', marginBottom: '2px' }}>HAZARDS</div>
            {analysis.hazards.map((h, i) => (
              <div key={i} style={{ color: '#ef4444', fontSize: '11px' }}>▸ {h}</div>
            ))}
          </div>
        )}

        {/* Terrain stats */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: 'rgba(122,184,176,0.7)' }}>
          <span>↑ Gain: {Math.round(route.stats.elevation_gain_m ?? 0)} m</span>
          <span>▲ Max: {Math.round(route.stats.max_elevation_m)} m</span>
          <span>⟁ Avg slope: {route.stats.avg_slope_deg.toFixed(1)}°</span>
          <span>Speed: {route.effective_speed_kmh.toFixed(1)} km/h</span>
          {analysis.llm_used && (
            <span style={{ color: '#22c55e' }}>✓ GPT-4o analysis</span>
          )}
        </div>

        {/* Collapsible turn-by-turn */}
        {analysis.turn_by_turn.length > 0 && (
          <div>
            <button
              onClick={() => setTurnByTurnOpen((v) => !v)}
              style={{
                background: 'none',
                border: '1px solid rgba(0,255,200,0.15)',
                color: '#7ab8b0',
                cursor: 'pointer',
                padding: '4px 10px',
                borderRadius: '3px',
                fontFamily: 'monospace',
                fontSize: '11px',
                width: '100%',
                textAlign: 'left',
              }}
            >
              {turnByTurnOpen ? '▾' : '▸'} Turn-by-turn directions ({analysis.turn_by_turn.length} steps)
            </button>
            {turnByTurnOpen && (
              <div
                style={{
                  marginTop: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  maxHeight: '120px',
                  overflowY: 'auto',
                  padding: '4px 0',
                }}
              >
                {analysis.turn_by_turn.map((step, i) => (
                  <div key={i} style={{ fontSize: '11px', color: 'rgba(122,184,176,0.8)', paddingLeft: '4px' }}>
                    {i + 1}. {step}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
