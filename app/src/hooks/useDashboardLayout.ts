'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'trail_dashboard_layout_v3';

export interface DashboardLayout {
  leftTab: 'fleet' | 'sensors' | 'weather';
  rightTab: 'active' | 'ai';
}

const DEFAULT_LAYOUT: DashboardLayout = {
  leftTab: 'fleet',
  rightTab: 'active',
};

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DashboardLayout>;
        setLayout(prev => ({
          leftTab: parsed.leftTab ?? prev.leftTab,
          rightTab: parsed.rightTab ?? prev.rightTab,
        }));
      }
    } catch {
      // silently use defaults
    }
    setHydrated(true);
  }, []);

  function save(next: DashboardLayout) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable
    }
    setLayout(next);
  }

  function setLeftTab(tab: DashboardLayout['leftTab']) {
    save({ ...layout, leftTab: tab });
  }

  function setRightTab(tab: DashboardLayout['rightTab']) {
    save({ ...layout, rightTab: tab });
  }

  return { layout, hydrated, setLeftTab, setRightTab };
}
