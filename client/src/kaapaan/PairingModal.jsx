import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export default function PairingModal({ isOpen, onClose, roomId, onApplyRoom }) {
  const [roomInput, setRoomInput] = useState(roomId);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  const pairingUrl = `${window.location.origin}?portal=kaapaan&mode=ambulance&room=${roomId}`;

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, pairingUrl, { width: 200, margin: 2 }, (err) => {
        if (err) console.error(err);
      });
    }
  }, [isOpen, pairingUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleApply = (e) => {
    e.preventDefault();
    if (roomInput.trim()) {
      onApplyRoom(roomInput.trim().toUpperCase());
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <div className="modal-header">
          <h3>📱 Pair Mobile Device</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-desc">
            Scan this QR Code with your phone. The phone becomes the <strong>ambulance GPS transmitter</strong>; the laptop remains the Traffic Control Center.
          </p>

          <div className="qr-container">
            <canvas ref={canvasRef}></canvas>
          </div>

          <div className="pairing-url-box">
            <label><strong>Or open this link on your phone:</strong></label>
            <div className="copy-input-group">
              <input
                type="text"
                value={pairingUrl}
                readOnly
                className="form-input"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCopy}
              >
                {copied ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>
          </div>

          <form className="room-edit-group" onSubmit={handleApply}>
            <label><strong>Sync Room Code:</strong></label>
            <div className="copy-input-group">
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                placeholder="Room Code"
                className="form-input"
                style={{ textTransform: 'uppercase' }}
              />
              <button type="submit" className="btn-primary">
                Apply Room
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
