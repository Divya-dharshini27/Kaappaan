import os
from gevent import monkey
monkey.patch_all()
import certifi
from flask import Flask
from dotenv import load_dotenv
from extensions import mongo, sess, socketio

load_dotenv()

app = Flask(__name__)


# ── Config ────────────────────────────────────────────────────────────────────
app.config["SECRET_KEY"]   = os.environ.get("SECRET_KEY", "fallback-dev-secret")
app.config["SESSION_TYPE"] = "filesystem"

# ── MongoDB URI ───────────────────────────────────────────────────────────────
_base_uri = os.environ.get("MONGO_URI", "")
if "tlsCAFile" not in _base_uri:
    _ca = certifi.where().replace("\\", "/")
    _sep = "&" if "?" in _base_uri else "?"
    _mongo_uri = f"{_base_uri}{_sep}tls=true&tlsCAFile={_ca}"
else:
    _mongo_uri = _base_uri

app.config["MONGO_URI"] = _mongo_uri

# ── Extensions ────────────────────────────────────────────────────────────────
mongo.init_app(app)
sess.init_app(app)
socketio.init_app(app, cors_allowed_origins="*", async_mode="gevent")

# ── Blueprints ────────────────────────────────────────────────────────────────
from routes.auth        import auth_bp
from routes.driver      import driver_bp
from routes.admin       import admin_bp
from routes.hospital    import hospital_bp
from routes.controlroom import controlroom_bp
from routes             import socket_events  # noqa: F401

app.register_blueprint(auth_bp)
app.register_blueprint(driver_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(hospital_bp)
app.register_blueprint(controlroom_bp)

# =============================================================================
# HARDWARE ROUTES — ESP32 Integration
# =============================================================================

import requests
from flask import jsonify

# ── ESP32 IP — CHANGE THIS to your actual ESP32 IP from Serial Monitor ───────
ESP32_IP      = "10.180.130.118"   # <-- e.g. "192.168.1.47"
ESP32_BASE    = f"http://{ESP32_IP}"
ESP32_TIMEOUT = 4

def esp32_request(method, path, **kwargs):
    """Send a request to ESP32. Returns parsed JSON or None on failure."""
    url = ESP32_BASE + path
    try:
        resp = requests.request(method, url, timeout=ESP32_TIMEOUT, **kwargs)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        print(f"[ESP32] Cannot connect — is ESP32 online at {ESP32_IP}?")
    except requests.exceptions.Timeout:
        print(f"[ESP32] Timeout after {ESP32_TIMEOUT}s calling {url}")
    except requests.exceptions.RequestException as e:
        print(f"[ESP32] Error: {e}")
    return None


# ── LED routes ────────────────────────────────────────────────────────────────

@app.route("/led/status", methods=["GET"])
def led_status():
    data = esp32_request("GET", "/status")
    if data:
        status = "on" if data.get("state") == "emergency" else "off"
        return jsonify({"status": status})
    return jsonify({"status": "offline"}), 503

@app.route("/led/on", methods=["POST"])
def led_on():
    data = esp32_request("POST", "/emergency/on")
    if data:
        return jsonify({"status": "on"})
    return jsonify({"status": "offline"}), 503

@app.route("/led/off", methods=["POST"])
def led_off():
    data = esp32_request("POST", "/emergency/off")
    if data:
        return jsonify({"status": "off"})
    return jsonify({"status": "offline"}), 503


# ── LCD routes ────────────────────────────────────────────────────────────────

@app.route("/lcd/status", methods=["GET"])
def lcd_status():
    data = esp32_request("GET", "/status")
    if data:
        status = "on" if data.get("state") == "emergency" else "off"
        return jsonify({"status": status})
    return jsonify({"status": "offline"}), 503

@app.route("/lcd/off", methods=["POST"])
def lcd_off():
    data = esp32_request("POST", "/emergency/off")
    if data:
        return jsonify({"status": "off"})
    return jsonify({"status": "offline"}), 503


# ── All ON — called automatically when emergency arrives ─────────────────────

@app.route("/all/on", methods=["POST"])
def all_on():
    data = esp32_request("POST", "/emergency/on")
    if data:
        return jsonify({"led": "on", "lcd": "on"})
    return jsonify({"led": "offline", "lcd": "offline"}), 503


# ── Emergency routes (kept for compatibility) ─────────────────────────────────

@app.route("/emergency/on", methods=["POST"])
def emergency_on():
    data = esp32_request("POST", "/emergency/on")
    if data:
        return jsonify({"led": "on", "lcd": "on"})
    return jsonify({"led": "offline", "lcd": "offline"}), 503

@app.route("/emergency/off", methods=["POST"])
def emergency_off():
    data = esp32_request("POST", "/emergency/off")
    if data:
        return jsonify({"led": "off", "lcd": "off"})
    return jsonify({"led": "offline", "lcd": "offline"}), 503


# =============================================================================

if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)