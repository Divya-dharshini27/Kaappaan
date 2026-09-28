/**
 * ====================================================================
 * UNIFIED BACKEND SERVER — KAAPAAN & AMBULANCY
 * ====================================================================
 * Express + Socket.IO + WebSocket + MongoDB (with in-memory fallback)
 * + ESP32 Hardware Proxy + Overpass OSM Live Hospital Cache
 */

const http = require("http");
const express = require("express");
const cors = require("cors");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Server } = require("socket.io");
const WebSocket = require("ws");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const {
  isSupabaseConfigured,
  syncFromSupabase,
  dbUpdateDriverStatus,
  dbUpdateDriverLocation,
  dbUpdateDriverHospital,
  dbSaveForwardedEmergency,
  dbSaveSignalState
} = require("./supabaseClient");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;
const { execSync } = require("child_process");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====================================================================
// DOWNLOAD PROJECT ZIP ENDPOINT
// ====================================================================
app.get("/api/download-zip", (req, res) => {
  const rootDir = path.resolve(__dirname, "..");
  const zipPath = path.join(rootDir, "KAAPPAAN_Project.zip");

  try {
    // Generate fresh zip excluding node_modules and dist
    execSync(
      `tar -a -cf "${zipPath}" --exclude="node_modules" --exclude="dist" --exclude="*.log" -C "${rootDir}" client server package.json START_UNIFIED_APP.bat README.md`,
      { windowsHide: true }
    );

    res.download(zipPath, "KAAPPAAN_Project.zip", (err) => {
      if (err) {
        console.error("Download error:", err);
      }
    });
  } catch (err) {
    console.error("ZIP creation error:", err.message);
    res.status(500).json({ error: "Could not generate zip", details: err.message });
  }
});

// ====================================================================
// ESP32 HARDWARE INTEGRATION CONFIG
// ====================================================================
let ESP32_IP = process.env.ESP32_IP || "10.87.129.118";
let ESP32_BASE = `http://${ESP32_IP}`;
const ESP32_TIMEOUT = 3000;

function setEsp32Ip(ip) {
  if (!ip) return;
  ESP32_IP = ip.trim();
  ESP32_BASE = `http://${ESP32_IP}`;
  console.log(`[HARDWARE] ⚡ ESP32 IP updated to: ${ESP32_BASE}`);
}

app.get("/api/config/esp32-ip", (req, res) => {
  res.json({ ip: ESP32_IP, base: ESP32_BASE });
});

app.post("/api/config/esp32-ip", (req, res) => {
  const ip = req.body?.ip;
  if (ip) {
    setEsp32Ip(ip);
    return res.json({ success: true, ip: ESP32_IP });
  }
  res.status(400).json({ error: "Invalid IP" });
});

app.post("/api/esp32/register", (req, res) => {
  const ip = req.body?.ip || req.ip.replace('::ffff:', '');
  if (ip) {
    setEsp32Ip(ip);
    console.log(`[HARDWARE] 📡 ESP32 auto-registered from IP: ${ip}`);
    return res.json({ success: true, message: "ESP32 registered", ip });
  }
  res.status(400).json({ error: "No IP provided" });
});

// Internal simulated device state for when physical ESP32 is offline
let simulatedHardwareState = {
  led: "off",
  lcd: "off",
  lcdLines: [
    "AMBULANCE IS COMING",
    "GIVE WAY",
    "GREEN SIGNAL IS ONLY",
    "FOR AMBULANCE"
  ]
};

async function esp32Request(method, reqPath, data = null) {
  try {
    const url = `${ESP32_BASE}${reqPath}`;
    console.log(`[HARDWARE CALL] ${method} ${url} ->`, data ? JSON.stringify(data) : 'no payload');
    const resp = await axios({
      method,
      url,
      data,
      timeout: ESP32_TIMEOUT,
      headers: { "Content-Type": "application/json" }
    });
    console.log(`[HARDWARE RESPONSE] ✅ Success:`, resp.data);
    return resp.data;
  } catch (err) {
    console.warn(`[HARDWARE WARN] Could not reach ESP32 at ${ESP32_BASE}${reqPath}: ${err.message}`);
    return null;
  }
}

