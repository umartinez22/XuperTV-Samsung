# Xuper TV para Samsung (Tizen)

Port para TV Samsung de la versión modificada de Xuper TV (`com.notyitan.tv`).

## Cómo funciona

Las TV Samsung no pueden ejecutar el servicio Node que en LG corre dentro de la TV. Por eso se divide en dos:

```
TV Samsung (app Tizen, HTML/JS)  ──HTTP──▶  PC / Raspberry Pi (server/)  ──▶  portal
```

- `server/`: el servicio original (`magis.js`, `proxy.js`, relay `ffmpeg`) con un sustituto de `webos-service` que lo expone por HTTP. Solo cambian 3 líneas en `proxy.js` y `ffmpeg-relay.js` (IP pública y `ffmpeg` del sistema).
- `tizen/`: la interfaz de webOS más `config.xml`, y un archivo (`js/tizen-compat.js`) que traduce el botón Atrás de Samsung.

## 1. Servidor (PC con Linux, en la misma red que la TV)

```bash
sudo apt install nodejs ffmpeg
./iniciar-servidor.sh            # detecta la IP sola, o: ./iniciar-servidor.sh 192.168.1.95
curl http://IP_DEL_PC:8910/ping  # debe responder returnValue:true
```

Tiene que quedar encendido mientras uses la app. Puertos: 8910 (API), 8787 (relay), 8788 (DASH) y uno dinámico del proxy; si hay firewall, ábrelos. El endpoint `POST /resolveDash` acepta `contentId` (y opcionalmente `seriesContentId`, `trackIndex` y `audioTrack`), ejecuta FFmpeg y genera MPEG-DASH; devuelve la URL del manifiesto en `url` y `dashUrl`. Puedes cambiar el puerto DASH con `XUPER_DASH_PORT`.

## 2. App en la TV

1. `./configurar.sh IP_DEL_PC` (escribe la dirección del servidor en `tizen/config/api.js`).
2. En la TV: Apps → pulsa `12345` en el mando → **Developer mode: On** e introduce la IP de tu PC. Reinicia la TV.
3. Instala [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) con *TV Extensions*, y crea un certificado Samsung (Certificate Manager).
4. Abre `tizen/` como proyecto Web (o `tizen package -t wgt -- tizen/`), conecta la TV (`sdb connect IP_DE_LA_TV`) y ejecuta *Run As → Tizen Web Application*.

## Instalar desde Windows

1. Instala Node.js y ffmpeg: `winget install OpenJS.NodeJS.LTS` y `winget install Gyan.FFmpeg`.
2. Descarga este repo (Code → Download ZIP) y extráelo.
3. Doble clic en **`INICIAR-SERVIDOR.bat`** y deja la ventana abierta. Si el Firewall pregunta, permite el acceso. Si detecta mal la IP, ábrelo desde una terminal: `INICIAR-SERVIDOR.bat 192.168.1.95`.
4. Doble clic en **`CONFIGURAR.bat`** e indica la IP del PC.
5. Abre la carpeta `tizen/` en Tizen Studio (versión Windows) e instálala en la TV, como en los pasos de arriba.

> Los `.bat` y la compatibilidad con Windows **no están probados en un Windows real**.

## Modo TV antigua (H.264)

Para TV LG webOS 1 a 3 (ver `XuperTV-webOS-Legacy`), que no reproducen H.265: `./iniciar-servidor.sh --tv-antigua` (Linux) o `INICIAR-SERVIDOR-TV-ANTIGUA.bat` (Windows). El servidor convierte todo el video a H.264 + AAC (máx. 1080p) con `ffmpeg`, así que usa bastante CPU. Variables: `XUPER_TRANSCODE=1` y `XUPER_FORCE_RELAY=1`.

## Estado

- Servidor: probado en Linux (`ping`, sesión y categorías de canales responden).
- App Tizen: **sin probar en una TV Samsung**. Puede necesitar ajustes en el reproductor de video y en el foco del mando.
