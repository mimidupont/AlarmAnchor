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
