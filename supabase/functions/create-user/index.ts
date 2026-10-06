// Supabase Edge Function: create-user
// Creates technician accounts after verifying that the caller is an administrator.
//
// Required Supabase Edge Function environment variables:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
//
// Never put the service-role key in source code or browser configuration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_EMAIL_DOMAIN = "@intranet.slt.com.lk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function hasStrongPassword(password: string): boolean {
  return password.length >= 10
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Use the caller's JWT to determine who is making the request.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !caller) {
      return jsonResponse({ error: "Invalid or expired authentication session." }, 401);
    }

    if (caller.app_metadata?.role !== "admin") {
      return jsonResponse({ error: "Administrator access required." }, 403);
    }

    let payload: { serviceNumber?: unknown; password?: unknown };
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body." }, 400);
    }

    const serviceNumber = String(payload.serviceNumber ?? "").trim();
    const password = String(payload.password ?? "");

    if (!/^\d{6}$/.test(serviceNumber)) {
      return jsonResponse({ error: "Service number must contain exactly 6 digits." }, 400);
    }

    if (!hasStrongPassword(password)) {
      return jsonResponse({
        error: "Password must be at least 10 characters and include uppercase, lowercase, a number, and a special character.",
      }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await adminClient.auth.admin.createUser({
      email: `${serviceNumber}${AUTH_EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
      app_metadata: {
        service_number: serviceNumber,
        role: "technician",
      },
    });

    if (error) {
      const alreadyExists = error.message.toLowerCase().includes("already");
      return jsonResponse({
        error: alreadyExists
          ? "That service number already has an account."
          : "Unable to create the account.",
      }, alreadyExists ? 409 : 400);
    }

    return jsonResponse({
      serviceNumber: data.user.app_metadata.service_number,
    }, 201);
  } catch (error) {
    console.error("create-user failed:", error);
    return jsonResponse({
      error: "Authentication service is not configured correctly.",
    }, 500);
  }
});
