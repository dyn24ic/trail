'use client';

import { useState, useEffect } from 'react';
import { useIncidents } from '@/lib/incidents/useIncidents';
import type {
  Incident, IncidentSummary, IncidentStatus,
  IncidentReport, TrailRecommendation,
} from '@/types/backend';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGES: IncidentStatus[] = ['Triggered', 'Searching', 'VictimFound', 'Triaged', 'Routed', 'Closed'];
const STAGE_LABELS: Record<IncidentStatus, string> = {
  Triggered: 'Trigger', Searching: 'Search', VictimFound: 'Found',
  Triaged: 'Triage', Routed: 'Route', Closed: 'Closed',
};

function stageIdx(s: IncidentStatus) { return STAGES.indexOf(s); }

function priorityClass(status: IncidentStatus): string {
  if (status === 'Triggered' || status === 'Searching') return 'priority-critical';
  if (status === 'Closed') return 'priority-info';
  return 'priority-warning';
}

function typeClass(status: IncidentStatus): string {
  return (status === 'Triggered' || status === 'Searching') ? 'critical' : 'warning';
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtCoord(v: number | null) { return v != null ? v.toFixed(4) : '—'; }

const SEV_COLOR: Record<string, string> = {
  Minor: 'var(--db-green)', Moderate: 'var(--db-amber)', Severe: 'var(--db-red)',
};
const PRI_COLOR: Record<string, string> = {
  low: 'var(--db-muted)', medium: 'var(--db-blue)', high: 'var(--db-amber)', critical: 'var(--db-red)',
};
const CAT_LABEL: Record<string, string> = {
  warning_sign: '⚠ Sign', sensor_placement: '◉ Sensor',
  trail_closure: '✕ Closure', trail_reroute: '↺ Reroute', risk_alert: '▲ Alert',
};

// ---------------------------------------------------------------------------
// RightPanel — entry point
// ---------------------------------------------------------------------------

interface RightPanelProps { open: boolean; onTogglePanel: () => void; }

export default function RightPanel({ open, onTogglePanel }: RightPanelProps) {
  const { incidents } = useIncidents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<Incident | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Poll detail until Closed, then stop
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let stopped = false;
    setDetailLoading(true);

    const poll = async () => {
      try {
        const res = await fetch(`/api/incidents/${selectedId}`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const data: Incident = await res.json();
        setDetail(data);
        if (data.status === 'Closed') stopped = true;
      } catch {}
      finally { setDetailLoading(false); }
    };

    poll();
    const id = setInterval(() => { if (!stopped) poll(); }, 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [selectedId]);

  const openCount = incidents.filter(i => i.status !== 'Closed').length;
  const sorted    = [...incidents].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <aside className={`panel-drawer panel-drawer--right${open ? ' open' : ''}`}>
      <div className="panel-close-btn" onClick={onTogglePanel}>
        <span>✕ OPS</span>
      </div>

      {selectedId && detail ? (
        <IncidentDetail
          incident={detail}
          loading={detailLoading}
          onBack={() => { setSelectedId(null); setDetail(null); }}
        />
      ) : (
        <IncidentList incidents={sorted} openCount={openCount} onSelect={setSelectedId} />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// IncidentList
// ---------------------------------------------------------------------------

function IncidentList({ incidents, openCount, onSelect }: {
  incidents: IncidentSummary[];
  openCount: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel-section" style={{ flex: 1, overflowY: 'auto', borderBottom: 'none' }}>
      <div className="panel-heading">
        <span className="panel-title">Active Incidents</span>
        <span className="panel-badge" style={openCount > 0 ? { color: 'var(--db-red)' } : {}}>
          {openCount} Open
        </span>
      </div>

      {incidents.length === 0 ? (
        <div style={{ padding: '16px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', textAlign: 'center' }}>
          No incidents
        </div>
      ) : incidents.map(inc => (
        <div key={inc.id} className={`incident-card ${priorityClass(inc.status)}`}>
          <div className="incident-header">
            <span className="incident-id">{inc.id.slice(0, 8)}…</span>
            <span className="incident-time">{fmtTime(inc.createdAt)}</span>
          </div>
          <div className={`incident-type ${typeClass(inc.status)}`}>{inc.triggerType}</div>
          <div className="incident-meta">
            <strong>Status</strong> {inc.status}<br />
            <strong>Loc</strong> {fmtCoord(inc.locationLat)}, {fmtCoord(inc.locationLng)}
          </div>
          <div className="incident-footer">
            <span className="incident-zone">{inc.status === 'Closed' ? '● CLOSED' : '◉ ACTIVE'}</span>
            <button
              className={`incident-action ${
                inc.status === 'Triggered' || inc.status === 'Searching' ? 'action-red'
                : inc.status === 'Closed' ? 'action-green'
                : 'action-amber'
              }`}
              onClick={() => onSelect(inc.id)}
            >
              View →
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IncidentDetail — full lifespan view
// ---------------------------------------------------------------------------

function IncidentDetail({ incident: inc, loading, onBack }: {
  incident: Incident;
  loading: boolean;
  onBack: () => void;
}) {
  const cur = stageIdx(inc.status);
  const isCritical = inc.status === 'Triggered' || inc.status === 'Searching';
  const accentColor = isCritical ? 'var(--db-red)' : inc.status === 'Closed' ? 'var(--db-green)' : 'var(--db-amber)';

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

      {/* ── Back + header ─────────────────────────────────────────── */}
      <div style={{ padding: '10px 20px 12px', borderBottom: '1px solid var(--db-border2)', background: 'var(--db-surface2)' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--db-muted)', fontSize: '0.62rem', letterSpacing: '0.1em', cursor: 'pointer', padding: 0, marginBottom: '8px' }}
        >
          ← ALL INCIDENTS
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <div>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '0.7rem', color: 'var(--db-text-bright)', marginBottom: '2px' }}>
              {inc.id.slice(0, 12)}…
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: accentColor }}>{inc.triggerType}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
            <span style={{ fontSize: '0.6rem', color: accentColor, border: `1px solid ${accentColor}`, padding: '2px 6px', letterSpacing: '0.1em' }}>
              {inc.status}
            </span>
            {loading && <span style={{ fontSize: '0.55rem', color: 'var(--db-muted)' }}>↻ polling</span>}
          </div>
        </div>
      </div>

      {/* ── Status pipeline ───────────────────────────────────────── */}
      <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--db-border2)' }}>
        <div style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: 'var(--db-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
          Response Pipeline
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {STAGES.map((s, i) => {
            const done    = i <= cur;
            const current = i === cur;
            const color   = !done ? 'rgba(220,232,240,0.08)' : s === 'Closed' ? 'var(--db-green)' : s === 'Triggered' || s === 'Searching' ? 'var(--db-red)' : 'var(--db-amber)';
            return (
              <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: '4px', borderRadius: '2px', background: color,
                  boxShadow: current ? `0 0 6px ${color}` : 'none',
                  marginBottom: '4px',
                }} />
                <div style={{ fontSize: '0.5rem', letterSpacing: '0.06em', color: done ? color : 'var(--db-muted)', textTransform: 'uppercase' }}>
                  {STAGE_LABELS[s]}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', marginTop: '8px' }}>
          📍 {fmtCoord(inc.locationLat)}, {fmtCoord(inc.locationLng)} · {fmtTime(inc.createdAt)}
        </div>
      </div>

      {/* ── Search Zones ──────────────────────────────────────────── */}
      {inc.searchZones && inc.searchZones.length > 0 && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Search Zones</span>
            <span className="panel-badge">{inc.searchZones.length} zones</span>
          </div>
          {inc.searchZones.map((z, i) => (
            <div key={i} className="zone-card">
              <div className={`zone-rank ${['r1','r2','r3'][i] ?? 'r3'}`}>{i + 1}</div>
              <div className="zone-body">
                <div className="zone-name">
                  {z.lat.toFixed(4)}, {z.lng.toFixed(4)} · r {z.radiusMeters}m
                </div>
                <div className="zone-prob">
                  <div className="zone-bar">
                    <div className="zone-fill" style={{ width: `${z.confidence * 100}%`, background: ['var(--db-red)','var(--db-amber)','var(--db-yellow)'][i] ?? 'var(--db-muted)' }} />
                  </div>
                  <span className="zone-pct" style={{ color: ['var(--db-red)','var(--db-amber)','var(--db-yellow)'][i] ?? 'var(--db-muted)' }}>
                    {(z.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Drone Result ──────────────────────────────────────────── */}
      {inc.droneResult && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Drone Scan</span>
            <span className="panel-badge" style={{ color: inc.droneResult.victimFound ? 'var(--db-green)' : 'var(--db-red)' }}>
              {inc.droneResult.victimFound ? '● VICTIM FOUND' : '○ NOT FOUND'}
            </span>
          </div>
          <div className="incident-meta" style={{ padding: '10px 20px' }}>
            {inc.droneResult.victimFound && <>
              <strong>Victim</strong> {fmtCoord(inc.droneResult.victimLat)}, {fmtCoord(inc.droneResult.victimLng)}<br />
              <strong>Confidence</strong> {(inc.droneResult.confidence * 100).toFixed(0)}%<br />
            </>}
            <strong>Scan time</strong> {inc.droneResult.scanDurationSeconds}s
            {inc.droneResult.imageUrl && <><br /><strong>Feed</strong> <span style={{ color: 'var(--db-blue)' }}>● CAPTURED</span></>}
          </div>
        </div>
      )}

      {/* ── Triage ────────────────────────────────────────────────── */}
      {inc.triage && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Triage</span>
            <span className="panel-badge" style={{ color: SEV_COLOR[inc.triage.severity] ?? 'var(--db-muted)' }}>
              {inc.triage.severity.toUpperCase()}
            </span>
          </div>
          <div className="incident-meta" style={{ padding: '10px 20px' }}>
            <strong>Injury</strong> {inc.triage.injuryType}<br />
            <strong>Conscious</strong> {inc.triage.consciousAndResponsive ? 'Yes' : 'No'}<br />
            <strong>Response</strong> {inc.triage.recommendedResponse}<br />
            <strong>Urgency</strong> {inc.triage.estimatedMedicalUrgencyMinutes} min
          </div>
        </div>
      )}

      {/* ── Responder Route ───────────────────────────────────────── */}
      {inc.route && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Route</span>
            <span className="panel-badge">{inc.route.accessType} · {inc.route.totalEtaMinutes} min</span>
          </div>
          <div className="incident-meta" style={{ padding: '8px 20px 0' }}>
            <strong>Distance</strong> {(inc.route.totalDistanceMeters / 1000).toFixed(1)} km
          </div>
          {inc.route.steps.map(step => (
            <div key={step.stepNumber} style={{ padding: '6px 20px 4px', borderBottom: '1px solid var(--db-border2)', fontSize: '0.62rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: 'var(--db-text)' }}>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--db-muted)', marginRight: '6px' }}>{step.stepNumber}.</span>
                  {step.description}
                </span>
                <span style={{ color: 'var(--db-muted)', flexShrink: 0, marginLeft: '8px' }}>{step.estimatedMinutes}m</span>
              </div>
              {step.hazards.length > 0 && (
                <div style={{ color: 'var(--db-amber)', fontSize: '0.58rem' }}>
                  ⚠ {step.hazards.join(' · ')}
                </div>
              )}
            </div>
          ))}
          <div style={{ padding: '6px 20px 10px', fontSize: '0.58rem', color: 'var(--db-muted)' }}>
            {inc.route.notes}
          </div>
        </div>
      )}

      {/* ── Post-Mortem Report ────────────────────────────────────── */}
      {inc.report && <PostMortemSection report={inc.report} />}

    </div>
  );
}

// ---------------------------------------------------------------------------
// PostMortemSection
// ---------------------------------------------------------------------------

function PostMortemSection({ report }: { report: IncidentReport }) {
  const { timeline, responseMetrics: m, recommendations } = report;

  return (
    <>
      {/* Header */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Post-Mortem Report</span>
          <span className="panel-badge" style={{ color: 'var(--db-green)' }}>● CLOSED</span>
        </div>

        {/* Timeline summary */}
        <div className="incident-meta" style={{ padding: '10px 20px 8px' }}>
          <strong>Total response</strong> {timeline.totalResponseMinutes} min<br />
          <strong>Drone search</strong> {timeline.droneSearchSeconds}s<br />
          <strong>Victim found</strong> {timeline.victimFound ? 'Yes' : 'No'}
          {timeline.triageSeverity && <><br /><strong>Triage severity</strong> {timeline.triageSeverity}</>}
        </div>

        {/* Response metrics */}
        <div style={{ padding: '0 20px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
          {([
            ['Best zone conf.', `${(m.bestZoneConfidence * 100).toFixed(0)}%`],
            ['Drone conf.',     `${(m.droneConfidence   * 100).toFixed(0)}%`],
            ['ETA',            `${m.etaMinutes} min`],
            ['Access',         m.accessType],
          ] as [string, string][]).map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.08em' }}>{label}</div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '0.72rem', color: 'var(--db-text-bright)' }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Root cause */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Root Cause</span>
        </div>
        <p style={{ padding: '10px 20px', fontSize: '0.65rem', color: 'var(--db-text)', lineHeight: 1.6, margin: 0 }}>
          {report.rootCauseAnalysis}
        </p>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Recommendations</span>
            <span className="panel-badge">{recommendations.length}</span>
          </div>
          {recommendations.map((r: TrailRecommendation, i: number) => (
            <div key={i} style={{ padding: '10px 20px 8px', borderBottom: '1px solid var(--db-border2)' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.58rem', letterSpacing: '0.08em', padding: '2px 6px',
                  border: '1px solid rgba(220,232,240,0.15)', color: 'var(--db-text)',
                }}>
                  {CAT_LABEL[r.category] ?? r.category}
                </span>
                <span style={{
                  fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: PRI_COLOR[r.priority] ?? 'var(--db-muted)',
                }}>
                  {r.priority}
                </span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--db-text)', marginBottom: '3px' }}>
                {r.description}
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', lineHeight: 1.5 }}>
                {r.rationale}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
