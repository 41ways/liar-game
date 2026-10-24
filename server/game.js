'use strict';
/**
 * 라이어 게임 온라인판 — 방 관리와 판 진행(권위 서버).
 *  - 제시어·역할은 서버만 안다. 각자에게는 자기 카드만 내려간다(stateFor).
 *  - 통신 방식은 모른다. 소켓은 send(문자열) · close() · readyState 만 있으면 된다.
 *    Node(server.js)와 Cloudflare(worker.js)가 이 파일을 똑같이 쓴다. (바퀴벌레 포커·로보77 과 같은 짜임)
 *  - 규칙·단어는 오프라인 판과 같은 shared.js(빌드가 src/data.js·src/rules.js 로 만든다)를 쓴다.
 *
 * 판 흐름(g.step)
 *   check  카드 확인 → 모두 준비
 *   talk   (라이어·바보) 차례대로 제시어 설명 한 줄씩, laps 바퀴
 *   answer (스파이) 질문에 1~10 몰래 내기 → reveal 동시 공개 → 다음 질문 … → vote
 *   discuss 자유 채팅 토론 → 모두 '지목하자' 또는 시간 끝
 *   vote   비밀 투표 → 동점이면 동점자끼리 한 번 더 → 또 동점이면 라이어 승
 *   accuse 지목된 사람 공개(잠깐)
 *   guess  잡힌 라이어가 제시어 입력 → 맞히면 라이어 승, 틀리면 (남은 라이어가 있으면) 다시 discuss
 *   result 라운드 결과 → 방장이 다음 라운드 / 게임 끝내기(phase over = 최종 순위)
 */
const L = require('./shared');

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 3;
const MAX_SPECS = 10;
const FAST = typeof process !== 'undefined' && !!process.env && process.env.LIAR_FAST === '1';
const MS = FAST
  ? { check: 300, vote: 300, guess: 300, accuse: 30, reveal: 300, dc: 100, lobby: 300, topic: 300, spin: 30 }
  : { check: 45000, vote: 45000, guess: 60000, accuse: 2600, reveal: 60000, dc: 8000, lobby: 20000, topic: 30000, spin: 5800 };
const TALK_SECS = [30, 45, 60, 0];          // 0 = 무제한
const DISCUSS_SECS = [60, 120, 180, 300];
const CUSTOM_IDX = L.LIARC.length;          // 방장이 넣은 '내 주제'의 번호

/* ─────────────────────────── 유틸 ─────────────────────────── */

const pickR = a => a[Math.floor(Math.random() * a.length)];
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),
  b => b.toString(16).padStart(2, '0')).join('');
/** 정답 비교: 띄어쓰기·문장부호·대소문자 무시 */
const norm = s => String(s || '').toLowerCase().replace(/[\s.,!?~'"`·・\-_()[\]{}]/g, '');

/* ─────────────────────────── 방 ─────────────────────────── */

const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 4 }, () => pickR(alphabet.split(''))).join('');
  while (rooms.has(code));
  return code;
}

