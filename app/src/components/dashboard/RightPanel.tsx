'use client';

import { useEffect, useState } from 'react';
import type { RouteCompareResponse, IncidentSummary, IncidentStatus, ScalaSearchZone } from '@/types/backend';
import { useIncidents, useIncidentDetail } from '@/lib/incidents/useIncidents';

// INC-0847: Hiker down at Half Dome Cable Route (~2,600m) — used for routing
const VICTIM = { lat: 37.7421, lon: -119.532 };
const SAR_ALPHA = { lat: 37.7322, lon: -119.5585 };
const RANGER_7  = { lat: 37.7490, lon: -119.5874 };

function etaLabel(minutes: number): string {
  return `ETA ${Math.round(minutes)}m`;
}

function safetyColour(score: number): string {
  if (score < 0.25) return 'var(--db-green)';
  if (score < 0.5)  return 'var(--db-yellow)';
  if (score < 0.75) return 'var(--db-amber)';
  return 'var(--db-red)';
}

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
}

function priorityClass(status: IncidentStatus): string {
  if (['Triggered', 'Searching'].includes(status)) return 'priority-critical';
  if (['VictimFound', 'Triaged', 'Routed'].includes(status)) return 'priority-warning';
  return 'priority-info';
}

function triggerLabel(triggerType: string): string {
  switch (triggerType) {
    case 'CallBox':       return '◈ Call Box Activation';
    case 'SensorAnomaly': return '⚡ Sensor Anomaly';
    case 'OverdueHiker':  return '⚡ Overdue Hiker';
    case 'Emergency911':  return '⚠ Emergency 911 Call';
    default:              return `◈ ${triggerType}`;
  }
}

function triggerColour(status: IncidentStatus): string {
  if (['Triggered', 'Searching'].includes(status)) return 'var(--db-red)';
  if (['VictimFound', 'Triaged', 'Routed'].includes(status)) return 'var(--db-amber)';
  return 'var(--db-blue)';
}

function actionLabel(status: IncidentStatus): { label: string; cls: string } {
  if (['Triggered', 'Searching'].includes(status)) return { label: 'Dispatch Team',  cls: 'action-red' };
  if (['VictimFound', 'Triaged'].includes(status)) return { label: 'Expand Search',   cls: 'action-amber' };
  if (status === 'Routed')                          return { label: 'Track Responder', cls: 'action-amber' };
  return { label: 'View Report', cls: 'action-green' };
}

function zoneConfidenceColour(confidence: number): string {
  if (confidence >= 0.8) return 'var(--db-red)';
  if (confidence >= 0.5) return 'var(--db-amber)';
  return 'var(--db-yellow)';
}

interface RightPanelProps {
  open: boolean;
  onTogglePanel: () => void;
}

