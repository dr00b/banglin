// Top-right badge: blue with the running count while counting, green with the
// severity for a minute after an event is logged, otherwise a dim ring.
(function() {
  function draw() {
    var GS = global.GSYM1;
    if (!GS || this.x === undefined) return;
    var cx = this.x + 12, cy = this.y + 12;
    g.reset().clearRect(this.x, this.y, this.x + 23, this.y + 23);
    var recent = GS.last && !GS.last.dry && GS.last.severity > 0 && Date.now() - GS.last.t < 60000;
    if (GS.state === "counting" || recent) {
      // Pure palette colours: Bangle.js 2 has a 3-bit display and dithers others.
      var counting = GS.state === "counting";
      g.setColor(counting ? "#00f" : "#0f0").fillCircle(cx, cy, 10);
      g.setColor(counting ? "#fff" : "#000").setFont("6x8", 2).setFontAlign(0, 0);
      g.drawString(String(GS.state === "counting" ? GS.count : GS.last.severity), cx + 1, cy + 1);
    } else {
      g.drawCircle(cx, cy, 8).fillCircle(cx, cy, 2);
    }
  }

  WIDGETS.gsym1 = { area: "tr", width: global.GSYM1 ? 24 : 0, draw: draw };
})();
