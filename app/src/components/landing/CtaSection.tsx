import Link from 'next/link';

export default function CtaSection() {
  return (
    <>
      <section className="section-cta">
        <h2 className="cta-headline">Ready to protect<br /><span>every trail.</span></h2>
        <Link href="/dashboard" className="cta-btn">Launch Operator Dashboard</Link>
      </section>
      <footer>
        <div className="footer-logo">tr<span>AI</span>l &nbsp;·&nbsp; Trail Guardian</div>
        <div className="footer-note">AI-Powered Search &amp; Rescue · Yosemite Pilot Program</div>
      </footer>
    </>
  );
}
