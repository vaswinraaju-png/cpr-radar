const fetch = require('node-fetch');

const API_KEYS = [
  'f13c82ea98f947b48b9453b15a732cf1',
  '58079bffb91347f08f3be1bcb901f856',
  'eb5e02ff78f14b5e9ef9acc9245d522f',
  'a5cb51990f08433c8ed5cbafe11d798d',
  'b7cd424d22f648d0bf06f7542879d2d1',
];
let keyIndex = 0;
function tdKey() { const k = API_KEYS[keyIndex % API_KEYS.length]; keyIndex++; return k; }

let btCreditsUsed = 0;
function getBTCredits() { return btCreditsUsed; }

const LEVERAGE = 1000;

const TD_SCRIPTS = {
  'USD/JPY':   { symbol:'USD/JPY',   type:'forex', pip:0.01,   name:'USD/JPY',        currency:'$', pipValue:'dynamic', exchange:null },
  'EUR/USD':   { symbol:'EUR/USD',   type:'forex', pip:0.0001, name:'EUR/USD',        currency:'$', pipValue:0.10,      exchange:null },
  'GBP/USD':   { symbol:'GBP/USD',   type:'forex', pip:0.0001, name:'GBP/USD',        currency:'$', pipValue:0.10,      exchange:null },
  'USD/INR':   { symbol:'USD/INR',   type:'forex', pip:0.0001, name:'USD/INR',        currency:'₹', pipValue:null,      exchange:null },
  'XAU/USD':   { symbol:'XAU/USD',   type:'forex', pip:0.01,   name:'Gold (XAU/USD)', currency:'$', pipValue:10.00,     exchange:null },
  'NIFTY':     { symbol:'NIFTY',     type:'index', pip:1,      name:'Nifty 50',       currency:'₹', pipValue:null,      exchange:'NSE' },
  'BANKNIFTY': { symbol:'BANKNIFTY', type:'index', pip:1,      name:'Bank Nifty',     currency:'₹', pipValue:null,      exchange:'NSE' },
  'SENSEX':    { symbol:'SENSEX',    type:'index', pip:1,      name:'SENSEX',         currency:'₹', pipValue:null,      exchange:'NSE' },
};

function getScriptList() {
  return Object.keys(TD_SCRIPTS).map(k => ({ key:k, name:TD_SCRIPTS[k].name, type:TD_SCRIPTS[k].type }));
}

function calcCPR(h, l, c) {
  const pivot=(h+l+c)/3, bc=(h+l)/2, tc=(pivot-bc)+pivot;
  const r1=(2*pivot)-l, s1=(2*pivot)-h;
  return { pivot, bc, tc, r1, s1 };
}

function summarise(trades) {
  const total    = trades.length;
  const wins     = trades.filter(t=>t.win).length;
  const losses   = total-wins;
  const winRate  = total ? +((wins/total)*100).toFixed(1) : 0;
  const totalPips= +trades.reduce((s,t)=>s+t.pnlPips,0).toFixed(1);
  const winPips  = trades.filter(t=>t.win).reduce((s,t)=>s+t.pnlPips,0);
  const lossPips = trades.filter(t=>!t.win).reduce((s,t)=>s+t.pnlPips,0);
  const avgWinPips  = wins   ? +(winPips/wins).toFixed(1)    : 0;
  const avgLossPips = losses ? +(lossPips/losses).toFixed(1) : 0;
  const profitFactor = losses&&lossPips!==0 ? +Math.abs(winPips/lossPips).toFixed(2) : wins?999:0;

  let peak=0,equity=0,maxDD=0;
  trades.forEach(t=>{ equity+=t.pnlPips; if(equity>peak)peak=equity; const dd=peak-equity; if(dd>maxDD)maxDD=dd; });
  const maxDrawdownPips=+maxDD.toFixed(1);

  const hasDollar = trades.some(t=>t.pnlDollar!=null);
  const totalDollar   = hasDollar ? +trades.reduce((s,t)=>s+(t.pnlDollar||0),0).toFixed(2) : null;
  const avgWinDollar  = hasDollar&&wins   ? +(trades.filter(t=>t.win).reduce((s,t)=>s+(t.pnlDollar||0),0)/wins).toFixed(2)    : null;
  const avgLossDollar = hasDollar&&losses ? +(trades.filter(t=>!t.win).reduce((s,t)=>s+(t.pnlDollar||0),0)/losses).toFixed(2) : null;
  let peakD=0,equityD=0,maxDDD=0;
  trades.forEach(t=>{ equityD+=(t.pnlDollar||0); if(equityD>peakD)peakD=equityD; const dd=peakD-equityD; if(dd>maxDDD)maxDDD=dd; });
  const maxDrawdownDollar = hasDollar ? +maxDDD.toFixed(2) : null;
  const totalMargin = +trades.reduce((s,t)=>s+(t.marginUSD||0),0).toFixed(2);
  const returnPct   = totalMargin>0&&totalDollar!=null ? +((totalDollar/totalMargin)*100).toFixed(2) : 0;

  return { total,wins,losses,winRate,totalPips,avgWinPips,avgLossPips,
           profitFactor,maxDrawdownPips,totalDollar,avgWinDollar,avgLossDollar,
           maxDrawdownDollar,totalMargin,returnPct };
}

