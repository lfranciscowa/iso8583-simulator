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

---

## 🔒 Seguridad

- **Login por sesión**: si se define `SIM_ADMIN_PASS`, la UI redirige a `/login.html` y toda la API responde `401` sin una sesión válida (cookie `HttpOnly`).
- **Enmascaramiento de PAN**: el historial, el feed en vivo y el dashboard muestran el PAN (DE2) como `411111******1111` (primeros 6 + últimos 4, formato PCI-DSS).
- **Llavero cifrado en reposo**: las llaves 3DES de `config/keys.json` se guardan cifradas (AES-256-GCM) bajo `SIM_MASTER_KEY`. El endpoint `GET /api/keys` nunca devuelve la llave en claro, solo su KCV — igual que un HSM real.

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
