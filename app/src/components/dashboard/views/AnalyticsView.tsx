'use client';

import { useState, useEffect } from 'react';
import { useIncidents } from '@/lib/incidents/useIncidents';

interface BackendHealth {
  status: string;
  uptime_seconds?: number;
  incidents_tracked?: number;
}

export default function AnalyticsView() {
  const { incidents, loading } = useIncidents();
  const [health, setHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    fetch('/api/backend-health')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHealth(data); })
      .catch(() => {});
  }, []);

  // Group incidents by trigger type
  const byTrigger: Record<string, number> = {};
  for (const inc of incidents) {
    byTrigger[inc.triggerType] = (byTrigger[inc.triggerType] ?? 0) + 1;
  }

  // Group by status
  const openCount = incidents.filter(i => i.status !== 'Closed').length;
  const closedCount = incidents.filter(i => i.status === 'Closed').length;

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <div className="analytics-title">◈ Analytics</div>
        <div className="analytics-subtitle">System metrics and incident overview</div>
      </div>

      {/* Backend health */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Backend Health</span>
          {health ? (
            <span className="panel-badge" style={{ color: health.status === 'ok' ? 'var(--db-green)' : 'var(--db-red)' }}>
              {health.status === 'ok' ? '● ONLINE' : '○ OFFLINE'}
            </span>
          ) : (
            <span className="panel-badge" style={{ color: 'var(--db-muted)' }}>Checking…</span>
          )}
        </div>
        {health && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', padding: '14px 20px' }}>
            {([
              ['Status', health.status === 'ok' ? 'Online' : health.status],
              ['Uptime', health.uptime_seconds != null ? `${Math.floor(health.uptime_seconds / 60)}m` : '—'],
              ['Tracked', health.incidents_tracked != null ? String(health.incidents_tracked) : '—'],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '0.9rem', color: 'var(--db-text-bright)' }}>{val}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incident summary */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Incident Summary</span>
          <span className="panel-badge">{loading ? '…' : incidents.length} total</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '14px 20px' }}>
          <div>
            <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Open</div>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '1.4rem', color: openCount > 0 ? 'var(--db-red)' : 'var(--db-green)' }}>{openCount}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.58rem', color: 'var(--db-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Closed</div>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '1.4rem', color: 'var(--db-text-bright)' }}>{closedCount}</div>
          </div>
        </div>
      </div>

      {/* By trigger type */}
      {Object.keys(byTrigger).length > 0 && (
        <div className="panel-section">
          <div className="panel-heading">
            <span className="panel-title">By Trigger Type</span>
          </div>
          <div style={{ padding: '8px 20px 12px' }}>
            {Object.entries(byTrigger).map(([type, count]) => {
              const maxCount = Math.max(...Object.values(byTrigger));
              return (
                <div key={type} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--db-text)' }}>{type}</span>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '0.7rem', color: 'var(--db-amber)' }}>{count}</span>
                  </div>
                  <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: `${(count / maxCount) * 100}%`, background: 'var(--db-amber)', borderRadius: '2px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sensor network placeholder */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Sensor Network</span>
          <span className="panel-badge">0 Nodes</span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div className="sensor-summary">
            {([
              ['Active / Nominal', 0, 'count-ok'],
              ['Alert / Motion',   0, 'count-alert'],
              ['Warning / Elevated', 0, 'count-warn'],
              ['Offline',          0, 'count-muted'],
            ] as [string, number, string][]).map(([label, count, cls]) => (
              <div key={label} className="sensor-row">
                <span className="sensor-label">{label}</span>
                <span className={`sensor-count ${cls}`}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* No incidents placeholder */}
      {incidents.length === 0 && !loading && (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--db-muted)', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
          No incident data available
        </div>
      )}
    </div>
  );
}
