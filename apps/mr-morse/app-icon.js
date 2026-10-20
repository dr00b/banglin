(function() {
  var g = Graphics.createArrayBuffer(48, 48, 1, {msb: true});
  g.setColor(1);
  // strap and watch case
  g.fillRect(19, 0, 29, 47);
  g.fillCircle(24, 24, 17);
  g.setColor(0).fillCircle(24, 24, 15);
  // a dot and a dash: the tap language
  g.setColor(1);
  g.fillCircle(16, 24, 4);
  g.fillRect(23, 21, 34, 27);
  return g.asImage("string");
})()
