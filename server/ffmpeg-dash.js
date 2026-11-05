"use strict";

var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var spawn = require("child_process").spawn;

var FFMPEG = process.env.FFMPEG_PATH || (process.platform === "win32" ? path.join(__dirname, "ffmpeg.exe") : "/usr/bin/ffmpeg");
var HOST = process.env.XUPER_PUBLIC_HOST || "127.0.0.1";
var PORT = parseInt(process.env.XUPER_DASH_PORT, 10) || 8788;
var SESSION_TTL = 60 * 60 * 1000;
var sessions = {};
var server = null;
var listenCallbacks = [];
var listening = false;

function log() {
  console.log.apply(console, ["[dash]"].concat(Array.prototype.slice.call(arguments)));
}

function cleanup(session) {
  if (session.timer) clearTimeout(session.timer);
  if (session.ff) {
    try { session.ff.kill("SIGTERM"); } catch (err) {
      if (err.code !== "ESRCH") log("no se pudo detener ffmpeg:", err.message);
    }
    session.ff = null;
  }
  try {
    fs.readdirSync(session.dir).forEach(function (name) {
      try { fs.unlinkSync(path.join(session.dir, name)); } catch (err) {
        if (err.code !== "ENOENT") log("no se pudo borrar", name + ":", err.message);
      }
    });
    fs.rmdirSync(session.dir);
  } catch (err) {
    if (err.code !== "ENOENT") log("no se pudo borrar el directorio DASH:", err.message);
  }
  delete sessions[session.id];
}

function keepAlive(session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(function () { cleanup(session); }, SESSION_TTL);
  if (session.timer.unref) session.timer.unref();
}

function contentType(file) {
  if (/\.mpd$/i.test(file)) return "application/dash+xml";
  if (/\.m4s$/i.test(file)) return "video/iso.segment";
  if (/\.mp4$/i.test(file)) return "video/mp4";
  return "application/octet-stream";
}

function usableManifest(manifest) {
  return /<MPD(?:\s|>)/i.test(manifest) &&
    /<Representation(?:\s|>)/i.test(manifest) &&
    /<SegmentTemplate(?:\s|>)/i.test(manifest);
}

function serve(req, res) {
  var cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, Object.assign({ "Allow": "GET, HEAD, OPTIONS" }, cors));
    return res.end("method not allowed");
  }
  var match = /^\/dash\/([0-9a-f]{16})\/([A-Za-z0-9_.-]+)$/.exec(req.url.split("?")[0]);
  var session = match && sessions[match[1]];
  var name = match && match[2];
  if (!session || !name || name === "." || name === "..") {
    res.writeHead(404, cors);
    return res.end("not found");
  }
  var file = path.join(session.dir, name);
  if (/\.mpd$/i.test(name)) {
    var manifest;
    try { manifest = fs.readFileSync(file, "utf8"); } catch (e) {
      if (e.code !== "ENOENT") log("no se pudo leer el manifiesto DASH:", e.message);
    }
    if (usableManifest(manifest || "")) {
      session.manifest = manifest;
    } else {
      manifest = session.manifest;
    }
    if (!manifest) {
      res.writeHead(503, Object.assign({ "Retry-After": "1" }, cors));
      return res.end("manifest not ready");
    }
    keepAlive(session);
    res.writeHead(200, Object.assign({
      "Content-Type": contentType(name),
      "Content-Length": Buffer.byteLength(manifest),
      "Cache-Control": "no-cache"
    }, cors));
    return req.method === "HEAD" ? res.end() : res.end(manifest);
  }
  var stat;
  try { stat = fs.statSync(file); } catch (e) {
    res.writeHead(404, cors);
    return res.end("not found");
  }
  if (!stat.isFile()) {
    res.writeHead(404, cors);
    return res.end("not found");
  }
  keepAlive(session);
  res.writeHead(200, Object.assign({
    "Content-Type": contentType(name),
    "Content-Length": stat.size,
    "Cache-Control": /\.mpd$/i.test(name) ? "no-cache" : "public, max-age=3600"
  }, cors));
  if (req.method === "HEAD") return res.end();
  var input = fs.createReadStream(file);
  input.on("error", function (err) {
    log("no se pudo leer", name + ":", err.message);
    if (!res.headersSent) res.writeHead(500, cors);
    res.end();
  });
  input.pipe(res);
}

function start(callback) {
  if (listening) return callback(null);
  listenCallbacks.push(callback);
  if (server) return;
  server = http.createServer(serve);
  server.on("error", function (err) {
    var callbacks = listenCallbacks.splice(0);
    server = null;
    callbacks.forEach(function (done) { done(err); });
  });
  server.listen(PORT, "0.0.0.0", function () {
    listening = true;
    var callbacks = listenCallbacks.splice(0);
    callbacks.forEach(function (done) { done(null); });
    log("escuchando en", HOST + ":" + PORT);
  });
}

