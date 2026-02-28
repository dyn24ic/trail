"use client";

import Link from "next/link";

export default function HeroSection() {
  return (
    <div className="hero">
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

      {/* Stats on the right */}
      <div className="hero-stats">
        <div className="stat">
          <span className="stat-num">5-15</span>
          <span className="stat-lbl">min response time</span>
        </div>
        <div className="stat">
          <span className="stat-num">94%</span>
          <span className="stat-lbl">zone prediction accuracy</span>
        </div>
        <div className="stat">
          <span className="stat-num">-85%</span>
          <span className="stat-lbl">search cost</span>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="scroll-hint">
        <div className="mouse">
          <div className="wheel"></div>
        </div>
      </div>
    </div>
  );
}
