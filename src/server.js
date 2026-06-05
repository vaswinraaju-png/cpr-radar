const express  = require('express');
const fetch    = require('node-fetch');
const { exec } = require('child_process');
const path     = require('path');
const { runScriptBacktest, getBTCredits, getScriptList } = require('./backtest');
const sb = require('./supabase');

const app  = express();
const PORT = process.env.PORT || 3748;

// ── CORS for Railway (allows browser + EA access) ─────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const API_KEYS = [
  'f13c82ea98f947b48b9453b15a732cf1',
  '58079bffb91347f08f3be1bcb901f856',
  'eb5e02ff78f14b5e9ef9acc9245d522f',
  'a5cb51990f08433c8ed5cbafe11d798d',
  'b7cd424d22f648d0bf06f7542879d2d1',
];
let keyIndex = 0, tdCreditCount = 0;
function nextKey() { const k=API_KEYS[keyIndex%API_KEYS.length]; keyIndex++; tdCreditCount++; return k; }

const SCRIPTS = {
  'USD/JPY':   { symbol:'USD/JPY',   type:'forex', pip:0.01,   name:'USD/JPY' },
  'EUR/USD':   { symbol:'EUR/USD',   type:'forex', pip:0.0001, name:'EUR/USD' },
  'GBP/USD':   { symbol:'GBP/USD',   type:'forex', pip:0.0001, name:'GBP/USD' },
  'USD/INR':   { symbol:'USD/INR',   type:'forex', pip:0.0001, name:'USD/INR' },
  'XAU/USD':   { symbol:'XAU/USD',   type:'forex', pip:0.01,   name:'Gold (XAU/USD)' },
  'NIFTY':     { symbol:'NIFTY',     type:'index', pip:1,      name:'Nifty 50',   exchange:'NSE' },
  'BANKNIFTY': { symbol:'BANKNIFTY', type:'index', pip:1,      name:'Bank Nifty', exchange:'NSE' },
  'SENSEX':    { symbol:'SENSEX',    type:'index', pip:1,      name:'SENSEX',     exchange:'NSE' },
};

let state = {
  activeScript: 'USD/JPY',
  cmp: null, cpr: null, candle15m: null,
  alerts: [], tradeCards: [],
  lastPoll: null, error: null, polling: false,
  alertedCandles: new Set(),
};

function notify(title, msg) {
  // On Railway — log only (no macOS notifications)
  console.log(`[SIGNAL] ${title} — ${msg}`);
}

function calcCPR(h, l, c) {
  const pivot=(h+l+c)/3, bc=(h+l)/2, tc=(pivot-bc)+pivot;
  const r1=(2*pivot)-l, s1=(2*pivot)-h, r2=pivot+(h-l), s2=pivot-(h-l);
  const r3=h+2*(pivot-l), s3=l-2*(h-pivot);
  const w=(Math.abs(tc-bc)/pivot)*100;
  const widthClass=w<0.05?'viral':w<0.15?'narrow':'wide';
  const widthLabel=w<0.05?'Viral — Explosive move expected':w<0.15?'Narrow — Trending day expected':'Wide — Rangy / slow day expected';
  return {pivot,bc,tc,r1,s1,r2,s2,r3,s3,cprWidth:Math.abs(tc-bc),cprWidthPct:w,widthLabel,widthClass};
}

async function tdFetch(url) { return fetch(url).then(r=>r.json()); }

async function fetchPrevDay(key) {
  const sc=SCRIPTS[key], ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sc.symbol)}&interval=1day&outputsize=2&apikey=${nextKey()}${ex}`);
  if (d.status==='error'||!d.values||d.values.length<2) throw new Error(d.message||'No daily data');
  const p=d.values[1]; return {h:+p.high,l:+p.low,c:+p.close,date:p.datetime};
}

async function fetch15m(key) {
  const sc=SCRIPTS[key], ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sc.symbol)}&interval=15min&outputsize=2&apikey=${nextKey()}${ex}`);
  if (d.status==='error'||!d.values||d.values.length<2) throw new Error(d.message||'No 15m data');
  const c=d.values[1]; return {datetime:c.datetime,open:+c.open,high:+c.high,low:+c.low,close:+c.close};
}

