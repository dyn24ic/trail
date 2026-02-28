const LOG_EVENTS: [string, string, string][] = [
  ['14:38:01', 'ev-crit',  'INC-0847 · Alpha-01 thermal contact confirmed · zone A-2'],
  ['14:37:44', 'ev-ok',    'Sensor S-12 reset · signal restored'],
  ['14:36:22', 'ev-warn',  'Wind speed 38 km/h recorded at elevation 2800m'],
  ['14:35:10', 'ev-ok',    'Alpha-01 GPS beacon deployed at 37.7421°N 119.5318°W'],
  ['14:34:55', 'ev-crit',  'INC-0847 · AI triage: possible lower limb injury · consciousness confirmed'],
  ['14:32:08', 'ev-ok',    'Gamma-03 patrol extended — Nevada Falls sector'],
  ['14:30:15', 'ev-warn',  'INC-0846 · Overdue hiker check-in 40 min past window'],
  ['14:28:44', 'ev-ok',    'SAR Team Alpha briefed · route uploaded to mobile units'],
  ['14:26:10', 'ev-ok',    'CB-03 activation acknowledged · Ranger Unit 7 dispatched'],
  ['14:22:33', 'ev-warn',  'Weather alert: snow forecast above 3000m after 16:00'],
  ['14:18:07', 'ev-crit',  'INC-0847 opened · Sensor S-07 motion + audio anomaly detected'],
  ['14:15:50', 'ev-ok',    'Alpha-01 launched · mission: search zone A-2 thermal sweep'],
  ['14:12:30', 'ev-ok',    'AI prediction model updated · incident data ingested'],
  ['14:08:22', 'ev-ok',    'Patrol cycle complete · all sensors nominal except S-14'],
];

// Duplicate for seamless infinite scroll
const ALL_EVENTS = [...LOG_EVENTS, ...LOG_EVENTS];

export default function BottomBar() {
  return (
    <div className="bottombar">
      <span className="log-label">Event Log</span>
      <div className="log-ticker">
        <div className="log-track">
          {ALL_EVENTS.map(([ts, cls, msg], i) => (
            <div key={i} className="log-entry">
              <span className="ts">{ts}</span>
              <span className={cls}>{msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
