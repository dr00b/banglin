(function() {
  function alertPending() {
    var s = require("Storage").readJSON("stormy.json", 1);
    return !!(s && s.alertPending);
  }

  function draw() {
    var x = this.x, y = this.y;
    var pending = alertPending();
    var dark = g.theme && g.theme.dark;
    var fg = dark ? (pending ? "#ffcc33" : "#cccccc") : (pending ? "#cc6600" : "#666666");
    g.reset();
    g.setColor(fg);
    g.fillCircle(x + 8, y + 14, 5);
    g.fillCircle(x + 16, y + 14, 5);
    g.fillCircle(x + 12, y + 10, 5);
    g.fillRect(x + 6, y + 14, x + 18, y + 18);
    if (pending) {
      g.setColor(dark ? "#ffff66" : "#cc3300");
      g.fillPoly([x+13,y+12, x+16,y+12, x+14,y+16, x+17,y+16, x+11,y+22, x+13,y+17, x+11,y+17]);
    }
  }

  WIDGETS["stormy"] = {
    area: "tl", width: 24,
    draw: draw
  };
})();
