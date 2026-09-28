import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import KaapaanRoleGate from './KaapaanRoleGate';
import AmbulanceTransmitter from './AmbulanceTransmitter';
import TrafficControlCenter from './TrafficControlCenter';
import KaapaanMap from './KaapaanMap';
import PairingModal from './PairingModal';
import GpsHelpModal from './GpsHelpModal';
import './kaapaan.css';

export default function KaapaanPortal() {
  const [authenticatedRole, setAuthenticatedRole] = useState(() => {
    try {
      return localStorage.getItem('kaapaan_role') || null;
    } catch {
      return null;
    }
  });
  const [roleToken, setRoleToken] = useState(() => {
    try {
      return localStorage.getItem('kaapaan_token') || null;
    } catch {
      return null;
    }
  });

  const [roomId, setRoomId] = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const r = urlParams.get('room');
      return r ? r.toUpperCase() : localStorage.getItem('kaapaan_room') || 'AMB-SYNC';
    } catch {
      return 'AMB-SYNC';
    }
  });

  const [vehicles, setVehicles] = useState({});
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [signalLocation, setSignalLocation] = useState(null);
  const [isPickingSignal, setIsPickingSignal] = useState(false);
  const [routeTelemetry, setRouteTelemetry] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);

  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [isGpsHelpOpen, setIsGpsHelpOpen] = useState(false);
  const [packetCount, setPacketCount] = useState(0);
  const [pingMs, setPingMs] = useState('--');

  const socketRef = useRef(null);

  // Sync with backend on mount
  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('kaapaan_gps', (gpsData) => {
      setPacketCount((prev) => prev + 1);
      setVehicles((prev) => ({
        ...prev,
        [gpsData.vehicleId]: gpsData
      }));
    });

    socketRef.current.on('connect', () => {
      setPingMs('12');
    });

    // Fetch signal location
    fetch('/api/signal-location')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.location) setSignalLocation(d.location);
      })
      .catch(() => {});

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const handleRoleAuthenticated = (role, token) => {
    setAuthenticatedRole(role);
    setRoleToken(token);
    try {
      localStorage.setItem('kaapaan_role', role);
      localStorage.setItem('kaapaan_token', token);
    } catch {}
  };

  const handleGpsBroadcast = (packet) => {
    setPacketCount((prev) => prev + 1);
    setVehicles((prev) => ({
      ...prev,
      [packet.vehicleId]: packet
    }));
  };

  const handleApplyRoom = (newRoom) => {
    setRoomId(newRoom);
    try {
      localStorage.setItem('kaapaan_room', newRoom);
    } catch {}
    setIsPairingModalOpen(false);
  };

  const handleSetSignalLocation = (loc) => {
    setSignalLocation(loc);
    setIsPickingSignal(false);
  };

  // Calculate OSRM route when signal location and vehicles exist
  useEffect(() => {
    const targetVehId = selectedVehicleId || Object.keys(vehicles)[0];
    const targetVeh = targetVehId ? vehicles[targetVehId] : null;

    if (targetVeh && signalLocation?.latitude && signalLocation?.longitude) {
      const sLat = targetVeh.latitude;
      const sLng = targetVeh.longitude;
      const dLat = signalLocation.latitude;
      const dLng = signalLocation.longitude;

      const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${dLng},${dLat}?overview=full&geometries=geojson`;

      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const distKm = (route.distance / 1000).toFixed(1);
            const etaMin = Math.ceil(route.duration / 60);

            let status = 'normal';
            let badgeText = 'Ambulance En Route (Clearance Normal)';

            if (distKm <= 0.5) {
              status = 'imminent';
              badgeText = '🚨 IMMINENT: Turn Signal Green Now!';
            } else if (distKm <= 2.0) {
              status = 'approaching';
              badgeText = '⚠️ Approaching: Prepare Green Clearance';
            }

            setRouteTelemetry({ distance: distKm, eta: etaMin, status, badgeText });
            setRouteGeometry(route.geometry);
          }
        })
        .catch(() => {});
    } else {
      setRouteTelemetry(null);
      setRouteGeometry(null);
    }
  }, [vehicles, signalLocation, selectedVehicleId]);

  return (
    <div className="kaapaan-scope">
      {/* Header */}
      <header className="app-header">
        <div className="header-container">
          <div className="header-branding">
            <span className="header-icon">🚑</span>
            <div>
              <h1>Ambulance Alert System</h1>
              <p className="subtitle-text">Real-Time Mobile GPS Tracking & Smart Traffic Clearance</p>
            </div>
          </div>

          {/* Sync Status Bar */}
          <div className="sync-status-bar">
            <div className="sync-pill">
              <span className="sync-dot green"></span>
              <span>Sync Server Connected</span>
            </div>
            <div
              className="room-pill"
              onClick={() => setIsPairingModalOpen(true)}
              title="Click to change Room Code"
            >
              <span>🔑 Room: <strong>{roomId}</strong></span>
            </div>
            <div className="telemetry-stat">
              <span>⚡ {pingMs} ms</span>
            </div>
            <div className="telemetry-stat">
              <span>📦 {packetCount} pkts</span>
            </div>
            <button
              type="button"
              className="btn-sm btn-accent"
              onClick={() => setIsPairingModalOpen(true)}
            >
              📱 Pair Mobile (QR)
            </button>
          </div>
        </div>
      </header>

      <main className="main-container">
        {/* Role Gate Login */}
        <KaapaanRoleGate
          authenticatedRole={authenticatedRole}
          onRoleAuthenticated={handleRoleAuthenticated}
        />

        {/* Ambulance Mode Panel */}
        {authenticatedRole === 'ambulance' && (
          <AmbulanceTransmitter
            roomId={roomId}
            token={roleToken}
            onGpsBroadcast={handleGpsBroadcast}
            onOpenGpsHelp={() => setIsGpsHelpOpen(true)}
          />
        )}

        {/* Traffic Signal Mode Panel */}
        {authenticatedRole === 'traffic' && (
          <TrafficControlCenter
            roomId={roomId}
            token={roleToken}
            vehicles={vehicles}
            signalLocation={signalLocation}
            onSetSignalLocation={handleSetSignalLocation}
            onPickJunctionOnMap={() => setIsPickingSignal(true)}
            onSelectVehicleForRouting={(vId) => setSelectedVehicleId(vId)}
            selectedVehicleId={selectedVehicleId}
            routeTelemetry={routeTelemetry}
            onOpenPairingModal={() => setIsPairingModalOpen(true)}
          />
        )}

        {/* Live Leaflet Map */}
        <KaapaanMap
          vehicles={vehicles}
          signalLocation={signalLocation}
          routeGeometry={routeGeometry}
          isPickingSignal={isPickingSignal}
          onSignalPicked={handleSetSignalLocation}
        />
      </main>

      {/* Pairing Modal */}
      <PairingModal
        isOpen={isPairingModalOpen}
        onClose={() => setIsPairingModalOpen(false)}
        roomId={roomId}
        onApplyRoom={handleApplyRoom}
      />

      {/* GPS Help Modal */}
      <GpsHelpModal
        isOpen={isGpsHelpOpen}
        onClose={() => setIsGpsHelpOpen(false)}
      />
    </div>
  );
}
