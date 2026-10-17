(function() {
  var g = Graphics.createArrayBuffer(48, 48, 1, {msb: true});
  g.setColor(1);
  // twist arcs above and below the watch, with arrow heads
  g.drawCircle(24, 24, 20).drawCircle(24, 24, 21);
  g.setColor(0).fillRect(0, 15, 47, 33);
  g.setColor(1);
  g.fillPoly([1,15, 9,15, 5,22]);
  g.fillPoly([39,33, 47,33, 43,26]);
  // strap and watch face with a logged dot
  g.fillRect(19, 0, 29, 47);
  g.setColor(0).fillCircle(24, 24, 12);
  g.setColor(1).fillCircle(24, 24, 10);
  g.setColor(0).fillCircle(24, 24, 8);
  g.setColor(1).fillCircle(24, 24, 3);
  return g.asImage();
})()
