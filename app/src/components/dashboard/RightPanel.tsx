'use client';

interface RightPanelProps {
  open: boolean;
  onTogglePanel: () => void;
}

export default function RightPanel({ open, onTogglePanel }: RightPanelProps) {
  return (
    <aside className={`panel-drawer panel-drawer--right${open ? ' open' : ''}`}>
      <div className="panel-close-btn" onClick={onTogglePanel}>
        <span>✕ OPS</span>
      </div>

      {/* ── Active Incidents ──────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Active Incidents</span>
          <span className="panel-badge">0 Open</span>
        </div>
        <div style={{ padding: '16px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', textAlign: 'center' }}>
          No active incidents
        </div>
      </div>

      {/* AI Recommendations */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">AI Recommendations</span>
        </div>
        <div style={{ padding: '16px 20px', fontSize: '0.62rem', color: 'var(--db-muted)', textAlign: 'center' }}>
          No recommendations
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
