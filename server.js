const express = require('express');
const QRCode = require('qrcode');
const sharp = require('sharp');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '1.1.1';
const MAX_QR_TEXT_LENGTH = 2953;
const MAX_LOGO_BYTES = 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'qr-code-generator-api',
    version: VERSION,
    uptime: Number(process.uptime().toFixed(2)),
    node: process.version
  });
});

function parseColor(color) {
  if (!color) return null;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return color;
  if (/^[0-9a-fA-F]{3,6}$/.test(color)) return `#${color}`;
  return null;
}

function validateSize(size) {
  const n = parseInt(size, 10);
  if (isNaN(n) || n < 64 || n > 2048) return null;
  return n;
}

function validateErrorCorrection(level) {
  const valid = ['L', 'M', 'Q', 'H'];
  const upper = String(level).toUpperCase();
  return valid.includes(upper) ? upper : null;
}

function validateMargin(margin) {
  const value = parseInt(margin, 10);
  if (Number.isNaN(value) || value < 0 || value > 10) return null;
  return value;
}

function validateText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return '`text` is required and must be a non-empty string';
  }

  if (text.length > MAX_QR_TEXT_LENGTH) {
    return `\`text\` exceeds maximum QR capacity (${MAX_QR_TEXT_LENGTH} chars)`;
  }

  return null;
}

function parseLogoDataUri(logoBase64) {
  if (typeof logoBase64 !== 'string' || logoBase64.trim() === '') {
    return { error: '`logo` must be a non-empty data URI string' };
  }

  const match = logoBase64.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return { error: '`logo` must be a valid base64 data URI for png, jpeg, webp, or gif images' };
  }

  const logoBuffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (logoBuffer.length === 0) {
    return { error: '`logo` could not be decoded' };
  }

  if (logoBuffer.length > MAX_LOGO_BYTES) {
    return { error: '`logo` exceeds maximum size of 1MB' };
  }

  return { buffer: logoBuffer };
}

async function generateQRBuffer(text, options) {
  const {
    size = 300,
    fgColor = '#000000',
    bgColor = '#ffffff',
    errorCorrection = 'M',
    margin = 1
  } = options;

  const qrBuffer = await QRCode.toBuffer(text, {
    type: 'png',
    width: size,
    color: { dark: fgColor, light: bgColor },
    errorCorrectionLevel: errorCorrection,
    margin
  });

  return qrBuffer;
}

async function overlayLogo(qrBuffer, logoBase64, size) {
  const parsedLogo = parseLogoDataUri(logoBase64);
  if (parsedLogo.error) {
    const error = new Error(parsedLogo.error);
    error.statusCode = 400;
    throw error;
  }

  const logoBuffer = parsedLogo.buffer;

  const logoSize = Math.floor(size * 0.2);

  const resizedLogo = await sharp(logoBuffer)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const offset = Math.floor((size - logoSize) / 2);

  return sharp(qrBuffer)
    .composite([{ input: resizedLogo, left: offset, top: offset }])
    .png()
    .toBuffer();
}

// POST /api/qr — generate QR, returns PNG binary
app.post('/api/qr', async (req, res) => {
  const { text, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC, margin, logo } = req.body;

  const textError = validateText(text);
  if (textError) {
    return res.status(400).json({ error: textError });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color (e.g. #000000)' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color (e.g. #ffffff)' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? validateMargin(margin) : 1;
  if (marginVal === null) {
    return res.status(400).json({ error: '`margin` must be between 0 and 10' });
  }

  try {
    let qrBuffer = await generateQRBuffer(text, { size, fgColor, bgColor, errorCorrection, margin: marginVal });

    if (logo) {
      if (errorCorrection !== 'H' && errorCorrection !== 'Q') {
        return res.status(400).json({ error: 'When using `logo`, `errorCorrection` must be Q or H for readability' });
      }
      qrBuffer = await overlayLogo(qrBuffer, logo, size);
    }

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'inline; filename="qrcode.png"');
    res.send(qrBuffer);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 500 ? 'QR generation failed' : err.message });
  }
});

// GET /api/qr?text=...&size=...&fgColor=...&bgColor=... — quick GET endpoint
app.get('/api/qr', async (req, res) => {
  const { text, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC, margin } = req.query;

  const textError = validateText(text);
  if (textError) {
    return res.status(400).json({ error: text ? textError : '`text` query param is required' });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? validateMargin(margin) : 1;
  if (marginVal === null) return res.status(400).json({ error: '`margin` must be between 0 and 10' });

  try {
    const qrBuffer = await generateQRBuffer(text, { size, fgColor, bgColor, errorCorrection, margin: marginVal });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'inline; filename="qrcode.png"');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed', details: err.message });
  }
});

// POST /api/qr/svg — generate QR as SVG
app.post('/api/qr/svg', async (req, res) => {
  const { text, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC, margin } = req.body;

  const textError = validateText(text);
  if (textError) {
    return res.status(400).json({ error: textError });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? validateMargin(margin) : 1;
  if (marginVal === null) return res.status(400).json({ error: '`margin` must be between 0 and 10' });

  try {
    const svgString = await QRCode.toString(text, {
      type: 'svg',
      width: size,
      color: { dark: fgColor, light: bgColor },
      errorCorrectionLevel: errorCorrection,
      margin: marginVal
    });

    res.set('Content-Type', 'image/svg+xml');
    res.set('Content-Disposition', 'inline; filename="qrcode.svg"');
    res.send(svgString);
  } catch (err) {
    res.status(500).json({ error: 'SVG generation failed', details: err.message });
  }
});

// POST /api/qr/batch — generate multiple QR codes as JSON array of base64 PNGs
app.post('/api/qr/batch', async (req, res) => {
  const { items, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC, margin } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '`items` must be a non-empty array of strings' });
  }
  if (items.length > 20) {
    return res.status(400).json({ error: '`items` max length is 20' });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? validateMargin(margin) : 1;
  if (marginVal === null) return res.status(400).json({ error: '`margin` must be between 0 and 10' });

  try {
    const results = await Promise.all(
      items.map(async (text, i) => {
        const itemError = validateText(text);
        if (itemError) {
          return { index: i, error: itemError };
        }
        try {
          const buf = await generateQRBuffer(text, { size, fgColor, bgColor, errorCorrection, margin: marginVal });
          return { index: i, text, image: `data:image/png;base64,${buf.toString('base64')}` };
        } catch (err) {
          return { index: i, text, error: err.message };
        }
      })
    );

    res.json({ count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Batch generation failed', details: err.message });
  }
});

// GET /api/qr/info — metadata about a QR (data capacity, version estimation)
app.get('/api/qr/info', (_req, res) => {
  res.json({
    formats: ['png', 'svg'],
    errorCorrectionLevels: {
      L: '~7% recovery — highest capacity',
      M: '~15% recovery — balanced (default)',
      Q: '~25% recovery — recommended with logo',
      H: '~30% recovery — most robust, required for logo'
    },
    maxCapacity: {
      numeric: 7089,
      alphanumeric: 4296,
      binary: 2953,
      kanji: 1817
    },
    sizeRange: { min: 64, max: 2048, default: 300 },
    marginRange: { min: 0, max: 10, default: 1 },
    batchLimit: 20,
    rateLimit: '60 requests per minute'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`QR Code Generator API running on port ${PORT}`);
  });
}

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body exceeds 1MB limit' });
  }

  return res.status(500).json({ error: 'Unexpected server error' });
});

module.exports = app;
