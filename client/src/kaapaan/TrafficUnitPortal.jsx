import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';

// ─── Haversine distance (meters) ───────────────────────────────────────────
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

const ALERT_THRESHOLD_M = 750;

export default function TrafficUnitPortal() {
  const [laptopLocation, setLaptopLocation] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('🔄 Acquiring laptop GPS…');
  const [ambulances, setAmbulances] = useState({});
  const [alertAmbulances, setAlertAmbulances] = useState([]);   // within 750m
  const [esp32Triggered, setEsp32Triggered] = useState(false);
  const [clock, setClock] = useState('');
  const [packetCount, setPacketCount] = useState(0);

  // ESP32 Hardware Config
  const [esp32Ip, setEsp32Ip] = useState('');
  const [hardwareStatus, setHardwareStatus] = useState('Checking...');
  const [isTestingHardware, setIsTestingHardware] = useState(false);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const laptopMarkerRef = useRef(null);
  const ambMarkersRef = useRef({});
  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
  const esp32StateRef = useRef(false);

  // ── Icons ──────────────────────────────────────────────────────────────────
  const trafficIcon = L.divIcon({
    html: `<div style="width:40px;height:40px;background:#1565C0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid white;box-shadow:0 2px 14px rgba(21,101,192,0.7);">🚦</div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  const makeAmbIcon = (isAlert) => L.divIcon({
    html: `<div style="width:36px;height:36px;background:${isAlert ? '#E8000D' : '#00897B'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.5);${isAlert ? 'animation:tuPulse 0.7s infinite;' : ''}">🚑</div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  // ── Init map & hardware check ───────────────────────────────────────────────
  useEffect(() => {
    // Inject pulse animation
    const style = document.createElement('style');
    style.textContent = `@keyframes tuPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}} @keyframes tuFlash{0%,100%{opacity:1}50%{opacity:0.4}}`;
    document.head.appendChild(style);

    // Clock
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);

    if (!mapInstance.current && mapRef.current) {
      const map = L.map(mapRef.current).setView([13.04, 80.20], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);
      mapInstance.current = map;
    }

    // Socket.IO
    socketRef.current = io();
    socketRef.current.on('kaapaan_gps', (gpsData) => {
      setPacketCount((p) => p + 1);
      setAmbulances((prev) => ({ ...prev, [gpsData.vehicleId]: gpsData }));
    });

    // Check ESP32 Config
    checkEsp32Config();

    // Start laptop GPS
    startLaptopGPS();

    return () => {
      clearInterval(timer);
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (socketRef.current) socketRef.current.disconnect();
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  const checkEsp32Config = async () => {
    try {
      const r = await fetch('/api/config/esp32-ip');
      const d = await r.json();
      if (d.ip) setEsp32Ip(d.ip);

      const statusResp = await fetch('/led/status');
      const s = await statusResp.json();
      setHardwareStatus(s.hardware === 'simulated' ? '⚠️ Simulated (Check IP)' : '🟢 Hardware Online');
    } catch {
      setHardwareStatus('❌ Connection Error');
    }
  };

  const handleSaveEsp32Ip = async () => {
    if (!esp32Ip.trim()) return;
    try {
      await fetch('/api/config/esp32-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: esp32Ip.trim() })
      });
      alert(`ESP32 IP set to: ${esp32Ip.trim()}`);
      checkEsp32Config();
    } catch {
      alert('Failed to update ESP32 IP');
    }
  };

  const handleTestHardware = async (on) => {
    setIsTestingHardware(true);
    try {
      if (on) {
        await fetch('/emergency/on', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            distance: 250,
            eta: '20s',
            etaSec: 20,
            vehicle: 'TEST-01',
            speed: 55,
            isAlert: true
          })
        });
      } else {
        await fetch('/emergency/off', { method: 'POST' });
      }
      checkEsp32Config();
    } catch (e) {
      alert('Error communicating with hardware: ' + e.message);
    } finally {
      setIsTestingHardware(false);
    }
  };

  // ── Laptop GPS watcher (Real Live GPS) ──────────────────────────────────────
  const startLaptopGPS = () => {
    if (!navigator.geolocation) {
      setGpsStatus('❌ Geolocation not supported by browser');
      return;
    }
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);

    setGpsStatus('🔄 Acquiring laptop GPS…');
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        setLaptopLocation({ lat, lng, accuracy: acc });
        setGpsStatus(`✅ GPS Active — ±${acc}m accuracy`);

        // Update map marker
        if (mapInstance.current) {
          if (!laptopMarkerRef.current) {
            laptopMarkerRef.current = L.marker([lat, lng], { icon: trafficIcon })
              .bindPopup('<b>🚦 Traffic Unit (This Laptop Anchor)</b>')
              .addTo(mapInstance.current);
            mapInstance.current.setView([lat, lng], 15);
          } else {
            laptopMarkerRef.current.setLatLng([lat, lng]);
          }
        }

        // Persist to server & broadcast
        try {
          await fetch('/api/signal-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, accuracy: acc })
          });
        } catch (_) {}
      },
      (err) => {
        setGpsStatus(`⚠️ GPS: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    );
  };

  // ── Proximity check: runs whenever ambulances OR laptop location changes ───
  useEffect(() => {
    if (!laptopLocation) return;

    const allAmbs = Object.values(ambulances).map((amb) => ({
      ...amb,
      distanceM: Math.round(haversineMeters(laptopLocation.lat, laptopLocation.lng, amb.latitude, amb.longitude)),
      etaSec: Math.round(haversineMeters(laptopLocation.lat, laptopLocation.lng, amb.latitude, amb.longitude) / 8)
    }));

    const nearby = allAmbs.filter((amb) => amb.distanceM <= ALERT_THRESHOLD_M);
    setAlertAmbulances(nearby);

    const shouldTrigger = nearby.length > 0;
    const closestAmb = allAmbs.sort((a, b) => a.distanceM - b.distanceM)[0];

    // Update ambulance map markers
    Object.values(ambulances).forEach((amb) => {
      const isAlert = nearby.some((n) => n.vehicleId === amb.vehicleId);
      const latlng = [amb.latitude, amb.longitude];
      if (mapInstance.current) {
        if (ambMarkersRef.current[amb.vehicleId]) {
          ambMarkersRef.current[amb.vehicleId]
            .setLatLng(latlng)
            .setIcon(makeAmbIcon(isAlert));
        } else {
          ambMarkersRef.current[amb.vehicleId] = L.marker(latlng, { icon: makeAmbIcon(isAlert) })
            .bindPopup(`<b>${amb.displayName || amb.vehicleId}</b>`)
            .addTo(mapInstance.current);
        }
      }
    });

    // Send real-time distance & telemetry to ESP32 LCD
    if (closestAmb) {
      if (shouldTrigger) {
        setEsp32Triggered(true);
        esp32StateRef.current = true;
      } else {
        setEsp32Triggered(false);
        esp32StateRef.current = false;
      }

      fetch('/emergency/on', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distance: closestAmb.distanceM,
          eta: formatETA(closestAmb.etaSec),
          etaSec: closestAmb.etaSec,
          vehicle: closestAmb.vehicleId || closestAmb.displayName || 'AMB001',
          speed: Math.round(closestAmb.speed || 40),
          isAlert: shouldTrigger
        })
      }).catch(() => {});
    } else if (esp32StateRef.current) {
      esp32StateRef.current = false;
      setEsp32Triggered(false);
      fetch('/emergency/off', { method: 'POST' }).catch(() => {});
    }
  }, [ambulances, laptopLocation]);

  const formatETA = (sec) => {
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0e1a', color: '#e0e6f0', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

      {/* ── Top Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#0f1628', borderBottom: '2px solid #1e3a5f', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '26px' }}>🚦</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '18px', letterSpacing: '1px', color: '#42a5f5' }}>TRAFFIC UNIT</div>
            <div style={{ fontSize: '11px', color: '#607d8b', letterSpacing: '0.5px' }}>ESP32 + LCD + LED — Physical Signal Anchor</div>
          </div>
          <span style={{
            background: esp32Triggered ? '#b71c1c' : '#1b5e20',
            color: '#fff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '20px',
            letterSpacing: '0.5px',
            animation: esp32Triggered ? 'tuFlash 1s infinite' : 'none'
          }}>
            {esp32Triggered ? '🚨 ESP32 ALERT ACTIVE (<= 750m)' : '🟢 ESP32 STANDBY'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px', color: '#90a4ae' }}>
          <span>📦 {packetCount} pkts</span>
          <span>⏰ {clock}</span>
          <button
            onClick={startLaptopGPS}
            style={{ background: '#1565C0', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
          >
            📍 Re-read GPS
          </button>
        </div>
      </div>

      {/* ── Hardware & GPS Control Strip ── */}
      <div style={{ background: '#101828', padding: '8px 24px', borderBottom: '1px solid #1e3a5f', fontSize: '12.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', flexShrink: 0 }}>
        
        {/* GPS location status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#64b5f6', fontWeight: 600 }}>📍 Laptop GPS:</span>
          <span style={{ color: '#b0bec5' }}>{gpsStatus}</span>
          {laptopLocation && (
            <span style={{ color: '#4caf50', fontFamily: 'monospace', fontWeight: 700 }}>
              [{laptopLocation.lat.toFixed(6)}, {laptopLocation.lng.toFixed(6)}]
            </span>
          )}
        </div>

        {/* ESP32 IP Config & Test Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#ffb74d', fontWeight: 600 }}>⚡ ESP32 IP:</span>
          <input
            type="text"
            value={esp32Ip}
            onChange={(e) => setEsp32Ip(e.target.value)}
            placeholder="e.g. 10.87.129.118"
            style={{
              background: '#0a0e1a',
              border: '1px solid #1e3a5f',
              borderRadius: '4px',
              color: '#fff',
              padding: '4px 8px',
              fontSize: '12px',
              width: '130px',
              fontFamily: 'monospace'
            }}
          />
          <button
            type="button"
            onClick={handleSaveEsp32Ip}
            style={{ background: '#37474f', color: '#eceff1', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
          >
            💾 Set IP
          </button>
          <button
            type="button"
            onClick={() => handleTestHardware(true)}
            disabled={isTestingHardware}
            style={{ background: '#d32f2f', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 700 }}
            title="Sends test emergency ON signal to ESP32"
          >
            🚨 Test ON
          </button>
          <button
            type="button"
            onClick={() => handleTestHardware(false)}
            disabled={isTestingHardware}
            style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 700 }}
            title="Sends standby OFF signal to ESP32"
          >
            🟢 Test OFF
          </button>
        </div>
      </div>

      {/* ── Alert Panel (750m breach) ── */}
      {alertAmbulances.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #7f0000, #b71c1c)',
          border: '2px solid #ef5350',
          margin: '12px 24px',
          borderRadius: '10px',
          padding: '14px 20px',
          flexShrink: 0,
          animation: 'tuFlash 1.2s infinite'
        }}>
          <div style={{ fontWeight: 800, fontSize: '16px', color: '#fff', marginBottom: '10px', letterSpacing: '1px' }}>
            🚨 AMBULANCE APPROACHING (≤ 750m) — GREEN CLEARANCE ACTIVE!
          </div>
          {alertAmbulances.map((amb) => (
            <div key={amb.vehicleId} style={{ display: 'flex', gap: '24px', color: '#ffcdd2', fontSize: '13px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span>🚑 <strong style={{ color: '#fff' }}>{amb.displayName || amb.vehicleId}</strong></span>
              <span>📏 Distance: <strong style={{ color: '#ff8a80' }}>{amb.distanceM} m</strong></span>
              <span>⏱ ETA: <strong style={{ color: '#ff8a80' }}>{formatETA(amb.etaSec)}</strong></span>
              <span style={{ color: '#ef9a9a' }}>⚡ HARDWARE LCD + LED TRIGGERED AUTOMATICALLY</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Main Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Panel: Live Ambulance List ── */}
        <div style={{ width: '320px', flexShrink: 0, background: '#0f1628', borderRight: '1px solid #1e3a5f', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e3a5f', fontWeight: 700, fontSize: '13px', color: '#42a5f5', letterSpacing: '0.5px' }}>
            🚑 LIVE AMBULANCE UNITS ({Object.keys(ambulances).length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {Object.values(ambulances).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#455a64', padding: '40px 10px', fontSize: '13px' }}>
                <div style={{ fontSize: '30px', marginBottom: '10px' }}>📡</div>
                No ambulance signals yet.<br />Driver apps will appear here once online.
              </div>
            ) : (
              Object.values(ambulances).map((amb) => {
                const dist = laptopLocation
                  ? Math.round(haversineMeters(laptopLocation.lat, laptopLocation.lng, amb.latitude, amb.longitude))
                  : null;
                const isAlert = dist !== null && dist <= ALERT_THRESHOLD_M;
                return (
                  <div
                    key={amb.vehicleId}
                    style={{
                      background: isAlert ? 'rgba(183,28,28,0.25)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${isAlert ? '#ef5350' : '#1e3a5f'}`,
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '8px'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', color: isAlert ? '#ef9a9a' : '#e0e6f0', marginBottom: '6px' }}>
                      {isAlert ? '🚨' : '🚑'} {amb.displayName || amb.vehicleId}
                    </div>
                    <div style={{ fontSize: '11px', color: '#78909c', lineHeight: '1.7' }}>
                      <div>ID: <span style={{ color: '#b0bec5' }}>{amb.vehicleId}</span></div>
                      <div>Coords: <span style={{ color: '#b0bec5', fontFamily: 'monospace' }}>{Number(amb.latitude).toFixed(5)}, {Number(amb.longitude).toFixed(5)}</span></div>
                      <div>Speed: <span style={{ color: '#b0bec5' }}>{Math.round(amb.speed || 0)} km/h</span></div>
                      {dist !== null && (
                        <div>Distance: <span style={{ color: isAlert ? '#ef5350' : '#4caf50', fontWeight: 700 }}>{dist} m {isAlert ? '⚠️ WITHIN 750m' : ''}</span></div>
                      )}
                      <div>Last seen: <span style={{ color: '#b0bec5' }}>{new Date(amb.timestamp).toLocaleTimeString()}</span></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Status Footer */}
          <div style={{ padding: '10px 18px', borderTop: '1px solid #1e3a5f', fontSize: '11px', color: '#455a64' }}>
            Threshold: <strong style={{ color: '#42a5f5' }}>750 m</strong> &nbsp;|&nbsp; ESP32 auto-triggers on breach
          </div>
        </div>

        {/* ── Right: Map ── */}
        <div ref={mapRef} style={{ flex: 1 }} />
      </div>
    </div>
  );
}
