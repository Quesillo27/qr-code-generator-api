# QR Code Generator API

![Node.js](https://img.shields.io/badge/node-20-brightgreen) ![Express](https://img.shields.io/badge/express-4.x-blue) ![tests](https://img.shields.io/badge/tests-passing-brightgreen) ![License](https://img.shields.io/badge/license-MIT-green)

REST API to generate QR codes in PNG and SVG formats with custom colors, sizes, and optional center logo overlay. Supports batch generation of up to 20 QR codes per request.

## Instalacion en 3 comandos

```bash
git clone https://github.com/Quesillo27/qr-code-generator-api
cd qr-code-generator-api
npm install
```

## Uso

```bash
npm start   # inicia el servicio en puerto 3000
```

## Ejemplo

```bash
# QR simple via GET
curl "http://localhost:3000/api/qr?text=https://example.com" --output qr.png

# QR con colores personalizados
curl -X POST http://localhost:3000/api/qr \
  -H "Content-Type: application/json" \
  -d '{"text":"https://example.com","size":400,"fgColor":"#1a73e8","bgColor":"#ffffff"}' \
  --output qr_custom.png

# QR en SVG
curl -X POST http://localhost:3000/api/qr/svg \
  -H "Content-Type: application/json" \
  -d '{"text":"hello world","size":300}' \
  --output qr.svg

# Batch: 3 QR codes en base64 con margen personalizado
curl -X POST http://localhost:3000/api/qr/batch \
  -H "Content-Type: application/json" \
  -d '{"items":["https://example.com","Hello World","12345"],"margin":2}' \
  | jq '.results[0].image' | head -c 80
# → "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
```

## API — Endpoints disponibles

| Metodo | Endpoint | Descripcion |
|--------|----------|-------------|
| `GET` | `/health` | Estado del servicio |
| `GET` | `/api/qr` | Genera QR PNG via query params |
| `POST` | `/api/qr` | Genera QR PNG via JSON body (soporta logo) |
| `POST` | `/api/qr/svg` | Genera QR en formato SVG |
| `POST` | `/api/qr/batch` | Genera hasta 20 QR codes en base64, con opciones visuales compartidas |
| `GET` | `/api/qr/info` | Metadata: capacidades, niveles de correccion |

### Parametros comunes

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `text` | string | requerido | Contenido a codificar |
| `size` | number | `300` | Tamano en px (64-2048) |
| `fgColor` | string | `#000000` | Color del codigo (hex) |
| `bgColor` | string | `#ffffff` | Color de fondo (hex) |
| `errorCorrection` | string | `M` | Nivel L/M/Q/H |
| `margin` | number | `1` | Margen en modulos (0-10) |
| `logo` | string | — | Solo POST /api/qr — base64 de imagen. Requiere errorCorrection Q o H |

### Ejemplo con logo

```bash
LOGO_B64=$(base64 -w0 logo.png)
curl -X POST http://localhost:3000/api/qr \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"https://example.com\",\"errorCorrection\":\"H\",\"logo\":\"data:image/png;base64,$LOGO_B64\"}" \
  --output qr_with_logo.png
```

## Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |

## Notas de seguridad

- `logo` solo acepta data URIs base64 `png`, `jpeg`, `jpg`, `webp` o `gif`
- El logo tiene limite de `1MB` para evitar payloads excesivos
- Se validan `margin`, `size`, colores hex y longitud maxima del contenido QR
- El API responde JSON tambien ante body JSON malformado

## Version

Actual: `1.1.1`

## Docker

```bash
docker build -t qr-api .
docker run -p 3000:3000 qr-api
```

El contenedor expone `3000` y define `HEALTHCHECK` sobre `GET /health`.

## Tests

```bash
npm test
# 28 tests — 100% pass
```

## Roadmap

- Soporte opcional para descargar ZIP en `/api/qr/batch`
- Paletas y presets visuales reutilizables para branding
- Endpoint para validar contraste antes de generar el QR

## Contribuir

PRs bienvenidos. Corre `npm test` antes de enviar.
