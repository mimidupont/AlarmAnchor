import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { distanceMeters, bearingDegrees, zoneRadiusMeters } from '../utils/geo';
import { useT } from '../i18n';
import TopStrip from './TopStrip';
import InstrumentPanel from './InstrumentPanel';
import ThemeToggle from './ThemeToggle';
import StatusPill from './StatusPill';
import './RemoteMonitor.css';

const BOAT_ICON = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSI2IiBmaWxsPSIjRkY0NDQ0IiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPgo=',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16]
});

const ANCHOR_ICON = L.divIcon({
  className: 'anchor-marker',
  html: '⚓',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -15]
});

export default function RemoteMonitor({ zone, locations, sessionId, anchor, onBack, alarmed, theme, onCycleTheme, connected }) {
  const t = useT();
  const mapContainer = useRef(null);
  const map = useRef(null);
  const zoneLayer = useRef(null);
  // A single persistent marker + accuracy circle that we move/resize in
  // place on every GPS update, instead of removing and re-adding them.
  // Recreating the marker every ~10s meant its popup re-opened each time,
  // and Leaflet's popup auto-pan would nudge the view back toward the
  // boat — which is what looked like the map "zooming back out" whenever
  // you tried to zoom in manually. Likewise the old accuracy circle was
  // never removed, so circles piled up on top of each other.
  const boatMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const anchorMarker = useRef(null);
  const anchorLine = useRef(null);
  // We only ever auto-center/zoom the map once, on the very first GPS fix.
  // After that we leave the user's pan/zoom completely alone.
  const hasCenteredMap = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Prevent double initialization
    if (map.current) return;

    map.current = L.map(mapContainer.current).setView([48.8566, 2.3522], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© contributeurs OpenStreetMap',
      maxZoom: 19
    }).addTo(map.current);

    // Leaflet measures its container at creation time. If that container
    // hasn't finished laying out yet (very common right after switching
    // React views), it renders tiles for the wrong size and half the map
    // stays blank until something forces a recheck.
    const resizeObserver = new ResizeObserver(() => {
      map.current?.invalidateSize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      // Reset per-map refs so a remount (e.g. React StrictMode's extra
      // mount/unmount cycle in dev) starts clean instead of holding on to
      // layers that belonged to a destroyed map instance.
      boatMarker.current = null;
      accuracyCircle.current = null;
      hasCenteredMap.current = false;
      anchorMarker.current = null;
      anchorLine.current = null;
    };
  }, []);

  // Update zone visualization
  useEffect(() => {
    if (!map.current) return;

    if (zoneLayer.current) {
      map.current.removeLayer(zoneLayer.current);
      zoneLayer.current = null;
    }

    if (zone && zone.length >= 3) {
      const latlngs = zone.map(([lat, lng]) => [lat, lng]);
      zoneLayer.current = L.polygon(latlngs, {
        color: '#ff7800',
        weight: 3,
        opacity: 0.8,
        fillOpacity: 0.15,
        dashArray: '5, 5'
      }).addTo(map.current);
    }
  }, [zone]);

  // Update boat position
  useEffect(() => {
    if (!map.current || !locations) return;

    const currentLocation = Object.values(locations)[0];
    if (!currentLocation) return;

    const { latitude, longitude, accuracy } = currentLocation;
    const latlng = [latitude, longitude];
    const popupText = `${t('boatPosition')}<br/>${t('accuracyMeters', { n: Math.round(accuracy) })}`;

    // Move the existing marker instead of destroying/recreating it. This
    // avoids re-triggering the popup's open animation (and its auto-pan)
    // on every update.
    if (!boatMarker.current) {
      boatMarker.current = L.marker(latlng, { icon: BOAT_ICON })
        .addTo(map.current)
        .bindPopup(popupText);
    } else {
      boatMarker.current.setLatLng(latlng);
      boatMarker.current.setPopupContent(popupText);
    }

    // Resize/move the single accuracy circle instead of stacking a new
    // one on top every update.
    if (!accuracyCircle.current) {
      accuracyCircle.current = L.circle(latlng, {
        radius: accuracy,
        color: '#3388ff',
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.05
      }).addTo(map.current);
    } else {
      accuracyCircle.current.setLatLng(latlng);
      accuracyCircle.current.setRadius(accuracy);
    }

    // Only touch the map's view (center + zoom) on the very first fix.
    // After that, the user has full control of pan/zoom forever.
    if (!hasCenteredMap.current) {
      map.current.setView(latlng, 14);
      boatMarker.current.openPopup();
      hasCenteredMap.current = true;
    }
  }, [locations, t]);

  // Update anchor marker + chain line to the boat
  useEffect(() => {
    if (!map.current) return;

    if (!anchor) {
      if (anchorMarker.current) {
        map.current.removeLayer(anchorMarker.current);
        anchorMarker.current = null;
      }
      if (anchorLine.current) {
        map.current.removeLayer(anchorLine.current);
        anchorLine.current = null;
      }
      return;
    }

    const anchorLatLng = [anchor.latitude, anchor.longitude];
    const popupText = `${t('anchorPosition')}${
      anchor.accuracy ? `<br/>${t('accuracyMeters', { n: Math.round(anchor.accuracy) })}` : ''
    }`;

    if (!anchorMarker.current) {
      anchorMarker.current = L.marker(anchorLatLng, { icon: ANCHOR_ICON })
        .addTo(map.current)
        .bindPopup(popupText);
    } else {
      anchorMarker.current.setLatLng(anchorLatLng);
      anchorMarker.current.setPopupContent(popupText);
    }

    const currentLocation = locations ? Object.values(locations)[0] : null;
    if (currentLocation) {
      const boatLatLng = [currentLocation.latitude, currentLocation.longitude];
      if (!anchorLine.current) {
        anchorLine.current = L.polyline([anchorLatLng, boatLatLng], {
          color: '#8e44ad',
          weight: 2,
          dashArray: '4, 6',
          opacity: 0.7
        }).addTo(map.current);
      } else {
        anchorLine.current.setLatLngs([anchorLatLng, boatLatLng]);
      }
    } else if (anchorLine.current) {
      map.current.removeLayer(anchorLine.current);
      anchorLine.current = null;
    }
  }, [anchor, locations, t]);

  const boatLocation = locations ? Object.values(locations)[0] : null;
  const anchorDistance =
    anchor && boatLocation
      ? distanceMeters(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude)
      : null;
  const anchorBearing =
    anchor && boatLocation
      ? bearingDegrees(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude)
      : null;

  // Same effective-radius approximation as the main view: max distance
  // from anchor to any zone vertex, memoized per zone change.
  const effectiveRadius = useMemo(() => zoneRadiusMeters(anchor, zone), [zone, anchor]);

  const armed = Boolean(anchor) && zone && zone.length >= 3;

  const panelState = alarmed
    ? 'danger'
    : anchorDistance !== null && anchorDistance > 0.8 * effectiveRadius
      ? 'warn'
      : 'ok';

  const updatedFooter = boatLocation ? (
    <div className="instrument-updated">
      {t('updatedAt', { time: new Date(boatLocation.timestamp).toLocaleTimeString() })}
    </div>
  ) : null;

  return (
    <div className="remote-monitor">
      <TopStrip
        onBack={onBack}
        sessionId={sessionId}
        right={
          <StatusPill
            mode="remote"
            connected={connected}
            boatLocation={boatLocation}
            gpsError={null}
            armed={armed}
          />
        }
      />

      {armed && anchorDistance !== null && (
        <InstrumentPanel
          distance={anchorDistance}
          bearing={anchorBearing}
          radius={effectiveRadius}
          accuracy={boatLocation?.accuracy}
          state={panelState}
          footer={updatedFooter}
        />
      )}

      {boatLocation && !armed && (
        <div className="instrument-panel">
          <div className="instrument-readouts">
            <span>
              {boatLocation.latitude.toFixed(4)}°, {boatLocation.longitude.toFixed(4)}°
            </span>
            <span>{t('gpsLabel')} {Math.round(boatLocation.accuracy)} m</span>
          </div>
          {updatedFooter}
        </div>
      )}

      {!boatLocation && (
        <div className="instrument-panel instrument-waiting">
          <div className="instrument-label">{t('waitingBoat')}</div>
        </div>
      )}

      <div ref={mapContainer} className="map" />

      <ThemeToggle theme={theme} onCycle={onCycleTheme} />
    </div>
  );
}
