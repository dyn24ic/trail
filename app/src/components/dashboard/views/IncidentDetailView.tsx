'use client';

import { useState, useEffect } from 'react';
import type {
  Incident, IncidentStatus, IncidentReport, TrailRecommendation,
  AiRecommendation, PoliceReport, AmbulanceReport,
} from '@/types/backend';

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
  const [aiLoading, setAiLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const advanceStage = async () => {
    if (!incidentId) return;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/advance`, { method: 'POST' });
      if (res.ok) {
        const data: Incident = await res.json();
        setIncident(data);
      }
    } finally {
      setAdvancing(false);
    }
  };

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
        {inc.status !== 'Closed' && (() => {
          const stageActionLabel: Record<IncidentStatus, string> = {
            Triggered:   '▶ Predict Search Zones',
            Searching:   '▶ Deploy Drone Scan',
            VictimFound: '▶ Run Triage',
            Triaged:     '▶ Plan Responder Route',
            Routed:      '▶ Generate Report & Close',
            Closed:      '',
          };
          return (
            <div style={{ padding: '8px 20px 4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                onClick={advanceStage}
                disabled={advancing}
                style={{
                  background: advancing ? 'rgba(255,255,255,0.04)' : `${accentColor}18`,
                  border: `1px solid ${accentColor}`,
                  color: accentColor,
                  fontFamily: "'Share Tech Mono', monospace",
                  fontSize: '0.6rem',
                  padding: '5px 12px',
                  cursor: advancing ? 'not-allowed' : 'pointer',
                  opacity: advancing ? 0.6 : 1,
                  letterSpacing: '0.05em',
                  borderRadius: '2px',
                }}
              >
                {advancing ? '↻ Running…' : stageActionLabel[inc.status]}
              </button>
            </div>
          );
        })()}
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

      {/* External Reports + AI Recommendation (only after incident is Closed) */}
      {inc.status === 'Closed' && (
        <>
          <ExternalReportsSection
            incidentId={inc.id}
            externalReports={inc.externalReports}
            onSaved={(updated) => setIncident(prev => prev ? { ...prev, externalReports: updated } : prev)}
          />
          <AiRecommendationSection
            incidentId={inc.id}
            recommendation={inc.aiRecommendation}
            loading={aiLoading}
            onGenerate={async () => {
              setAiLoading(true);
              try {
                const res = await fetch(`/api/incidents/${inc.id}/ai-recommendation`, { method: 'POST' });
                if (res.ok) {
                  const reco: AiRecommendation = await res.json();
                  setIncident(prev => prev ? { ...prev, aiRecommendation: reco } : prev);
                }
              } finally {
                setAiLoading(false);
              }
            }}
          />
        </>
      )}
    </div>
  );
}

// ── External Reports Section ──────────────────────────────────────────────────

function ExternalReportsSection({
  incidentId, externalReports, onSaved,
}: {
  incidentId: string;
  externalReports: Incident['externalReports'];
  onSaved: (updated: Incident['externalReports']) => void;
}) {
  const [showPolice, setShowPolice]     = useState(false);
  const [showAmbulance, setShowAmbulance] = useState(false);
  const [policeForm, setPoliceForm]     = useState<Omit<PoliceReport, 'submittedAt'>>({
    officerName: '', badgeNumber: '', description: '', crimeInvolved: false,
  });
  const [ambulanceForm, setAmbulanceForm] = useState<Omit<AmbulanceReport, 'submittedAt'>>({
    paramedicName: '', vehicleId: '', treatmentGiven: '', hospitalDestination: null,
  });
  const [saving, setSaving] = useState<'police' | 'ambulance' | null>(null);

  const submitPolice = async () => {
    setSaving('police');
    try {
      const payload: PoliceReport = { ...policeForm, submittedAt: new Date().toISOString() };
      const res = await fetch(`/api/incidents/${incidentId}/police-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved({
          police: payload,
          ambulance: externalReports?.ambulance ?? null,
        });
        setShowPolice(false);
      }
    } finally { setSaving(null); }
  };

  const submitAmbulance = async () => {
    setSaving('ambulance');
    try {
      const payload: AmbulanceReport = { ...ambulanceForm, submittedAt: new Date().toISOString() };
      const res = await fetch(`/api/incidents/${incidentId}/ambulance-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved({
          police: externalReports?.police ?? null,
          ambulance: payload,
        });
        setShowAmbulance(false);
      }
    } finally { setSaving(null); }
  };

  const labelStyle: React.CSSProperties = { fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '3px' };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'rgba(220,232,240,0.05)', border: '1px solid var(--db-border2)', color: 'var(--db-text)', fontSize: '0.65rem', padding: '5px 8px', outline: 'none', boxSizing: 'border-box' };
  const btnStyle = (active?: boolean): React.CSSProperties => ({
    fontSize: '0.6rem', letterSpacing: '0.08em', padding: '4px 10px',
    border: `1px solid ${active ? 'var(--db-blue)' : 'var(--db-border2)'}`,
    color: active ? 'var(--db-blue)' : 'var(--db-muted)', background: 'transparent', cursor: 'pointer',
  });

  return (
    <div className="panel-section">
      <div className="panel-heading">
        <span className="panel-title">Agency Reports</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {!externalReports?.police && (
            <button style={btnStyle(showPolice)} onClick={() => setShowPolice(p => !p)}>
              {showPolice ? '✕ Cancel' : '+ Police'}
            </button>
          )}
          {!externalReports?.ambulance && (
            <button style={btnStyle(showAmbulance)} onClick={() => setShowAmbulance(p => !p)}>
              {showAmbulance ? '✕ Cancel' : '+ Ambulance'}
            </button>
          )}
        </div>
      </div>

      {/* Existing police report */}
      {externalReports?.police && (
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--db-border2)', fontSize: '0.62rem' }}>
          <div style={{ color: 'var(--db-blue)', marginBottom: '4px', fontSize: '0.58rem', letterSpacing: '0.08em' }}>POLICE · {externalReports.police.officerName} #{externalReports.police.badgeNumber}</div>
          <div style={{ color: 'var(--db-text)', lineHeight: 1.5 }}>{externalReports.police.description}</div>
          {externalReports.police.crimeInvolved && <div style={{ color: 'var(--db-amber)', marginTop: '4px', fontSize: '0.58rem' }}>⚠ Crime involvement noted</div>}
        </div>
      )}

      {/* Existing ambulance report */}
      {externalReports?.ambulance && (
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--db-border2)', fontSize: '0.62rem' }}>
          <div style={{ color: 'var(--db-green)', marginBottom: '4px', fontSize: '0.58rem', letterSpacing: '0.08em' }}>AMBULANCE · {externalReports.ambulance.paramedicName} · {externalReports.ambulance.vehicleId}</div>
          <div style={{ color: 'var(--db-text)', lineHeight: 1.5 }}>{externalReports.ambulance.treatmentGiven}</div>
          {externalReports.ambulance.hospitalDestination && <div style={{ color: 'var(--db-muted)', marginTop: '3px' }}>→ {externalReports.ambulance.hospitalDestination}</div>}
        </div>
      )}

      {/* Police report form */}
      {showPolice && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--db-border2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--db-blue)', letterSpacing: '0.08em', marginBottom: '2px' }}>POLICE REPORT</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Officer Name</label>
              <input style={inputStyle} value={policeForm.officerName} onChange={e => setPoliceForm(f => ({ ...f, officerName: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Badge Number</label>
              <input style={inputStyle} value={policeForm.badgeNumber} onChange={e => setPoliceForm(f => ({ ...f, badgeNumber: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Report Description</label>
            <textarea style={{ ...inputStyle, height: '60px', resize: 'vertical' }} value={policeForm.description} onChange={e => setPoliceForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="crimeInvolved" checked={policeForm.crimeInvolved} onChange={e => setPoliceForm(f => ({ ...f, crimeInvolved: e.target.checked }))} />
            <label htmlFor="crimeInvolved" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>Crime involvement suspected</label>
          </div>
          <button style={{ ...btnStyle(true), alignSelf: 'flex-start' }} onClick={submitPolice} disabled={saving === 'police'}>
            {saving === 'police' ? '↻ Saving…' : 'Submit Police Report'}
          </button>
        </div>
      )}

      {/* Ambulance report form */}
      {showAmbulance && (
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--db-green)', letterSpacing: '0.08em', marginBottom: '2px' }}>AMBULANCE REPORT</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Paramedic Name</label>
              <input style={inputStyle} value={ambulanceForm.paramedicName} onChange={e => setAmbulanceForm(f => ({ ...f, paramedicName: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Vehicle / Unit ID</label>
              <input style={inputStyle} value={ambulanceForm.vehicleId} onChange={e => setAmbulanceForm(f => ({ ...f, vehicleId: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Treatment Given</label>
            <textarea style={{ ...inputStyle, height: '60px', resize: 'vertical' }} value={ambulanceForm.treatmentGiven} onChange={e => setAmbulanceForm(f => ({ ...f, treatmentGiven: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Hospital Destination (optional)</label>
            <input style={inputStyle} value={ambulanceForm.hospitalDestination ?? ''} onChange={e => setAmbulanceForm(f => ({ ...f, hospitalDestination: e.target.value || null }))} />
          </div>
          <button style={{ ...btnStyle(true), alignSelf: 'flex-start' }} onClick={submitAmbulance} disabled={saving === 'ambulance'}>
            {saving === 'ambulance' ? '↻ Saving…' : 'Submit Ambulance Report'}
          </button>
        </div>
      )}

      {!externalReports?.police && !externalReports?.ambulance && !showPolice && !showAmbulance && (
        <div style={{ padding: '10px 20px', fontSize: '0.62rem', color: 'var(--db-muted)' }}>
          No agency reports submitted yet.
        </div>
      )}
    </div>
  );
}

// ── AI Recommendation Section ─────────────────────────────────────────────────

function AiRecommendationSection({
  incidentId: _incidentId, recommendation, loading, onGenerate,
}: {
  incidentId: string;
  recommendation: AiRecommendation | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="panel-section">
      <div className="panel-heading">
        <span className="panel-title">AI Recommendation</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {recommendation && (
            <span style={{ fontSize: '0.55rem', color: 'var(--db-muted)', letterSpacing: '0.06em' }}>
              {recommendation.modelUsed}
            </span>
          )}
          <button
            onClick={onGenerate}
            disabled={loading}
            style={{
              fontSize: '0.6rem', letterSpacing: '0.08em', padding: '4px 10px',
              border: '1px solid var(--db-blue)', color: 'var(--db-blue)',
              background: 'transparent', cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? '↻ Generating…' : recommendation ? '↺ Regenerate' : '⚡ Generate'}
          </button>
        </div>
      </div>

      {!recommendation && !loading && (
        <div style={{ padding: '10px 20px', fontSize: '0.62rem', color: 'var(--db-muted)' }}>
          Generate an AI-powered recommendation using all incident data, reports, and findings.
        </div>
      )}

      {loading && (
        <div style={{ padding: '10px 20px', fontSize: '0.62rem', color: 'var(--db-blue)', animation: 'dotPulse 1s ease-in-out infinite' }}>
          ↻ Analysing incident data with gpt-4o-mini…
        </div>
      )}

      {recommendation && (
        <>
          <p style={{ padding: '10px 20px 4px', fontSize: '0.65rem', color: 'var(--db-text)', lineHeight: 1.6, margin: 0 }}>
            {recommendation.summary}
          </p>
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--db-border2)' }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--db-amber)', letterSpacing: '0.08em', marginBottom: '6px' }}>IMMEDIATE ACTIONS</div>
            {recommendation.immediateActions.map((a, i) => (
              <div key={i} style={{ fontSize: '0.63rem', color: 'var(--db-text)', marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid var(--db-amber)' }}>
                {a}
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--db-border2)' }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--db-green)', letterSpacing: '0.08em', marginBottom: '6px' }}>PREVENTION MEASURES</div>
            {recommendation.preventionMeasures.map((m, i) => (
              <div key={i} style={{ fontSize: '0.63rem', color: 'var(--db-text)', marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid var(--db-green)' }}>
                {m}
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 20px 12px', borderTop: '1px solid var(--db-border2)' }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.08em', marginBottom: '6px' }}>RESOURCE NOTES</div>
            <p style={{ fontSize: '0.63rem', color: 'var(--db-text)', lineHeight: 1.6, margin: 0 }}>
              {recommendation.resourceNotes}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Post-Mortem Section ───────────────────────────────────────────────────────

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
