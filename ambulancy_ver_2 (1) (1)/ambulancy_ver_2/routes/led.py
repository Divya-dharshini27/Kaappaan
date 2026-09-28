import requests, os
from flask import Blueprint, jsonify

led_bp = Blueprint('led', __name__)
ESP32_IP = os.getenv("ESP32_IP")

@led_bp.route('/emergency/on', methods=['POST'])
def emergency_on():
    requests.get(f"http://{ESP32_IP}/emergency/on", timeout=3)
    return jsonify({"status": "ok"})

@led_bp.route('/emergency/off', methods=['POST'])
def emergency_off():
    requests.get(f"http://{ESP32_IP}/emergency/off", timeout=3)
    return jsonify({"status": "ok"})