'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export default function TopBar() {
  const clockRef = useRef<HTMLDivElement>(null);

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

  return (
    <header className="topbar">
      <div className="tb-logo">tr<span className="ai">AI</span>l</div>
      <div className="tb-location">Trail: <strong>Yosemite National Park</strong> · Half Dome Corridor</div>
      <div className="tb-status">
        <span className="status-dot"></span>
        <span>System Active</span>
      </div>
      <div className="tb-spacer" />
      <div className="tb-alerts">
        <div className="alert-chip critical">
          <span className="status-dot alert"></span>
          1 Critical
        </div>
        <div className="alert-chip warning">
          <span className="status-dot warn"></span>
          2 Warnings
        </div>
        <div className="alert-chip">12 Sensors OK</div>
      </div>
      <div className="tb-time" ref={clockRef}>14:38:22</div>
      <Link href="/" className="tb-nav-link">← Landing</Link>
    </header>
  );
}
