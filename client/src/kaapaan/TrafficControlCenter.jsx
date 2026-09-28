import React, { useState, useEffect } from 'react';

export default function TrafficControlCenter({
  roomId,
  token,
  vehicles,
  signalLocation,
  onSetSignalLocation,
  onPickJunctionOnMap,
  onSelectVehicleForRouting,
  selectedVehicleId,
  routeTelemetry,
  onOpenPairingModal
}) {
  const [statusMessage, setStatusMessage] = useState('Waiting for active mobile signals in room...');

  useEffect(() => {
    const count = Object.keys(vehicles).length;
    if (count > 0) {
      setStatusMessage(`🟢 Tracking ${count} active vehicle(s) in Room ${roomId}`);
    } else {
      setStatusMessage('Waiting for active mobile signals in room...');
    }
  }, [vehicles, roomId]);

  const handleUseLaptopLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        onSetSignalLocation({ latitude: lat, longitude: lng, accuracy });

        try {
          await fetch('/api/signal-location', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ latitude: lat, longitude: lng, accuracy })
          });
        } catch (err) {}
      },
      (err) => {
        alert('Could not acquire laptop GPS: ' + err.message);
      },
      { enableHighAccuracy: true }
    );
  };

  const vehicleKeys = Object.keys(vehicles);

  return (
    <section className="card receiver-card" id="trafficPanel">
      <div className="card-header border-bottom">
        <div className="panel-title-wrap">
          <span className="panel-icon">🚦</span>
          <div>
            <h2>Traffic Control Center</h2>
            <p className="subtitle-text">Multi-Vehicle Tracking & OSRM Shortest Path Routing</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-sm btn-accent"
          onClick={onOpenPairingModal}
        >
          📱 Pair Mobile Phone (QR Code)
        </button>
      </div>

      {/* Fixed Physical Traffic Signal Location */}
      <div className="junction-box physical-signal-box">
        <div>
          <label><strong>🚦 Physical Traffic Signal Location</strong></label>
          <p className="subtitle-text" style={{ marginTop: '4px' }}>
            This laptop + ESP32 + LCD/LED setup is the fixed traffic signal.
          </p>
        </div>
        <div className="junction-controls">
          <button
            type="button"
            className="btn-primary"
            onClick={handleUseLaptopLocation}
          >
            📍 Use This Laptop as Signal
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onPickJunctionOnMap}
          >
            🎯 Manual Fallback
          </button>
        </div>
        <div className="signal-location-readout">
          <span>
            {signalLocation
              ? '🟢 Signal location active (Live ESP32 Anchor)'
              : '🔴 Signal location not set'}
          </span>
          <code>
            {signalLocation
              ? `${Number(signalLocation.latitude).toFixed(6)}, ${Number(signalLocation.longitude).toFixed(6)}`
              : 'Waiting for laptop GPS/location...'}
          </code>
        </div>
      </div>

      {/* Route Telemetry Bar */}
      <div className="route-telemetry-box">
        <div className="route-metric">
          <span className="metric-label">📏 Shortest Road Distance</span>
          <span className="metric-value">
            {routeTelemetry?.distance ? `${routeTelemetry.distance} km` : '-- km'}
          </span>
        </div>
        <div className="route-metric">
          <span className="metric-label">⏱️ Estimated Arrival (ETA)</span>
          <span className="metric-value">
            {routeTelemetry?.eta ? `${routeTelemetry.eta} mins` : '-- mins'}
          </span>
        </div>
        <div className="route-metric">
          <span className="metric-label">🚨 Clearance Status</span>
          <span
            className={`status-badge ${
              routeTelemetry?.status === 'imminent'
                ? 'imminent'
                : routeTelemetry?.status === 'approaching'
                ? 'approaching'
                : 'normal'
            }`}
          >
            {routeTelemetry?.badgeText || 'Waiting for Mobile Signal...'}
          </span>
        </div>
      </div>

      <div className="status-banner">{statusMessage}</div>

      {/* Live Detected Vehicles Grid */}
      <div className="section-sub-header">
        <h3>🚗 Active Mobile Units in Room</h3>
        <span className="units-count">{vehicleKeys.length} Connected</span>
      </div>

      <div className="vehicles-grid">
        {vehicleKeys.length > 0 ? (
          vehicleKeys.map((vId) => {
            const v = vehicles[vId];
            const isSelected = selectedVehicleId === vId;
            return (
              <div
                key={vId}
                className={`vehicle-card ${vId.toLowerCase()} ${isSelected ? 'selected-route-card' : ''}`}
                onClick={() => onSelectVehicleForRouting(vId)}
                style={{ cursor: 'pointer' }}
              >
                <div className="vehicle-header">
                  <h3>🚑 {v.displayName || vId}</h3>
                  <span className="vehicle-badge active">LIVE</span>
                </div>
                <div className="vehicle-body">
                  <p><span>Vehicle ID:</span> <strong>{v.vehicleId}</strong></p>
                  <p><span>Device:</span> <strong>{v.deviceName || 'Mobile Phone'}</strong></p>
                  <p><span>Coordinates:</span> <strong>{Number(v.latitude).toFixed(5)}, {Number(v.longitude).toFixed(5)}</strong></p>
                  <p><span>Speed:</span> <strong>{Math.round(v.speed || 0)} km/h</strong></p>
                  <p><span>Last Packet:</span> <strong>{new Date(v.timestamp).toLocaleTimeString()}</strong></p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-state-card">
            <div className="empty-icon">📱</div>
            <h4>No active mobile GPS signals received yet</h4>
            <p>
              Open this page on your mobile phone in <strong>Ambulance Mode</strong> with Room <code>{roomId}</code>, or click <strong>Pair Mobile (QR)</strong> above.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
