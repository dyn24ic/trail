export default function StagesSection() {
  const stages = [
    {
      num: "01",
      color: "amber",
      name: "Mapping & Sensor Placement",
      desc: "Continuous drone surveys map the trail network in high resolution. Our AI risk model scores hotspots based on historical incidents, terrain difficulty, and weather exposure to optimize sensor deployment.",
      tags: ["Drone Survey", "Grid Analysis"],
    },
    {
      num: "02",
      color: "green",
      name: "Detection & Drone Response",
      desc: "Triggered by sensor anomalies or distress signals. AI instantly predicts likely zones while autonomous drones launch within 90 seconds, equipped with thermal and visual imaging for rapid victim location.",
      tags: ["Thermal Vision", "AI Prediction"],
    },
    {
      num: "02b",
      color: "blue",
      name: "Responder Route Optimization",
      desc: "Teams receive dynamic, AI-calculated routes accounting for victim location, ETA, hazards, and injury severity — delivered via real-time mobile guidance with turn-by-turn directions.",
      tags: ["Pathfinding", "Live Coord"],
    },
    {
      num: "03",
      color: "yellow",
      name: "Post-Incident Learning",
      desc: "Automated reports with root cause analysis and environmental context. The system retrains itself continuously, suggesting new signage placements, sensor optimizations, and trail difficulty re-ratings.",
      tags: ["Auto-Report", "Loop Learning"],
    },
  ];

  return (
    <section className="section-stages" id="stages">
      <div className="stages-header">
        <span className="section-tag">Mission Timeline</span>
        <h2 className="stages-title">
          From Hotspot <span>to Resolution</span>
        </h2>
      </div>

      <div className="stages-rail">
        {stages.map((s) => (
          <div
            key={s.num}
            className={`stage-item sr-item sr-item--${s.color}`}
          >
            <div className="sr-num">{s.num}</div>
            <div className="sr-divider" />
            <div className="sr-body">
              <h3 className="sr-name">{s.name}</h3>
              <p className="sr-desc">{s.desc}</p>
            </div>
            <div className="sr-tags">
              {s.tags.map((t) => (
                <span key={t} className={`sr-badge sr-badge--${s.color}`}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
