/**
 * Vercel Edge Function Relay
 * Deploy: vercel deploy --prod
 *
 * Free tier: 100GB bandwidth/month, no credit card needed
 * Each deployment = different edge IP = independent quota
 *
 * Setup:
 *   1. npm i -g vercel
 *   2. vercel login
 *   3. Create api/relay.js (this file)
 *   4. Create vercel.json
 *   5. vercel deploy --prod
 *   6. Note the URL (e.g. https://your-app.vercel.app)
 *   7. Add URL to main Worker RELAY_URLS
 */

export default async function handler(request) {
  // CORS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  // Health check
  if (request.method === "GET") {
    return Response.json({ status: "ok", platform: "vercel-edge", edge: "active" });
  }

  // Relay POST
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const clawReq = body.request;
      if (!clawReq) {
        return Response.json({ error: "Missing 'request' field" }, { status: 400 });
      }

      // Get fresh token from Claw Hunter
      const tokenResp = await fetch("https://clawhunter.fun/api/v1/studio/token");
      const tokenData = await tokenResp.json();

      // Forward to upstream
      const resp = await fetch("https://clawhunter.fun/api/studio/images", {
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

  return Response.json({ error: "Use POST /api/relay" }, { status: 404 });
}

export const config = {
  path: "/api/relay"
};
