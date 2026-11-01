"use strict";

// The pull transport: banglin-sync drives the watch's JavaScript console
// over any UART-like pipe. On the NUC the pipe is Bluetooth (transports/
// bluez.js); in tests it's a fake watch.
//
// pipe: {write(string): Promise, onData(cb(string)), close(): Promise}
//
// Every transport offers the same three calls to core/cycle.js:
//   fetch({limit, now, tzHours}) -> {acked, events}
//   ack(id|null, now)            -> acked id the watch now holds
//   close()

const code = require("./watch-code.js");

function createUartTransport(pipe, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 15000;
  let buf = "", waiter = null;

  pipe.onData(function(s) {
    buf += s;
    if (waiter && code.isDone(buf)) { const w = waiter; waiter = null; w(); }
  });

  // Send one line of code and resolve with everything printed until DONE.
  function exec(js) {
    buf = "";
    return new Promise(function(resolve, reject) {
      const timer = setTimeout(function() {
        waiter = null;
        reject(new Error("watch didn't answer within " + timeoutMs + " ms"));
      }, timeoutMs);
      waiter = function() { clearTimeout(timer); resolve(buf); };
      pipe.write(code.command(js)).catch(function(e) { clearTimeout(timer); waiter = null; reject(e); });
    });
  }

  return {
    fetch: async function(o) {
      return code.parseDump(await exec(code.buildDumpCode(o)));
    },
    ack: async function(id, now) {
      return code.parseAck(await exec(code.buildAckCode(id, now)));
    },
    close: function() { return pipe.close(); }
  };
}

module.exports = { createUartTransport };
