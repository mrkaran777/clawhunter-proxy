/**
 * Deno Deploy Relay
 * Deploy: deployctl deploy --project=claw-relay deploy.ts
 *
 * Free tier: 100GB bandwidth/month, 100ms avg execution
 * Each project = different edge IP = independent quota
 *
 * Setup:
 *   1. Install Deno: curl -fsSL https://deno.land/install.sh | sh
 *   2. Install deployctl: deno install -Arf https://deno.land/x/deployctl/deployctl.ts
 *   3. deployctl login
 *   4. deployctl deploy --project=claw-relay deploy.ts
 *   5. Note the URL (e.g. https://claw-relay.deno.dev)
 *   6. Add URL to main Worker RELAY_URLS
 */

import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

const BASE = "https://clawhunter.fun";

serve(async (req: Request): Promise<Response> => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  // Health
  if (req.method === "GET") {
    return Response.json({ status: "ok", platform: "deno-deploy", edge: "active" });
  }

  // Relay POST
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const clawReq = body.request;
      if (!clawReq) {
        return Response.json({ error: "Missing 'request' field" }, { status: 400 });
      }

      // Get fresh token
      const tokenResp = await fetch(`${BASE}/api/v1/studio/token`);
      const tokenData = await tokenResp.json();

      // Forward to upstream
      const resp = await fetch(`${BASE}/api/studio/images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-studio-token": tokenData.token
        },
        body: JSON.stringify(clawReq)
      });

      const data = await resp.json();
      return Response.json(data, { status: resp.status });

    } catch (e) {
      return Response.json({ error: "Relay error: " + e.message }, { status: 500 });
    }
  }

  return Response.json({ error: "Use POST /relay" }, { status: 404 });
}, { port: 8000 });
