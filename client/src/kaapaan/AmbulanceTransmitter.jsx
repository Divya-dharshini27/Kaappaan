import React, { useState, useEffect, useRef } from 'react';

export default function AmbulanceTransmitter({
  roomId,
  token,
  onGpsBroadcast,
  onOpenGpsHelp
}) {
  const [vehicleId, setVehicleId] = useState('AMB001');
  const [customId, setCustomId] = useState('');
  const [displayName, setDisplayName] = useState('Unit 1 (Emergency)');
  const [isTracking, setIsTracking] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [telemetry, setTelemetry] = useState({
    lat: '--',
    lng: '--',
    accuracy: '--',
    speed: '--',
    lastUpdate: '--'
  });
  const [statusMessage, setStatusMessage] = useState('Waiting to begin GPS broadcast...');

  const watchIdRef = useRef(null);
  const simTimerRef = useRef(null);
  const simIndexRef = useRef(0);

  // Realistic Simulation Waypoints (Chennai Corridor: Koyambedu -> Kilpauk -> Thousand Lights / Greams Road)
  const simulationRoute = [
    { lat: 13.0732, lng: 80.2012, speed: 45 },
    { lat: 13.0745, lng: 80.2085, speed: 52 },
    { lat: 13.0768, lng: 80.2189, speed: 60 },
    { lat: 13.0792, lng: 80.2314, speed: 55 },
    { lat: 13.0805, lng: 80.2421, speed: 48 },
    { lat: 13.0734, lng: 80.2488, speed: 50 },
    { lat: 13.0645, lng: 80.2505, speed: 58 },
    { lat: 13.0604, lng: 80.2496, speed: 40 }
  ];

  const transmitGPS = async (lat, lng, speed = 0, accuracy = 10) => {
    const timeStr = new Date().toLocaleTimeString();
    setTelemetry({
      lat: Number(lat).toFixed(6),
      lng: Number(lng).toFixed(6),
      accuracy: accuracy ? `±${Math.round(accuracy)}m` : '±5m',
      speed: `${Math.round(speed)} km/h`,
      lastUpdate: timeStr
    });

    const packet = {
      type: 'GPS_TELEMETRY',
      vehicleId,
      displayName: displayName || `Ambulance ${vehicleId}`,
      deviceName: 'Phone GPS (Browser)',
      latitude: Number(lat),
      longitude: Number(lng),
      speed: Number(speed),
      accuracy: Number(accuracy) || 5,
      timestamp: Date.now(),
      roomId
    };

    onGpsBroadcast(packet);

    try {
      await fetch('/api/gps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(packet)
      });
    } catch (err) {}
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setStatusMessage('❌ Geolocation is not supported by your browser');
      return;
    }

    setIsTracking(true);
    setStatusMessage('📡 Acquiring real GPS signal from device sensors…');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speed = (pos.coords.speed || 0) * 3.6; // convert m/s to km/h
        const acc = pos.coords.accuracy;

        transmitGPS(lat, lng, speed, acc);
        setStatusMessage(`🟢 Actively streaming live device GPS (±${Math.round(acc)}m accuracy)`);
      },
      (err) => {
        setStatusMessage(`⚠️ GPS Error: ${err.message}. Try "Simulate Movement" if indoors.`);
        setIsTracking(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setStatusMessage('⏹️ Tracking stopped.');
  };

  const toggleSimulation = () => {
    if (isSimulating) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
      setIsSimulating(false);
      setStatusMessage('⏹️ Simulation stopped.');
    } else {
      if (isTracking) stopTracking();

      setIsSimulating(true);
      setStatusMessage('🚗 Realistic Emergency Vehicle Simulation Running...');
      simIndexRef.current = 0;

      const runStep = () => {
        const pt = simulationRoute[simIndexRef.current];
        transmitGPS(pt.lat, pt.lng, pt.speed, 3);
        simIndexRef.current = (simIndexRef.current + 1) % simulationRoute.length;
      };

      runStep();
      simTimerRef.current = setInterval(runStep, 2000);
    }
  };

  const sendTestPing = () => {
    const lat = 13.0604 + (Math.random() - 0.5) * 0.01;
    const lng = 80.2496 + (Math.random() - 0.5) * 0.01;
    transmitGPS(lat, lng, 50, 4);
    setStatusMessage('⚡ Instant test GPS packet transmitted to Traffic Control!');
  };

  const handleRegisterCustomId = () => {
    if (customId.trim()) {
      const formatted = customId.trim().toUpperCase();
      setVehicleId(formatted);
      setCustomId('');
      setStatusMessage(`✅ Custom Vehicle ID set to ${formatted}`);
    }
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (simTimerRef.current !== null) clearInterval(simTimerRef.current);
    };
  }, []);

  return (
    <section className="card transmitter-card" id="ambulancePanel">
      <div className="card-header border-bottom">
        <div className="panel-title-wrap">
          <span className="panel-icon">📡</span>
          <div>
            <h2>Mobile GPS Transmitter</h2>
            <p className="subtitle-text">Streaming high-frequency GPS telemetry to Traffic Control</p>
          </div>
        </div>
        <span className={`badge badge-pulse ${isTracking || isSimulating ? 'live' : ''}`}>
          {isTracking ? 'LIVE GPS' : isSimulating ? 'SIMULATING' : 'STANDBY'}
        </span>
      </div>

      {/* Mobile GPS Permission Note */}
      <div className="alert-box warning-alert">
        <div className="alert-icon">⚠️</div>
        <div className="alert-body">
          <strong>Mobile GPS Permission Note:</strong>
          <p>
            This mode uses your <strong>phone's GPS</strong> and sends coordinates to the KAAPAAN server over real-time WebSockets. Keep mobile data or Wi-Fi connected.
          </p>
          <div className="alert-actions">
            <button
              type="button"
              className="btn-xs btn-primary"
              onClick={toggleSimulation}
            >
              {isSimulating ? '⏹️ Stop Simulation' : '🎮 Start Realistic Test Simulation'}
            </button>
            <button
              type="button"
              className="btn-xs btn-outline"
              onClick={onOpenGpsHelp}
            >
              📖 How to allow on Mobile Chrome
            </button>
          </div>
        </div>
      </div>

      {/* Vehicle ID and Display Name Form */}
      <div className="form-row-grid">
        <div className="form-group">
          <label><strong>Select Mobile / Vehicle ID:</strong></label>
          <select
            className="form-select"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="AMB001">🔴 Mobile 1 - Ambulance AMB001 (Priority 1)</option>
            <option value="AMB002">🔵 Mobile 2 - Ambulance AMB002 (Emergency)</option>
            <option value="AMB003">🟢 Mobile 3 - Ambulance AMB003 (Support)</option>
          </select>
        </div>

        <div className="form-group">
          <label><strong>Driver / Phone Display Name:</strong></label>
          <input
            type="text"
            className="form-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Driver John, Unit 1"
          />
        </div>
      </div>

      {/* Custom ID Registration */}
      <div className="custom-id-row">
        <input
          type="text"
          className="form-input"
          placeholder="Or enter Custom ID (e.g. RESCUE-99)"
          value={customId}
          onChange={(e) => setCustomId(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={handleRegisterCustomId}
        >
          ➕ Register ID
        </button>
      </div>

      {/* GPS Control Actions */}
      <div className="transmitter-actions">
        <button
          type="button"
          className="btn-action btn-success"
          onClick={startTracking}
          disabled={isTracking}
        >
          ▶️ Start Live GPS Tracking
        </button>
        <button
          type="button"
          className="btn-action btn-danger"
          onClick={stopTracking}
          disabled={!isTracking}
        >
          ⏹️ Stop Tracking
        </button>
        <button
          type="button"
          className="btn-action btn-secondary"
          onClick={sendTestPing}
          title="Sends an instant test GPS packet to laptop"
        >
          ⚡ Send Test Ping
        </button>
        <button
          type="button"
          className="btn-action btn-accent"
          onClick={toggleSimulation}
        >
          {isSimulating ? '⏹️ Stop Simulation' : '🚗 Simulate Movement'}
        </button>
      </div>

      {/* Telemetry Metrics Grid */}
      <div className="telemetry-grid">
        <div className="telemetry-card">
          <span className="t-label">Vehicle ID</span>
          <span className="t-value">{vehicleId}</span>
        </div>
        <div className="telemetry-card">
          <span className="t-label">Latitude</span>
          <span className="t-value">{telemetry.lat}</span>
        </div>
        <div className="telemetry-card">
          <span className="t-label">Longitude</span>
          <span className="t-value">{telemetry.lng}</span>
        </div>
        <div className="telemetry-card">
          <span className="t-label">Accuracy</span>
          <span className="t-value">{telemetry.accuracy}</span>
        </div>
        <div className="telemetry-card">
          <span className="t-label">Speed</span>
          <span className="t-value">{telemetry.speed}</span>
        </div>
        <div className="telemetry-card">
          <span className="t-label">Last Transmission</span>
          <span className="t-value">{telemetry.lastUpdate}</span>
        </div>
      </div>

      <div className="status-banner">{statusMessage}</div>
    </section>
  );
}
