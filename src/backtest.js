const fetch = require('node-fetch');

const API_KEYS = [
  'f13c82ea98f947b48b9453b15a732cf1',
  '58079bffb91347f08f3be1bcb901f856',
  'eb5e02ff78f14b5e9ef9acc9245d522f',
  'a5cb51990f08433c8ed5cbafe11d798d',
  'b7cd424d22f648d0bf06f7542879d2d1',
];
let keyIndex = 0;
function tdKey() { const k=API_KEYS[keyIndex%API_KEYS.length]; keyIndex++; return k; }

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
  return Object.keys(TD_SCRIPTS).map(k=>({key:k,name:TD_SCRIPTS[k].name,type:TD_SCRIPTS[k].type}));
}

// ── INDICATORS ───────────────────────────────────────────────────────────────
function calcEMA(values, period) {
  const k = 2/(period+1);
  const ema = [values[0]];
  for (let i=1;i<values.length;i++)
    ema.push(values[i]*k + ema[i-1]*(1-k));
  return ema;
}

function calcATR(candles, period=14) {
  const trs = candles.map((c,i)=>{
    if (i===0) return c.high-c.low;
    const prev=candles[i-1];
    return Math.max(c.high-c.low, Math.abs(c.high-prev.close), Math.abs(c.low-prev.close));
  });
  // Smooth ATR
  const atr=[trs[0]];
  for (let i=1;i<trs.length;i++)
    atr.push((atr[i-1]*(period-1)+trs[i])/period);
  return atr;
}

function calcRSI(closes, period=14) {
  const rsi=new Array(period).fill(null);
  let gains=0,losses=0;
  for (let i=1;i<=period;i++){
    const d=closes[i]-closes[i-1];
    if(d>=0) gains+=d; else losses-=d;
  }
  let avgGain=gains/period, avgLoss=losses/period;
  rsi.push(avgLoss===0?100:100-(100/(1+avgGain/avgLoss)));
  for (let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    avgGain=(avgGain*(period-1)+(d>0?d:0))/period;
    avgLoss=(avgLoss*(period-1)+(d<0?-d:0))/period;
    rsi.push(avgLoss===0?100:100-(100/(1+avgGain/avgLoss)));
  }
  return rsi;
}

function calcCPR(h,l,c) {
  const pivot=(h+l+c)/3, bc=(h+l)/2, tc=(pivot-bc)+pivot;
  const r1=(2*pivot)-l, s1=(2*pivot)-h;
  const r2=pivot+(h-l), s2=pivot-(h-l);
  const r3=h+2*(pivot-l), s3=l-2*(h-pivot);
  return {pivot,bc,tc,r1,s1,r2,s2,r3,s3};
}

// ── SUMMARISE ────────────────────────────────────────────────────────────────
function summarise(trades) {
  const total=trades.length, wins=trades.filter(t=>t.win).length;
  const losses=total-wins, winRate=total?+((wins/total)*100).toFixed(1):0;
  const totalPips=+trades.reduce((s,t)=>s+t.pnlPips,0).toFixed(1);
  const winPips=trades.filter(t=>t.win).reduce((s,t)=>s+t.pnlPips,0);
  const lossPips=trades.filter(t=>!t.win).reduce((s,t)=>s+t.pnlPips,0);
  const avgWinPips=wins?+(winPips/wins).toFixed(1):0;
  const avgLossPips=losses?+(lossPips/losses).toFixed(1):0;
  const profitFactor=losses&&lossPips!==0?+Math.abs(winPips/lossPips).toFixed(2):wins?999:0;
  let peak=0,equity=0,maxDD=0;
  trades.forEach(t=>{equity+=t.pnlPips;if(equity>peak)peak=equity;const dd=peak-equity;if(dd>maxDD)maxDD=dd;});
  const maxDrawdownPips=+maxDD.toFixed(1);
  const hasDollar=trades.some(t=>t.pnlDollar!=null);
  const totalDollar=hasDollar?+trades.reduce((s,t)=>s+(t.pnlDollar||0),0).toFixed(2):null;
  const avgWinDollar=hasDollar&&wins?+(trades.filter(t=>t.win).reduce((s,t)=>s+(t.pnlDollar||0),0)/wins).toFixed(2):null;
  const avgLossDollar=hasDollar&&losses?+(trades.filter(t=>!t.win).reduce((s,t)=>s+(t.pnlDollar||0),0)/losses).toFixed(2):null;
  let peakD=0,equityD=0,maxDDD=0;
  trades.forEach(t=>{equityD+=(t.pnlDollar||0);if(equityD>peakD)peakD=equityD;const dd=peakD-equityD;if(dd>maxDDD)maxDDD=dd;});
  const maxDrawdownDollar=hasDollar?+maxDDD.toFixed(2):null;
  const totalMargin=+trades.reduce((s,t)=>s+(t.marginUSD||0),0).toFixed(2);
  const returnPct=totalMargin>0&&totalDollar!=null?+((totalDollar/totalMargin)*100).toFixed(2):0;
  return {total,wins,losses,winRate,totalPips,avgWinPips,avgLossPips,
          profitFactor,maxDrawdownPips,totalDollar,avgWinDollar,avgLossDollar,
          maxDrawdownDollar,totalMargin,returnPct};
}

