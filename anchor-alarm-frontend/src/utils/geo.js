// Haversine distance between two lat/lng points, in meters.
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Initial bearing from point 1 to point 2, in degrees (0 = North, clockwise).
export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Convert a bearing in degrees to an 8-point compass label.
export function bearingToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// Ray-casting point-in-polygon test. `point` is [lat, lng]; `polygon` is an
// array of [lat, lng] vertices. Same algorithm as the server uses, so the
// boat phone reaches the same verdict offline as the server does online.
export function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

// Effective alarm-zone radius: max distance from the anchor to any zone
// vertex. Equals the confirmed circle's radius for generated zones, and a
// sane "how far out is still safe" approximation for hand-drawn ones.
export function zoneRadiusMeters(anchor, zone) {
  if (!anchor || !zone || zone.length < 3) return 0;
  let max = 0;
  for (const [lat, lng] of zone) {
    const d = distanceMeters(anchor.latitude, anchor.longitude, lat, lng);
    if (d > max) max = d;
  }
  return max;
}

// Given a center point and a distance due east (in meters), return the
// approximate [lat, lng] of that point. Flat-earth approximation, accurate
// enough at anchoring distances (tens of meters).
export function destinationEast(lat, lon, meters) {
  const metersPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return [lat, lon + meters / metersPerDegLon];
}

// Builds an approximate circular polygon (array of [lat, lng] points) of
// the given radius (meters) around a center point. Uses a modest point
// count by default (rather than a smooth 32+ sided circle) so that once
// this becomes a real editable polygon, each vertex is still easy to grab
// and drag individually to reshape the zone away from a perfect circle.
export function circlePolygonPoints(lat, lon, radiusMeters, steps = 16) {
  const metersPerDegLat = 111320;
  const points = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(angle)) / metersPerDegLat;
    const dLon =
      (radiusMeters * Math.sin(angle)) /
      (metersPerDegLat * Math.cos((lat * Math.PI) / 180));
    points.push([lat + dLat, lon + dLon]);
  }
  return points;
}

// Move every vertex by the same lat/lng delta. Over the tens of meters
// involved in correcting an anchor position, plain delta addition is
// indistinguishable from a proper geodesic translation.
export function translatePolygon(points, dLat, dLng) {
  return points.map(([lat, lng]) => [lat + dLat, lng + dLng]);
}

// Local ENU-ish projection: meters east/north of a reference point.
// Flat-earth approximation — accurate well beyond anchoring distances.
function toLocalMeters(lat, lng, refLat, refLng) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  return [(lng - refLng) * mPerDegLng, (lat - refLat) * mPerDegLat];
}

// Shortest distance from point p to segment a-b, all in local meters.
// Also returns the parameter t of the closest point along the segment so
// callers can recover its position.
function closestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
}

// Unsigned distance from a point to the closest point on the zone
// boundary, in meters. null when there is no usable zone.
export function distanceToZoneEdgeMeters(lat, lng, zone) {
  if (!zone || zone.length < 3) return null;
  const origin = [0, 0]; // the boat itself is the projection reference
  let min = Infinity;
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const a = toLocalMeters(zone[j][0], zone[j][1], lat, lng);
    const b = toLocalMeters(zone[i][0], zone[i][1], lat, lng);
    const { distance } = closestOnSegment(origin, a, b);
    if (distance < min) min = distance;
  }
  return min;
}

// Signed margin: positive inside the zone (room left), negative outside
// (distance past the boundary). Reuses the same point-in-polygon test the
// alarm uses, so the sign always agrees with the alarm state.
export function zoneMarginMeters(lat, lng, zone) {
  const d = distanceToZoneEdgeMeters(lat, lng, zone);
  if (d === null) return null;
  return isPointInPolygon([lat, lng], zone) ? d : -d;
}

// The point on the zone boundary closest to [lat, lng], as [lat, lng].
// Used to draw the "which way is trouble" line. null when no usable zone.
export function nearestZonePoint(lat, lng, zone) {
  if (!zone || zone.length < 3) return null;
  const origin = [0, 0];
  let best = null;
  let min = Infinity;
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const [latA, lngA] = zone[j];
    const [latB, lngB] = zone[i];
    const a = toLocalMeters(latA, lngA, lat, lng);
    const b = toLocalMeters(latB, lngB, lat, lng);
    const { t, distance } = closestOnSegment(origin, a, b);
    if (distance < min) {
      min = distance;
      // Interpolate in lat/lng directly: the projection is linear in both
      // coordinates, so the parameter t carries over unchanged.
      best = [latA + t * (latB - latA), lngA + t * (lngB - lngA)];
    }
  }
  return best;
}