// ====================================================================
// IN-MEMORY DATA STORE & DEFAULT SEED DATA (NO STATIC GPS COORDINATES)
// ====================================================================
const defaultDrivers = [
  {
    id: "drv_1",
    username: "driver1",
    passwordHash: bcrypt.hashSync("driver123", 10),
    name: "Ravi Kumar",
    vehicle_no: "TN01AB1234",
    phone: "+91 98765 43210",
    hospital: "Apollo Hospital",
    status: "offline",
    location: null,
    last_active: new Date()
  },
  {
    id: "drv_2",
    username: "driver2",
    passwordHash: bcrypt.hashSync("driver123", 10),
    name: "Priya Nair",
    vehicle_no: "TN02CD5678",
    phone: "+91 98765 43211",
    hospital: "Fortis Malar Hospital",
    status: "offline",
    location: null,
    last_active: new Date()
  },
  {
    id: "drv_3",
    username: "driver3",
    passwordHash: bcrypt.hashSync("driver123", 10),
    name: "Arun Selvam",
    vehicle_no: "TN03EF9012",
    phone: "+91 98765 43212",
    hospital: "MIOT International",
    status: "offline",
    location: null,
    last_active: new Date()
  }
];

const defaultAdmins = [
  {
    id: "adm_1",
    username: "admin",
    passwordHash: bcrypt.hashSync("admin123", 10),
    name: "Fleet Administrator",
    role: "admin"
  },
  {
    id: "ctrl_1",
    username: "controlroom",
    passwordHash: bcrypt.hashSync("controlroom123", 10),
    name: "Traffic Control Room Officer",
    role: "controlroom"
  }
];

const defaultHospitals = [
  {
    name: "Apollo Hospital (Greams Road)",
    address: "21 Greams Lane, Thousand Lights, Chennai",
    phone: "+91 44 2829 0200",
    lat: 13.0604,
    lng: 80.2496,
    type: "Multi-Specialty"
  },
  {
    name: "Fortis Malar Hospital",
    address: "52, 1st Main Rd, Gandhi Nagar, Adyar, Chennai",
    phone: "+91 44 4289 2222",
    lat: 13.0067,
    lng: 80.2571,
    type: "Multi-Specialty"
  },
  {
    name: "MIOT International",
    address: "4/112, Mount Poonamallee High Rd, Manapakkam, Chennai",
    phone: "+91 44 4200 2288",
    lat: 13.0195,
    lng: 80.1873,
    type: "Trauma & Ortho"
  },
  {
    name: "Kauvery Hospital",
    address: "199, Luz Church Rd, Mylapore, Chennai",
    phone: "+91 44 4000 6000",
    lat: 13.0336,
    lng: 80.2612,
    type: "Multi-Specialty"
  },
  {
    name: "Rajiv Gandhi Government General Hospital",
    address: "EVR Periyar Salai, Park Town, Chennai",
    phone: "+91 44 2530 5000",
    lat: 13.0818,
    lng: 80.2785,
    type: "Government General"
  },
  {
    name: "Gleneagles Global Health City",
    address: "439, Cheran Nagar, Perumbakkam, Chennai",
    phone: "+91 44 4477 7000",
    lat: 12.9069,
    lng: 80.1983,
    type: "Super-Specialty"
  }
];

// In-Memory store (kept in sync with Supabase)
let db = {
  drivers: JSON.parse(JSON.stringify(defaultDrivers)),
  admins: JSON.parse(JSON.stringify(defaultAdmins)),
  hospitals: JSON.parse(JSON.stringify(defaultHospitals)),
  forwardedEmergencies: []
};

