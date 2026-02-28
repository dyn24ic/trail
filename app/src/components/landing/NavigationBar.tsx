"use client";

import Link from "next/link";

export default function NavigationBar() {
  return (
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
  );
}
