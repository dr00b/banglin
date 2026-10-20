// Espruino-side code (sent as text to the emulator) that stubs the pieces a
// real watch has but the bare emulator lacks, plus hooks scenes use to drive
// menus without simulating touches.

// BangleApps modules that live in Storage on a real watch, not in firmware.
const STORAGE_MODULES = {
  time_utils:
    "exports.encodeTime=function(t){return ((t.h||0)*3600+(t.m||0)*60+(t.s||0))*1000;};" +
    "exports.decodeTime=function(ms){var s=Math.floor(ms/1000);return {h:Math.floor(s/3600),m:Math.floor(s%3600/60),s:s%60};};" +
    "exports.formatTime=function(ms){var t=exports.decodeTime(ms);return t.h+\":\"+(\"0\"+t.m).substr(-2);};" +
    "exports.getCurrentTimeMillis=function(){var d=new Date();return d.getHours()*3600000+d.getMinutes()*60000;};"
};

// `__menus` records every E.showMenu call so scenes can call `__pick(label)`
// to activate an item. `__scroll(px)` drags the current screen up by px, the
// same way a finger would.
const MENU_HOOK =
  "var __menus=[];" +
  "(function(){var orig=E.showMenu;E.showMenu=function(m){__menus.push(m);return orig(m);};})();" +
  "function __pick(label){var m=__menus[__menus.length-1];var it=m&&m[label];" +
  "if(typeof it===\"function\")it();else throw new Error(\"no menu item \"+label);}" +
  "function __scroll(px){for(;px>0;px-=20)Bangle.emit(\"drag\",{x:88,y:100,dx:0,dy:-Math.min(20,px),b:1});" +
  "Bangle.emit(\"drag\",{x:88,y:100,dx:0,dy:0,b:0});}\n";

// A static clock face so widgets can be shown in context.
const FAKE_CLOCK =
  "g.reset().clear();" +
  "g.setFontAlign(0,0).setFont(\"Vector\",56).drawString(\"10:42\",88,96);" +
  "g.setFont(\"6x8\",2).drawString(\"Sat 17 Oct\",88,136);\n";

function prelude() {
  var code = "";
  for (var name in STORAGE_MODULES) {
    code += "require(\"Storage\").write(" + JSON.stringify(name) + "," +
      JSON.stringify(STORAGE_MODULES[name]) + ");\n";
  }
  return code + MENU_HOOK;
}

// Write a file into the emulator's Storage.
function storageWrite(name, content) {
  return "require(\"Storage\").write(" + JSON.stringify(name) + "," + JSON.stringify(content) + ");\n";
}

function storageWriteJSON(name, obj) {
  return "require(\"Storage\").writeJSON(" + JSON.stringify(name) + "," + JSON.stringify(obj) + ");\n";
}

module.exports = { prelude, storageWrite, storageWriteJSON, FAKE_CLOCK };
