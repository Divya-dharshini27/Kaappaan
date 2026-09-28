import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import io from 'socket.io-client';

// ─── Haversine distance in meters ──────────────────────────────────────────
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

const PRESET_INSTRUCTIONS = [
  { label: '🚧 Clear Traffic Now', text: 'Clear all traffic immediately — ambulance en route!' },
  { label: '🚛 Watch for Large Vehicles', text: 'Look for large vehicles blocking the route — coordinate clearance.' },
  { label: '🛑 Block Side Roads', text: 'Block side roads at the junction — do not allow entry.' },
  { label: '🔊 Activate Siren Protocol', text: 'Activate siren protocol — all units alert the public.' },
  { label: '📍 Hold at Junction', text: 'Hold position at junction — ambulance arriving shortly.' },
  { label: '✅ Situation Clear', text: 'Situation resolved — resume normal traffic flow.' }
];

export default function AdminDashboard({ user, onLogout }) {
  const [drivers, setDrivers] = useState({});
  const [stats, setStats] = useState({ total: 0, active: 0, emergency: 0 });
  const [currentAlert, setCurrentAlert] = useState(null);
  const [forwarded, setForwarded] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [clock, setClock] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [instructionLog, setInstructionLog] = useState([]);
  const [signalLocation, setSignalLocation] = useState({ latitude: 13.0827, longitude: 80.2707 });

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef({});
  const signalMarkerRef = useRef(null);
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const logEndRef = useRef(null);
  const lastDirectiveRef = useRef('');

  const makeIcon = (status) => {
    const color = status === 'emergency' ? '#E8000D' : status === 'online' ? '#00e676' : '#555555';
    const emoji = status === 'emergency' ? '🚨' : '🚑';
    return L.divIcon({
      html: `<div style="
        width:38px;height:38px;background:${color};border-radius:50%;
        display:flex;align-items:center;justify-content:center;font-size:18px;
        border:3px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.6);
        ${status === 'emergency' ? 'animation:ambPulseMarker 0.7s infinite;' : ''}
      ">${emoji}</div>`,
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
  };

  const trafficSignalIcon = L.divIcon({
    html: `<div style="
      width:34px;height:34px;background:#1565C0;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:18px;
      border:3px solid white;box-shadow:0 2px 10px rgba(21,101,192,0.8);
    ">🚦</div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes ambPulseMarker{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
      @keyframes ambFlashDirective{0%,100%{border-color:#ef5350;box-shadow:0 0 12px rgba(239,83,80,0.4)}50%{border-color:#b71c1c;box-shadow:0 0 2px rgba(239,83,80,0.1)}}
    `;
    document.head.appendChild(style);

    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);

    // Fetch live Traffic Unit signal location
    fetch('/api/signal-location')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.location) {
          setSignalLocation(d.location);
        }
      })
      .catch(() => {});

    if (!mapInstance.current && mapRef.current) {
      const map = L.map(mapRef.current).setView([13.0827, 80.2707], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);
      mapInstance.current = map;

      // Add Signal Location Marker
      signalMarkerRef.current = L.marker([13.0827, 80.2707], { icon: trafficSignalIcon })
        .bindPopup('<b>🚦 Active Traffic Unit Signal Anchor</b>')
        .addTo(map);
    }

    socketRef.current = io();
    socketRef.current.emit('join_admin');

    socketRef.current.on('all_drivers', (driversList) => {
      const driverMap = {};
      driversList.forEach((d) => { driverMap[d.id] = d; });
      setDrivers(driverMap);
    });

    socketRef.current.on('driver_update', (d) => {
      setDrivers((prev) => ({ ...prev, [d.id]: { ...(prev[d.id] || {}), ...d } }));
    });

    socketRef.current.on('emergency_alert', (d) => {
      if (audioRef.current) audioRef.current.play().catch(() => {});
      setCurrentAlert(d);
      setForwarded(false);
      if (d.lat && d.lng && mapInstance.current) {
        mapInstance.current.setView([d.lat, d.lng], 15);
      }
    });

    return () => {
      clearInterval(timer);
      if (socketRef.current) socketRef.current.disconnect();
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  // Update signal marker if location changes
  useEffect(() => {
    if (signalLocation && signalMarkerRef.current) {
      signalMarkerRef.current.setLatLng([signalLocation.latitude, signalLocation.longitude]);
    }
  }, [signalLocation]);

  // Scroll instruction log to bottom on new entry
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [instructionLog]);

  useEffect(() => {
    const all = Object.values(drivers);
    setStats({
      total: all.length,
      active: all.filter((d) => d.status === 'online').length,
      emergency: all.filter((d) => d.status === 'emergency').length
    });

    all.forEach((d) => {
      const lat = d.lat || d.location?.lat;
      const lng = d.lng || d.location?.lng;
      if (lat && lng && mapInstance.current) {
        if (markersRef.current[d.id]) {
          markersRef.current[d.id].setLatLng([lat, lng]).setIcon(makeIcon(d.status));
        } else {
          markersRef.current[d.id] = L.marker([lat, lng], { icon: makeIcon(d.status) })
            .bindPopup(`<b>${d.name}</b><br>${d.vehicle || d.vehicle_no || ''}<br>${d.hospital || ''}`)
            .addTo(mapInstance.current);
        }
      }
    });
  }, [drivers]);

  // ─── Real-Time Telemetry & System Managing Directive Calculation ─────────
  const systemManagingDirective = useMemo(() => {
    const allDrivers = Object.values(drivers);
    // Prioritize emergency driver, or closest online driver
    const emergencyDrivers = allDrivers.filter((d) => d.status === 'emergency');
    const targetDriver = emergencyDrivers[0] || allDrivers.find((d) => d.status === 'online');

    if (!targetDriver) {
      return {
        hasTarget: false,
        level: 'idle',
        title: 'System Standby',
        text: 'All traffic corridors normal. Awaiting emergency beacon broadcast.',
        distanceM: null,
        etaSec: null,
        driver: null
      };
    }

    const dLat = targetDriver.lat || targetDriver.location?.lat;
    const dLng = targetDriver.lng || targetDriver.location?.lng;

    if (!dLat || !dLng || !signalLocation?.latitude) {
      return {
        hasTarget: true,
        level: targetDriver.status === 'emergency' ? 'warning' : 'info',
        title: targetDriver.status === 'emergency' ? 'Emergency Beacon Received' : 'Monitoring Unit',
        text: `Vehicle ${targetDriver.vehicle || targetDriver.vehicle_no} active. Acquiring satellite triangulation...`,
        distanceM: null,
        etaSec: null,
        driver: targetDriver
      };
    }

    const distM = Math.round(haversineMeters(signalLocation.latitude, signalLocation.longitude, dLat, dLng));
    const isEmerg = targetDriver.status === 'emergency';
    const etaSec = Math.max(10, Math.round(distM / 11)); // ~40 km/h average emergency speed

    let level = 'info';
    let title = 'Corridor Active';
    let text = `Ambulance is ${(distM / 1000).toFixed(1)}km away. Prepare corridor monitoring.`;

    if (isEmerg) {
      if (distM <= 300) {
        level = 'critical';
        title = '🚨 CRITICAL: CLEAR THE WAY NOW!';
        text = `Ambulance ${targetDriver.vehicle || targetDriver.vehicle_no} is ${distM}m away (ETA ~${etaSec}s). HALT ALL CROSS TRAFFIC IMMEDIATELY!`;
      } else if (distM <= 750) {
        level = 'imminent';
        title = '⚠️ IMMINENT: CLEAR TRAFFIC AT JUNCTION';
        text = `Ambulance ${targetDriver.vehicle || targetDriver.vehicle_no} is ${distM}m away (ETA ~${Math.ceil(etaSec / 60)} min). Open primary green corridor and direct civilian vehicles to the curb!`;
      } else if (distM <= 2000) {
        level = 'warning';
        title = '📢 APPROACHING EMERGENCY VEHICLE';
        text = `Ambulance ${targetDriver.vehicle || targetDriver.vehicle_no} heading to ${targetDriver.hospital || 'Hospital'}. Distance: ${(distM / 1000).toFixed(1)}km (ETA ~${Math.ceil(etaSec / 60)} min). Clear large vehicles from lane.`;
      } else {
        level = 'enroute';
        title = '🚑 EMERGENCY EN ROUTE';
        text = `Ambulance ${targetDriver.vehicle || targetDriver.vehicle_no} is en route (${(distM / 1000).toFixed(1)}km out). Plan ahead for signal priority.`;
      }
    }

    return {
      hasTarget: true,
      level,
      title,
      text,
      distanceM: distM,
      etaSec,
      driver: targetDriver
    };
  }, [drivers, signalLocation]);

  // Automatically log directive changes to the system stream
  useEffect(() => {
    if (systemManagingDirective.hasTarget && systemManagingDirective.text !== lastDirectiveRef.current) {
      lastDirectiveRef.current = systemManagingDirective.text;
      const timestamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setInstructionLog((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: 'SYSTEM',
          level: systemManagingDirective.level,
          title: systemManagingDirective.title,
          text: systemManagingDirective.text,
          timestamp
        }
      ]);
    }
  }, [systemManagingDirective]);

  const focusDriver = (d) => {
    const lat = d.lat || d.location?.lat;
    const lng = d.lng || d.location?.lng;
    if (lat && lng && mapInstance.current) {
      mapInstance.current.setView([lat, lng], 15);
      if (markersRef.current[d.id]) markersRef.current[d.id].openPopup();
    }
  };

  const forwardToControlRoom = () => {
    if (!currentAlert || !socketRef.current) return;
    socketRef.current.emit('forward_to_controlroom', {
      name: currentAlert.name,
      vehicle: currentAlert.vehicle || currentAlert.vehicle_no,
      lat: currentAlert.lat,
      lng: currentAlert.lng,
      forwarded_by: user?.name || 'Police'
    });
    setForwarded(true);
    setToastMsg('✅ Emergency alert dispatched to Control Room');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3500);
    setTimeout(() => dismissAlert(), 2000);
  };

  const dismissAlert = () => {
    setCurrentAlert(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
  };

  const sendInstruction = (text) => {
    if (!text.trim()) return;
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { sender: 'POLICE', text: text.trim(), timestamp, id: Date.now() };
    setInstructionLog((prev) => [...prev, entry]);
    if (socketRef.current) {
      socketRef.current.emit('police_instruction', entry);
    }
    setCustomInstruction('');
  };

  const relaySystemDirective = () => {
    if (!systemManagingDirective.text) return;
    sendInstruction(`[AUTO DIRECTIVE] ${systemManagingDirective.title}: ${systemManagingDirective.text}`);
    setToastMsg('📡 System managing directive broadcasted to all units');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  return (
    <div className="ambulancy-scope">
      <audio ref={audioRef} src="/sounds/alert.mp3" preload="auto"></audio>

      {/* Emergency Alert Popup */}
      {currentAlert && (
        <div className="amb-alert-popup">
          <div className="amb-alert-header">
            <span className="amb-alert-icon">🚨</span>
            <div className="amb-alert-title">EMERGENCY ALERT</div>
          </div>
          <div className="amb-alert-body">
            <strong>{currentAlert.name}</strong> ({currentAlert.vehicle || currentAlert.vehicle_no}) has activated emergency mode.<br />
            {currentAlert.lat
              ? `Location: ${Number(currentAlert.lat).toFixed(4)}, ${Number(currentAlert.lng).toFixed(4)}`
              : 'Location unavailable'}
          </div>
          <div className="amb-alert-actions">
            <button
              type="button"
              className={`amb-btn-forward ${forwarded ? 'forwarded' : ''}`}
              onClick={forwardToControlRoom}
              disabled={forwarded}
            >
              {forwarded ? '✅ Dispatched!' : '📡 Dispatch Alert to Control Room'}
            </button>
            <button type="button" className="amb-alert-close" onClick={dismissAlert}>Dismiss</button>
          </div>
        </div>
      )}

      {showToast && (
        <div className="amb-toast show success" style={{ background: '#00e676', color: '#000', fontWeight: 700 }}>
          {toastMsg || '✅ Action completed'}
        </div>
      )}

      {/* Topbar */}
      <div className="amb-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="amb-topbar-brand">🚑 KAAPPAAN</div>
          <div className="amb-topbar-badge" style={{ background: '#1565C0' }}>👮 Police Command</div>
        </div>
        <div className="amb-topbar-right">
          <div className="amb-topbar-time">{clock}</div>
          <button className="amb-btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

        {/* Left Panel */}
        <div className="amb-admin-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '380px', flexShrink: 0 }}>

          {/* Stats Bar */}
          <div className="amb-stats-bar">
            <div className="amb-stat-cell">
              <div className="amb-stat-val total">{stats.total}</div>
              <div className="amb-stat-lbl">Total</div>
            </div>
            <div className="amb-stat-cell">
              <div className="amb-stat-val active">{stats.active}</div>
              <div className="amb-stat-lbl">Active</div>
            </div>
            <div className="amb-stat-cell">
              <div className="amb-stat-val emergency">{stats.emergency}</div>
              <div className="amb-stat-lbl">Emergency</div>
            </div>
          </div>

          {/* ── Real-Time System Managing Directive Card ── */}
          <div style={{
            margin: '8px 10px',
            background: systemManagingDirective.level === 'critical'
              ? 'linear-gradient(135deg, rgba(183,28,28,0.4), rgba(239,83,80,0.2))'
              : systemManagingDirective.level === 'imminent' || systemManagingDirective.level === 'warning'
              ? 'linear-gradient(135deg, rgba(230,81,0,0.35), rgba(255,152,0,0.15))'
              : 'rgba(21,101,192,0.15)',
            border: `2px solid ${
              systemManagingDirective.level === 'critical' ? '#ef5350' :
              systemManagingDirective.level === 'imminent' ? '#ff9800' :
              systemManagingDirective.level === 'warning' ? '#fbc02d' : '#1e3a5f'
            }`,
            borderRadius: '10px',
            padding: '12px',
            flexShrink: 0,
            animation: systemManagingDirective.level === 'critical' || systemManagingDirective.level === 'imminent' ? 'ambFlashDirective 1.5s infinite' : 'none'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 800,
                color: systemManagingDirective.level === 'critical' ? '#ff8a80' : systemManagingDirective.level === 'imminent' ? '#ffb74d' : '#64b5f6',
                letterSpacing: '0.8px',
                textTransform: 'uppercase'
              }}>
                🤖 SYSTEM MANAGING DIRECTIVE
              </span>
              {systemManagingDirective.distanceM !== null && (
                <span style={{
                  background: systemManagingDirective.level === 'critical' ? '#b71c1c' : '#1565c0',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: '12px'
                }}>
                  {systemManagingDirective.distanceM < 1000 ? `${systemManagingDirective.distanceM}m` : `${(systemManagingDirective.distanceM / 1000).toFixed(1)}km`}
                </span>
              )}
            </div>

            <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
              {systemManagingDirective.title}
            </div>

            <p style={{ margin: 0, fontSize: '11.5px', color: '#cfd8dc', lineHeight: '1.45' }}>
              {systemManagingDirective.text}
            </p>

            {systemManagingDirective.distanceM !== null && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', color: '#90caf9' }}>
                  ⏱ ETA: <strong>{systemManagingDirective.etaSec < 60 ? `${systemManagingDirective.etaSec}s` : `~${Math.ceil(systemManagingDirective.etaSec / 60)} min`}</strong>
                </div>
                {systemManagingDirective.driver?.hospital && (
                  <div style={{ background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', color: '#a5d6a7' }}>
                    🏥 {systemManagingDirective.driver.hospital}
                  </div>
                )}
                <button
                  type="button"
                  onClick={relaySystemDirective}
                  style={{
                    marginLeft: 'auto',
                    background: '#1565c0',
                    border: 'none',
                    color: '#fff',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Broadcast this system directive to Control Room and Units"
                >
                  📡 Relay Directive
                </button>
              </div>
            )}
          </div>

          {/* Live Fleet */}
          <div className="amb-panel-title" style={{ padding: '6px 14px 4px', fontSize: '12px' }}>Live Fleet</div>
          <div className="amb-driver-list" style={{ flex: '0 0 auto', maxHeight: '140px', overflowY: 'auto' }}>
            {Object.values(drivers).map((d) => (
              <div
                key={d.id}
                className={`amb-driver-row ${d.status === 'emergency' ? 'emergency-row' : ''}`}
                onClick={() => focusDriver(d)}
                style={{ padding: '6px 10px' }}
              >
                <div className={`amb-driver-avatar ${d.status || 'offline'}`} style={{ width: '28px', height: '28px', fontSize: '12px' }}>
                  {d.name ? d.name[0] : 'D'}
                </div>
                <div className="amb-driver-info">
                  <div className="amb-driver-name" style={{ fontSize: '12px' }}>{d.name}</div>
                  <div className="amb-driver-sub" style={{ fontSize: '10.5px' }}>
                    {d.vehicle || d.vehicle_no || 'TN01AB1234'} · {d.hospital || 'No Hospital'}
                  </div>
                </div>
                <div className={`amb-status-badge amb-status-${d.status || 'offline'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                  {(d.status || 'offline').toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {/* ── Police Dispatch Instructions (Outbound Commands) ── */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 14px 4px',
            fontWeight: 700,
            fontSize: '11px',
            color: '#42a5f5',
            letterSpacing: '0.5px',
            flexShrink: 0
          }}>
            👮 POLICE DISPATCH & FIELD COMMANDS
          </div>

          {/* Preset Quick Actions */}
          <div style={{ padding: '0 10px 6px', display: 'flex', flexWrap: 'wrap', gap: '5px', flexShrink: 0 }}>
            {PRESET_INSTRUCTIONS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => sendInstruction(p.text)}
                style={{
                  background: 'rgba(21,101,192,0.25)',
                  border: '1px solid #1565C0',
                  color: '#90caf9',
                  borderRadius: '5px',
                  padding: '4px 8px',
                  fontSize: '10.5px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.15s'
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#1565C0'; e.currentTarget.style.color = '#fff'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(21,101,192,0.25)'; e.currentTarget.style.color = '#90caf9'; }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom Instruction Input */}
          <div style={{ padding: '0 10px 6px', display: 'flex', gap: '6px', flexShrink: 0 }}>
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendInstruction(customInstruction); }}
              placeholder="Type police command / radio order…"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid #1e3a5f',
                borderRadius: '6px',
                color: '#e0e6f0',
                padding: '6px 8px',
                fontSize: '11.5px',
                outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={() => sendInstruction(customInstruction)}
              style={{
                background: '#1565C0',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Send
            </button>
          </div>

          {/* ── Unified Real-Time Log (System Directives + Police Commands) ── */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '6px 14px 2px',
            fontSize: '10.5px',
            fontWeight: 700,
            color: '#78909c',
            letterSpacing: '0.5px'
          }}>
            📋 REAL-TIME DIRECTIVE & DISPATCH STREAM
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px', minHeight: 0 }}>
            {instructionLog.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#455a64', fontSize: '11px', padding: '12px 0' }}>
                System ready. Directives and dispatch records will appear live.
              </div>
            ) : (
              instructionLog.map((entry) => {
                const isSystem = entry.sender === 'SYSTEM';
                return (
                  <div
                    key={entry.id}
                    style={{
                      background: isSystem
                        ? entry.level === 'critical'
                          ? 'rgba(183,28,28,0.22)'
                          : entry.level === 'imminent' || entry.level === 'warning'
                          ? 'rgba(230,81,0,0.22)'
                          : 'rgba(33,150,243,0.12)'
                        : 'rgba(21,101,192,0.12)',
                      border: `1px solid ${
                        isSystem
                          ? entry.level === 'critical' ? '#ef5350' : entry.level === 'imminent' ? '#ff9800' : '#42a5f5'
                          : 'rgba(21,101,192,0.3)'
                      }`,
                      borderRadius: '6px',
                      padding: '6px 9px',
                      marginBottom: '5px',
                      fontSize: '11.5px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{
                        color: isSystem
                          ? entry.level === 'critical' ? '#ff8a80' : entry.level === 'imminent' ? '#ffb74d' : '#64b5f6'
                          : '#42a5f5',
                        fontWeight: 700
                      }}>
                        {isSystem ? '🤖 SYSTEM DIRECTIVE' : '👮 POLICE DISPATCH'}
                      </span>
                      <span style={{ color: '#546e7a', fontSize: '10px' }}>[{entry.timestamp}]</span>
                    </div>
                    <div style={{ color: '#e0e6f0', lineHeight: '1.4' }}>
                      {entry.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1 }}></div>
      </div>
    </div>
  );
}
