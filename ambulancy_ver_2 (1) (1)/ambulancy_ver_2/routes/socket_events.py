"""
socket_events.py — All Socket.IO event handlers.
Imported once in app.py to register handlers with the socketio instance.
"""
from flask import request, session
from flask_socketio import emit, join_room
from extensions import socketio, mongo
from bson import ObjectId
from datetime import datetime


# ── Driver events ─────────────────────────────────────────────────────────────

@socketio.on("driver_location")
def handle_location(data):
    """Driver sends {lat, lng} → saved to DB → broadcast to admin room."""
    user_id = session.get("user_id")
    if not user_id or session.get("role") != "driver":
        return

    lat, lng = data.get("lat"), data.get("lng")
    mongo.db.drivers.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"location": {"lat": lat, "lng": lng}, "last_active": datetime.utcnow()}}
    )
    driver = mongo.db.drivers.find_one({"_id": ObjectId(user_id)}, {"password": 0})
    emit("driver_update", {
        "id":       str(driver["_id"]),
        "name":     driver.get("name"),
        "vehicle":  driver.get("vehicle_no"),
        "hospital": driver.get("hospital"),
        "status":   driver.get("status", "online"),
        "lat":      lat,
        "lng":      lng,
    }, room="admin")


@socketio.on("driver_status")
def handle_status(data):
    """Driver toggles status (online / emergency / offline)."""
    user_id = session.get("user_id")
    if not user_id or session.get("role") != "driver":
        print(f"[SOCKET] driver_status REJECTED — user_id={user_id}, role={session.get('role')}")
        return

    status = data.get("status", "online")
    mongo.db.drivers.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"status": status, "last_active": datetime.utcnow()}}
    )
    driver = mongo.db.drivers.find_one({"_id": ObjectId(user_id)}, {"password": 0})

    print(f"[SOCKET] driver_status — {driver.get('name')} → {status}")

    emit("driver_update", {
        "id":       str(driver["_id"]),
        "name":     driver.get("name"),
        "vehicle":  driver.get("vehicle_no"),
        "hospital": driver.get("hospital"),
        "status":   status,
        "lat":      driver.get("location", {}).get("lat"),
        "lng":      driver.get("location", {}).get("lng"),
    }, room="admin")

    # If emergency → send dedicated alert to admin room
    if status == "emergency":
        print(f"[SOCKET] 🚨 Emergency alert sent to admin room for {driver.get('name')}")
        emit("emergency_alert", {
            "name":    driver.get("name"),
            "vehicle": driver.get("vehicle_no"),
            "lat":     driver.get("location", {}).get("lat"),
            "lng":     driver.get("location", {}).get("lng"),
        }, room="admin")


# ── Room join events ──────────────────────────────────────────────────────────

@socketio.on("join_admin")
def on_join_admin():
    role = session.get("role")
    print(f"[SOCKET] join_admin called — session role={role}")

    if role == "admin":
        join_room("admin")
        print("[SOCKET] ✅ Admin joined 'admin' room")

        # Send current snapshot of all drivers
        drivers = list(mongo.db.drivers.find({}, {"password": 0}))
        payload = [{
            "id":       str(d["_id"]),
            "name":     d.get("name"),
            "vehicle":  d.get("vehicle_no"),
            "hospital": d.get("hospital"),
            "status":   d.get("status", "offline"),
            "lat":      d.get("location", {}).get("lat"),
            "lng":      d.get("location", {}).get("lng"),
        } for d in drivers]
        emit("all_drivers", payload)
    else:
        print(f"[SOCKET] ❌ join_admin REJECTED — role is '{role}' not 'admin'")


@socketio.on("join_controlroom")
def on_join_controlroom():
    role = session.get("role")
    print(f"[SOCKET] join_controlroom called — session role={role}")

    if role == "controlroom":
        join_room("controlroom")
        print("[SOCKET] ✅ Control room joined 'controlroom' room")

        # Send all existing forwarded emergencies from DB
        forwarded = list(mongo.db.forwarded_emergencies.find({}, {"_id": 0}).sort("forwarded_at", -1))
        emit("all_forwarded", forwarded)
    else:
        print(f"[SOCKET] ❌ join_controlroom REJECTED — role is '{role}' not 'controlroom'")


@socketio.on("forward_to_controlroom")
def handle_forward(data):
    """Admin forwards an emergency alert to the control room."""
    role = session.get("role")
    print(f"[SOCKET] forward_to_controlroom called — role={role}")

    if role != "admin":
        print(f"[SOCKET] ❌ forward REJECTED — not admin")
        return

    payload = {
        "driver_name":  data.get("name"),
        "vehicle":      data.get("vehicle"),
        "lat":          data.get("lat"),
        "lng":          data.get("lng"),
        "forwarded_by": session.get("name", "Admin"),
        "forwarded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "status":       "active",
    }

    # Persist to DB so control room sees history even after reconnect
    mongo.db.forwarded_emergencies.insert_one(payload.copy())
    print(f"[SOCKET] ✅ Emergency forwarded to controlroom — {payload['driver_name']}")

    # Broadcast to control room
    emit("new_forwarded_emergency", payload, room="controlroom")


@socketio.on("driver_connected")
def on_driver_connected():
    user_id = session.get("user_id")
    if not user_id or session.get("role") != "driver":
        return
    mongo.db.drivers.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"status": "online", "last_active": datetime.utcnow()}}
    )
    print(f"[SOCKET] Driver connected — user_id={user_id}")


@socketio.on("disconnect")
def on_disconnect():
    user_id = session.get("user_id")
    if user_id and session.get("role") == "driver":
        mongo.db.drivers.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"status": "offline"}}
        )
        driver = mongo.db.drivers.find_one({"_id": ObjectId(user_id)}, {"password": 0})
        if driver:
            print(f"[SOCKET] Driver disconnected — {driver.get('name')}")
            emit("driver_update", {
                "id":     str(driver["_id"]),
                "name":   driver.get("name"),
                "status": "offline",
                "lat":    driver.get("location", {}).get("lat"),
                "lng":    driver.get("location", {}).get("lng"),
            }, room="admin")