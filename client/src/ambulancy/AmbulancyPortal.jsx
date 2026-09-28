import React, { useState } from 'react';
import AmbulancyLogin from './AmbulancyLogin';
import DriverDashboard from './DriverDashboard';
import AdminDashboard from './AdminDashboard';
import ControlRoomDashboard from './ControlRoomDashboard';
import './ambulancy.css';

export default function AmbulancyPortal() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      // 1. Check tab-isolated sessionStorage first
      const sessionSaved = sessionStorage.getItem('ambulancy_user');
      if (sessionSaved) return JSON.parse(sessionSaved);

      // 2. Fallback to localStorage
      const localSaved = localStorage.getItem('ambulancy_user');
      if (localSaved) {
        const parsed = JSON.parse(localSaved);
        sessionStorage.setItem('ambulancy_user', localSaved);
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    try {
      // Store in per-tab sessionStorage so different tabs don't overwrite each other
      sessionStorage.setItem('ambulancy_user', JSON.stringify(user));
    } catch {}
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      sessionStorage.removeItem('ambulancy_user');
      localStorage.removeItem('ambulancy_user');
    } catch {}
  };

  if (!currentUser) {
    return <AmbulancyLogin onLoginSuccess={handleLoginSuccess} />;
  }

  if (currentUser.role === 'admin') {
    return <AdminDashboard user={currentUser} onLogout={handleLogout} />;
  }

  if (currentUser.role === 'controlroom') {
    return <ControlRoomDashboard user={currentUser} onLogout={handleLogout} />;
  }

  return <DriverDashboard user={currentUser} onLogout={handleLogout} />;
}
