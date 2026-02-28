export default function BottomBar() {
  return (
    <div className="bottombar">
      <span className="log-label">Event Log</span>
      <div className="log-ticker">
        <div className="log-track">
          <div className="log-entry">
            <span className="ts">—</span>
            <span style={{ color: 'var(--db-muted)' }}>No events</span>
          </div>
        </div>
      </div>
    </div>
  );
}
