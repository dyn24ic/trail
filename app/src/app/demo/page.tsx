'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Incident, IncidentStatus } from '@/types/backend';
import { TRACKED_HIKERS } from '@/data/trackedHikers';

// ---------------------------------------------------------------------------
// Preset trigger scenarios
// ---------------------------------------------------------------------------

type TriggerKind = 'Emergency911' | 'OverdueHiker' | 'SensorAnomaly' | 'CallBox';

interface Scenario {
  kind: TriggerKind;
  label: string;
  location: string;
  description: string;
  payload: Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  {
    kind: 'Emergency911',
    label: '911 Call',
    location: 'Half Dome cables',
    description: 'Caller reports hiker fell on the cable route — unresponsive.',
    payload: {
      callId: '911-001',
      callerDescription: 'Hiker fell on Half Dome cables, unresponsive',
      lat: 37.7456,
      lng: -119.533,
    },
  },
  {
    kind: 'OverdueHiker',
    label: 'Overdue Hiker',
    location: 'Mist Trail / Nevada Falls',
    description: 'Hiker 90 min overdue on the Mist Trail approach — last seen at the falls.',
    payload: {
      hikerId: 'hiker-42',
      trailId: 'mist-trail',
      overdueMinutes: 90,
      lastKnownLat: 37.732,
      lastKnownLng: -119.5455,
    },
  },
  {
    kind: 'SensorAnomaly',
    label: 'Sensor Anomaly',
    location: 'Yosemite Falls upper',
    description: 'Motion sensor S-07 triggered at the exposed ridgeline near the upper falls.',
    payload: {
      sensorId: 'sensor-07',
      anomalyType: 'motion',
      lat: 37.753,
      lng: -119.5955,
    },
  },
  {
    kind: 'CallBox',
    label: 'Call Box',
    location: 'El Capitan base',
    description: 'Emergency call box CB-03 activated at the rockfall zone.',
    payload: {
      deviceId: 'callbox-03',
      lat: 37.734,
      lng: -119.6375,
    },
  },
];

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_ORDER: IncidentStatus[] = [
  'Triggered', 'Searching', 'VictimFound', 'Triaged', 'Routed', 'Closed',
];

function statusColor(s: IncidentStatus): string {
  if (s === 'Triggered') return 'var(--db-amber, #FF8C42)';
  if (s === 'Searching') return 'var(--db-blue, #4A90D9)';
  if (s === 'Routed' || s === 'Closed') return 'var(--db-green, #22FF88)';
  return 'var(--db-green, #22FF88)';
}

function statusIdx(s: IncidentStatus): number {
  return STATUS_ORDER.indexOf(s);
}

// ---------------------------------------------------------------------------
// Tracked incident (client-side state, not persisted)
// ---------------------------------------------------------------------------

