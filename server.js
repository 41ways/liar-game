'use strict';
/** 라이어 게임 온라인판 — Node 로컬 서버(개발·시험용). 실제 서비스는 worker.js 가 같은 server/game.js 로 돈다. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { rooms, handle, disconnect, sweepRooms, selfCheck } = require('./server/game');

const PORT = process.env.PORT || 8798;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let file;
  try { file = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { res.writeHead(400).end('bad request'); return; }
  if (file === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  if (file === '/') file = '/index.html';
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('없는 페이지입니다'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string' || msg.t === 'ping') return;
    try { handle(ws, msg); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => disconnect(ws));
});
setInterval(() => {
  wss.clients.forEach(ws => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (_) {} });
  sweepRooms();
}, 30_000);

server.listen(PORT, () => { selfCheck(); console.log(`라이어 게임 서버 → http://localhost:${PORT}`); });
