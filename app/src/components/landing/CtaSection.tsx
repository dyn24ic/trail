import Link from "next/link";

export default function CtaSection() {
  return (
    <>
      <section className="section-cta">
        <div className="cta-panel">
          <div className="cta-panel-header">
            <span className="cta-status-dot" />
            <span>Operator Access · Secure Channel</span>
            <span className="cta-panel-tag">v2.1-pilot</span>
          </div>
          <h2 className="cta-headline">
            Ready to protect
            <br />
            <span>every trail.</span>
          </h2>
          <p className="cta-sub">
            Join search &amp; rescue teams across the Sierra Nevada using
            AI-powered triage and autonomous drone response.
          </p>
          <Link href="/dashboard" className="cta-btn">
            Launch Operator Dashboard →
          </Link>
          <div className="cta-coords">
            37°44′N · 119°35′W · Yosemite Pilot Program
          </div>
        </div>
      </section>
      <footer>
        <div className="footer-logo">
          tr<span>AI</span>l &nbsp;·&nbsp; Trail Guardian
        </div>
        <div className="footer-note">
          AI-Powered Search &amp; Rescue · Yosemite Pilot Program
        </div>
      </footer>
    </>
  );
}
