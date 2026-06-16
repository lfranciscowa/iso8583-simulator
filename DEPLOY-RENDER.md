# Desplegar los 2 proyectos en Render (comunicándose entre sí)

Arquitectura en Render (todo por HTTPS, sin TCP entre servicios):

    [visual-admin-pos]  --HTTPS POST /api/pos-tcp-->  [iso8583-simulator]
       (csr)                                              (UI + engine)
       POS_BRIDGE_URL = https://<simulador>.onrender.com/api/pos-tcp

---

## 1) Subir cada proyecto a GitHub (desde TU máquina)

El bloqueo 403 es solo para mí; tú sí puedes pushear.

En cada repo:
    git add -A
    git commit -m "deploy a render"
    git push

(El simulador y visual-admin son repos separados; sube cada uno.)

## 2) Desplegar el SIMULADOR primero

En Render → New → Blueprint (o Web Service), apunta al repo del simulador.
Detecta `render.yaml`. Deja las variables por defecto (SIM_PIN_EXPECTED=1234).
Anota la URL pública, ej:  https://iso8583-simulator.onrender.com

Verifica abriendo esa URL → debe cargar la UI del simulador.

## 3) Desplegar VISUAL ADMIN (csr)

En Render → New → Blueprint, apunta al repo de visual-admin.
Detecta `render.yaml` (rootDir: csr). Configura las variables:

- POS_BRIDGE_URL = https://iso8583-simulator.onrender.com/api/pos-tcp
  (la URL del paso 2 + /api/pos-tcp)
- DATABASE_URL   = <tu cadena de Neon Postgres>
- POS_TPK_HEX    = 1A2B3C4D5E6F70819AABBCCDDEEFF001  (ya viene por default)

## 4) Probar end-to-end por la URL

1. Abre la URL del POS (visual-admin).
2. En el POS, el destino TCP da igual (en Render el envío va por el bridge).
3. Envía una transacción:
   - Sin PIN  -> DE39=00
   - Con PIN 1234 -> DE39=00
   - Con PIN 9999 -> DE39=55
4. Abre la URL del simulador -> historial: verás la transacción con
   peer "POS (bridge)".

## 5) Conectar el dominio propio (tesh-desarrollo.com) al SIMULADOR

Se usa el subdominio `simulador.tesh-desarrollo.com` para el simulador, de modo
que el dominio raíz `tesh-desarrollo.com` queda libre para el POS u otro
servicio. (Un mismo hostname NO puede estar en dos servicios de Render a la vez;
por eso cada proyecto usa su propio subdominio.)

Pasos en Render:
1. Abre el servicio `iso8583-simulator` → **Settings → Custom Domains →
   Add Custom Domain**. Escribe `simulador.tesh-desarrollo.com` → Save.
2. Render te muestra el registro a crear. Créalo en el panel DNS de tu
   proveedor del dominio (donde administras tesh-desarrollo.com):

   - **Tipo** CNAME
   - **Host / Nombre** `simulador`
   - **Valor** `iso8583-simulator-qchy.onrender.com`

   > Si el DNS es Cloudflare: deja el registro en "DNS only" (nube gris), no
   > proxied, para que Render pueda emitir el certificado TLS.

3. Guarda y dale **Verify** en Render. La propagación puede tardar de minutos
   a 24 h. Cuando Render verifique el DNS, emite el certificado TLS solo y el
   candado HTTPS queda activo.
4. Verifica abriendo `https://simulador.tesh-desarrollo.com` → debe cargar la
   UI del simulador.

> Nota: si el POS (visual-admin) apunta al simulador por `POS_BRIDGE_URL`,
> puedes cambiarlo a `https://simulador.tesh-desarrollo.com/api/pos-tcp` una vez
> que el dominio esté activo (la URL `.onrender.com` sigue funcionando igual).

## 6) Endurecimiento de seguridad (servicio público)

El simulador incluye protecciones activas por configuración. Define estas
variables en Render → `iso8583-simulator` → **Environment**:

| Variable | Valor | Para qué |
|----------|-------|----------|
| `SIM_ADMIN_USER` | tu usuario | Login de la UI/API |
| `SIM_ADMIN_PASS` | contraseña fuerte | Activa el login |
| `SIM_MASTER_KEY` | 64 hex aleatorios | Cifra el llavero en reposo |
| `NODE_ENV` | `production` | Cookies `Secure` + HSTS |
| `SIM_SECURE_COOKIES` | `true` | Fuerza cookies `Secure` |
| `SIM_BRIDGE_API_KEY` | clave aleatoria | Protege `/api/pos-tcp` sin login |
| `SIM_CORS_ORIGINS` | vacío (o tus orígenes) | Restringe CORS |

Protecciones que ya trae el código:

- **Anti fuerza bruta** en el login: 8 intentos fallidos por IP → bloqueo 15 min
  (responde HTTP 429).
- **Cabeceras de seguridad**: `X-Frame-Options: DENY` (anti-clickjacking),
  `X-Content-Type-Options: nosniff`, CSP `frame-ancestors 'none'`, HSTS en HTTPS.
- **CORS cerrado** por defecto (solo mismo origen).
- **PAN/Track/PIN enmascarados** en historial, UI y exportaciones (DE2, DE35,
  DE45, DE14, DE52).
- **Cookie de sesión** `HttpOnly` + `SameSite=Strict` + `Secure` (en producción).

> Si usas el bridge POS y defines `SIM_BRIDGE_API_KEY`, el POS (visual-admin)
> debe enviar el header `x-api-key: <esa clave>` al llamar a `/api/pos-tcp`.
> Si NO la defines, la ruta queda abierta (compatibilidad), pero protegida por
> el resto de la red de Render.

## Notas

- Plan free de Render duerme tras inactividad; la primera petición tarda ~30s.
- El listener TCP 8583 del simulador NO es público en Render. El POS usa
  /api/pos-tcp. Para el AS/400 real luego necesitarás VPN / red privada / host
  con TCP expuesto.
- POS_TPK_HEX debe ser igual en ambos lados para que el PIN valide.
