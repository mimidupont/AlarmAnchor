import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import useAnchorRadius from '../hooks/useAnchorRadius';
import { distanceMeters, bearingDegrees, circlePolygonPoints } from '../utils/geo';
import ConfirmDialog from './ConfirmDialog';
import TopStrip from './TopStrip';
import InstrumentPanel from './InstrumentPanel';
import ThemeToggle from './ThemeToggle';
import StatusPill from './StatusPill';
import './Map.css';

/* eslint-disable react-hooks/exhaustive-deps */

// Traduction du plugin Leaflet-Draw en français
L.drawLocal.draw.toolbar.buttons.polygon = 'Dessiner une zone de mouillage';
L.drawLocal.draw.toolbar.actions.title = 'Annuler le dessin';
L.drawLocal.draw.toolbar.actions.text = 'Annuler';
L.drawLocal.draw.toolbar.finish.title = 'Terminer le dessin';
L.drawLocal.draw.toolbar.finish.text = 'Terminer';
L.drawLocal.draw.toolbar.undo.title = 'Supprimer le dernier point dessiné';
L.drawLocal.draw.toolbar.undo.text = 'Supprimer le dernier point';
L.drawLocal.draw.handlers.polygon.tooltip.start = 'Cliquez pour commencer à dessiner la zone';
L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Cliquez pour continuer à dessiner la zone';
L.drawLocal.draw.handlers.polygon.tooltip.end = 'Cliquez sur le premier point pour fermer la zone';

L.drawLocal.edit.toolbar.buttons.edit = 'Modifier la zone';
L.drawLocal.edit.toolbar.buttons.editDisabled = 'Aucune zone à modifier';
L.drawLocal.edit.toolbar.buttons.remove = 'Supprimer la zone';
L.drawLocal.edit.toolbar.buttons.removeDisabled = 'Aucune zone à supprimer';
L.drawLocal.edit.toolbar.actions.save.title = 'Enregistrer les modifications';
L.drawLocal.edit.toolbar.actions.save.text = 'Enregistrer';
L.drawLocal.edit.toolbar.actions.cancel.title = 'Annuler les modifications';
L.drawLocal.edit.toolbar.actions.cancel.text = 'Annuler';
L.drawLocal.edit.handlers.edit.tooltip.text = 'Faites glisser les points pour modifier la zone';
L.drawLocal.edit.handlers.edit.tooltip.subtext = 'Cliquez sur Annuler pour annuler les modifications';
L.drawLocal.edit.handlers.remove.tooltip.text = 'Cliquez sur une zone pour la supprimer';

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

// Default scope: middle of the common 15-35m chain range.
const DEFAULT_ANCHOR_RADIUS = 25;