// Initial sync from Supabase if configured
syncFromSupabase(db).then((syncedDb) => {
  db = syncedDb;
  if (isSupabaseConfigured()) {
    console.log("⚡ Connected to Supabase PostgreSQL & synced data successfully");
  } else {
    console.log("ℹ️ Running with Built-in High-Speed In-Memory Database (Supabase not configured)");
  }
});

// ====================================================================
// HAVERSINE DISTANCE FORMULA (KM)
// ====================================================================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ====================================================================
// OVERPASS OSM LIVE HOSPITALS WITH CACHE & 3 MIRRORS
// ====================================================================
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
const hospitalCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchOverpassHospitals(lat, lng, radius = 6000) {
  const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
  const cached = hospitalCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      way["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="clinic"](around:${radius},${lat},${lng});
      way["amenity"="clinic"](around:${radius},${lat},${lng});
    );
    out center;
  `;

  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const resp = await axios.post(mirror, `data=${encodeURIComponent(query)}`, {
        timeout: 8000,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      if (resp.data && resp.data.elements) {
        const seen = new Set();
        const results = [];

        for (const el of resp.data.elements) {
          const tags = el.tags || {};
          const name = tags.name || tags["name:en"];
          if (!name || seen.has(name)) continue;
          seen.add(name);

          const hLat = el.type === "node" ? el.lat : el.center?.lat;
          const hLng = el.type === "node" ? el.lon : el.center?.lon;
          if (!hLat || !hLng) continue;

          results.push({
            name,
            address: tags["addr:full"] || tags["addr:street"] || "",
            phone: tags.phone || tags["contact:phone"] || "",
            type: tags.amenity ? tags.amenity.charAt(0).toUpperCase() + tags.amenity.slice(1) : "Hospital",
            lat: hLat,
            lng: hLng,
            distance_km: Number(haversine(lat, lng, hLat, hLng).toFixed(2))
          });
        }

        results.sort((a, b) => a.distance_km - b.distance_km);
        hospitalCache.set(cacheKey, { timestamp: Date.now(), data: results });
        return results;
      }
    } catch (err) {
      console.warn(`[OVERPASS] Mirror ${mirror} failed: ${err.message}`);
    }
  }

  // Fallback to static hospitals calculated from lat/lng
  const fallback = db.hospitals.map((h) => ({
    ...h,
    distance_km: Number(haversine(lat, lng, h.lat, h.lng).toFixed(2))
  }));
  fallback.sort((a, b) => a.distance_km - b.distance_km);
  return fallback;
}

// ====================================================================
// AMBULANCY REST APIS
// ====================================================================

function verifyPassword(inputPassword, storedHash, userRole) {
  if (!inputPassword) return false;
  // 1. Try standard bcrypt comparison
  try {
    if (storedHash && bcrypt.compareSync(inputPassword, storedHash)) return true;
  } catch (err) {}

  // 2. Plaintext match fallback
  if (storedHash && inputPassword === storedHash) return true;

  // 3. Standard role password fallback
  if (userRole === "driver" && inputPassword === "driver123") return true;
  if (userRole === "admin" && inputPassword === "admin123") return true;
  if (userRole === "controlroom" && inputPassword === "controlroom123") return true;

  return false;
}

// Login
app.post("/api/auth/login", (req, res) => {
  const { username, password, role } = req.body;
  const userRole = role || "driver";

  let user = null;
  if (userRole === "driver") {
    user = db.drivers.find((d) => (d.username || "").toLowerCase() === (username || "").toLowerCase());
  } else if (userRole === "admin") {
    user = db.admins.find((a) => (a.username || "").toLowerCase() === (username || "").toLowerCase() && a.role === "admin");
  } else if (userRole === "controlroom") {
    user = db.admins.find((a) => (a.username || "").toLowerCase() === (username || "").toLowerCase() && a.role === "controlroom");
  }

  if (user && verifyPassword(password || "", user.passwordHash, userRole)) {
    const userPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: userRole,
      vehicle_no: user.vehicle_no || null,
      phone: user.phone || null,
      hospital: user.hospital || null,
      status: user.status || "online",
      location: user.location || { lat: 13.0827, lng: 80.2707 }
    };
    return res.json({ success: true, user: userPayload });
  }

  return res.status(401).json({ success: false, error: "Invalid username or password." });
});

// Update Driver Status
app.post("/api/driver/update-status", (req, res) => {
  const { userId, status } = req.body;
  const driver = db.drivers.find((d) => d.id === userId);
  if (driver) {
    driver.status = status;
    driver.last_active = new Date();
    dbUpdateDriverStatus(driver.id, status);
    return res.json({ success: true, status });
  }
  res.status(404).json({ success: false, error: "Driver not found" });
});

// Update Driver Location
app.post("/api/driver/update-location", (req, res) => {
  const { userId, lat, lng } = req.body;
  const driver = db.drivers.find((d) => d.id === userId);
  if (driver) {
    driver.location = { lat: Number(lat), lng: Number(lng) };
    driver.last_active = new Date();
    dbUpdateDriverLocation(driver.id, lat, lng);
    return res.json({ success: true, location: driver.location });
  }
  res.status(404).json({ success: false, error: "Driver not found" });
});

// Update Driver Hospital
app.post("/api/driver/update-hospital", (req, res) => {
  const { userId, hospital } = req.body;
  const driver = db.drivers.find((d) => d.id === userId);
  if (driver) {
    driver.hospital = hospital;
    driver.last_active = new Date();
    dbUpdateDriverHospital(driver.id, hospital);
    return res.json({ success: true, hospital });
  }
  res.status(404).json({ success: false, error: "Driver not found" });
});

// Admin Stats & Drivers List
app.get("/api/admin/stats-and-drivers", (req, res) => {
  const driversList = db.drivers.map(({ passwordHash, ...rest }) => rest);
  const total = driversList.length;
  const active = driversList.filter((d) => d.status === "online").length;
  const emergency = driversList.filter((d) => d.status === "emergency").length;
  const offline = total - active - emergency;

  res.json({
    stats: { total, active, emergency, offline },
    drivers: driversList
  });
});

// Control Room Forwarded Emergencies
app.get("/api/controlroom/forwarded", (req, res) => {
  res.json(db.forwardedEmergencies);
});

// Hospitals API
app.get("/api/hospitals", (req, res) => {
  res.json(db.hospitals);
});

app.get("/api/hospitals/nearby", (req, res) => {
  const lat = parseFloat(req.query.lat) || 13.0827;
  const lng = parseFloat(req.query.lng) || 80.2707;
  const limit = parseInt(req.query.limit) || 10;

  const hospitals = db.hospitals.map((h) => ({
    ...h,
    distance_km: Number(haversine(lat, lng, h.lat, h.lng).toFixed(2))
  }));
  hospitals.sort((a, b) => a.distance_km - b.distance_km);
  res.json(hospitals.slice(0, limit));
});

app.get("/api/hospitals/live", async (req, res) => {
  const lat = parseFloat(req.query.lat) || 13.0827;
  const lng = parseFloat(req.query.lng) || 80.2707;
  const radius = parseInt(req.query.radius) || 6000;

  try {
    const list = await fetchOverpassHospitals(lat, lng, radius);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/hospitals/live/cache/clear", (req, res) => {
  hospitalCache.clear();
  res.json({ message: "Cache cleared" });
});

// ====================================================================
// ESP32 HARDWARE ROUTES
// ====================================================================
app.get("/led/status", async (req, res) => {
  const data = await esp32Request("GET", "/status");
  if (data) {
    return res.json({ status: data.state === "emergency" ? "on" : "off" });
  }
  // Simulated fallback
  res.json({ status: simulatedHardwareState.led, hardware: "simulated" });
});

app.post("/led/on", async (req, res) => {
  simulatedHardwareState.led = "on";
  const data = await esp32Request("POST", "/emergency/on");
  if (data) return res.json({ status: "on" });
  res.json({ status: "on", hardware: "simulated" });
});

app.post("/led/off", async (req, res) => {
  simulatedHardwareState.led = "off";
  const data = await esp32Request("POST", "/emergency/off");
  if (data) return res.json({ status: "off" });
  res.json({ status: "off", hardware: "simulated" });
});

app.get("/lcd/status", async (req, res) => {
  const data = await esp32Request("GET", "/status");
  if (data) {
    return res.json({ status: data.state === "emergency" ? "on" : "off" });
  }
  res.json({ status: simulatedHardwareState.lcd, hardware: "simulated" });
});

app.post("/lcd/off", async (req, res) => {
  simulatedHardwareState.lcd = "off";
  const data = await esp32Request("POST", "/emergency/off");
  if (data) return res.json({ status: "off" });
  res.json({ status: "off", hardware: "simulated" });
});

app.post("/all/on", async (req, res) => {
  simulatedHardwareState.led = "on";
  simulatedHardwareState.lcd = "on";
  const data = await esp32Request("POST", "/emergency/on", req.body);
  if (data) return res.json({ led: "on", lcd: "on" });
  res.json({ led: "on", lcd: "on", hardware: "simulated" });
});

app.post("/emergency/on", async (req, res) => {
  simulatedHardwareState.led = "on";
  simulatedHardwareState.lcd = "on";
  const data = await esp32Request("POST", "/emergency/on", req.body);
  if (data) return res.json({ led: "on", lcd: "on", ...req.body });
  res.json({ led: "on", lcd: "on", hardware: "simulated", ...req.body });
});

app.post("/emergency/off", async (req, res) => {
  simulatedHardwareState.led = "off";
  simulatedHardwareState.lcd = "off";
  const data = await esp32Request("POST", "/emergency/off", req.body);
  if (data) return res.json({ led: "off", lcd: "off" });
  res.json({ led: "off", lcd: "off", hardware: "simulated" });
});

// ====================================================================
// KAAPAAN GPS & TRAFFIC SIGNAL REST APIS
// ====================================================================
const KAAPAAN_CREDENTIALS = {
  ambulance: { username: "ambulance", password: "ambulance123", token: "KAAPAAN-AMBULANCE-2026" },
  traffic: { username: "traffic", password: "traffic123", token: "KAAPAAN-TRAFFIC-2026" }
};

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function kaapaanRoleFromReq(req) {
  const token = getBearerToken(req);
  for (const [role, acc] of Object.entries(KAAPAAN_CREDENTIALS)) {
    if (token === acc.token) return role;
  }
  return null;
}

app.post("/api/login", (req, res) => {
  const role = String(req.body?.role || "").toLowerCase();
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  const acc = KAAPAAN_CREDENTIALS[role];

  if (!acc || username !== acc.username || password !== acc.password) {
    return res.status(401).json({ success: false, error: "Invalid username or password" });
  }

  res.json({
    success: true,
    role,
    token: acc.token,
    message: `${role} role authenticated`
  });
});

app.get("/api/session", (req, res) => {
  const role = kaapaanRoleFromReq(req);
  res.json({ authenticated: Boolean(role), role });
});

let latestAmbulanceGPS = {};
let currentSignalState = {
  state: "RED",
  message: "No ambulance on the way",
  timestamp: Date.now()
};
let currentSignalLocation = null;

// Automatic Server-Side Proximity Trigger for ESP32
function checkProximityAndTriggerHardware(lat, lng, vehicleId, isEmergency) {
  if (!currentSignalLocation || !lat || !lng) return;
  const distKm = haversine(Number(lat), Number(lng), currentSignalLocation.latitude, currentSignalLocation.longitude);
  const distM = Math.round(distKm * 1000);
  const etaSec = Math.max(5, Math.round(distM / 11));
  const etaStr = etaSec < 60 ? `${etaSec}s` : `${Math.ceil(etaSec / 60)}m`;
  const isAlert = distM <= 750;

  if (isAlert) {
    simulatedHardwareState.led = "on";
    simulatedHardwareState.lcd = "on";
  }

  esp32Request("POST", "/emergency/on", {
    distance: distM,
    eta: etaStr,
    etaSec,
    vehicle: vehicleId || "AMB001",
    speed: 45,
    isAlert
  }).catch(() => {});
}

app.get("/api/signal-location", (req, res) => {
  res.json({ success: true, location: currentSignalLocation });
});

app.post("/api/signal-location", (req, res) => {
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);
  const accuracy = Number(req.body?.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ success: false, error: "Invalid signal location" });
  }

  currentSignalLocation = {
    latitude: lat,
    longitude: lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: Date.now(),
    source: "TRAFFIC_CONTROL_LAPTOP"
  };

  // Broadcast to all sockets immediately (Driver, Police, Control Room)
  io.emit("signal_location_update", currentSignalLocation);

  res.json({ success: true, location: currentSignalLocation });
});

app.post("/api/gps", (req, res) => {
  const data = req.body || {};
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);

  if (!data.vehicleId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ success: false, error: "Invalid GPS data" });
  }

  const gpsData = {
    type: "GPS_TELEMETRY",
    vehicleId: String(data.vehicleId),
    displayName: data.displayName || `Ambulance ${data.vehicleId}`,
    deviceName: data.deviceName || "Phone GPS (Browser)",
    latitude: lat,
    longitude: lng,
    speed: Number(data.speed) || 0,
    accuracy: Number(data.accuracy) || null,
    timestamp: Date.now(),
    roomId: data.roomId || "AMB-SYNC"
  };

  latestAmbulanceGPS[gpsData.vehicleId] = gpsData;

  // Broadcast to WS clients
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(gpsData));
    }
  }

  // Also broadcast to Socket.IO
  io.emit("kaapaan_gps", gpsData);

  // Auto trigger hardware proximity
  checkProximityAndTriggerHardware(lat, lng, gpsData.vehicleId, true);

  res.json({ success: true, message: "GPS received" });
});

app.get("/api/signal", (req, res) => {
  res.json(currentSignalState);
});

app.post("/api/signal", (req, res) => {
  const state = String(req.body?.state || "RED").toUpperCase();
  const message = String(req.body?.message || "No ambulance on the way");
  if (!["RED", "YELLOW", "GREEN"].includes(state)) {
    return res.status(400).json({ success: false, error: "Invalid signal state" });
  }
  currentSignalState = { state, message, timestamp: Date.now() };
  dbSaveSignalState(currentSignalState);
  io.emit("kaapaan_signal", currentSignalState);
  res.json({ success: true, signal: currentSignalState });
});

app.get("/api/public-url", (req, res) => {
  const file = path.join(__dirname, "public-url.json");
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && data.url) return res.json({ available: true, url: data.url });
    }
  } catch (err) {}
  res.json({ available: false, url: null });
});

// ====================================================================
// CREATE HTTP SERVER & REALTIME SOCKETS
// ====================================================================
const server = http.createServer(app);

// 1. Socket.IO instance for Ambulancy & KAAPAAN
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on("connection", (socket) => {
  // Send current signal location on connection immediately
  if (currentSignalLocation) {
    socket.emit("signal_location_update", currentSignalLocation);
  }

  // Join rooms
  socket.on("join_admin", () => {
    socket.join("admin");
    const driversList = db.drivers.map(({ passwordHash, ...rest }) => rest);
    socket.emit("all_drivers", driversList);
  });

  socket.on("join_controlroom", () => {
    socket.join("controlroom");
    socket.emit("all_forwarded", db.forwardedEmergencies);
  });

  socket.on("driver_connected", (data) => {
    const userId = data?.userId;
    if (userId) {
      const driver = db.drivers.find((d) => d.id === userId);
      if (driver) {
        driver.status = "online";
        driver.last_active = new Date();
        dbUpdateDriverStatus(driver.id, "online");
        io.to("admin").emit("driver_update", {
          id: driver.id,
          name: driver.name,
          vehicle: driver.vehicle_no,
          hospital: driver.hospital,
          status: "online",
          lat: driver.location?.lat,
          lng: driver.location?.lng
        });
      }
    }
  });

  socket.on("driver_location", (data) => {
    const { userId, lat, lng } = data;
    const driver = db.drivers.find((d) => d.id === userId);
    if (driver) {
      driver.location = { lat, lng };
      driver.last_active = new Date();
      dbUpdateDriverLocation(driver.id, lat, lng);
      io.to("admin").emit("driver_update", {
        id: driver.id,
        name: driver.name,
        vehicle: driver.vehicle_no,
        hospital: driver.hospital,
        status: driver.status,
        lat,
        lng
      });

      // Auto trigger hardware proximity
      checkProximityAndTriggerHardware(lat, lng, driver.vehicle_no || driver.name, driver.status === "emergency");
    }
  });

  socket.on("driver_status", (data) => {
    const { userId, status } = data;
    const driver = db.drivers.find((d) => d.id === userId);
    if (driver) {
      driver.status = status;
      driver.last_active = new Date();
      dbUpdateDriverStatus(driver.id, status);

      io.to("admin").emit("driver_update", {
        id: driver.id,
        name: driver.name,
        vehicle: driver.vehicle_no,
        hospital: driver.hospital,
        status,
        lat: driver.location?.lat,
        lng: driver.location?.lng
      });

      if (status === "emergency") {
        io.to("admin").emit("emergency_alert", {
          id: driver.id,
          name: driver.name,
          vehicle: driver.vehicle_no,
          hospital: driver.hospital,
          lat: driver.location?.lat,
          lng: driver.location?.lng
        });
      }
    }
  });

  socket.on("forward_to_controlroom", (data) => {
    const payload = {
      id: `fwd_${Date.now()}`,
      driver_name: data.name,
      vehicle: data.vehicle,
      lat: data.lat,
      lng: data.lng,
      forwarded_by: data.forwarded_by || "Admin",
      forwarded_at: new Date().toISOString().replace("T", " ").substring(0, 19),
      status: "active"
    };

    db.forwardedEmergencies.unshift(payload);
    dbSaveForwardedEmergency(payload);
    io.to("controlroom").emit("new_forwarded_emergency", payload);

    // Auto trigger hardware turn on
    simulatedHardwareState.led = "on";
    simulatedHardwareState.lcd = "on";
    esp32Request("POST", "/emergency/on").catch(() => {});
  });

  // Relay police dispatch instructions to Control Room
  socket.on("police_instruction", (data) => {
    io.to("controlroom").emit("police_instruction", data);
  });

  // Broadcast emergency termination to all connected clients
  socket.on("emergency_terminated", (data) => {
    io.emit("emergency_terminated", data);
  });
});

// 2. WebSocket Server (ws) for KAAPAAN ultra-low latency telemetry
const wss = new WebSocket.Server({ server, path: "/ws" });
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("message", (msg) => {
    try {
      const dataStr = msg.toString();
      for (const client of wsClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(dataStr);
        }
      }
    } catch (err) {}
  });

  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: "SYSTEM_HELLO", timestamp: Date.now() }));
});

// Helper: Get local network IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

server.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIpAddress();
  console.log("\n========================================================");
  console.log("🚑 UNIFIED KAAPAAN + AMBULANCY BACKEND STARTED");
  console.log("========================================================");
  console.log(`💻 Local Access    : http://localhost:${PORT}`);
  console.log(`📱 LAN Mobile Access : http://${localIp}:${PORT}`);
  console.log(`📡 WebSocket Path  : ws://${localIp}:${PORT}/ws`);
  console.log("========================================================\n");
});
