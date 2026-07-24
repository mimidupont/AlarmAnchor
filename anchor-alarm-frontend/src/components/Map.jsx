import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
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

export default function Map({ zone, locations, sessionId, onZoneUpdate, role, onBack }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const drawnItems = useRef(null);
  const boatMarker = useRef(null);
  const [status, setStatus] = useState('Initialisation du GPS...');

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
      setStatus(`Zone créée avec ${coordinates.length} points`);
    }
  };

  // Handle draw editing
  const handleDrawEdited = (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        const coordinates = layer.getLatLngs()[0].map(latlng => [latlng.lat, latlng.lng]);
        onZoneUpdate(coordinates);
        setStatus(`Zone mise à jour avec ${coordinates.length} points`);
      }
    });
  };

  // Handle draw deletion
  const handleDrawDeleted = () => {
    onZoneUpdate([]);
    setStatus('Zone supprimée');
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
          showArea: true,
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

    return () => {
      if (map.current) {
        map.current.off('draw:created', handleDrawCreated);
        map.current.off('draw:edited', handleDrawEdited);
        map.current.off('draw:deleted', handleDrawDeleted);
        map.current.remove();
        map.current = null;
      }
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

    if (currentDeviceLocation) {
      const { latitude, longitude, accuracy } = currentDeviceLocation;

      // Remove old marker
      if (boatMarker.current) {
        map.current.removeLayer(boatMarker.current);
      }

      // Add boat marker
      boatMarker.current = L.marker([latitude, longitude], {
        icon: L.icon({
          iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSI2IiBmaWxsPSIjRkY0NDQ0IiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPgo=',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16]
        })
      }).addTo(map.current)
        .bindPopup(`📍 Position du bateau<br/>Précision : ${Math.round(accuracy)} m`)
        .openPopup();

      // Center map on boat
      map.current.setView([latitude, longitude], 14);

      // Draw accuracy circle
      L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#3388ff',
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.05
      }).addTo(map.current);

      setStatus(`📍 Suivi en cours : ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
    } else {
      setStatus('En attente du signal GPS...');
    }
  }, [locations]);

  return (
    <div className="map-container">
      <div className="map-header">
        <div className="header-left">
          <button onClick={onBack} className="back-btn">← Retour</button>
          <h2>Suivi du mouillage</h2>
        </div>
        <div className="session-badge">
          Session : <code>{sessionId}</code>
        </div>
      </div>

      <div className="status-bar">
        <span className="status-text">{status}</span>
      </div>

      <div ref={mapContainer} className="map" />

      <div className="instructions">
        <div className="instruction-item">
          <span className="icon">✏️</span>
          <span>Dessinez un polygone pour définir la zone de mouillage</span>
        </div>
        <div className="instruction-item">
          <span className="icon">📍</span>
          <span>Repère rouge = position du bateau</span>
        </div>
        <div className="instruction-item">
          <span className="icon">🟠</span>
          <span>Contour orange = zone de mouillage</span>
        </div>
      </div>
    </div>
  );
}
