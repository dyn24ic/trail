'use client';

import { useState, useEffect, useRef } from 'react';
import { TRACKED_HIKERS } from '@/data/trackedHikers';
import type { TrackedHiker, TrackedSensor } from '@/data/trackedHikers';

export interface HikerSensorState {
  sensor: TrackedSensor;
  status: 'pending' | 'detected' | 'missed';
  firedAt?: string;
}

export interface LogEntry {
  time: string;
  sensorLabel: string;
  mac: string;
  status: 'detected' | 'missed';
}

export interface HikerState {
  hiker: TrackedHiker;
  sensorStates: HikerSensorState[];
  logEntries: LogEntry[];
  deviated: boolean;
  lastKnownLat: number | null;
  lastKnownLon: number | null;
}

export interface DeviantHiker {
  id: string;
  name: string;
  mac: string;
  trail: string;
  lat: number;
  lon: number;
  logEntries: LogEntry[];
}

// Wall-clock display: offset from 09:00:00
function formatTime(elapsedMs: number): string {
  const base = 9 * 3600; // 09:00:00 in seconds
  const total = base + Math.floor(elapsedMs / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function initStates(): HikerState[] {
  return TRACKED_HIKERS.map(hiker => ({
    hiker,
    sensorStates: hiker.sensors.map(sensor => ({ sensor, status: 'pending' as const })),
    logEntries: [],
    deviated: false,
    lastKnownLat: null,
    lastKnownLon: null,
  }));
}

export function useHikerTracking(): HikerState[] {
  const [states, setStates] = useState<HikerState[]>(initStates);
  const startTimeRef = useRef<number>(Date.now());
  const nextEventIdxRef = useRef<Record<string, number>>({});
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/demo/hiker-advance', { cache: 'no-store' });
        if (!res.ok) return;
        const { advances, reset } = await res.json() as { advances: string[]; reset: boolean };

        if (reset) {
          startTimeRef.current = Date.now();
          nextEventIdxRef.current = {};
          firedRef.current = new Set();
          setStates(initStates());
          return;
        }

        if (advances.length === 0) return;

        setStates(prev => {
          let changed = false;
          const next = prev.map(hs => {
            const toFire = advances.filter(hikerId => hikerId === hs.hiker.id);
            if (toFire.length === 0) return hs;

            const newSensorStates = [...hs.sensorStates];
            const newLogEntries = [...hs.logEntries];
            let deviated = hs.deviated;
            let lastKnownLat = hs.lastKnownLat;
            let lastKnownLon = hs.lastKnownLon;

            toFire.forEach(() => {
              const idx = nextEventIdxRef.current[hs.hiker.id] ?? 0;
              const ev = hs.hiker.events[idx];
              if (!ev) return;

              changed = true;
              nextEventIdxRef.current[hs.hiker.id] = idx + 1;

              const key = `${hs.hiker.id}-${ev.sensorId}`;
              if (firedRef.current.has(key)) return;
              firedRef.current.add(key);

              const sIdx = newSensorStates.findIndex(ss => ss.sensor.id === ev.sensorId);
              if (sIdx < 0) return;

              const timeStr = formatTime(Date.now() - startTimeRef.current);
              newSensorStates[sIdx] = {
                ...newSensorStates[sIdx],
                status: ev.status,
                firedAt: timeStr,
              };
              newLogEntries.push({
                time: timeStr,
                sensorLabel: newSensorStates[sIdx].sensor.label,
                mac: hs.hiker.mac,
                status: ev.status,
              });
              if (ev.status === 'missed') deviated = true;
              if (ev.status === 'detected') {
                lastKnownLat = newSensorStates[sIdx].sensor.lat;
                lastKnownLon = newSensorStates[sIdx].sensor.lon;
              }
            });

            return { ...hs, sensorStates: newSensorStates, logEntries: newLogEntries, deviated, lastKnownLat, lastKnownLon };
          });

          return changed ? next : prev;
        });
      } catch {
        // ignore fetch errors (API not available yet on first render)
      }
    }, 600);

    return () => clearInterval(id);
  }, []);

  return states;
}