export default function Map({ zone, locations, sessionId, onZoneUpdate, role, onBack, anchor, onDropAnchor, onClearAnchor, alarmed, theme, onCycleTheme, connected, gpsError }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const drawnItems = useRef(null);
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
  // After that we leave the user's pan/zoom completely alone — the marker
  // still moves, but the map view is never touched again automatically.
  const hasCenteredMap = useRef(false);
  // The anchor marker's popup is plain Leaflet DOM, not React — its
  // buttons are wired up once when the popup first opens and call
  // whatever these refs point to at click time, so they always trigger
  // the current handler even though the popup itself isn't re-created
  // on every render.
  const handleAdjustRadiusRef = useRef(() => {});
  const onClearAnchorRef = useRef(() => {});
  const [anchorRadius, setAnchorRadius] = useState(DEFAULT_ANCHOR_RADIUS);
  const [radiusEditable, setRadiusEditable] = useState(false);
  const [confirmRaiseOpen, setConfirmRaiseOpen] = useState(false);

  // Draws the (optionally draggable) radius circle around the anchor.
  useAnchorRadius(map, anchor, anchorRadius, setAnchorRadius, radiusEditable);

  // Handle draw creation
  // NOTE: the created layer is now added to `drawnItems` (the FeatureGroup
  // wired to the edit/remove controls). Previously the layer was discarded
  // after reading its coordinates, which left the edit/remove toolbar
  // buttons with nothing to act on.
  const handleDrawCreated = (e) => {
    const layer = e.layer;
    if (layer instanceof L.Polygon) {
      // Only one anchor zone at a time
      drawnItems.current.clearLayers();

      layer.setStyle({
        color: '#ff7800',
        weight: 3,
        opacity: 0.8,
        fillOpacity: 0.15,
        dashArray: '5, 5'
      });

      drawnItems.current.addLayer(layer);

      const coordinates = layer.getLatLngs()[0].map(latlng => [latlng.lat, latlng.lng]);
      onZoneUpdate(coordinates);
    }
  };

  // Handle draw editing
  const handleDrawEdited = (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        const coordinates = layer.getLatLngs()[0].map(latlng => [latlng.lat, latlng.lng]);
        onZoneUpdate(coordinates);
      }
    });
  };

  // Handle draw deletion
  const handleDrawDeleted = () => {
    onZoneUpdate([]);
  };

  // Initialize map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mapContainer.current) return;

    // Prevent double initialization
    if (map.current) return;

    // Create map centered on default location
    map.current = L.map(mapContainer.current).setView([48.8566, 2.3522], 13);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© contributeurs OpenStreetMap',
      maxZoom: 19
    }).addTo(map.current);

    // Initialize FeatureGroup for drawing
    drawnItems.current = new L.FeatureGroup();
    map.current.addLayer(drawnItems.current);

    // Initialize draw control
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: {
          shapeOptions: {
            color: '#3388ff',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2
          },
          // showArea triggers the well-known "type is not defined" crash
          // in leaflet-draw 1.0.4 with Leaflet 1.8+ while drawing.
          showArea: false,
          metric: true
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
      },
      edit: {
        featureGroup: drawnItems.current,
        remove: true
      }
    });

    map.current.addControl(drawControl);

    // Handle draw events
    map.current.on('draw:created', handleDrawCreated);
    map.current.on('draw:edited', handleDrawEdited);
    map.current.on('draw:deleted', handleDrawDeleted);

    // Leaflet measures its container at creation time. If that container
    // hasn't finished laying out yet (very common right after switching
    // React views), it renders tiles for the wrong size and half the map
    // stays blank until something forces a recheck. The anchor-bar also
    // changes height depending on its content, which resizes this
    // container after the fact — this keeps Leaflet in sync automatically.
    const resizeObserver = new ResizeObserver(() => {
      map.current?.invalidateSize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      if (map.current) {
        map.current.off('draw:created', handleDrawCreated);
        map.current.off('draw:edited', handleDrawEdited);
        map.current.off('draw:deleted', handleDrawDeleted);
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

  // NOTE: There is intentionally no separate useEffect re-drawing `zone` as
  // a second polygon here (unlike RemoteMonitor). Since the drawn/edited
  // polygon already lives inside `drawnItems` and is rendered on the map,
  // adding another layer from the `zone` prop would create a visible
  // duplicate. RemoteMonitor has no draw controls, so it still needs its
  // own zone-drawing effect.

  // Update boat position
  useEffect(() => {
    if (!map.current || !locations) return;

    // Get current device's location (should be the boat's location)
    const currentDeviceLocation = Object.values(locations)[0];

    if (!currentDeviceLocation) return;

    const { latitude, longitude, accuracy } = currentDeviceLocation;
    const latlng = [latitude, longitude];
    const popupText = `📍 Position du bateau<br/>Précision : ${Math.round(accuracy)} m`;

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
  }, [locations]);

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
    const popupText = `⚓ Position de l'ancre${
      anchor.accuracy ? `<br/>Précision : ${Math.round(anchor.accuracy)} m` : ''
    }<div class="popup-actions">
      <button class="popup-adjust-radius">Ajuster le rayon</button>
      <button class="popup-clear-anchor">Retirer l'ancre</button>
    </div>`;

    if (!anchorMarker.current) {
      anchorMarker.current = L.marker(anchorLatLng, { icon: ANCHOR_ICON })
        .addTo(map.current)
        .bindPopup(popupText);

      // Popup content is plain DOM, outside React's tree, so buttons
      // inside it need manual wiring. Query for them fresh each time the
      // popup opens (rather than once at creation) since setPopupContent
      // below replaces the DOM nodes on every anchor/location update.
      anchorMarker.current.on('popupopen', () => {
        const popupEl = anchorMarker.current.getPopup().getElement();
        if (!popupEl) return;

        const adjustBtn = popupEl.querySelector('.popup-adjust-radius');
        if (adjustBtn) {
          adjustBtn.onclick = () => {
            anchorMarker.current.closePopup();
            handleAdjustRadiusRef.current();
          };
        }

        const clearBtn = popupEl.querySelector('.popup-clear-anchor');
        if (clearBtn) {
          clearBtn.onclick = () => {
            anchorMarker.current.closePopup();
            onClearAnchorRef.current();
          };
        }
      });
    } else {
      anchorMarker.current.setLatLng(anchorLatLng);
      anchorMarker.current.setPopupContent(popupText);
    }

    const boatLocation = locations ? Object.values(locations)[0] : null;
    if (boatLocation) {
      const boatLatLng = [boatLocation.latitude, boatLocation.longitude];
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
  }, [anchor, locations]);

  // Drop anchor, then immediately open the radius editor so the scope
  // (chain length) can be adjusted before confirming the alarm zone.
  // Clears any previously confirmed zone shape so the temporary draggable
  // circle isn't shown overlapping it.
  const handleDropAnchorClick = async () => {
    await onDropAnchor();
    setAnchorRadius(DEFAULT_ANCHOR_RADIUS);
    if (drawnItems.current) drawnItems.current.clearLayers();
    setRadiusEditable(true);
  };

  // Re-open the radius editor on an already-placed anchor, e.g. to widen
  // or shrink the zone after having previously confirmed it.
  const handleAdjustRadius = () => {
    if (drawnItems.current) drawnItems.current.clearLayers();
    setRadiusEditable(true);
  };

  // Confirm the radius: this circle IS the alarm zone (not a preview drawn
  // on top of a separate zone), so turn it directly into a real Leaflet
  // polygon inside `drawnItems`. That's the same FeatureGroup the edit
  // toolbar (pencil icon, top-right) is wired to, so afterwards you can
  // drag individual vertices to reshape it away from a perfect circle —
  // exactly like editing a manually-drawn zone.
  const handleConfirmRadius = () => {
    if (!anchor) return;
    setRadiusEditable(false);

    const points = circlePolygonPoints(anchor.latitude, anchor.longitude, anchorRadius);

    drawnItems.current.clearLayers();
    const polygon = L.polygon(points, {
      color: '#ff7800',
      weight: 3,
      opacity: 0.8,
      fillOpacity: 0.15,
      dashArray: '5, 5'
    });
    drawnItems.current.addLayer(polygon);

    onZoneUpdate(points);
  };

  // Keep the popup's button handlers pointing at the latest versions of
  // these functions (the popup itself is created once, outside React).
  useEffect(() => {
    handleAdjustRadiusRef.current = handleAdjustRadius;
    onClearAnchorRef.current = onClearAnchor;
  });

  const boatLocation = locations ? Object.values(locations)[0] : null;
  const anchorDistance =
    anchor && boatLocation
      ? distanceMeters(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude)
      : null;
  const anchorBearing =
    anchor && boatLocation
      ? bearingDegrees(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude)
      : null;

  // Alarm-zone size used for the warn threshold. For the confirmed circle
  // the max vertex distance equals anchorRadius; for a hand-drawn/edited
  // polygon it's a sane approximation of "how far out is still safe".
  // Recomputed only when the zone or anchor changes.
  const effectiveRadius = useMemo(() => {
    if (!anchor || !zone || zone.length < 3) return anchorRadius;
    let max = 0;
    for (const [lat, lng] of zone) {
      const d = distanceMeters(anchor.latitude, anchor.longitude, lat, lng);
      if (d > max) max = d;
    }
    return max;
  }, [zone, anchor, anchorRadius]);

  // Armed = anchor set + zone confirmed + not currently re-editing the radius.
  const armed = Boolean(anchor) && zone && zone.length >= 3 && !radiusEditable;

  const panelState = alarmed
    ? 'danger'
    : anchorDistance !== null && anchorDistance > 0.8 * effectiveRadius
      ? 'warn'
      : 'ok';

  return (
    <div className="map-container">
      {/* Compact top strip: back, tap-to-copy session ID, live health pill */}
      <TopStrip
        onBack={onBack}
        sessionId={sessionId}
        right={
          <StatusPill
            mode="main"
            connected={connected}
            boatLocation={boatLocation}
            gpsError={gpsError}
            armed={armed}
          />
        }
      />

      {/* Instrument panel — only in the armed state */}
      {armed && anchorDistance !== null && (
        <InstrumentPanel
          distance={anchorDistance}
          bearing={anchorBearing}
          radius={effectiveRadius}
          accuracy={boatLocation?.accuracy}
          state={panelState}
        />
      )}

      {/* GPS-wait placeholder line (the old status bar is gone) */}
      {!boatLocation && (
        <div className="instrument-panel instrument-waiting">
          <div className="instrument-label">Waiting for GPS signal…</div>
        </div>
      )}

      <div ref={mapContainer} className="map" />

      <ThemeToggle theme={theme} onCycle={onCycleTheme} />

      {/* Bottom action bar */}
      <div className="action-bar">
        {!anchor && (
          <button className="action-btn action-primary" onClick={handleDropAnchorClick}>
            ⚓ Drop anchor
          </button>
        )}

        {anchor && radiusEditable && (
          <>
            <span className="radius-info">
              Radius <strong>{anchorRadius} m</strong> — drag the green handle
            </span>
            <button className="action-btn action-primary" onClick={handleConfirmRadius}>
              Arm alarm
            </button>
          </>
        )}

        {armed && (
          <>
            <button className="action-btn" onClick={handleAdjustRadius}>
              Adjust zone
            </button>
            <button className="action-btn action-danger" onClick={() => setConfirmRaiseOpen(true)}>
              Raise anchor
            </button>
          </>
        )}
      </div>

      {confirmRaiseOpen && (
        <ConfirmDialog
          title="Raise anchor?"
          message="This clears the anchor position and disarms the alarm."
          confirmLabel="Raise anchor"
          cancelLabel="Keep watching"
          danger
          onConfirm={() => {
            setConfirmRaiseOpen(false);
            onClearAnchor();
          }}
          onCancel={() => setConfirmRaiseOpen(false)}
        />
      )}
    </div>
  );
}
