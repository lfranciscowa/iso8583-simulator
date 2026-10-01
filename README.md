# ISO 8583 Simulator

Simulador de respuestas **ISO 8583** que escucha por **TCP** y responde transacciones
desde **cualquier plataforma** (host, switch, POS, terminal de pruebas). Soporta
payloads de texto en **ASCII** o **EBCDIC (CP037)**, con detección automática.

Pensado para equipos de pagos, fintechs e integradores que necesitan probar sus
desarrollos contra un "host" sin depender de un switch bancario real.

---

## ✨ Características

- **Servidor TCP** que acepta conexiones de cualquier cliente y responde tramas ISO 8583.
- **ASCII y EBCDIC**: los campos de texto se codifican/decodifican en cualquiera de los dos formatos. Modo `auto` detecta el encoding por trama.
- **Switch simulado configurable**: reglas predecibles para provocar cualquier código de respuesta (aprobada, fondos insuficientes, tarjeta inválida, etc.).
- **Framing configurable**: tamaño del prefijo de longitud, codificación (binario/BCD/ASCII), inclusión de sí mismo.
- **API HTTP + panel web** para armar tramas de prueba y ver el tráfico TCP en vivo.
- **Latencia simulada** realista, configurable.

---

## 🚀 Uso rápido

```bash
npm install
cp .env.example .env      # ajustá puertos/encoding si querés
npm start                 # levanta TCP (:8583) + API/UI (:4100)
```

- Conectá tu plataforma al puerto **TCP 8583** y enviá tramas ISO 8583.
- Abrí **http://localhost:4100** para el panel web.

Solo el servidor TCP (sin UI):

```bash
npm run tcp
```

---

## ⚙️ Configuración (variables de entorno)

| Variable | Default | Descripción |
|---|---|---|
| `SIM_TCP_PORT` | `8583` | Puerto donde escucha las transacciones |
| `SIM_ENCODING` | `auto` | `ascii` · `ebcdic` · `auto` |
| `SIM_PREFIX_BYTES` | `2` | Bytes del prefijo de longitud |
| `SIM_PREFIX_ENCODING` | `binary` | `binary` · `bcd` · `ascii` |
| `SIM_PREFIX_INCLUDES_SELF` | `false` | Si la longitud incluye el prefijo |
| `SIM_LATENCY_MS` | *(aleatoria)* | Latencia fija en ms |
| `SIM_ADMIN_USER` | `admin` | Usuario para iniciar sesión |
| `SIM_ADMIN_PASS` | *(vacío = login deshabilitado)* | Contraseña; si se define, toda la API y la UI exigen sesión |
| `SIM_MASTER_KEY` | *(clave de laboratorio)* | KEK para cifrar el llavero (`config/keys.json`) en reposo |
| `SIM_LINK_MODE` | `warn` | Enlace de transacciones: `off` · `warn` · `strict` (ver abajo) |
| `SIM_LINK_DECLINE_CODE` | `30` | DE39 con que se rechaza en modo `strict` |
| `SIM_ATM_BALANCE` | `150000` | Saldo inicial de cada tarjeta en el cajero (unidades menores: 1.500,00) |
| `SIM_ATM_DAILY_LIMIT` | `50000` | Límite diario de retiro por tarjeta (500,00) |
| `SIM_ATM_NOTE_UNIT` | `1000` | Denominación mínima que dispensa el cajero (10,00) |

---

## 🔒 Seguridad

- **Login por sesión**: si se define `SIM_ADMIN_PASS`, la UI redirige a `/login.html` y toda la API responde `401` sin una sesión válida (cookie `HttpOnly`).
- **Enmascaramiento de PAN**: el historial, el feed en vivo y el dashboard muestran el PAN (DE2) como `411111******1111` (primeros 6 + últimos 4, formato PCI-DSS).
- **Llavero cifrado en reposo**: las llaves 3DES de `config/keys.json` se guardan cifradas (AES-256-GCM) bajo `SIM_MASTER_KEY`. El endpoint `GET /api/keys` nunca devuelve la llave en claro, solo su KCV, imitando el comportamiento de un HSM.
- **HSM simulado**: 3DES, PIN blocks ISO 9564 y MAC usan los algoritmos estándar, pero corren en software (módulo `crypto` de Node.js). Sirve para probar integraciones; no reemplaza un HSM físico ni un teclado cifrado (EPP) en producción.

---

## 🏦 Perfiles de red (Visa / Mastercard / Genérico)

El simulador soporta **perfiles** seleccionables desde la UI (o por `SIM_PROFILE`),
que ajustan el diccionario de Data Elements, el header y los MTIs por defecto:

| Perfil | MTIs | Header | Notas |
|---|---|---|---|
| `generic` | 0200/0210 | TPDU `6000500100` | Switch/adquirente clásico |
| `visa` | 0100/0110 (auth) | sin TPDU | DEs con nombres Visa (DE48/62/63) |
| `mastercard` | 0100/0110 (auth) | sin TPDU | DEs con nombres Mastercard (DE48/61/62/63) |

Diccionario estándar ISO 8583:1987 ampliado (~50 DEs reales: PAN, processing
code, montos, monedas DE49/50/51, tracks, RRN, EMV DE55, PIN DE52, etc.).

> ⚠️ Los perfiles Visa/Mastercard son **aproximaciones didácticas** sobre el
> estándar público ISO 8583:1987. Las especificaciones propietarias de cada
> marca (Visa BASE I/VIP, Mastercard CIS/MIP) son confidenciales y no se
> replican byte-por-byte.

---

## 🔌 Reglas del switch simulado (por defecto)

