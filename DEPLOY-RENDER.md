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

El `render.yaml` ya declara los dominios `tesh-desarrollo.com` y
`www.tesh-desarrollo.com` para el servicio `iso8583-simulator`.

Pasos en Render:
1. Abre el servicio `iso8583-simulator` → **Settings → Custom Domains**.
   Deben aparecer ya `tesh-desarrollo.com` y `www.tesh-desarrollo.com`
   (en estado "Pending / verifying" hasta que el DNS apunte).
2. Render te muestra a qué apuntar. Crea estos registros en el panel DNS de
   tu proveedor del dominio (donde compraste tesh-desarrollo.com):

   - **Apex / raíz** `tesh-desarrollo.com`
     - Registro **ALIAS / ANAME** → `iso8583-simulator-qchy.onrender.com`
     - Si tu proveedor NO soporta ALIAS en el apex, usa un registro **A**
       con la IP que te indique Render en esa misma pantalla.
   - **www** `www.tesh-desarrollo.com`
     - Registro **CNAME** → `iso8583-simulator-qchy.onrender.com`

3. Guarda y espera la propagación (de minutos a ~1 h). Cuando Render verifique
   el DNS, emite el certificado TLS solo y el candado HTTPS queda activo.
4. Verifica abriendo `https://tesh-desarrollo.com` → debe cargar la UI del
   simulador.

> Nota: si el POS (visual-admin) apunta al simulador por `POS_BRIDGE_URL`,
> puedes cambiarlo a `https://tesh-desarrollo.com/api/pos-tcp` una vez que el
> dominio esté activo (la URL `.onrender.com` sigue funcionando igual).

## Notas

- Plan free de Render duerme tras inactividad; la primera petición tarda ~30s.
- El listener TCP 8583 del simulador NO es público en Render. El POS usa
  /api/pos-tcp. Para el AS/400 real luego necesitarás VPN / red privada / host
  con TCP expuesto.
- POS_TPK_HEX debe ser igual en ambos lados para que el PIN valide.
