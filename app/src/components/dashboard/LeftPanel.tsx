'use client';

import { useEffect, useState } from 'react';
import type { Weather } from '@/types/backend';

const YOSEMITE_LAT = 37.7459;
const YOSEMITE_LON = -119.5332;

function windDirLabel(deg: number): string {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

interface LeftPanelProps {
  open: boolean;
  onTogglePanel: () => void;
}

export default function LeftPanel({ open, onTogglePanel }: LeftPanelProps) {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    fetch(`/api/weather?lat=${YOSEMITE_LAT}&lon=${YOSEMITE_LON}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.status === 'ok' && data.weather) setWeather(data.weather);
      })
      .catch(() => {});
  }, []);

  const tempDisplay   = weather ? `${Math.round(weather.temperature_c)}°C` : '—';
  const tempSub       = weather ? `Feels like ${Math.round(weather.feels_like_c)}°C · ${weather.description}` : 'Fetching…';
  const windKmh       = weather ? Math.round(weather.wind_speed_ms * 3.6) : null;
  const windDir       = weather ? windDirLabel(weather.wind_direction_deg) : null;
  const windDisplay   = windKmh !== null ? `${windKmh} km/h` : '—';
  const windSub       = weather ? `${windDir} · ${weather.humidity_pct}% humidity` : 'Fetching…';
  const visKm         = weather ? (weather.visibility_m / 1000).toFixed(0) : null;
  const visDisplay    = visKm !== null ? `${visKm} km` : '—';
  const visSub        = weather ? `${weather.description}` : 'Fetching…';
  const precipDisplay = weather ? `${weather.precipitation_mm_1h.toFixed(1)} mm/h` : '—';
  const precipSub     = weather
    ? (weather.conditions.snow ? 'Snow conditions active' : weather.conditions.heavy_rain ? 'Heavy rain active' : 'No significant precipitation')
    : 'Fetching…';
  const windWarn      = weather ? windKmh! > 30 : false;
  const precipWarn    = weather ? (weather.conditions.heavy_rain || weather.conditions.snow || weather.conditions.storm) : false;

  const now = new Date();
  const sunsetTotalMin = 18 * 60 + 10;
  const nowTotalMin = now.getHours() * 60 + now.getMinutes();
  const remainMin = Math.max(0, sunsetTotalMin - nowTotalMin);
  const daylightDisplay = remainMin > 0 ? `${Math.floor(remainMin / 60)}h ${remainMin % 60}m` : 'After sunset';

  return (
    <aside className={`panel-drawer panel-drawer--left${open ? ' open' : ''}`}>
      <div className="panel-close-btn" onClick={onTogglePanel}>
        <span>FLEET ✕</span>
      </div>

      {/* Drone Fleet */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Drone Fleet</span>
          <span className="panel-badge">0 Active</span>
        </div>
        <div style={{ padding: '16px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', textAlign: 'center' }}>
          No drones deployed
        </div>
      </div>

      {/* Sensor Network */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Sensor Network</span>
          <span className="panel-badge">0 Nodes</span>
        </div>
        <div className="sensor-summary">
          <div className="sensor-row">
            <span className="sensor-label">Active / Nominal</span>
            <span className="sensor-count count-ok">0</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Alert / Motion Detected</span>
            <span className="sensor-count count-alert">0</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Warning / Elevated</span>
            <span className="sensor-count count-warn">0</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Offline / No Signal</span>
            <span className="sensor-count count-muted">0</span>
          </div>
        </div>
      </div>

      {/* Environmental Conditions — live from backend weather API */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Environmental Conditions</span>
          {weather
            ? <span className="panel-badge" style={{ color: 'var(--db-green)' }}>● LIVE</span>
            : <span className="panel-badge" style={{ color: 'var(--db-muted)' }}>Loading…</span>
          }
        </div>
        <div className="weather-grid">
          {([
            ['Temperature',        tempDisplay,     tempSub,      false],
            ['Wind Speed',         windDisplay,     windSub,      windWarn],
            ['Visibility',         visDisplay,      visSub,       false],
            ['Precipitation',      precipDisplay,   precipSub,    precipWarn],
            ['Daylight Remaining', daylightDisplay, 'Sunset ~18:10 local', false],
          ] as [string, string, string, boolean][]).map(([label, value, sub, warn]) => (
            <div key={label} className="weather-cell">
              <div className="w-label">{label}</div>
              <div className={`w-value${warn ? ' warn' : ''}`}>{value}</div>
              <div className="w-sub">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
