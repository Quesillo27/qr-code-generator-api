const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let baseURL;

before(async () => {
  process.env.PORT = '0';
  const app = require('../server.js');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseURL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => server.close());

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseURL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let data;
        try { data = JSON.parse(raw.toString()); } catch { data = raw; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
  });
});

describe('GET /api/qr', () => {
  it('returns PNG for valid text', async () => {
    const res = await request('GET', '/api/qr?text=hello');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/png'));
  });

  it('returns 400 for missing text', async () => {
    const res = await request('GET', '/api/qr');
    assert.equal(res.status, 400);
    assert.ok(res.data.error);
  });

  it('accepts custom size', async () => {
    const res = await request('GET', '/api/qr?text=test&size=200');
    assert.equal(res.status, 200);
  });

  it('returns 400 for invalid size', async () => {
    const res = await request('GET', '/api/qr?text=test&size=10');
    assert.equal(res.status, 400);
  });

  it('accepts custom colors', async () => {
    const res = await request('GET', '/api/qr?text=test&fgColor=%23ff0000&bgColor=%23ffffff');
    assert.equal(res.status, 200);
  });

  it('returns 400 for invalid fgColor', async () => {
    const res = await request('GET', '/api/qr?text=test&fgColor=notacolor');
    assert.equal(res.status, 400);
  });
});

describe('POST /api/qr', () => {
  it('returns PNG for valid body', async () => {
    const res = await request('POST', '/api/qr', { text: 'https://example.com' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/png'));
  });

  it('returns 400 for empty text', async () => {
    const res = await request('POST', '/api/qr', { text: '' });
    assert.equal(res.status, 400);
  });

  it('returns 400 for missing text', async () => {
    const res = await request('POST', '/api/qr', {});
    assert.equal(res.status, 400);
  });

  it('accepts error correction level H', async () => {
    const res = await request('POST', '/api/qr', { text: 'test', errorCorrection: 'H' });
    assert.equal(res.status, 200);
  });

  it('returns 400 for invalid error correction', async () => {
    const res = await request('POST', '/api/qr', { text: 'test', errorCorrection: 'X' });
    assert.equal(res.status, 400);
  });

  it('returns 400 for logo without Q/H error correction', async () => {
    const res = await request('POST', '/api/qr', {
      text: 'test',
      errorCorrection: 'M',
      logo: 'data:image/png;base64,iVBORw0KGgo='
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.includes('errorCorrection'));
  });
});

describe('POST /api/qr/svg', () => {
  it('returns SVG for valid body', async () => {
    const res = await request('POST', '/api/qr/svg', { text: 'hello svg' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('svg'));
  });

  it('returns 400 for missing text', async () => {
    const res = await request('POST', '/api/qr/svg', {});
    assert.equal(res.status, 400);
  });
});

describe('POST /api/qr/batch', () => {
  it('returns array of QR codes', async () => {
    const res = await request('POST', '/api/qr/batch', {
      items: ['https://example.com', 'hello world', '12345']
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.count, 3);
    assert.ok(res.data.results[0].image.startsWith('data:image/png;base64,'));
  });

  it('returns 400 for empty items', async () => {
    const res = await request('POST', '/api/qr/batch', { items: [] });
    assert.equal(res.status, 400);
  });

  it('returns 400 for more than 20 items', async () => {
    const res = await request('POST', '/api/qr/batch', {
      items: Array(21).fill('test')
    });
    assert.equal(res.status, 400);
  });

  it('handles mixed valid/invalid items gracefully', async () => {
    const res = await request('POST', '/api/qr/batch', {
      items: ['valid text', '', 'another valid']
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.count, 3);
    assert.ok(res.data.results[1].error);
  });
});

describe('GET /api/qr/info', () => {
  it('returns metadata', async () => {
    const res = await request('GET', '/api/qr/info');
    assert.equal(res.status, 200);
    assert.ok(res.data.formats);
    assert.ok(res.data.errorCorrectionLevels);
    assert.ok(res.data.maxCapacity);
  });
});