function createRoom({ priv = false, spec = true } = {}) {
  const room = {
    code: makeCode(),
    phase: 'lobby',            // lobby | playing | over
    hostId: null,
    players: [],
    specs: [],
    nextId: 1,
    cfg: { mode: 'liar', cat: L.VOTE, liars: 1, acc: false, hint: false, mission: true, diff: 1, laps: 1,
      talkSec: 45, discussSec: 120, penalty: false, priv: !!priv, spec: spec !== false, custom: null },
    seed: 0, round: 0, g: null,
    tally: { c: 0, l: 0 }, history: [], recent: {},
    timers: { step: null, host: null, dc: null },
    lastActive: Date.now(),
    madeAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function freeAv(room) {
  const used = new Set(room.players.map(p => p.av));
  for (let i = 0; i < 18; i++) if (!used.has(i)) return i;
  return room.players.length % 18;
}

function addPlayer(room, { name }) {
  const p = {
    id: room.nextId++, token: token(), name: name || `플레이어 ${room.nextId - 1}`,
    ws: null, connected: false, av: freeAv(room), pts: 0, left: false, lastChat: 0, lastReact: 0,
  };
  room.players.push(p);
  if (room.hostId == null) room.hostId = p.id;
  return p;
}

const playerOf = (room, id) => room.players.find(p => p.id === id) || null;
const active = room => room.players.filter(p => p.connected && !p.left);   // 지금 응답할 수 있는 사람

function pickHost(room) {
  const next = room.players.find(p => p.connected && !p.left) || room.players.find(p => !p.left);
  room.hostId = next ? next.id : null;
}

/** 대기실이면 자리를 뺀다. 판 중이면 자리는 남기고 '떠남'으로만 표시(역할이 판에 얽혀 있다). */
function removePlayer(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const p = room.players[i];
  clearTimeout(p.leaveT);
  if (room.phase === 'lobby') room.players.splice(i, 1);
  else { p.left = true; p.connected = false; p.ws = null; p.name = p.name.replace(/ \(나감\)$/, '') + ' (나감)'; }
  if (room.hostId === p.id) pickHost(room);
  if (room.phase === 'playing') progress(room);
  listChanged();
  seatSpecs(room);
}

/* ─────────────────────────── 관전자 ─────────────────────────── */

const specOf = (room, ws) => room.specs.find(s => s.ws === ws) || null;

function addSpec(room, ws, name) {
  watchers.delete(ws);
  const sp = { id: room.nextId++, name, ws, lastChat: 0 };
  room.specs.push(sp);
  ws.roomCode = room.code; ws.playerId = null; ws.specId = sp.id;
  send(ws, { t: 'welcome', role: 'spec', you: null, specId: sp.id, code: room.code });
  pushState(room);
  listChanged();
  return sp;
}

function removeSpec(room, ws) {
  const i = room.specs.findIndex(s => s.ws === ws);
  if (i >= 0) room.specs.splice(i, 1);
  ws.specId = null;
  return i >= 0;
}

/** 대기실로 돌아오면 관전자를 빈자리에 앉힌다 */
function seatSpecs(room) {
  if (room.phase !== 'lobby') return;
  let moved = false;
  while (room.specs.length && room.players.length < MAX_PLAYERS) {
    const sp = room.specs.shift();
    if (!sp.ws || sp.ws.readyState !== 1) continue;
    const p = addPlayer(room, { name: sp.name });
    sp.ws.specId = null;
    attach(room, p, sp.ws, { seated: true });
    sysChat(room, `${p.name}님이 자리에 앉았어요.`);
    moved = true;
  }
  if (moved) listChanged();
}

function dropRoom(room) {
  clearStep(room);
  clearTimeout(room.timers.host); clearTimeout(room.timers.dc);
  for (const sp of room.specs) {
    send(sp.ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
    sp.ws.roomCode = null; sp.ws.specId = null;
    try { sp.ws.close(1000, 'room gone'); } catch (_) {}
  }
  room.specs = [];
  rooms.delete(room.code);
  listChanged();
}

/* ─────────────────────────── 판 ─────────────────────────── */

function clearStep(room) { clearTimeout(room.timers.step); room.timers.step = null; }

/** 단계를 바꾸고 제한 시간을 건다. ms=0 이면 시간 제한 없음 */
function setStep(room, step, ms, extra) {
  clearStep(room);
  const g = room.g;
  g.step = step;
  g.ready = [];
  g.endsAt = ms ? Date.now() + ms : 0;
  if (extra) Object.assign(g, extra);
  if (ms) room.timers.step = setTimeout(() => onTimeout(room, step), ms);
}

function catsOf(room) {
  const c = room.cfg;
  if (c.mode === 'spy') return L.SPYC;
  return c.custom ? L.LIARC.concat([{ name: c.custom.name, icon: 'envelope', w: c.custom.w }]) : L.LIARC;
}

function startGame(room) {
  // 판 시작 때 대기실에서 끊긴 채 남은 자리는 비운다
  room.players = room.players.filter(p => p.connected);
  if (!playerOf(room, room.hostId)) pickHost(room);
  const n = room.players.length;
  const c = room.cfg;
  if (c.acc && (c.mode !== 'liar' || n < 5)) c.acc = false;
  c.liars = Math.max(1, Math.min(c.liars, L.maxLiars(n, c.acc)));
  room.phase = 'playing';
  room.seed = Math.floor(Math.random() * 1e9);
  room.round = 0; room.tally = { c: 0, l: 0 }; room.history = []; room.recent = {};
  for (const p of room.players) p.pts = 0;
  sysChat(room, `게임 시작! ${n}명 · ${modeName(c.mode)}`);
  startRound(room);
  listChanged();
}

const modeName = m => ({ liar: '라이어 게임', fool: '바보 라이어', spy: '스파이 게임' }[m]);
const roleName = room => ({ liar: '라이어', fool: '바보 라이어', spy: '스파이' }[room.cfg.mode]);

/** 라운드 시작 — 주제가 '투표'면 먼저 다 같이 주제를 찍고 표 수만큼 룰렛을 돌린다 */
function startRound(room) {
  if (room.cfg.cat === L.VOTE) {
    room.g = { step: 'topic', endsAt: 0, ready: [], R: null, topic: { votes: {}, counts: null, pick: null }, caught: [] };
    setStep(room, 'topic', MS.topic);
    return pushState(room);
  }
  buildRound(room, room.cfg.cat, null);
}

/** 주제 투표 마감 → 표 수 비례로 뽑고 룰렛(spin)을 보여 준 뒤 라운드를 만든다 */
function spinTopic(room) {
  const g = room.g, cats = catsOf(room);
  const tally = {};
  for (const v of Object.values(g.topic.votes)) tally[v] = (tally[v] || 0) + 1;
  const counts = Object.entries(tally).map(([k, n]) => [Number(k), n]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const pick = L.weightedPick(counts, Math.random, cats.map((_, i) => i));
  g.topic.counts = counts.length ? counts : cats.map((_, i) => [i, 1]);   // 아무도 안 찍으면 모든 주제 같은 칸
  g.topic.pick = pick;
  setStep(room, 'spin', MS.spin);
  pushState(room);
}

function buildRound(room, catIdx, topic) {
  const c = room.cfg, ps = room.players, n = ps.length;
  const cats = catsOf(room);
  const cfgR = { mode: c.mode, n, cat: catIdx, seed: room.seed, diff: c.diff, mission: c.mode !== 'spy' && c.mission,
    hint: c.mode === 'liar' && c.hint, liars: Math.min(c.liars, L.maxLiars(n, c.acc)), acc: c.mode === 'liar' && c.acc && n >= 5 };
  if (cfgR.cat !== L.RANDOM && (cfgR.cat < 0 || cfgR.cat >= cats.length)) cfgR.cat = L.RANDOM;
  const recentOf = key => room.recent[key] || [];
  const R = L.genRound(cfgR, room.round, recentOf, cats);
  // 최근 단어 기억(오프라인 판과 같은 방식)
  const cat = cats.find(x => x.name === R.cat);
  const cap = Math.max(3, Math.floor(((cat && cat.w.length) || 10) * 0.7));
  const remember = (key, words, k) => { const a = (room.recent[key] || []).filter(w => !words.includes(w)); a.push(...words); room.recent[key] = a.slice(-k); };
  if (c.mode === 'spy') remember('spy:' + R.cat, [R.word, R.lw, [R.word, R.lw].sort().join('|')], cap + 8);
  else { remember(c.mode + ':' + R.cat, [R.word], cap); if (R.lw) remember(c.mode + ':' + R.cat + ':lw', [R.lw], Math.floor(cap / 2)); }

  const idAt = i => ps[i].id;
  const startAt = ps.findIndex(p => p.id === idAt(R.starter));
  const order = Array.from({ length: n }, (_, k) => idAt(R.rev ? (startAt - k + n * 2) % n : (startAt + k) % n));
  room.g = {
    step: 'check', endsAt: 0, ready: [],
    R: { cat: R.cat, icon: R.icon, word: R.word, lw: R.lw, hint: R.hint || 0, mission: R.mission, intro: R.intro, rev: R.rev,
      qs: R.qs, liars: R.liars.map(idAt), acc: R.acc >= 0 ? idAt(R.acc) : null, starter: idAt(R.starter) },
    order, seq: [], turn: 0, descs: [],
    qi: 0, nums: R.qs.map(() => ({})), shown: R.qs.map(() => false),
    votes: {}, lastVotes: null, voteRound: 1, cands: null,
    accused: null, caught: [], guess: null, guesses: [],
    win: null, why: null, delta: null, pen: null, topic,
  };
  const g = room.g;
  for (let lap = 0; lap < (c.mode === 'spy' ? 0 : c.laps); lap++) g.seq.push(...order);
  setStep(room, 'check', MS.check);
  pushState(room);
}

const isLiar = (room, id) => !!room.g.R && room.g.R.liars.includes(id);

/** 모든 응답 대상이 응답했는지 */
function allDone(room, set, who) {
  const need = (who || active(room)).map(p => p.id);
  return need.length > 0 && need.every(id => set.includes(id));
}

function afterCheck(room) {
  if (room.cfg.mode === 'spy') { setStep(room, 'answer', talkMs(room), { qi: 0 }); }
  else beginTalk(room, 0);
  pushState(room);
}

const talkMs = room => room.cfg.talkSec * 1000;

/** 설명 차례 — 자리를 비운 사람·떠난 사람은 건너뛴다 */
function beginTalk(room, turn) {
  const g = room.g;
  while (turn < g.seq.length) {
    const p = playerOf(room, g.seq[turn]);
    if (p && p.connected && !p.left) break;
    g.descs.push({ id: g.seq[turn], text: '', skip: true, lap: Math.floor(turn / g.order.length) });
    turn++;
  }
  if (turn >= g.seq.length) return beginDiscuss(room);
  setStep(room, 'talk', talkMs(room), { turn });
}

function beginDiscuss(room) {
  setStep(room, 'discuss', room.cfg.discussSec * 1000);
}

function beginVote(room, cands) {
  const g = room.g;
  g.votes = {};
  setStep(room, 'vote', MS.vote, { cands: cands || null, voteRound: cands ? 2 : 1 });
}

const voters = room => active(room).filter(p => !room.g.caught.includes(p.id));

function tally(room) {
  const g = room.g;
  const count = {};
  for (const [, to] of Object.entries(g.votes)) count[to] = (count[to] || 0) + 1;
  g.lastVotes = Object.assign({}, g.votes);
  const ids = Object.keys(count).map(Number);
  if (!ids.length) return finish(room, 'l', 'novote');
  const top = Math.max(...ids.map(i => count[i]));
  const best = ids.filter(i => count[i] === top);
  if (best.length > 1) {
    if (g.voteRound === 1) {
      sysChat(room, `동점! ${best.map(i => nm(room, i)).join(', ')} 중에서 한 번 더 지목해요.`);
      beginVote(room, best);
      return pushState(room);
    }
    return finish(room, 'l', 'tie');
  }
  g.accused = best[0];
  setStep(room, 'accuse', MS.accuse);
  pushState(room);
}

function afterAccuse(room) {
  const g = room.g, a = g.accused;
  if (isLiar(room, a) && !g.caught.includes(a)) {
    setStep(room, 'guess', MS.guess, { guess: null });
    pushState(room);
  } else finish(room, 'l', a === g.R.acc ? 'acc' : 'innocent');
}

function submitGuess(room, id, text) {
  const g = room.g;
  const ok = !!text && norm(text) === norm(g.R.word);
  g.guess = { id, text: text || '', ok };
  g.guesses.push(g.guess);
  if (ok) return finish(room, 'l', 'guessed');
  g.caught.push(id);
  if (g.caught.length >= g.R.liars.length) return finish(room, 'c', 'caught');
  sysChat(room, `${nm(room, id)}님은 ${roleName(room)}였지만 정답을 못 맞혔어요. 남은 ${roleName(room)} ${g.R.liars.length - g.caught.length}명!`);
  beginDiscuss(room);
  pushState(room);
}

function finish(room, w, why) {
  const g = room.g;
  clearStep(room);
  g.step = 'result'; g.endsAt = 0; g.win = w; g.why = why; g.ready = [];
  room.tally[w]++;
  g.delta = {};
  for (const p of room.players) {
    const lia = isLiar(room, p.id), acc = p.id === g.R.acc;
    const d = w === 'c' ? (lia || acc ? 0 : 1) : (lia ? 3 : acc ? 2 : 0);
    if (d) { g.delta[p.id] = d; p.pts += d; }
  }
  if (room.cfg.penalty) g.pen = pickR(L.PENALTIES);
  room.history.push({ round: room.round + 1, cat: g.R.cat, word: g.R.word, win: w });
  pushState(room);
}

/** 시간이 다 됐을 때 */
function onTimeout(room, step) {
  room.timers.step = null;
  const g = room.g;
  if (!g || g.step !== step || room.phase !== 'playing') return;
  switch (step) {
    case 'topic': return spinTopic(room);
    case 'spin': return buildRound(room, g.topic.pick, g.topic);
    case 'check': return afterCheck(room);
    case 'talk':
      g.descs.push({ id: g.seq[g.turn], text: '', timeout: true, lap: Math.floor(g.turn / g.order.length) });
      beginTalk(room, g.turn + 1); return pushState(room);
    case 'answer': g.shown[g.qi] = true; setStep(room, 'reveal', revealMs(room)); return pushState(room);
    case 'reveal': return afterReveal(room);
    case 'discuss': beginVote(room); return pushState(room);
    case 'vote': return tally(room);
    case 'accuse': return afterAccuse(room);
    case 'guess': return submitGuess(room, g.accused, '');
  }
}

const revealMs = room => (room.g.qi >= room.g.R.qs.length - 1 ? room.cfg.discussSec * 1000 : MS.reveal);

function afterReveal(room) {
  const g = room.g;
  if (g.qi < g.R.qs.length - 1) setStep(room, 'answer', talkMs(room), { qi: g.qi + 1 });
  else beginVote(room);
  pushState(room);
}

/** 누가 나가거나 끊겼을 때, 기다리던 사람이 없어졌으면 다음으로 넘긴다 */
function progress(room) {
  const g = room.g;
  if (!g || room.phase !== 'playing') return;
  switch (g.step) {
    case 'topic': if (allDone(room, Object.keys(g.topic.votes).map(Number))) spinTopic(room); break;
    case 'check': if (allDone(room, g.ready)) afterCheck(room); break;
    case 'talk': {
      const p = playerOf(room, g.seq[g.turn]);
      if (!p || p.left || !p.connected) { g.descs.push({ id: g.seq[g.turn], text: '', skip: true, lap: Math.floor(g.turn / g.order.length) }); beginTalk(room, g.turn + 1); pushState(room); }
      break;
    }
    case 'answer': if (allDone(room, Object.keys(g.nums[g.qi]).map(Number))) { g.shown[g.qi] = true; setStep(room, 'reveal', revealMs(room)); pushState(room); } break;
    case 'reveal': if (allDone(room, g.ready)) afterReveal(room); break;
    case 'discuss': if (allDone(room, g.ready, voters(room))) { beginVote(room); pushState(room); } break;
    case 'vote': if (allDone(room, Object.keys(g.votes).map(Number), voters(room))) tally(room); break;
  }
}

/* ─────────────────────────── 통신 ─────────────────────────── */

function send(ws, obj) {
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (_) {} }
}
const nm = (room, id) => { const p = playerOf(room, id); return p ? p.name.replace(/ \(나감\)$/, '') : '?'; };

function stateFor(room, me) {
  const g = room.g, c = room.cfg;
  const s = {
    t: 'state', code: room.code, phase: room.phase, hostId: room.hostId, max: MAX_PLAYERS, min: MIN_PLAYERS,
    cfg: Object.assign({}, c, { custom: c.custom ? { name: c.custom.name, n: c.custom.w.length } : null }),
    you: me ? me.id : null, role: me ? 'player' : 'spec', now: Date.now(),
    specs: room.specs.map(x => x.name),
    players: room.players.map(p => ({ id: p.id, name: p.name, av: p.av, connected: p.connected, left: p.left, pts: p.pts })),
    round: room.round, tally: room.tally, history: room.history,
    maxLiars: L.maxLiars(room.players.length, c.acc && c.mode === 'liar'),
  };
  if (!g) return s;
  if (!g.R) {
    const t = g.topic, tally = {};
    for (const v of Object.values(t.votes)) tally[v] = (tally[v] || 0) + 1;
    s.g = { step: g.step, endsAt: g.endsAt, ready: [], caught: [], tally, voted: Object.keys(t.votes).map(Number),
      myTopic: me ? (t.votes[me.id] != null ? t.votes[me.id] : null) : null, counts: t.counts, pick: t.pick };
    return s;
  }
  const R = g.R, done = g.step === 'result' || room.phase === 'over';
  const rev = (qi) => g.shown[qi] || done;
  s.g = {
    step: g.step, endsAt: g.endsAt, ready: g.ready.slice(),
    cat: R.cat, icon: R.icon, mission: R.mission, intro: R.intro, rev: R.rev, starter: R.starter, liarsN: R.liars.length, accOn: R.acc != null,
    order: g.order, seq: g.seq, turn: g.turn, descs: g.descs,
    qi: g.qi, qs: R.qs.map((q, i) => (done ? q : { t: q.t, lo: q.lo, hi: q.hi })),
    nums: g.nums.map((m, i) => (rev(i) ? m : (me && m[me.id] != null ? { [me.id]: m[me.id] } : {}))),
    answered: g.nums.map(m => Object.keys(m).map(Number)),
    shown: g.shown,
    voted: Object.keys(g.votes).map(Number), myVote: me ? g.votes[me.id] || null : null, lastVotes: g.lastVotes,
    voteRound: g.voteRound, cands: g.cands, accused: g.accused, caught: g.caught, guess: g.guess, guesses: g.guesses,
    win: g.win, why: g.why, delta: g.delta, pen: g.pen,
    topic: g.topic ? { counts: g.topic.counts, pick: g.topic.pick } : null,
  };
  // 내 카드 — 바보 라이어·스파이는 시민과 똑같이 보인다(단어만 다름)
  if (me) {
    const lia = isLiar(room, me.id);
    if (c.mode === 'liar' && lia) s.g.my = { role: 'liar', word: null, hint: R.hint };
    else if (me.id === R.acc) s.g.my = { role: 'acc', word: R.word };
    else s.g.my = { role: 'citizen', word: lia ? R.lw : R.word };
  }
  if (done) s.g.answer = { liars: R.liars, acc: R.acc, word: R.word, lw: R.lw };
  return s;
}

function pushState(room) {
  for (const p of room.players) if (p.ws) send(p.ws, stateFor(room, p));
  if (room.specs.length) { const v = stateFor(room, null); for (const sp of room.specs) send(sp.ws, v); }
}
function broadcast(room, obj) {
  for (const p of room.players) if (p.ws) send(p.ws, obj);
  for (const sp of room.specs) send(sp.ws, obj);
}
function sysChat(room, text) { broadcast(room, { t: 'chat', sys: true, text }); }

/* ─────────────────────────── 열린 방 목록 ─────────────────────────── */

const watchers = new Set();
let listT = null;
function listChanged() {
  if (listT || !watchers.size) return;
  listT = setTimeout(() => { listT = null; pushList(); }, 300);
}
function roomList() {
  const rs = [];
  for (const r of rooms.values()) {
    if (!r.players.some(p => p.connected)) continue;
    const state = r.phase !== 'lobby' ? 'playing' : r.players.length >= MAX_PLAYERS ? 'full' : 'wait';
    rs.push({ r, state });
  }
  const open = x => (x.state === 'wait' && !x.r.cfg.priv ? 0 : 1);
  rs.sort((a, b) => open(a) - open(b) || b.r.madeAt - a.r.madeAt);
  return { t: 'rooms', list: rs.slice(0, 20).map(({ r, state }) => {
    const host = playerOf(r, r.hostId);
    const e = { mode: r.cfg.mode, host: host ? host.name : '', av: host ? host.av : 0, n: r.players.length, max: MAX_PLAYERS, state, spec: r.cfg.spec, watching: r.specs.length };
    if (r.cfg.priv) { e.priv = true; return e; }
    return Object.assign({ code: r.code }, e);
  }) };
}
function pushList() {
  if (!watchers.size) return;
  const text = JSON.stringify(roomList());
  for (const ws of watchers) {
    if (ws.readyState !== 1) { watchers.delete(ws); continue; }
    try { ws.send(text); } catch (_) { watchers.delete(ws); }
  }
}

/* ─────────────────────────── 메시지 처리 ─────────────────────────── */

function attach(room, p, ws, { seated = false } = {}) {
  clearTimeout(p.leaveT);
  watchers.delete(ws);
  p.ws = ws; p.connected = true;
  const host = playerOf(room, room.hostId);
  if (!host || (!host.connected && host !== p)) room.hostId = p.id;
  ws.roomCode = room.code; ws.playerId = p.id; ws.specId = null;
  send(ws, Object.assign({ t: 'welcome', role: 'player', you: p.id, token: p.token, code: room.code }, seated ? { seated: true } : {}));
  pushState(room);
  listChanged();
}

function detach(ws) {
  const room = rooms.get(ws.roomCode);
  if (room && ws.specId != null) {
    if (removeSpec(room, ws)) { pushState(room); listChanged(); }
  } else if (room) {
    const p = playerOf(room, ws.playerId);
    if (p && p.ws === ws) {
      if (room.phase === 'lobby') {
        removePlayer(room, p.id);
        if (!room.players.length) dropRoom(room); else pushState(room);
      } else disconnect(ws);
    }
  }
  ws.roomCode = null; ws.playerId = null; ws.specId = null;
}

function chatText(room, who, msg, extra) {
  const text = clean(msg.text, 200);
  if (!text) return;
  const now = Date.now();
  if (now - (who.lastChat || 0) < 350) return;
  who.lastChat = now;
  broadcast(room, Object.assign({ t: 'chat', from: who.id, name: who.name, text }, extra || {}));
}

function setCfg(room, msg) {
  const c = room.cfg;
  if (['liar', 'fool', 'spy'].includes(msg.mode) && msg.mode !== c.mode) { c.mode = msg.mode; if (c.cat !== L.RANDOM) c.cat = L.VOTE; listChanged(); }
  const cats = catsOf(room);
  if (Number.isInteger(msg.cat) && (msg.cat === L.RANDOM || msg.cat === L.VOTE || (msg.cat >= 0 && msg.cat < cats.length))) c.cat = msg.cat;
  if (Number.isInteger(msg.liars) && msg.liars >= 1 && msg.liars <= 3) c.liars = msg.liars;
  if (typeof msg.acc === 'boolean') c.acc = msg.acc;
  if (typeof msg.hint === 'boolean') c.hint = msg.hint;
  if (typeof msg.mission === 'boolean') c.mission = msg.mission;
  if (typeof msg.penalty === 'boolean') c.penalty = msg.penalty;
  if ([0, 1, 2].includes(msg.diff)) c.diff = msg.diff;
  if ([1, 2].includes(msg.laps)) c.laps = msg.laps;
  if (TALK_SECS.includes(msg.talkSec)) c.talkSec = msg.talkSec;
  if (DISCUSS_SECS.includes(msg.discussSec)) c.discussSec = msg.discussSec;
  if (typeof msg.priv === 'boolean' && msg.priv !== c.priv) { c.priv = msg.priv; listChanged(); }
  if (typeof msg.spec === 'boolean' && msg.spec !== c.spec) { c.spec = msg.spec; listChanged(); }
  if (msg.custom === null) { if (c.cat === CUSTOM_IDX) c.cat = L.VOTE; c.custom = null; }
  else if (msg.custom && typeof msg.custom === 'object' && Array.isArray(msg.custom.w)) {
    const name = clean(msg.custom.name, 10);
    const w = [...new Set(msg.custom.w.map(x => clean(x, 20)).filter(Boolean))].slice(0, 200);
    if (name && w.length >= 4) { c.custom = { name, w }; if (c.mode === 'spy') c.mode = 'liar'; c.cat = CUSTOM_IDX; }
  }
  if (c.mode === 'spy' && c.cat === CUSTOM_IDX) c.cat = L.VOTE;
  if (c.mode !== 'liar') { c.acc = false; c.hint = false; }
  c.liars = Math.max(1, Math.min(c.liars, 3));
}

function handle(ws, msg) {
  if ((msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') && ws.roomCode) detach(ws);
  switch (msg.t) {
    case 'rooms': if (!ws.roomCode) { watchers.add(ws); send(ws, roomList()); } return;
    case 'unwatch': watchers.delete(ws); return;
    case 'create': {
      const r = createRoom({ priv: msg.priv === true, spec: msg.spec !== false });
      const p = addPlayer(r, { name: clean(msg.name, 12) || '플레이어 1' });
      attach(r, p, ws);
      return;
    }
    case 'join': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '그런 방이 없어요. 코드를 확인해 주세요.' });
      const name = clean(msg.name, 12);
      if (r.phase !== 'lobby' || r.players.length >= MAX_PLAYERS) {
        if (!r.cfg.spec) return send(ws, { t: 'err', msg: (r.phase !== 'lobby' ? '이미 시작한 방이에요.' : '방이 가득 찼어요.') + ' 관전을 허용하지 않는 방이에요.' });
        if (r.specs.length >= MAX_SPECS) return send(ws, { t: 'err', msg: '관전석이 가득 찼어요.' });
        addSpec(r, ws, name || `관전자 ${r.specs.length + 1}`);
        return;
      }
      const p = addPlayer(r, { name: name || `플레이어 ${r.players.length + 1}` });
      attach(r, p, ws);
      sysChat(r, `${p.name}님이 들어왔어요.`);
      return;
    }
    case 'resume': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
      const p = r.players.find(x => x.token === msg.token && !x.left);
      if (!p) return send(ws, { t: 'err', msg: '자리를 찾을 수 없어요.', fatal: true });
      if (p.ws && p.ws !== ws) { send(p.ws, { t: 'moved' }); try { p.ws.close(4001, 'moved'); } catch (_) {} }
      attach(r, p, ws);
      return;
    }
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) return handleSpec(room, ws, msg);
  const me = playerOf(room, ws.playerId);
  if (!me || me.left) return;
  const isHost = room.hostId === me.id;
  const g = room.g;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'chat': chatText(room, me, msg); return;
    case 'react': {
      const e = msg.e | 0, now = Date.now();
      if (e < 0 || e >= 6 || now - me.lastReact < 700) return;
      me.lastReact = now;
      broadcast(room, { t: 'react', from: me.id, e });
      return;
    }
    case 'cfg':
      if (!isHost || room.phase !== 'lobby') return;
      setCfg(room, msg); pushState(room); return;
    case 'kick': {
      if (!isHost || room.phase !== 'lobby') return;
      const target = playerOf(room, msg.id);
      if (!target || target.id === room.hostId) return;
      if (target.ws) send(target.ws, { t: 'err', msg: '방장이 내보냈어요.', fatal: true });
      removePlayer(room, target.id);
      pushState(room); return;
    }
    case 'start':
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.filter(p => p.connected).length < MIN_PLAYERS) return send(ws, { t: 'err', msg: '세 명 이상 모여야 시작할 수 있어요.' });
      startGame(room); return;
    case 'leave':
      removePlayer(room, me.id);
      ws.roomCode = null; ws.playerId = null;
      send(ws, { t: 'left' });
      if (!room.players.some(p => !p.left)) dropRoom(room);
      else { if (room.phase !== 'lobby') sysChat(room, `${nm(room, me.id)}님이 나갔어요.`); pushState(room); }
      return;
  }

  if (room.phase === 'over' && msg.t === 'again' && isHost) {
    room.phase = 'lobby'; room.g = null;
    room.players = room.players.filter(p => !p.left);
    for (const p of room.players) { p.pts = 0; if (!p.connected) armLeave(room, p); }
    if (!playerOf(room, room.hostId)) pickHost(room);
    seatSpecs(room); pushState(room); listChanged();
    return;
  }
  if (room.phase !== 'playing' || !g) return;

  switch (msg.t) {
    case 'topic': {
      const k = msg.cat | 0;
      if (g.step !== 'topic' || k < 0 || k >= catsOf(room).length) return;
      g.topic.votes[me.id] = k;
      progress(room); pushState(room); return;
    }
    case 'ready': {
      if (!['check', 'reveal', 'discuss'].includes(g.step) || g.ready.includes(me.id)) return;
      if (g.step === 'discuss' && g.caught.includes(me.id)) return;
      g.ready.push(me.id);
      progress(room); pushState(room); return;
    }
    case 'desc': {
      if (g.step !== 'talk' || g.seq[g.turn] !== me.id) return;
      const text = clean(msg.text, 60);
      if (!text) return;
      g.descs.push({ id: me.id, text, lap: Math.floor(g.turn / g.order.length) });
      beginTalk(room, g.turn + 1);
      pushState(room); return;
    }
    case 'num': {
      const v = msg.n | 0;
      if (g.step !== 'answer' || v < 1 || v > 10) return;
      g.nums[g.qi][me.id] = v;
      progress(room); pushState(room); return;
    }
    case 'vote': {
      const to = msg.to | 0;
      if (g.step !== 'vote' || g.caught.includes(me.id) || to === me.id || g.caught.includes(to)) return;
      const t = playerOf(room, to);
      if (!t || (g.cands && !g.cands.includes(to))) return;
      g.votes[me.id] = to;
      progress(room); pushState(room); return;
    }
    case 'guess': {
      if (g.step !== 'guess' || g.accused !== me.id) return;
      submitGuess(room, me.id, clean(msg.text, 30)); return;
    }
    case 'skip':      // 방장: 기다리는 단계를 바로 넘긴다(누가 자리를 비웠을 때)
      if (!isHost || !['topic', 'check', 'talk', 'answer', 'reveal', 'discuss', 'vote'].includes(g.step)) return;
      onTimeout(room, g.step); return;
    case 'next':
      if (!isHost || g.step !== 'result') return;
      room.round++; startRound(room); return;
    case 'end':
      if (!isHost || g.step !== 'result') return;
      room.phase = 'over'; clearStep(room); pushState(room); listChanged(); return;
  }
}

