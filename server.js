const express = require('express');
const QRCode = require('qrcode');
const sharp = require('sharp');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'qr-code-generator-api', version: '1.0.0' });
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
  const logoData = logoBase64.replace(/^data:image\/\w+;base64,/, '');
  const logoBuffer = Buffer.from(logoData, 'base64');

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

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: '`text` is required and must be a non-empty string' });
  }
  if (text.length > 2953) {
    return res.status(400).json({ error: '`text` exceeds maximum QR capacity (2953 chars)' });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color (e.g. #000000)' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color (e.g. #ffffff)' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? parseInt(margin, 10) : 1;
  if (isNaN(marginVal) || marginVal < 0 || marginVal > 10) {
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
    res.status(500).json({ error: 'QR generation failed', details: err.message });
  }
});

// GET /api/qr?text=...&size=...&fgColor=...&bgColor=... — quick GET endpoint
app.get('/api/qr', async (req, res) => {
  const { text, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC, margin } = req.query;

  if (!text || text.trim() === '') {
    return res.status(400).json({ error: '`text` query param is required' });
  }
  if (text.length > 2953) {
    return res.status(400).json({ error: '`text` exceeds maximum QR capacity (2953 chars)' });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? parseInt(margin, 10) : 1;

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

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: '`text` is required' });
  }
  if (text.length > 2953) {
    return res.status(400).json({ error: '`text` exceeds maximum QR capacity' });
  }

  const size = rawSize ? validateSize(rawSize) : 300;
  if (size === null) return res.status(400).json({ error: '`size` must be between 64 and 2048' });

  const fgColor = rawFg ? parseColor(rawFg) : '#000000';
  if (fgColor === null) return res.status(400).json({ error: '`fgColor` must be a valid hex color' });

  const bgColor = rawBg ? parseColor(rawBg) : '#ffffff';
  if (bgColor === null) return res.status(400).json({ error: '`bgColor` must be a valid hex color' });

  const errorCorrection = rawEC ? validateErrorCorrection(rawEC) : 'M';
  if (errorCorrection === null) return res.status(400).json({ error: '`errorCorrection` must be L, M, Q, or H' });

  const marginVal = margin !== undefined ? parseInt(margin, 10) : 1;

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
  const { items, size: rawSize, fgColor: rawFg, bgColor: rawBg, errorCorrection: rawEC } = req.body;

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

  try {
    const results = await Promise.all(
      items.map(async (text, i) => {
        if (typeof text !== 'string' || text.trim() === '') {
          return { index: i, error: 'Item must be a non-empty string' };
        }
        try {
          const buf = await generateQRBuffer(text, { size, fgColor, bgColor, errorCorrection, margin: 1 });
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

module.exports = app;
