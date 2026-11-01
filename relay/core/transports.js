"use strict";

// Picks the transport by name, loading it only when chosen: the Bluetooth
// one needs node-ble (D-Bus, BlueZ), which a phone doesn't have, and core
// must load without it.
//
//   bluez  NUC pulls from the watch over Bluetooth (BlueZ on Linux).
//   http   (not built yet) the watch pushes through Gadgetbridge to a local
//          server, for running on a phone under Termux.

async function openTransport(name, cfg) {
  if (name === "bluez") return require("../transports/bluez.js").open(cfg);
  if (name === "http") throw new Error("the http transport (watch pushes via Gadgetbridge) isn't implemented yet");
  throw new Error("unknown transport: " + name);
}

module.exports = { openTransport };
