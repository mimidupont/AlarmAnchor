import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import './Map.css';

/* eslint-disable react-hooks/exhaustive-deps */

export default function Map({ zone, locations, sessionId, onZoneUpdate, role, onBack }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const drawnItems = useRef(null);
  const boatMarker = useRef(null);
  const zoneLayer = useRef(null);
  const hasCenteredOnce = useRef(false);
  const accuracyCircle = useRef(null);
  const [status, setStatus] = useState('Initializing GPS...');

  // Handle draw creation
  const handleDrawCreated = (e) => {
    const layer = e.layer;
    if (layer instanceof L.Polygon) {
      const coordinates = layer.getLatLngs()[0].map(latlng => [latlng.lat, latlng.lng]);
      onZoneUpdate(coordinates);
      setStatus(`Zone created with ${coordinates.length} points`);
    }
  };

  // Handle draw editing
  const handleDrawEdited = (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        const coordinates = layer.getLatLngs()[0].map(latlng => [latlng.lat, latlng.lng]);
        onZoneUpdate(coordinates);
        setStatus(`Zone updated with ${coordinates.length} points`);
      }
    });
  };

  // Handle draw deletion
  const handleDrawDeleted = () => {
    onZoneUpdate([]);
    setStatus('Zone deleted');
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
      attribution: '© OpenStreetMap contributors',
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

  // Update zone visualization when zone changes
  useEffect(() => {
    if (!map.current) return;

    // Clear existing zone layer
    if (zoneLayer.current) {
      map.current.removeLayer(zoneLayer.current);
      zoneLayer.current = null;
    }

    // Draw new zone if exists
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

  const currentDeviceLocation = Object.values(locations)[0];

  if (currentDeviceLocation) {
    const { latitude, longitude, accuracy } = currentDeviceLocation;

    if (boatMarker.current) {
      map.current.removeLayer(boatMarker.current);
    }

    boatMarker.current = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSI2IiBmaWxsPSIjRkY0NDQ0IiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPgo=',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
      })
    }).addTo(map.current)
      .bindPopup(`📍 Boat Position<br/>Accuracy: ${Math.round(accuracy)}m`);
      // NOTE: removed .openPopup() too — see below

    // Only force zoom on the very first fix; after that, just pan
    if (!hasCenteredOnce.current) {
      map.current.setView([latitude, longitude], 14);
      hasCenteredOnce.current = true;
    } else {
      map.current.panTo([latitude, longitude]);
    }

    // Draw accuracy circle
    L.circle([latitude, longitude], {
      radius: accuracy,
      color: '#3388ff',
      weight: 1,
      opacity: 0.3,
      fillOpacity: 0.05
    }).addTo(map.current);

    setStatus(`📍 Tracking at ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
  } else {
    setStatus('Waiting for GPS signal...');
  }
}, [locations]);

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
        .bindPopup(`📍 Boat Position<br/>Accuracy: ${Math.round(accuracy)}m`)
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

      setStatus(`📍 Tracking at ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
    } else {
      setStatus('Waiting for GPS signal...');
    }
  }, [locations]);

  return (
    <div className="map-container">
      <div className="map-header">
        <div className="header-left">
          <button onClick={onBack} className="back-btn">← Back</button>
          <h2>Anchor Monitor</h2>
        </div>
        <div className="session-badge">
          Session: <code>{sessionId}</code>
        </div>
      </div>

      <div className="status-bar">
        <span className="status-text">{status}</span>
      </div>

      <div ref={mapContainer} className="map" />

      <div className="instructions">
        <div className="instruction-item">
          <span className="icon">✏️</span>
          <span>Draw a polygon to define anchor zone</span>
        </div>
        <div className="instruction-item">
          <span className="icon">📍</span>
          <span>Red marker = boat position</span>
        </div>
        <div className="instruction-item">
          <span className="icon">🟠</span>
          <span>Orange outline = anchor zone</span>
        </div>
      </div>
    </div>
  );
}
