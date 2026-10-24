'use strict';
/**
 * 온라인판 서버(server/game.js) 시험 — 가짜 소켓으로 실제 판을 끝까지 돌린다.
 *   node test/online.js            (LIAR_FAST=1 이 자동으로 켜진다)
 * 확인: 방 만들기·참가·관전·대기실 설정, 세 모드 판 흐름, 여러 라이어·공범, 동점 재투표, 끊김·나감,
 *       정보 누출(남의 제시어·역할이 결과 전에 내려가지 않는지), 점수 합.
 */
process.env.LIAR_FAST = '1';
const assert = require('assert');
const G = require('../server/game');

let fails = 0, passes = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(c, m) { if (c) passes++; else { fails++; console.log('  ✗ ' + m); } }

class FakeWs {
  constructor(name) { this.name = name; this.readyState = 1; this.inbox = []; this.state = null; this.me = null; this.chats = []; }
  send(t) { const m = JSON.parse(t); this.inbox.push(m); if (m.t === 'state') this.state = m; if (m.t === 'welcome') { this.me = m.you; this.token = m.token; this.code = m.code; } if (m.t === 'chat') this.chats.push(m); }
  close() { this.readyState = 3; }
  do(msg) { G.handle(this, msg); }
}
const g = ws => ws.state && ws.state.g;
const step = ws => g(ws) && g(ws).step;

async function until(fn, label, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(5); }
  ok(false, 'timeout: ' + label); return false;
}

function makeRoom(n, cfg) {
  const host = new FakeWs('방장');
  host.do({ t: 'create', name: '방장' });
  const code = host.code;
  const all = [host];
  for (let i = 1; i < n; i++) { const w = new FakeWs('p' + i); w.do({ t: 'join', code, name: '사람' + i }); all.push(w); }
  if (cfg) host.do(Object.assign({ t: 'cfg' }, cfg));
  return { host, all, code };
}

