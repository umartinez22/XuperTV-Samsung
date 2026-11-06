#!/usr/bin/env bash
# Inicia el servidor en este PC.  Uso: ./iniciar-servidor.sh [--tv-antigua] [IP_DEL_PC]
# --tv-antigua: convierte todo el video a H.264 (para TV LG webOS 1 a 3, sin H.265).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "--tv-antigua" ]; then
  export XUPER_TRANSCODE=1 XUPER_FORCE_RELAY=1
  command -v ffmpeg >/dev/null || { echo "--tv-antigua necesita ffmpeg: sudo apt install ffmpeg"; exit 1; }
  echo "Modo TV antigua: el video se convierte a H.264 (usa bastante CPU)."
  shift
fi
[ -n "${1:-}" ] && export XUPER_PUBLIC_HOST="$1"
command -v ffmpeg >/dev/null || echo "Aviso: sin ffmpeg no funciona el 'Modo fluido' (sudo apt install ffmpeg)"
export FFMPEG_PATH="${FFMPEG_PATH:-$(command -v ffmpeg || echo /usr/bin/ffmpeg)}"
PORT="${PORT:-8910}"
command -v lsof >/dev/null || { echo "Error: hace falta lsof para comprobar si ya hay un servidor activo."; exit 1; }
for pid in $(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [ "$cwd" = "$AQUI/server" ] && [[ "$cmd" == *node*server.js* ]]; then
    echo "Deteniendo servidor existente (PID $pid)..."
    kill "$pid"
    for intento in {1..50}; do
      if ! lsof -nP -a -p "$pid" -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if lsof -nP -a -p "$pid" -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "Error: no se pudo detener el servidor existente (PID $pid)."
      exit 1
    fi
  fi
done
cd "$AQUI/server" && exec node server.js
