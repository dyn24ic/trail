export default function FeaturesSection() {
  return (
    <section className="section-features" id="features">
      <div className="section-header">
        <span className="section-tag">System Capabilities</span>
        <span className="section-rule"></span>
      </div>
      <div className="features-grid">
        <div className="feat-card">
          <span className="feat-num">01</span>
          <div className="feat-icon">◉</div>
          <div className="feat-title">Sensor Network</div>
          <p className="feat-desc">Low-cost motion and audio sensors deployed at AI-identified high-risk points. Emergency call boxes at trailheads and major junctions provide one-touch alert triggering.</p>
          <div className="feat-metric">$80<small>per sensor node</small></div>
        </div>
        <div className="feat-card">
          <span className="feat-num">02</span>
          <div className="feat-icon">⬡</div>
          <div className="feat-title">Drone Response</div>
          <p className="feat-desc">Thermal and visual imaging drones deployed within minutes to AI-predicted search zones. GPS beacon dropped and live video streamed on victim detection for ground teams.</p>
          <div className="feat-metric">3 zones<small>searched simultaneously</small></div>
        </div>
        <div className="feat-card">
          <span className="feat-num">03</span>
          <div className="feat-icon">△</div>
          <div className="feat-title">AI Prediction</div>
          <p className="feat-desc">Predictive models fuse historical incidents, terrain topology, weather, and time-of-day data to rank the top 3 most probable search zones before a drone lifts off.</p>
          <div className="feat-metric">94%<small>zone prediction accuracy</small></div>
        </div>
        <div className="feat-card">
          <span className="feat-num">04</span>
          <div className="feat-icon">✦</div>
          <div className="feat-title">Route Optimization</div>
          <p className="feat-desc">Fastest and safest responder routes computed in real-time, accounting for elevation change, trail conditions, weather, and injury severity. Turn-by-turn on mobile.</p>
          <div className="feat-metric">Real-time<small>responder guidance</small></div>
        </div>
        <div className="feat-card">
          <span className="feat-num">05</span>
          <div className="feat-icon">◈</div>
          <div className="feat-title">Injury Triage</div>
          <p className="feat-desc">Automated severity scoring from drone imagery. Motion, posture, thermal signature, and audio analysis classify injury severity before ground teams arrive — optimizing resource deployment.</p>
          <div className="feat-metric">Auto<small>severity classification</small></div>
        </div>
        <div className="feat-card">
          <span className="feat-num">06</span>
          <div className="feat-icon">◎</div>
          <div className="feat-title">Trail Intelligence</div>
          <p className="feat-desc">Every incident feeds the learning system. Trail difficulty ratings, personal risk scores, sensor placement, and predictive warnings all improve automatically over time.</p>
          <div className="feat-metric">∞<small>continuous learning</small></div>
        </div>
      </div>
    </section>
  );
}
