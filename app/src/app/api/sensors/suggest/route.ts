import { NextResponse } from 'next/server';
import { TRAIL_NETWORK } from '@/data/trailNetwork';
import type { BleScannerSuggestion } from '@/types/markers';

const RATIONALE: Record<string, string> = {
  // Trailheads
  'Happy Isles Trailhead':       'System entry point — all Mist Trail hikers pass through',
  'Mirror Lake Trailhead':       'Access point for Tenaya Canyon and North Dome routes',
  'Yosemite Falls Trailhead':    'Upper Falls trail entry — high day-hiker volume',
  'Glacier Point':               'Road-accessible overlook — Panorama Trail start, cliff hazard',
  'Tuolumne Meadows Trailhead':  'High Sierra hub — multiple backcountry routes originate here',
  'Hetch Hetchy Dam Trailhead':  "O'Shaughnessy Dam — remote reservoir trailhead",
  'Wawona / Mariposa Grove':     'South park entrance — Mariposa Grove and Wawona trails',
  'Bridalveil Fall Trailhead':   'Valley floor entry — high visitor traffic, slippery terrain',
  'Sentinel Dome Trailhead':     'Sentinel and Taft Point trails — exposed ridge terrain',
  'May Lake Trailhead':          'High Sierra camp access — alpine zone, weather exposure',
  'White Wolf Trailhead':        'Backcountry camp start — remote, limited cell coverage',
  'Tenaya Lake East Shore':      'Sunrise and Clouds Rest connector — high-use alpine area',
  // Junctions
  'Vernal Fall Bridge':          'Critical Mist Trail / horse trail split — flash flood risk',
  'Top of Vernal Fall':          'Mist Trail / JMT diverge — wet rocks, frequent slips',
  'Nevada Fall Top':             'JMT / Panorama Trail junction — 594m drop, exposure',
  'Little Yosemite Valley':      'JMT / Half Dome cables split — high-volume junction',
  'Half Dome Cables Junction':   'Sub Dome to cables — lightning risk, crowd bottleneck',
  'Clouds Rest Junction':        'Tuolumne / Tenaya connector — remote high-altitude ridge',
  'Yosemite Falls Top':          'North Dome connector — 2430m, narrow exposed trail',
  'Panorama Cliff Junction':     'Glacier Point to Nevada Fall — sheer cliff exposure',
  'Tuolumne River Bridge':       'Lembert Dome / Dog Lake split — river crossing point',
  // Destinations
  'Half Dome Summit':            'Highest incident rate in park — cable falls, lightning strikes',
  'Glacier Point Overlook':      'Cliff edge at 2199m — barrier collapse risk, vertigo',
  'Upper Yosemite Falls':        'Summit overlook — 2430m, unstable ledge near falls',
  'El Capitan Base':             'Climber rescue zone — rockfall, fixed-line incidents',
  'Tioga Pass Summit':           'Highest road point at 3031m — altitude sickness, snow year-round',
};

export async function GET() {
  let idx = 1;
  const scanners: BleScannerSuggestion[] = TRAIL_NETWORK.map(node => {
    const isTrailhead   = node.type === 'trailhead';
    const isDestination = node.type === 'destination';

    return {
      id:              `BLE-${String(idx++).padStart(3, '0')}`,
      lat:             node.lat,
      lon:             node.lon,
      name:            node.name,
      label:           isTrailhead ? 'ENTRY/EXIT' : isDestination ? 'HOTSPOT' : 'JUNCTION',
      rationale:       RATIONALE[node.name] ?? node.notes,
      type:            node.type,
      priority:        isTrailhead ? 'critical' : isDestination ? 'medium' : 'high',
      elevation_m:     node.elevation_m,
      coverageRadiusM: 80,
    };
  });

  const counts = {
    trailheads:   scanners.filter(s => s.type === 'trailhead').length,
    junctions:    scanners.filter(s => s.type === 'junction').length,
    destinations: scanners.filter(s => s.type === 'destination').length,
  };

  return NextResponse.json({ status: 'ok', scanners, counts });
}
