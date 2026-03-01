'use client';

import { useState, useCallback } from 'react';
import type { BleScannerSuggestion } from '@/types/markers';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

export function useSensorSuggestions() {
  const [status, setStatus]   = useState<Status>('idle');
  const [scanners, setScanners] = useState<BleScannerSuggestion[]>([]);

  const load = useCallback(async () => {
    if (status === 'loading') return;
    setStatus('loading');
    try {
      const res = await fetch('/api/sensors/suggest');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setScanners(data.scanners);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }, [status]);

  const clear = useCallback(() => {
    setScanners([]);
    setStatus('idle');
  }, []);

  return { status, scanners, load, clear };
}