| Condición | Respuesta (DE 39) |
|---|---|
| Monto (DE4) > 100000 | `51` Fondos insuficientes |
| PAN (DE2) termina en `0000` | `14` Tarjeta inválida |
| PAN (DE2) termina en `9999` | `05` Denegada |
| Monto (DE4) = 0 | `12` Transacción inválida |
| Cualquier otro caso | `00` Aprobada |

Las reglas son editables en `switch-sim/mock-switch.js`.

---

## 🏧 Cajero automático (ATM)

El switch atiende el lado host de las transacciones de cajero, identificadas por el
código de procesamiento (DE 3). Cada tarjeta tiene una cuenta simulada en memoria.

| Transacción | Comportamiento |
|---|---|
| Consulta de saldo (`31xxxx`) | Exige PIN (DE 52); devuelve saldo contable y disponible en **DE 54** |
| Retiro (`01xxxx`) | Exige PIN; valida denominación (`13`), saldo (`51`) y límite diario (`61`); descuenta y devuelve DE 54 |
| Reverso total (`0400`/`0420` sin DE 95) | Devuelve el monto completo del retiro |
| Reverso por dispensado incompleto (`0420` con DE 95) | Devuelve solo lo que el cajero no entregó (monto original − primeros 12 dígitos de DE 95) |
| Reverso duplicado | Responde `00` sin acreditar de nuevo (reintentos del cajero) |
| Reverso sin retiro original | `25` |

El retiro original se ubica por el STAN de **DE 90** (posiciones 5-10) o, si no viene, por DE 11.
La pestaña **Cajero ATM** de la UI trae dos formas de probarlo, ambas con PIN cifrado real (TPK de laboratorio `tpk-demo`, PIN `1234`):

- **Cajero virtual en vivo**: un cajero interactivo (pantalla, teclas laterales, teclado, dispensador e impresora) con modelo de estados y pantallas. A la derecha muestra en tiempo real cada paso: la solicitud del cajero al host (simplificada), la trama 0200/0420 que el host arma para el switch, la respuesta 0210/0430 y la orden de vuelta al cajero. Incluye un interruptor para simular falla del dispensador (entrega parcial → reverso 0420 automático).
- **Flujo guiado** de 7 pasos para recorrer cada código de respuesta.
`GET /api/atm/cuentas` lista las cuentas (PAN enmascarado) y `DELETE /api/atm/cuentas` las reinicia.

> Simula el mensaje ISO 8583 que llega al host, no el protocolo del cajero
> (NDC de NCR, DDC de Diebold), cuyas especificaciones son de cada fabricante.

---

## 🔗 Enlace de transacciones (mandato Mastercard TLID / Visa Transaction ID)

Desde el **23 de octubre de 2026**, Mastercard exige que el comercio reenvíe el
**Transaction Link Identifier (TLID)** —22 caracteres en **DE105**— en toda
transacción relacionada: cobros recurrentes, cuotas, credencial guardada,
reversos y devoluciones. Las tarifas por incumplimiento empiezan en enero de 2027.
Visa aplica la misma lógica con su **Transaction ID** (15 dígitos, **DE62**).

Con los perfiles `mastercard` y `visa`, el switch simulado:

1. **Emite** el identificador en la respuesta de toda compra o alta de credencial aprobada.
2. **Valida** las transacciones siguientes y reporta hallazgos:

| Código | Cuándo |
|---|---|
| `LINK_INITIAL` *(info)* | Primera transacción con credencial guardada (`DE22` = `10xx`): se emite el identificador |
| `LINK_MISSING` | Reverso (`04xx`), devolución (`DE3` = `20xxxx`) o cobro recurrente de una tarjeta con historial, **sin** identificador |
| `LINK_UNKNOWN` | El identificador no fue emitido por este switch |
| `LINK_PAN_MISMATCH` | El identificador pertenece a otra tarjeta |
| `LINK_FORMAT` | Formato inválido (22 alfanuméricos Mastercard / 15 dígitos Visa) |

**Modos** (`SIM_LINK_MODE`, o desde la pestaña *Enlace TLID* de la UI):

- `warn` *(default)*: reporta hallazgos sin alterar la respuesta, igual que la red real (que cobra, no rechaza).
- `strict`: rechaza con `SIM_LINK_DECLINE_CODE` para forzar la corrección antes de certificar.
- `off`: desactivado.

Los hallazgos se devuelven en `sim.lifecycle` de `/api/send`, en el campo
`lifecycle` de `/api/pos-tcp` y en el historial. `GET /api/links` lista los
identificadores emitidos (PAN enmascarado; el PAN se indexa por hash SHA-256, nunca en claro).

> ⚠️ Aproximación basada en información pública del mandato. El formato exacto
> de sub-elementos de DE105 y DE62 es confidencial de cada marca: aquí el
> identificador viaja como valor completo del campo.

---

## 🗂️ Estructura

```
iso8583-simulator/
├── server.js              API HTTP + UI + arranque del TCP
├── tcp-server.js          Servidor TCP (núcleo del simulador)
├── config/default.js      Configuración central
├── lib/
│   ├── iso8583.js         Encoder/parser ISO 8583 (ASCII/EBCDIC)
│   ├── ebcdic.js          Codec EBCDIC CP037 <-> ASCII
│   ├── framing.js         Prefijo de longitud sobre TCP
│   └── engine.js          Procesamiento de una transacción
├── switch-sim/
│   └── mock-switch.js     Reglas de respuesta simuladas
├── public/                Panel web
└── test/                  Cliente y pruebas
```

---

## 🧪 Pruebas

```bash
npm test                                  # suite de validación
node test/tcp-client.js ascii  000000015000   # cliente de prueba ASCII
node test/tcp-client.js ebcdic 000000015000   # cliente de prueba EBCDIC
```
