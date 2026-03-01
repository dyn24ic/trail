"use client";

import Link from "next/link";

export default function HeroSection() {
  return (
    <div className="hero">
      <div className="hero-grid">
        <div className="hero-left">
          <div className="hero-eyebrow">
            <span className="eyebrow-line"></span>
            Trail Guardian &nbsp;·&nbsp; Advanced SAR Systems
          </div>
          <h1 className="hero-title">
            Autonomous
            <br />
            Search &amp; Rescue
            <br />
            <span className="accent">Intelligence.</span>
          </h1>
          <p className="hero-sub">
            Reduce response times by 80% with AI-driven detection, thermal drone
            deployment, and optimized responder routing for wilderness environments.
          </p>
          <div className="hero-actions">
            <Link href="/dashboard" className="btn-primary">
              Launch Dashboard
            </Link>
            <a href="#features" className="btn-ghost">
              System Capabilities <span className="arr">→</span>
            </a>
          </div>
          <div className="hero-coord">
            37°44′59″N · 119°35′37″W · Yosemite NP
          </div>
        </div>

        <div className="hero-right">
          <div className="stat metric-panel">
            <span className="metric-value">5–15</span>
            <span className="metric-label">min response time</span>
            <span className="metric-sub">vs 30–90 min traditional SAR</span>
          </div>
          <div className="stat metric-panel metric-panel--green">
            <span className="metric-value">94%</span>
            <span className="metric-label">zone prediction accuracy</span>
            <span className="metric-sub">XGBoost AI · terrain + weather features</span>
          </div>
          <div className="stat metric-panel metric-panel--blue">
            <span className="metric-value">$2k</span>
            <span className="metric-label">per 20 km trail setup</span>
            <span className="metric-sub">~$1k annual operating cost</span>
          </div>
          <div className="hero-status-row">
            <span className="live-pip"></span>
            System Active · Yosemite Pilot Program
          </div>
        </div>
      </div>

      <div className="scroll-hint">
        <div className="mouse">
          <div className="wheel"></div>
        </div>
      </div>
    </div>
  );
}
