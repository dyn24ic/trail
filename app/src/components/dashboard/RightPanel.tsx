'use client';

import { useState } from 'react';
import { useIncidents } from '@/lib/incidents/useIncidents';
import type { IncidentSummary, IncidentStatus } from '@/types/backend';
import type { DashboardLayout } from '@/hooks/useDashboardLayout';
import type { Tab } from '@/hooks/useTabs';
import type { HikerState } from '@/hooks/useHikerTracking';
import HikerTrackingPanel from './HikerTrackingPanel';
import IncidentDetailView from './views/IncidentDetailView';

// ── Helpers ──────────────────────────────────────────────────────────────────

function borderColor(status: IncidentStatus): string {
  if (status === 'Triggered' || status === 'Searching') return 'var(--db-red)';
  if (status === 'Closed') return 'var(--db-blue)';
  return 'var(--db-amber)';
}

function statusColor(status: IncidentStatus): string {
  if (status === 'Triggered' || status === 'Searching') return 'var(--db-red)';
  if (status === 'Closed') return 'var(--db-green)';
  return 'var(--db-amber)';
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

// ── RightPanel ────────────────────────────────────────────────────────────

interface RightPanelProps {
  rightTab: DashboardLayout['rightTab'];
  setRightTab: (tab: DashboardLayout['rightTab']) => void;
  openTab: (tab: Tab) => void;
  hikerStates: HikerState[];
}

const TABS: { id: DashboardLayout['rightTab']; label: string }[] = [
  { id: 'active', label: 'ACTIVE' },
  { id: 'ai',     label: 'AI'     },
  { id: 'hikers', label: 'HIKERS' },
];

export default function RightPanel({ rightTab, setRightTab, openTab, hikerStates }: RightPanelProps) {
  const { incidents } = useIncidents();
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const deviantCount = hikerStates.filter(s => s.deviated).length;
  const visible = incidents.filter(i => !archivedIds.has(i.id));
  const sorted = [...visible].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const openCount = visible.filter(i => i.status !== 'Closed').length;

  return (
    <aside className="sidebar sidebar--right">
      {/* Internal tab strip */}
      <div className="sidebar-tab-strip">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`sidebar-tab${rightTab === t.id ? ' active' : ''}`}
            onClick={() => setRightTab(t.id)}
          >
            {t.label}
            {t.id === 'hikers' && deviantCount > 0 && (
              <span style={{
                marginLeft: '4px',
                color: '#FF3B3B',
                fontSize: '0.6rem',
                fontWeight: 'bold',
              }}>
                {deviantCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="sidebar-content">
        {rightTab === 'active' && (
          selectedIncidentId ? (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--db-border2)', flexShrink: 0 }}>
                <button
                  onClick={() => setSelectedIncidentId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--db-muted)',
                    cursor: 'pointer',
                    fontSize: '0.62rem',
                    letterSpacing: '0.08em',
                    padding: '2px 0',
                  }}
                >
                  ← Back to list
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <IncidentDetailView incidentId={selectedIncidentId} />
              </div>
            </div>
          ) : (
            <ActiveTab
              incidents={sorted}
              openCount={openCount}
              onOpenAnalytics={() => openTab({ id: 'analytics', title: '◈ Analytics', type: 'analytics', closeable: true })}
              onArchiveAll={() => setArchivedIds(prev => new Set([...prev, ...incidents.map(i => i.id)]))}
              onOpenDetail={setSelectedIncidentId}
            />
          )
        )}
        {rightTab === 'ai' && <AITab />}
        {rightTab === 'hikers' && <HikerTrackingPanel hikerStates={hikerStates} />}
      </div>
    </aside>
  );
}

// ── Active Tab ────────────────────────────────────────────────────────────

