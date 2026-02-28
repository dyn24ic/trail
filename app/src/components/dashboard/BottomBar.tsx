'use client';

import { useIncidents } from '@/lib/incidents/useIncidents';
import type { IncidentSummary, IncidentStatus } from '@/types/backend';

function evClass(status: IncidentStatus): string {
  if (status === 'Triggered' || status === 'Searching') return 'ev-crit';
  if (status === 'Closed') return 'ev-ok';
  return 'ev-warn';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Entry({ inc }: { inc: IncidentSummary }) {
  return (
    <div className="log-entry">
      <span className="ts">{fmtTime(inc.createdAt)}</span>
      <span className={evClass(inc.status)}>
        [{inc.triggerType}] {inc.status} — {
          inc.locationLat != null
            ? `${inc.locationLat.toFixed(4)}, ${inc.locationLng?.toFixed(4)}`
            : 'location unknown'
        }
      </span>
    </div>
  );
}

export default function BottomBar() {
  const { incidents } = useIncidents();

  const sorted = [...incidents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="bottombar">
      <span className="log-label">Event Log</span>
      <div className="log-ticker">
        <div className="log-track">
          {sorted.length === 0 ? (
            <div className="log-entry">
              <span className="ts">—</span>
              <span style={{ color: 'var(--db-muted)' }}>No events</span>
            </div>
          ) : (
            // Duplicate entries for seamless ticker loop (animation scrolls -50%)
            [...sorted, ...sorted].map((inc, i) => <Entry key={`${inc.id}-${i}`} inc={inc} />)
          )}
        </div>
      </div>
    </div>
  );
}