function splitHeaders(headers) {
  var userAgent = "";
  var rest = [];
  Object.keys(headers || {}).forEach(function (key) {
    if (key.toLowerCase() === "user-agent") userAgent = headers[key];
    else rest.push(key + ": " + headers[key] + "\r\n");
  });
  return { userAgent: userAgent, rest: rest.join("") };
}

function buildArgs(stream, options, output) {
  var headers = splitHeaders(stream.headers);
  var args = ["-hide_banner", "-loglevel", "warning", "-nostdin", "-y"];
  if (/^https?:\/\//i.test(stream.url)) {
    args.push("-rw_timeout", "15000000");
    if (headers.userAgent) args.push("-user_agent", String(headers.userAgent));
    if (headers.rest) args.push("-headers", headers.rest);
  }
  args.push("-i", stream.url, "-map", "0:v:0", "-map", "0:a:" + (Number(options.audio) || 0) + "?");
  args.push("-c", "copy");
  if (/hevc|h\.?265/i.test(stream.codec || "") || /hevc|h\.?265/i.test(stream.mime || "")) {
    args.push("-tag:v", "hvc1");
  }
  args.push("-tag:a", "mp4a");
  args.push("-seg_duration", "4", "-use_template", "1", "-use_timeline", "1");
  args.push("-init_seg_name", "init-$RepresentationID$.m4s");
  args.push("-media_seg_name", "chunk-$RepresentationID$-$Number%05d$.m4s");
  args.push("-f", "dash", output);
  return args;
}

function register(stream, options, callback) {
  options = options || {};
  if (!stream || !/^https?:\/\//i.test(stream.url || "")) {
    return callback(new Error("el stream no contiene una URL HTTP válida"));
  }
  try {
    fs.accessSync(FFMPEG, fs.constants && fs.constants.X_OK || fs.X_OK || 1);
  } catch (err) {
    return callback(new Error("no se puede ejecutar ffmpeg en " + FFMPEG + ": " + err.message));
  }

  start(function (err) {
    if (err) return callback(new Error("no se pudo iniciar el servidor DASH: " + err.message));
    var id = crypto.randomBytes(8).toString("hex");
    var dir;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "xuper-dash-"));
    } catch (mkdirErr) {
      return callback(new Error("no se pudo crear el directorio DASH: " + mkdirErr.message));
    }
    var session = sessions[id] = { id: id, dir: dir, ff: null, timer: null, manifest: null };
    keepAlive(session);
    var output = path.join(dir, "manifest.mpd");
    var ff;
    try {
      ff = spawn(FFMPEG, buildArgs(stream, options, output), { stdio: ["ignore", "ignore", "pipe"] });
    } catch (spawnErr) {
      cleanup(session);
      return callback(new Error("no se pudo iniciar ffmpeg: " + spawnErr.message));
    }
    session.ff = ff;

    var finished = false;
    var stderr = "";
    var wait;
    var timeout = setTimeout(function () {
      if (finished) return;
      finished = true;
      clearInterval(wait);
      cleanup(session);
      callback(new Error("ffmpeg no generó el manifiesto DASH a tiempo"));
    }, 30000);
    function manifestReady() {
      if (finished) return;
      try {
        var manifest = fs.readFileSync(output, "utf8");
        if (!usableManifest(manifest)) return;
        session.manifest = manifest;
      } catch (e) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      clearInterval(wait);
      keepAlive(session);
      callback(null, "http://" + HOST + ":" + PORT + "/dash/" + id + "/manifest.mpd");
    }
    wait = setInterval(manifestReady, 200);
    ff.stderr.on("data", function (data) {
      var chunk = String(data);
      stderr = (stderr + chunk).slice(-8192);
      var message = chunk.trim();
      if (message) log("ffmpeg:", message);
    });
    ff.on("error", function (spawnErr) {
      if (finished) return log("ffmpeg error:", spawnErr.message);
      finished = true;
      clearTimeout(timeout);
      clearInterval(wait);
      cleanup(session);
      callback(new Error("no se pudo iniciar ffmpeg: " + spawnErr.message));
    });
    ff.on("close", function (code) {
      session.ff = null;
      if (code) log("ffmpeg terminó con código", code);
      if (!finished) {
        finished = true;
        clearTimeout(timeout);
        clearInterval(wait);
        cleanup(session);
        var detail = stderr.trim().replace(/\s+/g, " ");
        if (stream.url) detail = detail.split(stream.url).join("[URL del stream]");
        if (detail.length > 1500) detail = detail.slice(-1500);
        callback(new Error(
          "ffmpeg terminó" + (code !== null ? " con código " + code : "") +
          " antes de crear el manifiesto DASH" +
          (detail ? ". Detalle de ffmpeg: " + detail : ". ffmpeg no informó detalles adicionales")
        ));
      }
    });
    manifestReady();
  });
}

module.exports = { register: register, port: function () { return PORT; }, path: function () { return FFMPEG; } };
