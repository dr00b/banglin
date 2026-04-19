(function(root) {
  var OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
  var HOURLY_FIELDS = "temperature_2m,surface_pressure,relative_humidity_2m,precipitation,cloud_cover";

  function buildUrl(lat, lon) {
    return OPEN_METEO
      + "?latitude=" + encodeURIComponent(lat)
      + "&longitude=" + encodeURIComponent(lon)
      + "&hourly=" + HOURLY_FIELDS
      + "&forecast_days=1";
  }

  function sampleAtHour(forecast, targetMin) {
    if (!forecast || !forecast.hourly || !forecast.hourly.time) return null;
    var times = forecast.hourly.time;
    var closestIdx = -1, closestDrift = Infinity;
    for (var i = 0; i < times.length; i++) {
      var tMin = Math.floor(new Date(times[i]).getTime() / 60000);
      var d = Math.abs(tMin - targetMin);
      if (d < closestDrift) { closestDrift = d; closestIdx = i; }
    }
    if (closestIdx < 0 || closestDrift > 60) return null;
    var h = forecast.hourly;
    return {
      humidity: h.relative_humidity_2m ? h.relative_humidity_2m[closestIdx] : null,
      precip:   h.precipitation         ? h.precipitation[closestIdx]         : null,
      temp:     h.temperature_2m        ? h.temperature_2m[closestIdx]        : null,
      pressure: h.surface_pressure      ? h.surface_pressure[closestIdx]      : null
    };
  }

  function fetchForecast(lat, lon, onResult, onError) {
    if (typeof GB !== "function") { if (onError) onError("no-gb"); return; }
    if (typeof NRF !== "undefined" && NRF.connected === false) {
      if (onError) onError("not-connected");
      return;
    }
    var url = buildUrl(lat, lon);
    var handler = function(evt) {
      if (!evt || !evt.resp) return;
      try {
        var json = JSON.parse(evt.resp);
        if (typeof Bangle !== "undefined") Bangle.removeListener("HTTP", handler);
        onResult(json);
      } catch (e) {
        if (typeof Bangle !== "undefined") Bangle.removeListener("HTTP", handler);
        if (onError) onError(String(e));
      }
    };
    if (typeof Bangle !== "undefined") Bangle.on("HTTP", handler);
    GB({ t: "http", url: url });
  }

  var api = {
    buildUrl: buildUrl,
    sampleAtHour: sampleAtHour,
    fetchForecast: fetchForecast
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.stormyWeather = api;
})(typeof global !== "undefined" ? global : this);
