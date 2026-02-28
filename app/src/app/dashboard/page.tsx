import TopBar from '@/components/dashboard/TopBar';
import LeftPanel from '@/components/dashboard/LeftPanel';
import MapContainer from '@/components/dashboard/MapContainer';
import RightPanel from '@/components/dashboard/RightPanel';
import BottomBar from '@/components/dashboard/BottomBar';

export const metadata = {
  title: 'trAIl · Operator Dashboard — Yosemite NP',
};

export default function DashboardPage() {
  return (
    <div className="dashboard-body">
      <TopBar />
      <div className="main-area">
        <LeftPanel />
        <MapContainer />
        <RightPanel />
      </div>
      <BottomBar />
    </div>
  );
}