async function fetchCMP(key) {
  const sc=SCRIPTS[key], ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const d=await tdFetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(sc.symbol)}&apikey=${nextKey()}${ex}`);
  if (d.status==='error'||!d.price) throw new Error(d.message||'No price');
  return +d.price;
}

function checkBreakout(key, candle, cpr) {
  const sc=SCRIPTS[key], ck=`${key}_${candle.datetime}`;
  if (state.alertedCandles.has(ck)) return;
  const aboveR1=candle.close>cpr.r1, belowS1=candle.close<cpr.s1;
  if (!aboveR1&&!belowS1) return;
  state.alertedCandles.add(ck);
  if (state.alertedCandles.size>200) state.alertedCandles.delete(state.alertedCandles.values().next().value);

  const big=candle.close>100, fmt=v=>v.toFixed(big?2:5);
  const t=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

  if (aboveR1) {
    const sl=candle.low,risk=candle.close-sl,tp=candle.close+2*risk;
    const card={id:Date.now(),time:t,script:sc.name,type:'bull',direction:'LONG',
      entry:fmt(candle.close),sl:fmt(sl),tp:fmt(tp),
      riskPips:(risk/sc.pip).toFixed(1),rewardPips:(risk*2/sc.pip).toFixed(1),
      rr:'2.00',candleTime:candle.datetime,breakoutLevel:'R1',status:'active'};
    state.tradeCards.unshift(card);
    state.alerts.unshift({id:Date.now(),time:t,script:sc.name,type:'bullish',
      label:'🟢 Bullish Breakout above R1',
      detail:`Entry:${fmt(candle.close)} SL:${fmt(sl)} TP:${fmt(tp)}`,phase:'breakout'});
    notify(`🟢 ${sc.name} — R1 Breakout`,`Entry:${fmt(candle.close)} SL:${fmt(sl)} TP:${fmt(tp)}`);
    sb.createSignal(card).catch(()=>{});
  }
  if (belowS1) {
    const sl=candle.high,risk=sl-candle.close,tp=candle.close-2*risk;
    const card={id:Date.now()+1,time:t,script:sc.name,type:'bear',direction:'SHORT',
      entry:fmt(candle.close),sl:fmt(sl),tp:fmt(tp),
      riskPips:(risk/sc.pip).toFixed(1),rewardPips:(risk*2/sc.pip).toFixed(1),
      rr:'2.00',candleTime:candle.datetime,breakoutLevel:'S1',status:'active'};
    state.tradeCards.unshift(card);
    state.alerts.unshift({id:Date.now()+1,time:t,script:sc.name,type:'bearish',
      label:'🔴 Bearish Breakdown below S1',
      detail:`Entry:${fmt(candle.close)} SL:${fmt(sl)} TP:${fmt(tp)}`,phase:'breakout'});
    notify(`🔴 ${sc.name} — S1 Breakdown`,`Entry:${fmt(candle.close)} SL:${fmt(sl)} TP:${fmt(tp)}`);
    sb.createSignal(card).catch(()=>{});
  }
  if (state.tradeCards.length>20) state.tradeCards=state.tradeCards.slice(0,20);
  if (state.alerts.length>100)    state.alerts=state.alerts.slice(0,100);
}

let pollTimer=null;

async function doPoll() {
  const key=state.activeScript;
  try {
    state.error=null;
    const [ohlc,cmp,candle15m]=await Promise.all([fetchPrevDay(key),fetchCMP(key),fetch15m(key)]);
    state.cpr={...calcCPR(ohlc.h,ohlc.l,ohlc.c),h:ohlc.h,l:ohlc.l,c:ohlc.c,prevDate:ohlc.date};
    state.cmp=cmp; state.candle15m=candle15m;
    state.lastPoll=new Date().toISOString();
    checkBreakout(key,candle15m,state.cpr);
    console.log(`[POLL] ${key} CMP=${cmp} | credits=${tdCreditCount}`);
  } catch(err) { state.error=err.message; console.error('[POLL ERROR]',err.message); }
}

function startPolling() {
  if (state.polling) return;
  state.polling=true; doPoll();
  pollTimer=setInterval(doPoll,180000); // 3 min — enough for 15m candles
}
function stopPolling() {
  state.polling=false;
  if (pollTimer){clearInterval(pollTimer);pollTimer=null;}
}

app.use(express.json());
app.use(express.static(path.join(__dirname,'../public')));

app.get('/api/state',(req,res)=>{
  res.json({
    activeScript:state.activeScript, cmp:state.cmp, cpr:state.cpr,
    candle15m:state.candle15m, alerts:state.alerts, tradeCards:state.tradeCards,
    lastPoll:state.lastPoll, error:state.error, polling:state.polling,
    tdCreditCount, creditLimit:4000, btScriptList:getScriptList(),
    scripts:Object.keys(SCRIPTS).map(k=>({key:k,name:SCRIPTS[k].name,type:SCRIPTS[k].type})),
  });
});

app.post('/api/script',(req,res)=>{
  const {script}=req.body;
  if (!SCRIPTS[script]) return res.status(400).json({error:'Unknown script'});
  state.activeScript=script; state.cmp=null; state.cpr=null;
  state.candle15m=null; state.error=null;
  stopPolling(); startPolling(); res.json({ok:true});
});

app.post('/api/start',  (req,res)=>{startPolling();res.json({ok:true});});
app.post('/api/stop',   (req,res)=>{stopPolling(); res.json({ok:true});});
app.post('/api/refresh',async(req,res)=>{await doPoll();res.json({ok:true});});
app.delete('/api/alerts',    (req,res)=>{state.alerts=[];res.json({ok:true});});
app.delete('/api/tradecards',(req,res)=>{state.tradeCards=[];res.json({ok:true});});

// ── SIGNALS API (for MT4 EA) ──────────────────────────────────────────────────
app.get('/api/signals',async(req,res)=>{
  const cards=state.tradeCards.filter(t=>t.status==='active');
  if (!cards.length) return res.json({signal:false});
  const latest=cards[0];
  latest.status='sent';
  sb.updateSignalStatus(latest.id,'sent').catch(()=>{});
  res.json({
    signal:true, direction:latest.direction,
    entry:parseFloat(latest.entry), sl:parseFloat(latest.sl),
    tp:parseFloat(latest.tp), lots:0.01, symbol:'USDJPY',
    id:latest.id, time:latest.time,
  });
});

app.post('/api/signals/confirm',async(req,res)=>{
  const {id,ticket,entryPrice}=req.body;
  const card=state.tradeCards.find(t=>t.id===id);
  if (card) {
    card.status='executed';
    sb.updateSignalStatus(id,'executed').catch(()=>{});
    sb.createTrade({signalId:id,ticket,direction:card.direction,
      entryPrice:entryPrice||card.entry,sl:card.sl,tp:card.tp}).catch(()=>{});
  }
  res.json({ok:true});
});

app.post('/api/trades/close',async(req,res)=>{
  const {ticket,closePrice,pnl,reason}=req.body;
  console.log(`[TRADE CLOSE] ticket=${ticket} pnl=${pnl} reason=${reason}`);
  try {
    await sb.closeTrade(ticket,closePrice,pnl,reason);
    const sign=pnl>=0?'🟢':'🔴';
    const t=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    state.alerts.unshift({id:Date.now(),time:t,script:'USD/JPY',
      type:pnl>=0?'bullish':'bearish',
      label:`${sign} Trade Closed — ${reason} | PnL: ${pnl>=0?'+':''}$${parseFloat(pnl).toFixed(2)}`,
      detail:`Ticket:${ticket} Close:${closePrice} ${reason}`,phase:'close'});
    if (state.alerts.length>100) state.alerts=state.alerts.slice(0,100);
  } catch(e){console.error('[TRADE CLOSE ERROR]',e.message);}
  res.json({ok:true});
});

app.get('/api/signals/last',async(req,res)=>{
  const lastId=await sb.getLastSignalId().catch(()=>0);
  res.json({lastSignalId:lastId});
});

app.get('/api/trades',async(req,res)=>{
  const trades=await sb.getRecentTrades(50).catch(()=>[]);
  res.json({trades});
});

app.get('/api/signals/history',async(req,res)=>{
  const signals=await sb.getRecentSignals(50).catch(()=>[]);
  res.json({signals});
});

app.post('/api/backtest/run',async(req,res)=>{
  const {script,days,tf}=req.body;
  if (!script) return res.status(400).json({error:'Script required'});
  try {
    const d=parseInt(days)||60;
    const t=tf||'15min';
    res.json(await runScriptBacktest(script,d,t));
  } catch(e){res.status(500).json({error:e.message});}
});

// Health check for Railway
app.get('/health',(req,res)=>res.json({status:'ok',polling:state.polling,uptime:process.uptime()}));

app.listen(PORT,()=>{
  console.log(`\n🚀 CPR Radar — Railway | Port ${PORT}\n`);
  sb.setupTables().catch(()=>{});
  startPolling();
});
