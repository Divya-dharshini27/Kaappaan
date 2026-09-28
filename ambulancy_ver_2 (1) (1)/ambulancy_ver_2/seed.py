"""
seed.py — Seeds MongoDB Atlas with drivers, admin, control room, and hospitals for Ambulancy.
Run once: python seed.py
"""
import os
from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING
from pymongo.errors import DuplicateKeyError
import bcrypt

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/ambulancy")
client = MongoClient(
    MONGO_URI,
    tls=True,
    tlsAllowInvalidCertificates=True,
    serverSelectionTimeoutMS=30000
)
db = client.get_default_database()

# Indexes
db.drivers.create_index([("username", ASCENDING)], unique=True)
db.admins.create_index([("username", ASCENDING)],  unique=True)

def hashed(pw): return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

# ── Drivers ───────────────────────────────────────────────────────────────────
drivers = [
    {"username": "driver1", "password": hashed("driver123"), "name": "Ravi Kumar",
     "vehicle_no": "TN01AB1234", "phone": "9876543210", "hospital": None,
     "status": "offline", "location": {"lat": None, "lng": None}, "last_active": None},

    {"username": "driver2", "password": hashed("driver123"), "name": "Priya Nair",
     "vehicle_no": "TN02CD5678", "phone": "9123456780", "hospital": None,
     "status": "offline", "location": {"lat": None, "lng": None}, "last_active": None},

    {"username": "driver3", "password": hashed("driver123"), "name": "Arun Selvam",
     "vehicle_no": "TN03EF9012", "phone": "9988776655", "hospital": None,
     "status": "offline", "location": {"lat": None, "lng": None}, "last_active": None},
]

for d in drivers:
    try:
        db.drivers.insert_one(d)
        print(f"✅ Driver: {d['username']}")
    except DuplicateKeyError:
        print(f"⚠️  Exists: {d['username']}")

# ── Admin ─────────────────────────────────────────────────────────────────────
try:
    db.admins.insert_one({
        "username": "admin",
        "password": hashed("admin123"),
        "name": "System Admin"
        # No 'role' field — auth.py checks role: {"$exists": False} for admin
    })
    print("✅ Admin: admin")
except DuplicateKeyError:
    print("⚠️  Exists: admin")

# ── Control Room ──────────────────────────────────────────────────────────────
# Must be in 'admins' collection with role: "controlroom"
# because auth.py does: mongo.db.admins.find_one({"username": username, "role": "controlroom"})
try:
    db.admins.insert_one({
        "username": "controlroom",
        "password": hashed("control123"),
        "name": "Control Room Operator",
        "role": "controlroom"           # ← this is required for login to work!
    })
    print("✅ Control Room: controlroom")
except DuplicateKeyError:
    print("⚠️  Exists: controlroom")

# ── Hospitals (Chennai) ────────────────────────────────────────────────────────
hospitals = [
    {"name": "Apollo Hospitals",           "address": "21 Greams Lane, Thousand Lights, Chennai", "lat": 13.0604, "lng": 80.2496, "phone": "044-28290200", "type": "Multi-Specialty"},
    {"name": "Fortis Malar Hospital",      "address": "52 First Main Road, Gandhi Nagar, Adyar",  "lat": 13.0050, "lng": 80.2574, "phone": "044-42892222", "type": "Multi-Specialty"},
    {"name": "MIOT International",         "address": "4/112 Mount Poonamallee Rd, Manapakkam",   "lat": 13.0148, "lng": 80.1657, "phone": "044-22490900", "type": "Multi-Specialty"},
    {"name": "Kauvery Hospital",           "address": "199 Luz Church Road, Mylapore, Chennai",   "lat": 13.0355, "lng": 80.2677, "phone": "044-40006000", "type": "Multi-Specialty"},
    {"name": "MGM Healthcare",             "address": "Nelson Manickam Road, Aminjikarai",         "lat": 13.0700, "lng": 80.2218, "phone": "044-45002000", "type": "Multi-Specialty"},
    {"name": "Sri Ramachandra Hospital",   "address": "No.1 Ramachandra Nagar, Porur",            "lat": 13.0350, "lng": 80.1570, "phone": "044-45928500", "type": "Teaching"},
    {"name": "Stanley Medical College",    "address": "Old Jail Road, Stanley, Chennai",           "lat": 13.1068, "lng": 80.2876, "phone": "044-25281201", "type": "Government"},
    {"name": "Rajiv Gandhi Govt Hospital", "address": "Park Town, Chennai",                        "lat": 13.0836, "lng": 80.2760, "phone": "044-25305000", "type": "Government"},
    {"name": "Gleneagles Global Hospital", "address": "439 Cheran Nagar, Perumbakkam",             "lat": 12.9310, "lng": 80.2015, "phone": "044-44777777", "type": "Multi-Specialty"},
    {"name": "Sankara Nethralaya",         "address": "18 College Road, Chennai",                  "lat": 13.0700, "lng": 80.2490, "phone": "044-28281919", "type": "Eye Specialty"},
]

db.hospitals.delete_many({})
db.hospitals.insert_many(hospitals)
print(f"✅ Inserted {len(hospitals)} hospitals")

print("\n🎉 Done. Credentials:")
print("  Drivers      → driver1 / driver2 / driver3   password: driver123")
print("  Admin        → admin                          password: admin123")
print("  Control Room → controlroom                    password: control123")
client.close()