// ── FETCH DATA ───────────────────────────────────────────────────────────────
async function fetchData(scriptKey, tf, days) {
  const sc=TD_SCRIPTS[scriptKey];
  const ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const sym=encodeURIComponent(sc.symbol);

  // Calculate candle output size needed
  // 1m: ~390/day (6.5h trading), 5m: ~78/day, 15m: ~26/day
  // For forex 24h: 1m=1440/day, 5m=288/day, 15m=96/day
  const candlesPerDay = tf==='1min'?1440:tf==='5min'?288:96;
  const outputSize = Math.min(candlesPerDay*days+100, 5000);
  const dailySize  = Math.min(days+10, 500);

  const dailyUrl = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${dailySize}&apikey=${tdKey()}${ex}`;
  const tfUrl    = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=${tf}&outputsize=${outputSize}&apikey=${tdKey()}${ex}`;

  const [dD,tD] = await Promise.all([
    fetch(dailyUrl).then(r=>r.json()),
    fetch(tfUrl).then(r=>r.json()),
  ]);

  if (dD.status==='error'||!dD.values) throw new Error(dD.message||'No daily data');
  if (tD.status==='error'||!tD.values) throw new Error(tD.message||`No ${tf} data`);

  // Group tf candles by date
  const candlesByDate={};
  tD.values.forEach(c=>{
    const date=c.datetime.split(' ')[0];
    if (!candlesByDate[date]) candlesByDate[date]=[];
    candlesByDate[date].push({
      datetime:c.datetime,open:+c.open,high:+c.high,low:+c.low,close:+c.close
    });
  });
  Object.keys(candlesByDate).forEach(d=>{
    candlesByDate[d].sort((a,b)=>a.datetime.localeCompare(b.datetime));
  });

  return {dailyCandles:dD.values, candlesByDate, sc};
}

