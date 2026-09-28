import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import io from 'socket.io-client';

export default function ControlRoomDashboard({ user, onLogout }) {
  const [forwardedList, setForwardedList] = useState([]);
  const [terminatedIds, setTerminatedIds] = useState(new Set());
  const [newCount, setNewCount] = useState(0);
  const [clock, setClock] = useState('');
  const [alertToast, setAlertToast] = useState(null);
  const [policeInstructions, setPoliceInstructions] = useState([]);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const instructionEndRef = useRef(null);

  const addMapMarker = (lat, lng, name, vehicle, time) => {
    if (!lat || !lng || !mapInstance.current) return;
    L.marker([lat, lng], {
      icon: L.divIcon({
        html: `<div style="width:40px;height:40px;background:#E8000D;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid white;box-shadow:0 2px 16px rgba(232,0,13,0.6);animation:crPulse 0.8s infinite;">🚨</div>`,
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    })
      .bindPopup(`<b>${name}</b><br>🚑 ${vehicle}<br>⏱ ${time}`)
      .addTo(mapInstance.current);
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes crPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}`;
    document.head.appendChild(style);

    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);

    if (!mapInstance.current && mapRef.current) {
      const map = L.map(mapRef.current).setView([13.0827, 80.2707], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);
      mapInstance.current = map;
    }

    socketRef.current = io();
    socketRef.current.emit('join_controlroom');

    socketRef.current.on('all_forwarded', (list) => {
      setForwardedList(list || []);
      (list || []).forEach((e) => {
        if (e.lat && e.lng) addMapMarker(e.lat, e.lng, e.driver_name, e.vehicle, e.forwarded_at);
      });
    });

    socketRef.current.on('new_forwarded_emergency', (data) => {
      if (audioRef.current) audioRef.current.play().catch(() => {});
      setForwardedList((prev) => [data, ...prev]);
      setNewCount((prev) => prev + 1);
      setAlertToast(data);
      setTimeout(() => setAlertToast(null), 5000);

      if (data.lat && data.lng) {
        addMapMarker(data.lat, data.lng, data.driver_name, data.vehicle, data.forwarded_at);
        if (mapInstance.current) mapInstance.current.setView([data.lat, data.lng], 15);
      }
    });

    // Listen for Police Dispatch Instructions
    socketRef.current.on('police_instruction', (entry) => {
      setPoliceInstructions((prev) => [...prev, entry]);
    });

    // Listen for terminated emergencies from other clients
    socketRef.current.on('emergency_terminated', (data) => {
      setTerminatedIds((prev) => new Set([...prev, data.id]));
    });

    return () => {
      clearInterval(timer);
      if (socketRef.current) socketRef.current.disconnect();
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  // Auto-scroll police instruction feed
  useEffect(() => {
    if (instructionEndRef.current) instructionEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [policeInstructions]);

  const terminateEmergency = async (entry) => {
    const newTerminated = new Set([...terminatedIds, entry.id]);
    setTerminatedIds(newTerminated);

    // Turn off ESP32
    try { await fetch('/emergency/off', { method: 'POST' }); } catch (_) {}

    // Broadcast termination
    if (socketRef.current) {
      socketRef.current.emit('emergency_terminated', { id: entry.id });
    }
  };

  const focusLocation = (lat, lng) => {
    if (lat && lng && mapInstance.current) mapInstance.current.setView([lat, lng], 15);
  };

  return (
    <div className="ambulancy-scope">
      <audio ref={audioRef} src="/sounds/alert.mp3" preload="auto"></audio>

      {/* New Emergency Toast */}
      {alertToast && (
        <div className="amb-toast show" style={{ background: '#E8000D', color: '#fff', fontWeight: 700, fontSize: '14px' }}>
          🚨 NEW EMERGENCY — {alertToast.driver_name} · {alertToast.vehicle}
        </div>
      )}

      {/* Topbar */}
      <div className="amb-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="amb-topbar-brand blue-brand">🚑 KAAPPAAN</div>
          <div className="amb-topbar-badge blue-badge">🎛 Control Room</div>
        </div>
        <div className="amb-topbar-right">
          <div className="amb-topbar-time">{clock}</div>
          <button className="amb-btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

        {/* Left Panel */}
        <div className="amb-control-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Stats */}
          <div className="amb-stats-bar two-cols">
            <div className="amb-stat-cell">
              <div className="amb-stat-val blue">{forwardedList.length}</div>
              <div className="amb-stat-lbl">Total Received</div>
            </div>
            <div className="amb-stat-cell">
              <div className="amb-stat-val emergency">{newCount}</div>
              <div className="amb-stat-lbl">New This Session</div>
            </div>
          </div>

          {/* Section: Ambulance History */}
          <div className="amb-panel-title" style={{ flexShrink: 0 }}>
            Ambulance History Log
            <div className="amb-live-dot"></div>
          </div>

          <div className="amb-emergency-list" style={{ flex: '1 1 50%', minHeight: 0 }}>
            {forwardedList.length > 0 ? (
              forwardedList.map((e, idx) => {
                const isTerminated = terminatedIds.has(e.id);
                return (
                  <div
                    key={idx}
                    className="amb-emergency-card"
                    style={{
                      opacity: isTerminated ? 0.45 : 1,
                      textDecoration: isTerminated ? 'line-through' : 'none',
                      transition: 'opacity 0.3s'
                    }}
                    onClick={() => !isTerminated && focusLocation(e.lat, e.lng)}
                  >
                    <div className="amb-card-header">
                      <div className="amb-card-name">
                        {isTerminated ? '✅' : '🚨'} {e.driver_name}
                        <span className={isTerminated ? 'badge-resolved' : 'badge-emergency'} style={{
                          background: isTerminated ? '#1b5e20' : undefined,
                          color: isTerminated ? '#69f0ae' : undefined
                        }}>
                          {isTerminated ? 'Resolved' : 'Emergency'}
                        </span>
                      </div>
                      <div className="amb-card-time">{e.forwarded_at}</div>
                    </div>
                    <div className="amb-card-vehicle">🚑 {e.vehicle}</div>
                    <div className="amb-card-location">
                      {e.lat && e.lng
                        ? `📍 ${Number(e.lat).toFixed(4)}, ${Number(e.lng).toFixed(4)}`
                        : '📍 Location unavailable'}
                    </div>
                    <div className="amb-card-forwarded-by">Dispatched by: {e.forwarded_by}</div>

                    {/* Terminate Button */}
                    {!isTerminated && (
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); terminateEmergency(e); }}
                        style={{
                          marginTop: '8px',
                          width: '100%',
                          background: 'rgba(183,28,28,0.3)',
                          border: '1px solid #ef5350',
                          borderRadius: '6px',
                          color: '#ef9a9a',
                          padding: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          letterSpacing: '0.5px',
                          transition: 'all 0.15s'
                        }}
                        onMouseOver={(ev) => { ev.currentTarget.style.background = '#b71c1c'; ev.currentTarget.style.color = '#fff'; }}
                        onMouseOut={(ev) => { ev.currentTarget.style.background = 'rgba(183,28,28,0.3)'; ev.currentTarget.style.color = '#ef9a9a'; }}
                      >
                        ⛔ TERMINATE EMERGENCY
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="amb-empty-state">
                <div className="amb-empty-icon">📡</div>
                <div className="amb-empty-text">
                  No emergencies received yet.<br />
                  Waiting for Police to dispatch alerts.
                </div>
              </div>
            )}
          </div>

          {/* Section: Police Dispatch Feed */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 14px 4px',
            fontWeight: 700,
            fontSize: '12px',
            color: '#42a5f5',
            letterSpacing: '0.5px',
            flexShrink: 0
          }}>
            👮 POLICE DISPATCH INSTRUCTIONS
          </div>

          <div style={{ flex: '1 1 30%', minHeight: 0, overflowY: 'auto', padding: '4px 10px 10px' }}>
            {policeInstructions.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#455a64', fontSize: '11px', padding: '10px 0' }}>
                Waiting for police instructions…
              </div>
            ) : (
              policeInstructions.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(21,101,192,0.12)',
                    border: '1px solid rgba(21,101,192,0.3)',
                    borderRadius: '6px',
                    padding: '7px 10px',
                    marginBottom: '5px',
                    fontSize: '12px'
                  }}
                >
                  <span style={{ color: '#546e7a', marginRight: '8px' }}>[{entry.timestamp}]</span>
                  <span style={{ color: '#42a5f5', fontWeight: 700 }}>👮 POLICE: </span>
                  <span style={{ color: '#cfd8dc' }}>{entry.text}</span>
                </div>
              ))
            )}
            <div ref={instructionEndRef} />
          </div>
        </div>

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1 }}></div>
      </div>
    </div>
  );
}
