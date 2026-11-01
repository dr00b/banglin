"use strict";

// Guava's OAuth and data-entries endpoints, as a fetch function. Refresh
// tokens rotate, and reusing one whose replacement has been used gets
// invalid_grant, as Guava's docs describe.

function createFakeGuava(opts) {
  opts = opts || {};
  const g = {
    calls: [], entries: [], seen: new Set(), n: 0,
    refreshes: 0, failData: 0, revokeAccess: false,
    access: null, refresh: null, retired: new Set(), pending: {}
  };

  function issue() {
    g.n++;
    g.access = "at" + g.n;
    g.refresh = "rt" + g.n;
    return { access_token: g.access, refresh_token: g.refresh, token_type: "Bearer", expires_in: 3600, scope: "patient/symptoms.c offline_access" };
  }
  function json(status, body) {
    return { ok: status >= 200 && status < 300, status: status, text: async function() { return JSON.stringify(body); } };
  }
  function oauthError(code) { return json(400, { error: code, error_description: code }); }

  g.fetch = async function(url, init) {
    const u = new URL(url), call = { path: u.pathname, init: init };
    g.calls.push(call);
    if (u.pathname === "/oauth/par" || u.pathname === "/oauth/token") {
      const p = new URLSearchParams(init.body);
      call.params = Object.fromEntries(p);
      if (init.headers.Authorization) return oauthError("invalid_request"); // creds sent twice
      if (p.get("client_id") !== "cid" || p.get("client_secret") !== "secret") return oauthError("invalid_client");
      if (u.pathname === "/oauth/par") {
        g.pending.challenge = p.get("code_challenge");
        return json(201, { request_uri: "urn:ietf:params:oauth:request_uri:abc", expires_in: 600 });
      }
      if (p.get("grant_type") === "authorization_code") {
        if (p.get("code") !== "the-code") return oauthError("invalid_grant");
        const crypto = require("node:crypto");
        const ch = crypto.createHash("sha256").update(p.get("code_verifier")).digest("base64url");
        if (ch !== g.pending.challenge) return oauthError("invalid_grant");
        return json(200, issue());
      }
      if (p.get("grant_type") === "refresh_token") {
        g.refreshes++;
        if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
        const rt = p.get("refresh_token");
        if (rt !== g.refresh || g.retired.has(rt)) return oauthError("invalid_grant");
        g.retired.add(rt);
        return json(200, issue());
      }
      return oauthError("unsupported_grant_type");
    }
    if (u.pathname === "/v1/data-entries") {
      if (init.headers.Authorization !== "Bearer " + g.access || g.revokeAccess) {
        g.revokeAccess = false;
        return json(401, { error: "invalid_token" });
      }
      if (g.failData > 0) { g.failData--; return json(503, { error: "unavailable" }); }
      const body = JSON.parse(init.body);
      call.body = body;
      let accepted = 0;
      for (const e of body.entries) {
        const key = e.identifier.map((i) => i.system + "|" + i.value).join(",");
        if (g.seen.has(key)) continue;
        g.seen.add(key);
        g.entries.push(Object.assign({ type: body.type }, e));
        accepted++;
      }
      return json(200, { accepted: accepted, environment: "test" });
    }
    return json(404, {});
  };

  // Pretend sign-in already happened: tokens as a store would hold them.
  g.signedIn = function(expiresAt) {
    const t = issue();
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: expiresAt, scope: t.scope };
  };
  return g;
}

// Token store in memory, recording every save in order.
function memoryStore(initial) {
  const s = { tokens: initial || null, saves: [] };
  s.load = async function() { return s.tokens; };
  s.save = async function(t) { s.tokens = t; s.saves.push(t); };
  return s;
}

module.exports = { createFakeGuava, memoryStore };