export default function RightPanel({ open, onTogglePanel }: RightPanelProps) {
  const [alphaRoute, setAlphaRoute] = useState<RouteCompareResponse | null>(null);
  const [rangerRoute, setRangerRoute] = useState<RouteCompareResponse | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(true);

  const { incidents, loading: loadingIncidents } = useIncidents();

  // Most critical open incident for zone display
  const firstOpen = incidents.find(i => !['Closed'].includes(i.status)) ?? null;
  const firstOpenDetail = useIncidentDetail(firstOpen?.id ?? null);

  useEffect(() => {
    const headers = { 'Content-Type': 'application/json' };
    const victim = firstOpen
      ? { lat: firstOpen.locationLat ?? VICTIM.lat, lon: firstOpen.locationLng ?? VICTIM.lon }
      : VICTIM;

    Promise.all([
      fetch('/api/route/compare', {
        method: 'POST', headers,
        body: JSON.stringify({ responder_lat: SAR_ALPHA.lat, responder_lon: SAR_ALPHA.lon, victim_lat: victim.lat, victim_lon: victim.lon, severity: 5 }),
      }).then(r => r.ok ? r.json() : null),
      fetch('/api/route/compare', {
        method: 'POST', headers,
        body: JSON.stringify({ responder_lat: RANGER_7.lat, responder_lon: RANGER_7.lon, victim_lat: victim.lat, victim_lon: victim.lon, severity: 4 }),
      }).then(r => r.ok ? r.json() : null),
    ])
      .then(([alpha, ranger]) => {
        if (alpha?.status === 'ok')  setAlphaRoute(alpha);
        if (ranger?.status === 'ok') setRangerRoute(ranger);
      })
      .catch(() => {})
      .finally(() => setLoadingRoutes(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstOpen?.id]);

  const alphaEta    = alphaRoute  ? Math.round(alphaRoute.ground.route.eta_minutes)    : 22;
  const rangerEta   = rangerRoute ? Math.round(rangerRoute.ground.route.eta_minutes)   : 38;
  const heliEta     = alphaRoute  ? Math.round(alphaRoute.helicopter.route.eta_minutes) : 55;
  const heliRec     = alphaRoute?.recommended_type === 'helicopter';
  const safetyScore = alphaRoute?.ground.route.safety_score ?? null;
  const routeColour = alphaRoute?.ground.route.route_colour ?? 'var(--db-amber)';
  const distKm      = alphaRoute ? (alphaRoute.ground.route.total_distance_m / 1000).toFixed(1) : null;

  const hazards: string[] = alphaRoute?.ground.analysis.hazards.slice(0, 4) ?? [
    'Wet granite above 2800m · traction risk',
    'Wind gusts 40 km/h on exposed ridge',
    'Cables route accessible · daylight adequate',
    'Carry headlamps · sunset 18:10',
  ];

  const aiRecs: string[] = alphaRoute?.ground.analysis.recommendations.slice(0, 5) ?? [
    'Add sensor node at Cable Route 2.4km mark (coverage gap)',
    'Issue dynamic risk alert: wind speed above threshold',
    'Consider temporary restriction above 2800m (wet conditions)',
    'Increase patrol frequency: Half Dome trail — weekend peak',
    'Review CB-04 connectivity — 6h ping gap flagged',
  ];

  // Search zones: from live incident detail if available, else static fallback
  const liveZones: ScalaSearchZone[] | null = firstOpenDetail?.searchZones ?? null;

  return (
    <aside className={`panel-drawer panel-drawer--right${open ? ' open' : ''}`}>
      <div className="panel-close-btn" onClick={onTogglePanel}>
        <span>✕ OPS</span>
      </div>

      {/* ── Active Incidents ──────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Active Incidents</span>
          <span className="panel-badge">
            {loadingIncidents
              ? '…'
              : incidents.length > 0
                ? `${incidents.filter(i => i.status !== 'Closed').length} Open`
                : 'Live'}
          </span>
        </div>

        {incidents.length > 0
          ? incidents.slice(0, 5).map(inc => <IncidentCard key={inc.id} inc={inc} />)
          : <StaticIncidentCards />
        }
      </div>

      {/* ── AI Search Zone Predictions ────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">
            AI Predicted Zones{firstOpen ? ` · ${firstOpen.id.slice(-6)}` : ' · INC-0847'}
          </span>
        </div>

        {liveZones && liveZones.length > 0
          ? liveZones.slice(0, 3).map((zone, i) => (
              <div key={i} className="zone-card">
                <div className={`zone-rank r${i + 1}`}>{i + 1}</div>
                <div className="zone-body">
                  <div className="zone-name">
                    {zone.lat.toFixed(4)}°N {Math.abs(zone.lng).toFixed(4)}°W · r={Math.round(zone.radiusMeters)}m
                  </div>
                  <div className="zone-prob">
                    <div className="zone-bar">
                      <div className="zone-fill" style={{ width: `${Math.round(zone.confidence * 100)}%`, background: zoneConfidenceColour(zone.confidence) }} />
                    </div>
                    <span className="zone-pct" style={{ color: zoneConfidenceColour(zone.confidence) }}>
                      {Math.round(zone.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            ))
          : <StaticZoneCards />
        }

        <div className="risk-row">
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,59,59,0.6)' }} />Critical</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,140,66,0.6)' }} />High</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,216,74,0.6)' }} />Medium</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(0,255,136,0.4)' }} />Low</div>
        </div>
      </div>

      {/* ── Responder Routing ─────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">
            Responder Routing{firstOpen ? ` · ${firstOpen.id.slice(-6)}` : ' · INC-0847'}
          </span>
          {!loadingRoutes && alphaRoute
            ? <span className="panel-badge" style={{ color: 'var(--db-green)' }}>● LIVE</span>
            : <span className="panel-badge" style={{ color: 'var(--db-muted)' }}>Calculating…</span>
          }
        </div>
        {alphaRoute && (
          <div style={{ padding: '6px 20px 4px', fontSize: '0.62rem', color: 'var(--db-muted)', borderBottom: '1px solid var(--db-border2)', display: 'flex', gap: '14px' }}>
            <span>Distance: <span style={{ color: 'var(--db-label)', fontFamily: 'Share Tech Mono, monospace' }}>{distKm} km</span></span>
            <span>Safety: <span style={{ color: safetyColour(safetyScore ?? 0), fontFamily: 'Share Tech Mono, monospace' }}>{safetyScore !== null ? (safetyScore * 10).toFixed(1) + '/10' : '—'}</span></span>
            <span>Route: <span style={{ color: routeColour, fontFamily: 'Share Tech Mono, monospace' }}>{heliRec ? 'Helicopter rec.' : 'Ground route'}</span></span>
          </div>
        )}
        <div className="responder-list">
          <div className="resp-item">
            <span className="resp-dot" style={{ background: 'var(--db-green)' }} />
            <span className="resp-name">SAR Team Alpha (4 members)</span>
            <span className="resp-loc">Half Dome TH</span>
            <span className="resp-eta">{etaLabel(alphaEta)}</span>
          </div>
          <div className="resp-item">
            <span className="resp-dot" style={{ background: 'var(--db-amber)' }} />
            <span className="resp-name">Ranger Unit 7</span>
            <span className="resp-loc">Valley Floor</span>
            <span className="resp-eta">{etaLabel(rangerEta)}</span>
          </div>
          <div className="resp-item">
            <span className="resp-dot" style={{ background: heliRec ? 'var(--db-red)' : 'var(--db-blue)' }} />
            <span className="resp-name">Helicopter H-2{heliRec ? ' ⚠ RECOMMENDED' : ' (standby)'}</span>
            <span className="resp-loc">Fresno Base</span>
            <span className="resp-eta">{etaLabel(heliEta)}</span>
          </div>
        </div>
        <div style={{ padding: '10px 20px 12px', borderTop: '1px solid var(--db-border2)' }}>
          <div className="w-label" style={{ marginBottom: '6px' }}>Route Hazards · Primary Route</div>
          <div style={{ fontSize: '0.62rem', lineHeight: 1.9, color: 'var(--db-muted)' }}>
            {hazards.map((h, i) => (
              <span key={i}>
                {h.toLowerCase().includes('ok') || h.startsWith('✓') || h.toLowerCase().includes('accessible') ? '✓' : '⚠'} {h}<br />
              </span>
            ))}
          </div>
        </div>
        {alphaRoute?.ground.analysis.safety_assessment && (
          <div style={{ padding: '8px 20px 10px', borderTop: '1px solid var(--db-border2)', fontSize: '0.6rem', color: safetyColour(safetyScore ?? 0) }}>
            ◈ {alphaRoute.ground.analysis.safety_assessment}
          </div>
        )}
      </div>

      {/* ── Trail Risk Index ──────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Trail Risk Index</span>
        </div>
        <div style={{ padding: '12px 20px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {([
              ['Half Dome Cables',   '8.4 / 10', 84, 'var(--db-red)'],
              ['Nevada Falls Trail', '5.2 / 10', 52, 'var(--db-amber)'],
              ['Mist Trail Lower',   '3.8 / 10', 38, 'var(--db-yellow)'],
              ['Valley Loop',        '1.5 / 10', 15, 'var(--db-green)'],
            ] as const).map(([name, score, pct, color]) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--db-label)' }}>{name}</span>
                  <span style={{ fontFamily: 'Share Tech Mono, monospace', color }}>{score}</span>
                </div>
                <div className="battery-bar"><div className="battery-fill" style={{ width: `${pct}%`, background: color }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── AI Recommendations ────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">AI Recommendations</span>
          <span className="panel-badge">{alphaRoute?.ground.analysis.llm_used ? 'GPT-4o' : 'Auto-Generated'}</span>
        </div>
        <div style={{ padding: '12px 20px 14px', fontSize: '0.63rem', color: 'var(--db-muted)', lineHeight: 1.9 }}>
          {aiRecs.map((rec, i) => <span key={i}>▸ {rec}<br /></span>)}
        </div>
      </div>
    </aside>
  );
}

// ── Live incident card ────────────────────────────────────────────────────────

function IncidentCard({ inc }: { inc: IncidentSummary }) {
  const { label: btnLabel, cls: btnCls } = actionLabel(inc.status);
  const pClass = priorityClass(inc.status);
  const color  = triggerColour(inc.status);
  const hasLoc = inc.locationLat != null && inc.locationLng != null;

  return (
    <div className={`incident-card ${pClass}`}>
      <div className="incident-header">
        <span className="incident-id">{inc.id}</span>
        <span className="incident-time">{new Date(inc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {timeAgo(inc.createdAt)}</span>
      </div>
      <div className="incident-type" style={{ color }}>{triggerLabel(inc.triggerType)}</div>
      <div className="incident-meta">
        {hasLoc
          ? <><strong>Location:</strong> {inc.locationLat!.toFixed(4)}°N {Math.abs(inc.locationLng!).toFixed(4)}°W<br /></>
          : null
        }
        <strong>Status:</strong> {inc.status}<br />
        <strong>Updated:</strong> {timeAgo(inc.updatedAt)}
      </div>
      <div className="incident-footer">
        <span className="incident-zone">{inc.id}</span>
        <button className={`incident-action ${btnCls}`}>{btnLabel}</button>
      </div>
    </div>
  );
}

// ── Static fallback cards (shown when Scala has no incidents yet) ─────────────

function StaticIncidentCards() {
  return (
    <>
      <div className="incident-card priority-critical">
        <div className="incident-header">
          <span className="incident-id">INC-2024-0847</span>
          <span className="incident-time">14:12 · 26 min ago</span>
        </div>
        <div className="incident-type critical">⚠ Hiker Down · Unresponsive</div>
        <div className="incident-meta">
          <strong>Location:</strong> Half Dome Cable Route, ~2,600m<br />
          <strong>Trigger:</strong> Sensor S-07 motion anomaly + Audio<br />
          <strong>Drone:</strong> Alpha-01 on-scene · thermal contact<br />
          <strong>Triage:</strong> Possible lower limb injury · conscious
        </div>
        <div className="incident-footer">
          <span className="incident-zone">Zone A-2 · 94% Confidence</span>
          <button className="incident-action action-red">Dispatch Team</button>
        </div>
      </div>
      <div className="incident-card priority-warning">
        <div className="incident-header">
          <span className="incident-id">INC-2024-0846</span>
          <span className="incident-time">13:55 · 43 min ago</span>
        </div>
        <div className="incident-type warning">⚡ Overdue Hiker</div>
        <div className="incident-meta">
          <strong>Party:</strong> Solo hiker, check-in overdue 40 min<br />
          <strong>Last GPS:</strong> Nevada Falls approach<br />
          <strong>Drone:</strong> Gamma-03 patrol extending<br />
          <strong>Status:</strong> Attempting audio contact
        </div>
        <div className="incident-footer">
          <span className="incident-zone">Zone B-1 · 71% Confidence</span>
          <button className="incident-action action-amber">Expand Search</button>
        </div>
      </div>
      <div className="incident-card priority-info">
        <div className="incident-header">
          <span className="incident-id">INC-2024-0845</span>
          <span className="incident-time">13:20 · 78 min ago</span>
        </div>
        <div className="incident-type" style={{ color: 'var(--db-blue)' }}>◈ Call Box Activation</div>
        <div className="incident-meta">
          <strong>Location:</strong> CB-03 · Half Dome Base<br />
          <strong>Type:</strong> Non-emergency assist requested<br />
          <strong>Status:</strong> Ranger en route · ETA 12 min<br />
          <strong>Notes:</strong> Hiker equipment issue
        </div>
        <div className="incident-footer">
          <span className="incident-zone">Confirmed · Low Priority</span>
          <button className="incident-action action-green">Mark Resolved</button>
        </div>
      </div>
    </>
  );
}

function StaticZoneCards() {
  return (
    <>
      <div className="zone-card">
        <div className="zone-rank r1">1</div>
        <div className="zone-body">
          <div className="zone-name">Half Dome Cable Route · Upper</div>
          <div className="zone-prob">
            <div className="zone-bar"><div className="zone-fill" style={{ width: '94%', background: 'var(--db-red)' }} /></div>
            <span className="zone-pct" style={{ color: 'var(--db-red)' }}>94%</span>
          </div>
        </div>
      </div>
      <div className="zone-card">
        <div className="zone-rank r2">2</div>
        <div className="zone-body">
          <div className="zone-name">Sub Dome Trail · Exposed Ridge</div>
          <div className="zone-prob">
            <div className="zone-bar"><div className="zone-fill" style={{ width: '61%', background: 'var(--db-amber)' }} /></div>
            <span className="zone-pct" style={{ color: 'var(--db-amber)' }}>61%</span>
          </div>
        </div>
      </div>
      <div className="zone-card">
        <div className="zone-rank r3">3</div>
        <div className="zone-body">
          <div className="zone-name">Little Yosemite Valley · North</div>
          <div className="zone-prob">
            <div className="zone-bar"><div className="zone-fill" style={{ width: '28%', background: 'var(--db-yellow)' }} /></div>
            <span className="zone-pct" style={{ color: 'var(--db-yellow)' }}>28%</span>
          </div>
        </div>
      </div>
    </>
  );
}
