'use client';

import { useState, useEffect, useCallback } from 'react';
import type { IncidentSummary, Incident, ScalaSearchZone } from '@/types/backend';

export function useIncidents(pollMs = 3_000) {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const poll = useCallback(() => {
    fetch('/api/incidents', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data)) setIncidents(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, pollMs);
    return () => clearInterval(id);
  }, [poll, pollMs]);

  return { incidents, loading };
}

export function useIncidentDetail(id: string | null) {
  const [incident, setIncident] = useState<Incident | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/incidents/${id}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.id) setIncident(data); })
      .catch(() => {});
  }, [id]);

  return incident;
}

/** Polls full details for all non-Closed incidents (for map overlays). */
export function useActiveIncidentDetails(pollMs = 4_000) {
  const [active, setActive] = useState<Incident[]>([]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents', { cache: 'no-store' });
      if (!res.ok) return;
      const summaries: IncidentSummary[] = await res.json();
      const nonClosed = summaries.filter(i => i.status !== 'Closed');
      if (nonClosed.length === 0) { setActive([]); return; }
      const details = await Promise.all(
        nonClosed.map(i =>
          fetch(`/api/incidents/${i.id}`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() as Promise<Incident> : null)
            .catch(() => null),
        ),
      );
      setActive(details.filter((d): d is Incident => d !== null));
    } catch {}
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, pollMs);
    return () => clearInterval(id);
  }, [poll, pollMs]);

  return active;
}

export type { ScalaSearchZone };
