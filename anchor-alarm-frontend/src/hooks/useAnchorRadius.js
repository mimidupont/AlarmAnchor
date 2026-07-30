import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { distanceMeters, destinationEast } from '../utils/geo';

/**
 * Draws a draggable-radius circle around the anchor position while
 * `editable` is true (used to pick the chain scope). Once the caller
 * confirms and turns it into a real polygon zone, `editable` should go
 * back to false and this hook draws nothing — the confirmed zone lives
 * as an actual editable Leaflet polygon instead, so there's no need for
 * this temporary circle to keep rendering on top of it.
 *
 * @param {React.MutableRefObject} mapRef - ref holding the Leaflet map instance
 * @param {{latitude:number, longitude:number}|null} anchor
 * @param {number} radius - current radius in meters
 * @param {(radius:number)=>void} onRadiusChange
 * @param {boolean} editable
 */
export default function useAnchorRadius(mapRef, anchor, radius, onRadiusChange, editable) {
  const circle = useRef(null);
  const handle = useRef(null);
  // True while the user is dragging the handle. Radius changes re-run the
  // effect below, and repositioning the handle mid-drag would snap it back
  // due-east of the anchor, fighting the user's finger.
  const dragging = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!anchor || !editable) {
      if (circle.current) {
        map.removeLayer(circle.current);
        circle.current = null;
      }
      if (handle.current) {
        map.removeLayer(handle.current);
        handle.current = null;
      }
      return;
    }

    const center = [anchor.latitude, anchor.longitude];

    if (!circle.current) {
      circle.current = L.circle(center, {
        radius,
        color: '#27ae60',
        weight: 2,
        fillOpacity: 0.08,
        dashArray: '6, 6'
      }).addTo(map);
    } else {
      circle.current.setLatLng(center);
      circle.current.setRadius(radius);
    }

    const edgeLatLng = destinationEast(center[0], center[1], radius);

    if (!handle.current) {
      handle.current = L.marker(edgeLatLng, {
        draggable: true,
        icon: L.divIcon({
          className: 'radius-handle',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      }).addTo(map);

      handle.current.on('dragstart', () => {
        dragging.current = true;
      });
      handle.current.on('dragend', () => {
        dragging.current = false;
      });
      handle.current.on('drag', (e) => {
        // Measure from the circle's current center (not the `center`
        // captured when the handler was first created, which would be
        // stale if the anchor has since been re-dropped).
        if (!circle.current) return;
        const c = circle.current.getLatLng();
        const pos = e.target.getLatLng();
        const newRadius = distanceMeters(c.lat, c.lng, pos.lat, pos.lng);
        circle.current.setRadius(newRadius);
        onRadiusChange(Math.max(3, Math.round(newRadius)));
      });
    } else if (!dragging.current) {
      handle.current.setLatLng(edgeLatLng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, anchor, radius, editable, onRadiusChange]);
}
