"use strict";

// Guava Health's personal API: OAuth 2.1 (confidential client, PAR, PKCE
// S256, rotating refresh tokens) and the symptoms write.
//
// Rules from Guava's docs this follows:
// - Client credentials go as form fields (never also as Basic auth).
// - A refresh returns a new access AND refresh token; both are persisted
//   before either is used. Reusing an old refresh token after its
//   replacement was used gets invalid_grant, so only one refresh may run at
//   a time.
// - POST /v1/data-entries ignores an entry whose identifier it has already
//   accepted, so resending is safe.

const crypto = require("node:crypto");

const HOSTS = { live: "https://api.guavahealth.com", test: "https://api-test.guavahealth.com" };
const AUTHORIZE_URL = "https://guavahealth.com/oauth/authorize";
const SCOPE = "patient/symptoms.c offline_access";
const EARLY_MS = 60000; // refresh this long before the access token expires

class GuavaError extends Error {
  // code: an OAuth error ("invalid_grant"...), "reauth" when only signing in
  // again will help, or "http".
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A fresh PKCE pair: 256 random bits, and its S256 challenge.
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier: verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

// opts: {env: "test"|"live", clientId, clientSecret, store: {load, save},
//        fetch?, now?: () => ms, baseUrl?}
function createGuava(opts) {
  const base = opts.baseUrl || HOSTS[opts.env];
  if (!base) throw new Error("unknown Guava environment: " + opts.env);
  if (!opts.clientId || !opts.clientSecret) throw new Error("Guava client id and secret are required");
  const doFetch = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  let tokens = null;     // cached copy of what the store holds
  let refreshing = null; // the one refresh in flight

  async function postForm(path, params) {
    const body = new URLSearchParams(Object.assign({
      client_id: opts.clientId, client_secret: opts.clientSecret
    }, params));
    const res = await doFetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString()
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const code = (json && json.error) || "http";
      throw new GuavaError(code, path + ": " + ((json && json.error_description) || code || res.status), res.status);
    }
    return json || {};
  }

  // Persist first, then hand out: a crash between the two must not lose the
  // only refresh token that still works.
  async function keep(t) {
    const next = {
      access_token: t.access_token,
      refresh_token: t.refresh_token || (tokens && tokens.refresh_token),
      expires_at: now() + (t.expires_in || 3600) * 1000,
      scope: t.scope,
      patient: t.patient
    };
    await opts.store.save(next);
    tokens = next;
    return next;
  }

  // Step 1 of signing in: push the request, get the URL to open.
  async function startAuthorization(o) {
    const p = pkce(), state = b64url(crypto.randomBytes(16));
    const res = await postForm("/oauth/par", {
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      scope: o.scope || SCOPE,
      state: state,
      redirect_uri: o.redirectUri
    });
    const url = AUTHORIZE_URL + "?" + new URLSearchParams({
      client_id: opts.clientId, request_uri: res.request_uri
    }).toString();
    return { url: url, state: state, verifier: p.verifier, expiresIn: res.expires_in };
  }

  // Step 2: the redirect came back with ?code&state.
  async function finishAuthorization(o) {
    if (!o.state || o.state !== o.expectedState) throw new GuavaError("invalid_request", "state doesn't match");
    return keep(await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code: o.code,
      code_verifier: o.verifier,
      redirect_uri: o.redirectUri
    }));
  }

  async function refresh() {
    const t = tokens || await opts.store.load();
    if (!t || !t.refresh_token) throw new GuavaError("reauth", "not signed in to Guava: run `banglin-sync auth`");
    try {
      return await keep(await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token }));
    } catch (e) {
      if (e.code === "invalid_grant") throw new GuavaError("reauth", "Guava sign-in expired: run `banglin-sync auth`", e.status);
      throw e;
    }
  }

  async function accessToken(force) {
    if (!tokens) tokens = await opts.store.load();
    if (!force && tokens && tokens.access_token && tokens.expires_at - EARLY_MS > now()) return tokens.access_token;
    if (!refreshing) refreshing = refresh().finally(function() { refreshing = null; });
    return (await refreshing).access_token;
  }

  async function postSymptoms(entries) {
    async function attempt(token) {
      return doFetch(base + "/v1/data-entries", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ type: "symptoms", entries: entries })
      });
    }
    let res = await attempt(await accessToken(false));
    if (res.status === 401) res = await attempt(await accessToken(true)); // revoked or clock skew
    const text = await res.text();
    if (!res.ok) throw new GuavaError("http", "data-entries: HTTP " + res.status + " " + text.slice(0, 300), res.status);
    return JSON.parse(text);
  }

  return { startAuthorization, finishAuthorization, accessToken, postSymptoms };
}

module.exports = { createGuava, GuavaError, pkce, HOSTS, AUTHORIZE_URL, SCOPE };
