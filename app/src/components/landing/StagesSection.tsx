import { ReactNode } from "react";

export default function StagesSection() {
  return (
    <section className="w-full relative px-6 py-32 overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1px] h-full bg-gradient-to-b from-transparent via-white/10 to-transparent" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-32 stages-title">
          <span className="inline-block px-3 py-1 mb-4 text-[#FF8C42] border border-[#FF8C42]/30 bg-[#FF8C42]/5 rounded text-xs font-mono uppercase tracking-widest">
            Mission Timeline
          </span>
          <h2 className="text-4xl md:text-5xl font-bold font-exo2 leading-tight">
            From Hotspot <span className="text-white/40 mx-2">to</span>{" "}
            <span className="text-white">Resolution</span>
          </h2>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-0">
          {/* Stage 01 - Mapping (Left) */}
          <div className="stage-item relative md:pr-16 md:text-right md:mb-32">
            <div className="md:absolute top-8 -right-[65px] w-4 h-4 bg-[#FF8C42] rounded-full shadow-[0_0_15px_rgba(255,140,66,0.8)] z-20 hidden md:block border-4 border-[#030A10]" />
            <div className="p-8 bg-[#080F18]/80 backdrop-blur-md border border-white/5 rounded-none border-l-2 border-l-[#FF8C42] hover:border-white/20 transition-all group">
              <div className="text-[#FF8C42] font-mono text-xl font-bold mb-2 opacity-80 group-hover:opacity-100 transition-opacity">
                01
              </div>
              <h3 className="text-2xl font-bold font-exo2 mb-4 text-white group-hover:text-[#FF8C42] transition-colors">
                Mapping & Sensor Placement
              </h3>
              <p className="text-gray-400 font-barlow leading-relaxed mb-6">
                Continuous drone surveys map the trail network in high
                resolution. Our AI risk model scores hotspots based on
                incidents, terrain, and weather to optimize sensor deployment.
              </p>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Badge color="amber">Drone Survey</Badge>
                <Badge color="amber">Grid Analysis</Badge>
              </div>
            </div>
          </div>
          {/* Empty Space for Grid alignment */}
          <div className="hidden md:block md:mb-32" />

          {/* Stage 02 - Detection (Right) */}
          <div className="hidden md:block md:mb-32" />
          <div className="stage-item relative md:pl-16 md:mb-32">
            <div className="md:absolute top-8 -left-[65px] w-4 h-4 bg-[#22FF88] rounded-full shadow-[0_0_15px_rgba(34,255,136,0.8)] z-20 hidden md:block border-4 border-[#030A10]" />
            <div className="p-8 bg-[#080F18]/80 backdrop-blur-md border border-white/5 rounded-none border-r-2 border-r-[#22FF88] hover:border-white/20 transition-all group text-left">
              <div className="text-[#22FF88] font-mono text-xl font-bold mb-2 opacity-80 group-hover:opacity-100 transition-opacity">
                02
              </div>
              <h3 className="text-2xl font-bold font-exo2 mb-4 text-white group-hover:text-[#22FF88] transition-colors">
                Detection & Drone Response
              </h3>
              <p className="text-gray-400 font-barlow leading-relaxed mb-6">
                Triggered by sensor anomalies or signals. AI instantly predicts
                zones while autonomous drones launch within 90 seconds, equipped
                with thermal imaging for rapid location.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge color="green">Thermal Vision</Badge>
                <Badge color="green">AI Prediction</Badge>
              </div>
            </div>
          </div>

          {/* Stage 02b - Route Optimization (Left) */}
          <div className="stage-item relative md:pr-16 md:text-right md:mb-32">
            <div className="md:absolute top-8 -right-[65px] w-4 h-4 bg-[#4A90D9] rounded-full shadow-[0_0_15px_rgba(74,144,217,0.8)] z-20 hidden md:block border-4 border-[#030A10]" />
            <div className="p-8 bg-[#080F18]/80 backdrop-blur-md border border-white/5 rounded-none border-l-2 border-l-[#4A90D9] hover:border-white/20 transition-all group">
              <div className="text-[#4A90D9] font-mono text-xl font-bold mb-2 opacity-80 group-hover:opacity-100 transition-opacity">
                02b
              </div>
              <h3 className="text-2xl font-bold font-exo2 mb-4 text-white group-hover:text-[#4A90D9] transition-colors">
                Responder Route Opt.
              </h3>
              <p className="text-gray-400 font-barlow leading-relaxed mb-6">
                Teams receive dynamic, AI-calculated routes accounting for
                victim location, ETA, and hazards—delivered via real-time mobile
                guidance.
              </p>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Badge color="blue">Pathfinding</Badge>
                <Badge color="blue">Live Coord</Badge>
              </div>
            </div>
          </div>
          <div className="hidden md:block md:mb-32" />

          {/* Stage 03 - Post-Incident (Right) */}
          <div className="hidden md:block" />
          <div className="stage-item relative md:pl-16">
            <div className="md:absolute top-8 -left-[65px] w-4 h-4 bg-[#FFD84A] rounded-full shadow-[0_0_15px_rgba(255,216,74,0.8)] z-20 hidden md:block border-4 border-[#030A10]" />
            <div className="p-8 bg-[#080F18]/80 backdrop-blur-md border border-white/5 rounded-none border-r-2 border-r-[#FFD84A] hover:border-white/20 transition-all group text-left">
              <div className="text-[#FFD84A] font-mono text-xl font-bold mb-2 opacity-80 group-hover:opacity-100 transition-opacity">
                03
              </div>
              <h3 className="text-2xl font-bold font-exo2 mb-4 text-white group-hover:text-[#FFD84A] transition-colors">
                Post-Incident Learning
              </h3>
              <p className="text-gray-400 font-barlow leading-relaxed mb-6">
                Automated reports with root cause analysis. The system retrains
                itself, suggesting new signage or sensor optimizations to
                prevent future accidents.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge color="yellow">Auto-Report</Badge>
                <Badge color="yellow">Loop Learning</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Badge({
  children,
  color,
}: {
  children: ReactNode;
  color: "amber" | "green" | "blue" | "yellow";
}) {
  const styles = {
    amber: "text-[#FF8C42] bg-[#FF8C42]/10 border-[#FF8C42]/20",
    green: "text-[#22FF88] bg-[#22FF88]/10 border-[#22FF88]/20",
    blue: "text-[#4A90D9] bg-[#4A90D9]/10 border-[#4A90D9]/20",
    yellow: "text-[#FFD84A] bg-[#FFD84A]/10 border-[#FFD84A]/20",
  };

  return (
    <span
      className={`px-3 py-1 border text-[10px] font-mono uppercase tracking-wider rounded-sm ${styles[color]}`}
    >
      {children}
    </span>
  );
}
