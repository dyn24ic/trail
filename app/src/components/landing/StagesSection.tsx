export default function StagesSection() {
  return (
    <section className="section-stages">
      <h2 className="stages-title">Three stages from <span>hotspot to resolution.</span></h2>
      <div className="stages-list">
        <div className="stage-item">
          <span className="stage-num">01</span>
          <div className="stage-body">
            <div className="stage-name">Mapping &amp; Sensor Placement</div>
            <p className="stage-desc">Drone survey of trail network. AI risk scoring of hotspots by terrain, history, remoteness, and weather exposure. Sensor and call box deployment at optimal positions.</p>
          </div>
        </div>
        <div className="stage-item">
          <span className="stage-num">02</span>
          <div className="stage-body">
            <div className="stage-name">Detection &amp; Drone Response</div>
            <p className="stage-desc">Triggered by sensor anomaly, call box, overdue tracker, or 911 input. AI predicts zones, drones launch within 90 seconds, thermal imaging and triage underway.</p>
          </div>
        </div>
        <div className="stage-item">
          <span className="stage-num">02b</span>
          <div className="stage-body">
            <div className="stage-name">Responder Route Optimization</div>
            <p className="stage-desc">Ground and helicopter teams receive optimized route with victim location, ETA estimate, hazard flags, and real-time turn-by-turn via mobile app.</p>
          </div>
        </div>
        <div className="stage-item">
          <span className="stage-num">03</span>
          <div className="stage-body">
            <div className="stage-name">Post-Incident &amp; Trail Learning</div>
            <p className="stage-desc">Automated incident report with root cause analysis. AI generates recommendations: new signage, sensor repositioning, route changes. System retrains on each event.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
