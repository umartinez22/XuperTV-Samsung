"use strict";
// Servidor para TV Samsung (Tizen): carga el servicio original con un sustituto
// de "webos-service" y lo expone por HTTP en la red local.
//
//   XUPER_PUBLIC_HOST=192.168.1.95 node server.js
//
var os = require("os");
var Module = require("module");
var path = require("path");

var PORT = parseInt(process.env.PORT, 10) || 8910;

function lanIp() {
  var nets = os.networkInterfaces();
  for (var n in nets) {
    for (var i = 0; i < nets[n].length; i++) {
      var a = nets[n][i];
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "127.0.0.1";
}
if (!process.env.XUPER_PUBLIC_HOST) process.env.XUPER_PUBLIC_HOST = lanIp();

// require("webos-service") -> ./webos-service.js
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === "webos-service") return path.join(__dirname, "webos-service.js");
  return origResolve.apply(this, arguments);
};

var Service = require("webos-service");
require("./index.js");
var magis = require("./magis");
var proxy = require("./proxy");
var dash = require("./ffmpeg-dash");
Service.last.register("resolveDash", function (request) {
  dash.cleanupAll();
  var payload = request.payload || {};
  magis.resolve(payload.contentId, payload.seriesContentId, { trackIndex: payload.trackIndex }, function (err, stream) {
    if (err) {
      request.respond({ returnValue: false, errorText: err.message || String(err), errorCode: err.portalCode || 1 });
      return;
    }
    proxy.start(function (proxyErr) {
      if (proxyErr) {
        request.respond({ returnValue: false, errorText: proxyErr.message || String(proxyErr), errorCode: 1 });
        return;
      }
      dash.register(stream, { audio: payload.audioTrack }, function (dashErr, manifestUrl) {
        if (dashErr) {
          request.respond({ returnValue: false, errorText: dashErr.message || String(dashErr), errorCode: 1 });
          return;
        }
        stream.url = manifestUrl;
        stream.mime = "application/dash+xml";
        stream.proxyPath = manifestUrl;
        stream.isDash = true;
        stream.isHls = false;
        if (stream.subtitles && stream.subtitles.length) {
          stream.subtitles = stream.subtitles.map(function (subtitle) {
            return { lang: subtitle.lang, format: subtitle.format, url: proxy.addSubtitle(subtitle.url) };
          });
        }
        stream.returnValue = true;
        request.respond(stream);
      });
    });
  });
});
Service.listen(PORT, "0.0.0.0", function () {
  console.log("[xuper-server] escuchando en http://" + process.env.XUPER_PUBLIC_HOST + ":" + PORT);
  console.log("[xuper-server] ffmpeg: " + (process.env.FFMPEG_PATH || (process.platform === "win32" ? "ffmpeg.exe (junto al servidor)" : "/usr/bin/ffmpeg")));
});
