const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const rooms = new Map();
const allowedKeys = {
  vitals: ['heartRate', 'systolic', 'diastolic', 'spo2', 'respRate', 'temperature', 'scenario', 'asystoleDelay', 'autoRecover', 'recoveryDelay', 'asystoleAt', 'showEcg', 'showArterial', 'showPleth', 'showResp', 'showHeartRate', 'showSpo2', 'showNIBP', 'showRespRate', 'showTemperature', 'defibEnergy', 'defibCharged', 'defibLastShockAt', 'defibShockCount'],
  eeg: ['frequency', 'amplitude', 'noise', 'alteration', 'region', 'severity']
};
const initialState = {
  vitals: { heartRate: 72, systolic: 120, diastolic: 80, spo2: 98, respRate: 16, temperature: 36.8, scenario: 'normal', asystoleDelay: 0, autoRecover: true, recoveryDelay: 30, asystoleAt: 0, showEcg: true, showArterial: true, showPleth: true, showResp: true, showHeartRate: true, showSpo2: true, showNIBP: true, showRespRate: true, showTemperature: true, defibEnergy: 200, defibCharged: false, defibLastShockAt: 0, defibShockCount: 0 },
  eeg: { frequency: 10, amplitude: 50, noise: 8, alteration: 'none', region: 'left', severity: 60 }
};
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) reject(new Error('Request too large'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function createRoom() {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
  const hostToken = crypto.randomBytes(32).toString('base64url');
  rooms.set(code, { hostToken, state: structuredClone(initialState), clients: new Set(), touchedAt: Date.now() });
  return { code, hostToken };
}

function handleApi(request, response, pathname) {
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
  readJson(request).then(body => {
    if (pathname === '/api/rooms') return sendJson(response, 201, createRoom());
    if (pathname === '/api/join') {
      const code = String(body.room || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendJson(response, 404, { error: 'No existe esa sala o ya expiró.' });
      room.touchedAt = Date.now();
      return sendJson(response, 200, { room: code });
    }
    return sendJson(response, 404, { error: 'Not found' });
  }).catch(error => sendJson(response, error.message === 'Invalid JSON' ? 400 : 413, { error: error.message }));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url.pathname);
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed' });

  let pathname;
  try { pathname = decodeURIComponent(url.pathname === '/' ? '/access.html' : url.pathname); }
  catch { response.writeHead(400).end(); return; }
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(filePath).pipe(response);
  });
});

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const code = String(url.searchParams.get('room') || '').trim().toUpperCase();
  const role = url.searchParams.get('role');
  const room = rooms.get(code);
  const suppliedToken = url.searchParams.get('token') || '';
  const validHostToken = room && suppliedToken.length === room.hostToken.length && crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(room.hostToken));
  if (url.pathname !== '/sync' || !room || !['teacher', 'student'].includes(role) || (role === 'teacher' && !validHostToken)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, connection => {
    connection.roomCode = code;
    connection.role = role;
    webSocketServer.emit('connection', connection, request);
  });
});

webSocketServer.on('connection', connection => {
  const room = rooms.get(connection.roomCode);
  if (!room) return connection.close(1008, 'Room expired');
  room.clients.add(connection);
  room.touchedAt = Date.now();
  connection.send(JSON.stringify({ type: 'state', state: room.state }));

  connection.on('message', raw => {
    if (connection.role !== 'teacher') return connection.close(1008, 'Read-only student session');
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return; }
    if (message.type !== 'patch' || !allowedKeys[message.module] || !message.patch || typeof message.patch !== 'object' || Array.isArray(message.patch)) return;
    const target = room.state[message.module];
    for (const [key, value] of Object.entries(message.patch)) {
      if (allowedKeys[message.module].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)) target[key] = value;
    }
    room.touchedAt = Date.now();
    const payload = JSON.stringify({ type: 'state', state: room.state });
    for (const client of room.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
  });

  connection.on('close', () => room.clients.delete(connection));
});

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (!room.clients.size && room.touchedAt < cutoff) rooms.delete(code);
}, 60 * 60 * 1000).unref();

server.listen(port, '0.0.0.0', () => console.log(`Forma simuladores en http://localhost:${port}`));
