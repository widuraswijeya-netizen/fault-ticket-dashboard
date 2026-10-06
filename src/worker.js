const SESSION_COOKIE = "fd_session";
const SESSION_HOURS = 8;
const SESSION_MAX_AGE = SESSION_HOURS * 60 * 60;
const PBKDF2_ITERATIONS = 100000;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function base64Encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hasStrongPassword(password) {
  return password.length >= 10 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

async function derivePasswordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Encode(new Uint8Array(digest));
}

function sessionCookie(token, maxAge) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

async function getSessionUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.USERS_DB.prepare(
    `SELECT u.service_number, u.role
     FROM sessions s
     JOIN users u ON u.service_number = s.service_number
     WHERE s.token_hash = ?1
       AND s.expires_at > ?2
       AND u.active = 1`
  ).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  return { serviceNumber: row.service_number, role: row.role };
}

async function handleLogin(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid request body." }, 400); }
  const serviceNumber = String(payload.serviceNumber ?? "").trim();
  const password = String(payload.password ?? "");
  if (!/^\d{6}$/.test(serviceNumber) || !password)
    return jsonResponse({ error: "Service number or password is incorrect." }, 401);

  const user = await env.USERS_DB.prepare(
    "SELECT service_number, password_salt, password_hash, role, active FROM users WHERE service_number = ?1"
  ).bind(serviceNumber).first();

  if (!user || user.active !== 1)
    return jsonResponse({ error: "Service number or password is incorrect." }, 401);

  const hash = await derivePasswordHash(password, base64Decode(user.password_salt));
  if (base64Encode(hash) !== user.password_hash)
    return jsonResponse({ error: "Service number or password is incorrect." }, 401);

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Encode(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE * 1000);

  await env.USERS_DB.prepare(
    "INSERT INTO sessions (token_hash, service_number, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(tokenHash, serviceNumber, expires.toISOString(), now.toISOString()).run();

  return jsonResponse(
    { user: { serviceNumber, role: user.role } },
    200,
    { "Set-Cookie": sessionCookie(token, SESSION_MAX_AGE) },
  );
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ user: null }, 401);
  return jsonResponse({ user });
}

async function handleLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.USERS_DB.prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(await sha256(token)).run();
  }
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

async function handleAdminCreateUser(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  const caller = await getSessionUser(request, env);
  if (!caller) return jsonResponse({ error: "Authentication required." }, 401);
  if (caller.role !== "admin") return jsonResponse({ error: "Administrator access required." }, 403);

  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid request body." }, 400); }
  const serviceNumber = String(payload.serviceNumber ?? "").trim();
  const password = String(payload.password ?? "");

  if (!/^\d{6}$/.test(serviceNumber))
    return jsonResponse({ error: "Service number must contain exactly 6 digits." }, 400);
  if (!hasStrongPassword(password))
    return jsonResponse({ error: "Password must be at least 10 characters and include uppercase, lowercase, a number, and a special character." }, 400);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  const now = new Date().toISOString();

  try {
    await env.USERS_DB.prepare(
      `INSERT INTO users
       (service_number, password_salt, password_hash, role, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'technician', 1, ?4, ?4)`
    ).bind(serviceNumber, base64Encode(salt), base64Encode(hash), now).run();
  } catch (error) {
    const message = String(error);
    if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("constraint"))
      return jsonResponse({ error: "That service number already has an account." }, 409);
    console.error("create technician failed:", error);
    return jsonResponse({ error: "Unable to create the account." }, 500);
  }
  return jsonResponse({ serviceNumber, role: "technician" }, 201);
}


const SUPABASE_URL = "https://xdjifpqrpzdfzylhcofs.supabase.co";