function ActiveTab({
  incidents,
  openCount,
  onOpenAnalytics,
  onArchiveAll,
  onOpenDetail,
}: {
  incidents: IncidentSummary[];
  openCount: number;
  onOpenAnalytics: () => void;
  onArchiveAll: () => void;
  onOpenDetail: (id: string) => void;
}) {

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div className="panel-heading">
        <span className="panel-title">Active Incidents</span>
        <span className="panel-badge" style={openCount > 0 ? { color: 'var(--db-red)' } : {}}>
          {openCount} Open
        </span>
        {incidents.length > 0 && (
          <button
            onClick={onArchiveAll}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              background: 'rgba(255,80,80,0.08)',
              border: '1px solid rgba(255,80,80,0.3)',
              color: '#FF5050',
              borderRadius: '2px',
              fontSize: '0.55rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Archive All
          </button>
        )}
      </div>

      {incidents.length === 0 ? (
        <div style={{ padding: '24px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', textAlign: 'center', lineHeight: 2 }}>
          No incidents
        </div>
      ) : (
        incidents.map(inc => (
          <div
            key={inc.id}
            className="incident-card"
            style={{ borderLeftColor: borderColor(inc.status) }}
          >
            <div className="incident-header">
              <span className="incident-id">{inc.id.slice(-8).toUpperCase()}</span>
              <span className="incident-time">{relativeTime(inc.createdAt)}</span>
            </div>

            <div className="incident-type" style={{ color: statusColor(inc.status) }}>
              {inc.triggerType}
            </div>

            <div className="incident-meta">
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.58rem',
                  letterSpacing: '0.1em',
                  padding: '1px 6px',
                  border: `1px solid ${statusColor(inc.status)}`,
                  color: statusColor(inc.status),
                  marginBottom: '4px',
                }}
              >
                {inc.status}
              </span>
              <br />
              {inc.locationLat != null && (
                <span style={{ color: 'var(--db-muted)' }}>
                  {inc.locationLat.toFixed(4)}, {inc.locationLng?.toFixed(4)}
                </span>
              )}
            </div>

            <div className="incident-footer">
              <span className="incident-zone">
                {inc.status === 'Closed' ? '● CLOSED' : '◉ ACTIVE'}
              </span>
              <button
                className={`incident-action ${
                  inc.status === 'Triggered' || inc.status === 'Searching'
                    ? 'action-red'
                    : inc.status === 'Closed'
                    ? 'action-green'
                    : 'action-amber'
                }`}
                onClick={() => onOpenDetail(inc.id)}
              >
                Open Detail →
              </button>
            </div>
          </div>
        ))
      )}

      {/* Analytics button */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--db-border2)' }}>
        <button
          className="incident-action action-green"
          style={{ width: '100%', textAlign: 'center', padding: '6px' }}
          onClick={onOpenAnalytics}
        >
          ◈ Open Analytics →
        </button>
      </div>
    </div>
  );
}

// ── AI Tab ─────────────────────────────────────────────────────────────────

function AITab() {
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div className="panel-heading">
        <span className="panel-title">AI Recommendations</span>
        <span className="panel-badge" style={{ color: 'var(--db-muted)' }}>System AI</span>
      </div>
      <div style={{ padding: '16px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', lineHeight: 1.8 }}>
        <div style={{ marginBottom: '12px', color: 'var(--db-green)', fontSize: '0.65rem' }}>
          ● AI Analysis Ready
        </div>
        <div style={{ marginBottom: '8px' }}>
          AI recommendations are generated post-incident and viewable in incident detail tabs.
        </div>
        <div style={{ borderTop: '1px solid var(--db-border2)', paddingTop: '12px', marginTop: '12px' }}>
          <div style={{ color: 'var(--db-label)', marginBottom: '6px' }}>Active Capabilities:</div>
          {[
            '▶ Search zone prediction',
            '▶ Triage severity scoring',
            '▶ Responder route optimization',
            '▶ Post-mortem root cause analysis',
            '▶ Trail safety recommendations',
          ].map(item => (
            <div key={item} style={{ marginBottom: '4px' }}>{item}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
