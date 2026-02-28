"use client";

import { useEffect } from "react";
import Link from "next/link";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnimFn = (...args: any[]) => any;

export default function HeroOverlay() {
  useEffect(() => {
    let animate: AnimFn, stagger: AnimFn, inView: AnimFn;

    import("framer-motion/dom").then((m) => {
      animate = m.animate;
      stagger = m.stagger;
      inView = m.inView;

      const q = (sel: string) => Array.from(document.querySelectorAll(sel));

      animate(
        q(".landing-nav"),
        { opacity: [0, 1] },
        { duration: 1, delay: 0.3, easing: "ease-out" },
      );
      animate(
        q(".hero-eyebrow"),
        { opacity: [0, 1], x: [-8, 0] },
        { duration: 0.7, delay: 0.6, easing: "ease-out" },
      );
      animate(
        q(".hero-title"),
        { opacity: [0, 1], y: [24, 0] },
        { duration: 1.0, delay: 1.0, easing: [0.16, 1, 0.3, 1] },
      );
      animate(
        q(".hero-sub"),
        { opacity: [0, 1], y: [16, 0] },
        { duration: 0.8, delay: 1.45, easing: "ease-out" },
      );
      animate(
        q(".hero-actions"),
        { opacity: [0, 1], y: [10, 0] },
        { duration: 0.7, delay: 1.8, easing: "ease-out" },
      );
      animate(
        q(".stat"),
        { opacity: [0, 1], x: [20, 0] },
        {
          duration: 0.6,
          delay: stagger(0.2, { start: 1.6 }),
          easing: "ease-out",
        },
      );
      animate(
        q(".scroll-hint"),
        { opacity: [0, 1] },
        { duration: 0.8, delay: 2.8 },
      );

      inView(
        ".section-header",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.6, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".feat-card",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [32, 0] },
            { duration: 0.65, easing: [0.22, 1, 0.36, 1] },
          );
        },
        { margin: "-60px" },
      );

      inView(
        ".stages-title",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.7, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".stage-item",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], x: [-20, 0] },
            { duration: 0.55, easing: "ease-out" },
          );
        },
        { margin: "-60px" },
      );

      inView(
        ".cta-headline",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.8, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".cta-btn",
        ({ target }: { target: Element }) => {
          animate(target, { opacity: [0, 1] }, { duration: 0.6, delay: 0.2 });
        },
        { margin: "-60px" },
      );
    });
  }, []);

  return (
    <>
      {/* Nav */}
      <nav className="landing-nav">
        <div className="logo">
          tr<span className="ai-letters">AI</span>l
        </div>
        <div className="nav-right">
          <a href="#features" className="nav-link">
            System
          </a>
          <Link href="/dashboard" className="nav-link cta">
            Operator Dashboard →
          </Link>
        </div>
      </nav>

      {/* Hero */}
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
          deployment, and optimized responder routing for wilderness
          environments.
        </p>
        <div className="hero-actions">
          <Link href="/dashboard" className="btn-primary">
            Launch Dashboard
          </Link>
          <a href="#features" className="btn-ghost">
            System Capabilities <span className="arr">→</span>
          </a>
        </div>
      </div>

      {/* Right stats */}
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
    </>
  );
}
