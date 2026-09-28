import React from 'react';

export default function GpsHelpModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <div className="modal-header">
          <h3>📍 Mobile GPS Troubleshooting</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <h4>Why is GPS blocked on my phone?</h4>
          <p>
            Your phone is the ambulance transmitter. For a real travel demo, it sends GPS over the <strong>Internet</strong> to the laptop server. A public HTTPS URL satisfies the browser's secure-context requirement for GPS.
          </p>

          <div className="troubleshoot-step">
            <strong>Option 1: Use Simulation Mode</strong>
            <p>Tap "Simulate Movement" to test without needing device GPS permission.</p>
          </div>

          <div className="troubleshoot-step">
            <strong>Option 2: Allow the LAN page in Mobile Chrome (Demo Workaround)</strong>
            <ol>
              <li>On mobile Chrome, navigate to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
              <li>Add this site URL, select <strong>Enabled</strong> and tap <strong>Relaunch</strong>.</li>
            </ol>
          </div>

          <div className="troubleshoot-step">
            <strong>Option 3: Use an HTTPS tunnel</strong>
            <p>Run <code>npm run public</code> or deploy to free HTTPS hosting for instant mobile GPS access!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
