"""
routes/hospital.py
- GET /api/hospitals          — static list from DB
- GET /api/hospitals/nearby   — sorted by distance from lat/lng (DB)
- GET /api/hospitals/live     — real hospitals from OpenStreetMap Overpass API

Optimisations applied:
  1. In-memory cache for /live — same lat/lng/radius won't re-fetch for 5 minutes
  2. Three Overpass mirror URLs tried in order — if one is slow/down, next is used
  3. Reduced timeout from 20s → 10s per mirror (30s total max)
  4. DB projection only fetches lat/lng/name — skips unused fields
  5. /nearby sorts in Python only after fetching minimal fields
"""

import math
import time
import requests
from flask import Blueprint, jsonify, request
from extensions import mongo

hospital_bp = Blueprint("hospital", __name__)

# ── Cache store ───────────────────────────────────────────────────────────────
# Key: (rounded_lat, rounded_lng, radius)  Value: (timestamp, result_list)
_cache: dict = {}
CACHE_TTL = 300   # seconds — cached results expire after 5 minutes

# ── Overpass mirrors (tried in order until one succeeds) ──────────────────────
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
MIRROR_TIMEOUT = 10   # seconds per mirror attempt


# ── Haversine distance (km) ───────────────────────────────────────────────────
def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Cache helpers ─────────────────────────────────────────────────────────────
def _cache_key(lat, lng, radius):
    # Round to 3 decimal places (~110m precision) so nearby requests share cache
    return (round(lat, 3), round(lng, 3), radius)

def _cache_get(key):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None

def _cache_set(key, value):
    _cache[key] = (time.time(), value)


# ── Overpass query with mirror fallback ───────────────────────────────────────
def _fetch_overpass(lat, lng, radius):
    query = f"""
    [out:json][timeout:20];
    (
      node["amenity"="hospital"](around:{radius},{lat},{lng});
      way["amenity"="hospital"](around:{radius},{lat},{lng});
      node["amenity"="clinic"](around:{radius},{lat},{lng});
      way["amenity"="clinic"](around:{radius},{lat},{lng});
    );
    out center;
    """
    last_error = None
    for mirror in OVERPASS_MIRRORS:
        try:
            resp = requests.post(
                mirror,
                data={"data": query},
                timeout=MIRROR_TIMEOUT
            )
            resp.raise_for_status()
            return resp.json(), None
        except requests.exceptions.Timeout:
            last_error = f"{mirror} timed out after {MIRROR_TIMEOUT}s"
            continue
        except requests.exceptions.RequestException as e:
            last_error = str(e)
            continue

    return None, f"All Overpass mirrors failed. Last error: {last_error}"


# ── Routes ────────────────────────────────────────────────────────────────────

@hospital_bp.route("/api/hospitals")
def list_hospitals():
    hospitals = list(mongo.db.hospitals.find({}, {"_id": 0}))
    return jsonify(hospitals)


@hospital_bp.route("/api/hospitals/nearby")
def nearby_hospitals():
    try:
        lat   = float(request.args.get("lat", 0))
        lng   = float(request.args.get("lng", 0))
        limit = int(request.args.get("limit", 10))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid lat/lng"}), 400

    # Only fetch the fields we actually need — faster DB query
    hospitals = list(mongo.db.hospitals.find(
        {},
        {"_id": 0, "name": 1, "lat": 1, "lng": 1, "address": 1, "phone": 1, "type": 1}
    ))

    for h in hospitals:
        h["distance_km"] = round(
            haversine(lat, lng, h.get("lat", 0), h.get("lng", 0)), 2
        )

    hospitals.sort(key=lambda h: h["distance_km"])
    return jsonify(hospitals[:limit])


@hospital_bp.route("/api/hospitals/live")
def live_hospitals():
    try:
        lat    = float(request.args.get("lat", 13.0827))
        lng    = float(request.args.get("lng", 80.2707))
        radius = int(request.args.get("radius", 5000))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid parameters"}), 400

    # ── Check cache first ─────────────────────────────────────────────────────
    key = _cache_key(lat, lng, radius)
    cached = _cache_get(key)
    if cached is not None:
        return jsonify(cached)

    # ── Fetch from Overpass (with mirror fallback) ────────────────────────────
    data, error = _fetch_overpass(lat, lng, radius)
    if error:
        return jsonify({"error": error}), 502

    # ── Parse results ─────────────────────────────────────────────────────────
    hospitals = []
    seen = set()

    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("name:en")
        if not name or name in seen:
            continue
        seen.add(name)

        if el["type"] == "node":
            h_lat, h_lng = el.get("lat"), el.get("lon")
        else:
            center = el.get("center", {})
            h_lat  = center.get("lat")
            h_lng  = center.get("lon")

        if not h_lat or not h_lng:
            continue

        hospitals.append({
            "name":        name,
            "address":     tags.get("addr:full") or tags.get("addr:street", ""),
            "phone":       tags.get("phone") or tags.get("contact:phone", ""),
            "type":        tags.get("amenity", "hospital").title(),
            "lat":         h_lat,
            "lng":         h_lng,
            "distance_km": round(haversine(lat, lng, h_lat, h_lng), 2),
        })

    hospitals.sort(key=lambda h: h["distance_km"])

    # ── Save to cache ─────────────────────────────────────────────────────────
    _cache_set(key, hospitals)

    return jsonify(hospitals)


@hospital_bp.route("/api/hospitals/live/cache/clear", methods=["POST"])
def clear_cache():
    """Optional admin route to manually clear the hospital cache."""
    _cache.clear()
    return jsonify({"message": "Cache cleared"})