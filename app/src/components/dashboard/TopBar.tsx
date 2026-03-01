"use client";

import { useEffect, useRef } from "react";
import { useIncidents } from "@/lib/incidents/useIncidents";

export default function TopBar() {
  const clockRef = useRef<HTMLDivElement>(null);
  const { incidents } = useIncidents();

  useEffect(() => {
    function update() {
      if (clockRef.current) {
        clockRef.current.textContent = new Date().toTimeString().slice(0, 8);
      }
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const openIncidents = incidents.filter((i) => i.status !== "Closed");
  const hasAlerts = openIncidents.length > 0;

  return (
    <header className={`topbar${hasAlerts ? " topbar--alerts" : ""}`}>
      <div className="tb-logo">
        <span className="tb-lower">tr</span>
        <span className="ai">AI</span>
        <span className="tb-lower">l</span>
      </div>
      <div className="tb-vsep" />
      <div className="tb-location">
        <strong>Yosemite National Park</strong>
      </div>

      <div className="tb-spacer" />

      <div className="tb-pills">
        <div className="tb-pill">
          <span className="tb-pill-icon">⬡</span>
          <span className="tb-pill-count">0</span>
          <span className="tb-pill-label">Drones</span>
        </div>
        <div className="tb-pill">
          <span className="tb-pill-icon">◉</span>
          <span className="tb-pill-count">0</span>
          <span className="tb-pill-label">Sensors</span>
        </div>
        <div className={`tb-pill${hasAlerts ? " tb-pill--alert" : ""}`}>
          <span className="tb-pill-icon">⚠</span>
          <span className="tb-pill-count">{openIncidents.length}</span>
          <span className="tb-pill-label">Incidents</span>
        </div>
      </div>

      <div className="tb-vsep" />

      <div className="tb-status">
        <span className={`status-dot${hasAlerts ? " alert" : ""}`} />
        <span className="tb-status-text">{hasAlerts ? "ALERT" : "ACTIVE"}</span>
      </div>

      <div className="tb-time" ref={clockRef}>
        00:00:00
      </div>
    </header>
  );
}
