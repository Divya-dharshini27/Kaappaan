import React, { useState } from 'react';

export default function KaapaanRoleGate({ authenticatedRole, onRoleAuthenticated }) {
  const [selectedRole, setSelectedRole] = useState(null); // 'ambulance' | 'traffic'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSelectRole = (role) => {
    setSelectedRole(role);
    setError(null);
    if (role === 'ambulance') {
      setUsername('ambulance');
      setPassword('ambulance123');
    } else if (role === 'traffic') {
      setUsername('traffic');
      setPassword('traffic123');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, username, password })
      });

      const data = await res.json();
      if (data.success && data.token) {
        onRoleAuthenticated(data.role, data.token);
      } else {
        setError(data.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Failed to connect to authentication server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card mode-selection-card" id="roleGateCard">
      <div className="card-header">
        <h2>🔐 KAAPAAN Role Login</h2>
        <span className="step-tag">Sign in and lock this device to one role</span>
      </div>

      {!authenticatedRole ? (
        !selectedRole ? (
          <div id="roleChoiceView">
            <p className="subtitle-text" style={{ marginBottom: '16px' }}>
              Choose what this device represents. After login, the device stays in that role across refreshes.
            </p>
            <div className="mode-buttons-grid">
              <button
                type="button"
                className="mode-btn ambulance-mode-btn"
                onClick={() => handleSelectRole('ambulance')}
              >
                <div className="mode-btn-icon">📱</div>
                <div className="mode-btn-content">
                  <strong>Ambulance</strong>
                  <span>Mobile phone that sends live GPS</span>
                </div>
              </button>

              <button
                type="button"
                className="mode-btn traffic-mode-btn"
                onClick={() => handleSelectRole('traffic')}
              >
                <div className="mode-btn-icon">🚦</div>
                <div className="mode-btn-content">
                  <strong>Traffic Signal</strong>
                  <span>Laptop + ESP32 + LCD + LEDs</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="role-login-box">
            <div className="role-login-title">
              Sign in as {selectedRole === 'ambulance' ? 'Ambulance' : 'Traffic Control'}
            </div>
            <p className="subtitle-text" style={{ marginBottom: '14px' }}>
              {selectedRole === 'ambulance'
                ? 'Authenticate this mobile device to broadcast real-time GPS telemetry.'
                : 'Authenticate this control center to receive vehicle telemetry & control traffic signals.'}
            </p>

            <form onSubmit={handleLogin}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>Username</label>
                <input
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <div className="alert-box warning-alert" style={{ marginBottom: '12px' }}>{error}</div>}

              <div className="alert-actions">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Authenticating...' : '🔐 Sign In & Lock Role'}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setSelectedRole(null)}
                >
                  ← Back
                </button>
              </div>
            </form>

            <p className="role-login-hint">
              <strong>Demo credentials:</strong> ambulance / ambulance123 &nbsp;|&nbsp; traffic / traffic123
            </p>
          </div>
        )
      ) : (
        <div className="role-locked-box">
          <div className="role-locked-badge">
            {authenticatedRole === 'ambulance' ? '📱 Locked as Ambulance Transmitter' : '🚦 Locked as Traffic Control Center'}
          </div>
          <span>🔒 Device is authenticated in this role.</span>
        </div>
      )}
    </section>
  );
}