async function supabaseRequest(env, path, options = {}) {
  if (!env.SUPABASE_SECRET_KEY) {
    throw new Error("Supabase server secret is not configured.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("apikey", env.SUPABASE_SECRET_KEY);
  headers.set("Authorization", "Bearer " + env.SUPABASE_SECRET_KEY);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = data?.message || data?.hint || data?.details || text || ("HTTP " + response.status);
    throw new Error("Supabase request failed (" + response.status + "): " + detail);
  }
  return data;
}

async function requireSession(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return null;
  return user;
}

async function handleCloudState(request, env) {
  const user = await requireSession(request, env);
  if (!user) return jsonResponse({ error: "Authentication required." }, 401);

  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest(env, "app_state?select=tickets,updated_at&id=eq.1");
      return jsonResponse(rows?.[0] || null);
    }
    if (request.method !== "PUT") return jsonResponse({ error: "Method not allowed." }, 405);

    const payload = await request.json();
    const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
    const updatedAt = String(payload.updated_at || new Date().toISOString());

    await supabaseRequest(env, "app_state?on_conflict=id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: { id: 1, tickets, updated_at: updatedAt },
    });
    return jsonResponse({ ok: true, updated_at: updatedAt });
  } catch (error) {
    console.error("Cloud state request failed:", error);
    return jsonResponse({ error: String(error.message || error) }, 502);
  }
}

async function handleCloudSnapshots(request, env) {
  const user = await requireSession(request, env);
  if (!user) return jsonResponse({ error: "Authentication required." }, 401);

  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (!start || !end) return jsonResponse({ error: "start and end are required." }, 400);
      const path = "app_snapshots?select=id,captured_at,csv_modified_at,tickets"
        + "&captured_at=gte." + encodeURIComponent(start)
        + "&captured_at=lt." + encodeURIComponent(end)
        + "&order=captured_at.asc";
      const rows = await supabaseRequest(env, path);
      return jsonResponse(rows || []);
    }

    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
    const payload = await request.json();
    const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
    const capturedAt = String(payload.captured_at || new Date().toISOString());
    const csvModifiedAt = payload.csv_modified_at ? String(payload.csv_modified_at) : null;

    await supabaseRequest(env, "app_snapshots", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: { captured_at: capturedAt, csv_modified_at: csvModifiedAt, tickets },
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Cloud snapshots request failed:", error);
    return jsonResponse({ error: String(error.message || error) }, 502);
  }
}

async function handleSetupAdmin(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const countRow = await env.USERS_DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    if ((countRow?.count ?? 0) !== 0)
      return jsonResponse({ error: "Initial setup is already complete." }, 409);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body." }, 400);
    }

    const password = String(payload.password ?? "");
    if (!hasStrongPassword(password))
      return jsonResponse({
        error: "Password must be at least 10 characters and include uppercase, lowercase, a number, and a special character."
      }, 400);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePasswordHash(password, salt);
    const now = new Date().toISOString();

    await env.USERS_DB.prepare(
      `INSERT INTO users
       (service_number, password_salt, password_hash, role, active, created_at, updated_at)
       VALUES ('013633', ?1, ?2, 'admin', 1, ?3, ?3)`
    ).bind(base64Encode(salt), base64Encode(hash), now).run();

    return jsonResponse({ ok: true, serviceNumber: "013633", role: "admin" }, 201);
  } catch (error) {
    console.error("initial admin setup failed:", error);
    return jsonResponse({
      error: "Unable to initialize the administrator account.",
    }, 500);
  }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/setup-admin") return handleSetupAdmin(request, env);
  if (url.pathname === "/api/login") return handleLogin(request, env);
  if (url.pathname === "/api/me") return handleMe(request, env);
  if (url.pathname === "/api/logout") return handleLogout(request, env);
  if (url.pathname === "/api/admin/users") return handleAdminCreateUser(request, env);
  if (url.pathname === "/api/cloud/state") return handleCloudState(request, env);
  if (url.pathname === "/api/cloud/snapshots") return handleCloudSnapshots(request, env);
  return null;
}

export default {
  async fetch(request, env) {
    const apiResponse = await handleApi(request, env);
    if (apiResponse) return apiResponse;
    return env.ASSETS.fetch(request);
  },
};