// ── CORE FIB ENGINE ──────────────────────────────────────────────────────────
// filters: { minSlPips, maxSlPips, dailyBias }
function runFib(dailyCandles, candlesByDate, sc, days, rrMult, filters={}) {
  const { minSlPips=0, maxSlPips=Infinity, dailyBias=false } = filters;
  const FIB=0.618, pip=sc.pip, pipValue=sc.pipValue;
  const tradingDays = dailyCandles.slice(0, days);
  const trades=[];

  for (let i=0; i<tradingDays.length; i++) {
    if (i+1>=dailyCandles.length) break;
    const today      = tradingDays[i];
    const prev       = dailyCandles[i+1];
    const date       = (today.datetime||'').split(' ')[0];
    const dayCandles = candlesByDate[date];
    if (!dayCandles||dayCandles.length<4) continue;

    const cpr    = calcCPR(+prev.high,+prev.low,+prev.close);
    const todayOpen = +today.open;
    let traded=false;

    for (let ci=0; ci<dayCandles.length&&!traded; ci++) {
      const bc=dayCandles[ci];
      const aboveR1=bc.close>cpr.r1, belowS1=bc.close<cpr.s1;
      if (!aboveR1&&!belowS1) continue;

      const type = aboveR1?'bull':'bear';

      // Daily bias filter: only long if day opened above pivot, only short if below
      if (dailyBias) {
        if (type==='bull'&&todayOpen<cpr.pivot) continue;
        if (type==='bear'&&todayOpen>cpr.pivot) continue;
      }

      const range=bc.high-bc.low;
      if (range<pip*2) continue;

      const fibEntry=type==='bull'?bc.high-FIB*range:bc.low+FIB*range;
      const sl=type==='bull'?bc.low:bc.high;
      const risk=Math.abs(fibEntry-sl);
      if (risk<pip) continue;

      const slPips=+(risk/pip).toFixed(1);

      // Min/max SL filter
      if (slPips<minSlPips) continue;
      if (slPips>maxSlPips) continue;

      const tp=type==='bull'?fibEntry+rrMult*risk:fibEntry-rrMult*risk;

      // Margin at 0.01 lot, 1:1000 leverage = $1
      const marginUSD=1.00;

      // pnlDollar: dynamic for USD/JPY, static for others
      const calcPnlDollar = (pips) =>
        pipValue==='dynamic' ? +(pips*(10/fibEntry)).toFixed(2)
        : pipValue!=null     ? +(pips*pipValue).toFixed(2)
        : null;

      let entryTriggered=false,exitPrice=null,exitTime=null,exitType=null;
      for (let ei=ci+1; ei<dayCandles.length; ei++) {
        const ec=dayCandles[ei];
        if (!entryTriggered) {
          if (type==='bull'&&ec.low<=sl) break;
          if (type==='bear'&&ec.high>=sl) break;
          if (type==='bull'&&ec.low<=fibEntry) entryTriggered=true;
          if (type==='bear'&&ec.high>=fibEntry) entryTriggered=true;
          if (!entryTriggered) continue;
        }
        if (type==='bull') {
          if (ec.high>=tp) { exitPrice=tp; exitTime=ec.datetime; exitType='TP'; break; }
          if (ec.low<=sl)  { exitPrice=sl; exitTime=ec.datetime; exitType='SL'; break; }
        } else {
          if (ec.low<=tp)  { exitPrice=tp; exitTime=ec.datetime; exitType='TP'; break; }
          if (ec.high>=sl) { exitPrice=sl; exitTime=ec.datetime; exitType='SL'; break; }
        }
      }

      if (!entryTriggered) continue;
      if (!exitPrice) {
        const last=dayCandles[dayCandles.length-1];
        exitPrice=last.close; exitTime=last.datetime; exitType='EOD';
      }

      const pnlPips=type==='bull'?(exitPrice-fibEntry)/pip:(fibEntry-exitPrice)/pip;
      const win=exitType==='TP'||(exitType==='EOD'&&pnlPips>0);
      const dec=pip<0.01?5:pip<1?3:2;

      trades.push({
        date, type, direction:type==='bull'?'LONG':'SHORT',
        entryTime:bc.datetime, exitTime,
        fibEntry: +fibEntry.toFixed(dec), sl: +sl.toFixed(dec),
        tp:       +tp.toFixed(dec),       exitPrice: +exitPrice.toFixed(dec),
        exitType, pnlPips: +pnlPips.toFixed(1),
        pnlDollar: calcPnlDollar(pnlPips),
        slPips, rr:rrMult, win,
        breakoutLevel:type==='bull'?'R1':'S1',
        marginUSD,
      });
      traded=true;
    }
  }
  return { trades, ...summarise(trades) };
}

