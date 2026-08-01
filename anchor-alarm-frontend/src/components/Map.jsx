import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// The draw toolbar is gone, but leaflet-draw is still the vertex editor:
// its CSS styles `.leaflet-editing-icon` handles and the module provides
// `L.EditToolbar.Edit`, which we drive directly from the zone sheet.
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import useAnchorRadius from '../hooks/useAnchorRadius';
import {
  distanceMeters,
  bearingDegrees,
  circlePolygonPoints,
  zoneRadiusMeters,
  zoneMarginMeters,
  nearestZonePoint
} from '../utils/geo';
import ConfirmDialog from './ConfirmDialog';
import TopStrip from './TopStrip';
import InstrumentPanel from './InstrumentPanel';
import ThemeToggle from './ThemeToggle';
import StatusPill from './StatusPill';
import ZoneSheet from './ZoneSheet';
import { useT } from '../i18n';
import './Map.css';

/* eslint-disable react-hooks/exhaustive-deps */

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

// Confirmed alarm-zone polygon styling.
const ZONE_STYLE = {
  color: '#ff7800',
  weight: 3,
  opacity: 0.8,
  fillOpacity: 0.15,
  dashArray: '5, 5'
};

// A vertex further than this from the anchor radius means the zone has
// been hand-reshaped and is no longer a plain circle.
const RESHAPED_TOLERANCE_M = 2;

// Vertex count when materialising a circle for shape editing. Lower than
// the 16 used for a confirmed circle: leaflet-draw adds a midpoint handle
// between every pair, so 12 vertices already means 24 handles on screen
// and any more become impossible to grab individually. The resulting
// polygon sits at worst ~3% inside the nominal radius, far below GPS noise.
const SHAPE_STEPS = 12;

