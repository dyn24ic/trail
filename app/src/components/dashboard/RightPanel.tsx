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

      {/* Active Incidents */}
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
