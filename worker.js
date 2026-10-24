/**
 * 라이어 게임 온라인판 — Cloudflare Workers 무료 플랜용 서버 (바퀴벌레 포커와 같은 짜임).
 *  - 화면(public/index.html)은 정적 자산으로 나간다. 요청 수 한도에 잡히지 않는다.
 *  - /ws 소켓만 Durable Object 하나(main)로 간다. 방은 전부 그 안 메모리에 산다(저장소를 쓰지 않는다).
 *  - 탭은 25초마다 ping, 2분 반 소식 없으면 끊긴 것으로, 20분 조작이 없으면 닫는다(다시 누르면 이어 붙음).
 *  - GitHub Pages(41ways.github.io/liar-game)에서 열어도 온라인 판은 이 서버의 /ws 로 붙는다.
 */
import { DurableObject } from 'cloudflare:workers';
import game from './server/game.js';

const ALIVE_MS = 150_000;
const IDLE_MS = 20 * 60_000;
const SWEEP_MS = 30_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/healthz') {
      return env.GAME.get(env.GAME.idFromName('main')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

class Sock {
  constructor(ws) { this.ws = ws; this.open = true; this.seen = this.acted = Date.now(); }
  get readyState() { return this.open ? 1 : 3; }
  send(text) { if (!this.open) return; try { this.ws.send(text); } catch (_) { this.open = false; } }
  close(code = 1000, reason = '') { if (!this.open) return; this.open = false; try { this.ws.close(code, reason); } catch (_) {} }
}

export class LiarGame extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socks = new Set();
    this.timer = null;
    this.idleMs = Number(env.IDLE_MS) || IDLE_MS;
    this.sweepMs = Number(env.SWEEP_MS) || SWEEP_MS;
    if (!LiarGame.checked) { game.selfCheck(); LiarGame.checked = true; }
  }

  async fetch(req) {
    if (new URL(req.url).pathname === '/healthz') {
      return Response.json({ ok: true, rooms: game.rooms.size, sockets: this.socks.size });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const s = new Sock(server);
    this.socks.add(s);
    server.addEventListener('message', e => {
      s.seen = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') return;
      s.acted = s.seen;
      try { game.handle(s, msg); } catch (err) { console.error('handle error', err); }
    });
    const gone = () => { if (!this.socks.delete(s)) return; s.open = false; game.disconnect(s); this.tick(); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  tick() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      for (const s of [...this.socks]) {
        if (now - s.seen > ALIVE_MS) this.drop(s, 1001, 'gone');
        else if (now - s.acted > this.idleMs) { s.send(JSON.stringify({ t: 'idle' })); this.drop(s, 4000, 'idle'); }
      }
      game.sweepRooms(now);
      if (this.socks.size || game.rooms.size) this.tick();
    }, this.sweepMs);
  }

  drop(s, code, reason) { this.socks.delete(s); s.close(code, reason); game.disconnect(s, { keepSeat: true }); }
}
