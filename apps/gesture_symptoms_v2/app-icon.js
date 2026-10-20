(function() {
  var g = Graphics.createArrayBuffer(48, 48, 1, {msb: true});
  g.setColor(1);
  // strap and watch case
  g.fillRect(19, 0, 29, 47);
  g.fillCircle(24, 24, 17);
  g.setColor(0).fillCircle(24, 24, 15);
  // tap ripples spreading from the point of contact
  g.setColor(1);
  g.drawCircle(24, 24, 13).drawCircle(24, 24, 12);
  g.drawCircle(24, 24, 9).drawCircle(24, 24, 8);
  g.fillCircle(24, 24, 4);
  return g.asImage("string");
})()
