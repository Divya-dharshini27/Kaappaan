"""
routes/led.py — LED + LCD control routes for ESP32
Place this file at:  routes/led.py
Register in app.py:  from routes.led import led_bp
                     app.register_blueprint(led_bp)
"""
import os
import requests
from flask import Blueprint, jsonify, session

led_bp = Blueprint("led", __name__)

ESP32_IP      = os.environ.get("ESP32_IP", "192.168.1.100")
ESP32_BASE    = f"http://{ESP32_IP}"
ESP32_TIMEOUT = 3  # seconds


def _call_esp32(path):
    try:
        r = requests.get(f"{ESP32_BASE}{path}", timeout=ESP32_TIMEOUT)
        return r.json(), r.status_code
    except requests.exceptions.ConnectionError:
        return {"error": "ESP32 not reachable. Check IP and WiFi."}, 503
    except requests.exceptions.Timeout:
        return {"error": "ESP32 timed out."}, 504
    except Exception as e:
        return {"error": str(e)}, 500


def _auth():
    return session.get("role") in ("controlroom", "admin")


# ── LED routes ────────────────────────────────────────────────────────────────

@led_bp.route("/led/on", methods=["POST"])
def led_on():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/led/on")
    return jsonify(data), status

@led_bp.route("/led/off", methods=["POST"])
def led_off():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/led/off")
    return jsonify(data), status

@led_bp.route("/led/status", methods=["GET"])
def led_status():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/led/status")
    return jsonify(data), status


# ── LCD routes ────────────────────────────────────────────────────────────────

@led_bp.route("/lcd/on", methods=["POST"])
def lcd_on():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/lcd/on")
    return jsonify(data), status

@led_bp.route("/lcd/off", methods=["POST"])
def lcd_off():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/lcd/off")
    return jsonify(data), status

@led_bp.route("/lcd/status", methods=["GET"])
def lcd_status():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/lcd/status")
    return jsonify(data), status


# ── Combined routes (LED + LCD together) ─────────────────────────────────────

@led_bp.route("/all/on", methods=["POST"])
def all_on():
    """Turns on both LED and LCD — called automatically on emergency."""
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/all/on")
    return jsonify(data), status

@led_bp.route("/all/off", methods=["POST"])
def all_off():
    if not _auth(): return jsonify({"error": "Unauthorized"}), 403
    data, status = _call_esp32("/all/off")
    return jsonify(data), status
