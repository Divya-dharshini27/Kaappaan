# 🚑 KAAPPAAN — Smart Ambulance Traffic Alert & Fleet Prioritization System

A full-stack Emergency Vehicle Tracking and Traffic Signal Preemption system.

---

## 🛠️ Tech Stack
- **Frontend**: **React.js** (Vite + React 18, Leaflet, Socket.IO Client, QRCode)
- **Backend**: **Node.js** (Express, Socket.IO, WebSockets, Supabase PostgreSQL / In-Memory Store, ESP32 Hardware Integration, OSRM & Overpass API Proxies)
- **Database**: **Supabase (PostgreSQL)** with instant SQL schema & In-Memory fallback

---

## 🗄️ Supabase Database Setup (Optional & Recommended)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in your Supabase project dashboard.
3. Open and run the script [`server/supabase_schema.sql`](file:///c:/kaapaan/server/supabase_schema.sql). This will create all tables (`drivers`, `admins`, `hospitals`, `forwarded_emergencies`, `traffic_signals`) and insert default seed data.
4. Go to **Project Settings -> API** in Supabase and copy your **Project URL** and **anon / service_role API Key**.
5. Paste them into [`server/.env`](file:///c:/kaapaan/server/.env):
   ```env
   PORT=5000
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-supabase-key
   ESP32_IP=10.180.130.118
   ```
*(Note: If Supabase keys are not set, the app continues running with its built-in in-memory database automatically!)*

## ⚡ Quick Start (Windows)

### Option 1: One-Click Launcher
Simply double-click:
```bat
START_UNIFIED_APP.bat
```
This automatically boots both the Node.js backend (port 5000) and the React frontend (port 3000).

---

### Option 2: Manual Terminal Commands

#### 1. Start Node.js Backend Server
```bash
cd server
npm install
node server.js
```

#### 2. Start React.js Frontend
```bash
cd client
npm install
npm run dev
```

Open your browser at: **`http://localhost:3000`**

---

## 🔐 Credentials & Default Roles

### 1. KAAPPAAN Fleet Hub (Dark Theme)
| Role | Username | Password |
| :--- | :--- | :--- |
| **Driver** | `driver1` | `driver123` |
| **Fleet Admin** | `admin` | `admin123` |
| **Control Room** | `controlroom` | `controlroom123` |

### 2. KAAPPAAN Traffic Telemetry (Modern Theme)
| Role | Username | Password |
| :--- | :--- | :--- |
| **Ambulance (Mobile Transmitter)** | `ambulance` | `ambulance123` |
| **Traffic Signal (Laptop Receiver)** | `traffic` | `traffic123` |

---

## ✨ Features
1. **Live GPS & Movement Simulation**: Phone sensor GPS streaming + realistic driving movement simulator.
2. **OSRM Shortest Path**: Road-accurate polyline routing, live distance (km), and ETA calculation.
3. **OpenStreetMap Overpass Hospitals**: Live nearby hospital discovery with distance sorting.
4. **Emergency Dispatch & Sound Alarms**: Real-time Socket.IO alerts with audio playback.
5. **ESP32 Hardware IoT Support**: 3D interactive LED bulb and 20×4 LCD screen controls with auto-trigger.
6. **Mobile QR Pairing**: Instant QR code generation to connect phones to the laptop control room.
