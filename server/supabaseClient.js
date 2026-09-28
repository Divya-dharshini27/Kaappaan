/**
 * ====================================================================
 * SUPABASE CLIENT & DATA ACCESS LAYER — KAAPAAN & AMBULANCY
 * ====================================================================
 */

const { createClient } = require("@supabase/supabase-js");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let isConfigured = false;

if (SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL.startsWith("http")) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    isConfigured = true;
    console.log("⚡ Supabase client initialized with URL:", SUPABASE_URL);
  } catch (err) {
    console.warn("⚠️ Failed to initialize Supabase client:", err.message);
    supabase = null;
    isConfigured = false;
  }
} else {
  console.log("ℹ️ Supabase credentials not set in .env. Running with In-Memory fallback.");
}

function isSupabaseConfigured() {
  return isConfigured && supabase !== null;
}

/**
 * Sync initial data from Supabase into the local in-memory DB cache
 */
async function syncFromSupabase(localDb) {
  if (!isSupabaseConfigured()) return localDb;

  try {
    // 1. Sync Drivers
    const { data: drivers, error: drvErr } = await supabase.from("drivers").select("*");
    if (!drvErr && drivers && drivers.length > 0) {
      localDb.drivers = drivers.map((d) => ({
        id: d.id,
        username: d.username,
        passwordHash: d.password_hash,
        name: d.name,
        vehicle_no: d.vehicle_no,
        phone: d.phone,
        hospital: d.hospital,
        status: d.status || "offline",
        location: { lat: d.lat || 13.0827, lng: d.lng || 80.2707 },
        last_active: d.last_active ? new Date(d.last_active) : new Date()
      }));
      console.log(`✅ Loaded ${drivers.length} drivers from Supabase`);
    }

    // 2. Sync Admins
    const { data: admins, error: admErr } = await supabase.from("admins").select("*");
    if (!admErr && admins && admins.length > 0) {
      localDb.admins = admins.map((a) => ({
        id: a.id,
        username: a.username,
        passwordHash: a.password_hash,
        name: a.name,
        role: a.role
      }));
      console.log(`✅ Loaded ${admins.length} admins from Supabase`);
    }

    // 3. Sync Hospitals
    const { data: hospitals, error: hospErr } = await supabase.from("hospitals").select("*");
    if (!hospErr && hospitals && hospitals.length > 0) {
      localDb.hospitals = hospitals.map((h) => ({
        id: h.id,
        name: h.name,
        address: h.address,
        phone: h.phone,
        lat: h.lat,
        lng: h.lng,
        type: h.type
      }));
      console.log(`✅ Loaded ${hospitals.length} hospitals from Supabase`);
    }

    // 4. Sync Forwarded Emergencies
    const { data: fwd, error: fwdErr } = await supabase
      .from("forwarded_emergencies")
      .select("*")
      .order("forwarded_at", { ascending: false })
      .limit(50);
    if (!fwdErr && fwd && fwd.length > 0) {
      localDb.forwardedEmergencies = fwd;
      console.log(`✅ Loaded ${fwd.length} forwarded emergencies from Supabase`);
    }

  } catch (err) {
    console.warn("⚠️ Error syncing from Supabase:", err.message);
  }

  return localDb;
}

/**
 * Async database write helpers that update Supabase in background
 */
async function dbUpdateDriverStatus(driverId, status) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase
      .from("drivers")
      .update({ status, last_active: new Date().toISOString() })
      .eq("id", driverId);
  } catch (err) {
    console.warn("[Supabase] Failed to update driver status:", err.message);
  }
}

async function dbUpdateDriverLocation(driverId, lat, lng) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase
      .from("drivers")
      .update({ lat: Number(lat), lng: Number(lng), last_active: new Date().toISOString() })
      .eq("id", driverId);
  } catch (err) {
    console.warn("[Supabase] Failed to update driver location:", err.message);
  }
}

async function dbUpdateDriverHospital(driverId, hospital) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase
      .from("drivers")
      .update({ hospital, last_active: new Date().toISOString() })
      .eq("id", driverId);
  } catch (err) {
    console.warn("[Supabase] Failed to update driver hospital:", err.message);
  }
}

async function dbSaveForwardedEmergency(payload) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.from("forwarded_emergencies").insert([
      {
        id: payload.id,
        driver_name: payload.driver_name,
        vehicle: payload.vehicle,
        lat: payload.lat,
        lng: payload.lng,
        forwarded_by: payload.forwarded_by,
        forwarded_at: new Date().toISOString(),
        status: payload.status || "active"
      }
    ]);
  } catch (err) {
    console.warn("[Supabase] Failed to save forwarded emergency:", err.message);
  }
}

async function dbSaveSignalState(signalData) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.from("traffic_signals").upsert([
      {
        id: "MAIN_SIGNAL_JUNCTION",
        state: signalData.state,
        message: signalData.message,
        updated_at: new Date().toISOString()
      }
    ]);
  } catch (err) {}
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  syncFromSupabase,
  dbUpdateDriverStatus,
  dbUpdateDriverLocation,
  dbUpdateDriverHospital,
  dbSaveForwardedEmergency,
  dbSaveSignalState
};