// ── FETCH ────────────────────────────────────────────────────────────────────
async function fetchData(scriptKey, days) {
  const sc=TD_SCRIPTS[scriptKey];
  const ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const sym=encodeURIComponent(sc.symbol);
  // Need days+5 daily candles for buffer, 5000 15m candles covers ~52 days 24h
  // For 90 days need more — fetch outputsize based on days
  const dailySize=Math.min(days+10, 95);
  const m15Size=5000; // max — covers ~52 calendar days (forex 24h) or ~90 trading days

  const dailyUrl=`https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${dailySize}&apikey=${tdKey()}${ex}`;
  const m15Url  =`https://api.twelvedata.com/time_series?symbol=${sym}&interval=15min&outputsize=${m15Size}&apikey=${tdKey()}${ex}`;
  btCreditsUsed+=2;

  const [dD,mD]=await Promise.all([fetch(dailyUrl).then(r=>r.json()),fetch(m15Url).then(r=>r.json())]);
  if (dD.status==='error'||!dD.values) throw new Error(dD.message||'No daily data');
  if (mD.status==='error'||!mD.values) throw new Error(mD.message||'No 15m data');

  const candlesByDate={};
  mD.values.forEach(c=>{
    const date=c.datetime.split(' ')[0];
    if (!candlesByDate[date]) candlesByDate[date]=[];
    candlesByDate[date].push({datetime:c.datetime,open:+c.open,high:+c.high,low:+c.low,close:+c.close});
  });
  Object.keys(candlesByDate).forEach(d=>{
    candlesByDate[d].sort((a,b)=>a.datetime.localeCompare(b.datetime));
  });

  return { dailyCandles:dD.values, candlesByDate, sc };
}

// ── RUN 4 STRATEGIES ─────────────────────────────────────────────────────────
async function runScriptBacktest(scriptKey, days=60) {
  const sc=TD_SCRIPTS[scriptKey];
  if (!sc) throw new Error('Unknown script: '+scriptKey);

  console.log(`[BT] ${sc.name} — ${days} days, 4 strategies, 2 credits`);
  const { dailyCandles, candlesByDate } = await fetchData(scriptKey, days);

  // Per-script strategy config
  let strategies;
  if (scriptKey === 'USD/JPY') {
    strategies = [
      { id:'A', name:'Baseline',          desc:'No filters · Fib 61.8% · 1:2 RR',              filters:{} },
      { id:'B', name:'Daily Bias Filter', desc:'Only trade direction of daily open vs pivot',   filters:{ dailyBias:true } },
    ];
  } else if (scriptKey === 'USD/INR' || scriptKey === 'XAU/USD') {
    strategies = [
      { id:'A', name:'Baseline',            desc:'No filters · Fib 61.8% · 1:2 RR',            filters:{} },
      { id:'B', name:'Min SL Filter',       desc:'Skip SL < 4 pips (avoids noise hunts)',      filters:{ minSlPips:4 } },
    ];
  } else {
    strategies = [
      { id:'A', name:'Baseline',          desc:'No filters · Fib 61.8% · 1:2 RR',              filters:{} },
      { id:'B', name:'Min SL Filter',     desc:'Skip SL < 4 pips',                             filters:{ minSlPips:4 } },
      { id:'C', name:'Daily Bias Filter', desc:'Only trade direction of daily open vs pivot',   filters:{ dailyBias:true } },
      { id:'D', name:'All Filters',       desc:'Min 4p SL + Daily bias + Max 8p SL cap',       filters:{ minSlPips:4, maxSlPips:8, dailyBias:true } },
    ];
  }

  const results = strategies.map(s => {
    const r = runFib(dailyCandles, candlesByDate, sc, days, 2, s.filters);
    console.log(`  [${s.id}] ${r.total}T | ${r.winRate}% WR | ${r.totalPips}p | $${r.totalDollar}`);
    return { ...s, ...r };
  });

  return {
    scriptKey, scriptName:sc.name, currency:sc.currency,
    period:`${days} days`, strategy:'Fib 61.8% — 4 Strategies — 1:2 RR',
    days, results,
  };
}

module.exports = { runScriptBacktest, getBTCredits, getScriptList };
