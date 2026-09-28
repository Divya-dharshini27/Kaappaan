import React, { useState } from 'react';

export default function AmbulancyLogin({ onLoginSuccess }) {
  const [role, setRole] = useState('driver');
  const [username, setUsername] = useState('driver1');
  const [password, setPassword] = useState('driver123');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleRoleChange = (selectedRole) => {
    setRole(selectedRole);
    setError(null);
    if (selectedRole === 'driver') {
      setUsername('driver1');
      setPassword('driver123');
    } else if (selectedRole === 'admin') {
      setUsername('admin');
      setPassword('admin123');
    } else if (selectedRole === 'controlroom') {
      setUsername('controlroom');
      setPassword('controlroom123');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });

      const data = await res.json();
      if (data.success && data.user) {
        onLoginSuccess(data.user);
      } else {
        setError(data.error || 'Invalid username or password.');
      }
    } catch (err) {
      setError('Unable to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="amb-login-container">
      {/* Left hero */}
      <div className="amb-login-hero">
        <div className="amb-hero-siren">🚑</div>
        <div className="amb-hero-title">KAAPPAAN</div>
        <p className="amb-hero-sub">
          IoT-Based Ambulance Alert &amp; Traffic Prioritization System for smart urban emergency response.
        </p>
        <div className="amb-hero-badge">
          <span className="amb-dot"></span>
          System Online
        </div>
      </div>

      {/* Right login panel */}
      <div className="amb-login-panel">
        <div className="amb-login-label">Secure Access</div>
        <div className="amb-login-heading">SIGN IN</div>

        {error && <div className="amb-flash">⚠ {error}</div>}

        {/* Role selector */}
        <div className="amb-role-tabs">
          <button
            type="button"
            className={`amb-role-tab ${role === 'driver' ? 'active' : ''}`}
            onClick={() => handleRoleChange('driver')}
          >
            🚑 Driver
          </button>
          <button
            type="button"
            className={`amb-role-tab ${role === 'admin' ? 'active' : ''}`}
            onClick={() => handleRoleChange('admin')}
          >
            👮 Police
          </button>
          <button
            type="button"
            className={`amb-role-tab ${role === 'controlroom' ? 'active' : ''}`}
            onClick={() => handleRoleChange('controlroom')}
          >
            🎛 Control Room
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="amb-form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoComplete="username"
            />
          </div>

          <div className="amb-form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="amb-btn-login" disabled={loading}>
            {loading ? 'AUTHENTICATING...' : 'LOGIN →'}
          </button>
        </form>

        <div className="amb-footer-note">
          KAAPPAAN v2.0 &nbsp;·&nbsp; Emergency Response System<br />
          Authorized personnel only
        </div>
      </div>
    </div>
  );
}
