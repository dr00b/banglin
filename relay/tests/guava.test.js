"use strict";

// The Guava client against a fake Guava: sign-in, token rotation, and the
// symptoms write.

const test = require("node:test");
const assert = require("node:assert");
const { createGuava, AUTHORIZE_URL } = require("../core/guava.js");
const { createFakeGuava, memoryStore } = require("./fake-guava.js");

function client(fake, store, now) {
  return createGuava({ env: "test", clientId: "cid", clientSecret: "secret", store: store, fetch: fake.fetch, now: now });
}
const T0 = 1767225600000;

test("signing in pushes a PKCE S256 request, then exchanges the code with its verifier", async function() {
  const fake = createFakeGuava(), store = memoryStore(), g = client(fake, store, () => T0);
  const start = await g.startAuthorization({ redirectUri: "https://nuc/cb" });
  const par = fake.calls[0].params;
  assert.strictEqual(par.code_challenge_method, "S256");
  assert.strictEqual(par.scope, "patient/symptoms.c offline_access");
  assert.strictEqual(par.redirect_uri, "https://nuc/cb");
  assert.ok(start.verifier.length >= 43, "at least 256 bits");
  assert.strictEqual(start.url, AUTHORIZE_URL + "?client_id=cid&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Aabc");
  assert.strictEqual(fake.calls[0].init.body.indexOf(start.state) > 0, true);

  const t = await g.finishAuthorization({ code: "the-code", state: start.state, expectedState: start.state, verifier: start.verifier, redirectUri: "https://nuc/cb" });
  assert.strictEqual(t.refresh_token, "rt1");
  assert.strictEqual(store.tokens.expires_at, T0 + 3600000);
});

test("a redirect whose state doesn't match is refused", async function() {
  const fake = createFakeGuava(), g = client(fake, memoryStore(), () => T0);
  const start = await g.startAuthorization({ redirectUri: "https://nuc/cb" });
  await assert.rejects(g.finishAuthorization({ code: "the-code", state: "forged", expectedState: start.state, verifier: start.verifier }), /state/);
  assert.strictEqual(fake.calls.length, 1, "no token request made");
});

test("rotated tokens are saved before either is used", async function() {
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(T0 - 1);
  let savedBeforeUse = null;
  const realFetch = fake.fetch;
  fake.fetch = async function(url, init) {
    if (url.endsWith("/v1/data-entries")) savedBeforeUse = store.saves.length && store.saves[0].access_token;
    return realFetch(url, init);
  };
  const g = client(fake, store, () => T0);
  await g.postSymptoms([]);
  assert.strictEqual(savedBeforeUse, "at2");
  assert.strictEqual(store.tokens.refresh_token, "rt2");
});

test("a valid access token is reused without refreshing", async function() {
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(T0 + 3600000);
  const g = client(fake, store, () => T0);
  await g.postSymptoms([]);
  await g.postSymptoms([]);
  assert.strictEqual(fake.refreshes, 0);
});

test("concurrent calls share one refresh, so the rotated token is never reused", async function() {
  const fake = createFakeGuava({ refreshDelayMs: 20 }), store = memoryStore();
  store.tokens = fake.signedIn(T0 - 1);
  const g = client(fake, store, () => T0);
  const tokens = await Promise.all([g.accessToken(), g.accessToken(), g.accessToken()]);
  assert.deepStrictEqual(tokens, ["at2", "at2", "at2"]);
  assert.strictEqual(fake.refreshes, 1);
});

test("an expired sign-in (invalid_grant) asks for auth again", async function() {
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(T0 - 1);
  store.tokens.refresh_token = "stale";
  const g = client(fake, store, () => T0);
  await assert.rejects(g.postSymptoms([]), (e) => e.code === "reauth" && /banglin-sync auth/.test(e.message));
  await assert.rejects(client(fake, memoryStore(), () => T0).accessToken(), (e) => e.code === "reauth", "never signed in");
});

test("a 401 refreshes once and retries", async function() {
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(T0 + 3600000);
  fake.revokeAccess = true;
  const g = client(fake, store, () => T0);
  assert.deepStrictEqual(await g.postSymptoms([]), { accepted: 0, environment: "test" });
  assert.strictEqual(fake.refreshes, 1);
});

test("symptoms are posted as one data-entries batch, client credentials as form fields only", async function() {
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(T0 - 1);
  const g = client(fake, store, () => T0);
  const e = { time: "2026-01-01T00:00:00+00:00", symptom_name: "Headache", severity: 6, identifier: [{ system: "s", value: "v" }] };
  assert.strictEqual((await g.postSymptoms([e])).accepted, 1);
  const write = fake.calls.find((c) => c.path === "/v1/data-entries");
  assert.deepStrictEqual(write.body, { type: "symptoms", entries: [e] });
  for (const c of fake.calls.filter((c) => c.path.startsWith("/oauth"))) {
    assert.strictEqual(c.init.headers.Authorization, undefined);
    assert.strictEqual(c.params.client_secret, "secret");
  }
  await assert.rejects(Promise.resolve().then(() => createGuava({ env: "prod", clientId: "a", clientSecret: "b", store: store })), /unknown Guava environment/);
});
