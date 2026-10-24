'use strict';
/**
 * 배포본 한 판 — 실제 서버(wss)에 세 명이 붙어 라이어 게임 한 라운드를 끝까지.
 *   node test/prod.js [wss://liar.41ways.workers.dev/ws]
 */
const WebSocket = require('ws');
const URL = process.argv[2] || 'wss://liar.41ways.workers.dev/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, state: null, me: null, code: null, chats: [], send: o => ws.send(JSON.stringify(o)) };
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; if (m.t === 'welcome') { c.me = m.you; c.code = m.code; } if (m.t === 'chat') c.chats.push(m); if (m.t === 'err') console.log(name, 'err', m.msg); });
    ws.on('open', () => res(c)); ws.on('error', rej);
  });
}
async function until(fn, label, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(50); } throw new Error('timeout ' + label); }
const step = c => c.state && c.state.g && c.state.g.step;

(async () => {
  const t0 = Date.now();
  const a = await client('시험A'), b = await client('시험B'), c = await client('시험C');
  a.send({ t: 'create', name: '시험A', priv: true });
  await until(() => a.code, 'create');
  b.send({ t: 'join', code: a.code, name: '시험B' }); c.send({ t: 'join', code: a.code, name: '시험C' });
  await until(() => a.state && a.state.players.length === 3, 'join');
  b.send({ t: 'chat', text: '배포본 채팅 시험' });
  await until(() => a.chats.some(m => m.text === '배포본 채팅 시험'), 'chat');
  a.send({ t: 'cfg', mode: 'liar', mission: false });
  a.send({ t: 'start' });
  const all = [a, b, c];
  await until(() => all.every(x => step(x) === 'check' && x.state.g.my), 'check');
  const liar = all.find(x => x.state.g.my.role === 'liar');
  console.log('방', a.code, '· 주제', a.state.g.cat, '· 라이어', liar.name, '· 다른 사람 단어', all.filter(x => x !== liar).map(x => x.state.g.my.word).join('/'));
  all.forEach(x => x.send({ t: 'ready' }));
  await until(() => step(a) === 'talk', 'talk');
  while (step(a) === 'talk') {
    const id = a.state.g.seq[a.state.g.turn];
    all.find(x => x.me === id).send({ t: 'desc', text: '설명 ' + id });
    await until(() => step(a) !== 'talk' || a.state.g.seq[a.state.g.turn] !== id, 'next turn');
  }
  await until(() => step(a) === 'discuss', 'discuss');
  all.forEach(x => x.send({ t: 'ready' }));
  await until(() => step(a) === 'vote', 'vote');
  all.forEach(x => x.send({ t: 'vote', to: x === liar ? all.find(y => y !== liar).me : liar.me }));
  await until(() => step(a) === 'guess', 'guess', 20000);
  liar.send({ t: 'guess', text: '모르겠어요' });
  await until(() => step(a) === 'result', 'result');
  console.log('결과:', a.state.g.win === 'c' ? '시민 승' : '라이어 승', '· 정답', a.state.g.answer.word, '· 점수', a.state.players.map(p => p.name + ' ' + p.pts).join(', '));
  all.forEach(x => x.send({ t: 'leave' }));
  await sleep(300); all.forEach(x => x.ws.close());
  console.log(`배포본 한 판 OK (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  process.exit(0);
})().catch(e => { console.error('실패', e.message); process.exit(1); });
