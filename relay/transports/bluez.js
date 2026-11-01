"use strict";

// Bluetooth pipe to the watch's console (Nordic UART service) through
// BlueZ's D-Bus API. BlueZ holds the bond made once with bluetoothctl, so
// with the watch's Passkey setting on, the link is encrypted. (The espruino
// CLI's Bluetooth library talks to the adapter directly and can't use it.)
//
// The only file that needs node-ble. Not exercised by npm test, which runs
// core against a fake watch; check it on the NUC (relay/README.md).

const { createUartTransport } = require("../core/uart-transport.js");

const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // we write here
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // the watch notifies here
const CHUNK = 20; // fits the smallest BLE MTU

class NotInRange extends Error {}

async function open(cfg) {
  let ble;
  try {
    ble = require("node-ble");
  } catch (e) {
    throw new Error("the bluez transport needs node-ble: run npm install in relay/");
  }
  if (!cfg.watch) throw new Error("set the watch's Bluetooth address (config.json \"watch\" or BANGLIN_WATCH)");
  const address = cfg.watch.toUpperCase();
  const { bluetooth, destroy } = ble.createBluetooth();
  let device = null;
  try {
    const adapter = await bluetooth.defaultAdapter();
    if (!await adapter.isDiscovering()) await adapter.startDiscovery();
    try {
      device = await adapter.waitDevice(address, cfg.scanMs || 20000);
    } catch (e) {
      throw new NotInRange("watch " + address + " not in range");
    } finally {
      if (await adapter.isDiscovering()) await adapter.stopDiscovery();
    }
    await device.connect();
    const gatt = await device.gatt();
    const svc = await gatt.getPrimaryService(NUS);
    const rx = await svc.getCharacteristic(NUS_RX);
    const tx = await svc.getCharacteristic(NUS_TX);
    await tx.startNotifications();
    let onData = function() {};
    tx.on("valuechanged", function(buf) { onData(buf.toString("utf8")); });

    const pipe = {
      write: async function(s) {
        const b = Buffer.from(s, "utf8");
        for (let i = 0; i < b.length; i += CHUNK) await rx.writeValue(b.subarray(i, i + CHUNK), { type: "request" });
      },
      onData: function(cb) { onData = cb; },
      close: async function() {
        try { await tx.stopNotifications(); } catch (e) { /* already gone */ }
        try { await device.disconnect(); } catch (e) { /* already gone */ }
        destroy();
      }
    };
    return createUartTransport(pipe, { timeoutMs: cfg.watchTimeoutMs || 15000 });
  } catch (e) {
    if (device) { try { await device.disconnect(); } catch (e2) { /* ignore */ } }
    destroy();
    throw e;
  }
}

module.exports = { open, NotInRange };
