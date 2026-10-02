// @ts-ignore - Deno resolves this remote module at runtime for Supabase Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const denoRuntime = globalThis as typeof globalThis & {
  Deno?: {
    env: {
      get(name: string): string | undefined;
    };
    serve: (handler: (request: Request) => Response | Promise<Response>) => void;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

denoRuntime.Deno!.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const supabaseUrl = denoRuntime.Deno!.env.get(https://xdjifpqrpzdfzylhcofs.supabase.co)!;
  const anonKey = denoRuntime.Deno!.env.get(sb_publishable_xGtp7n2KJTKRzyj_84BlbQ_7JJXDfjq)!;
  const serviceRoleKey = denoRuntime.Deno!.env.get(sb_secret_jmnMECTFYkB9Evk-itUP7A_nFWD-RWv)!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();

  if (callerError || caller?.app_metadata?.role !== "admin") {
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
  const hasRequiredPasswordCharacters = password.length >= 10
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);

  if (!/^\d{6}$/.test(serviceNumber)) {
    return jsonResponse({ error: "Service number must contain exactly 6 digits." }, 400);
  }
  if (!hasRequiredPasswordCharacters) {
    return jsonResponse({
      error: "Password must be at least 10 characters and include uppercase, lowercase, a number, and a special character.",
    }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await adminClient.auth.admin.createUser({
    email: `${serviceNumber}@fault-dashboard.example.com`,
    password,
    email_confirm: true,
    app_metadata: { service_number: serviceNumber, role: "technician" },
  });

  if (error) {
    const status = error.message.toLowerCase().includes("already") ? 409 : 400;
    return jsonResponse({ error: status === 409 ? "That service number already has an account." : "Unable to create the account." }, status);
  }

  return jsonResponse({ serviceNumber: data.user.app_metadata.service_number }, 201);
});