/** 정보 누출 검사: 결과 전에는 각자 자기 카드만, 남의 역할·정답 묶음 없음 */
function checkLeak(all, mode) {
  for (const w of all) {
    const s = g(w);
    if (!s || s.step === 'result' || w.state.phase === 'over') continue;
    ok(!s.answer, '결과 전 answer 누출');
    const str = JSON.stringify(w.state);
    ok(!/"liars":\[/.test(str), '결과 전 liars 목록 누출');
    if (s.my && s.my.role === 'liar') ok(s.my.word == null, '라이어에게 제시어 누출');
  }
}

/** 한 라운드를 끝까지: 설명/숫자 → 토론 → 지목(pickFn) → 정답(guessFn) */
async function playRound(ctx, { pick, guessRight = false, mode }) {
  const { all, host } = ctx;
  await until(() => step(host) === 'check', 'check');
  checkLeak(all, mode);
  all.forEach(w => w.do({ t: 'ready' }));
  if (mode === 'spy') {
    for (let q = 0; q < 3; q++) {
      await until(() => step(host) === 'answer' && g(host).qi === q, 'answer ' + q);
      checkLeak(all, mode);
      // 공개 전에는 남의 숫자가 안 보여야 한다
      all.forEach((w, i) => w.do({ t: 'num', n: (i % 10) + 1 }));
      await until(() => step(host) === 'reveal' || step(host) === 'vote', 'reveal ' + q);
      if (step(host) === 'reveal') { ok(Object.keys(g(host).nums[q]).length === all.length, '동시 공개: 숫자 전부 보임'); all.forEach(w => w.do({ t: 'ready' })); }
    }
  } else {
    await until(() => step(host) === 'talk', 'talk');
    // 남의 차례엔 설명이 안 먹혀야 한다
    const cur = g(host).seq[g(host).turn];
    const other = all.find(w => w.me !== cur);
    other.do({ t: 'desc', text: '끼어들기' });
    ok(!g(host).descs.some(d => d.text === '끼어들기'), '남의 차례 설명 차단');
    let guard = 0;
    while (step(host) === 'talk' && guard++ < 60) {
      const who = g(host).seq[g(host).turn];
      const w = all.find(x => x.me === who);
      if (w) w.do({ t: 'desc', text: `${w.name}의 설명` });
      await sleep(2);
    }
    await until(() => step(host) === 'discuss', 'discuss');
    ok(g(host).descs.length === g(host).seq.length, '설명 수 = 차례 수');
    all.forEach(w => w.do({ t: 'ready' }));
  }
  await until(() => step(host) === 'vote', 'vote');
  const target = pick(host);
  all.forEach(w => { if (w.me !== target && !g(w).caught.includes(w.me)) w.do({ t: 'vote', to: target }); else if (w.me === target) w.do({ t: 'vote', to: all.find(x => x.me !== target).me }); });
  await until(() => ['guess', 'result', 'accuse'].includes(step(host)), 'after vote');
  await until(() => step(host) !== 'accuse', 'accuse');
  if (step(host) === 'guess') {
    const liarWs = all.find(w => w.me === g(host).accused);
    liarWs.do({ t: 'guess', text: guessRight ? '__RIGHT__' : '틀린답' });
  }
}

async function scenario(name, n, cfg, fn) {
  const before = fails;
  const ctx = makeRoom(n, cfg);
  ctx.host.do({ t: 'start' });
  try { await fn(ctx); } catch (e) { ok(false, name + ' 예외 ' + e.stack); }
  ctx.all.forEach(w => w.do({ t: 'leave' }));
  console.log(`${fails === before ? '✓' : '✗'} ${name}`);
}

/** 서버 안의 실제 정답 — 시험에서만 rooms 를 들여다본다 */
const roomOf = ctx => G.rooms.get(ctx.code);

(async () => {
  G.selfCheck();

  // 대기실
  {
    const before = fails;
    const ctx = makeRoom(2);
    ctx.host.do({ t: 'start' });
    ok(ctx.host.inbox.some(m => m.t === 'err'), '2명은 시작 불가');
    ctx.host.do({ t: 'cfg', mode: 'spy', liars: 2, diff: 0, talkSec: 30, discussSec: 60, laps: 2 });
    ok(ctx.host.state.cfg.mode === 'spy' && ctx.host.state.cfg.diff === 0, '방장 설정 반영');
    ctx.all[1].do({ t: 'cfg', mode: 'fool' });
    ok(ctx.host.state.cfg.mode === 'spy', '방장 아니면 설정 못 바꿈');
    ctx.host.do({ t: 'cfg', custom: { name: '우리 반', w: ['철수', '영희', '민수', '지영', '철수'] } });
    ok(ctx.host.state.cfg.custom && ctx.host.state.cfg.custom.n === 4 && ctx.host.state.cfg.mode === 'liar', '내 주제(중복 제거, 라이어 모드로)');
    const spec = new FakeWs('구경꾼');
    ctx.all[1].do({ t: 'chat', text: '안녕' });
    ok(ctx.host.chats.some(c => c.text === '안녕'), '채팅 전달');
    ctx.all.forEach(w => w.do({ t: 'leave' }));
    console.log(`${fails === before ? '✓' : '✗'} 대기실·설정·채팅`);
  }

  // 일반 라이어 4명 — 라이어 지목 후 정답 틀림 → 시민 승
  await scenario('라이어 4명: 라이어 잡고 오답 → 시민 승', 4, { mode: 'liar', mission: true, hint: true }, async ctx => {
    await playRound(ctx, { mode: 'liar', pick: h => roomOf(ctx).g.R.liars[0] });
    await until(() => step(ctx.host) === 'result', 'result');
    ok(g(ctx.host).win === 'c', '시민 승');
    ok(g(ctx.host).answer && g(ctx.host).answer.word, '결과에 정답 공개');
    const liar = ctx.all.find(w => roomOf(ctx).g.R.liars.includes(w.me));
    ok(liar && g(liar).my.role === 'liar' && g(liar).my.hint > 0, '라이어 카드: 역할·힌트');
    const pts = ctx.host.state.players.reduce((a, p) => a + p.pts, 0);
    ok(pts === 3, '점수 합(시민 3명 +1) = ' + pts);
  });

  // 라이어 정답 맞힘 → 라이어 승
  await scenario('라이어 5명: 라이어가 정답 맞힘 → 역전승', 5, { mode: 'liar' }, async ctx => {
    const r = roomOf(ctx);
    await until(() => r.g && r.g.step === 'check', 'check');
    const word = r.g.R.word;
    // __RIGHT__ 를 실제 정답(띄어쓰기 섞어서)으로 바꿔 보낸다
    const orig = FakeWs.prototype.do;
    FakeWs.prototype.do = function (m) { if (m.t === 'guess' && m.text === '__RIGHT__') m = { t: 'guess', text: ' ' + word.split('').join(' ') + ' ' }; return orig.call(this, m); };
    await playRound(ctx, { mode: 'liar', pick: () => r.g.R.liars[0], guessRight: true });
    FakeWs.prototype.do = orig;
    await until(() => step(ctx.host) === 'result', 'result');
    ok(g(ctx.host).win === 'l' && g(ctx.host).why === 'guessed', '띄어쓰기 섞인 정답 인정 → 라이어 승');
  });

  // 시민 지목 → 라이어 승
  await scenario('바보 라이어 4명: 시민 지목 → 라이어 승', 4, { mode: 'fool' }, async ctx => {
    const r = roomOf(ctx);
    await playRound(ctx, { mode: 'fool', pick: () => r.players.find(p => !r.g.R.liars.includes(p.id)).id });
    await until(() => step(ctx.host) === 'result', 'result');
    ok(g(ctx.host).win === 'l' && g(ctx.host).why === 'innocent', '억울한 시민 → 라이어 승');
    const fool = ctx.all.find(w => r.g.R.liars.includes(w.me));
    ok(g(fool).my.role === 'citizen' && g(fool).my.word === r.g.R.lw, '바보 라이어는 시민처럼 보이고 다른 단어');
  });

  // 스파이 6명, 2명 — 둘 다 잡기
  await scenario('스파이 6명·2명: 숫자 동시 공개, 둘 다 잡음 → 시민 승', 6, { mode: 'spy', liars: 2, diff: 1 }, async ctx => {
    const r = roomOf(ctx);
    await playRound(ctx, { mode: 'spy', pick: () => r.g.R.liars[0] });
    await until(() => step(ctx.host) === 'discuss' || step(ctx.host) === 'result', 'after first catch');
    ok(step(ctx.host) === 'discuss' && g(ctx.host).caught.length === 1, '첫 스파이 잡고 다시 토론');
    ctx.all.forEach(w => w.do({ t: 'ready' }));
    await until(() => step(ctx.host) === 'vote', 'vote2');
    const t2 = r.g.R.liars[1];
    const caughtId = r.g.R.liars[0];
    const caughtWs = ctx.all.find(w => w.me === caughtId);
    caughtWs.do({ t: 'vote', to: t2 });
    ok(!Object.keys(r.g.votes).map(Number).includes(caughtId), '잡힌 사람은 투표 못 함');
    ctx.all.forEach(w => { if (w.me !== t2 && w.me !== caughtId) w.do({ t: 'vote', to: t2 }); else if (w.me === t2) w.do({ t: 'vote', to: ctx.all.find(x => x.me !== t2 && x.me !== caughtId).me }); });
    await until(() => step(ctx.host) === 'guess', 'guess2');
    ctx.all.find(w => w.me === t2).do({ t: 'guess', text: '아무거나' });
    await until(() => step(ctx.host) === 'result', 'result');
    ok(g(ctx.host).win === 'c', '스파이 둘 다 잡음 → 시민 승');
  });

  // 공범 지목 → 라이어 승
  await scenario('라이어 6명+공범: 공범 지목 → 라이어 승', 6, { mode: 'liar', acc: true }, async ctx => {
    const r = roomOf(ctx);
    await until(() => r.g && r.g.step === 'check', 'check');
    ok(r.g.R.acc != null && !r.g.R.liars.includes(r.g.R.acc), '공범 배정');
    const accWs = ctx.all.find(w => w.me === r.g.R.acc);
    ok(g(accWs).my.role === 'acc' && g(accWs).my.word === r.g.R.word, '공범은 제시어를 앎');
    await playRound(ctx, { mode: 'liar', pick: () => r.g.R.acc });
    await until(() => step(ctx.host) === 'result', 'result');
    ok(g(ctx.host).win === 'l' && g(ctx.host).why === 'acc', '공범 지목 → 라이어 승');
    const accP = ctx.host.state.players.find(p => p.id === r.g.R.acc);
    ok(accP.pts === 2, '공범 +2');
  });

  // 동점 → 재투표 → 또 동점 → 라이어 승
  await scenario('동점 두 번 → 라이어 승', 4, { mode: 'liar' }, async ctx => {
    const r = roomOf(ctx);
    await until(() => r.g && r.g.step === 'check', 'check');
    ctx.all.forEach(w => w.do({ t: 'ready' }));
    await until(() => r.g.step === 'talk', 'talk');
    ctx.host.do({ t: 'skip' }); // 방장 넘기기 — 시간 초과 처리
    let guard = 0;
    while (r.g.step === 'talk' && guard++ < 20) ctx.host.do({ t: 'skip' });
    await until(() => r.g.step === 'discuss', 'discuss');
    ok(r.g.descs.some(d => d.timeout), '넘긴 차례는 시간 초과로 기록');
    ctx.host.do({ t: 'skip' });
    await until(() => r.g.step === 'vote', 'vote');
    const [a, b, c, d] = ctx.all;
    a.do({ t: 'vote', to: b.me }); b.do({ t: 'vote', to: a.me }); c.do({ t: 'vote', to: a.me }); d.do({ t: 'vote', to: b.me });
    await until(() => r.g.voteRound === 2, '재투표');
    ok(JSON.stringify(r.g.cands.sort()) === JSON.stringify([a.me, b.me].sort()), '동점자만 후보');
    c.do({ t: 'vote', to: d.me });
    ok(!r.g.votes[c.me], '후보 밖 지목 막음');
    a.do({ t: 'vote', to: b.me }); b.do({ t: 'vote', to: a.me }); c.do({ t: 'vote', to: a.me }); d.do({ t: 'vote', to: b.me });
    await until(() => r.g.step === 'result', 'result');
    ok(r.g.win === 'l' && r.g.why === 'tie', '두 번 동점 → 라이어 승');
  });

  // 끊김·나감: 설명 차례인 사람이 끊기면 건너뛴다, 판 중 나간 사람은 (나감)
  await scenario('끊김·나감에도 판이 멈추지 않음', 5, { mode: 'liar' }, async ctx => {
    const r = roomOf(ctx);
    await until(() => r.g && r.g.step === 'check', 'check');
    ctx.all.forEach(w => w.do({ t: 'ready' }));
    await until(() => r.g.step === 'talk', 'talk');
    const cur = ctx.all.find(w => w.me === r.g.seq[r.g.turn]);
    cur.readyState = 3; G.disconnect(cur);
    await until(() => r.g.step !== 'talk' || r.g.seq[r.g.turn] !== cur.me, '끊긴 사람 건너뜀', 3000);
    // 다시 붙기
    const back = new FakeWs('복귀'); back.do({ t: 'resume', code: ctx.code, token: cur.token });
    ok(back.state && back.me === cur.me, '토큰으로 재접속');
    const leaver = ctx.all.find(w => w !== ctx.host && w !== cur);
    leaver.do({ t: 'leave' });
    ok(ctx.host.state.players.find(p => p.id === leaver.me).left, '판 중 나가면 (나감) 표시');
    let guard = 0;
    while (r.g.step === 'talk' && guard++ < 20) { const w = [back, ...ctx.all].find(x => x.me === r.g.seq[r.g.turn] && x.readyState === 1); if (w) w.do({ t: 'desc', text: '설명' }); else ctx.host.do({ t: 'skip' }); await sleep(2); }
    await until(() => r.g.step === 'discuss', 'discuss');
    ctx.all.concat(back).forEach(w => w.readyState === 1 && w.do({ t: 'ready' }));
    await until(() => r.g.step === 'vote', 'vote(나간 사람 빼고 모두 준비)');
  });

  // 다음 라운드·게임 끝내기·다시 하기
  await scenario('다음 라운드 → 게임 끝내기 → 대기실', 3, { mode: 'liar' }, async ctx => {
    const r = roomOf(ctx);
    await playRound(ctx, { mode: 'liar', pick: () => r.g.R.liars[0] });
    await until(() => r.g.step === 'result', 'result1');
    const w1 = r.g.R.word;
    ctx.host.do({ t: 'next' });
    await until(() => r.g.step === 'check' && r.round === 1, 'round2');
    ok(r.g.R.word !== w1 || r.cfg.cat !== 63, '다음 라운드 새 제시어');
    ctx.all.forEach(w => w.do({ t: 'ready' }));
    ctx.host.do({ t: 'skip' });
    while (r.g.step === 'talk') ctx.host.do({ t: 'skip' });
    ctx.host.do({ t: 'skip' });
    await until(() => r.g.step === 'vote', 'vote');
    ctx.host.do({ t: 'skip' });
    await until(() => r.g.step === 'result', 'result2 (아무도 안 찍음)');
    ok(r.g.why === 'novote', '투표 없음 → 라이어 승');
    ctx.host.do({ t: 'end' });
    ok(ctx.host.state.phase === 'over' && ctx.host.state.history.length === 2, '최종 순위(2라운드 기록)');
    ctx.host.do({ t: 'again' });
    ok(ctx.host.state.phase === 'lobby' && ctx.host.state.players.every(p => p.pts === 0), '대기실로, 점수 초기화');
  });

  // 관전
  {
    const before = fails;
    const ctx = makeRoom(3, { mode: 'liar' });
    ctx.host.do({ t: 'start' });
    const sp = new FakeWs('관전'); sp.do({ t: 'join', code: ctx.code, name: '관전자' });
    ok(sp.state && sp.state.role === 'spec', '시작한 방에 들어오면 관전');
    ok(sp.state.g && !sp.state.g.my, '관전자는 카드 없음');
    sp.do({ t: 'chat', text: '구경 중' });
    ok(ctx.host.chats.some(c => c.spec && c.text === '구경 중'), '관전자 채팅');
    ctx.all.concat(sp).forEach(w => w.do({ t: 'leave' }));
    console.log(`${fails === before ? '✓' : '✗'} 관전`);
  }

  // 대량: 무작위로 300판
  {
    const before = fails;
    for (let t = 0; t < 300; t++) {
      const mode = ['liar', 'fool', 'spy'][t % 3], n = 3 + (t % 10);
      const ctx = makeRoom(n, { mode, liars: 1 + (t % 3), acc: t % 4 === 0, laps: 1 + (t % 2), cat: t % 7 === 0 ? 2 : 63 });
      ctx.host.do({ t: 'start' });
      const r = roomOf(ctx);
      ok(r.phase === 'playing', 'start ' + t);
      // 무작위 행동을 섞어 끝까지
      let guard = 0;
      while (r.g.step !== 'result' && guard++ < 400) {
        const w = ctx.all[Math.floor(Math.random() * n)];
        const s = r.g.step;
        if (s === 'talk') { const c = ctx.all.find(x => x.me === r.g.seq[r.g.turn]); c.do({ t: 'desc', text: 'ㅋ' }); }
        else if (s === 'answer') w.do({ t: 'num', n: 1 + Math.floor(Math.random() * 10) });
        else if (s === 'vote') w.do({ t: 'vote', to: ctx.all[Math.floor(Math.random() * n)].me });
        else if (s === 'guess') { const a = ctx.all.find(x => x.me === r.g.accused); a.do({ t: 'guess', text: Math.random() < 0.3 ? r.g.R.word : 'x' }); }
        else if (s === 'accuse') await sleep(40);
        else w.do({ t: 'ready' });
        if (Math.random() < 0.05) ctx.host.do({ t: 'skip' });
        checkLeak(ctx.all, mode);
        await sleep(0);
      }
      ok(r.g.step === 'result', `대량 ${t} 끝남 (${mode} ${n}명) step=${r.g.step}`);
      const sum = r.players.reduce((a, p) => a + p.pts, 0);
      const L = r.g.R.liars.length, acc = r.g.R.acc != null ? 1 : 0;
      ok(sum === (r.g.win === 'c' ? n - L - acc : 3 * L + 2 * acc), `대량 ${t} 점수 합`);
      ctx.all.forEach(w => w.do({ t: 'leave' }));
    }
    console.log(`${fails === before ? '✓' : '✗'} 무작위 300판`);
  }

  ok(G.rooms.size === 0, '시험 뒤 방이 모두 치워짐 (' + G.rooms.size + ')');
  console.log(`\n통과 ${passes} · 실패 ${fails}`);
  process.exit(fails ? 1 : 0);
})();