interface TrackedIncident {
  id: string;
  kind: TriggerKind;
  location: string;
  detail: Incident | null;
  loading: boolean;
  expanded: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DemoPage() {
  const [tracked, setTracked] = useState<TrackedIncident[]>([]);
  const [firing, setFiring] = useState<TriggerKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hiker simulation — track next event index per hiker locally to disable buttons
  const [hikerNextIdx, setHikerNextIdx] = useState<Record<string, number>>(() =>
    Object.fromEntries(TRACKED_HIKERS.map(h => [h.id, 0])),
  );
  const [advancingHiker, setAdvancingHiker] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Poll all tracked incidents every 2 s
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/incidents/${id}`, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as Incident;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const current = trackedRef.current;
      if (current.length === 0) return;
      const updates = await Promise.all(
        current.map(t => fetchDetail(t.id).then(detail => ({ id: t.id, detail }))),
      );
      setTracked(prev =>
        prev.map(t => {
          const u = updates.find(x => x.id === t.id);
          if (!u || !u.detail) return t;
          return { ...t, detail: u.detail, loading: false };
        }),
      );
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  async function advanceHiker(hikerId: string) {
    setAdvancingHiker(hikerId);
    try {
      const hiker = TRACKED_HIKERS.find(h => h.id === hikerId);
      if (!hiker) return;
      const nextIdx = hikerNextIdx[hikerId] ?? 0;
      const event = hiker.events[nextIdx];

      await fetch('/api/demo/hiker-advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hikerId }),
      });
      setHikerNextIdx(prev => ({ ...prev, [hikerId]: (prev[hikerId] ?? 0) + 1 }));

      // Auto-trigger an incident when a missed checkpoint is fired
      if (event?.status === 'missed') {
        const sensor = hiker.sensors.find(s => s.id === event.sensorId);
        if (sensor) {
          const res = await fetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sensorId: sensor.id,
              anomalyType: 'missed_checkpoint',
              lat: sensor.lat,
              lng: sensor.lon,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.incidentId) {
              setTracked(prev => [
                {
                  id: data.incidentId,
                  kind: 'SensorAnomaly' as const,
                  location: `${hiker.name} — ${sensor.label}`,
                  detail: null,
                  loading: true,
                  expanded: true,
                },
                ...prev,
              ]);
            }
          }
        }
      }
    } finally {
      setAdvancingHiker(null);
    }
  }

  async function resetHikers() {
    setResetting(true);
    try {
      await fetch('/api/demo/hiker-advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      setHikerNextIdx(Object.fromEntries(TRACKED_HIKERS.map(h => [h.id, 0])));
    } finally {
      setResetting(false);
    }
  }

  async function fire(scenario: Scenario) {
    setFiring(scenario.kind);
    setError(null);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario.payload),
      });
      const data = await res.json();
      if (!res.ok || !data.incidentId) {
        setError(data.error ?? 'Backend returned an error');
        return;
      }
      setTracked(prev => [
        {
          id: data.incidentId,
          kind: scenario.kind,
          location: scenario.location,
          detail: null,
          loading: true,
          expanded: true,
        },
        ...prev,
      ]);
    } catch {
      setError('Could not reach the Scala backend — is it running on :8080?');
    } finally {
      setFiring(null);
    }
  }

  function toggleExpand(id: string) {
    setTracked(prev => prev.map(t => (t.id === id ? { ...t, expanded: !t.expanded } : t)));
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--db-bg, #060C0C)', color: 'var(--db-text, #DCE8F0)', fontFamily: "'Exo 2', sans-serif", padding: '0 0 60px' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header style={{ borderBottom: '1px solid rgba(220,232,240,0.07)', padding: '18px 32px', display: 'flex', alignItems: 'center', gap: '24px' }}>
        <Link href="/" style={{ color: 'rgba(220,232,240,0.45)', fontSize: '13px', textDecoration: 'none', letterSpacing: '0.05em' }}>
          ← Landing
        </Link>
        <span style={{ color: 'rgba(220,232,240,0.15)' }}>|</span>
        <span style={{ fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(220,232,240,0.45)' }}>
          Incident Demo Triggers
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
          <Link href="/dashboard" style={{ fontSize: '12px', color: 'var(--db-amber, #FF8C42)', textDecoration: 'none', letterSpacing: '0.1em' }}>
            Operator Dashboard →
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 24px 0' }}>

        {/* ── Scenario grid ──────────────────────────────────────────── */}
        <section>
          <p style={{ fontSize: '12px', color: 'rgba(220,232,240,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '20px' }}>
            Select a scenario to fire a POST /api/v1/triggers
          </p>

          {error && (
            <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.25)', borderRadius: '4px', fontSize: '13px', color: '#FF5050' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
            {SCENARIOS.map(s => (
              <ScenarioCard
                key={s.kind}
                scenario={s}
                busy={firing === s.kind}
                onFire={() => fire(s)}
              />
            ))}
          </div>
        </section>

        {/* ── Hiker Simulation ───────────────────────────────────────── */}
        <section style={{ marginTop: '48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <p style={{ fontSize: '12px', color: 'rgba(220,232,240,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
              Hiker Simulation — manual checkpoint advancement
            </p>
            <button
              onClick={resetHikers}
              disabled={resetting}
              style={{
                marginLeft: 'auto',
                padding: '6px 16px',
                background: resetting ? 'rgba(255,255,255,0.04)' : 'rgba(255,140,66,0.1)',
                border: `1px solid ${resetting ? 'rgba(220,232,240,0.12)' : 'var(--db-amber, #FF8C42)'}`,
                color: resetting ? 'rgba(220,232,240,0.35)' : 'var(--db-amber, #FF8C42)',
                borderRadius: '3px',
                fontSize: '11px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: resetting ? 'not-allowed' : 'pointer',
              }}
            >
              {resetting ? 'Resetting…' : '↺ Reset All'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {TRACKED_HIKERS.map(hiker => {
              const nextIdx = hikerNextIdx[hiker.id] ?? 0;
              const exhausted = nextIdx >= hiker.events.length;
              const busy = advancingHiker === hiker.id;
              const borderColor = hiker.events.some((ev, i) => i < nextIdx && ev.status === 'missed')
                ? '#FF3B3B'
                : '#00FF88';

              return (
                <div
                  key={hiker.id}
                  style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(220,232,240,0.07)',
                    borderLeft: `3px solid ${borderColor}`,
                    borderRadius: '4px',
                    padding: '16px',
                  }}
                >
                  {/* MAC + trail */}
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '11px', color: 'var(--db-label, #DCE8F0)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '4px' }}>
                    {hiker.mac}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(220,232,240,0.45)', letterSpacing: '0.05em', marginBottom: '12px' }}>
                    {hiker.trail}
                  </div>

                  {/* Sensor pip row */}
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '14px' }}>
                    {hiker.sensors.map((sensor, i) => {
                      const ev = hiker.events.find(e => e.sensorId === sensor.id);
                      const eventIdx = hiker.events.findIndex(e => e.sensorId === sensor.id);
                      const fired = eventIdx < nextIdx;
                      const bg = fired
                        ? ev?.status === 'missed' ? '#FF3B3B' : '#00FF88'
                        : '#2a3535';
                      return (
                        <div
                          key={sensor.id}
                          title={sensor.label}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: bg,
                            border: `1px solid ${fired ? bg : 'rgba(176,216,200,0.15)'}`,
                            flexShrink: 0,
                            transition: 'background 0.35s',
                          }}
                        />
                      );
                    })}
                    <span style={{ fontSize: '10px', color: 'rgba(220,232,240,0.3)', marginLeft: '4px' }}>
                      {nextIdx}/{hiker.events.length}
                    </span>
                  </div>

                  <button
                    onClick={() => advanceHiker(hiker.id)}
                    disabled={exhausted || busy}
                    style={{
                      padding: '7px 14px',
                      background: (exhausted || busy) ? 'rgba(255,255,255,0.04)' : 'rgba(0,255,136,0.08)',
                      border: `1px solid ${(exhausted || busy) ? 'rgba(220,232,240,0.12)' : '#00FF88'}`,
                      color: (exhausted || busy) ? 'rgba(220,232,240,0.3)' : '#00FF88',
                      borderRadius: '3px',
                      fontSize: '11px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      cursor: (exhausted || busy) ? 'not-allowed' : 'pointer',
                      width: '100%',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {busy ? 'Advancing…' : exhausted ? 'All events fired' : 'Next Checkpoint →'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Tracked incidents ───────────────────────────────────────── */}
        {tracked.length > 0 && (
          <section style={{ marginTop: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
              <p style={{ fontSize: '12px', color: 'rgba(220,232,240,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                Live incidents — polling every 2 s
              </p>
              <button
                onClick={() => setTracked([])}
                style={{
                  marginLeft: 'auto',
                  padding: '6px 16px',
                  background: 'rgba(255,80,80,0.08)',
                  border: '1px solid rgba(255,80,80,0.3)',
                  color: '#FF5050',
                  borderRadius: '3px',
                  fontSize: '11px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Archive All
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tracked.map(t => (
                <IncidentRow key={t.id} tracked={t} onToggle={() => toggleExpand(t.id)} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScenarioCard
// ---------------------------------------------------------------------------

function ScenarioCard({ scenario, busy, onFire }: { scenario: Scenario; busy: boolean; onFire: () => void }) {
  const kindColors: Record<TriggerKind, string> = {
    Emergency911:  'var(--db-red,  #FF4040)',
    OverdueHiker:  'var(--db-amber, #FF8C42)',
    SensorAnomaly: 'var(--db-blue,  #4A90D9)',
    CallBox:       'var(--db-green, #22FF88)',
  };
  const color = kindColors[scenario.kind];

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid rgba(220,232,240,0.07)`,
      borderLeft: `3px solid ${color}`,
      borderRadius: '4px',
      padding: '20px 20px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color, border: `1px solid ${color}`, padding: '2px 7px', borderRadius: '2px' }}>
          {scenario.kind}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600 }}>{scenario.label}</span>
      </div>

      <div style={{ fontSize: '12px', color: 'rgba(220,232,240,0.55)', letterSpacing: '0.04em' }}>
        📍 {scenario.location}
      </div>

      <p style={{ fontSize: '13px', color: 'rgba(220,232,240,0.7)', margin: '4px 0 8px', lineHeight: 1.5 }}>
        {scenario.description}
      </p>

      <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(220,232,240,0.06)', borderRadius: '3px', padding: '10px 12px', overflowX: 'auto', color: 'rgba(220,232,240,0.45)', margin: '0 0 12px', fontFamily: "'Share Tech Mono', monospace" }}>
        {JSON.stringify(scenario.payload, null, 2)}
      </pre>

      <button
        onClick={onFire}
        disabled={busy}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 20px',
          background: busy ? 'rgba(255,255,255,0.05)' : `${color}18`,
          border: `1px solid ${busy ? 'rgba(220,232,240,0.12)' : color}`,
          color: busy ? 'rgba(220,232,240,0.35)' : color,
          borderRadius: '3px',
          fontSize: '12px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'opacity 0.15s',
        }}
      >
        {busy ? 'Firing…' : '▶ Fire trigger'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IncidentRow
// ---------------------------------------------------------------------------

function IncidentRow({ tracked, onToggle }: { tracked: TrackedIncident; onToggle: () => void }) {
  const { id, kind, location, detail, loading, expanded } = tracked;
  const status = detail?.status ?? 'Triggered';
  const color = statusColor(status);
  const progress = statusIdx(status);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(220,232,240,0.07)',
      borderRadius: '4px',
      overflow: 'hidden',
    }}>
      {/* Summary row */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px', cursor: 'pointer' }}
      >
        {/* Pulse dot */}
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: color, flexShrink: 0,
          boxShadow: loading ? `0 0 6px ${color}` : 'none',
        }} />

        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '12px', color: 'rgba(220,232,240,0.55)', flexShrink: 0 }}>
          {id.slice(0, 8)}…
        </span>

        <span style={{ fontSize: '11px', color, border: `1px solid ${color}`, padding: '1px 6px', borderRadius: '2px', letterSpacing: '0.1em', flexShrink: 0 }}>
          {status}
        </span>

        <span style={{ fontSize: '12px', color: 'rgba(220,232,240,0.45)', flexShrink: 0 }}>
          {kind}
        </span>

        <span style={{ fontSize: '12px', color: 'rgba(220,232,240,0.35)' }}>
          📍 {location}
        </span>

        {/* Progress bar */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
          {STATUS_ORDER.map((s, i) => (
            <div
              key={s}
              title={s}
              style={{
                width: '18px', height: '4px', borderRadius: '2px',
                background: i <= progress ? color : 'rgba(220,232,240,0.1)',
                transition: 'background 0.4s',
              }}
            />
          ))}
        </div>

        <span style={{ fontSize: '11px', color: 'rgba(220,232,240,0.3)', marginLeft: '8px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(220,232,240,0.06)', padding: '16px' }}>
          {loading && !detail && (
            <p style={{ fontSize: '12px', color: 'rgba(220,232,240,0.35)', margin: 0 }}>Waiting for pipeline data…</p>
          )}
          {detail && (
            <pre style={{ fontSize: '11px', color: 'rgba(220,232,240,0.55)', fontFamily: "'Share Tech Mono', monospace", margin: 0, overflowX: 'auto', lineHeight: 1.6 }}>
              {JSON.stringify(detail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
