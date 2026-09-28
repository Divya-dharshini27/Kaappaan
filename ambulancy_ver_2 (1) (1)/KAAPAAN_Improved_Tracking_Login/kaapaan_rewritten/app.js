/**
 * ====================================================================
 * AMBULANCE ALERT SYSTEM - CORE CONTROLLER & REAL-TIME SYNC ENGINE
 * ====================================================================
 */

(function () {
    "use strict";

    // ====================================================================
    // GLOBAL STATE
    // ====================================================================
    let currentMode = null; // 'ambulance' | 'traffic'
    let authenticatedRole = null;
    let roleToken = null;
    let pendingLoginRole = null;
    let lastGpsTransmitAt = 0;
    let lastAcceptedGps = null;
    let currentRoomId = "AMB-SYNC"; // Room code
    let publicBaseUrl = null;
    let selectedVehicleId = "AMB001";
    let watchId = null;
    let map = null;

    // Maps & Tracking Data
    let markersMap = {};
    let activeVehiclesData = {};
    let vehicleTrailsMap = {};
    let vehicleHistoryMap = {};
    let simulatedVehicleActive = false;
    let simulationTimer = null;
    let simLat = 13.0600;
    let simLng = 80.2500;

    // Traffic Signal & Route
    // The traffic signal is the PHYSICAL LAPTOP + ESP32 + LCD/LED setup.
    // Do not use a hard-coded Chennai junction. The laptop browser supplies
    // the signal coordinates through the Geolocation API.
    let trafficJunctionLocation = null;
    let trafficJunctionMarker = null;
    let trafficSignalLocationReady = false;
    let trafficSignalLocationWatchId = null;
    let routePolyline = null;
    let pickJunctionMode = false;
    let autoCenterEnabled = true;
    let lastRoutingTime = 0;

    // Network & Sync Transports
    let totalPacketsTransmitted = 0;
    let lastPingSentTime = 0;
    let pingLatencyMs = null;
    let mqttClient = null;
    let localWs = null;
    let peer = null;
    let activePeerConnections = {};

    // ====================================================================
    // INITIALIZATION (Guaranteed to execute regardless of load order)
    // ====================================================================
    function initApp() {
        console.log("🚑 Initializing Ambulance Tracker System...");
        parseUrlParameters();
        initializeRoomSystem();
        initializeMap();
        setupEventListeners();
        setupSyncTransports();
        checkGeolocationSecurity();

        // Role must be authenticated before any device mode is opened.
        setupRoleLogin();
        restoreRoleSession();

        console.log(`✅ System Ready! Room: ${currentRoomId}`);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initApp);
    } else {
        // Document already loaded
        setTimeout(initApp, 10);
    }

    // ====================================================================
    // URL PARAMETERS & ROOM MANAGEMENT
    // ====================================================================
    function parseUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);

        const roomParam = urlParams.get("room");
        if (roomParam && roomParam.trim()) {
            currentRoomId = roomParam.trim().toUpperCase();
            try { localStorage.setItem("ambulanceTrackerRoom", currentRoomId); } catch (e) {}
        } else {
            try {
                const savedRoom = localStorage.getItem("ambulanceTrackerRoom");
                if (savedRoom) {
                    currentRoomId = savedRoom;
                } else {
                    const randomNum = Math.floor(1000 + Math.random() * 9000);
                    currentRoomId = `AMB-${randomNum}`;
                    localStorage.setItem("ambulanceTrackerRoom", currentRoomId);
                }
            } catch (e) {
                currentRoomId = `AMB-${Math.floor(1000 + Math.random() * 9000)}`;
            }
        }

        const vehicleParam = urlParams.get("vehicle");
        if (vehicleParam && vehicleParam.trim()) {
            selectedVehicleId = vehicleParam.trim().toUpperCase();
        }
    }

    function initializeRoomSystem() {
        const roomDisplay = document.getElementById("currentRoomDisplay");
        if (roomDisplay) roomDisplay.innerText = currentRoomId;

        const emptyRoom = document.getElementById("emptyRoomCode");
        if (emptyRoom) emptyRoom.innerText = currentRoomId;

        const customRoomInput = document.getElementById("customRoomInput");
        if (customRoomInput) customRoomInput.value = currentRoomId;

        const vehicleDisplay = document.getElementById("activeVehicleDisplay");
        if (vehicleDisplay) vehicleDisplay.innerText = selectedVehicleId;
    }

    function checkGeolocationSecurity() {
        const isSecure = window.isSecureContext || 
                         window.location.hostname === "localhost" || 
                         window.location.hostname === "127.0.0.1";
        const alertBox = document.getElementById("insecureOriginAlert");

        if (!isSecure && window.location.protocol === "http:" && alertBox) {
            alertBox.classList.remove("hidden");
        }
    }

    // ====================================================================
    // LEAFLET MAP INITIALIZATION & RESILIENCE
    // ====================================================================
    function initializeMap() {
        const mapContainer = document.getElementById("map");
        if (!mapContainer) return;

        if (typeof L === "undefined") {
            console.warn("Leaflet library not ready yet, retrying in 300ms...");
            setTimeout(initializeMap, 300);
            return;
        }

        if (map) return; // Already initialized

        try {
            // Start with a neutral India view. The map is moved to the
            // physical traffic-signal/laptop location once geolocation is read.
            map = L.map("map", {
                zoomControl: true,
                preferCanvas: true
            }).setView([20.5937, 78.9629], 5);

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 21,
                maxNativeZoom: 19,
                attribution: "&copy; OpenStreetMap contributors"
            }).addTo(map);

            // Do not place a fake/default signal marker. It appears only after
            // the laptop's real location has been obtained.
            updateTrafficJunctionMarker();

            map.on("zoomstart dragstart", () => {
                autoCenterEnabled = false;
            });

            map.on("click", (e) => {
                if (pickJunctionMode) {
                    trafficJunctionLocation = [e.latlng.lat, e.latlng.lng];
                    trafficSignalLocationReady = true;
                    pickJunctionMode = false;

                    const btn = document.getElementById("pickJunctionOnMapBtn");
                    if (btn) btn.innerText = "🎯 Pick on Map";

                    const select = document.getElementById("junctionSelect");
                    if (select) select.value = "custom";

                    updateTrafficJunctionMarker();
                    updateTrafficSignalLocationUI();
                    recalculateActiveRoutes();
                    updateTrafficStatus(`📍 Manual fallback signal location set to ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
                }
            });

            // Trigger resize after layout rendering
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);

        } catch (e) {
            console.error("Map initialization error:", e);
        }
    }

    // ====================================================================
    // ROLE LOGIN / DEVICE ROLE LOCK
    // ====================================================================
    function getStoredRoleSession() {
        try {
            const raw = localStorage.getItem("kaapaanRoleSession");
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.role || !data.token) return null;
            if (data.role !== "ambulance" && data.role !== "traffic") return null;
            return data;
        } catch (e) { return null; }
    }

    function saveRoleSession(data) {
        authenticatedRole = data.role;
        roleToken = data.token;
        try { localStorage.setItem("kaapaanRoleSession", JSON.stringify(data)); } catch (e) {}
        lockRoleUI();
    }

    function restoreRoleSession() {
        const session = getStoredRoleSession();
        if (session) {
            saveRoleSession(session);
            setMode(session.role);
            return true;
        }
        showRoleChoice();
        const urlRole = new URLSearchParams(window.location.search).get("role");
        if (urlRole === "ambulance" || urlRole === "traffic") showRoleLogin(urlRole);
        return false;
    }

    function setupRoleLogin() {
        bindClick("ambulanceBtn", () => showRoleLogin("ambulance"));
        bindClick("trafficBtn", () => showRoleLogin("traffic"));
        bindClick("backToRoleChoiceBtn", showRoleChoice);

        const form = document.getElementById("roleLoginForm");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                if (!pendingLoginRole) return;
                const username = document.getElementById("roleUsername")?.value.trim() || "";
                const password = document.getElementById("rolePassword")?.value || "";
                const errorEl = document.getElementById("roleLoginError");
                if (errorEl) errorEl.classList.add("hidden");

                try {
                    const response = await fetch("/api/login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role: pendingLoginRole, username, password })
                    });
                    const data = await response.json();
                    if (!response.ok || !data.success) throw new Error(data.error || "Login failed");

                    saveRoleSession({ role: data.role, token: data.token, username });
                    setMode(data.role);
                } catch (err) {
                    if (errorEl) {
                        errorEl.innerText = `❌ ${err.message}`;
                        errorEl.classList.remove("hidden");
                    }
                }
            });
        }
    }

    function showRoleChoice() {
        pendingLoginRole = null;
        document.getElementById("roleChoiceView")?.classList.remove("hidden");
        document.getElementById("roleLoginView")?.classList.add("hidden");
        document.getElementById("roleLockedView")?.classList.add("hidden");
    }

    function showRoleLogin(role) {
        if (authenticatedRole) return;
        pendingLoginRole = role;
        document.getElementById("roleChoiceView")?.classList.add("hidden");
        document.getElementById("roleLoginView")?.classList.remove("hidden");
        const title = document.getElementById("selectedRoleTitle");
        const desc = document.getElementById("selectedRoleDescription");
        if (title) title.innerText = role === "ambulance" ? "📱 Ambulance Sign In" : "🚦 Traffic Signal Sign In";
        if (desc) desc.innerText = role === "ambulance"
            ? "This device will be locked as the moving ambulance GPS transmitter."
            : "This device will be locked as the fixed laptop + ESP32 traffic signal.";
        const errorEl = document.getElementById("roleLoginError");
        if (errorEl) errorEl.classList.add("hidden");
        document.getElementById("roleUsername")?.focus();
    }

    function lockRoleUI() {
        document.getElementById("roleChoiceView")?.classList.add("hidden");
        document.getElementById("roleLoginView")?.classList.add("hidden");
        const locked = document.getElementById("roleLockedView");
        if (locked) {
            locked.classList.remove("hidden");
            const text = document.getElementById("lockedRoleText");
            if (text) text.innerHTML = `<div class="role-locked-badge">🔒 ${authenticatedRole === "ambulance" ? "📱 AMBULANCE DEVICE" : "🚦 TRAFFIC SIGNAL DEVICE"}</div>`;
        }
    }

    async function authenticatedFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (roleToken) headers.set("Authorization", `Bearer ${roleToken}`);
        return fetch(url, { ...options, headers });
    }

    // ====================================================================
    // MODE SWITCHING (Ambulance Mobile vs Traffic Control Laptop)
    // ====================================================================
    function setMode(mode) {
        if (mode !== "ambulance" && mode !== "traffic") return;
        if (authenticatedRole !== mode) {
            showRoleLogin(mode);
            return;
        }
        currentMode = mode;

        const ambPanel = document.getElementById("ambulancePanel");
        const trafPanel = document.getElementById("trafficPanel");
        const ambBtn = document.getElementById("ambulanceBtn");
        const trafBtn = document.getElementById("trafficBtn");

        if (ambBtn) ambBtn.classList.toggle("active", mode === "ambulance");
        if (trafBtn) trafBtn.classList.toggle("active", mode === "traffic");

        if (mode === "ambulance") {
            if (ambPanel) ambPanel.classList.remove("hidden");
            if (trafPanel) trafPanel.classList.add("hidden");
            updateModeBanner(`Active Mode: <strong style="color: #c62828;">📱 Ambulance Transmitter (Room: ${currentRoomId})</strong>`);
        } else if (mode === "traffic") {
            if (trafPanel) trafPanel.classList.remove("hidden");
            if (ambPanel) ambPanel.classList.add("hidden");
            updateModeBanner(`Active Mode: <strong style="color: #1565c0;">🚦 Traffic Control Center (Room: ${currentRoomId})</strong>`);
            renderTrafficVehiclesUI();

            // The laptop is the fixed traffic-signal location. Ask for its
            // location automatically when Traffic Control mode is opened.
            setTrafficSignalToLaptopLocation();
        }

        // Reconnect PeerJS for new role
        initPeerSync();

        // Invalidate map size to adapt to container layout
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 150);
    }
    window.setMode = setMode;

    function updateModeBanner(html) {
        const banner = document.getElementById("currentModeBanner");
        const modeSpan = document.getElementById("currentMode");
        if (modeSpan) modeSpan.innerHTML = html;
        if (banner) banner.classList.remove("hidden");
    }

    // ====================================================================
    // EVENT LISTENERS BINDING
    // ====================================================================
    function setupEventListeners() {
        // Role buttons are wired by setupRoleLogin().

        // Transmitter Controls
        bindClick("startTrackingBtn", startTracking);
        bindClick("stopTrackingBtn", stopTracking);
        bindClick("sendTestPingBtn", sendTestPing);
        bindClick("simulateBtn", toggleSimulation);

        // Vehicle Select & Display Name
        const vehicleSelect = document.getElementById("vehicleSelect");
        if (vehicleSelect) {
            vehicleSelect.addEventListener("change", (e) => {
                selectedVehicleId = e.target.value;
                const display = document.getElementById("activeVehicleDisplay");
                if (display) display.innerText = selectedVehicleId;
            });
        }

        bindClick("addCustomVehicleBtn", () => {
            const input = document.getElementById("customVehicleInput");
            if (!input) return;
            const raw = input.value.trim();
            if (!raw) {
                alert("Please enter a Custom Vehicle ID (e.g. RESCUE-99)");
                return;
            }
            const customId = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
            selectedVehicleId = customId;

            if (vehicleSelect) {
                const optExists = Array.from(vehicleSelect.options).some(o => o.value === customId);
                if (!optExists) {
                    const opt = document.createElement("option");
                    opt.value = customId;
                    opt.innerText = `🚑 ${customId} (Custom)`;
                    vehicleSelect.appendChild(opt);
                }
                vehicleSelect.value = customId;
            }

            const display = document.getElementById("activeVehicleDisplay");
            if (display) display.innerText = selectedVehicleId;
            input.value = "";
            updateAmbulanceStatus(`✅ Custom Vehicle ID "${selectedVehicleId}" registered and active!`);
        });

        const nameInput = document.getElementById("deviceDisplayNameInput");
        if (nameInput) {
            try {
                const saved = localStorage.getItem("ambulanceDisplayName");
                if (saved) nameInput.value = saved;
            } catch (e) {}

            nameInput.addEventListener("input", (e) => {
                try { localStorage.setItem("ambulanceDisplayName", e.target.value.trim()); } catch (err) {}
            });
        }

        // Traffic Control Signals & Map Controls
        // The signal location is always the physical laptop location.
        bindClick("useLaptopLocationBtn", setTrafficSignalToLaptopLocation);

        // Manual map placement is intentionally retained only as a fallback
        // for a GPS-permission failure during a classroom demo.
        bindClick("pickJunctionOnMapBtn", () => {
            pickJunctionMode = true;
            const btn = document.getElementById("pickJunctionOnMapBtn");
            if (btn) btn.innerText = "👇 Click map now!";
            updateTrafficStatus("📍 Fallback: click the map to place the physical signal.");
        });

        bindClick("recenterMapBtn", () => {
            autoCenterEnabled = true;
            recalculateActiveRoutes();
            updateTrafficStatus("🎯 Map recentered and fitted to active route.");
        });

        bindClick("toggleTrafficSignalsBtn", () => {
            if (!trafficJunctionMarker || !map) return;
            if (map.hasLayer(trafficJunctionMarker)) {
                map.removeLayer(trafficJunctionMarker);
                updateTrafficStatus("Traffic Signal icon hidden.");
            } else {
                map.addLayer(trafficJunctionMarker);
                updateTrafficStatus("Traffic Signal icon shown.");
            }
        });

        // Modals & QR Code
        setupPairingModalEvents();
        setupGpsHelpModalEvents();
    }

    function bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("click", handler);
        }
    }

    // ====================================================================
    // MODAL & QR CODE GENERATION
    // ====================================================================
    function setupPairingModalEvents() {
        const modal = document.getElementById("pairingModal");

        function openModal() {
            if (!modal) return;
            modal.classList.remove("hidden");
            generatePairingQrCode();
        }

        function closeModal() {
            if (modal) modal.classList.add("hidden");
        }

        bindClick("openPairingModalBtn", openModal);
        bindClick("showPairingInTrafficBtn", openModal);
        bindClick("roomPill", openModal);
        bindClick("closePairingModalBtn", closeModal);

        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) closeModal();
            });
        }

        bindClick("copyPairingUrlBtn", () => {
            const urlInput = document.getElementById("pairingUrlInput");
            const copyBtn = document.getElementById("copyPairingUrlBtn");
            if (urlInput) {
                urlInput.select();
                navigator.clipboard.writeText(urlInput.value).then(() => {
                    if (copyBtn) copyBtn.innerText = "✅ Copied!";
                    setTimeout(() => { if (copyBtn) copyBtn.innerText = "📋 Copy"; }, 2000);
                }).catch(() => {
                    document.execCommand("copy");
                    if (copyBtn) copyBtn.innerText = "✅ Copied!";
                    setTimeout(() => { if (copyBtn) copyBtn.innerText = "📋 Copy"; }, 2000);
                });
            }
        });

        bindClick("applyCustomRoomBtn", () => {
            const input = document.getElementById("customRoomInput");
            if (!input) return;
            const val = input.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
            if (val) {
                currentRoomId = val;
                try { localStorage.setItem("ambulanceTrackerRoom", currentRoomId); } catch (e) {}
                initializeRoomSystem();
                generatePairingQrCode();
                setupSyncTransports();
                alert(`Room successfully set to "${currentRoomId}"!`);
            }
        });
    }

    async function getPublicBaseUrl() {
        if (publicBaseUrl) return publicBaseUrl;
        try {
            const response = await fetch("/api/public-url", { cache: "no-store" });
            const data = await response.json();
            if (data && data.available && data.url) {
                publicBaseUrl = String(data.url).replace(/\/$/, "");
                return publicBaseUrl;
            }
        } catch (e) {
            console.warn("[PAIRING] Public URL lookup failed:", e);
        }
        return window.location.origin;
    }

    async function generatePairingQrCode() {
        const qrContainer = document.getElementById("qrcode");
        const urlInput = document.getElementById("pairingUrlInput");
        if (!qrContainer) return;

        qrContainer.innerHTML = "<div style=\"padding:20px;text-align:center;font-weight:600;\">Generating secure mobile link...</div>";

        let baseUrl = await getPublicBaseUrl();
        if (baseUrl.startsWith("file://")) baseUrl = "http://localhost:3000";

        const pairingUrl = `${baseUrl}/index.html?role=ambulance&room=${encodeURIComponent(currentRoomId)}`;
        if (urlInput) urlInput.value = pairingUrl;
        qrContainer.innerHTML = "";

        if (typeof QRCode !== "undefined") {
            try {
                new QRCode(qrContainer, {
                    text: pairingUrl,
                    width: 180,
                    height: 180,
                    colorDark: "#0f172a",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
                return;
            } catch (e) {
                console.warn("QRCode constructor error, falling back to image QR:", e);
            }
        }

        const encoded = encodeURIComponent(pairingUrl);
        const qrImg = document.createElement("img");
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}`;
        qrImg.alt = "Pairing QR Code";
        qrImg.style.width = "180px";
        qrImg.style.height = "180px";
        qrImg.style.borderRadius = "8px";
        qrContainer.appendChild(qrImg);
    }

    function setupGpsHelpModalEvents() {
        const modal = document.getElementById("gpsHelpModal");
        bindClick("alertHelpBtn", () => { if (modal) modal.classList.remove("hidden"); });
        bindClick("closeGpsHelpModalBtn", () => { if (modal) modal.classList.add("hidden"); });
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) modal.classList.add("hidden");
            });
        }
        bindClick("alertSimulateBtn", () => {
            if (currentMode !== "ambulance") setMode("ambulance");
            toggleSimulation();
        });
    }

    // ====================================================================
    // REAL-TIME MULTI-TRANSPORT SYNCHRONIZATION ENGINE
    // ====================================================================
    function setupSyncTransports() {
        initCloudMqttRelay();
        initLocalWebSocket();
        initPeerSync();

        // Heartbeat ping every 4s
        if (!window._heartbeatInterval) {
            window._heartbeatInterval = setInterval(sendHeartbeatPing, 4000);
        }
    }

    // 1. MQTT Cloud Relay
    function initCloudMqttRelay() {
        if (typeof mqtt === "undefined") {
            console.warn("MQTT.js library not detected. Local WebSockets will be used.");
            updateSyncStatus("yellow", "LAN Sync Ready");
            return;
        }

        const brokerUrl = "wss://broker.emqx.io:8084/mqtt";
        const clientId = `amb_${Math.random().toString(16).substring(2, 10)}`;

        try {
            if (mqttClient) {
                try { mqttClient.end(true); } catch (e) {}
            }

            mqttClient = mqtt.connect(brokerUrl, {
                clientId: clientId,
                clean: true,
                connectTimeout: 6000,
                reconnectPeriod: 3000
            });

            mqttClient.on("connect", () => {
                console.log("🟢 Connected to Cloud MQTT Relay:", brokerUrl);
                updateSyncStatus("green", "Cloud Relay Active");

                const topic = `ambulance-tracker/rooms/${currentRoomId}/#`;
                mqttClient.subscribe(topic, (err) => {
                    if (!err) console.log(`📡 Subscribed to MQTT topic: ${topic}`);
                });
            });

            mqttClient.on("message", (topic, message) => {
                try {
                    const payload = JSON.parse(message.toString());
                    handleIncomingTelemetry(payload, "MQTT Cloud Relay");
                } catch (e) {
                    console.error("MQTT message parse error:", e);
                }
            });

            mqttClient.on("error", (err) => {
                console.warn("MQTT Relay notice:", err);
            });

        } catch (e) {
            console.warn("MQTT setup notice:", e);
        }
    }

    // 2. Local Node.js WebSocket Sync
    function initLocalWebSocket() {
        if (window.location.protocol.startsWith("http")) {
            const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const wsUrl = `${wsProtocol}//${window.location.host}`;

            try {
                if (localWs) {
                    try { localWs.close(); } catch (e) {}
                }

                localWs = new WebSocket(wsUrl);

                localWs.onopen = () => {
                    console.log("🟢 Connected to Local Node.js WebSocket server:", wsUrl);
                    updateSyncStatus("green", "Local LAN WS Active");
                };

                localWs.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data && data.type !== "SYSTEM_HELLO") {
                            handleIncomingTelemetry(data, "Local WebSocket");
                        }
                    } catch (e) {
                        console.error("WS message parse error:", e);
                    }
                };

                localWs.onerror = () => {};
            } catch (e) {}
        }
    }

    // 3. PeerJS WebRTC Sync
    function initPeerSync() {
        if (typeof Peer === "undefined") return;

        try {
            const receiverPeerId = `amb-traffic-${currentRoomId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

            if (currentMode === "traffic") {
                if (peer) try { peer.destroy(); } catch (e) {}
                peer = new Peer(receiverPeerId);

                peer.on("open", (id) => {
                    console.log("🟢 Traffic Control Peer Receiver ready:", id);
                });

                peer.on("connection", (conn) => {
                    conn.on("data", (data) => {
                        handleIncomingTelemetry(data, "PeerJS WebRTC");
                    });
                });

                peer.on("error", () => {});

            } else if (currentMode === "ambulance") {
                if (peer) try { peer.destroy(); } catch (e) {}
                peer = new Peer();

                peer.on("open", () => {
                    try {
                        const conn = peer.connect(receiverPeerId);
                        conn.on("open", () => {
                            activePeerConnections[receiverPeerId] = conn;
                        });
                        conn.on("error", () => {});
                    } catch (e) {}
                });
            }
        } catch (e) {}
    }

    // Broadcast across all active transports
    function broadcastTelemetry(telemetryData) {
        totalPacketsTransmitted++;
        updatePacketCountDisplay();

        telemetryData.roomId = currentRoomId;
        telemetryData.clientTimestamp = Date.now();

        const payloadString = JSON.stringify(telemetryData);

        // MQTT Cloud Relay
        if (mqttClient && mqttClient.connected) {
            const topic = `ambulance-tracker/rooms/${currentRoomId}/telemetry`;
            mqttClient.publish(topic, payloadString);
        }

        // PHONE AMBULANCE MODE:
        // GPS telemetry is sent directly to the laptop Node.js server.
        // The server then broadcasts it to the Traffic Control dashboard.
        // This removes the need for an ambulance-side ESP32.
        const isGpsTelemetry = telemetryData &&
            telemetryData.latitude !== undefined &&
            telemetryData.longitude !== undefined &&
            telemetryData.vehicleId;

        if (currentMode === "ambulance" && isGpsTelemetry) {
            authenticatedFetch("/api/gps", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payloadString,
                keepalive: true
            })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
            })
            .catch(err => {
                console.warn("[PHONE GPS] Server transmission failed:", err);
                updateAmbulanceStatus("⚠️ GPS captured, but the KAAPAAN server is unreachable. Check the public HTTPS link / Internet connection.");
            });
        } else if (localWs && localWs.readyState === WebSocket.OPEN) {
            // Non-GPS messages (heartbeat etc.) continue through WebSocket.
            localWs.send(payloadString);
        }

        // PeerJS WebRTC
        Object.keys(activePeerConnections).forEach((id) => {
            const conn = activePeerConnections[id];
            if (conn && conn.open) {
                conn.send(telemetryData);
            }
        });
    }


    // ====================================================================
    // FIXED TRAFFIC SIGNAL LOCATION = THIS LAPTOP
    // ====================================================================
    function setTrafficSignalToLaptopLocation() {
        if (currentMode !== "traffic") return;

        if (!navigator.geolocation) {
            trafficSignalLocationReady = false;
            updateTrafficStatus("❌ This browser does not support location. Enable browser geolocation.");
            updateTrafficSignalLocationUI();
            return;
        }

        updateTrafficStatus("📍 Getting the physical Traffic Signal location from this laptop...");
        updateTrafficSignalLocationUI("detecting");

        if (trafficSignalLocationWatchId !== null) {
            navigator.geolocation.clearWatch(trafficSignalLocationWatchId);
        }

        trafficSignalLocationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = Number(position.coords.latitude);
                const lng = Number(position.coords.longitude);
                const accuracy = Number(position.coords.accuracy);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

                // Prefer a good fix. If we already have one, don't replace it
                // with a much worse Wi-Fi/cell estimate.
                if (trafficSignalLocationReady && Number.isFinite(accuracy) &&
                    Number.isFinite(window._kaapaanSignalAccuracy) &&
                    accuracy > window._kaapaanSignalAccuracy + 25) return;

                trafficJunctionLocation = [lat, lng];
                trafficSignalLocationReady = true;
                window._kaapaanSignalAccuracy = Number.isFinite(accuracy) ? accuracy : null;

                authenticatedFetch("/api/signal-location", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ latitude: lat, longitude: lng, accuracy: Number.isFinite(accuracy) ? accuracy : null })
                }).catch(err => console.warn("[KAAPAAN] Signal location API:", err));

                updateTrafficJunctionMarker();
                if (map && autoCenterEnabled) map.setView(trafficJunctionLocation, 17, { animate: true });
                updateTrafficSignalLocationUI();
                updateTrafficStatus(`📍 Traffic Signal = THIS LAPTOP / ESP32 setup (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
                recalculateActiveRoutes();
                renderTrafficVehiclesUI();

                try {
                    localStorage.setItem("kaapaanLaptopSignalLocation", JSON.stringify({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, timestamp: Date.now() }));
                } catch (e) {}
            },
            (error) => {
                console.warn("[KAAPAAN] Laptop geolocation error:", error);
                if (!trafficSignalLocationReady) {
                    let msg = "❌ Could not get laptop location.";
                    if (error.code === error.PERMISSION_DENIED) msg = "❌ Location permission denied. Allow location access for this site.";
                    if (error.code === error.TIMEOUT) msg = "⏳ Laptop location timed out. Click Refresh Laptop Location again.";
                    updateTrafficStatus(msg);
                    updateTrafficSignalLocationUI();
                }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    }

    function updateTrafficSignalLocationUI(state) {
        const statusEl = document.getElementById("signalLocationStatus");
        const coordsEl = document.getElementById("signalLocationCoords");
        const button = document.getElementById("useLaptopLocationBtn");

        if (statusEl) {
            if (state === "detecting") {
                statusEl.innerText = "📡 Detecting laptop location...";
            } else if (trafficSignalLocationReady && trafficJunctionLocation) {
                statusEl.innerText = "🟢 Fixed to this laptop";
            } else {
                statusEl.innerText = "🔴 Signal location not set";
            }
        }

        if (coordsEl) {
            coordsEl.innerText = trafficJunctionLocation
                ? `${trafficJunctionLocation[0].toFixed(6)}, ${trafficJunctionLocation[1].toFixed(6)}`
                : "Waiting for laptop GPS/location...";
        }

        if (button) {
            button.innerText = trafficSignalLocationReady
                ? "📍 Refresh Laptop Location"
                : "📍 Use This Laptop as Signal";
        }
    }

    // ====================================================================
    // KAAPAAN GPS-BASED TRAFFIC SIGNAL CONTROL
    // Ambulance GPS -> Website -> 750 m trigger -> Traffic ESP32
    // ====================================================================
    let kaapaanSignalState = "RED";
    let kaapaanAmbulanceInsideZone = false;
    let kaapaanAmbulancePassedJunction = false;
    let kaapaanGreenTimer = null;

    const KAAPAAN_ALERT_RADIUS_METERS = 750;
    const KAAPAAN_CROSSING_RADIUS_METERS = 50;
    const KAAPAAN_RESET_RADIUS_METERS = 150;
    const KAAPAAN_YELLOW_DURATION_MS = 5000;
    const KAAPAAN_GPS_STALE_MS = 15000;

    function kaapaanDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function sendSignalCommand(state, message) {
        authenticatedFetch("/api/signal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, message })
        }).catch(err => console.warn("[KAAPAAN] Signal API:", err));
    }

    function setKaapaanSignalState(state, message) {
        if (kaapaanSignalState === state) {
            // Keep the hardware/server state alive without causing UI churn.
            sendSignalCommand(state, message);
            return;
        }

        kaapaanSignalState = state;
        console.log(`[KAAPAAN SIGNAL] ${state} - ${message}`);

        sendSignalCommand(state, message);

        const badge = document.getElementById("routeAlertBadge");
        if (badge) {
            if (state === "RED") {
                badge.className = "status-badge normal";
                badge.innerText = "NORMAL - NO AMBULANCE";
            } else if (state === "YELLOW") {
                badge.className = "status-badge approaching";
                badge.innerText = "WARNING - AMBULANCE APPROACHING";
            } else {
                badge.className = "status-badge imminent";
                badge.innerText = "GREEN - AMBULANCE PRIORITY";
            }
        }

        updateTrafficStatus(message);
    }

    function processKaapaanAmbulanceSignal(ambulance) {
        if (currentMode !== "traffic" || !ambulance) return;

        const lat = Number(ambulance.latitude);
        const lng = Number(ambulance.longitude);
        if (!trafficSignalLocationReady || !Array.isArray(trafficJunctionLocation)) return;

        const junctionLat = Number(trafficJunctionLocation[0]);
        const junctionLng = Number(trafficJunctionLocation[1]);

        if (![lat, lng, junctionLat, junctionLng].every(Number.isFinite)) return;

        const timestamp = Number(ambulance.timestamp || Date.now());
        if (Date.now() - timestamp > KAAPAAN_GPS_STALE_MS) return;

        const distance = kaapaanDistanceMeters(
            lat, lng, junctionLat, junctionLng
        );

        const distanceEl = document.getElementById("routeDistance");
        if (distanceEl) distanceEl.innerText = `${(distance / 1000).toFixed(2)} km`;

        console.log(`[KAAPAAN] ${ambulance.vehicleId}: ${distance.toFixed(1)} m`);

        // Ambulance has entered the 750 m alert radius.
        if (distance <= KAAPAAN_ALERT_RADIUS_METERS &&
            !kaapaanAmbulanceInsideZone &&
            kaapaanSignalState === "RED") {

            kaapaanAmbulanceInsideZone = true;
            kaapaanAmbulancePassedJunction = false;

            setKaapaanSignalState(
                "YELLOW",
                "Ambulance approaching - 750 m alert"
            );

            if (kaapaanGreenTimer) clearTimeout(kaapaanGreenTimer);

            kaapaanGreenTimer = setTimeout(() => {
                if (kaapaanAmbulanceInsideZone &&
                    !kaapaanAmbulancePassedJunction) {
                    setKaapaanSignalState(
                        "GREEN",
                        "Green signal triggered - Ambulance on the way"
                    );
                }
            }, KAAPAAN_YELLOW_DURATION_MS);
        }

        // Ambulance has reached/crossed the junction.
        if (kaapaanAmbulanceInsideZone &&
            distance <= KAAPAAN_CROSSING_RADIUS_METERS) {

            kaapaanAmbulancePassedJunction = true;
        }

        // Reset only after it has crossed and moved away.
        if (kaapaanAmbulancePassedJunction &&
            distance > KAAPAAN_RESET_RADIUS_METERS) {

            kaapaanAmbulanceInsideZone = false;
            kaapaanAmbulancePassedJunction = false;

            if (kaapaanGreenTimer) {
                clearTimeout(kaapaanGreenTimer);
                kaapaanGreenTimer = null;
            }

            setKaapaanSignalState(
                "RED",
                "No ambulance on the way"
            );
        }
    }

    // Inbound telemetry handler
    function handleIncomingTelemetry(data, sourceChannel) {
        if (!data) return;

        // Ping / Pong Latency
        if (data.type === "PING_HEARTBEAT") {
            if (data.senderMode === "ambulance" && currentMode === "traffic") {
                broadcastTelemetry({
                    type: "PONG_HEARTBEAT",
                    originalTimestamp: data.timestamp,
                    senderMode: "traffic"
                });
            }
            return;
        }

        if (data.type === "PONG_HEARTBEAT") {
            if (data.originalTimestamp) {
                pingLatencyMs = Math.round(Date.now() - data.originalTimestamp);
                const pingEl = document.getElementById("pingMs");
                if (pingEl) pingEl.innerText = pingLatencyMs;
            }
            return;
        }

        if (!data.vehicleId || data.latitude === undefined || data.longitude === undefined) {
            return;
        }

        // Hardware GPS packets use the server-wide Kaapaan hardware channel.
        // Room filtering remains enabled for normal browser-to-browser telemetry.
        if (data.roomId && data.roomId !== currentRoomId &&
            data.type !== "GPS_TELEMETRY") {
            return;
        }

        totalPacketsTransmitted++;
        updatePacketCountDisplay();

        const vId = data.vehicleId;
        activeVehiclesData[vId] = data;

        updateVehicleMarkerOnMap(vId, data);
        recalculateActiveRoutes();

        if (currentMode === "traffic") {
            processKaapaanAmbulanceSignal(data);
            renderTrafficVehiclesUI();
            updateTrafficStatus(`🟢 Live telemetry packet received from ${data.displayName || vId} via ${sourceChannel}`);
        }
    }

    function sendHeartbeatPing() {
        lastPingSentTime = Date.now();
        broadcastTelemetry({
            type: "PING_HEARTBEAT",
            timestamp: lastPingSentTime,
            senderMode: currentMode || "unknown"
        });
    }

    function updateSyncStatus(color, text) {
        const pill = document.getElementById("syncStatusPill");
        const textEl = document.getElementById("syncStatusText");
        if (pill) {
            const dot = pill.querySelector(".sync-dot");
            if (dot) dot.className = `sync-dot ${color}`;
        }
        if (textEl) textEl.innerText = text;
    }

    function updatePacketCountDisplay() {
        const countEl = document.getElementById("packetCount");
        if (countEl) countEl.innerText = totalPacketsTransmitted;
    }

    // ====================================================================
    // GPS TRACKING (MOBILE TRANSMITTER)
    // ====================================================================
    function startTracking() {
        if (!navigator.geolocation) {
            updateAmbulanceStatus("❌ Geolocation is not supported by this browser.");
            return;
        }

        updateAmbulanceStatus("📡 Requesting high-accuracy GPS satellite fix...");

        const startBtn = document.getElementById("startTrackingBtn");
        const stopBtn = document.getElementById("stopTrackingBtn");
        const badge = document.getElementById("transmitterStatusBadge");

        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (badge) {
            badge.className = "badge badge-pulse live";
            badge.innerText = "TRANSMITTING";
        }

        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
        }

        watchId = navigator.geolocation.watchPosition(
            handleGpsPosition,
            handleGpsError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    }
    window.startTracking = startTracking;

    function handleGpsPosition(pos) {
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        const accuracy = Number(pos.coords.accuracy);
        const speed = Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? pos.coords.speed : 0;
        const heading = Number.isFinite(pos.coords.heading) ? pos.coords.heading : null;
        const timestamp = Date.now();

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        // Reject clearly unusable fixes once a reliable fix has been acquired.
        // A first fix is accepted so the demo can start even indoors.
        if (lastAcceptedGps && Number.isFinite(accuracy) && accuracy > 100) {
            return;
        }

        // Reject physically impossible jumps unless the browser itself reports a
        // high speed. This prevents Wi-Fi/cell-location glitches from moving
        // the ambulance marker hundreds of metres in one update.
        if (lastAcceptedGps) {
            const dt = Math.max(0.5, (timestamp - lastAcceptedGps.timestamp) / 1000);
            const jumpMeters = kaapaanDistanceMeters(lastAcceptedGps.lat, lastAcceptedGps.lng, lat, lng);
            const reportedSpeed = speed > 0 ? speed : 0;
            const maxAllowed = Math.max(120, reportedSpeed * dt * 3.0 + 80);
            if (jumpMeters > maxAllowed && (!Number.isFinite(accuracy) || accuracy > 50)) return;
        }

        // Keep network traffic predictable: transmit at most once per second.
        if (timestamp - lastGpsTransmitAt < 1000) return;
        lastGpsTransmitAt = timestamp;
        lastAcceptedGps = { lat, lng, accuracy, timestamp };

        const nameInput = document.getElementById("deviceDisplayNameInput");
        const typedName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : "";
        const displayName = typedName || `Ambulance ${selectedVehicleId}`;

        // Update Transmitter UI Metrics
        const latEl = document.getElementById("latitude");
        const lngEl = document.getElementById("longitude");
        const accEl = document.getElementById("accuracy");
        const spdEl = document.getElementById("speed");
        const updEl = document.getElementById("lastUpdate");

        if (latEl) latEl.innerText = lat.toFixed(6);
        if (lngEl) lngEl.innerText = lng.toFixed(6);
        if (accEl) accEl.innerText = accuracy !== null ? `${accuracy.toFixed(1)} m` : "Unavailable";
        if (spdEl) spdEl.innerText = speed !== null ? `${(speed * 3.6).toFixed(1)} km/h` : "0.0 km/h";
        if (updEl) updEl.innerText = new Date(timestamp).toLocaleTimeString();

        const telemetryPayload = {
            vehicleId: selectedVehicleId,
            displayName: displayName,
            deviceName: detectDeviceName(),
            latitude: lat,
            longitude: lng,
            accuracy: accuracy,
            speed: speed,
            heading: heading,
            timestamp: timestamp
        };

        activeVehiclesData[selectedVehicleId] = telemetryPayload;
        updateVehicleMarkerOnMap(selectedVehicleId, telemetryPayload);
        recalculateActiveRoutes();
        broadcastTelemetry(telemetryPayload);

        updateAmbulanceStatus(`🟢 Live GPS broadcast active (${selectedVehicleId})`);
    }

    function handleGpsError(err) {
        console.error("GPS Error:", err);
        let msg = "GPS error occurred.";

        switch (err.code) {
            case err.PERMISSION_DENIED:
                msg = "❌ Location permission denied. Please allow location or use Simulation mode.";
                const alertBox = document.getElementById("insecureOriginAlert");
                if (alertBox) alertBox.classList.remove("hidden");
                break;
            case err.POSITION_UNAVAILABLE:
                msg = "❌ GPS position unavailable (weak satellite signal).";
                break;
            case err.TIMEOUT:
                msg = "⏳ GPS request timed out. Retrying...";
                break;
        }

        updateAmbulanceStatus(msg);
    }

    function stopTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        const startBtn = document.getElementById("startTrackingBtn");
        const stopBtn = document.getElementById("stopTrackingBtn");
        const badge = document.getElementById("transmitterStatusBadge");

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (badge) {
            badge.className = "badge badge-pulse";
            badge.innerText = "STANDBY";
        }

        updateAmbulanceStatus("⏹️ GPS tracking stopped.");
    }
    window.stopTracking = stopTracking;

    function sendTestPing() {
        const lat = 13.0700 + (Math.random() - 0.5) * 0.02;
        const lng = 80.2600 + (Math.random() - 0.5) * 0.02;

        const testData = {
            vehicleId: selectedVehicleId,
            displayName: `Ambulance ${selectedVehicleId}`,
            deviceName: detectDeviceName(),
            latitude: lat,
            longitude: lng,
            accuracy: 4.0,
            speed: 10.0,
            heading: 90,
            timestamp: Date.now()
        };

        activeVehiclesData[selectedVehicleId] = testData;
        updateVehicleMarkerOnMap(selectedVehicleId, testData);
        recalculateActiveRoutes();
        broadcastTelemetry(testData);

        const latEl = document.getElementById("latitude");
        const lngEl = document.getElementById("longitude");
        const spdEl = document.getElementById("speed");
        const updEl = document.getElementById("lastUpdate");

        if (latEl) latEl.innerText = lat.toFixed(6);
        if (lngEl) lngEl.innerText = lng.toFixed(6);
        if (spdEl) spdEl.innerText = "36.0 km/h";
        if (updEl) updEl.innerText = new Date().toLocaleTimeString();

        updateAmbulanceStatus(`⚡ Test telemetry packet sent to Room ${currentRoomId}!`);
    }
    window.sendTestPing = sendTestPing;

    // ====================================================================
    // SIMULATION MODE
    // ====================================================================
    function toggleSimulation() {
        const btn = document.getElementById("simulateBtn");

        if (simulatedVehicleActive) {
            simulatedVehicleActive = false;
            clearInterval(simulationTimer);
            simulationTimer = null;
            if (btn) btn.innerText = "🚗 Simulate Movement";
            updateAmbulanceStatus("⏹️ Simulation stopped.");
        } else {
            simulatedVehicleActive = true;
            if (btn) btn.innerText = "⏹️ Stop Simulation";
            updateAmbulanceStatus(`🚗 Simulating real-time movement for ${selectedVehicleId}...`);

            // Start near Chennai Anna Salai
            simLat = 13.0450;
            simLng = 80.2400;

            simulationTimer = setInterval(() => {
                if (!trafficSignalLocationReady || !Array.isArray(trafficJunctionLocation)) {
                    updateTrafficStatus("📍 Set the physical laptop signal location before starting simulation.");
                    return;
                }

                const targetLat = trafficJunctionLocation[0];
                const targetLng = trafficJunctionLocation[1];

                const step = 0.0004; // ~40 km/h step
                simLat += (targetLat > simLat ? step : -step) + (Math.random() - 0.5) * 0.00008;
                simLng += (targetLng > simLng ? step : -step) + (Math.random() - 0.5) * 0.00008;

                const simData = {
                    vehicleId: selectedVehicleId,
                    displayName: `Simulated Ambulance (${selectedVehicleId})`,
                    deviceName: "🚗 Virtual Mobile",
                    latitude: simLat,
                    longitude: simLng,
                    accuracy: 3.5,
                    speed: 11.2, // ~40 km/h
                    heading: 45,
                    timestamp: Date.now()
                };

                activeVehiclesData[selectedVehicleId] = simData;
                updateVehicleMarkerOnMap(selectedVehicleId, simData);
                recalculateActiveRoutes();
                broadcastTelemetry(simData);

                if (currentMode === "ambulance") {
                    const latEl = document.getElementById("latitude");
                    const lngEl = document.getElementById("longitude");
                    const spdEl = document.getElementById("speed");
                    const updEl = document.getElementById("lastUpdate");

                    if (latEl) latEl.innerText = simLat.toFixed(6);
                    if (lngEl) lngEl.innerText = simLng.toFixed(6);
                    if (spdEl) spdEl.innerText = "40.3 km/h";
                    if (updEl) updEl.innerText = new Date().toLocaleTimeString();
                }

            }, 1200);
        }
    }
    window.toggleSimulation = toggleSimulation;

    // ====================================================================
    // TRAFFIC CONTROL UI RENDERING
    // ====================================================================
    function renderTrafficVehiclesUI() {
        const listContainer = document.getElementById("trafficVehiclesList");
        const countBadge = document.getElementById("activeUnitsCount");
        if (!listContainer) return;

        const vehicleKeys = Object.keys(activeVehiclesData);

        if (countBadge) {
            countBadge.innerText = `${vehicleKeys.length} Connected`;
        }

        if (vehicleKeys.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state-card">
                    <div class="empty-icon">📱</div>
                    <h4>No active mobile GPS signals received yet</h4>
                    <p>Open this page on your mobile phone in <strong>Ambulance Mode</strong> with Room <code id="emptyRoomCode">${currentRoomId}</code>, or click <strong>Pair Mobile (QR)</strong> above.</p>
                </div>
            `;
            return;
        }

        let html = "";
        if (!trafficSignalLocationReady || !Array.isArray(trafficJunctionLocation)) {
            listContainer.innerHTML = `
                <div class="empty-state-card">
                    <div class="empty-icon">📍</div>
                    <h4>Set the physical signal location first</h4>
                    <p>The traffic signal is this laptop + ESP32 + LCD/LED setup. Click <strong>Use This Laptop as Signal</strong>.</p>
                </div>`;
            return;
        }

        vehicleKeys.forEach((vId) => {
            const item = activeVehiclesData[vId];
            if (!item) return;

            const secondsAgo = item.timestamp ? Math.floor((Date.now() - item.timestamp) / 1000) : 999;
            let connectionBadge = `<span class="vehicle-badge active">🟢 ONLINE (${secondsAgo}s)</span>`;
            if (secondsAgo > 30) {
                connectionBadge = `<span class="vehicle-badge" style="background:#ef4444; color:white;">🔴 OFFLINE (${secondsAgo}s)</span>`;
            } else if (secondsAgo > 10) {
                connectionBadge = `<span class="vehicle-badge" style="background:#f59e0b; color:white;">🟡 IDLE (${secondsAgo}s)</span>`;
            }

            const { distKm, etaMins } = calculateDirectDistanceAndEta(
                trafficJunctionLocation[0],
                trafficJunctionLocation[1],
                Number(item.latitude),
                Number(item.longitude)
            );

            const isSelected = selectedVehicleId === vId;
            const colorClass = vId.toLowerCase();

            html += `
                <div class="vehicle-card ${colorClass} ${isSelected ? 'selected-route-card' : ''}">
                    <div class="vehicle-header">
                        <h3>🚑 ${item.displayName || vId}</h3>
                        ${connectionBadge}
                    </div>
                    <div class="vehicle-body">
                        <p><span>ID:</span> <strong>${vId}</strong></p>
                        <p><span>Distance to Signal:</span> <strong style="color:#0284c7;">${distKm} km</strong></p>
                        <p><span>Estimated Time (ETA):</span> <strong style="color:#16a34a;">${etaMins} mins</strong></p>
                        <p><span>Coordinates:</span> <code>${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}</code></p>
                        <p><span>Speed:</span> <strong>${item.speed ? (item.speed * 3.6).toFixed(1) + " km/h" : "0.0 km/h"}</strong></p>
                        <p><span>Accuracy:</span> <strong>${item.accuracy ? item.accuracy.toFixed(1) + " m" : "--"}</strong></p>
                    </div>
                    <button class="btn-xs btn-primary" style="width: 100%; margin-top: 10px;" onclick="window.focusAndRouteToVehicle('${vId}')">
                        🎯 Focus Route on ${vId}
                    </button>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    }

    function calculateDirectDistanceAndEta(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = (R * c * 1.25).toFixed(2);
        const etaMins = Math.max(1, Math.round(distKm * 2.0));
        return { distKm, etaMins };
    }

    function focusAndRouteToVehicle(vId) {
        selectedVehicleId = vId;
        const display = document.getElementById("activeVehicleDisplay");
        if (display) display.innerText = selectedVehicleId;
        renderTrafficVehiclesUI();
        recalculateActiveRoutes();
    }
    window.focusAndRouteToVehicle = focusAndRouteToVehicle;

    // ====================================================================
    // MAP MARKERS & OSRM DRIVING ROUTE
    // ====================================================================
    function updateVehicleMarkerOnMap(vehicleId, data) {
        if (!map || typeof L === "undefined") return;

        const lat = Number(data.latitude);
        const lng = Number(data.longitude);
        const pos = [lat, lng];

        const iconHtml = `<div style="background:#dc2626; color:white; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 3px 8px rgba(0,0,0,0.4); border:2px solid white;">🚑</div>`;
        const ambulanceIcon = L.divIcon({
            className: "custom-amb-icon",
            html: iconHtml,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        const popup = `
            <div style="font-family: inherit; font-size: 13px;">
                <b style="color: #c62828;">🚑 ${data.displayName || vehicleId}</b><br>
                <b>ID:</b> ${vehicleId}<br>
                <b>Lat:</b> ${lat.toFixed(6)} | <b>Lng:</b> ${lng.toFixed(6)}<br>
                <b>Updated:</b> ${new Date(data.timestamp || Date.now()).toLocaleTimeString()}
            </div>
        `;

        if (!markersMap[vehicleId]) {
            markersMap[vehicleId] = L.marker(pos, { icon: ambulanceIcon }).addTo(map).bindPopup(popup);
        } else {
            markersMap[vehicleId].setLatLng(pos);
            markersMap[vehicleId].getPopup().setContent(popup);
        }

        // Breadcrumb Trail
        if (!vehicleHistoryMap[vehicleId]) vehicleHistoryMap[vehicleId] = [];
        const history = vehicleHistoryMap[vehicleId];
        history.push(pos);
        if (history.length > 250) history.shift();

        if (!vehicleTrailsMap[vehicleId]) {
            vehicleTrailsMap[vehicleId] = L.polyline(history, {
                color: "#dc2626",
                weight: 3,
                opacity: 0.7,
                dashArray: "4, 6"
            }).addTo(map);
        } else {
            vehicleTrailsMap[vehicleId].setLatLngs(history);
        }
    }

    function updateTrafficJunctionMarker() {
        if (!map || typeof L === "undefined") return;
        if (!Array.isArray(trafficJunctionLocation) || trafficJunctionLocation.length !== 2) {
            if (trafficJunctionMarker) {
                map.removeLayer(trafficJunctionMarker);
                trafficJunctionMarker = null;
            }
            return;
        }

        const popup = `
            <div style="font-family: inherit; font-size: 13px;">
                <b style="color: #15803d;">🚦 Traffic Signal Control Post</b><br>
                <b>Lat:</b> ${trafficJunctionLocation[0].toFixed(5)}<br>
                <b>Lng:</b> ${trafficJunctionLocation[1].toFixed(5)}
            </div>
        `;

        if (!trafficJunctionMarker) {
            const trafficIcon = L.divIcon({
                className: "traffic-post-icon",
                html: "<div style='font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));'>🚦</div>",
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            trafficJunctionMarker = L.marker(trafficJunctionLocation, { icon: trafficIcon })
                .addTo(map)
                .bindPopup(popup);
        } else {
            trafficJunctionMarker.setLatLng(trafficJunctionLocation);
            trafficJunctionMarker.getPopup().setContent(popup);
        }
    }

    async function recalculateActiveRoutes() {
        updateTrafficJunctionMarker();
        if (!trafficSignalLocationReady || !Array.isArray(trafficJunctionLocation)) return;

        const keys = Object.keys(activeVehiclesData);
        if (keys.length === 0) return;

        const activeId = activeVehiclesData[selectedVehicleId] ? selectedVehicleId : keys[0];
        const amb = activeVehiclesData[activeId];
        if (!amb) return;

        const now = Date.now();
        if (now - lastRoutingTime < 1000) return;
        lastRoutingTime = now;

        const ambCoords = [Number(amb.latitude), Number(amb.longitude)];
        const trafficCoords = trafficJunctionLocation;

        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${ambCoords[1]},${ambCoords[0]};${trafficCoords[1]},${trafficCoords[0]}?overview=full&geometries=geojson`;

        try {
            const res = await fetch(osrmUrl);
            const data = await res.json();

            if (data.code === "Ok" && data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const distKm = (route.distance / 1000).toFixed(2);
                const durationMins = Math.max(1, Math.round(route.duration / 60));
                const latLngs = route.geometry.coordinates.map(c => [c[1], c[0]]);

                if (routePolyline && map) map.removeLayer(routePolyline);

                if (map) {
                    routePolyline = L.polyline(latLngs, {
                        color: "#0284c7",
                        weight: 6,
                        opacity: 0.85,
                        lineJoin: "round"
                    }).addTo(map);
                }

                updateRouteTelemetryUI(distKm, durationMins);

                if (autoCenterEnabled && map) {
                    const bounds = L.latLngBounds([trafficCoords, ambCoords]);
                    map.fitBounds(bounds, { padding: [50, 50] });
                }
            } else {
                fallbackDirectLine(ambCoords, trafficCoords);
            }
        } catch (e) {
            fallbackDirectLine(ambCoords, trafficCoords);
        }
    }

    function fallbackDirectLine(ambCoords, trafficCoords) {
        const { distKm, etaMins } = calculateDirectDistanceAndEta(
            trafficCoords[0], trafficCoords[1],
            ambCoords[0], ambCoords[1]
        );

        if (routePolyline && map) map.removeLayer(routePolyline);
        if (map && typeof L !== "undefined") {
            routePolyline = L.polyline([ambCoords, trafficCoords], {
                color: "#dc2626",
                weight: 4,
                dashArray: "6, 6"
            }).addTo(map);
        }

        updateRouteTelemetryUI(distKm, etaMins);
    }

    function updateRouteTelemetryUI(distKm, durationMins) {
        const distEl = document.getElementById("routeDistance");
        const etaEl = document.getElementById("routeETA");
        const badgeEl = document.getElementById("routeAlertBadge");

        if (distEl) distEl.innerText = `${distKm} km`;
        if (etaEl) etaEl.innerText = `${durationMins} mins`;

        if (badgeEl) {
            const d = Number(distKm);
            if (d < 1.0) {
                badgeEl.className = "status-badge imminent";
                badgeEl.innerText = `🚨 IMMINENT (< 1 km) - CLEAR SIGNAL`;
            } else if (d < 3.0) {
                badgeEl.className = "status-badge approaching";
                badgeEl.innerText = `⚠️ APPROACHING (${distKm} km)`;
            } else {
                badgeEl.className = "status-badge normal";
                badgeEl.innerText = `🟢 IN TRANSIT (${distKm} km)`;
            }
        }
    }

    // ====================================================================
    // HELPERS
    // ====================================================================
    function detectDeviceName() {
        const ua = navigator.userAgent;
        if (/android/i.test(ua)) return "📱 Android Mobile";
        if (/iphone|ipad|ipod/i.test(ua)) return "📱 Apple iOS Device";
        if (/windows/i.test(ua)) return "💻 Windows PC";
        if (/macintosh/i.test(ua)) return "💻 Mac Computer";
        return "📱 Mobile Device";
    }

    function updateAmbulanceStatus(msg) {
        const el = document.getElementById("status");
        if (el) el.innerText = msg;
    }

    function updateTrafficStatus(msg) {
        const el = document.getElementById("trafficStatus");
        if (el) el.innerText = msg;
    }

})();
