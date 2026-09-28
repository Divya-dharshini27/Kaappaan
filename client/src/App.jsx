import React, { useState } from 'react';
import AmbulancyPortal from './ambulancy/AmbulancyPortal';
import TrafficUnitPortal from './kaapaan/TrafficUnitPortal';

export default function App() {
  const [activePortal, setActivePortal] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const p = params.get('portal');
      if (p === 'trafficunit' || p === 'ambulancy') return p;
      return sessionStorage.getItem('active_portal') || localStorage.getItem('active_portal') || 'ambulancy';
    } catch {
      return 'ambulancy';
    }
  });

  const handlePortalSwitch = (portal) => {
    setActivePortal(portal);
    try {
      sessionStorage.setItem('active_portal', portal);
      const url = new URL(window.location);
      url.searchParams.set('portal', portal);
      window.history.replaceState({}, '', url);
    } catch {}
  };

  return (
    <div>
      {/* Top Global Portal Switcher */}
      <nav className="unified-portal-nav">
        <div className="portal-switch-group">
          <button
            type="button"
            className={`portal-switch-btn ${activePortal === 'ambulancy' ? 'active ambulancy-active' : ''}`}
            onClick={() => handlePortalSwitch('ambulancy')}
          >
            🚑 KAAPPAAN Fleet Hub
          </button>
          <button
            type="button"
            className={`portal-switch-btn ${activePortal === 'trafficunit' ? 'active kaapaan-active' : ''}`}
            onClick={() => handlePortalSwitch('trafficunit')}
          >
            🚦 TRAFFIC UNIT
          </button>
        </div>

        <div className="portal-status-meta">
          <span className="live-indicator">
            <span className="live-dot"></span>
            Node.js Unified Engine
          </span>
          <span>v2.0 Fullstack</span>
        </div>
      </nav>

      {/* Render Selected Portal */}
      {activePortal === 'ambulancy' ? <AmbulancyPortal /> : <TrafficUnitPortal />}
    </div>
  );
}
