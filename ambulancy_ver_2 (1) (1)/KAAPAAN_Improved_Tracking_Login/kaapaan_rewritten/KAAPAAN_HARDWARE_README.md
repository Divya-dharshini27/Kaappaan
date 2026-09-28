# KAAPAAN — Phone GPS + Traffic ESP32 Demo

## Recommended travelling-phone architecture

The ambulance phone and the traffic-control laptop **do not need to remain on the same Wi-Fi**. The phone can use 4G/5G while travelling. The laptop runs the Node.js server locally, and a public HTTPS tunnel forwards Internet requests to port 3000.

```text
AMBULANCE PHONE (4G/5G)
        |
        | HTTPS GPS POST /api/gps
        v
PUBLIC HTTPS URL (Cloudflare Tunnel)
        |
        v
LAPTOP Node.js :3000
        |\
        | \
        |  \\--> KAAPAAN Dashboard
        v
LOCAL Wi-Fi
        |
        v
TRAFFIC ESP32
```

### 1. Start KAAPAAN

In PowerShell:

```powershell
cd "C:\path\to\kaapaan_rewritten"
npm install
npm start
```

Keep this terminal open. First verify the laptop dashboard at `http://localhost:3000`.

### 2. Install Cloudflare Tunnel (`cloudflared`)

Install the official Cloudflare Tunnel client for Windows (`cloudflared`). After installation, verify:

```powershell
cloudflared --version
```

For a temporary development/demo tunnel, run:

```powershell
cloudflared tunnel --url http://localhost:3000
```

The terminal will print a public address similar to:

```text
https://random-name.trycloudflare.com
```

### 3. Open the public URL on the laptop

This step is important. Open the generated `https://...trycloudflare.com` URL **on the laptop**, not `localhost:3000`.

Then click **Pair Mobile (QR)**. The QR code is generated from the current public URL, so the phone receives the public HTTPS address automatically.

### 4. Ambulance phone

Scan the QR code. Select **Ambulance Mode**, allow Location permission, and tap **Start Live GPS Tracking**.

Now the phone can leave the Wi-Fi and use mobile data. GPS packets continue to reach the laptop through the public tunnel.

### 5. Traffic ESP32

The traffic ESP32 is a separate local device. Keep it on the same local Wi-Fi/LAN as the laptop and configure its `SERVER_URL`/`SIGNAL_URL` to the laptop's private IP, for example:

```cpp
http://10.241.96.61:3000
```

Do **not** point the ESP32 at `localhost`.

### 6. Demonstration flow

1. Start `npm start` on the laptop.
2. Start `cloudflared tunnel --url http://localhost:3000`.
3. Open the generated HTTPS URL on the laptop.
4. Open **Pair Mobile (QR)** and scan it with the ambulance phone.
5. Allow location and start tracking.
6. Take the phone away from the Wi-Fi using 4G/5G.
7. The laptop receives GPS updates over the Internet.
8. KAAPAAN calculates distance to the selected traffic junction.
9. At 750 m, the signal API changes state.
10. The traffic ESP32 polls `/api/signal` locally and drives the LEDs/LCD.

### Important demo limitation

Keep the ambulance phone screen awake and the browser page in the foreground during the prototype demonstration. Mobile browsers can suspend JavaScript/GPS activity when a page is backgrounded or the phone enters aggressive battery-saving mode.

### Security note

Cloudflare Quick Tunnels are intended for development/testing. For a production deployment, use an authenticated permanent tunnel/server rather than exposing an unrestricted demo endpoint.

---

# KAAPAAN - Phone Ambulance + Traffic ESP32 Prototype

## Demo architecture

The **phone acts as the ambulance**. There is no ambulance-side ESP32 or NEO-6M required for this demo.

```text
PHONE (Ambulance)
  Browser GPS
      |
      | POST /api/gps over same Wi-Fi
      v
LAPTOP
  Node.js + KAAPAAN Dashboard
      |
      | decides 750 m / 50 m / 150 m signal state
      v
TRAFFIC ESP32
  RED / YELLOW / GREEN LEDs + LCD
```

The laptop and traffic ESP32 are stationary at the demo junction. The phone can physically move toward the junction while staying connected to the same Wi-Fi network.

## What you need

- 1 laptop running this Node.js project
- 1 phone with GPS/location enabled
- 1 ESP32 for the traffic signal
- 20x4 I2C LCD (optional but recommended)
- Red, yellow and green LEDs
- One Wi-Fi source that can keep the phone, laptop and ESP32 on the same network (router, pocket Wi-Fi, or another hotspot/access point)

You **do not need the ambulance ESP32** for this version.

## Run the laptop

```bash
npm install
npm start
```

On the laptop open:

```text
http://localhost:3000
```

The server also prints the LAN address, for example:

