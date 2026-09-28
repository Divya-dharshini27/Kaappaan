from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for
from extensions import mongo
from bson import ObjectId
from datetime import datetime
from functools import wraps

driver_bp = Blueprint("driver", __name__, url_prefix="/driver")


def driver_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get("role") != "driver":
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated


@driver_bp.route("/dashboard")
@driver_required
def dashboard():
    driver = mongo.db.drivers.find_one({"_id": ObjectId(session["user_id"])})
    return render_template("driver_dashboard.html", driver=driver)


@driver_bp.route("/api/update-status", methods=["POST"])
@driver_required
def update_status():
    data   = request.get_json()
    status = data.get("status", "online")
    mongo.db.drivers.update_one(
        {"_id": ObjectId(session["user_id"])},
        {"$set": {"status": status, "last_active": datetime.utcnow()}}
    )
    return jsonify({"ok": True})


@driver_bp.route("/api/update-location", methods=["POST"])
@driver_required
def update_location():
    data = request.get_json()
    mongo.db.drivers.update_one(
        {"_id": ObjectId(session["user_id"])},
        {"$set": {
            "location": {"lat": data.get("lat"), "lng": data.get("lng")},
            "last_active": datetime.utcnow()
        }}
    )
    return jsonify({"ok": True})


@driver_bp.route("/api/update-hospital", methods=["POST"])
@driver_required
def update_hospital():
    """Driver selects a hospital from the nearby list — persisted to DB."""
    data     = request.get_json()
    hospital = data.get("hospital", "").strip()
    if not hospital:
        return jsonify({"ok": False, "error": "Hospital name required"}), 400

    mongo.db.drivers.update_one(
        {"_id": ObjectId(session["user_id"])},
        {"$set": {"hospital": hospital, "last_active": datetime.utcnow()}}
    )
    return jsonify({"ok": True, "hospital": hospital})