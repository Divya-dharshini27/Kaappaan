import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

export default function KaapaanMap({
  vehicles,
  signalLocation,
  routeGeometry,
  isPickingSignal,
  onSignalPicked
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const signalMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);

  const getVehicleIcon = (vehicleId) => {
    let color = '#ef4444';
    if (vehicleId === 'AMB002') color = '#3b82f6';
    if (vehicleId === 'AMB003') color = '#10b981';

    return L.divIcon({
      html: `<div style="
        width: 36px; height: 36px; background: ${color}; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 18px;
        border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        animation: kaapaanPulse 1.2s infinite;
      ">🚑</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  };

  const getSignalIcon = () => {
    return L.divIcon({
      html: `<div style="
        width: 40px; height: 40px; background: #1565c0; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 20px;
        border: 3px solid #64b5f6; box-shadow: 0 0 16px rgba(33, 150, 243, 0.6);
      ">🚦</div>`,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  };

  useEffect(() => {
    if (!mapInstanceRef.current && mapContainerRef.current) {
      const map = L.map(mapContainerRef.current).setView([13.0827, 80.2707], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;

      map.on('click', (e) => {
        if (isPickingSignal) {
          onSignalPicked({ latitude: e.latlng.lat, longitude: e.latlng.lng, accuracy: 5 });
        }
      });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update cursor on picking signal mode
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.getContainer().style.cursor = isPickingSignal ? 'crosshair' : 'grab';
    }
  }, [isPickingSignal]);

  // Update Signal Marker
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (signalLocation && signalLocation.latitude && signalLocation.longitude) {
      const { latitude, longitude } = signalLocation;
      if (signalMarkerRef.current) {
        signalMarkerRef.current.setLatLng([latitude, longitude]);
      } else {
        signalMarkerRef.current = L.marker([latitude, longitude], { icon: getSignalIcon() })
          .bindPopup('<b>🚦 Physical Traffic Signal</b><br>Laptop + ESP32 Control Anchor')
          .addTo(mapInstanceRef.current);
      }
    } else if (signalMarkerRef.current) {
      mapInstanceRef.current.removeLayer(signalMarkerRef.current);
      signalMarkerRef.current = null;
    }
  }, [signalLocation]);

  // Update Vehicle Markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const currentIds = Object.keys(vehicles);

    // Remove markers that are no longer active
    Object.keys(markersRef.current).forEach((vId) => {
      if (!vehicles[vId]) {
        mapInstanceRef.current.removeLayer(markersRef.current[vId]);
        delete markersRef.current[vId];
      }
    });

    // Update / add active markers
    currentIds.forEach((vId) => {
      const v = vehicles[vId];
      if (v.latitude && v.longitude) {
        if (markersRef.current[vId]) {
          markersRef.current[vId].setLatLng([v.latitude, v.longitude]);
        } else {
          markersRef.current[vId] = L.marker([v.latitude, v.longitude], {
            icon: getVehicleIcon(vId)
          })
            .bindPopup(`<b>🚑 ${v.displayName || vId}</b><br>Speed: ${Math.round(v.speed || 0)} km/h`)
            .addTo(mapInstanceRef.current);
        }
      }
    });
  }, [vehicles]);

  // Update OSRM Route Layer
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (routeGeometry) {
      if (routeLayerRef.current) {
        mapInstanceRef.current.removeLayer(routeLayerRef.current);
      }

      routeLayerRef.current = L.geoJSON(routeGeometry, {
        style: { color: '#0284c7', weight: 6, opacity: 0.85 }
      }).addTo(mapInstanceRef.current);

      mapInstanceRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
    } else if (routeLayerRef.current) {
      mapInstanceRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
  }, [routeGeometry]);

  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;

    const bounds = L.latLngBounds([]);
    if (signalLocation && signalLocation.latitude) {
      bounds.extend([signalLocation.latitude, signalLocation.longitude]);
    }
    Object.values(vehicles).forEach((v) => {
      if (v.latitude && v.longitude) bounds.extend([v.latitude, v.longitude]);
    });

    if (bounds.isValid()) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [60, 60] });
    } else {
      mapInstanceRef.current.setView([13.0827, 80.2707], 13);
    }
  };

  return (
    <section className="card map-card">
      <div className="map-card-header">
        <div className="map-title-wrap">
          <h2>📍 Live Telemetry Map</h2>
          <span className="map-sub">Real-time GPS coordinates & road paths</span>
        </div>
        <div className="map-actions">
          <button type="button" className="btn-xs btn-primary" onClick={handleRecenter}>
            🎯 Recenter & Fit
          </button>
        </div>
      </div>

      <div ref={mapContainerRef} style={{ height: '480px', width: '100%', borderRadius: '10px' }}></div>
    </section>
  );
}
