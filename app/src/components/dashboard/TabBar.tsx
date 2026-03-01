'use client';

import dynamic from 'next/dynamic';
import type { Tab } from '@/hooks/useTabs';
import type { DeviantHiker } from '@/hooks/useHikerTracking';
import IncidentDetailView from './views/IncidentDetailView';
import AnalyticsView from './views/AnalyticsView';

const MapContainer = dynamic(() => import('./MapContainer'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100%', background: '#040B0B' }} />,
});

interface TabBarProps {
  tabs: { tabs: Tab[]; activeTabId: string; openTab: (t: Tab) => void; closeTab: (id: string) => void; setActiveTab: (id: string) => void };
  onMapMove?: (lat: number, lon: number) => void;
  deviantHikers?: DeviantHiker[];
}

export default function TabBar({ tabs: tabState, onMapMove, deviantHikers = [] }: TabBarProps) {
  const { tabs, activeTabId, closeTab, setActiveTab } = tabState;

  return (
    <div className="center-column">
      {/* Tab strip */}
      <div className="center-tab-strip">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`center-tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="center-tab-title">{tab.title}</span>
            {tab.closeable && (
              <button
                className="center-tab-close"
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Tab content area */}
      <div className="center-content">
        {/* Map is always mounted, hidden when not active */}
        <div style={{ display: activeTabId === 'map' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
          <MapContainer onMapMove={onMapMove} deviantHikers={deviantHikers} />
        </div>

        {/* Other tabs rendered only when active */}
        {tabs.filter(t => t.type === 'incident').map(tab => (
          <div
            key={tab.id}
            style={{ display: tab.id === activeTabId ? 'flex' : 'none', position: 'absolute', inset: 0, flexDirection: 'column', overflowY: 'auto' }}
          >
            <IncidentDetailView incidentId={tab.data?.incidentId ?? null} />
          </div>
        ))}

        {tabs.filter(t => t.type === 'analytics').map(tab => (
          <div
            key={tab.id}
            style={{ display: tab.id === activeTabId ? 'flex' : 'none', position: 'absolute', inset: 0, flexDirection: 'column', overflowY: 'auto' }}
          >
            <AnalyticsView />
          </div>
        ))}
      </div>
    </div>
  );
}
