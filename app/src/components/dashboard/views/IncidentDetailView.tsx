'use client';

import { useState, useEffect } from 'react';
import type { Incident, IncidentStatus, IncidentReport, TrailRecommendation } from '@/types/backend';

const STAGES: IncidentStatus[] = ['Triggered', 'Searching', 'VictimFound', 'Triaged', 'Routed', 'Closed'];
const STAGE_LABELS: Record<IncidentStatus, string> = {
  Triggered: 'Trigger', Searching: 'Search', VictimFound: 'Found',
  Triaged: 'Triage', Routed: 'Route', Closed: 'Closed',
};

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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtCoord(v: number | null) { return v != null ? v.toFixed(4) : '—'; }
function stageIdx(s: IncidentStatus) { return STAGES.indexOf(s); }

interface IncidentDetailViewProps {
  incidentId: string | null;
}

export default function IncidentDetailView({ incidentId }: IncidentDetailViewProps) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!incidentId) return;
    let stopped = false;
    setLoading(true);

    const poll = async () => {
      try {
        const res = await fetch(`/api/incidents/${incidentId}`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const data: Incident = await res.json();
        setIncident(data);
        if (data.status === 'Closed') stopped = true;
      } catch {}
      finally { setLoading(false); }
    };

    poll();
    const id = setInterval(() => { if (!stopped) poll(); }, 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [incidentId]);

  if (!incidentId) {
    return (
      <div className="incident-detail-empty">
        <div>No incident selected</div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="incident-detail-empty">
        <div style={{ animation: 'dotPulse 1s ease-in-out infinite' }}>
          ↻ Loading incident…
        </div>
      </div>
    );
  }

  const inc = incident;
  const cur = stageIdx(inc.status);
  const isCritical = inc.status === 'Triggered' || inc.status === 'Searching';
  const accentColor = isCritical ? 'var(--db-red)' : inc.status === 'Closed' ? 'var(--db-green)' : 'var(--db-amber)';

  return (
    <div className="incident-detail">
      {/* Header */}
      <div className="incident-detail-header">
        <div>
          <div className="incident-detail-id">{inc.id.slice(0, 12)}…</div>
          <div className="incident-detail-type" style={{ color: accentColor }}>{inc.triggerType}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span className="incident-detail-status" style={{ borderColor: accentColor, color: accentColor }}>
            {inc.status}
          </span>
          {loading && <span style={{ fontSize: '0.55rem', color: 'var(--db-muted)' }}>↻ polling</span>}
        </div>
      </div>

      {/* Pipeline */}
      <div className="incident-detail-pipeline">
        <div className="pipeline-label">Response Pipeline</div>
        <div className="pipeline-stages">
          {STAGES.map((s, i) => {
            const done = i <= cur;
            const current = i === cur;
            const color = !done ? 'rgba(220,232,240,0.08)'
              : s === 'Closed' ? 'var(--db-green)'
              : (s === 'Triggered' || s === 'Searching') ? 'var(--db-red)'
              : 'var(--db-amber)';
            return (
              <div key={s} className="pipeline-stage">
                <div className="pipeline-bar" style={{
                  background: color,
                  boxShadow: current ? `0 0 6px ${color}` : 'none',
                }} />
                <div className="pipeline-stage-label" style={{ color: done ? color : 'var(--db-muted)' }}>
                  {STAGE_LABELS[s]}
                </div>
              </div>
            );
          })}
        </div>
        <div className="pipeline-coords">
          📍 {fmtCoord(inc.locationLat)}, {fmtCoord(inc.locationLng)} · {fmtTime(inc.createdAt)}
        </div>
      </div>

      {/* Search Zones */}
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
                    <div className="zone-fill" style={{
                      width: `${z.confidence * 100}%`,
                      background: ['var(--db-red)','var(--db-amber)','var(--db-yellow)'][i] ?? 'var(--db-muted)',
                    }} />
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

      {/* Drone Result */}
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

      {/* Triage */}
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

      {/* Responder Route */}
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

      {/* Post-Mortem */}
      {inc.report && <PostMortemSection report={inc.report} />}
    </div>
  );
}

function PostMortemSection({ report }: { report: IncidentReport }) {
  const { timeline, responseMetrics: m, recommendations } = report;
  return (
    <>
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Post-Mortem Report</span>
          <span className="panel-badge" style={{ color: 'var(--db-green)' }}>● CLOSED</span>
        </div>
        <div className="incident-meta" style={{ padding: '10px 20px 8px' }}>
          <strong>Total response</strong> {timeline.totalResponseMinutes} min<br />
          <strong>Drone search</strong> {timeline.droneSearchSeconds}s<br />
          <strong>Victim found</strong> {timeline.victimFound ? 'Yes' : 'No'}
          {timeline.triageSeverity && <><br /><strong>Triage severity</strong> {timeline.triageSeverity}</>}
        </div>
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
      <div className="panel-section">
        <div className="panel-heading"><span className="panel-title">Root Cause</span></div>
        <p style={{ padding: '10px 20px', fontSize: '0.65rem', color: 'var(--db-text)', lineHeight: 1.6, margin: 0 }}>
          {report.rootCauseAnalysis}
        </p>
      </div>
      {recommendations.length > 0 && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">Recommendations</span>
            <span className="panel-badge">{recommendations.length}</span>
          </div>
          {recommendations.map((r: TrailRecommendation, i: number) => (
            <div key={i} style={{ padding: '10px 20px 8px', borderBottom: '1px solid var(--db-border2)' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.58rem', letterSpacing: '0.08em', padding: '2px 6px', border: '1px solid rgba(220,232,240,0.15)', color: 'var(--db-text)' }}>
                  {CAT_LABEL[r.category] ?? r.category}
                </span>
                <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: PRI_COLOR[r.priority] ?? 'var(--db-muted)' }}>
                  {r.priority}
                </span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--db-text)', marginBottom: '3px' }}>{r.description}</div>
              <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', lineHeight: 1.5 }}>{r.rationale}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