export default function Map({ zone, locations, sessionId, onZoneUpdate, role, onBack, anchor, onDropAnchor, onClearAnchor, alarmed, theme, onCycleTheme, connected, gpsError }) {
  const t = useT();
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
  const edgeLine = useRef(null);
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
  // Live vertex-editing handler (leaflet-draw's edit mode, driven from
  // the zone sheet instead of the removed toolbar).
  const editHandler = useRef(null);
  const [anchorRadius, setAnchorRadius] = useState(DEFAULT_ANCHOR_RADIUS);
  const [zoneEditing, setZoneEditing] = useState(false); // sheet visible
  const [zoneMode, setZoneMode] = useState('circle'); // 'circle' | 'shape'
  // Confirming from the drop-anchor flow arms the alarm; re-editing an
  // already-armed zone just closes the sheet.
  const [initialSetup, setInitialSetup] = useState(false);
  const [confirmRaiseOpen, setConfirmRaiseOpen] = useState(false);
  const [confirmBackToCircleOpen, setConfirmBackToCircleOpen] = useState(false);

  // The temporary green circle + drag handle belong to circle mode only,
  // so they never sit on top of the real polygon while reshaping it.
  useAnchorRadius(map, anchor, anchorRadius, setAnchorRadius, zoneEditing && zoneMode === 'circle');

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

    // Vertex drags in shape mode land here via EditToolbar.Edit.save().
    map.current.on('draw:edited', handleDrawEdited);

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
      if (editHandler.current) {
        editHandler.current.disable();
        editHandler.current = null;
      }
      if (map.current) {
        map.current.off('draw:edited', handleDrawEdited);
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
      edgeLine.current = null;
    };
  }, []);

  // The confirmed zone lives as a real polygon inside `drawnItems` (that's
  // what the vertex editor edits), so it is only (re)built from the `zone`
  // prop when the group is empty — on mount/remount, or after rejoining a
  // session whose zone was set on another device. Rebuilding it while it
  // already exists would stack a duplicate on top.
  const getZonePolygon = () => {
    let found = null;
    drawnItems.current?.eachLayer((layer) => {
      if (layer instanceof L.Polygon) found = layer;
    });
    return found;
  };

  const polygonPoints = (polygon) =>
    polygon.getLatLngs()[0].map((latlng) => [latlng.lat, latlng.lng]);

  const setZonePolygon = (points) => {
    drawnItems.current.clearLayers();
    drawnItems.current.addLayer(L.polygon(points, ZONE_STYLE));
  };

  useEffect(() => {
    if (!map.current || zoneEditing) return;
    if (!zone || zone.length < 3) return;
    if (getZonePolygon()) return;
    setZonePolygon(zone);
  }, [zone, zoneEditing]);

  // Update boat position
  useEffect(() => {
    if (!map.current || !locations) return;

    // Get current device's location (should be the boat's location)
    const currentDeviceLocation = Object.values(locations)[0];

    if (!currentDeviceLocation) return;

    const { latitude, longitude, accuracy } = currentDeviceLocation;
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
    const popupText = `${t('anchorPosition')}${
      anchor.accuracy ? `<br/>${t('accuracyMeters', { n: Math.round(anchor.accuracy) })}` : ''
    }<div class="popup-actions">
      <button class="popup-adjust-radius">${t('adjustRadius')}</button>
      <button class="popup-clear-anchor">${t('removeAnchor')}</button>
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

  // Entering the radius editor: zoom to the anchor so the circle and its
  // drag handle are at a workable size (at anchorage zoom the 25 m circle
  // is a few pixels). One deliberate view change per explicit user action
  // — not an automatic follow.
  useEffect(() => {
    if (zoneEditing && anchor && map.current) {
      boatMarker.current?.closePopup();
      map.current.setView([anchor.latitude, anchor.longitude], 17);
    }
  }, [zoneEditing, anchor]);

  // ---- Zone editing ----------------------------------------------------

  // True when the current polygon deviates from a plain circle of the
  // current radius, i.e. the user has dragged vertices around.
  const isZoneReshaped = () => {
    const polygon = getZonePolygon();
    if (!polygon || !anchor) return false;
    return polygonPoints(polygon).some(
      ([lat, lng]) =>
        Math.abs(distanceMeters(anchor.latitude, anchor.longitude, lat, lng) - anchorRadius) >
        RESHAPED_TOLERANCE_M
    );
  };

  const enableVertexEditing = () => {
    if (!map.current || !drawnItems.current || editHandler.current) return;
    editHandler.current = new L.EditToolbar.Edit(map.current, {
      featureGroup: drawnItems.current
    });
    editHandler.current.enable();
  };

  // `save()` is what emits draw:edited; disable() alone would discard the
  // drag. Callers that need the vertices immediately read the polygon
  // directly rather than waiting on the event.
  const disableVertexEditing = ({ save = true } = {}) => {
    if (!editHandler.current) return;
    if (save) editHandler.current.save();
    editHandler.current.disable();
    editHandler.current = null;
  };

  const enterShapeMode = () => {
    // The editor needs a polygon to attach handles to. Prefer whatever is
    // already on the map (possibly reshaped), else materialise the circle.
    if (!getZonePolygon()) {
      if (!anchor) return;
      const points = circlePolygonPoints(anchor.latitude, anchor.longitude, anchorRadius, SHAPE_STEPS);
      setZonePolygon(points);
      onZoneUpdate(points);
    }
    setZoneMode('shape');
    enableVertexEditing();
  };

  const enterCircleMode = () => {
    disableVertexEditing({ save: false });
    drawnItems.current?.clearLayers();
    setZoneMode('circle');
  };

  const handleModeChange = (next) => {
    if (next === zoneMode) return;
    if (next === 'shape') {
      enterShapeMode();
      return;
    }
    // Going back to a circle throws away a hand-shaped zone — only worth
    // asking about when there is actually a custom shape to lose.
    if (isZoneReshaped()) {
      setConfirmBackToCircleOpen(true);
      return;
    }
    enterCircleMode();
  };

  const handleResetToCircle = () => {
    if (!anchor) return;
    disableVertexEditing({ save: false });
    const points = circlePolygonPoints(anchor.latitude, anchor.longitude, anchorRadius, SHAPE_STEPS);
    setZonePolygon(points);
    onZoneUpdate(points);
    enableVertexEditing();
  };

  // Shape mode is unusable at anchorage zoom: a 40 m circle is ~45 px
  // across, so every handle overlaps its neighbours. Fit the polygon into
  // the strip of map still visible above the sheet, measuring the sheet
  // rather than assuming its height.
  useEffect(() => {
    if (!zoneEditing || zoneMode !== 'shape' || !map.current) return;
    const polygon = getZonePolygon();
    if (!polygon) return;
    const id = setTimeout(() => {
      if (!map.current) return;
      const sheetHeight = document.querySelector('.zone-sheet')?.offsetHeight || 0;
      map.current.fitBounds(polygon.getBounds(), {
        paddingTopLeft: [36, 36],
        paddingBottomRight: [36, sheetHeight + 36],
        maxZoom: 20
      });
    }, 80);
    return () => clearTimeout(id);
  }, [zoneEditing, zoneMode]);

  // Drop anchor, then open the zone sheet in circle mode so the scope
  // (chain length) is set before the alarm is armed.
  const handleDropAnchorClick = async () => {
    await onDropAnchor();
    setAnchorRadius(DEFAULT_ANCHOR_RADIUS);
    drawnItems.current?.clearLayers();
    setZoneMode('circle');
    setInitialSetup(true);
    setZoneEditing(true);
  };

  // Re-open the sheet on an already-armed zone (action bar, or the anchor
  // popup). Start in whichever mode matches the zone as it stands.
  const handleAdjustZone = () => {
    setInitialSetup(false);
    if (isZoneReshaped()) {
      setZoneMode('shape');
      setZoneEditing(true);
      enableVertexEditing();
    } else {
      drawnItems.current?.clearLayers();
      setZoneMode('circle');
      setZoneEditing(true);
    }
  };

  const handleConfirmZone = () => {
    if (!anchor) return;

    let points;
    if (zoneMode === 'shape') {
      disableVertexEditing();
      const polygon = getZonePolygon();
      // Belt and braces: draw:edited can arrive asynchronously, so take
      // the vertices straight off the polygon instead of trusting it.
      points = polygon ? polygonPoints(polygon) : null;
    } else {
      points = circlePolygonPoints(anchor.latitude, anchor.longitude, anchorRadius);
      setZonePolygon(points);
    }

    if (points && points.length >= 3) onZoneUpdate(points);
    setZoneEditing(false);
  };

  const handleRaiseAnchor = () => {
    setConfirmRaiseOpen(false);
    disableVertexEditing({ save: false });
    drawnItems.current?.clearLayers();
    setZoneEditing(false);
    // Clear the zone as well as the anchor: leaving it behind would keep
    // the alarm armed on a stale zone while motoring away from it.
    onZoneUpdate([]);
    onClearAnchor();
  };

  // Keep the popup's button handlers pointing at the latest versions of
  // these functions (the popup itself is created once, outside React).
  useEffect(() => {
    handleAdjustRadiusRef.current = handleAdjustZone;
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
  const effectiveRadius = useMemo(
    () => zoneRadiusMeters(anchor, zone) || anchorRadius,
    [zone, anchor, anchorRadius]
  );

  // Armed = anchor set + zone confirmed + not currently editing the zone.
  const armed = Boolean(anchor) && zone && zone.length >= 3 && !zoneEditing;

  // Signed room left before the boat crosses the boundary; drives both the
  // readout and the panel color. The 8 m floor on the warn threshold
  // matters on a tight zone: 15% of 15 m is 2 m, inside GPS noise, so it
  // would never warn before the alarm itself fired.
  const margin =
    boatLocation && zone && zone.length >= 3
      ? zoneMarginMeters(boatLocation.latitude, boatLocation.longitude, zone)
      : null;
  const warnThreshold = Math.max(8, 0.15 * effectiveRadius);

  // Thin line from the boat to the closest point on the boundary, shown
  // only when the margin is inside the warn threshold — it makes "which
  // way is trouble" obvious at a glance. Single reused layer, moved in
  // place like the anchor line.
  useEffect(() => {
    if (!map.current) return;
    const show =
      boatLocation && zone && zone.length >= 3 && margin !== null && margin < warnThreshold;

    if (!show) {
      if (edgeLine.current) {
        map.current.removeLayer(edgeLine.current);
        edgeLine.current = null;
      }
      return;
    }

    const target = nearestZonePoint(boatLocation.latitude, boatLocation.longitude, zone);
    if (!target) return;
    const pts = [[boatLocation.latitude, boatLocation.longitude], target];

    if (!edgeLine.current) {
      edgeLine.current = L.polyline(pts, {
        color: margin < 0 ? '#e24b4a' : '#ef9f27',
        weight: 2,
        opacity: 0.9,
        interactive: false
      }).addTo(map.current);
    } else {
      edgeLine.current.setLatLngs(pts);
      edgeLine.current.setStyle({ color: margin < 0 ? '#e24b4a' : '#ef9f27' });
    }
  }, [boatLocation, zone, margin, warnThreshold]);

  const panelState =
    alarmed || (margin !== null && margin < 0)
      ? 'danger'
      : margin !== null && margin < warnThreshold
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
          margin={margin}
          state={panelState}
        />
      )}

      {/* GPS-wait placeholder line (the old status bar is gone) */}
      {!boatLocation && (
        <div className="instrument-panel instrument-waiting">
          <div className="instrument-label">{t('waitingGps')}</div>
        </div>
      )}

      <div ref={mapContainer} className="map" />

      {/* Hidden while the zone sheet is up — it would sit under it */}
      {!zoneEditing && <ThemeToggle theme={theme} onCycle={onCycleTheme} />}

      {/* Stage 1 — DROP: one large floating button over the map */}
      {!anchor && (
        <button className="float-drop-btn" onClick={handleDropAnchorClick}>
          {t('dropAnchor')}
        </button>
      )}

      {/* Stage 2 — ZONE: one sheet for both circle and shape editing.
          The map stays interactive behind it so the green radius handle
          (circle) and the vertex handles (shape) can still be dragged. */}
      {anchor && zoneEditing && (
        <ZoneSheet
          mode={zoneMode}
          onModeChange={handleModeChange}
          radius={anchorRadius}
          onRadiusChange={setAnchorRadius}
          onResetToCircle={handleResetToCircle}
          onConfirm={handleConfirmZone}
          confirmLabel={initialSetup ? t('armAlarm') : t('done')}
        />
      )}

      {/* Stage 3 — ARMED: bottom action bar */}
      {armed && (
        <div className="action-bar">
          <button className="action-btn" onClick={handleAdjustZone}>
            {t('adjustZone')}
          </button>
          <button className="action-btn action-danger" onClick={() => setConfirmRaiseOpen(true)}>
            {t('raiseAnchor')}
          </button>
        </div>
      )}

      {confirmRaiseOpen && (
        <ConfirmDialog
          title={t('raiseAnchorTitle')}
          message={t('raiseAnchorMessage')}
          confirmLabel={t('raiseAnchor')}
          cancelLabel={t('keepWatching')}
          danger
          onConfirm={handleRaiseAnchor}
          onCancel={() => setConfirmRaiseOpen(false)}
        />
      )}

      {confirmBackToCircleOpen && (
        <ConfirmDialog
          title={t('backToCircleTitle')}
          message={t('backToCircleMessage')}
          confirmLabel={t('zoneModeCircle')}
          cancelLabel={t('keepShape')}
          danger
          onConfirm={() => {
            setConfirmBackToCircleOpen(false);
            enterCircleMode();
          }}
          onCancel={() => setConfirmBackToCircleOpen(false)}
        />
      )}
    </div>
  );
}
