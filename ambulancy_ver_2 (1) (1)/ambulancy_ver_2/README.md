# 🚑 Ambulancy — Setup Guide

## Prerequisites
- Python 3.8+
- MongoDB running locally on port 27017

## Installation

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Seed the database with a test driver
python seed.py

# 3. Run the app
python app.py
```

## Access
- Open: http://localhost:5000

## Login Credentials

| Role   | Username | Password   |
|--------|----------|------------|
| Driver | driver1  | driver123  |
| Admin  | admin    | admin123   |

## Driver Dashboard Features
- Auto-detects your current location via browser geolocation
- Enter destination on login → calculates shortest path via OSRM
- Live OSM map (dark theme) with ambulance + destination markers
- Red route line drawn between source and destination
- Distance & estimated time shown
- Emergency mode toggle (updates status in MongoDB)
- Change destination anytime

## Project Structure
```
ambulancy/
├── app.py                  # Flask entry point
├── seed.py                 # DB seeder
├── requirements.txt
├── routes/
│   ├── auth.py             # Login / logout
│   ├── driver.py           # Driver dashboard & API
│   └── admin.py            # Admin dashboard (static)
└── templates/
    ├── login.html
    ├── driver_dashboard.html
    └── admin_dashboard.html
```
