'use client';

import { useState, useEffect, useCallback } from 'react';
import type { IncidentSummary, Incident } from '@/types/backend';

export function useIncidents(pollMs = 15_000) {
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