function handleSpec(room, ws, msg) {
  const sp = specOf(room, ws);
  if (!sp) return;
  if (msg.t === 'chat') chatText(room, sp, msg, { spec: true });
  else if (msg.t === 'leave') {
    removeSpec(room, ws);
    ws.roomCode = null; ws.playerId = null;
    send(ws, { t: 'left' });
    pushState(room); listChanged();
  }
}

function armLeave(room, p) {
  clearTimeout(p.leaveT);
  p.leaveT = setTimeout(() => {
    if (p.connected || room.phase !== 'lobby' || rooms.get(room.code) !== room) return;
    removePlayer(room, p.id);
    if (!room.players.length) dropRoom(room); else pushState(room);
  }, MS.lobby);
}

function disconnect(ws, { keepSeat = false } = {}) {
  watchers.delete(ws);
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) { if (removeSpec(room, ws)) { pushState(room); listChanged(); } return; }
  const p = playerOf(room, ws.playerId);
  if (!p || p.ws !== ws) return;
  p.connected = false; p.ws = null;
  room.lastActive = Date.now();
  listChanged();
  if (room.hostId === p.id) {
    clearTimeout(room.timers.host);
    room.timers.host = setTimeout(() => {
      const h = playerOf(room, room.hostId);
      if (h && h.connected) return;
      const next = room.players.find(x => x.connected && !x.left);
      if (next) { room.hostId = next.id; pushState(room); }
    }, MS.lobby);
  }
  if (room.phase === 'lobby') { if (!keepSeat) armLeave(room, p); }
  else if (room.phase === 'playing') {
    // 잠깐 끊긴 건 기다려 준다 — 그래도 안 오면 그 사람을 빼고 진행
    clearTimeout(room.timers.dc);
    room.timers.dc = setTimeout(() => { if (rooms.get(room.code) === room) progress(room); }, MS.dc);
  }
  pushState(room);
}

/** 사람이 다 떠난 방을 치운다. 통신 쪽이 30초마다 부른다. */
function sweepRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    const humans = room.players.filter(p => p.connected).length;
    const seated = room.phase === 'playing';
    if (humans === 0 && now - room.lastActive > (seated ? 10 * 60_000 : 90_000)) dropRoom(room);
  }
}

function selfCheck() {
  if (!L.LIARC.length || !L.SPYC.length) throw new Error('단어 데이터가 비어 있어요');
  for (let i = 0; i < L.SPYC.length; i++) for (let d = 0; d < 3; d++) if (!L.spyCands(i, d, 1).length) throw new Error(`스파이 ${L.SPYC[i].name} 난이도 ${d} 후보 없음`);
  console.log(`  라이어 주제 ${L.LIARC.length}개 · 스파이 주제 ${L.SPYC.length}개 · ${MIN_PLAYERS}~${MAX_PLAYERS}인`);
}

module.exports = { rooms, handle, disconnect, sweepRooms, selfCheck, MAX_PLAYERS, MIN_PLAYERS, _test: { stateFor, norm } };
