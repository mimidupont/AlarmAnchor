import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { splitTrackByAge } from '../utils/track';

// The track sits in its own pane below overlayPane (400) so it always
// renders under the zone polygon and the markers, whatever order layers
// happen to be added in.
const TRACK_PANE = 'trackPane';
const TRACK_PANE_Z = 390;

function ensureTrackPane(map) {
  if (map.getPane(TRACK_PANE)) return;
  const pane = map.createPane(TRACK_PANE);
  pane.style.zIndex = String(TRACK_PANE_Z);
  // Never intercept touches: dragging the map must not grab the track.
  pane.style.pointerEvents = 'none';
}

/**
 * Renders the GPS track as two polylines — everything older than an hour
 * faded, the last hour brighter — so the eye immediately separates "where
 * we've been all night" from "where we are heading now".
 *
 * Layers are created once and updated with setLatLngs, never removed and
 * re-added. Color and opacity come from CSS classes rather than Leaflet's
 * `color` option: Leaflet writes that to the SVG `stroke` presentation
 * attribute, which cannot resolve a CSS variable, so a themed track has
 * to be styled from the stylesheet.
 *
 * `mode` is 'all' | 'hour' | 'off'; `visible` gates the whole layer
 * (hidden while the zone is being edited).
 */
export default function useTrackLayers(mapRef, track, mode, visible) {
  const oldLine = useRef(null);
  const recentLine = useRef(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const drop = (ref) => {
      if (ref.current) {
        map.removeLayer(ref.current);
        ref.current = null;
      }
    };

    if (!visible || mode === 'off' || !track || track.length < 2) {
      drop(oldLine);
      drop(recentLine);
      return;
    }

    ensureTrackPane(map);

    const [older, recent] = splitTrackByAge(track);
    const olderShown = mode === 'hour' ? [] : older;

    const apply = (ref, points, className) => {
      const latlngs = points.map(([lat, lng]) => [lat, lng]);
      if (latlngs.length < 2) {
        drop(ref);
        return;
      }
      if (!ref.current) {
        ref.current = L.polyline(latlngs, {
          weight: 2,
          interactive: false,
          pane: TRACK_PANE,
          className,
          // Leaflet simplifies polylines per zoom (Douglas-Peucker). At the
          // default 1.0 a swing arc collapses to a near-straight line when
          // zoomed out — which is exactly the pattern this feature exists
          // to show. Half that keeps the shape legible; at a few thousand
          // points the extra vertices cost nothing measurable.
          smoothFactor: 0.5
        }).addTo(map);
      } else {
        ref.current.setLatLngs(latlngs);
      }
    };

    apply(oldLine, olderShown, 'track-line track-line-old');
    apply(recentLine, recent, 'track-line track-line-recent');
  }, [mapRef, track, mode, visible]);

  // Forget the layers when the map goes away (view switch / StrictMode
  // remount) so a new map never inherits handles to destroyed ones.
  useEffect(
    () => () => {
      oldLine.current = null;
      recentLine.current = null;
    },
    []
  );
}
