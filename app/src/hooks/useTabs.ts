'use client';

import { useReducer, useCallback } from 'react';

export interface Tab {
  id: string;
  title: string;
  type: 'map' | 'incident' | 'analytics';
  closeable: boolean;
  data?: { incidentId?: string };
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
}

type TabsAction =
  | { type: 'OPEN_TAB'; tab: Tab }
  | { type: 'CLOSE_TAB'; id: string }
  | { type: 'SET_ACTIVE'; id: string };

const DEFAULT_STATE: TabsState = {
  tabs: [{ id: 'map', title: '⬡ Map', type: 'map', closeable: false }],
  activeTabId: 'map',
};

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'OPEN_TAB': {
      const exists = state.tabs.find(t => t.id === action.tab.id);
      if (exists) return { ...state, activeTabId: action.tab.id };
      return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.id };
    }
    case 'CLOSE_TAB': {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex(t => t.id === action.id);
      const next = state.tabs.filter(t => t.id !== action.id);
      const nextActive =
        state.activeTabId === action.id
          ? (next[Math.max(0, idx - 1)] ?? next[0]).id
          : state.activeTabId;
      return { tabs: next, activeTabId: nextActive };
    }
    case 'SET_ACTIVE':
      return { ...state, activeTabId: action.id };
    default:
      return state;
  }
}

export function useTabs() {
  const [state, dispatch] = useReducer(tabsReducer, DEFAULT_STATE);

  const openTab = useCallback((tab: Tab) => {
    dispatch({ type: 'OPEN_TAB', tab });
  }, []);

  const closeTab = useCallback((id: string) => {
    dispatch({ type: 'CLOSE_TAB', id });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE', id });
  }, []);

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    openTab,
    closeTab,
    setActiveTab,
  };
}
