'use client';

import TopBar from '@/components/dashboard/TopBar';
import LeftPanel from '@/components/dashboard/LeftPanel';
import MapContainer from '@/components/dashboard/MapContainer';
import RightPanel from '@/components/dashboard/RightPanel';
import BottomBar from '@/components/dashboard/BottomBar';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';

export default function DashboardPage() {
  const { layout, hydrated, togglePanel } = useDashboardLayout();

  if (!hydrated) return null;

  return (
    <div className="dashboard-body">
      <TopBar />
      <div className="main-area">
        <MapContainer leftOpen={layout.leftOpen} rightOpen={layout.rightOpen} />
        {!layout.leftOpen  && <div className="panel-tab panel-tab--left"  onClick={() => togglePanel('left')}>FLEET</div>}
        {!layout.rightOpen && <div className="panel-tab panel-tab--right" onClick={() => togglePanel('right')}>OPS</div>}
        <LeftPanel  open={layout.leftOpen}  onTogglePanel={() => togglePanel('left')} />
        <RightPanel open={layout.rightOpen} onTogglePanel={() => togglePanel('right')} />
      </div>
      <BottomBar />
    </div>
  );
}
