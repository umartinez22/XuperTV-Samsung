"use strict";

var path = require("path");

module.exports = {
  apps: [
    {
      name: "xupertv-server",
      script: "server.js",
      cwd: path.join(__dirname, "server"),
      instances: 1,
      exec_mode: "fork",
      cron_restart: "0 */5 * * *",
      autorestart: true,
      watch: false,
      env: {
        PORT: process.env.PORT || 8910
      }
    }
  ]
};
