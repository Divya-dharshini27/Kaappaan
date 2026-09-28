-- ====================================================================
-- KAAPAAN + AMBULANCY UNIFIED SYSTEM — SUPABASE SQL SCHEMA
-- ====================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This creates all required tables and seeds default records.
-- ====================================================================

-- 1. DRIVERS TABLE
CREATE TABLE IF NOT EXISTS public.drivers (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    vehicle_no TEXT,
    phone TEXT,
    hospital TEXT,
    status TEXT DEFAULT 'offline',
    lat DOUBLE PRECISION DEFAULT 13.0827,
    lng DOUBLE PRECISION DEFAULT 80.2707,
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ADMINS & OFFICERS TABLE
CREATE TABLE IF NOT EXISTS public.admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin', -- 'admin' or 'controlroom'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. HOSPITALS TABLE
CREATE TABLE IF NOT EXISTS public.hospitals (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    address TEXT,
    phone TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    type TEXT DEFAULT 'Multi-Specialty',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. FORWARDED EMERGENCIES TABLE
CREATE TABLE IF NOT EXISTS public.forwarded_emergencies (
    id TEXT PRIMARY KEY,
    driver_name TEXT,
    vehicle TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    forwarded_by TEXT DEFAULT 'Admin',
    forwarded_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'active'
);

-- 5. TRAFFIC SIGNAL LOCATIONS & STATE TABLE (Optional Live History)
CREATE TABLE IF NOT EXISTS public.traffic_signals (
    id TEXT PRIMARY KEY DEFAULT 'MAIN_SIGNAL_JUNCTION',
    state TEXT DEFAULT 'RED',
    message TEXT DEFAULT 'No ambulance on the way',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
-- Enable RLS on all tables
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forwarded_emergencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_signals ENABLE ROW LEVEL SECURITY;

-- Allow anon / service role access for read & write
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow public read-write for drivers" ON public.drivers;
    CREATE POLICY "Allow public read-write for drivers" ON public.drivers FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public read-write for admins" ON public.admins;
    CREATE POLICY "Allow public read-write for admins" ON public.admins FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public read-write for hospitals" ON public.hospitals;
    CREATE POLICY "Allow public read-write for hospitals" ON public.hospitals FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public read-write for forwarded_emergencies" ON public.forwarded_emergencies;
    CREATE POLICY "Allow public read-write for forwarded_emergencies" ON public.forwarded_emergencies FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public read-write for traffic_signals" ON public.traffic_signals;
    CREATE POLICY "Allow public read-write for traffic_signals" ON public.traffic_signals FOR ALL USING (true) WITH CHECK (true);
END $$;

-- ====================================================================
-- SEED DEFAULT DATA
-- ====================================================================

-- Seed Drivers (password: driver123)
INSERT INTO public.drivers (id, username, password_hash, name, vehicle_no, phone, hospital, status, lat, lng, last_active)
VALUES
  ('drv_1', 'driver1', '$2a$10$wS21e/h9.l9qMv/JjLgMse22uPZ1t9oK7n7Cg1s789z8mN2e6MhTC', 'Ravi Kumar', 'TN01AB1234', '+91 98765 43210', 'Apollo Hospital', 'offline', 13.0827, 80.2707, NOW()),
  ('drv_2', 'driver2', '$2a$10$wS21e/h9.l9qMv/JjLgMse22uPZ1t9oK7n7Cg1s789z8mN2e6MhTC', 'Priya Nair', 'TN02CD5678', '+91 98765 43211', 'Fortis Malar Hospital', 'offline', 13.0569, 80.2425, NOW()),
  ('drv_3', 'driver3', '$2a$10$wS21e/h9.l9qMv/JjLgMse22uPZ1t9oK7n7Cg1s789z8mN2e6MhTC', 'Arun Selvam', 'TN03EF9012', '+91 98765 43212', 'MIOT International', 'offline', 13.1067, 80.2206, NOW())
ON CONFLICT (username) DO NOTHING;

-- Seed Admins & Control Room Officers (password: admin123 / controlroom123)
INSERT INTO public.admins (id, username, password_hash, name, role)
VALUES
  ('adm_1', 'admin', '$2a$10$fW3C7Gv5XwM4t5Ym0D7Gz.m6N.s3J.g2I7K0P4a1T7X8V0W9Y8q1O', 'Fleet Administrator', 'admin'),
  ('ctrl_1', 'controlroom', '$2a$10$fW3C7Gv5XwM4t5Ym0D7Gz.m6N.s3J.g2I7K0P4a1T7X8V0W9Y8q1O', 'Traffic Control Room Officer', 'controlroom')
ON CONFLICT (username) DO NOTHING;

-- Seed Chennai Hospitals
INSERT INTO public.hospitals (name, address, phone, lat, lng, type)
VALUES
  ('Apollo Hospital (Greams Road)', '21 Greams Lane, Thousand Lights, Chennai', '+91 44 2829 0200', 13.0604, 80.2496, 'Multi-Specialty'),
  ('Fortis Malar Hospital', '52, 1st Main Rd, Gandhi Nagar, Adyar, Chennai', '+91 44 4289 2222', 13.0067, 80.2571, 'Multi-Specialty'),
  ('MIOT International', '4/112, Mount Poonamallee High Rd, Manapakkam, Chennai', '+91 44 4200 2288', 13.0195, 80.1873, 'Trauma & Ortho'),
  ('Kauvery Hospital', '199, Luz Church Rd, Mylapore, Chennai', '+91 44 4000 6000', 13.0336, 80.2612, 'Multi-Specialty'),
  ('Rajiv Gandhi Government General Hospital', 'EVR Periyar Salai, Park Town, Chennai', '+91 44 2530 5000', 13.0818, 80.2785, 'Government General'),
  ('Gleneagles Global Health City', '439, Cheran Nagar, Perumbakkam, Chennai', '+91 44 4477 7000', 12.9069, 80.1983, 'Super-Specialty')
ON CONFLICT (name) DO NOTHING;

-- Seed Default Traffic Signal State
INSERT INTO public.traffic_signals (id, state, message, latitude, longitude, accuracy, updated_at)
VALUES ('MAIN_SIGNAL_JUNCTION', 'RED', 'No ambulance on the way', 13.0827, 80.2707, 10, NOW())
ON CONFLICT (id) DO NOTHING;
