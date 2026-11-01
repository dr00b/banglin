# banglin-sync

Gets [Mr Morse](../apps/mr-morse/README.md) events off the watch and into
[Guava Health](https://guavahealth.com), with no phone involved. A computer
at home (the NUC) connects to the watch over Bluetooth every 15 minutes,
reads the events it hasn't sent yet, writes them to Guava as symptom
entries, and only then tells the watch they're sent.

```
watch ◄── Bluetooth, bonded + encrypted ──► NUC: banglin-sync ── HTTPS ──► api.guavahealth.com
```

- **At home only.** Events sync while the watch is in Bluetooth range of the
  NUC. Away from home they wait on the watch (it keeps 500) and go up when
  you're back.
- **Nothing lost or doubled.** Each event has an id that's never reused, and
  is sent with an identifier (`banglin.mr-morse` / `<watch address>-<id>`).
  Guava ignores an identifier it has already accepted, so a sync interrupted
  at any point is simply repeated.
- **The watch's clock.** Without a phone nothing else sets the watch's time,
  so each sync sets it (when more than 2 s out) and the timezone.
- **Severity.** The watch's 1–5 becomes Guava's 0–10 as 2, 4, 6, 8, 10
  (`severityMap` in `config.json` to change it).

## Setup on the NUC

You need Linux with BlueZ, Node 20 or newer, and a Guava account.

### 1. Register with Guava

In Guava's developer portal, log in under **Personal**, and create a
client with the scopes `patient/symptoms.c` and `offline_access`. Its
redirect URI must be an HTTPS address that reaches the NUC. With Tailscale:

```bash
sudo tailscale serve --bg 8787     # https://<nuc>.<tailnet>.ts.net → 127.0.0.1:8787
```

and register `https://<nuc>.<tailnet>.ts.net/oauth/callback`. Only your
tailnet can reach it, and `banglin-sync auth` only listens while you sign in.
(If Guava won't accept that address, use `auth --paste`, below.)

### 2. Install

```bash
sudo useradd --system --create-home --groups bluetooth banglin
sudo cp -r relay /opt/banglin-sync
cd /opt/banglin-sync && sudo npm install --omit=dev     # installs node-ble
sudo install -d -m 700 -o banglin /var/lib/banglin-sync
sudo install -m 600 -o banglin /dev/null /etc/banglin-sync.env
```

Put the client's credentials in `/etc/banglin-sync.env`:

```
GUAVA_CLIENT_ID=...
GUAVA_CLIENT_SECRET=...
```

and the rest in `/var/lib/banglin-sync/config.json` (owned by `banglin`,
mode 600), starting from [config.example.json](config.example.json):

| Key | Default | What |
|---|---|---|
| `guavaEnv` | `test` | `test` (sandbox) or `live` |
| `watch` | | The watch's Bluetooth address |
| `intervalMin` | 15 | Minutes between syncs |
| `batchLimit` | 200 | Events per sync; a bigger backlog takes several |
| `redirectUri` | | The redirect URI registered with Guava |
| `callbackPort` | 8787 | Where `auth` listens for it, on 127.0.0.1 |
| `severityMap` | 1→2 … 5→10 | Watch severity to Guava's 0–10 |

Any of `GUAVA_ENV`, `BANGLIN_WATCH` and `BANGLIN_SYNC_HOME` in the
environment override the file.

### 3. Pair the watch, so only the NUC can connect

The watch's Bluetooth console runs any code it's sent, so lock it to the NUC:

1. On the watch: **Settings → Bluetooth → Passkey**, set six digits.
2. On the NUC: `bluetoothctl`, then `scan on`, find the watch, and
   `pair <address>` (enter the passkey), `trust <address>`, `quit`.
3. On the watch: **Settings → Bluetooth → Whitelist → Add device**, then
   connect once from the NUC.

BlueZ keeps the bond, and banglin-sync goes through BlueZ, so every sync is
encrypted. The whitelist also locks out your laptop's `npm run dev` and
`npm run pull`: add the laptop the same way, or turn the whitelist off while
developing.

Check the link before going further. Not signed in yet, this should
connect, read the watch and fail only at Guava ("not signed in"):

```bash
sudo -u banglin sh -c 'set -a; . /etc/banglin-sync.env; BANGLIN_SYNC_HOME=/var/lib/banglin-sync \
  exec /opt/banglin-sync/bin/banglin-sync run --once'
```

### 4. Sign in to Guava

```bash
sudo -u banglin sh -c 'set -a; . /etc/banglin-sync.env; BANGLIN_SYNC_HOME=/var/lib/banglin-sync \
  exec /opt/banglin-sync/bin/banglin-sync auth'
```

Open the address it prints on any device on your tailnet, approve, and the
browser lands back on the NUC. With `auth --paste` instead, nothing listens:
paste the address Guava sent your browser to (even if the page failed to
load).

Guava's tokens are kept in `tokens.json` in the state folder (mode 600). A
refresh replaces both tokens, and both are written to disk before either is
used, as Guava requires.

### 5. Run it

```bash
sudo cp /opt/banglin-sync/banglin-sync.service /etc/systemd/system/
sudo systemctl enable --now banglin-sync
journalctl -u banglin-sync -f
```

Each sync logs one line: `synced: 2 sent, 2 new in Guava, watch acked to 41`,
or why it didn't (`watch … not in range`, `Guava sign-in expired: run
banglin-sync auth`). It keeps retrying, and the watch keeps the events, so
nothing is lost while it's broken.

Start on `"guavaEnv": "test"`, check entries arrive in the sandbox, then
switch to `live` and run `auth` again (the two environments have separate
tokens).

`banglin-sync status` shows the setup and sign-in state, never the secrets.

## Code

```
core/          plain Node, no dependencies: runs anywhere Node does
  cli.js         run / auth / status
  cycle.js       one sync: fetch → post to Guava → ack
  guava.js       OAuth 2.1 (PAR, PKCE, rotating refresh) and the symptoms write
  entries.js     watch events → Guava entries
  watch-code.js  the code sent to the watch, and parsing its answers
  uart-transport.js  drives the watch's console over any pipe
  transports.js  picks a transport, loading it only when chosen
  state.js       state folder, config, atomic 0600 writes
transports/
  bluez.js       Bluetooth via BlueZ/D-Bus (the only file needing node-ble)
```

Tests are in `tests/` and run with the repo's `npm test`
(see [tests/REGISTRY.md](../tests/REGISTRY.md)): the watch code runs against
the Bangle mock, Guava is faked, and `apps/mr-morse/tests/emulator.spec.js`
runs the watch code on the real firmware. `transports/bluez.js` can only be
checked against a real watch (step 3).

## Later: running on the phone instead

`core/` is kept runnable under Termux, and `tests/portability.test.js` keeps it
that way: no node-ble, no fixed system paths, no `Intl`, state in
`$BANGLIN_SYNC_HOME` or `~/.local/state/banglin-sync`.

What would change: Termux can't use Bluetooth itself, so on a phone the watch
would push events through Gadgetbridge's HTTP feature to banglin-sync
listening on 127.0.0.1, with the ack in the response. That's a second
transport (`http`, not built yet: `run --transport http` says so). The watch's
data (`morse.log.json` ids, `morse.sync.json` cursor) and everything else in
`core/` stay the same. [termux-boot.sh](termux-boot.sh) is the launcher for
that day.
