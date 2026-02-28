import type { BBox } from '@/types/elevation';

export const YOSEMITE_BBOX: BBox = {
  south: 37.49,
  north: 38.19,
  west:  -119.89,
  east:  -119.19,
};

// Real-world aspect ratio so the mesh matches actual geography
const LAT_KM    = 111.32; // km per degree latitude
const centerLat = (YOSEMITE_BBOX.north + YOSEMITE_BBOX.south) / 2;
const latSpanKm = (YOSEMITE_BBOX.north - YOSEMITE_BBOX.south) * LAT_KM;
const lonSpanKm = (YOSEMITE_BBOX.east  - YOSEMITE_BBOX.west)  * LAT_KM * Math.cos(centerLat * Math.PI / 180);
const longerKm  = Math.max(latSpanKm, lonSpanKm);

const MESH_SCALE = 20; // world units for the longest axis
export const MESH_WIDTH  = MESH_SCALE * lonSpanKm / longerKm; // Three.js X (east-west)
export const MESH_HEIGHT = MESH_SCALE * latSpanKm / longerKm; // Three.js Z (north-south)
export const MESH_SIZE   = MESH_SCALE; // kept for any legacy references
export const MESH_RES    = 140;        // vertices per side
