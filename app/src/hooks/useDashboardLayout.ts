'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'trail_dashboard_layout_v2';

export interface DashboardLayout {
  leftOpen: boolean;
  rightOpen: boolean;
}

const DEFAULT_LAYOUT: DashboardLayout = {
  leftOpen: true,
  rightOpen: true,
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
          leftOpen: parsed.leftOpen ?? prev.leftOpen,
          rightOpen: parsed.rightOpen ?? prev.rightOpen,
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

  function togglePanel(side: 'left' | 'right') {
    save({
      ...layout,
      leftOpen: side === 'left' ? !layout.leftOpen : layout.leftOpen,
      rightOpen: side === 'right' ? !layout.rightOpen : layout.rightOpen,
    });
  }

  return { layout, hydrated, togglePanel };
}
