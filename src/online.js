/* ═════════════════ 컴퓨터에서 해요 — 온라인 방 (서버: server/game.js) ═════════════════
   허브 표준(바퀴벌레 포커·로보77) 흐름: 이름 → 새 방 / 코드 / 열린 방 → 대기실 → 판.
   설명은 차례대로 입력해서 설명판에, 토론은 채팅으로, 투표는 비밀로, 잡힌 라이어는 정답을 입력. */

const WS_URL=(()=>{const q=new URLSearchParams(location.search).get('ws');if(q)return q;
 const h=location.hostname,same=/workers\.dev$/.test(h)||((h==='localhost'||h==='127.0.0.1')&&location.port!=='8796');
 return same?(location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws':'wss://liar.41ways.workers.dev/ws'})();
const ss={get(k){try{return sessionStorage.getItem('liar.'+k)}catch(e){return null}},set(k,v){try{sessionStorage.setItem('liar.'+k,v)}catch(e){}},del(k){try{sessionStorage.removeItem('liar.'+k)}catch(e){}}};
const O={ws:null,S:null,me:null,specId:null,skew:0,rooms:null,watching:false,entering:0,pingT:null,resting:false,
 unread:0,chatOn:false,name:store.get('oname',''),code:'',priv:false,cardOpen:false,descKey:'',descN:0,stepKey:'',dead:false};
Object.assign(IC,{
 monitor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4" stroke-linecap="round"/></svg>',
 chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1h-9l-5 4v-4H4a1 1 0 01-1-1V6a1 1 0 011-1z"/></svg>',
 send:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5l18-8.5L3 3.5l2.6 7.2L14 12l-8.4 1.3z"/></svg>',
 link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.2 1.2M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.2-1.2"/></svg>',
 crown:'<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#ffc928" stroke="#1b1038" stroke-width="2" stroke-linejoin="round"/></svg>',
});
const isOn=()=>scr[0]==='o'&&scr!=='oset';
const oS=()=>O.S,oG=()=>O.S&&O.S.g;
const oP=id=>O.S?O.S.players.find(p=>p.id===id):null;
const oName=id=>{const p=oP(id);return p?(p.id===O.me?'나':p.name):'?'};
const oSpec=()=>!!O.S&&O.S.role==='spec';
const oRole=()=>MODES[O.S.cfg.mode].role;
const oLeft=()=>{const g=oG();return g&&g.endsAt?Math.max(0,Math.ceil((g.endsAt-(Date.now()+O.skew))/1000)):null};
const mmss=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');

/* ── 접속 ── */
function oConnect(onOpen){
 if(O.ws&&O.ws.readyState===1){onOpen&&onOpen();return}
 if(O.ws){O.ws.onopen=O.ws.onmessage=O.ws.onclose=null;try{O.ws.close()}catch(e){}}
 let sock;try{sock=O.ws=new WebSocket(WS_URL)}catch(e){toast('서버에 붙지 못했어요');return}
 sock.onopen=()=>{if(sock!==O.ws)return;clearInterval(O.pingT);O.pingT=setInterval(()=>oSend({t:'ping'}),25000);onOpen&&onOpen()};
 sock.onmessage=e=>{if(sock!==O.ws)return;let m;try{m=JSON.parse(e.data)}catch(_){return}
  if(m.t==='moved'||m.t==='idle'){sock.why=m.t;O.ws=null;try{sock.close()}catch(_){}oRest(m.t==='moved'?'다른 창에서 이 자리를 이어받았어요. 여기서 계속하려면 아무 곳이나 누르세요.':'한동안 조작이 없어 연결을 쉬고 있어요. 아무 곳이나 누르면 다시 붙어요.');return}
  oHandle(m)};
 sock.onclose=()=>{if(sock!==O.ws)return;clearInterval(O.pingT);O.ws=null;
  if(ss.get('code')&&ss.get('token')){toast('연결이 끊겼어요. 다시 붙는 중…');setTimeout(oResume,1500)}
  else if(O.watching)setTimeout(()=>{if(O.watching&&!O.ws)oWatch(true)},3000)};
 sock.onerror=()=>{if(scr==='oset'&&!O.S)toast('온라인 서버에 연결하지 못했어요. 인터넷을 확인해 주세요.')};
}
const oSend=o=>{if(O.ws&&O.ws.readyState===1)O.ws.send(JSON.stringify(o))};
function oRest(msg){O.resting=true;toast(msg)}
function oWake(){if(!O.resting)return;O.resting=false;if(ss.get('code'))oResume();else if(O.watching)oWatch(true)}
['pointerdown','keydown'].forEach(t=>addEventListener(t,oWake,true));
function oResume(){const code=ss.get('code'),token=ss.get('token');if(code&&token)oConnect(()=>oSend({t:'resume',code,token}))}
function oWatch(on){O.watching=on;if(on)oConnect(()=>{if(O.watching&&!ss.get('code'))oSend({t:'rooms'})});else oSend({t:'unwatch'})}

function oHandle(m){
 switch(m.t){
  case 'welcome':
   O.entering=0;
   if(m.role==='spec'){O.me=null;O.specId=m.specId;ss.del('code');ss.del('token')}
   else{O.me=m.you;O.specId=null;ss.set('code',m.code);ss.set('token',m.token)}
   O.watching=false;
   try{history.replaceState({liar:1},'',location.pathname+'?r='+m.code)}catch(e){}
   if(m.seated)toast('자리가 났어요 — 이제 같이 해요');
   break;
  case 'rooms':O.rooms=m.list;if(scr==='oset'){const el=document.getElementById('oRooms');if(el){el.innerHTML=oRoomsHTML();document.getElementById('oRoomN').textContent=oRoomCount()}}break;
  case 'chat':addChat(m);break;
  case 'react':break;
  case 'state':{
   const prev=O.S;O.S=m;if(m.now)O.skew=m.now-Date.now();
   O.me=m.role==='spec'?null:(m.you!=null?m.you:O.me);
   oFollow(prev,m);
   const want=m.phase==='lobby'?'olobby':m.phase==='over'?'oover':'ogame';
   const key=want+'|'+m.round+'|'+(m.g?m.g.step+'|'+m.g.qi+'|'+m.g.voteRound+'|'+m.g.caught.length:'');
   const fresh=scr!==want||key!==O.stepKey;
   if(fresh&&m.g&&m.g.step==='check'&&(!prev||!prev.g||prev.round!==m.round||prev.phase!=='playing'))O.cardOpen=false;
   O.stepKey=key;
   if(!fresh&&scr==='ogame'&&m.g&&m.g.step==='spin'){chatSync();break}   // 룰렛이 도는 중엔 다시 그리지 않는다
   scr=want;render(fresh);
   break}
  case 'err':
   O.entering=0;toast(m.msg);
   if(m.fatal){ss.del('code');ss.del('token');O.S=null;goOnline()}
   break;
  case 'left':ss.del('code');ss.del('token');O.S=null;chatReset();break;
 }
}
/** 설명·단계 변화를 채팅 흐름에도 남긴다 — 컴퓨터로 할 때 한 줄로 읽히게 */
function oFollow(prev,m){
 const g=m.g;if(!g)return;
 const k=m.round+':'+m.code;
 if(O.descKey!==k){O.descKey=k;O.descN=0}
 while(g.descs&&O.descN<g.descs.length){const d=g.descs[O.descN++];addChat({desc:true,from:d.id,name:(oP(d.id)||{}).name||'?',text:d.text||(d.timeout?'(시간 초과)':'(자리 비움)')})}
 const ps=prev&&prev.g;
 if(!ps||ps.step!==g.step||prev.round!==m.round){
  const say={topic:`라운드 ${m.round+1} · 주제 투표! 하고 싶은 주제를 하나 찍어요.`,check:`라운드 ${m.round+1} · 주제 ${g.cat}`,talk:'설명 차례 시작! 차례인 사람이 한 마디씩 입력해요.',discuss:'토론 시간! 채팅으로 이야기하고 준비되면 「지목하자」.',vote:g.voteRound===2?'동점! 동점자 중에서 다시 지목해요.':'비밀 투표! 라이어라고 생각하는 사람을 누르세요.',answer:g.qs?`질문 ${g.qi+1}: ${g.qs[g.qi]&&g.qs[g.qi].t} — 1~10을 몰래 내요.`:'',reveal:'숫자 공개!'}[g.step];
  if(say&&m.phase==='playing')addChat({sys:true,text:say});
  if(g.step==='talk'||g.step==='answer'||g.step==='guess'||g.step==='topic')sfx.reveal();
  if(g.step==='accuse')sfx.drum();
  if(g.step==='result'){if(g.win==='c'){sfx.win();confetti(60)}else sfx.lose()}
 }
 if(g.step==='talk'&&g.seq&&g.seq[g.turn]===O.me&&(!ps||ps.turn!==g.turn||ps.step!=='talk'))toast('내 차례예요! 제시어를 한 마디로 설명해 주세요');
}

/* ── 채팅 (오른쪽 칸 · 좁은 화면은 💬 버튼) ── */
const wide=()=>matchMedia('(min-width:900px)').matches;
function chatSync(){
 const on=isOn(),el=document.getElementById('chat'),fab=document.getElementById('chatFab');
 document.body.classList.toggle('online',on);
 if(!on){el.hidden=true;fab.hidden=true;return}
 const show=wide()||O.chatOn;el.hidden=!show;fab.hidden=wide()||O.chatOn;
 if(show){O.unread=0}
 const n=document.getElementById('chatN');n.textContent=O.unread>99?'99+':O.unread;n.hidden=!O.unread;
 document.getElementById('chatWho').textContent=O.S?`${O.S.players.filter(p=>!p.left).length}명${O.S.specs.length?` · 관전 ${O.S.specs.length}`:''}`:'';
}
function chatOpen(on){O.chatOn=on;chatSync();if(on){const l=document.getElementById('chatLog');l.scrollTop=l.scrollHeight;setTimeout(()=>document.getElementById('chatText').focus(),30)}}
function chatReset(){document.getElementById('chatLog').innerHTML='';O.unread=0;O.descN=0;O.descKey=''}
function addChat(m){
 const log=document.getElementById('chatLog');if(!log)return;
 const d=document.createElement('div');
 if(m.sys){d.className='cm sys';d.textContent=m.text}
 else{const p=oP(m.from),mine=m.from!=null&&(m.from===O.me||m.from===O.specId)&&!m.desc;
  d.className='cm'+(mine?' mine':'')+(m.desc?' desc':'')+(m.spec?' spec':'');
  const col=p?COLORS[p.av%COLORS.length]:'#9a8fc4';
  d.innerHTML=`<i style="background:${col}"></i><b>${esc(m.desc?'📢 '+m.name+'의 설명':m.spec?m.name+' (관전)':m.name)}</b><span>${esc(m.text)}</span>`}
 log.appendChild(d);while(log.children.length>150)log.removeChild(log.firstChild);
 log.scrollTop=log.scrollHeight;
 if(!m.sys&&!m.desc&&m.from!==O.me){if(!wide()&&!O.chatOn){O.unread++;chatSync()}sfx.pick()}
}
function chatSend(e){e.preventDefault();const box=document.getElementById('chatText');const t=box.value.trim();if(!t)return;oSend({t:'chat',text:t});box.value=''}
addEventListener('resize',()=>{if(isOn())chatSync()});

/* ── 진입 ── */
function goOnline(){chatReset();go('oset');oWatch(true)}
function oNameOk(){const n=(O.name||'').trim();if(!n){toast('이름을 먼저 적어 주세요');const el=document.getElementById('oName');if(el)el.focus();return null}return n.slice(0,12)}
function oEnter(msg){if(Date.now()-O.entering<4000)return;O.entering=Date.now();ss.del('code');ss.del('token');chatReset();oConnect(()=>oSend(msg))}
function oCreate(){const n=oNameOk();if(n)oEnter({t:'create',name:n,priv:!!O.priv})}
function oJoin(code){code=(code||O.code||'').toUpperCase();if(code.length!==4)return toast('네 글자 방 코드를 넣어 주세요');const n=oNameOk();if(n)oEnter({t:'join',code,name:n})}
function oLeave(ask){
 if(ask&&O.S&&O.S.phase==='playing'&&!oSpec()&&!confirm('정말 나갈까요? 이번 판에서 빠지게 돼요.'))return;
 oSend({t:'leave'});ss.del('code');ss.del('token');O.S=null;O.me=null;chatReset();
 try{history.replaceState({liar:1},'',location.pathname)}catch(e){}
 goOnline();
}
function oRoomCount(){const l=O.rooms||[];const n=l.filter(r=>r.state==='wait'&&!r.priv).length;return l.length?`· 들어갈 수 있는 방 ${n}곳`:''}
function oRoomsHTML(){
 const l=O.rooms;if(!l)return'<li class="rempty">불러오는 중…</li>';
 if(!l.length)return'<li class="rempty">지금 열린 방이 없어요. 새 방을 만들어 친구를 불러 보세요!</li>';
 const lab={wait:'자리 있음',full:'가득 참',playing:'게임 중'};
 return l.map(r=>{const can=!r.priv&&(r.state==='wait'||r.spec!==false),spec=r.state!=='wait';
  return`<li><button class="rrow" ${can?`onclick="oJoin('${esc(r.code)}')"`:'disabled'}><span class="rav">${avatar(r.av||0)}</span><span class="rmain"><b>${esc(r.host||'이름 없음')}의 방</b><small><span class="mtag m-${r.mode}">${MODES[r.mode].short}</span>${r.priv?'비공개':esc(r.code)} · ${r.n}/${r.max}명${r.watching?` · 관전 ${r.watching}`:''}</small></span><span class="rst ${r.state}">${r.priv?lab[r.state]:spec&&r.spec!==false?'관전하기':lab[r.state]}</span></button></li>`}).join('');
}

/* ── 방 고르기 ── */
SCREENS.oset=()=>`
 ${hud('<span class="hudtitle ol-s">컴퓨터에서 해요</span>',`<button class="ibtn" onclick="oWatch(false);go('title')">${IC.back}</button>`)}
 <section class="panel first"><div class="ptab">내 이름</div>
  <input id="oName" class="finput" maxlength="12" placeholder="채팅에 보일 이름" value="${esc(O.name)}" oninput="O.name=this.value;store.set('oname',this.value)" onkeydown="if(event.key==='Enter')oCreate()">
 </section>
 <section class="panel"><div class="ptab acc">새 방 만들기</div>
  <p class="sub">방을 만들고 코드나 초대 링크를 친구들에게 보내세요. 3~12명.</p>
  <label class="chk"><input type="checkbox" ${O.priv?'checked':''} onchange="O.priv=this.checked"><span>비공개 방 <small>열린 방 목록에 코드를 숨겨요</small></span></label>
  <button class="btn yel" onclick="oCreate()">${IC.plus}<span class="lbl">방 만들기</span></button>
 </section>
 <section class="panel"><div class="ptab">코드로 들어가기</div>
  <div class="row" style="align-items:center"><input id="oCode" class="finput code4" maxlength="4" placeholder="ABCD" autocapitalize="characters" autocomplete="off" value="${esc(O.code)}" oninput="O.code=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');this.value=O.code" onkeydown="if(event.key==='Enter')oJoin()"><button class="btn sm" style="margin:0;flex:0 0 112px" onclick="oJoin()"><span class="lbl">들어가기</span></button></div>
 </section>
 <section class="panel"><div class="ptab">열린 방 <span id="oRoomN">${oRoomCount()}</span></div><ul class="rooms" id="oRooms">${oRoomsHTML()}</ul></section>
 <p class="hint center" style="color:#cfc4f7">각자 컴퓨터나 폰 브라우저로 접속해요. 제시어 설명은 차례대로 입력하고, 토론은 채팅으로!</p>`;

/* ── 대기실 ── */
function oseg(key,list,host){const c=O.S.cfg;return`<div class="mseg">${list.map(([v,label,dis])=>`<button class="${c[key]===v?'on':''}" ${dis||!host?'disabled':''} onclick='oCfg(${JSON.stringify({[key]:v})})'>${label}</button>`).join('')}</div>`}
function oCfg(o){oSend(Object.assign({t:'cfg'},o));sfx.pick()}
SCREENS.olobby=()=>{
 const s=O.S,c=s.cfg,spec=oSpec(),host=!spec&&s.hostId===O.me,lm=c.mode==='liar',sp=c.mode==='spy',R=MODES[c.mode].role;
 const cats=sp?SPYC:LIARC.concat(c.custom?[{name:c.custom.name,icon:'envelope',w:[]}]:[]);
 const live=s.players.filter(p=>p.connected).length,mx=s.maxLiars;
 const link=`${location.origin}${location.pathname}?r=${s.code}`;
 let h=`${hud(`<span class="pill">방 <i>${s.code}</i></span>`,`<button class="ibtn" onclick="oLeave()" aria-label="나가기">${IC.back}</button>`)}
 <section class="panel first"><div class="ptab acc">친구 부르기</div>
  <div class="otp o4">${[...s.code].map(ch=>`<i>${ch}</i>`).join('')}</div>
  <div class="row"><button class="btn sm paper" onclick="copyText('${link}','초대 링크를 복사했어요')">${IC.link}<span>초대 링크 복사</span></button><button class="btn sm paper" onclick="copyText('${s.code}','방 코드를 복사했어요')">${IC.copy}<span>코드 복사</span></button></div>
  <p class="hint">링크를 열거나, <b>컴퓨터에서 해요 → 코드로 들어가기</b>에 코드를 넣으면 들어와요.</p></section>
 <section class="panel"><div class="ptab">참가자 ${s.players.length} / ${s.max}${s.specs.length?` · 관전 ${s.specs.length}`:''}</div>
  <div class="seats">${s.players.map(p=>`<div class="seat ${p.id===O.me?'me':''} ${p.connected?'':'off'}">${avatar(p.av)}<b>${esc(p.name)}</b><span class="bd">${p.id===s.hostId?'<em class="h">방장</em>':''}${p.id===O.me?'<em>나</em>':''}${!p.connected?'<em class="x">끊김</em>':''}</span>${host&&p.id!==s.hostId?`<button class="kick" onclick="oSend({t:'kick',id:${p.id}})" aria-label="내보내기">${IC.x}</button>`:''}</div>`).join('')}</div>
  <p class="hint">${live<3?`<b>3명부터</b> 시작할 수 있어요. 지금 ${live}명.`:`${live}명 모였어요!`}${spec?' · 지금은 관전 중이에요. 다음 판에 빈자리가 나면 앉아요.':''}</p></section>
 <section class="panel"><div class="ptab">게임 모드${host?'':' · 방장이 정해요'}</div>
  <div class="modegrid">${MODE_KEYS.map(k=>`<div class="mcard ${c.mode===k?'on':''}" style="--c:${MODES[k].c}" ${host?`onclick="oCfg({mode:'${k}'})"`:''}><span class="chk">${IC.chk}</span>${emblem[k]()}<b class="ol-s">${MODES[k].short}</b></div>`).join('')}</div>
  <div class="mdesc"><b>${MODES[c.mode].name}</b>${MODES[c.mode].desc}</div></section>
 <section class="panel"><div class="ptab">주제</div>
  <div class="tiles">${host||c.cat===VOTE?`<button class="tile ${c.cat===VOTE?'on':''}" ${host?`onclick="oCfg({cat:VOTE})"`:'disabled'}><span class="ti dice">${IC.vote}</span><span>다 같이 투표</span></button>`:''}${host||c.cat===RANDOM?`<button class="tile ${c.cat===RANDOM?'on':''}" ${host?`onclick="oCfg({cat:RANDOM})"`:'disabled'}><span class="ti dice">${IC.dice}</span><span>랜덤</span></button>`:''}${cats.map((x,i)=>host||c.cat===i?`<button class="tile ${c.cat===i?'on':''} ${i>=LIARC.length&&!sp?'my':''}" ${host?`onclick="oCfg({cat:${i}})"`:'disabled'}>${ico(x.icon,'ti')}<span>${esc(x.name)}</span></button>`:'').join('')}</div>
  ${c.cat===VOTE?'<p class="hint"><b>다 같이 투표</b> · 라운드마다 각자 주제를 하나 찍고, 표 수만큼 칸이 큰 룰렛으로 뽑아요. (3표·1표·1표면 3:1:1)</p>':''}
  ${host&&!sp&&CUSTOM.length?`<p class="hint">이 기기에 저장된 내 주제를 방에 올릴 수 있어요: ${CUSTOM.map((x,i)=>`<button class="chip2" onclick='oCfg({custom:${JSON.stringify({name:x.name,w:x.w})}})'>${ico('envelope')}${esc(x.name)}</button>`).join(' ')}${c.custom?` <button class="chip2" onclick="oCfg({custom:null})">${IC.x}내 주제 빼기</button>`:''}</p>`:''}</section>
 ${sp?`<section class="panel"><div class="ptab">난이도</div><div class="seg">${DIFFS.map((d,i)=>`<button class="${c.diff===i?'on':''}" ${host?`onclick="oCfg({diff:${i}})"`:'disabled'}><span class="gauge">${[0,1,2].map(k=>`<i class="${k<=i?'f':''}" style="height:${6+k*5}px"></i>`).join('')}</span>${d.name}</button>`).join('')}</div><p class="hint"><b>간극 ${DIFFS[c.diff].gap[0]}~${DIFFS[c.diff].gap[1]}</b> · ${DIFFS[c.diff].desc}</p></section>`:''}
 <section class="panel"><div class="ptab">규칙 옵션</div><div class="opts">
  <div class="opt"><span><b>${R} 수</b><small>${mx>1?`지금 인원이면 최대 ${mx}명`:'인원이 늘면 늘릴 수 있어요'}</small></span>${oseg('liars',[[1,'1명'],[2,'2명',mx<2],[3,'3명',mx<3]],host)}</div>
  ${lm?`<div class="opt"><span><b>공범</b><small>제시어를 아는 라이어 편 · 5명부터</small></span>${oseg('acc',[[false,'없음'],[true,'있음']],host)}</div>
  <div class="opt"><span><b>라이어 힌트</b><small>제시어 글자 수</small></span>${oseg('hint',[[false,'끄기'],[true,'켜기']],host)}</div>`:''}
  ${!sp?`<div class="opt"><span><b>라운드 미션</b><small>설명 방식이 매번 바뀜</small></span>${oseg('mission',[[false,'끄기'],[true,'켜기']],host)}</div>
  <div class="opt"><span><b>설명 바퀴</b><small>한 사람이 몇 번 설명하나</small></span>${oseg('laps',[[1,'1바퀴'],[2,'2바퀴']],host)}</div>`:''}
  <div class="opt"><span><b>${sp?'숫자 내는':'설명'} 시간</b><small>한 사람 차례</small></span>${oseg('talkSec',[[30,'30초'],[45,'45초'],[60,'60초'],[0,'무제한']],host)}</div>
  <div class="opt"><span><b>토론 시간</b><small>채팅으로 토론</small></span>${oseg('discussSec',[[60,'1분'],[120,'2분'],[180,'3분'],[300,'5분']],host)}</div>
  <div class="opt"><span><b>벌칙</b><small>진 쪽에게 랜덤 벌칙</small></span>${oseg('penalty',[[false,'끄기'],[true,'켜기']],host)}</div>
  <div class="opt"><span><b>방 공개</b><small>열린 방 목록에 코드 보이기</small></span>${oseg('priv',[[false,'공개'],[true,'비공개']],host)}</div>
  <div class="opt"><span><b>관전</b><small>시작한 뒤 들어온 사람</small></span>${oseg('spec',[[true,'허용'],[false,'막기']],host)}</div>
 </div></section>
 <div class="dock"><div>${host?`<button class="btn" ${live<3?'disabled':''} onclick="oSend({t:'start'});ac()"><span class="lbl">${live<3?`${3-live}명 더 모이면 시작`:'게임 시작'}</span></button>`:`<button class="btn dark" disabled><span class="lbl">방장이 시작하기를 기다리는 중</span></button>`}</div></div>`;
 return h;
};
function copyText(t,msg){try{navigator.clipboard.writeText(t).then(()=>toast(msg),()=>toast(t))}catch(e){toast(t)}}

/* ── 판 ── */
/** 카드 확인 뒤에는 한 줄로 접어 둔다 — 눌러야 보인다(화면 공유 대비) */
function ocardMini(){
 const g=oG();if(!g||!g.my)return'';const my=g.my;
 const txt=my.role==='liar'?`나는 <b style="color:var(--red)">라이어</b> · 주제 ${esc(g.cat)}${my.hint?` · 힌트 ${my.hint}글자`:''}`:my.role==='acc'?`나는 <b style="color:#7a3cff">공범</b> · 제시어 <b>${esc(my.word)}</b>`:`내 제시어 <b>${esc(my.word)}</b>`;
 return`<button class="mycard ${O.cardOpen?'on':''}" onclick="O.cardOpen=!O.cardOpen;render();sfx.flip()">${O.cardOpen?IC.eye:IC.lock}<span>${O.cardOpen?txt:'내 카드 · 눌러서 보기'}</span></button>`;
}
function ocard(){
 const g=oG();if(!g||!g.my)return'';
 const my=g.my,k=g.liarsN;
 let back;
 if(my.role==='liar')back=`<div class="face back liar"><span class="catTag">주제 · ${esc(g.cat)}</span><div class="liarT ol-s" style="color:#fff;margin-top:6px">당신은 <span style="color:var(--red)">라이어</span></div><p class="note">${my.hint?`<b class="hintb">힌트: 제시어는 ${my.hint}글자</b><br>`:''}제시어를 모릅니다. 들키지 말고 알아내세요.${k>1?` 라이어는 ${k}명.`:''}</p></div>`;
 else if(my.role==='acc')back=`<div class="face back acc"><span class="catTag">주제 · ${esc(g.cat)}</span><div class="liarT ol-s" style="color:#fff;margin-top:6px">당신은 <span style="color:var(--pur2)">공범</span></div><div class="secret sm">${esc(my.word)}</div><p class="note">라이어 편. 라이어가 이기면 함께 이겨요.</p></div>`;
 else back=`<div class="face back"><span class="stamp">기밀</span>${ico(g.icon,'cardi')}<span class="catTag">주제 · ${esc(g.cat)}</span><div class="secret ${letters(my.word)>6?'long':''} ${letters(my.word)>10?'xl':''}">${esc(my.word)}</div><p class="note">${O.S.cfg.mode==='liar'?`라이어${k>1?' '+k+'명은':'는'} 이 단어를 몰라요`:`${k>1?k+'명':'한 명'}은 다른 단어예요. 나일 수도…?`}</p></div>`;
 return`<div class="flip short ${O.cardOpen?'on':''}" id="ocard" onclick="O.cardOpen=!O.cardOpen;this.classList.toggle('on',O.cardOpen);sfx.flip()"><div class="in">
 <div class="face front ${O.cardOpen?'':'tapme'}"><span class="ts">TOP SECRET</span><div class="seal">${IC.lock}</div><h3>눌러서 내 카드 보기</h3><p>화면 공유 중이면 조심!</p><div class="lines"><i></i><i></i></div></div>${back}</div></div>`;
}
function ostatus(p){
 const g=oG(),s=g.step;
 if(p.left)return['나감','x'];if(!p.connected)return['끊김','x'];
 if(s==='topic')return g.voted.includes(p.id)?['찍음','ok']:['고르는 중',''];
 if(s==='spin')return['',''];
 if(g.caught.includes(p.id))return['검거','r'];
 if(s==='check')return g.ready.includes(p.id)?['준비','ok']:['확인 중',''];
 if(s==='talk')return g.seq[g.turn]===p.id?['설명 중','now']:g.descs.some(d=>d.id===p.id&&d.lap===Math.floor(g.turn/g.order.length))?['말함','ok']:['',''];
 if(s==='answer')return g.answered[g.qi].includes(p.id)?['냄','ok']:['고르는 중',''];
 if(s==='reveal'||s==='discuss')return g.ready.includes(p.id)?['준비','ok']:['',''];
 if(s==='vote')return g.voted.includes(p.id)?['투표함','ok']:['고르는 중',''];
 if(s==='accuse'||s==='guess')return g.accused===p.id?['지목됨','r']:['',''];
 return['',''];
}
function ostrip(){
 const s=O.S,g=s.g,done=g.step==='result';
 return`<div class="ostrip">${(g.order&&g.order.length?g.order.map(oP):s.players).filter(Boolean).map(p=>{const[t,c]=ostatus(p),liar=done&&g.answer&&g.answer.liars.includes(p.id);
  return`<div class="os ${p.id===O.me?'me':''} ${c}">${p.id===s.hostId?`<span class="cr">${IC.crown}</span>`:''}${avatar(p.av,liar?{d:true,hat:false}:{})}<b>${esc(p.id===O.me?'나':p.name)}</b>${t?`<small>${t}</small>`:''}<span class="pt">${p.pts}점</span></div>`}).join('')}</div>`;
}
function oboard(){
 const g=oG(),laps=Math.max(1,Math.ceil(g.seq.length/Math.max(1,g.order.length)));
 if(!g.seq.length)return'';
 let h='<div class="board2">';
 for(let lap=0;lap<laps;lap++){
  const ds=g.descs.filter(d=>d.lap===lap);
  if(lap>0&&(ds.length||g.turn>=lap*g.order.length))h+='<div class="lapl">두 번째 바퀴</div>';
  h+=ds.map(d=>{const p=oP(d.id)||{av:0,name:'?'};return`<div class="drow ${d.id===O.me?'me':''}">${avatar(p.av)}<div><b>${esc(oName(d.id))}</b><span class="${d.text?'':'mut'}">${esc(d.text||(d.timeout?'(시간 초과)':'(자리 비움)'))}</span></div></div>`}).join('');
 }
 if(g.step==='talk'){const id=g.seq[g.turn],p=oP(id)||{av:0};h+=`<div class="drow typing">${avatar(p.av,{sweat:true})}<div><b>${esc(oName(id))}</b><span class="dots"><span>●</span><span>●</span><span>●</span></span></div></div>`}
 return h+'</div>';
}
function oplot(qi,reveal){
 const g=oG(),m=g.nums[qi]||{},q=g.qs[qi];
 const cols=Array.from({length:10},(_,v)=>`<div class="col">${Object.entries(m).filter(([,x])=>x===v+1).map(([id])=>{const p=oP(+id)||{av:0};const l=reveal&&g.answer&&g.answer.liars.includes(+id);return avatar(p.av,{d:l,hat:!l})}).join('')}</div>`).join('');
 const exp=reveal&&q.a?`<div class="exp">${Array.from({length:10},(_,v)=>`<span class="${q.a===v+1?'a':q.b===v+1?'b':''}">${q.a===v+1?esc(g.answer.word):q.b===v+1?esc(g.answer.lw):''}</span>`).join('')}</div>`:'';
 return`<div class="plot"><div class="cols">${cols}</div><div class="axis">${Array.from({length:10},(_,v)=>`<span>${v+1}</span>`).join('')}</div>${exp}</div>`;
}
function oqcard(qi,body){const q=oG().qs[qi];return`<section class="panel"><div class="ptab acc">질문 ${qi+1} / ${oG().qs.length}</div><div class="qtext">${esc(q.t)}</div><div class="s10">${scaleColors.map((c,i)=>`<i style="background:${c}">${i+1}</i>`).join('')}</div><div class="slbl"><span>1 · ${esc(q.lo)}</span><span>${esc(q.hi)} · 10</span></div>${body||''}</section>`}
const oHostSkip=label=>O.S.hostId===O.me?`<button class="skip" onclick="if(confirm('기다리지 않고 바로 넘길까요?'))oSend({t:'skip'})">${label||'방장: 건너뛰기'}</button>`:'';
function oform(id,ph,fn,max){return`<form class="dform" onsubmit="event.preventDefault();${fn}()"><input id="${id}" maxlength="${max}" placeholder="${ph}" autocomplete="off" enterkeyhint="send"><button class="btn" aria-label="보내기">${IC.send}</button></form>`}
function oSendDesc(){const el=document.getElementById('oDesc');const t=el.value.trim();if(!t)return toast('설명을 적어 주세요');oSend({t:'desc',text:t});el.value=''}
function oSendGuess(){const el=document.getElementById('oGuess');const t=el.value.trim();if(!t)return toast('정답을 적어 주세요');if(!confirm(`"${t}"(으)로 낼까요? 기회는 한 번!`))return;oSend({t:'guess',text:t})}

function ocats(){const c=O.S.cfg;return c.mode==='spy'?SPYC:LIARC.concat(c.custom?[{name:c.custom.name,icon:'envelope',w:[]}]:[])}
function otopic(){
 const s=O.S,g=s.g,spec=oSpec(),left=oLeft(),cats=ocats(),need=s.players.filter(p=>p.connected&&!p.left).length;
 let h=hud(`<span class="pill">ROUND <i>${s.round+1}</i></span>${left!=null&&g.step==='topic'?` <span class="pill tm" data-ends>${mmss(left)}</span>`:''}`,`<button class="ibtn" onclick="oLeave(true)" aria-label="나가기">${IC.home}</button>`);
 h+=ostrip();
 if(g.step==='topic'){
  h+=`<section class="panel"><div class="ptab acc">${ico('megaphone')}주제 투표</div><p style="font-weight:700">하고 싶은 주제를 하나 찍어요. 표 수만큼 룰렛 칸이 커져요!</p><p class="sub">${g.voted.length} / ${need}명 찍음 · 바꿀 수 있어요 ${oHostSkip()}</p>
  <div class="tiles" style="margin-top:12px">${cats.map((x,i)=>`<button class="tile vt ${g.myTopic===i?'on':''}" ${spec?'disabled':`onclick="oSend({t:'topic',cat:${i}});sfx.pick()"`}>${ico(x.icon,'ti')}<span>${esc(x.name)}</span>${g.tally[i]?`<em class="vc">${g.tally[i]}</em>`:''}${g.myTopic===i?'<em class="vme">내 표</em>':''}</button>`).join('')}</div></section>`;
 }else{
  const segs=wheelSegs(g.counts||[],cats),tot=(g.counts||[]).reduce((a,x)=>a+x[1],0);
  h+=`<div class="intro">${wheelHTML(segs)}<div class="catname disp ol" id="wheelName">두구두구</div>
  <p class="introline">${(g.counts||[]).length===cats.length&&tot===cats.length?'아무도 안 찍어서 모든 주제가 같은 칸':(g.counts||[]).map(([k,n])=>`${esc((cats[k]||{}).name)} ${n}표`).join(' · ')}</p></div>`;
 }
 return h;
}
/** 화면을 그린 뒤 — 룰렛은 한 번만 돌린다(그 사이 다른 갱신이 와도 다시 돌리지 않게) */
function oAfter(fresh){
 if(scr!=='ogame'||!O.S||!O.S.g||O.S.g.step!=='spin')return;
 const g=O.S.g,cats=ocats(),segs=wheelSegs(g.counts||[],cats);wheelHTML(segs);
 const key=O.S.code+':'+O.S.round,seed=O.S.round*31+7;
 if(O.spinKey===key){wheelSpin(segs,g.pick,0,seed);const n=document.getElementById('wheelName');if(n&&O.spinDone)n.textContent=(cats[g.pick]||{}).name;return}
 O.spinKey=key;O.spinDone=false;wheelSpin(segs,g.pick,3700,seed);
 setTimeout(()=>{O.spinDone=true;const n=document.getElementById('wheelName');if(n&&O.S&&O.S.g&&O.S.g.step==='spin')n.textContent=(cats[g.pick]||{}).name;sfx.reveal()},3800);
}
SCREENS.ogame=()=>{
 const s=O.S,g=s.g,c=s.cfg,me=O.me,spec=oSpec(),left=oLeft(),R=MODES[c.mode].role;
 if(g.step==='topic'||g.step==='spin')return otopic();
 const caughtMe=g.caught.includes(me),need=s.players.filter(p=>p.connected&&!p.left).length;
 let h=hud(`<span class="pill">ROUND <i>${s.round+1}</i></span>${left!=null?` <span class="pill tm" data-ends>${mmss(left)}</span>`:''}`,`<button class="ibtn" onclick="oLeave(true)" aria-label="나가기">${IC.home}</button>`);
 h+=`<div class="ohead">${ico(g.icon,'ohi')}<div><b class="disp">${esc(g.cat)}</b><small>${MODES[c.mode].name}${g.liarsN>1?` · ${R} ${g.liarsN}명`:''}${g.accOn?' · 공범 있음':''}</small></div></div>`;
 if(g.mission&&c.mode!=='spy')h+=`<div class="mchip">${ico('megaphone')}<div><b>미션 · ${g.mission[0]}</b>${g.mission[1]}</div></div>`;
 if(spec)h+=`<p class="why">관전 중이에요. 제시어는 결과 때 공개돼요.</p>`;
 else if(g.step==='check')h+=ocard();
 else if(g.step!=='result')h+=ocardMini();
 h+=ostrip();
 let dock='';
 const st=g.step;
 if(st==='check'){
  h+=`<section class="panel"><div class="ptab acc">카드 확인</div><p style="font-weight:700">위의 카드를 눌러 ${c.mode==='liar'?'제시어(또는 라이어인지)':'제시어'}를 확인하고 <b>준비</b>를 눌러요.</p><p class="sub">준비 ${g.ready.length} / ${need}명 ${oHostSkip()}</p></section>`;
  dock=spec?'':g.ready.includes(me)?`<button class="btn dark" disabled><span class="lbl">준비 완료 · 다른 사람 기다리는 중</span></button>`:`<button class="btn yel" onclick="oSend({t:'ready'})">${IC.chk}<span class="lbl">확인했어요 · 준비</span></button>`;
 }else if(st==='talk'||st==='discuss'){
  const myTurn=st==='talk'&&g.seq[g.turn]===me;
  h+=`<section class="panel"><div class="ptab">설명판 · ${g.rev?'반대 방향':'순서대로'}</div>${oboard()}${st==='talk'?`<p class="sub">${myTurn?'<b style="color:var(--red-d)">내 차례!</b> 아래에 한 마디로 설명하세요.':`${esc(oName(g.seq[g.turn]))} 차례예요.`} ${oHostSkip()}</p>`:''}</section>`;
  if(st==='talk')dock=myTurn?oform('oDesc','제시어를 한 마디로 설명 (Enter)','oSendDesc',60):'';
 }
 if(st==='answer'||st==='reveal'||(c.mode==='spy'&&['vote','accuse','guess'].includes(st))){
  const qi=st==='answer'||st==='reveal'?g.qi:g.qs.length-1;
  if(st==='answer'){const mine=g.nums[qi]&&g.nums[qi][me];
   h+=oqcard(qi,`${spec?'':`<div class="pad">${Array.from({length:10},(_,k)=>`<button class="${mine===k+1?'on':''}" style="${mine===k+1?'':`background:${scaleColors[k]}`}" onclick="oSend({t:'num',n:${k+1}});sfx.pick()">${k+1}</button>`).join('')}</div>`}<p class="sub" style="margin-top:10px">${mine?`<b>${mine}</b>을(를) 냈어요 · 공개 전까지 바꿀 수 있어요. `:'숫자를 누르면 바로 내져요. '}${g.answered[qi].length} / ${need}명 냈어요 ${oHostSkip()}</p>`);
  }else{
   h+=oqcard(qi,`<div class="callout">${IC.eye}<span>한꺼번에 공개! 튀는 사람에게 왜 그 숫자인지 채팅으로 물어보세요.</span></div>${oplot(qi,false)}`);
   if(st==='reveal')dock=spec?'':g.ready.includes(me)?`<button class="btn dark" disabled><span class="lbl">준비 완료 (${g.ready.length}/${need})</span></button>`:`<button class="btn" onclick="oSend({t:'ready'})"><span class="lbl">${g.qi<g.qs.length-1?'다음 질문으로':'지목하러 가기'} (${g.ready.length}/${need})</span>${IC.next}</button>`;
  }
 }
 if(st==='discuss'){
  const vs=s.players.filter(p=>p.connected&&!p.left&&!g.caught.includes(p.id)).length;
  h+=`<section class="panel"><div class="ptab acc">토론</div>${g.caught.length?`<div class="caughtbar">${ico('handcuffs')}<span><b>${esc(g.caught.map(oName).join(', '))}</b> 검거! 남은 ${R} <b>${g.liarsN-g.caught.length}명</b>.</span></div>`:''}<p style="font-weight:700;margin-top:8px">${wide()?'오른쪽':'💬'} 채팅으로 누가 수상한지 이야기해요. 다 됐으면 「지목하자」.</p><p class="sub">준비 ${g.ready.length} / ${vs}명 ${oHostSkip()}</p></section>`;
  dock=spec?'':caughtMe?`<button class="btn dark" disabled><span class="lbl">잡혀서 투표에서 빠져요</span></button>`:g.ready.includes(me)?`<button class="btn dark" disabled><span class="lbl">지목 준비 완료 (${g.ready.length}/${vs})</span></button>`:`<button class="btn red" onclick="oSend({t:'ready'})">${IC.vote}<span class="lbl">지목하자 (${g.ready.length}/${vs})</span></button>`;
 }
 if(st==='vote'){
  const vs=s.players.filter(p=>p.connected&&!p.left&&!g.caught.includes(p.id)).length;
  h+=`<section class="panel"><div class="ptab acc">${ico('magnifier')}${g.voteRound===2?'동점! 다시 지목':'비밀 투표'}</div><p class="sub">${g.voteRound===2?'동점자 중에서만 고를 수 있어요. 또 동점이면 라이어 승리!':'라이어라고 생각하는 사람을 누르세요. 결과가 나오기 전까진 바꿀 수 있어요.'} ${g.voted.length} / ${vs}명 투표 ${oHostSkip()}</p>
  <div class="lineupbg" style="margin-top:12px"><div class="vgrid ${s.players.length>=7&&s.players.length!==9?'n4':''}">${s.players.map(p=>{const out=g.caught.includes(p.id)||p.left,self=p.id===me,no=g.cands&&!g.cands.includes(p.id);
   if(out)return`<div class="sus out">${avatar(p.av,{d:true,hat:false})}<b>${g.caught.includes(p.id)?'검거됨':'나감'}</b></div>`;
   return`<div class="sus ${g.myVote===p.id?'on':''} ${self||no||spec||caughtMe?'dim':''}" ${self||no||spec||caughtMe?'':`onclick="oSend({t:'vote',to:${p.id}});sfx.pick()"`}>${avatar(p.av,{sweat:g.myVote===p.id})}<b>${esc(self?'나':p.name)}</b></div>`}).join('')}</div></div></section>`;
  if(c.mode!=='spy')h+=`<section class="panel"><div class="ptab">설명판</div>${oboard()}</section>`;
  dock=spec||caughtMe?'':g.myVote?`<button class="btn dark" disabled><span class="lbl">${esc(oName(g.myVote))} 지목 완료 · 바꾸려면 다시 누르기</span></button>`:'';
 }
 if(st==='accuse'){
  h+=`<div class="stage" style="margin-top:20px"><div class="spot"></div><div class="tremble" style="width:150px;margin:0 auto">${avatar((oP(g.accused)||{av:0}).av,{sweat:true})}</div></div><div class="sushead ol">${esc(oName(g.accused))}${g.accused===me?'':'님'}이(가)<br>지목됐다<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>`;
 }
 if(st==='guess'){
  const mine=g.accused===me;
  h+=`<div class="stage shake" style="margin-top:10px"><div class="spot"></div><div class="av" style="width:140px;margin:0 auto">${avatar((oP(g.accused)||{av:0}).av,{d:true,hat:false})}</div><div class="stamp2">검거</div><div class="cuffs">${ico('handcuffs')}</div></div>
  <div class="sushead ol">${esc(oName(g.accused))}${mine?'':'님'}이(가) ${R}!</div>
  <section class="panel"><div class="ptab acc">마지막 기회</div>${mine?`<p style="font-weight:700">${c.mode==='liar'?'제시어':'다른 사람들의 제시어'}를 맞히면 역전승! 아래에 입력하세요. 기회는 한 번.</p>`:`<p style="font-weight:700">${esc(oName(g.accused))}님이 ${c.mode==='liar'?'제시어':'시민들의 제시어'}를 맞히는 중…</p>`}<p class="sub">띄어쓰기는 상관없어요.</p></section>`;
  if(mine)dock=oform('oGuess','정답 입력','oSendGuess',30);
 }
 if((st==='accuse'||st==='guess')&&c.mode!=='spy')h+=`<section class="panel"><div class="ptab">설명판</div>${oboard()}</section>`;
 if(st==='result')h+=oresult();
 return h+(dock?`<div class="dock"><div>${dock}</div></div>`:'');
};
function oresult(){
 const s=O.S,g=s.g,c=s.cfg,a=g.answer,R=MODES[c.mode].role,lw=g.win==='l',host=s.hostId===O.me;
 const gs=g.guesses.length?g.guesses[g.guesses.length-1]:null;
 const why={innocent:`<b class="nm">${esc(oName(g.accused))}</b>은(는) 억울한 시민이었어요!`,acc:`<b class="nm">${esc(oName(g.accused))}</b>은(는) 라이어의 공범이었어요!`,
  guessed:`<b class="nm">${esc(oName(gs&&gs.id))}</b>이(가) "${esc(gs&&gs.text)}"로 정답을 맞혔어요!`,caught:a.liars.length>1?`${R}를 모두 잡았어요!`:`${R}의 답 "${esc((gs&&gs.text)||'(시간 초과)')}" — 땡!`,
  tie:'두 번 연속 동점 — 지목 실패!',novote:'아무도 지목하지 않았어요.'}[g.why]||'';
 const st=['innocent','acc','tie','novote'].includes(g.why)?['도주 성공','y']:lw?['역전승','y']:['검거',''];
 let h=`<div class="ribbon" style="--c:${lw?'var(--red)':'var(--grn)'};--cd:${lw?'var(--red-d)':'var(--grn-d)'}"><span class="ol-s">${lw?R+' 승리':'시민 승리'}</span></div>
 <div class="stage" style="margin-top:20px"><div class="spot"></div><div class="lrow">${a.liars.map(i=>`<div class="av">${avatar((oP(i)||{av:0}).av,{d:true,hat:false})}</div>`).join('')}</div><div class="stamp2 ${st[1]}" style="font-size:38px">${st[0]}</div></div>
 <p class="why">${why}</p>
 <section class="panel"><div class="ptab">정답 공개</div><div class="facts">
  <div class="fact"><span>${R}</span><b class="who r">${esc(a.liars.map(oName).join(', '))}</b></div>
  ${a.acc!=null?`<div class="fact"><span>공범</span><b style="color:var(--pur2)">${esc(oName(a.acc))}</b></div>`:''}
  <div class="fact"><span>주제</span><b>${esc(g.cat)}</b></div>
  <div class="fact"><span>시민 제시어</span><b>${esc(a.word)}</b></div>
  ${c.mode!=='liar'?`<div class="fact"><span>${R}의 단어</span><b class="r">${esc(a.lw)}</b></div>`:''}
  ${g.guesses.map(x=>`<div class="fact"><span>${esc(oName(x.id))}의 답</span><b class="${x.ok?'':'r'}">${esc(x.text||'(시간 초과)')} ${x.ok?'⭕':'❌'}</b></div>`).join('')}
 </div></section>`;
 if(g.lastVotes&&Object.keys(g.lastVotes).length)h+=`<section class="panel"><div class="ptab">누가 누구를 지목했나</div><div class="facts">${Object.entries(g.lastVotes).map(([f,t])=>`<div class="fact"><span>${esc(oName(+f))}</span><b>→ ${esc(oName(t))}</b></div>`).join('')}</div></section>`;
 if(c.mode==='spy')h+=g.qs.map((q,k)=>`<section class="panel"><div class="ptab">질문 ${k+1} · 간극 ${Math.abs(q.a-q.b)}</div><p style="font-family:var(--disp);font-size:19px;margin:2px 0 0">${esc(q.t)}</p>${oplot(k,true)}</section>`).join('');
 if(g.pen)h+=`<section class="panel pen"><div class="ptab acc">${ico('stamp')}벌칙</div><p class="sub">벌칙 대상 · <b>${lw?'시민 팀':esc(a.liars.concat(a.acc!=null?[a.acc]:[]).map(oName).join(', '))}</b></p><div class="pentext">${esc(g.pen)}</div></section>`;
 const rank=s.players.slice().sort((x,y)=>y.pts-x.pts||x.id-y.id);
 h+=`<div class="score"><div><b style="color:var(--grn)">${s.tally.c}</b><span>시민</span></div><div class="vs">VS</div><div><b style="color:var(--red)">${s.tally.l}</b><span>${R}</span></div></div>
 <section class="panel"><div class="ptab">${ico('trophy')}점수판</div><div class="board">${rank.map((p,k)=>`<div class="rowp"><span class="rk">${k===0&&p.pts>0?ico('trophy'):k+1}</span>${avatar(p.av)}<span class="nm2">${esc(p.id===O.me?p.name+' (나)':p.name)}</span><span class="pt">${p.pts}<small>점</small></span>${g.delta&&g.delta[p.id]?`<span class="plus ${a.liars.includes(p.id)||p.id===a.acc?'r':''}">+${g.delta[p.id]}</span>`:''}</div>`).join('')}</div></section>`;
 h+=host?`<div class="dock"><div><button class="btn yel" onclick="oSend({t:'next'})"><span class="lbl">다음 라운드</span>${IC.next}</button><button class="btn paper sm" onclick="if(confirm('게임을 끝내고 최종 순위를 볼까요?'))oSend({t:'end'})">${ico('trophy','bi')}<span>게임 끝내기</span></button></div></div>`
  :`<div class="dock"><div><button class="btn dark" disabled><span class="lbl">방장이 다음 라운드를 고르는 중</span></button></div></div>`;
 return h;
}
SCREENS.oover=()=>{
 const s=O.S,rank=s.players.slice().sort((a,b)=>b.pts-a.pts||a.id-b.id),top=rank[0]?rank[0].pts:0,win=rank.filter(r=>r.pts===top&&top>0),pod=[rank[1],rank[0],rank[2]],host=s.hostId===O.me;
 return`${hud('<span class="hudtitle ol-s">최종 순위</span>',`<button class="ibtn" onclick="oLeave()" aria-label="나가기">${IC.back}</button>`)}
 <div class="ribbon" style="--c:var(--yel);--cd:var(--yel-d);color:var(--ink)"><span>${win.length?esc(win.map(r=>r.name).join(', '))+' 우승!':'무승부!'}</span></div>
 <div class="podium">${pod.map((r,k)=>r?`<div class="pd p${[2,1,3][k]}"><div class="pav">${[2,1,3][k]===1?`<div class="crown">${ico('trophy')}</div>`:''}${avatar(r.av)}</div><b>${esc(r.name)}</b><div class="bar"><span class="disp">${[2,1,3][k]}</span><small>${r.pts}점</small></div></div>`:'<div class="pd"></div>').join('')}</div>
 <section class="panel"><div class="ptab">전체 순위 · ${s.history.length}라운드</div><div class="board">${rank.map((r,k)=>`<div class="rowp"><span class="rk">${k+1}</span>${avatar(r.av)}<span class="nm2">${esc(r.name)}</span><span class="pt">${r.pts}<small>점</small></span></div>`).join('')}</div></section>
 ${s.history.length?`<section class="panel"><div class="ptab">라운드 기록</div><div class="hist">${s.history.map(x=>`<div><span class="disp">R${x.round}</span><span>${esc(x.cat)} · <b>${esc(x.word)}</b></span><em class="${x.win==='c'?'c':'l'}">${x.win==='c'?'시민':MODES[s.cfg.mode].role}</em></div>`).join('')}</div></section>`:''}
 <div class="dock"><div>${host?`<button class="btn yel" onclick="oSend({t:'again'})"><span class="lbl">이 방에서 다시 하기</span></button>`:`<button class="btn dark" disabled><span class="lbl">방장이 다시 하기를 누르면 대기실로</span></button>`}</div></div>`;
};
/* 남은 시간 표시 */
setInterval(()=>{if(scr!=='ogame')return;const el=document.querySelector('[data-ends]');if(!el)return;const l=oLeft();if(l==null)return;el.textContent=mmss(l);el.classList.toggle('hot',l<=10)},250);