// ── CORE STRATEGY ENGINE ─────────────────────────────────────────────────────
// Strategies:
// A - Baseline: CPR breakout only (Fib 61.8% entry, fixed 1:2)
// B - ATR SL + CPR TP: dynamic SL from ATR, TP = next CPR level
// C - EMA21 Filter + ATR SL + CPR TP: only trade in direction of EMA21
// D - EMA21 + RSI50 + ATR SL + CPR TP: full filter stack
function runStrategy(dailyCandles, candlesByDate, sc, days, strategyId) {
  const pip=sc.pip, pipValue=sc.pipValue;
  const tradingDays=dailyCandles.slice(0,days);
  const trades=[];

  // Pre-compute all tf candles in order for indicator calculation
  const allCandles=[];
  tradingDays.forEach((day,i)=>{
    if (i+1>=dailyCandles.length) return;
    const date=(day.datetime||'').split(' ')[0];
    const dc=candlesByDate[date];
    if (dc) allCandles.push(...dc);
  });
  allCandles.sort((a,b)=>a.datetime.localeCompare(b.datetime));

  // Calculate indicators on all candles
  const closes=allCandles.map(c=>c.close);
  const ema21=calcEMA(closes,21);
  const atrArr=calcATR(allCandles,14);
  const rsiArr=calcRSI(closes,14);

  // Map datetime to indicator values
  const indicators={};
  allCandles.forEach((c,i)=>{
    indicators[c.datetime]={ema21:ema21[i],atr:atrArr[i],rsi:rsiArr[i]};
  });

  for (let i=0;i<tradingDays.length;i++) {
    if (i+1>=dailyCandles.length) break;
    const today=tradingDays[i];
    const prev=dailyCandles[i+1];
    const date=(today.datetime||'').split(' ')[0];
    const dayCandles=candlesByDate[date];
    if (!dayCandles||dayCandles.length<10) continue;

    const cpr=calcCPR(+prev.high,+prev.low,+prev.close);
    let traded=false;

    for (let ci=21;ci<dayCandles.length&&!traded;ci++) {
      const bc=dayCandles[ci];
      const ind=indicators[bc.datetime];
      if (!ind||ind.atr==null) continue;

      const aboveR1=bc.close>cpr.r1, belowS1=bc.close<cpr.s1;
      if (!aboveR1&&!belowS1) continue;

      const type=aboveR1?'bull':'bear';
      const direction=type==='bull'?'LONG':'SHORT';

      // ── STRATEGY FILTERS ───────────────────────────────────────────
      // EMA21 filter (strategies C and D)
      if ((strategyId==='C'||strategyId==='D')&&ind.ema21!=null) {
        if (type==='bull'&&bc.close<ind.ema21) continue;
        if (type==='bear'&&bc.close>ind.ema21) continue;
      }

      // RSI50 filter (strategy D only)
      if (strategyId==='D'&&ind.rsi!=null) {
        if (type==='bull'&&ind.rsi<50) continue;
        if (type==='bear'&&ind.rsi>50) continue;
      }

      // ── ENTRY CALCULATION ──────────────────────────────────────────
      const range=bc.high-bc.low;
      if (range<pip*2) continue;

      let entry, sl, tp;

      if (strategyId==='A') {
        // Baseline: Fib 61.8%, fixed 1:2 RR
        entry=type==='bull'?bc.high-0.618*range:bc.low+0.618*range;
        sl=type==='bull'?bc.low:bc.high;
        const risk=Math.abs(entry-sl);
        if (risk<pip) continue;
        tp=type==='bull'?entry+2*risk:entry-2*risk;
      } else {
        // ATR-based SL, CPR-based TP
        entry=type==='bull'?bc.high-0.618*range:bc.low+0.618*range;
        const atrSL=ind.atr*1.5;
        sl=type==='bull'?entry-atrSL:entry+atrSL;
        const risk=Math.abs(entry-sl);
        if (risk<pip) continue;

        // TP = next CPR level
        if (type==='bull') {
          if (entry<cpr.r1)      tp=cpr.r1;
          else if (entry<cpr.r2) tp=cpr.r2;
          else                   tp=cpr.r3;
        } else {
          if (entry>cpr.s1)      tp=cpr.s1;
          else if (entry>cpr.s2) tp=cpr.s2;
          else                   tp=cpr.s3;
        }

        // Minimum 1:1 RR check
        const rewardPips=Math.abs(tp-entry)/pip;
        const riskPips=Math.abs(entry-sl)/pip;
        if (rewardPips<riskPips) continue;
      }

      const slPips=+(Math.abs(entry-sl)/pip).toFixed(1);
      if (slPips<1) continue;

      // ── SIMULATE TRADE ─────────────────────────────────────────────
      let exitPrice=null,exitTime=null,exitType=null,entryTriggered=false;

      for (let ei=ci+1;ei<dayCandles.length;ei++) {
        const ec=dayCandles[ei];
        if (!entryTriggered) {
          if (type==='bull'&&ec.low<=sl) break;
          if (type==='bear'&&ec.high>=sl) break;
          if (type==='bull'&&ec.low<=entry) entryTriggered=true;
          if (type==='bear'&&ec.high>=entry) entryTriggered=true;
          if (!entryTriggered) continue;
        }
        if (type==='bull') {
          if (ec.high>=tp){exitPrice=tp;exitTime=ec.datetime;exitType='TP';break;}
          if (ec.low<=sl) {exitPrice=sl;exitTime=ec.datetime;exitType='SL';break;}
        } else {
          if (ec.low<=tp)  {exitPrice=tp;exitTime=ec.datetime;exitType='TP';break;}
          if (ec.high>=sl) {exitPrice=sl;exitTime=ec.datetime;exitType='SL';break;}
        }
      }

      if (!entryTriggered) continue;
      if (!exitPrice) {
        const last=dayCandles[dayCandles.length-1];
        exitPrice=last.close;exitTime=last.datetime;exitType='EOD';
      }

      const pnlPips=type==='bull'?(exitPrice-entry)/pip:(entry-exitPrice)/pip;
      const win=exitType==='TP'||(exitType==='EOD'&&pnlPips>0);
      const dec=pip<0.01?5:pip<1?3:2;
      const marginUSD=1.00;
      const pnlDollar=pipValue==='dynamic'?+(pnlPips*(10/entry)).toFixed(2):pipValue!=null?+(pnlPips*pipValue).toFixed(2):null;
      const rr=strategyId==='A'?2:+(Math.abs(tp-entry)/Math.abs(entry-sl)).toFixed(2);

      trades.push({
        date,type,direction,
        entryTime:bc.datetime,exitTime,
        fibEntry:+entry.toFixed(dec),sl:+sl.toFixed(dec),
        tp:+tp.toFixed(dec),exitPrice:+exitPrice.toFixed(dec),
        exitType,pnlPips:+pnlPips.toFixed(1),pnlDollar,
        slPips,rr,win,
        breakoutLevel:type==='bull'?'R1':'S1',
        marginUSD,
        ema21:ind.ema21?+ind.ema21.toFixed(dec):null,
        atr:ind.atr?+ind.atr.toFixed(dec):null,
        rsi:ind.rsi?+ind.rsi.toFixed(1):null,
      });
      traded=true;
    }
  }
  return {trades,...summarise(trades)};
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
async function runScriptBacktest(scriptKey, days=60, tf='15min') {
  const sc=TD_SCRIPTS[scriptKey];
  if (!sc) throw new Error('Unknown script: '+scriptKey);

  console.log(`[BT] ${sc.name} | ${tf} | ${days} days | fetching...`);
  const {dailyCandles,candlesByDate}=await fetchData(scriptKey,tf,days);

  const strategies=[
    {id:'A',name:'Baseline',        desc:'CPR breakout · Fib 61.8% entry · 1:2 RR · No filters'},
    {id:'B',name:'ATR SL + CPR TP', desc:'ATR 1.5× SL · Next CPR level as TP · Min 1:1 RR'},
    {id:'C',name:'EMA21 Filter',    desc:'ATR SL · CPR TP · Only trade in EMA21 direction'},
    {id:'D',name:'Full Filter',     desc:'ATR SL · CPR TP · EMA21 + RSI>50/<50 confirmation'},
  ];

  const results=strategies.map(s=>{
    const r=runStrategy(dailyCandles,candlesByDate,sc,days,s.id);
    console.log(`  [${s.id}] ${r.total}T | ${r.winRate}% WR | ${r.totalPips}p | $${r.totalDollar}`);
    return {...s,...r};
  });

  return {
    scriptKey,scriptName:sc.name,currency:sc.currency,
    tf,days,period:`${days} days · ${tf}`,
    strategy:'CPR Breakout — 4 Strategies',
    results,
  };
}

module.exports={runScriptBacktest,getScriptList};