```text
Mobile Access (Same Wi-Fi): http://192.168.1.10:3000
```

## Pair the phone

1. Keep the laptop and phone on the same Wi-Fi.
2. On the laptop open KAAPAAN in **Traffic Control** mode.
3. Click **Pair Mobile (QR)**.
4. Scan the QR code with the phone.
5. The phone opens **Ambulance Mode** automatically.
6. Select `AMB001` or another vehicle ID.
7. Tap **Start Live GPS Tracking**.
8. Allow location permission.
9. Physically move with the phone toward the configured traffic junction.

Every phone GPS update is sent to `POST /api/gps` on the laptop. The Node.js server broadcasts the update to the laptop's Traffic Control page.

## IMPORTANT: mobile GPS security

Modern mobile browsers normally require HTTPS for `navigator.geolocation` when the page is opened using a LAN IP such as:

```text
http://192.168.1.10:3000
```

The application already detects this and displays a warning. For a real-phone demo, use one of these approaches:

### Recommended
Serve the project through an HTTPS URL accessible from the phone.

### Demo workaround
On Android Chrome, you can use Chrome's **unsafely-treat-insecure-origin-as-secure** flag for the exact LAN URL. This is a browser-development workaround, not a production deployment method.

If GPS permission remains blocked, use the built-in **Simulate Movement** button to verify the complete signal workflow.

## Traffic ESP32

Open:

```text
hardware/traffic_signal_esp32.ino
```

Set:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SIGNAL_URL = "http://YOUR_LAPTOP_IP:3000/api/signal";
```

Example:

```cpp
const char* SIGNAL_URL = "http://192.168.1.10:3000/api/signal";
```

The traffic ESP32 polls the laptop every 500 ms.

### Pins

- Red LED -> GPIO32 through 220 ohm resistor
- Yellow LED -> GPIO33 through 220 ohm resistor
- Green LED -> GPIO4 through 220 ohm resistor
- LED cathodes -> GND
- LCD SDA -> GPIO21
- LCD SCL -> GPIO22
- LCD GND -> GND
- LCD VCC -> module-rated supply
- LCD address: `0x27`

## Signal logic

The laptop dashboard calculates the distance between the phone's live GPS position and the configured traffic junction.

- **> 750 m:** RED
- **<= 750 m:** YELLOW for 5 seconds
- **After 5 seconds:** GREEN
- **Phone reaches <= 50 m:** crossing recorded
- **After crossing and moving > 150 m away:** RED

The traffic ESP32 only executes the state received from `/api/signal`.

## Important network rule

Do not use `localhost` in the traffic ESP32 URL.

Wrong:

```text
http://localhost:3000/api/signal
```

Correct:

```text
http://<LAPTOP-LAN-IP>:3000/api/signal
```

The phone must also open the laptop's LAN URL, not `localhost`.


## 🌍 Remote Phone GPS Demo (Phone Can Travel Outside Wi-Fi)

The phone does **not** need to remain on the laptop Wi-Fi. For the SIH/demo workflow, the laptop runs the KAAPAAN server and a Cloudflare Quick Tunnel publishes it through HTTPS. The ambulance phone can then use 4G/5G from anywhere with Internet access.

### One-time setup on Windows
1. Install `cloudflared` from the official Cloudflare downloads page: https://developers.cloudflare.com/tunnel/downloads/
2. Reopen PowerShell and verify: `cloudflared --version`

### Every demo
1. In the project folder run `npm install` (first time only).
2. Run `npm run public`.
3. Keep that terminal open. It starts Node.js and the Cloudflare Quick Tunnel.
4. Open the KAAPAAN dashboard on the laptop using `http://localhost:3000`.
5. Click **Pair Mobile (QR)**. The QR now contains the public HTTPS tunnel URL.
6. Scan the QR with the ambulance phone.
7. Allow location permission and press **Start Live GPS Tracking**.
8. The phone may now switch to 4G/5G and travel outside the laptop Wi-Fi.
9. The laptop receives `/api/gps` through the tunnel and the dashboard updates in real time.
10. The traffic ESP32 stays on the laptop's local network and polls `/api/signal`.

### Architecture
`Phone GPS (4G/5G) → HTTPS Cloudflare Tunnel → Laptop Node.js → Signal Logic → Local Wi-Fi → Traffic ESP32`

**Important:** Quick Tunnels are intended for testing/development. For a production deployment, use a managed Cloudflare Tunnel with a stable hostname.


## Demo location architecture
For the remote-phone demo, the physical traffic signal is the laptop + traffic ESP32 + LCD/LED setup. The Traffic Control browser obtains the laptop's location using the browser Geolocation API and sends it to `/api/signal-location`. The ambulance phone remains the moving GPS transmitter over 4G/5G. No hard-coded Chennai junction is required.
