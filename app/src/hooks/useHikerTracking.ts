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

const MAX_DURATION_MS = Math.max(...TRACKED_HIKERS.map(h => h.simulationDurationMs));
const HOLD_MS = 8000;
const TICK_MS = 500;

export function useHikerTracking(): HikerState[] {
  const [states, setStates] = useState<HikerState[]>(initStates);
  const elapsedRef = useRef(0);
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tick = () => {
      elapsedRef.current += TICK_MS;
      const elapsed = elapsedRef.current;

      // Reset simulation cycle
      if (elapsed > MAX_DURATION_MS + HOLD_MS) {
        elapsedRef.current = 0;
        firedRef.current = new Set();
        setStates(initStates());
        return;
      }

      setStates(prev => {
        let changed = false;
        const next = prev.map(hs => {
          const unfired = hs.hiker.events.filter(ev => {
            const key = `${hs.hiker.id}-${ev.sensorId}`;
            return !firedRef.current.has(key) && elapsed >= ev.offsetMs;
          });
          if (unfired.length === 0) return hs;

          changed = true;
          const newSensorStates = [...hs.sensorStates];
          const newLogEntries = [...hs.logEntries];
          let deviated = hs.deviated;
          let lastKnownLat = hs.lastKnownLat;
          let lastKnownLon = hs.lastKnownLon;

          unfired.forEach(ev => {
            firedRef.current.add(`${hs.hiker.id}-${ev.sensorId}`);
            const sIdx = newSensorStates.findIndex(ss => ss.sensor.id === ev.sensorId);
            if (sIdx < 0) return;

            const timeStr = formatTime(elapsed);
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
            if (ev.status === 'missed') {
              deviated = true;
            }
            if (ev.status === 'detected') {
              lastKnownLat = newSensorStates[sIdx].sensor.lat;
              lastKnownLon = newSensorStates[sIdx].sensor.lon;
            }
          });

          return { ...hs, sensorStates: newSensorStates, logEntries: newLogEntries, deviated, lastKnownLat, lastKnownLon };
        });

        return changed ? next : prev;
      });
    };

    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return states;
}
