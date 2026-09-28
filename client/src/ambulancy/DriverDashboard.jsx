import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import io from 'socket.io-client';

// ── Haversine helper in meters ──
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DriverDashboard({ user, onLogout }) {
  const [currentLat, setCurrentLat] = useState(user?.location?.lat || null);
  const [currentLng, setCurrentLng] = useState(user?.location?.lng || null);
  const [locMode, setLocMode] = useState('gps');
  const [gpsStatusText, setGpsStatusText] = useState('📡 Acquiring GPS…');
  const [currentStatus, setCurrentStatus] = useState(user?.status || 'offline');
  const [currentHospital, setCurrentHospital] = useState(user?.hospital || '');
  const [selectedHospitalLatLng, setSelectedHospitalLatLng] = useState(null);
  const [hospitalsList, setHospitalsList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingHospitals, setLoadingHospitals] = useState(false);
  const [routeStats, setRouteStats] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [signalLocation, setSignalLocation] = useState(null);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const ambulanceMarker = useRef(null);
  const hospitalMarker = useRef(null);
  const signalMarker = useRef(null);
  const routeLayer = useRef(null);
  const socketRef = useRef(null);
  const gpsWatcher = useRef(null);
  const isPinMode = useRef(false);
  const autoGpsStarted = useRef(false);

  // Toast Helper
  const showToast = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3500);
  };

  // Custom Div Icons
  const ambulanceIcon = L.divIcon({
    html: `<div style="width:38px;height:38px;background:#E8000D;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.5);">🚑</div>`,
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

  const hospitalIcon = L.divIcon({
    html: `<div style="width:32px;height:32px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #E8000D;box-shadow:0 2px 10px rgba(0,0,0,.5);">🏥</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const trafficSignalIcon = L.divIcon({
    html: `<div style="width:36px;height:36px;background:#1565C0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid white;box-shadow:0 2px 14px rgba(21,101,192,0.8);animation:ambSigPulse 1.5s infinite;">🚦</div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  // Init Socket & Map — then auto-start GPS & load Traffic Signal Location
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes ambSigPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}`;
    document.head.appendChild(style);

    socketRef.current = io();
    socketRef.current.emit('driver_connected', { userId: user?.id });

    // Listen for real-time Traffic Unit location updates from server
    socketRef.current.on('signal_location_update', (loc) => {
      if (loc && loc.latitude && loc.longitude) {
        setSignalLocation(loc);
      }
    });

    // Fetch Traffic Unit Location automatically & poll periodically
    const fetchSignal = () => {
      fetch('/api/signal-location')
        .then((r) => r.json())
        .then((d) => {
          if (d.success && d.location) {
            setSignalLocation(d.location);
          }
        })
        .catch(() => {});
    };
    fetchSignal();
    const pollTimer = setInterval(fetchSignal, 3000);

    if (!mapInstance.current && mapRef.current) {
      const initialLat = user?.location?.lat || 13.04;
      const initialLng = user?.location?.lng || 80.20;
      const map = L.map(mapRef.current).setView([initialLat, initialLng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstance.current = map;

      map.on('click', (e) => {
        if (isPinMode.current) {
          setAmbulanceLocation(e.latlng.lat, e.latlng.lng, true);
        }
      });

      if (user?.location?.lat && user?.location?.lng) {
        ambulanceMarker.current = L.marker([user.location.lat, user.location.lng], { icon: ambulanceIcon })
          .bindPopup(`<b>${user.name}</b><br>${user.vehicle_no || ''}`)
          .addTo(map);
        loadLiveHospitals(user.location.lat, user.location.lng);
      }
    }

    // ── AUTO-START GPS on login ──────────────────────────────────────
    if (!autoGpsStarted.current) {
      autoGpsStarted.current = true;
      autoStartGPS();
    }

    return () => {
      clearInterval(pollTimer);
      if (gpsWatcher.current !== null) {
        navigator.geolocation.clearWatch(gpsWatcher.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Update Traffic Signal Marker on Map
  useEffect(() => {
    if (signalLocation && signalLocation.latitude && signalLocation.longitude && mapInstance.current) {
      const sLat = signalLocation.latitude;
      const sLng = signalLocation.longitude;

      if (!signalMarker.current) {
        signalMarker.current = L.marker([sLat, sLng], { icon: trafficSignalIcon })
          .bindPopup(`<b>🚦 Traffic Signal Unit (ESP32)</b><br>Active Traffic Clearance Anchor`)
          .addTo(mapInstance.current);
      } else {
        signalMarker.current.setLatLng([sLat, sLng]);
      }
    }
  }, [signalLocation]);

  // ── Auto-start GPS silently on login ──────────────────────────────
  const autoStartGPS = () => {
    if (!navigator.geolocation) {
      setGpsStatusText('⚠ GPS not supported by browser');
      return;
    }

    setGpsStatusText('📡 Acquiring GPS…');

    // First quick fix
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        setAmbulanceLocation(la, ln);
        setGpsStatusText(`📍 GPS Active ±${acc}m`);
        loadLiveHospitals(la, ln);

        // Share immediately to server and socket
        if (socketRef.current) {
          socketRef.current.emit('driver_location', { userId: user?.id, lat: la, lng: ln });
        }
        fetch('/api/driver/update-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user?.id, lat: la, lng: ln })
        }).catch(() => {});

        // Broadcast to GPS endpoint for Traffic Unit distance calculation
        fetch('/api/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleId: user?.vehicle_no || user?.username || 'AMB001',
            displayName: user?.name || 'Ambulance Unit',
            latitude: la,
            longitude: ln,
            speed: (pos.coords.speed || 0) * 3.6,
            accuracy: acc
          })
        }).catch(() => {});
      },
      (err) => {
        setGpsStatusText(`⚠ GPS: ${err.message} — click "Refresh Location" to retry`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    // Continuous background watch
    gpsWatcher.current = navigator.geolocation.watchPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        setAmbulanceLocation(la, ln);
        setGpsStatusText(`📍 GPS Active ±${acc}m`);
        if (socketRef.current) {
          socketRef.current.emit('driver_location', { userId: user?.id, lat: la, lng: ln });
        }
        loadLiveHospitals(la, ln);

        // Broadcast live GPS
        fetch('/api/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleId: user?.vehicle_no || user?.username || 'AMB001',
            displayName: user?.name || 'Ambulance Unit',
            latitude: la,
            longitude: ln,
            speed: (pos.coords.speed || 0) * 3.6,
            accuracy: acc
          })
        }).catch(() => {});
      },
      (err) => {
        setGpsStatusText(`⚠ GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  const setAmbulanceLocation = (lat, lng, fromPin = false) => {
    setCurrentLat(lat);
    setCurrentLng(lng);

    if (!ambulanceMarker.current && mapInstance.current) {
      ambulanceMarker.current = L.marker([lat, lng], { icon: ambulanceIcon })
        .bindPopup(`<b>${user?.name}</b><br>${user?.vehicle_no || ''}`)
        .addTo(mapInstance.current);
    } else if (ambulanceMarker.current) {
      ambulanceMarker.current.setLatLng([lat, lng]);
    }

    if (mapInstance.current) {
      mapInstance.current.setView([lat, lng], 15);
    }

    if (fromPin) {
      showToast('📌 Location pinned on map', 'info');
      loadLiveHospitals(lat, lng);
    }
  };

  const handleLocMode = (mode) => {
    setLocMode(mode);
    if (mode === 'gps') {
      isPinMode.current = false;
      if (mapInstance.current) {
        mapInstance.current.getContainer().style.cursor = 'grab';
      }
      autoStartGPS();
    } else {
      isPinMode.current = true;
      if (mapInstance.current) {
        mapInstance.current.getContainer().style.cursor = 'crosshair';
      }
      setGpsStatusText('');
      stopGPS();
    }
  };

  // Manual re-fetch GPS button
  const startGPS = () => {
    stopGPS();
    autoStartGPS();
  };

  const stopGPS = () => {
    if (gpsWatcher.current !== null) {
      navigator.geolocation.clearWatch(gpsWatcher.current);
      gpsWatcher.current = null;
    }
  };

  const shareLocation = async () => {
    if (!currentLat || !currentLng) {
      showToast('Set your location first', 'error');
      return;
    }

    try {
      await fetch('/api/driver/update-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, lat: currentLat, lng: currentLng })
      });

      if (socketRef.current) {
        socketRef.current.emit('driver_location', { userId: user?.id, lat: currentLat, lng: currentLng });
      }
      showToast('Location shared ✓', 'success');
    } catch (err) {
      showToast('Failed to share location', 'error');
    }
  };

  const loadLiveHospitals = async (lat, lng) => {
    setLoadingHospitals(true);
    try {
      const res = await fetch(`/api/hospitals/live?lat=${lat}&lng=${lng}&radius=6000`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setHospitalsList(data);
      }
    } catch (err) {
      showToast('Failed to load hospitals', 'error');
    } finally {
      setLoadingHospitals(false);
    }
  };

  const selectHospital = async (hosp) => {
    setCurrentHospital(hosp.name);
    setSelectedHospitalLatLng({ lat: hosp.lat, lng: hosp.lng });

    try {
      await fetch('/api/driver/update-hospital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, hospital: hosp.name })
      });

      if (hospitalMarker.current && mapInstance.current) {
        mapInstance.current.removeLayer(hospitalMarker.current);
      }

      if (mapInstance.current) {
        hospitalMarker.current = L.marker([hosp.lat, hosp.lng], { icon: hospitalIcon })
          .bindPopup(`<b>${hosp.name}</b>`)
          .addTo(mapInstance.current)
          .openPopup();
      }

      showToast(`Hospital set: ${hosp.name}`, 'success');
    } catch (err) {
      showToast('Failed to update hospital', 'error');
    }
  };

  const navigateToSelected = async () => {
    if (!currentLat || !currentLng) {
      showToast('Set your location first', 'error');
      return;
    }
    if (!selectedHospitalLatLng) {
      showToast('Select a hospital first', 'error');
      return;
    }

    showToast('🗺 Calculating shortest route…', 'info');

    const { lat: dLat, lng: dLng } = selectedHospitalLatLng;
    const url = `https://router.project-osrm.org/route/v1/driving/${currentLng},${currentLat};${dLng},${dLat}?overview=full&geometries=geojson`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes?.length) {
        showToast('No route found', 'error');
        return;
      }

      const route = data.routes[0];
      const dist = (route.distance / 1000).toFixed(1);
      const eta = Math.ceil(route.duration / 60);

      if (routeLayer.current && mapInstance.current) {
        mapInstance.current.removeLayer(routeLayer.current);
      }

      if (mapInstance.current) {
        routeLayer.current = L.geoJSON(route.geometry, {
          style: { color: '#E8000D', weight: 5, opacity: 0.9 }
        }).addTo(mapInstance.current);

        mapInstance.current.fitBounds(routeLayer.current.getBounds(), { padding: [40, 40] });
      }

      setRouteStats({ dist, eta });
      showToast(`Route: ${dist} km, ~${eta} min`, 'success');
    } catch (e) {
      showToast('Routing failed — check internet connection', 'error');
    }
  };

  const clearRoute = () => {
    if (routeLayer.current && mapInstance.current) {
      mapInstance.current.removeLayer(routeLayer.current);
      routeLayer.current = null;
    }
    if (hospitalMarker.current && mapInstance.current) {
      mapInstance.current.removeLayer(hospitalMarker.current);
      hospitalMarker.current = null;
    }
    setRouteStats(null);
    setCurrentHospital('');
    setSelectedHospitalLatLng(null);
  };

  const handleStatusChange = async (status) => {
    setCurrentStatus(status);

    try {
      await fetch('/api/driver/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, status })
      });

      if (socketRef.current) {
        socketRef.current.emit('driver_status', { userId: user?.id, status });
      }
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  // Calculate distance to Traffic Signal
  const distanceToSignalM = (currentLat && currentLng && signalLocation?.latitude)
    ? Math.round(haversineMeters(currentLat, currentLng, signalLocation.latitude, signalLocation.longitude))
    : null;

  const filteredHospitals = hospitalsList.filter((h) =>
    h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (h.address || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="ambulancy-scope">
      {/* Emergency flashing overlay */}
      {currentStatus === 'emergency' && <div className="amb-emergency-overlay"></div>}

      {/* Topbar */}
      <div className="amb-topbar">
        <div className="amb-topbar-brand">🚑 KAAPPAAN</div>
        <div className="amb-topbar-right">
          <div className="amb-driver-chip">{user?.name || 'Driver'}</div>
          <div className={`amb-status-badge amb-status-${currentStatus}`}>
            {currentStatus.toUpperCase()}
          </div>
          <button className="amb-btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="amb-driver-main">
        {/* Sidebar */}
        <div className="amb-sidebar">
          {/* Driver Info */}
          <div className="amb-card">
            <div className="amb-card-title">Driver Info</div>
            <div className="amb-info-row">
              <span className="amb-info-label">Name</span>
              <span className="amb-info-val">{user?.name}</span>
            </div>
            <div className="amb-info-row">
              <span className="amb-info-label">Vehicle</span>
              <span className="amb-info-val">{user?.vehicle_no || 'TN01AB1234'}</span>
            </div>
            <div className="amb-info-row">
              <span className="amb-info-label">Phone</span>
              <span className="amb-info-val">{user?.phone || '+91 98765 43210'}</span>
            </div>
            <div className="amb-info-row">
              <span className="amb-info-label">Hospital</span>
              <span className="amb-info-val">{currentHospital || '—'}</span>
            </div>
          </div>

          {/* 🚦 Traffic Signal Unit Live Status Card */}
          <div className="amb-card" style={{ border: '1px solid #1e3a5f', background: 'rgba(21,101,192,0.1)' }}>
            <div className="amb-card-title" style={{ color: '#42a5f5', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🚦</span> Traffic Light Signal (ESP32)
            </div>
            <div className="amb-info-row">
              <span className="amb-info-label">Signal Anchor</span>
              <span className="amb-info-val" style={{ color: signalLocation ? '#00e676' : '#ff9800' }}>
                {signalLocation ? '🟢 Active & Linked' : '🟡 Awaiting Laptop Signal'}
              </span>
            </div>
            {distanceToSignalM !== null && (
              <div className="amb-info-row">
                <span className="amb-info-label">Distance to Signal</span>
                <span className="amb-info-val" style={{ fontWeight: 700, color: distanceToSignalM <= 750 ? '#ff5252' : '#00e676' }}>
                  {distanceToSignalM < 1000 ? `${distanceToSignalM} m` : `${(distanceToSignalM / 1000).toFixed(2)} km`}
                  {distanceToSignalM <= 750 ? ' (⚡ GREEN CORRIDOR TRIGGERED)' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Location Card */}
          <div className="amb-card">
            <div className="amb-card-title">Ambulance Location</div>
            <div className="amb-loc-modes">
              <button
                type="button"
                className={`amb-loc-mode-btn ${locMode === 'gps' ? 'active' : ''}`}
                onClick={() => handleLocMode('gps')}
              >
                📡 GPS Auto
              </button>
              <button
                type="button"
                className={`amb-loc-mode-btn ${locMode === 'manual' ? 'active' : ''}`}
                onClick={() => handleLocMode('manual')}
              >
                📌 Pin on Map
              </button>
            </div>

            <div className="amb-loc-coords">
              <input
                type="number"
                value={currentLat ? Number(currentLat).toFixed(6) : ''}
                placeholder="Latitude"
                readOnly
              />
              <input
                type="number"
                value={currentLng ? Number(currentLng).toFixed(6) : ''}
                placeholder="Longitude"
                readOnly
              />
            </div>

            {locMode === 'gps' ? (
              <>
                <div className="amb-gps-status">{gpsStatusText}</div>
                <button type="button" className="amb-btn-gps" onClick={startGPS}>
                  📍 Refresh Location
                </button>
              </>
            ) : (
              <div className="amb-pin-hint">📌 Click anywhere on the map to pin your location</div>
            )}

            <button type="button" className="amb-btn-share-loc" onClick={shareLocation}>
              ⬆ Share Location
            </button>
          </div>

          {/* Destination Hospital */}
          <div className="amb-card">
            <div className="amb-card-title">Select Destination Hospital</div>
            <div className="amb-hospital-search-wrap">
              <input
                className="amb-hospital-search"
                placeholder="Search hospital…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="amb-hospital-search-icon">🔍</span>
            </div>

            <div className="amb-sort-note">
              {currentLat ? `✅ ${filteredHospitals.length} hospitals found nearby` : 'Share your location to find nearby hospitals'}
            </div>

            <div className="amb-hospital-list">
              {loadingHospitals ? (
                <div style={{ textAlign: 'center', color: 'var(--amb-muted)', padding: '16px 0', fontSize: '13px' }}>
                  Loading real hospitals nearby…
                </div>
              ) : filteredHospitals.length > 0 ? (
                filteredHospitals.map((h, i) => (
                  <div
                    key={i}
                    className={`amb-hospital-item ${h.name === currentHospital ? 'selected' : ''}`}
                    onClick={() => selectHospital(h)}
                  >
                    <div>
                      <div className="amb-hospital-name">{h.name}</div>
                      {h.address && <div className="amb-hospital-addr">{h.address}</div>}
                      <div className="amb-hospital-type">{h.type || 'Hospital'}</div>
                    </div>
                    <div className="amb-hospital-dist">
                      {h.distance_km !== undefined ? `${h.distance_km} km` : '—'}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--amb-muted)', padding: '16px 0', fontSize: '13px' }}>
                  {currentLat ? 'No hospitals found' : '📍 Set your location first'}
                </div>
              )}
            </div>

            {currentHospital && (
              <div className="amb-selected-hosp-banner">
                ✅ Selected: <span>{currentHospital}</span>
              </div>
            )}

            {currentHospital && (
              <button type="button" className="amb-btn-navigate" onClick={navigateToSelected}>
                🗺 Show Shortest Route
              </button>
            )}
          </div>

          {/* Route Stats Card */}
          {routeStats && (
            <div className="amb-card">
              <div className="amb-card-title">Shortest Route (OSRM)</div>
              <div className="amb-route-stats">
                <div className="amb-route-stat">
                  <div className="val">{routeStats.dist}</div>
                  <div className="lbl">Distance km</div>
                </div>
                <div className="amb-route-stat">
                  <div className="val">{routeStats.eta}</div>
                  <div className="lbl">ETA min</div>
                </div>
              </div>
              <button type="button" className="amb-btn-clear-route" onClick={clearRoute}>
                ✕ Clear Route
              </button>
            </div>
          )}

          {/* Status Control */}
          <div className="amb-card">
            <div className="amb-card-title">Status Control</div>
            <div className="amb-status-btns">
              <button
                type="button"
                className={`amb-status-btn ${currentStatus === 'offline' ? 'active-offline' : ''}`}
                onClick={() => handleStatusChange('offline')}
              >
                🔴 Offline
              </button>
              <button
                type="button"
                className={`amb-status-btn ${currentStatus === 'online' ? 'active-online' : ''}`}
                onClick={() => handleStatusChange('online')}
              >
                🟢 Online
              </button>
              <button
                type="button"
                className={`amb-status-btn ${currentStatus === 'emergency' ? 'active-emergency' : ''}`}
                onClick={() => handleStatusChange('emergency')}
              >
                🚨 Emergency
              </button>
            </div>
          </div>
        </div>

        {/* Map Container */}
        <div ref={mapRef} style={{ flex: 1, minHeight: '300px' }}></div>
      </div>

      {/* Toast Alert */}
      <div className={`amb-toast ${toast.type} ${toast.show ? 'show' : ''}`}>
        {toast.msg}
      </div>
    </div>
  );
}
