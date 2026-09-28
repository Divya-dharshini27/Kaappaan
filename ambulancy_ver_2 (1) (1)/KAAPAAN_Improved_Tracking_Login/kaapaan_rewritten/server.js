const http = require("http");
const express = require("express");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static directory
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ----------------------------------------------------------------
// SIMPLE ROLE LOGIN (prototype authentication)
// Any device with these credentials can use the corresponding role.
// The browser stores the returned role token so refreshes stay locked
// to the same role until site data is cleared.
// ----------------------------------------------------------------
const ROLE_CREDENTIALS = {
    ambulance: { username: "ambulance", password: "ambulance123", token: "KAAPAAN-AMBULANCE-2026" },
    traffic: { username: "traffic", password: "traffic123", token: "KAAPAAN-TRAFFIC-2026" }
};

function getBearerToken(req) {
    const header = String(req.headers.authorization || "");
    return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function roleFromRequest(req) {
    const token = getBearerToken(req);
    for (const [role, account] of Object.entries(ROLE_CREDENTIALS)) {
        if (token === account.token) return role;
    }
    return null;
}

function requireRole(role) {
    return (req, res, next) => {
        if (roleFromRequest(req) !== role) {
            return res.status(401).json({ success: false, error: `Authentication required for ${role} role` });
        }
        next();
    };
}

app.post("/api/login", (req, res) => {
    const role = String(req.body?.role || "").toLowerCase();
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const account = ROLE_CREDENTIALS[role];

    if (!account || username !== account.username || password !== account.password) {
        return res.status(401).json({ success: false, error: "Invalid username or password" });
    }

    res.json({
        success: true,
        role,
        token: account.token,
        message: `${role} role authenticated`
    });
});

app.get("/api/session", (req, res) => {
    const role = roleFromRequest(req);
    res.json({ authenticated: Boolean(role), role });
});


// Public tunnel URL is written by public-server.js when the demo is started
// with `npm run public`. The dashboard uses it to generate a QR code that
// works from a phone on mobile data/5G, not only on the laptop LAN.
app.get("/api/public-url", (req, res) => {
    const file = path.join(__dirname, "public-url.json");
    try {
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (data && data.url) return res.json({ available: true, url: data.url });
        }
    } catch (err) {
        console.warn("[PUBLIC URL] Could not read public-url.json:", err.message);
    }
    res.json({ available: false, url: null });
});

// ================================================================
// KAAPAAN HARDWARE GPS + TRAFFIC SIGNAL API
// ================================================================
let latestAmbulanceGPS = {};
let currentSignalState = {
    state: "RED",
    message: "No ambulance on the way",
    timestamp: Date.now()
};

// Fixed physical traffic-signal location. The Traffic Control laptop
// supplies this from the browser Geolocation API.
let currentSignalLocation = null;

app.get("/api/signal-location", (req, res) => {
    res.json({ success: true, location: currentSignalLocation });
});

app.post("/api/signal-location", requireRole("traffic"), (req, res) => {
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

    console.log(`[SIGNAL LOCATION] Laptop/ESP32 post: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    res.json({ success: true, location: currentSignalLocation });
});

app.post("/api/gps", requireRole("ambulance"), (req, res) => {
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

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gpsData));
        }
    }

    console.log(`[GPS] ${gpsData.vehicleId}: ${lat.toFixed(6)}, ${lng.toFixed(6)} | ${gpsData.deviceName}`);
    res.json({ success: true, message: "GPS received" });
});

app.get("/api/signal", (req, res) => {
    res.json(currentSignalState);
});

app.post("/api/signal", requireRole("traffic"), (req, res) => {
    const state = String(req.body?.state || "RED").toUpperCase();
    const message = String(req.body?.message || "No ambulance on the way");
    if (!["RED", "YELLOW", "GREEN"].includes(state)) {
        return res.status(400).json({ success: false, error: "Invalid signal state" });
    }
    currentSignalState = { state, message, timestamp: Date.now() };
    console.log(`[SIGNAL] ${state} - ${message}`);
    res.json({ success: true, signal: currentSignalState });
});

const server = http.createServer(app);

// WebSocket Server for Ultra-Low Latency Local LAN Sync
const wss = new WebSocket.Server({ server });

let clients = new Set();

wss.on("connection", (ws, req) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total active clients: ${clients.size}`);

    ws.on("message", (message) => {
        try {
            const dataStr = message.toString();
            // Broadcast to all other connected clients
            for (const client of clients) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(dataStr);
                }
            }
        } catch (err) {
            console.error("[WS] Broadcast error:", err);
        }
    });

    ws.on("close", () => {
        clients.delete(ws);
        console.log(`[WS] Client disconnected. Total active clients: ${clients.size}`);
    });

    ws.on("error", (err) => {
        console.error("[WS] Client error:", err);
        clients.delete(ws);
    });

    // Send welcome ping
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
    console.log("🚑 AMBULANCE GPS TRACKER SERVER RUNNING");
    console.log("========================================================");
    console.log(`💻 Laptop Access (Localhost) : http://localhost:${PORT}`);
    console.log(`📱 Local Mobile Access           : http://${localIp}:${PORT}`);
    console.log("🌐 Remote Mobile Access          : use `npm run public` for a HTTPS TryCloudflare URL");
    console.log("========================================================");
    console.log("💡 Tip: You can also use free Cloud Relay (no server required)!");
    console.log("========================================================\n");
});
