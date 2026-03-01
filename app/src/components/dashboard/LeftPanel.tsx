"use client";

import { useEffect, useState } from "react";
import type { Weather } from "@/types/backend";
import type { DashboardLayout } from "@/hooks/useDashboardLayout";

const YOSEMITE_LAT = 37.7459;
const YOSEMITE_LON = -119.5332;

function windDirLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

interface LeftPanelProps {
  leftTab: DashboardLayout["leftTab"];
  setLeftTab: (tab: DashboardLayout["leftTab"]) => void;
}

const TABS: { id: DashboardLayout["leftTab"]; label: string }[] = [
  { id: "fleet", label: "FLEET" },
  { id: "sensors", label: "SENSORS" },
  { id: "weather", label: "WEATHER" },
];

function getOneHourAgo(history: { ts: number; data: Weather }[]): Weather | null {
  const target = Date.now() - 60 * 60 * 1000;
  let best: { ts: number; data: Weather } | null = null;
  for (const h of history) {
    if (!best || Math.abs(h.ts - target) < Math.abs(best.ts - target)) best = h;
  }
  if (!best || Date.now() - best.ts < 10 * 60 * 1000) return null;
  return best.data;
}

export default function LeftPanel({ leftTab, setLeftTab }: LeftPanelProps) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherHistory, setWeatherHistory] = useState<{ ts: number; data: Weather }[]>([]);

  useEffect(() => {
    const doFetch = () => {
      fetch(`/api/weather?lat=${YOSEMITE_LAT}&lon=${YOSEMITE_LON}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.status === "ok" && data.weather) {
            setWeather(data.weather);
            const now = Date.now();
            setWeatherHistory(prev => [
              ...prev.filter(h => now - h.ts < 90 * 60 * 1000),
              { ts: now, data: data.weather },
            ]);
          }
        })
        .catch(() => {});
    };
    doFetch();
    const id = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="sidebar sidebar--left">
      {/* Internal tab strip */}
      <div className="sidebar-tab-strip">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`sidebar-tab${leftTab === t.id ? " active" : ""}`}
            onClick={() => setLeftTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="sidebar-content">
        {leftTab === "fleet" && <FleetTab />}
        {leftTab === "sensors" && <SensorsTab />}
        {leftTab === "weather" && <WeatherTab weather={weather} prevWeather={getOneHourAgo(weatherHistory)} />}
      </div>
    </aside>
  );
}

// ── Fleet Tab ──────────────────────────────────────────────────────────────

function FleetTab() {
  return (
    <>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Drone Fleet</span>
          <span className="panel-badge">0 Active</span>
        </div>
        <div
          style={{
            padding: "24px 20px",
            fontSize: "0.62rem",
            color: "var(--db-muted)",
            textAlign: "center",
            lineHeight: 2,
          }}
        >
          No drones deployed
        </div>
      </div>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Mission Readiness</span>
        </div>
        <div
          style={{
            padding: "14px 20px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          {(
            [
              ["Fleet Ready", "0 / 0"],
              ["Coverage", "—"],
              ["Avg Battery", "—"],
              ["Flight Time", "—"],
            ] as [string, string][]
          ).map(([label, val]) => (
            <div key={label}>
              <div
                style={{
                  fontSize: "0.58rem",
                  color: "var(--db-muted)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "3px",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: "'Share Tech Mono', monospace",
                  fontSize: "0.85rem",
                  color: "var(--db-text-bright)",
                }}
              >
                {val}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Sensors Tab ─────────────────────────────────────────────────────────────

function SensorsTab() {
  return (
    <>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Sensor Network</span>
          <span className="panel-badge">0 Nodes</span>
        </div>
        <div className="sensor-summary">
          {(
            [
              ["Active / Nominal", 0, "count-ok"],
              ["Alert / Motion", 0, "count-alert"],
              ["Warning / Elevated", 0, "count-warn"],
              ["Offline / No Signal", 0, "count-muted"],
            ] as [string, number, string][]
          ).map(([label, count, cls]) => (
            <div key={label} className="sensor-row">
              <span className="sensor-label">{label}</span>
              <span className={`sensor-count ${cls}`}>{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Signal Grid</span>
        </div>
        <div className="mini-sensor-grid">
          {Array.from({ length: 32 }).map((_, i) => (
            <div key={i} className="sensor-pixel sp-off" />
          ))}
        </div>
      </div>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Emergency Call Boxes</span>
          <span className="panel-badge">0 Installed</span>
        </div>
        <div
          style={{
            padding: "12px 20px",
            fontSize: "0.62rem",
            color: "var(--db-muted)",
            textAlign: "center",
          }}
        >
          No call boxes registered
        </div>
      </div>
    </>
  );
}

// ── Weather Tab ─────────────────────────────────────────────────────────────

// 'up-bad'  → ↑ red   / ↓ green  (wind, precipitation)
// 'up-good' → ↑ green / ↓ red    (visibility)
// 'neutral' → ↑ amber / ↓ #88ccff (temperature — both extremes are risks)
type DeltaSentiment = 'up-bad' | 'up-good' | 'neutral';

function weatherDelta(
  current: number | null,
  prev: number | null,
  unit: string,
  sentiment: DeltaSentiment,
  decimals = 0
): { text: string; color: string } {
  if (current == null || prev == null) return { text: "—", color: "" };
  const diff = current - prev;
  if (Math.abs(diff) < 0.05) return { text: "—", color: "" };
  const isUp = diff > 0;
  const text = `${isUp ? "▲" : "▼"} ${Math.abs(diff).toFixed(decimals)}${unit}`;
  let color: string;
  if (sentiment === 'neutral') {
    color = isUp ? 'var(--db-amber)' : '#88ccff';
  } else if (sentiment === 'up-bad') {
    color = isUp ? 'var(--db-red)' : 'var(--db-green)';
  } else {
    color = isUp ? 'var(--db-green)' : 'var(--db-red)';
  }
  return { text, color };
}

function WeatherTab({ weather, prevWeather }: { weather: Weather | null; prevWeather: Weather | null }) {
  const windKmh = weather ? Math.round(weather.wind_speed_ms * 3.6) : null;
  const prevWindKmh = prevWeather ? Math.round(prevWeather.wind_speed_ms * 3.6) : null;
  const windDir = weather ? windDirLabel(weather.wind_direction_deg) : null;
  const visKm = weather ? weather.visibility_m / 1000 : null;
  const prevVisKm = prevWeather ? prevWeather.visibility_m / 1000 : null;
  const windWarn = windKmh != null ? windKmh > 30 : false;
  const precipWarn = weather
    ? weather.conditions.heavy_rain ||
      weather.conditions.snow ||
      weather.conditions.storm
    : false;

  const now = new Date();
  const sunsetTotalMin = 18 * 60 + 10;
  const nowTotalMin = now.getHours() * 60 + now.getMinutes();
  const remainMin = Math.max(0, sunsetTotalMin - nowTotalMin);
  const daylightDisplay =
    remainMin > 0
      ? `${Math.floor(remainMin / 60)}h ${remainMin % 60}m`
      : "After sunset";

  type Cell = [string, string, string, boolean, { text: string; color: string } | null];
  const cells: Cell[] = [
    [
      "Temperature",
      weather ? `${Math.round(weather.temperature_c)}°C` : "—",
      weather
        ? `Feels like ${Math.round(weather.feels_like_c)}°C · ${weather.description}`
        : "Fetching…",
      false,
      weatherDelta(weather?.temperature_c ?? null, prevWeather?.temperature_c ?? null, "°C", 'neutral', 1),
    ],
    [
      "Wind Speed",
      windKmh != null ? `${windKmh} km/h` : "—",
      weather ? `${windDir} · ${weather.humidity_pct}% humidity` : "Fetching…",
      windWarn,
      weatherDelta(windKmh, prevWindKmh, " km/h", 'up-bad'),
    ],
    [
      "Visibility",
      visKm != null ? `${visKm.toFixed(0)} km` : "—",
      weather ? weather.description : "Fetching…",
      false,
      weatherDelta(visKm, prevVisKm, " km", 'up-good', 1),
    ],
    [
      "Precipitation",
      weather ? `${weather.precipitation_mm_1h.toFixed(1)} mm/h` : "—",
      weather
        ? weather.conditions.snow
          ? "Snow conditions"
          : weather.conditions.heavy_rain
            ? "Heavy rain"
            : "Clear"
        : "Fetching…",
      precipWarn,
      weatherDelta(
        weather?.precipitation_mm_1h ?? null,
        prevWeather?.precipitation_mm_1h ?? null,
        " mm/h",
        'up-bad',
        1
      ),
    ],
    ["Daylight Remaining", daylightDisplay, "Sunset ~18:10 local", false, null],
  ];

  return (
    <div className="panel-section" style={{ borderBottom: "none" }}>
      <style>{`
        .w-delta {
          font-size: 0.55rem;
          letter-spacing: 0.08em;
          margin-top: 2px;
          opacity: 0.85;
          font-family: 'Share Tech Mono', monospace;
          color: var(--db-muted);
        }
        .w-delta:not(:empty)::after { content: " vs 1h ago"; }
        .w-delta[style*="color"]::after { content: " vs 1h ago"; }
      `}</style>
      <div
        className="panel-heading"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span className="panel-title">Environmental Conditions</span>
        {weather ? (
          <span className="panel-badge" style={{ color: "var(--db-green)" }}>
            ● LIVE
          </span>
        ) : (
          <span className="panel-badge" style={{ color: "var(--db-muted)" }}>
            Loading…
          </span>
        )}
      </div>
      <div className="weather-grid">
        {cells.map(([label, value, sub, warn, delta]) => (
          <div key={label} className="weather-cell">
            <div className="w-label">{label}</div>
            <div className={`w-value${warn ? " warn" : ""}`}>{value}</div>
            <div className="w-sub">{sub}</div>
            {delta != null && (
              <div
                className="w-delta"
                style={delta.color ? { color: delta.color, opacity: 1 } : undefined}
              >
                {delta.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
