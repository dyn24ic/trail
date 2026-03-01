// Simplified Yosemite National Park boundary polygon.
// Clockwise winding order → used as the interior hole ring in the fog-of-war mask.
export const YOSEMITE_BOUNDARY: [number, number][] = [
  [-120.07, 38.08],
  [-119.85, 38.19],
  [-119.52, 38.19],
  [-119.25, 38.06],
  [-119.20, 37.95],
  [-119.16, 37.87],
  [-119.18, 37.78],
  [-119.22, 37.68],
  [-119.28, 37.59],
  [-119.40, 37.49],
  [-119.59, 37.49],
  [-119.73, 37.49],
  [-119.88, 37.54],
  [-119.97, 37.63],
  [-120.02, 37.75],
  [-120.06, 37.88],
  [-120.07, 38.00],
  [-120.07, 38.08], // close ring
];

// Counter-clockwise world ring → exterior of the fog polygon.
export const WORLD_RING: [number, number][] = [
  [-180, -85.05],
  [-180,  85.05],
  [ 180,  85.05],
  [ 180, -85.05],
  [-180, -85.05],
];
