/* 라이어 게임 공용 규칙 — 화면(app.html)과 온라인 서버(server/game.js)가 똑같이 쓴다.
   data.js(LIARC·SPYC·DIFFS·MISSIONS·INTROS)가 먼저 있어야 한다. DOM을 건드리지 않는다. */

/* ───────── 시드 난수 (같은 코드 = 모든 폰에서 같은 결과) ───────── */
function hash(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19}h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return(h^h>>>16)>>>0}
function rng(...k){let a=hash(k.join('|'));return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function shuffle(arr,r){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
const pick=(arr,r)=>arr[Math.floor(r()*arr.length)];

/* 주제 번호 63 = 랜덤. 라이어 수 상한: 시민이 라이어보다 많게, 최대 3명 */
const RANDOM=63;
/* 주제 번호 62 = 라운드마다 다 같이 투표 → 표 수만큼 칸이 큰 룰렛 */
const VOTE=62;
/** counts: [[주제번호, 표수], ...] → 표 수 비율로 하나 뽑기. 표가 없으면 all 중 고르게 */
function weightedPick(counts,r,all){
 const total=counts.reduce((a,c)=>a+c[1],0);
 if(!total)return all[Math.floor(r()*all.length)];
 let x=r()*total;for(const [k,n] of counts){if((x-=n)<0)return k}return counts[counts.length-1][0];
}
const maxLiars=(n,acc)=>Math.max(1,Math.min(3,Math.floor((n-(acc?1:0)-1)/2)));

/* ───────── 라운드 만들기 ───────── */
const candCache={};
function spyCands(ci,d,seed){
 const key=ci+'/'+d+'/'+seed;if(candCache[key])return candCache[key];
 const C=SPYC[ci],{gap:[lo,hi],sim}=DIFFS[d],r=rng(seed,'sp',ci,d),out=[];
 for(let i=0;i<C.w.length;i++)for(let j=i+1;j<C.w.length;j++){
  const df=C.w[i].v.map((x,k)=>Math.abs(x-C.w[j].v[k]));
  const avg=df.reduce((a,b)=>a+b,0)/df.length;
  const first=df.map((x,k)=>k).filter(k=>df[k]>=lo&&df[k]<=hi);
  if(!first.length||avg>sim)continue;
  const q1=pick(first,r);
  let rest=shuffle(df.map((x,k)=>k).filter(k=>k!==q1&&df[k]>=Math.max(2,lo-1)&&df[k]<=hi+1),r);
  if(rest.length<2)rest=rest.concat(df.map((x,k)=>k).filter(k=>k!==q1&&!rest.includes(k)&&df[k]>=2).sort((a,b)=>df[b]-df[a]));
  if(rest.length<2)continue; // 쓸 만한 질문(간극 2 이상)이 3개 안 되는 짝은 버린다
  out.push({i,j,qs:[q1,...rest.slice(0,2)]});
 }
 return candCache[key]=shuffle(out,r);
}
const letters=w=>[...w.replace(/\s/g,'')].length;
/* recent: 폰 돌리기 모드에서만 — 최근 판에 나온 단어를 피한다(각자 폰 모드는 모든 폰이 같은 결과를 내야 하므로 쓰지 않음) */
function genRound(cfg,round,recent,cats){
 const spy=cfg.mode==='spy';cats=cats||(spy?SPYC:LIARC);
 const order=shuffle(cats.map((_,i)=>i),rng(cfg.seed,'cats',cats.length));
 const catOf=x=>cfg.cat===RANDOM||cfg.cat>=cats.length?order[x%cats.length]:cfg.cat;
 const c=catOf(round);let k=0;for(let x=0;x<round;x++)if(catOf(x)===c)k++;
 const rr=rng(cfg.seed,'round',round,cfg.mode);
 const people=shuffle([...Array(cfg.n).keys()],rr);
 const liars=people.slice(0,cfg.liars).sort((a,b)=>a-b);
 const acc=cfg.acc?people[cfg.liars]:-1;
 let starter=Math.floor(rr()*cfg.n);
 if(cfg.mode==='liar')for(let t=0;t<cfg.n&&liars.includes(starter);t++)starter=(starter+1)%cfg.n;
 const mission=!spy&&cfg.mission?pick(MISSIONS,rng(cfg.seed,'mission',round)):null;
 const intro=pick(INTROS,rng(cfg.seed,'intro',round));
 const base={cat:cats[c].name,icon:cats[c].icon,liars,acc,starter,mission,intro,rev:!!(mission&&mission[0]==='거꾸로 돌기')};
 if(!spy){
  const words=shuffle(cats[c].w,rng(cfg.seed,'w',c,cats[c].name));
  const used=new Set(recent?recent(cfg.mode+':'+cats[c].name):[]);
  const word=recent?(words.find(w=>!used.has(w))||words[0]):words[k%words.length];
  let lw=null;
  if(cfg.mode==='fool'){const others=cats[c].w.filter(x=>x!==word),usedL=new Set(recent?recent(cfg.mode+':'+cats[c].name+':lw'):[]);const fresh=others.filter(x=>!used.has(x)&&!usedL.has(x));lw=pick(fresh.length?fresh:others,rr)}
  return{...base,word,lw,hint:cfg.hint?letters(word):0,qs:[]};
 }
 const C=SPYC[c],cands=spyCands(c,cfg.diff,cfg.seed);
 let p=cands[k%cands.length];
 if(recent){const used=new Set(recent('spy:'+C.name));p=cands.find(x=>!used.has(C.w[x.i].name)&&!used.has(C.w[x.j].name))||cands.find(x=>!used.has(C.w[x.i].name+'|'+C.w[x.j].name))||p}
 const flip=rr()<.5,a=flip?p.j:p.i,b=flip?p.i:p.j;
 return{...base,word:C.w[a].name,lw:C.w[b].name,hint:0,
  qs:p.qs.map(q=>({t:C.q[q][0],lo:C.q[q][1],hi:C.q[q][2],a:C.w[a].v[q],b:C.w[b].v[q]}))};
}
