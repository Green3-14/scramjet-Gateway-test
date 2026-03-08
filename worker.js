/**
 * SCRAMJET GATEWAY — Cloudflare Worker Bare Server
 * 
 * This Worker acts as an HTTP relay:
 *   Browser → Worker → Target Site → Worker → Browser
 * 
 * The browser sends a POST request with { url: "https://target.com" }
 * The Worker fetches that URL from Cloudflare's servers (no CORS issues)
 * and streams the response back to the browser.
 * 
 * Deploy this at: Workers & Pages → Create Worker → paste this code
 */

export default {
  async fetch(request, env, ctx) {

    // ── CORS headers ──
    // These allow your Pages site to call this Worker
    var CORS = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // Handle preflight OPTIONS request from browser
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Only accept POST requests
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    // Parse the request body to get the target URL
    var body;
    try {
      body = await request.json();
    } catch(e) {
      return new Response("Invalid JSON body", { status: 400, headers: CORS });
    }

    var targetURL = body.url;

    // Validate the URL
    if (!targetURL || typeof targetURL !== "string") {
      return new Response("Missing url in body", { status: 400, headers: CORS });
    }

    try {
      new URL(targetURL); // will throw if invalid
    } catch(e) {
      return new Response("Invalid URL: " + targetURL, { status: 400, headers: CORS });
    }

    // ── Fetch the target site from Cloudflare's servers ──
    // This is the core of the bare server — Cloudflare fetches it,
    // not the user's browser, so there are no CORS restrictions
    var targetResp;
    try {
      targetResp = await fetch(targetURL, {
        method: "GET",
        headers: {
          // Pretend to be a real browser so sites don't block us
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "identity",
          "Upgrade-Insecure-Requests": "1"
        },
        redirect: "follow"
      });
    } catch(e) {
      return new Response("Failed to fetch target: " + e.message, {
        status: 502,
        headers: CORS
      });
    }

    // ── Stream the response back to the browser ──
    // Copy the original headers but add our CORS headers on top
    var responseHeaders = new Headers();

    // Copy useful headers from the target response
    var copyHeaders = ["content-type", "content-length", "last-modified", "etag"];
    copyHeaders.forEach(function(h) {
      var v = targetResp.headers.get(h);
      if (v) responseHeaders.set(h, v);
    });

    // Add CORS headers so browser accepts the response
    Object.entries(CORS).forEach(function(pair) {
      responseHeaders.set(pair[0], pair[1]);
    });

    // Strip headers that would break our proxy
    // (these tell the browser not to embed the page)
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("content-security-policy");
    responseHeaders.delete("x-content-type-options");

    // Stream the body back — this is what feeds our TransformStream pipeline
    return new Response(targetResp.body, {
      status: targetResp.status,
      headers: responseHeaders
    });
  }
};
