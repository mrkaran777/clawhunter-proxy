/**
 * Netlify Edge Function Relay
 * Deploy: netlify deploy --prod
 *
 * Free tier: 125K requests/month, 100GB bandwidth
 * Each site = different edge IP = independent quota
 *
 * Setup:
 *   1. npm i -g netlify-cli
 *   2. netlify login
 *   3. netlify init
 *   4. Create netlify/edge-functions/relay.js (this file)
 *   5. netlify deploy --prod
 *   6. Note the URL (e.g. https://your-site.netlify.app)
 *   7. Add URL to main Worker RELAY_URLS
 */

export default async (request, context) => {
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

  // Health
  if (request.method === "GET") {
    return Response.json({ status: "ok", platform: "netlify-edge", edge: "active" });
  }

  // Relay POST
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const clawReq = body.request;
      if (!clawReq) {
        return Response.json({ error: "Missing 'request' field" }, { status: 400 });
      }

      // Get fresh token
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

  return Response.json({ error: "Use POST /relay" }, { status: 404 });
};

export const config = { path: "/relay" };
