"use strict";

// The JavaScript banglin-sync sends to the watch over its Bluetooth console,
// and the parsing of what the watch prints back. Same marker-and-line-count
// idea as scripts/pull.js: a line lost on the way is caught, not acked.
//
// The watch's side of the contract (apps/mr-morse):
//   morse.log.json   [{id, t, s, sym, src}]   ids are never reused
//   morse.sync.json  {acked, last}           written only by this code

// One line for the console. The leading \x10 turns off echo for that line.
function command(code) {
  return "\x10" + code + "\n";
}

// Sets the watch's clock (nothing else does, without a phone), gives ids to
// any events logged before ids existed, then prints up to `limit` events
// above the acked cursor, lowest id first. Lowest first matters: acking the
// highest id of a batch has to mean every id below it was sent too.
// opts: {now: unix seconds, tzHours, limit}
function buildDumpCode(opts) {
  const now = Math.round(opts.now), tz = Number(opts.tzHours), limit = opts.limit | 0;
  if (!Number.isFinite(now) || !Number.isFinite(tz) || limit < 1) throw new Error("bad dump options");
  return "(function(){var S=require(\"Storage\");" +
    "if(Math.abs(getTime()-" + now + ")>2)setTime(" + now + ");E.setTimeZone(" + tz + ");" +
    "var a=(S.readJSON(\"morse.sync.json\",1)||{}).acked||0,l=S.readJSON(\"morse.log.json\",1)||[]," +
    "d=(S.readJSON(\"morse.json\",1)||{}).symptom,m=a,c=0,o=[],i;" +
    "for(i=0;i<l.length;i++)if(l[i].id>m)m=l[i].id;" +
    "for(i=0;i<l.length;i++)if(l[i].id===undefined){l[i].id=++m;c=1;}" +
    "if(c)S.writeJSON(\"morse.log.json\",l);" +
    "for(i=0;i<l.length;i++)if(l[i].id>a)o.push(l[i]);" +
    "o.sort(function(x,y){return x.id-y.id;});o=o.slice(0," + limit + ");" +
    "print(\"<<<EVENTS \"+a+\" \"+o.length+\">>>\");" +
    "o.forEach(function(e){print(JSON.stringify({id:e.id,t:e.t,s:e.s,sym:e.sym||d}));});" +
    "print(\"<<<END \"+o.length+\">>>\");print(\"<<<DONE>>>\");})()";
}

// Moves the cursor up to `acked` (never back) and stamps the sync time, then
// tells the engine whether anything is still waiting so the widget's dot is
// right. acked may be null to only stamp the time.
function buildAckCode(acked, now) {
  now = Math.round(now);
  if (acked !== null && !Number.isInteger(acked)) throw new Error("bad ack id");
  if (!Number.isFinite(now)) throw new Error("bad ack time");
  return "(function(){var S=require(\"Storage\"),s=S.readJSON(\"morse.sync.json\",1)||{};" +
    (acked === null ? "" : "if(" + acked + ">(s.acked||0))s.acked=" + acked + ";") +
    "s.acked=s.acked||0;s.last=" + now + ";S.writeJSON(\"morse.sync.json\",s);" +
    "if(global.MORSE){MORSE.unsent=(S.readJSON(\"morse.log.json\",1)||[]).some(function(e){return !(e.id<=s.acked);});" +
    "if(global.WIDGETS&&WIDGETS.morse)WIDGETS.morse.draw();}" +
    "print(\"<<<ACKED \"+s.acked+\">>>\");print(\"<<<DONE>>>\");})()";
}

// Console lines, without the prompt characters and carriage returns the
// console mixes in.
function lines(output) {
  return output.split("\n").map(function(l) { return l.replace(/^[\s>]+/, "").replace(/\s+$/, ""); });
}

function isDone(output) {
  return lines(output).indexOf("<<<DONE>>>") >= 0;
}

// {acked, events}, or throws if anything is missing or malformed.
function parseDump(output) {
  const ls = lines(output);
  const start = ls.findIndex((l) => /^<<<EVENTS \d+ \d+>>>$/.test(l));
  if (start < 0) throw new Error("watch printed no events header");
  const head = /^<<<EVENTS (\d+) (\d+)>>>$/.exec(ls[start]);
  const n = +head[2], events = [];
  let i = start + 1;
  for (; i < ls.length && !/^<<<END \d+>>>$/.test(ls[i]); i++) {
    if (ls[i] === "") continue;
    try { events.push(JSON.parse(ls[i])); }
    catch (e) { throw new Error("unreadable event line: " + ls[i]); }
  }
  if (i >= ls.length) throw new Error("dump cut short");
  if (+/^<<<END (\d+)>>>$/.exec(ls[i])[1] !== n || events.length !== n) {
    throw new Error("expected " + n + " events, got " + events.length);
  }
  return { acked: +head[1], events: events };
}

function parseAck(output) {
  const m = lines(output).map((l) => /^<<<ACKED (\d+)>>>$/.exec(l)).find(Boolean);
  if (!m) throw new Error("watch didn't confirm the ack");
  return +m[1];
}

module.exports = { command, buildDumpCode, buildAckCode, parseDump, parseAck, isDone, lines };
