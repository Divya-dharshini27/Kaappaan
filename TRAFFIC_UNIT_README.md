# 🚑 KAAPPAAN — Traffic Unit & System Implementation Guide

> **KAAPPAAN** — IoT-Based Ambulance Alert & Smart Traffic Prioritization System  
> ESP32 + LCD + LED + React + Node.js + Socket.IO + OpenStreetMap

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Role Descriptions](#role-descriptions)
3. [Traffic Unit — How It Works](#traffic-unit-tab)
4. [750 m Proximity Alert Logic](#750-m-proximity-alert-logic)
5. [Driver Auto-Location](#driver-auto-location)
6. [Police Dashboard — Dispatch Instructions](#police-dashboard)
7. [Control Room — History & Terminate](#control-room)
8. [Hardware Wiring (ESP32 + LCD + LED)](#hardware-wiring)
9. [System Flow Diagram](#system-flow-diagram)
10. [How to Run](#how-to-run)
11. [Credentials](#credentials)

---

## System Overview

KAAPPAAN is a real-time ambulance alert system with three portals:

| Portal | URL Tab | Who uses it |
|--------|---------|-------------|
| **KAAPPAAN Fleet Hub** | Default | Driver, Police, Control Room login |
| **TRAFFIC UNIT** | Second tab | Laptop running ESP32 USB — reads its own GPS |

When the ambulance driver's phone gets within **750 metres** of the Traffic Unit laptop:
- An **alert panel** flashes on the TRAFFIC UNIT screen
- The **ESP32 triggers** → LCD shows "AMBULANCE APPROACHING — GIVE WAY" + LED turns ON
- The Police and Control Room receive the emergency

---

## Role Descriptions

### 🚑 Driver
- Logs in from their **phone browser** (mobile Chrome)
- Location is **auto-detected** on login (no button press)
- Selects destination hospital → OSRM shows shortest route
- Sets status: Offline / Online / Emergency

### 👮 Police (was "Admin")
- Logs in from a dedicated device or PC
- Sees **live map** of all ambulances with real-time status
- Receives emergency alert popups → dispatches alert to Control Room
- Sends **customizable instructions** to Control Room (presets or free-text)
  - e.g., "Clear Traffic Now", "Look for Large Vehicles", "Block Side Roads"

### 🎛 Control Room
- Logs in from a command centre PC
- Sees **full ambulance history log** — every emergency forwarded from Police
- Each entry has a **⛔ TERMINATE EMERGENCY** button to turn off ESP32 + mark resolved
- Receives **live Police dispatch instruction feed** in real time
- No LCD/LED manual controls (hardware is managed automatically)

### 🚦 Traffic Unit (This Laptop)
- **No login needed** — a separate top-level tab
- Reads the laptop's GPS via the browser `navigator.geolocation` API
- Acts as the **fixed traffic signal anchor** point
- Streams location to server → ESP32 logic runs here
- Shows all live ambulances and their distance on a Leaflet map

---

## Traffic Unit Tab

Open the app and click **🚦 TRAFFIC UNIT** in the top nav.

### What it does automatically:
1. Browser requests location permission (one-time on first open)
2. Continuously reads your laptop's GPS coordinates via `watchPosition()`
3. Sends coordinates to `/api/signal-location` every position update
4. Connects to Socket.IO and listens for ambulance GPS beacons (`kaapaan_gps` events)
5. Calculates real-time Haversine distance from laptop → each ambulance
6. When any ambulance enters **≤ 750 m**:
   - Flashing red alert panel appears (distance, ETA, "GIVE WAY")
   - `POST /emergency/on` is called → ESP32 activates LCD + LED
7. When all ambulances move **> 750 m** away:
   - Alert clears
   - `POST /emergency/off` is called → ESP32 deactivates

### Manual controls:
- **📍 Re-read GPS** — force re-acquires laptop location (useful after moving)

> **Note on laptop GPS accuracy:** Most laptops use Wi-Fi triangulation or IP-based location (low accuracy). For a prototype demo, this is acceptable — the threshold is 750 m. For production, attach a USB GPS module.

---

## 750 m Proximity Alert Logic

Distance is calculated using the **Haversine formula** (great-circle distance):

```
d = 2R × arcsin(√(sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)))
```

Where R = 6,371,000 m (Earth radius).

**ETA estimate** = `distanceM / 8` seconds (assumes ~30 km/h average urban speed).

| Distance | Action |
|----------|--------|
| > 750 m | No alert, ESP32 standby |
| ≤ 750 m | 🚨 Alert fires, ESP32 ON |
| Back > 750 m | Alert clears, ESP32 OFF |

The ESP32 is triggered **only on state change** (no redundant calls).

---

## Driver Auto-Location

When a driver logs in on their phone:

1. `navigator.geolocation.getCurrentPosition()` fires immediately on mount (silent, no button)
2. On first fix: coordinates fill in, map centers, nearby hospitals load
3. `navigator.geolocation.watchPosition()` keeps tracking continuously in the background
4. Every position update: emits `driver_location` via Socket.IO + calls `/api/driver/update-location`
5. The **"Refresh Location"** button forces a re-acquire if GPS drifted

> **Important:** On mobile Chrome, allow location permission when prompted. GPS is most accurate outdoors or near windows.

---

## Police Dashboard

Login: Username `admin`, Password `admin123`, Role: **👮 Police**

### Features:
- **Live Fleet Map** — all ambulances shown as coloured markers (🟢 online / 🔴 emergency)
- **Driver List** — click any driver row to zoom map to their location
- **Emergency Popup** — fires when any driver hits emergency mode
  - "📡 Dispatch Alert to Control Room" sends the alert to Control Room history
- **Dispatch Instructions Panel:**
  - 6 preset quick-action buttons
  - Free-text custom instruction field (press Enter or Send)
  - All instructions are broadcast via Socket.IO to the Control Room's instruction feed
  - Instructions are logged with timestamp in Police's own session

### Preset Instructions:
| Button | Message sent |
|--------|-------------|
| 🚧 Clear Traffic Now | "Clear all traffic immediately — ambulance en route!" |
| 🚛 Watch for Large Vehicles | "Look for large vehicles blocking the route..." |
| 🛑 Block Side Roads | "Block side roads at the junction..." |
| 🔊 Activate Siren Protocol | "Activate siren protocol — all units alert the public." |
| 📍 Hold at Junction | "Hold position at junction — ambulance arriving in <2 min." |
| ✅ Situation Clear | "Situation resolved — resume normal traffic flow." |

---

## Control Room

Login: Username `controlroom`, Password `controlroom123`, Role: **🎛 Control Room**

### Features:
- **Ambulance History Log** — every emergency dispatched by Police appears here
  - Shows: driver name, vehicle number, GPS coordinates, timestamp, who dispatched it
  - Click a card to zoom the map to that location
- **⛔ TERMINATE EMERGENCY** button on each active card:
  - Calls `POST /emergency/off` → ESP32 LCD + LED turn off
  - Marks the card as "Resolved" (greyed out, strikethrough)
  - Broadcasts `emergency_terminated` event to all connected clients
- **Police Dispatch Instruction Feed** (bottom) — live scrolling feed of all Police instructions

> LCD and LED are **not manually controlled** from this screen. Hardware is managed automatically by the Traffic Unit tab (750 m logic) and can only be deactivated via the Terminate button.

---

## Hardware Wiring

### Components:
- ESP32 DevKit (any variant)
- 20×4 I2C LCD (address `0x27`)
- Red LED (or relay)
- Resistor (220Ω for LED)

### Wiring:

| Component | ESP32 Pin |
|-----------|-----------|
| LED + (anode) | GPIO 2 (via 220Ω resistor) |
| LED − (cathode) | GND |
| LCD SDA | GPIO 21 |
| LCD SCL | GPIO 22 |
| LCD VCC | 5V |
| LCD GND | GND |

### ESP32 Arduino Sketch (Updated with LCD):

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";

const int LED_PIN = 2;
LiquidCrystal_I2C lcd(0x27, 20, 4);
WebServer server(80);
bool isEmergency = false;

void sendJson(int code, const char* status) {
  StaticJsonDocument<64> doc;
  doc["status"] = status;
  String body;
  serializeJson(doc, body);
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(code, "application/json", body);
}

void setEmergency(bool on) {
  isEmergency = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  lcd.clear();
  if (on) {
    lcd.setCursor(0, 0); lcd.print("AMBULANCE COMING!   ");
    lcd.setCursor(0, 1); lcd.print("GIVE WAY            ");
    lcd.setCursor(0, 2); lcd.print("GREEN SIGNAL ONLY   ");
    lcd.setCursor(0, 3); lcd.print("FOR AMBULANCE       ");
  } else {
    lcd.setCursor(0, 0); lcd.print("KAAPPAAN TRAFFIC    ");
    lcd.setCursor(0, 1); lcd.print("UNIT STANDBY        ");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  lcd.init();
  lcd.backlight();
  setEmergency(false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nESP32 IP: ");
  Serial.println(WiFi.localIP());

  server.on("/emergency/on",  HTTP_POST, []() { setEmergency(true);  sendJson(200, "on");  });
  server.on("/emergency/off", HTTP_POST, []() { setEmergency(false); sendJson(200, "off"); });
  server.on("/status", HTTP_GET, []() {
    StaticJsonDocument<64> d;
    d["state"] = isEmergency ? "emergency" : "standby";
    String b; serializeJson(d, b);
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", b);
  });
  server.onNotFound([]() { server.send(404, "application/json", "{\"error\":\"not found\"}"); });
  server.begin();
}

void loop() { server.handleClient(); }
```

**Required Arduino Libraries** (install via Library Manager):
- `ArduinoJson` by Benoit Blanchon
- `LiquidCrystal I2C` by Frank de Brabander

After flashing, open Serial Monitor at 115200 baud and note the IP address. Set it in `server/.env`:
```
ESP32_IP=192.168.x.x
```

---

## System Flow Diagram

```
[Driver Phone]
    │ GPS stream (Socket.IO kaapaan_gps)
    ▼
[Node.js Server] ──────────────────────────────────────────┐
    │                                                       │
    │ broadcast kaapaan_gps                                 │
    ▼                                                       │
[TRAFFIC UNIT Tab (Laptop)]                                 │
    │ Haversine ≤ 750m?                                     │
    │ YES → POST /emergency/on                              │
    │                                                       │
    ▼                                                       │
[ESP32] → LED ON + LCD: "AMBULANCE COMING / GIVE WAY"      │
                                                            │
[Driver hits Emergency status]                             │
    │ Socket → driver_status emergency                      │
    ▼                                                       │
[Police Dashboard]                                         │
    │ Popup: "Dispatch Alert to Control Room"               │
    │ Socket → forward_to_controlroom                       │
    │ Socket → police_instruction (custom message)          │
    ▼                                                       │
[Control Room Dashboard]                                   │
    │ History log entry appears                             │
    │ Police instruction feed updates                       │
    │ Click ⛔ TERMINATE → POST /emergency/off              │
    ▼                                                       │
[ESP32] → LED OFF + LCD: "STANDBY" ◄─────────────────────┘
```

---

## How to Run

### Prerequisites
- Node.js 18+
- npm

### Steps

```bash
# From the kaapaan/ root folder
npm install         # install root deps
cd server && npm install
cd ../client && npm install
cd ..

# Start everything
START_UNIFIED_APP.bat
```

Or manually:
```bash
# Terminal 1 — Backend
cd server
node server.js

# Terminal 2 — Frontend
cd client
npm run dev
```

Open `http://localhost:5000` in your browser.

For driver phones: open `http://<your-laptop-IP>:5000` on the phone browser (same Wi-Fi network).

---

## Credentials

| Role | Username | Password | Login Tab |
|------|----------|----------|-----------|
| Driver | `driver1` / `driver2` / `driver3` | `driver123` | 🚑 Driver |
| Police | `admin` | `admin123` | 👮 Police |
| Control Room | `controlroom` | `controlroom123` | 🎛 Control Room |
| Traffic Unit | *(no login)* | — | 🚦 TRAFFIC UNIT tab |

---

## Environment Variables (`server/.env`)

```env
PORT=5000
ESP32_IP=10.180.130.118   # Change to your actual ESP32 IP
```

---

*KAAPPAAN v2.0 — IoT Ambulance Alert & Smart Traffic Prioritization*
