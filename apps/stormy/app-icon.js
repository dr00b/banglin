(function() {
  var g = Graphics.createArrayBuffer(48, 48, 1, {msb: true});
  g.setColor(1);
  g.fillCircle(17, 24, 10);
  g.fillCircle(31, 24, 10);
  g.fillCircle(24, 16, 10);
  g.fillRect(14, 24, 34, 34);
  g.setColor(0);
  g.fillPoly([26,26, 32,26, 28,34, 34,34, 22,46, 26,34, 22,34]);
  return g.asImage();
})()
