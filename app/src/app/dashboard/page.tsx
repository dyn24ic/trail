'use client';

import { useState } from 'react';
import TopBar from '@/components/dashboard/TopBar';
import LeftPanel from '@/components/dashboard/LeftPanel';
import RightPanel from '@/components/dashboard/RightPanel';
import TabBar from '@/components/dashboard/TabBar';
import BottomBar from '@/components/dashboard/BottomBar';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { useTabs } from '@/hooks/useTabs';
import { useHikerTracking } from '@/hooks/useHikerTracking';
import type { DeviantHiker } from '@/hooks/useHikerTracking';

export default function DashboardPage() {
  const { layout, hydrated, setLeftTab, setRightTab } = useDashboardLayout();
  const tabs = useTabs();
  const [mapCoords, setMapCoords] = useState<{ lat: number; lon: number } | null>(null);
  const hikerStates = useHikerTracking();

  const deviantHikers: DeviantHiker[] = hikerStates
    .filter(s => s.deviated && s.lastKnownLat != null && s.lastKnownLon != null)
    .map(s => ({
      id: s.hiker.id,
      name: s.hiker.name,
      mac: s.hiker.mac,
      trail: s.hiker.trail,
      lat: s.lastKnownLat!,
      lon: s.lastKnownLon!,
      logEntries: s.logEntries,
    }));

  if (!hydrated) return null;

  return (
    <div className="dashboard-body">
      <TopBar />
      <LeftPanel leftTab={layout.leftTab} setLeftTab={setLeftTab} />
      <TabBar tabs={tabs} onMapMove={(lat, lon) => setMapCoords({ lat, lon })} deviantHikers={deviantHikers} />
      <RightPanel rightTab={layout.rightTab} setRightTab={setRightTab} openTab={tabs.openTab} hikerStates={hikerStates} />
      <BottomBar mapCoords={mapCoords} />
    </div>
  );
}
