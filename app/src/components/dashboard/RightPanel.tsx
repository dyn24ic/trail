export default function RightPanel() {
  return (
    <div className="panel">
      {/* Active Incidents */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Active Incidents</span>
          <span className="panel-badge">3 Open</span>
        </div>

        <div className="incident-card priority-critical">
          <div className="incident-header">
            <span className="incident-id">INC-2024-0847</span>
            <span className="incident-time">14:12 · 26 min ago</span>
          </div>
          <div className="incident-type critical">⚠ Hiker Down · Unresponsive</div>
          <div className="incident-meta">
            <strong>Location:</strong> Half Dome Cable Route, ~2,600m<br />
            <strong>Trigger:</strong> Sensor S-07 motion anomaly + Audio<br />
            <strong>Drone:</strong> Alpha-01 on-scene · thermal contact<br />
            <strong>Triage:</strong> Possible lower limb injury · conscious
          </div>
          <div className="incident-footer">
            <span className="incident-zone">Zone A-2 · 94% Confidence</span>
            <button className="incident-action action-red">Dispatch Team</button>
          </div>
        </div>

        <div className="incident-card priority-warning">
          <div className="incident-header">
            <span className="incident-id">INC-2024-0846</span>
            <span className="incident-time">13:55 · 43 min ago</span>
          </div>
          <div className="incident-type warning">⚡ Overdue Hiker</div>
          <div className="incident-meta">
            <strong>Party:</strong> Solo hiker, check-in overdue 40 min<br />
            <strong>Last GPS:</strong> Nevada Falls approach<br />
            <strong>Drone:</strong> Gamma-03 patrol extending<br />
            <strong>Status:</strong> Attempting audio contact
          </div>
          <div className="incident-footer">
            <span className="incident-zone">Zone B-1 · 71% Confidence</span>
            <button className="incident-action action-amber">Expand Search</button>
          </div>
        </div>

        <div className="incident-card priority-info">
          <div className="incident-header">
            <span className="incident-id">INC-2024-0845</span>
            <span className="incident-time">13:20 · 78 min ago</span>
          </div>
          <div className="incident-type" style={{ color: 'var(--db-blue)' }}>◈ Call Box Activation</div>
          <div className="incident-meta">
            <strong>Location:</strong> CB-03 · Half Dome Base<br />
            <strong>Type:</strong> Non-emergency assist requested<br />
            <strong>Status:</strong> Ranger en route · ETA 12 min<br />
            <strong>Notes:</strong> Hiker equipment issue
          </div>
          <div className="incident-footer">
            <span className="incident-zone">Confirmed · Low Priority</span>
            <button className="incident-action action-green">Mark Resolved</button>
          </div>
        </div>
      </div>

      {/* AI Search Zone Predictions */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">AI Predicted Zones · INC-0847</span>
        </div>
        <div className="zone-card">
          <div className="zone-rank r1">1</div>
          <div className="zone-body">
            <div className="zone-name">Half Dome Cable Route · Upper</div>
            <div className="zone-prob">
              <div className="zone-bar"><div className="zone-fill" style={{ width: '94%', background: 'var(--db-red)' }}></div></div>
              <span className="zone-pct" style={{ color: 'var(--db-red)' }}>94%</span>
            </div>
          </div>
        </div>
        <div className="zone-card">
          <div className="zone-rank r2">2</div>
          <div className="zone-body">
            <div className="zone-name">Sub Dome Trail · Exposed Ridge</div>
            <div className="zone-prob">
              <div className="zone-bar"><div className="zone-fill" style={{ width: '61%', background: 'var(--db-amber)' }}></div></div>
              <span className="zone-pct" style={{ color: 'var(--db-amber)' }}>61%</span>
            </div>
          </div>
        </div>
        <div className="zone-card">
          <div className="zone-rank r3">3</div>
          <div className="zone-body">
            <div className="zone-name">Little Yosemite Valley · North</div>
            <div className="zone-prob">
              <div className="zone-bar"><div className="zone-fill" style={{ width: '28%', background: 'var(--db-yellow)' }}></div></div>
              <span className="zone-pct" style={{ color: 'var(--db-yellow)' }}>28%</span>
            </div>
          </div>
        </div>
        <div className="risk-row">
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,59,59,0.6)' }}></span>Critical</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,140,66,0.6)' }}></span>High</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(255,216,74,0.6)' }}></span>Medium</div>
          <div className="risk-chip"><span className="risk-dot" style={{ background: 'rgba(0,255,136,0.4)' }}></span>Low</div>
        </div>
      </div>

      {/* Responder Routing */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Responder Routing · INC-0847</span>
        </div>
        <div className="responder-list">
          <div className="resp-item">
            <span className="resp-dot" style={{ background: 'var(--db-green)' }}></span>
            <span className="resp-name">SAR Team Alpha (4 members)</span>
            <span className="resp-loc">Half Dome TH</span>
            <span className="resp-eta">ETA 22m</span>
          </div>
          <div className="resp-item">
            <span className="resp-dot" style={{ background: 'var(--db-amber)' }}></span>
            <span className="resp-name">Ranger Unit 7</span>
            <span className="resp-loc">Valley Floor</span>
            <span className="resp-eta">ETA 38m</span>
          </div>
          <div className="resp-item">
            <span className="resp-dot" style={{ background: 'var(--db-blue)' }}></span>
            <span className="resp-name">Helicopter H-2 (standby)</span>
            <span className="resp-loc">Fresno Base</span>
            <span className="resp-eta">ETA 55m</span>
          </div>
        </div>
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--db-border2)' }}>
          <div className="w-label" style={{ marginBottom: '6px' }}>Route Hazards · Primary Route</div>
          <div style={{ fontSize: '0.62rem', lineHeight: 1.9, color: 'var(--db-muted)' }}>
            ⚠ Wet granite above 2800m · traction risk<br />
            ⚠ Wind gusts 40 km/h on exposed ridge<br />
            ✓ Cables route accessible · daylight adequate<br />
            ℹ Carry headlamps · sunset 18:12
          </div>
        </div>
      </div>

      {/* Trail Risk Summary */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Trail Risk Index</span>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              ['Half Dome Cables',   '8.4 / 10', 84, 'var(--db-red)'],
              ['Nevada Falls Trail', '5.2 / 10', 52, 'var(--db-amber)'],
              ['Mist Trail Lower',   '3.8 / 10', 38, 'var(--db-yellow)'],
              ['Valley Loop',        '1.5 / 10', 15, 'var(--db-green)'],
            ].map(([name, score, pct, color]) => (
              <div key={String(name)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--db-label)' }}>{name}</span>
                  <span style={{ fontFamily: 'Share Tech Mono, monospace', color: String(color) }}>{score}</span>
                </div>
                <div className="battery-bar"><div className="battery-fill" style={{ width: `${pct}%`, background: String(color) }}></div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Recommendations */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">AI Recommendations</span>
          <span className="panel-badge">Auto-Generated</span>
        </div>
        <div style={{ padding: '12px 16px 14px', fontSize: '0.63rem', color: 'var(--db-muted)', lineHeight: 1.9 }}>
          ▸ Add sensor node at Cable Route 2.4km mark (coverage gap)<br />
          ▸ Issue dynamic risk alert: wind speed above threshold<br />
          ▸ Consider temporary restriction above 2800m (wet conditions)<br />
          ▸ Increase patrol frequency: Half Dome trail — weekend peak<br />
          ▸ Review CB-04 connectivity — 6h ping gap flagged
        </div>
      </div>
    </div>
  );
}
