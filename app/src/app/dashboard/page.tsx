'use client';

import { useState } from 'react';
import TopBar from '@/components/dashboard/TopBar';
import LeftPanel from '@/components/dashboard/LeftPanel';
import RightPanel from '@/components/dashboard/RightPanel';
import TabBar from '@/components/dashboard/TabBar';
import BottomBar from '@/components/dashboard/BottomBar';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { useTabs } from '@/hooks/useTabs';

export default function DashboardPage() {
  const { layout, hydrated, setLeftTab, setRightTab } = useDashboardLayout();
  const tabs = useTabs();
  const [mapCoords, setMapCoords] = useState<{ lat: number; lon: number } | null>(null);

  if (!hydrated) return null;

  return (
    <div className="dashboard-body">
      <TopBar />
      <LeftPanel leftTab={layout.leftTab} setLeftTab={setLeftTab} />
      <TabBar tabs={tabs} onMapMove={(lat, lon) => setMapCoords({ lat, lon })} />
      <RightPanel rightTab={layout.rightTab} setRightTab={setRightTab} openTab={tabs.openTab} />
      <BottomBar mapCoords={mapCoords} />
    </div>
  );
}
