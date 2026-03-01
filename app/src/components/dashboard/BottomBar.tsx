'use client';

import { useState, useEffect } from 'react';
import { useIncidents } from '@/lib/incidents/useIncidents';
import type { IncidentSummary, IncidentStatus } from '@/types/backend';

interface BottomBarProps {
  mapCoords?: { lat: number; lon: number } | null;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusWord(status: IncidentStatus): string {
  const map: Record<IncidentStatus, string> = {
    Triggered: 'Triggered', Searching: 'Searching', VictimFound: 'Found',
    Triaged: 'Triaged', Routed: 'Routed', Closed: 'Closed',
  };
  return map[status] ?? status;
}

export default function BottomBar({ mapCoords }: BottomBarProps) {
  const { incidents } = useIncidents();
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/backend-health')
      .then(r => r.ok ? r.json() : null)
      .then(data => setBackendOnline(data?.status === 'ok'))
      .catch(() => setBackendOnline(false));
  }, []);

  const sorted: IncidentSummary[] = [...incidents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const last = sorted[0] ?? null;

  const coordStr = mapCoords
    ? `${mapCoords.lat.toFixed(4)}°N ${Math.abs(mapCoords.lon).toFixed(4)}°W`
    : '37.7459°N 119.5332°W';

  return (
    <div className="statusbar">
      <span className="sb-live">
        <span className="status-dot" style={{ width: '5px', height: '5px' }} />
        LIVE
      </span>

      <span className="sb-sep">│</span>

      <span className="sb-coords">{coordStr}</span>

      <span className="sb-sep">│</span>

      <span className="sb-backend">
        Backend:{' '}
        <span style={{ color: backendOnline === true ? 'var(--db-green)' : backendOnline === false ? 'var(--db-red)' : 'var(--db-muted)' }}>
          {backendOnline === true ? '● Active' : backendOnline === false ? '○ Offline' : '…'}
        </span>
      </span>

      <span className="sb-sep">│</span>

      <span className="sb-last">
        {last
          ? `Last: ${fmtTime(last.createdAt)} ${statusWord(last.status)} — ${last.triggerType}`
          : 'No events'}
      </span>
    </div>
  );
}
