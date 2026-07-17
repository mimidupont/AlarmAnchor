import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './RemoteMonitor.css';

export default function RemoteMonitor({ zone, locations, sessionId, onBack }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const boatMarker = useRef(null);
  const zoneLayer = useRef(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Prevent double initialization
    if (map.current) return;

    map.current = L.map(mapContainer.current).setView([48.8566, 2.3522], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map.current);

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
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

    if (currentLocation) {
      const { latitude, longitude, accuracy } = currentLocation;

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
        .bindPopup(`📍 Boat Position<br/>Accuracy: ${Math.round(accuracy)}m`)
        .openPopup();

      map.current.setView([latitude, longitude], 14);

      L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#3388ff',
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.05
      }).addTo(map.current);
    }
  }, [locations]);

  const boatLocation = locations ? Object.values(locations)[0] : null;

  return (
    <div className="remote-monitor">
      <div className="monitor-header">
        <div className="header-left">
          <button onClick={onBack} className="back-btn">← Back</button>
          <h2>Remote Monitor</h2>
        </div>
        <div className="session-badge">
          Session: <code>{sessionId}</code>
        </div>
      </div>

      {boatLocation ? (
        <div className="boat-info">
          <div className="info-item">
            <span className="label">Position:</span>
            <span className="value">
              {boatLocation.latitude.toFixed(4)}°, {boatLocation.longitude.toFixed(4)}°
            </span>
          </div>
          <div className="info-item">
            <span className="label">Accuracy:</span>
            <span className="value">{Math.round(boatLocation.accuracy)}m</span>
          </div>
          <div className="info-item">
            <span className="label">Last Update:</span>
            <span className="value">
              {new Date(boatLocation.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ) : (
        <div className="boat-info">
          <p className="waiting">Waiting for boat position...</p>
        </div>
      )}

      <div ref={mapContainer} className="map" />

      <div className="legend">
        <div className="legend-item">
          <span className="legend-color" style={{ background: '#ff4444' }}></span>
          Boat Position
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: 'rgba(255, 120, 0, 0.15)', border: '2px dashed #ff7800' }}></span>
          Anchor Zone
        </div>
      </div>
    </div>
  );
}
