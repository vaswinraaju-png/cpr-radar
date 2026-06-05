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

// ── INDICATORS ────────────────────────────────────────────────────────────────
function calcEMA(values, period) {
  const k=2/(period+1), ema=[values[0]];
  for (let i=1;i<values.length;i++) ema.push(values[i]*k+ema[i-1]*(1-k));
  return ema;
}

function calcATR(candles, period=14) {
  const trs=candles.map((c,i)=>{
    if(i===0) return c.high-c.low;
    const p=candles[i-1];
    return Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
  });
  const atr=[trs[0]];
  for (let i=1;i<trs.length;i++) atr.push((atr[i-1]*(period-1)+trs[i])/period);
  return atr;
}

function calcRSI(closes, period=14) {
  const rsi=new Array(period).fill(null);
  let g=0,l=0;
  for (let i=1;i<=period;i++){const d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d;}
  let ag=g/period,al=l/period;
  rsi.push(al===0?100:100-(100/(1+ag/al)));
  for (let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    ag=(ag*(period-1)+(d>0?d:0))/period;
    al=(al*(period-1)+(d<0?-d:0))/period;
    rsi.push(al===0?100:100-(100/(1+ag/al)));
  }
  return rsi;
}

function calcBB(closes, period=20, mult=2) {
  const upper=[],middle=[],lower=[];
  for (let i=0;i<closes.length;i++){
    if(i<period-1){upper.push(null);middle.push(null);lower.push(null);continue;}
    const slice=closes.slice(i-period+1,i+1);
    const mean=slice.reduce((a,b)=>a+b,0)/period;
    const std=Math.sqrt(slice.reduce((s,v)=>s+(v-mean)**2,0)/period);
    middle.push(mean);upper.push(mean+mult*std);lower.push(mean-mult*std);
  }
  return {upper,middle,lower};
}

function calcStoch(candles, kPeriod=5, dPeriod=3, smooth=3) {
  const kRaw=[];
  for (let i=0;i<candles.length;i++){
    if(i<kPeriod-1){kRaw.push(null);continue;}
    const slice=candles.slice(i-kPeriod+1,i+1);
    const high=Math.max(...slice.map(c=>c.high));
    const low =Math.min(...slice.map(c=>c.low));
    kRaw.push(high===low?50:(candles[i].close-low)/(high-low)*100);
  }
  // Smooth %K
  const kSmooth=kRaw.map((v,i)=>{
    if(v===null||i<kPeriod-1+smooth-1) return null;
    const sl=kRaw.slice(i-smooth+1,i+1);
    if(sl.some(x=>x===null)) return null;
    return sl.reduce((a,b)=>a+b,0)/smooth;
  });
  // %D = SMA of smoothed %K
  const d=kSmooth.map((v,i)=>{
    if(v===null||i<kPeriod-1+smooth-1+dPeriod-1) return null;
    const sl=kSmooth.slice(i-dPeriod+1,i+1);
    if(sl.some(x=>x===null)) return null;
    return sl.reduce((a,b)=>a+b,0)/dPeriod;
  });
  return {k:kSmooth,d};
}

function calcVWAP(candles) {
  // Resets daily — group by date
  const vwap=new Array(candles.length).fill(null);
  let cumPV=0,cumV=0,curDate='';
  candles.forEach((c,i)=>{
    const date=c.datetime.split(' ')[0];
    if(date!==curDate){cumPV=0;cumV=0;curDate=date;}
    const tp=(c.high+c.low+c.close)/3;
    const vol=c.volume||1; // fallback if no volume
    cumPV+=tp*vol; cumV+=vol;
    vwap[i]=cumPV/cumV;
  });
  return vwap;
}

function calcCPR(h,l,c) {
  const pivot=(h+l+c)/3,bc=(h+l)/2,tc=(pivot-bc)+pivot;
  const r1=(2*pivot)-l,s1=(2*pivot)-h;
  const r2=pivot+(h-l),s2=pivot-(h-l);
  const r3=h+2*(pivot-l),s3=l-2*(h-pivot);
  return {pivot,bc,tc,r1,s1,r2,s2,r3,s3};
}

function nextCPRLevel(cpr, price, type) {
  if(type==='bull') {
    if(price<cpr.r1) return cpr.r1;
    if(price<cpr.r2) return cpr.r2;
    return cpr.r3;
  } else {
    if(price>cpr.s1) return cpr.s1;
    if(price>cpr.s2) return cpr.s2;
    return cpr.s3;
  }
}

// ── SUMMARISE ─────────────────────────────────────────────────────────────────
function summarise(trades, sc) {
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

// ── FETCH ─────────────────────────────────────────────────────────────────────
async function fetchCandles(scriptKey, tf, days) {
  const sc=TD_SCRIPTS[scriptKey];
  const ex=sc.exchange?`&exchange=${sc.exchange}`:'';
  const sym=encodeURIComponent(sc.symbol);
  const perDay=tf==='1min'?1440:tf==='3min'?480:tf==='5min'?288:tf==='10min'?144:tf==='15min'?96:tf==='30min'?48:24;
  const outputSize=Math.min(perDay*days+200,5000);
  const dailySize=Math.min(days+15,500);

  const [dD,tD]=await Promise.all([
    fetch(`https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${dailySize}&apikey=${tdKey()}${ex}`).then(r=>r.json()),
    fetch(`https://api.twelvedata.com/time_series?symbol=${sym}&interval=${tf}&outputsize=${outputSize}&apikey=${tdKey()}${ex}`).then(r=>r.json()),
  ]);

  if(dD.status==='error'||!dD.values) throw new Error(dD.message||'No daily data');
  if(tD.status==='error'||!tD.values) throw new Error(tD.message||`No ${tf} data`);

  const candlesByDate={};
  tD.values.forEach(c=>{
    const date=c.datetime.split(' ')[0];
    if(!candlesByDate[date]) candlesByDate[date]=[];
    candlesByDate[date].push({datetime:c.datetime,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+(c.volume||1)});
  });
  Object.keys(candlesByDate).forEach(d=>candlesByDate[d].sort((a,b)=>a.datetime.localeCompare(b.datetime)));

  return {dailyCandles:dD.values,candlesByDate,sc};
}

// ── SIMULATE TRADE ────────────────────────────────────────────────────────────
function simulateTrade(dayCandles, startIdx, type, entry, sl, tp, sc) {
  const pip=sc.pip, pipValue=sc.pipValue;
  let entryTriggered=false, exitPrice=null, exitTime=null, exitType=null;

  for(let ei=startIdx;ei<dayCandles.length;ei++){
    const ec=dayCandles[ei];
    if(!entryTriggered){
      if(type==='bull'&&ec.low<=sl) return null; // SL before entry
      if(type==='bear'&&ec.high>=sl) return null;
      if(type==='bull'&&ec.low<=entry) entryTriggered=true;
      if(type==='bear'&&ec.high>=entry) entryTriggered=true;
      if(!entryTriggered) continue;
    }
    if(type==='bull'){
      if(ec.high>=tp){exitPrice=tp;exitTime=ec.datetime;exitType='TP';break;}
      if(ec.low<=sl) {exitPrice=sl;exitTime=ec.datetime;exitType='SL';break;}
    } else {
      if(ec.low<=tp)  {exitPrice=tp;exitTime=ec.datetime;exitType='TP';break;}
      if(ec.high>=sl) {exitPrice=sl;exitTime=ec.datetime;exitType='SL';break;}
    }
  }
  if(!entryTriggered) return null;
  if(!exitPrice){const last=dayCandles[dayCandles.length-1];exitPrice=last.close;exitTime=last.datetime;exitType='EOD';}

  const pnlPips=type==='bull'?(exitPrice-entry)/pip:(entry-exitPrice)/pip;
  const win=exitType==='TP'||(exitType==='EOD'&&pnlPips>0);
  const dec=pip<0.01?5:pip<1?3:2;
  const pnlDollar=pipValue==='dynamic'?+(pnlPips*(10/entry)).toFixed(2):pipValue!=null?+(pnlPips*pipValue).toFixed(2):null;
  const rr=+Math.abs((tp-entry)/(entry-sl)).toFixed(2);

  return {exitPrice:+exitPrice.toFixed(dec),exitTime,exitType,
          pnlPips:+pnlPips.toFixed(1),pnlDollar,win,rr,marginUSD:1.00};
}

// ── 8 STRATEGIES ──────────────────────────────────────────────────────────────

// S1: EMA Crossover (EMA8 × EMA21, filter EMA50)
function runEMACross(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const closes=allC.map(c=>c.close);
  const ema8=calcEMA(closes,8), ema21=calcEMA(closes,21), ema50=calcEMA(closes,50);
  const indMap=buildIndMap(allC,i=>({ema8:ema8[i],ema21:ema21[i],ema50:ema50[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime], pind=indMap[pc.datetime];
      if(!ind||!pind||!ind.ema8||!pind.ema8) continue;

      const bullCross=pind.ema8<=pind.ema21&&ind.ema8>ind.ema21;
      const bearCross=pind.ema8>=pind.ema21&&ind.ema8<ind.ema21;
      if(!bullCross&&!bearCross) continue;

      const type=bullCross?'bull':'bear';
      if(type==='bull'&&c.close<ind.ema50) continue;
      if(type==='bear'&&c.close>ind.ema50) continue;

      const entry=c.close;
      const emaDiff=Math.abs(ind.ema8-ind.ema21);
      const sl=type==='bull'?ind.ema21:ind.ema21;
      const tp=type==='bull'?entry+2*emaDiff:entry-2*emaDiff;
      if(Math.abs(entry-sl)<pip) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res) {
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'EMA Cross',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S2: RSI 50 Cross
function runRSI50Cross(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const closes=allC.map(c=>c.close);
  const rsi=calcRSI(closes,14);
  const indMap=buildIndMap(allC,i=>({rsi:rsi[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime], pind=indMap[pc.datetime];
      if(!ind||!pind||ind.rsi==null||pind.rsi==null) continue;

      const bullCross=pind.rsi<50&&ind.rsi>=50;
      const bearCross=pind.rsi>50&&ind.rsi<=50;
      if(!bullCross&&!bearCross) continue;
      if(ind.rsi>70||ind.rsi<30) continue; // skip extremes

      const type=bullCross?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?c.low:c.high;
      const tp=nextCPRLevel(cpr,entry,type);
      if(Math.abs(entry-sl)<pip||Math.abs(tp-entry)<Math.abs(entry-sl)) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'RSI50',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S3: RSI Reversal (exits 30/70)
function runRSIReversal(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const closes=allC.map(c=>c.close);
  const rsi=calcRSI(closes,14);
  const atr=calcATR(allC,14);
  const indMap=buildIndMap(allC,i=>({rsi:rsi[i],atr:atr[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime], pind=indMap[pc.datetime];
      if(!ind||!pind||ind.rsi==null||pind.rsi==null||!ind.atr) continue;

      const bullSig=pind.rsi<30&&ind.rsi>=30; // exit oversold → long
      const bearSig=pind.rsi>70&&ind.rsi<=70; // exit overbought → short
      if(!bullSig&&!bearSig) continue;

      const type=bullSig?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?entry-1.5*ind.atr:entry+1.5*ind.atr;
      const tp=nextCPRLevel(cpr,entry,type); // TP = next CPR
      if(Math.abs(entry-sl)<pip) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'RSI Rev',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S4: Bollinger Band Touch → middle band TP
function runBBTouch(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const closes=allC.map(c=>c.close);
  const bb=calcBB(closes,20,2);
  const indMap=buildIndMap(allC,i=>({upper:bb.upper[i],middle:bb.middle[i],lower:bb.lower[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime];
      if(!ind||!ind.upper) continue;

      // Touch lower band and close back inside
      const bullSig=pc.low<=ind.lower&&c.close>ind.lower;
      // Touch upper band and close back inside
      const bearSig=pc.high>=ind.upper&&c.close<ind.upper;
      if(!bullSig&&!bearSig) continue;

      const type=bullSig?'bull':'bear';
      const entry=c.close;
      const slDist=3*pip;
      const sl=type==='bull'?entry-slDist:entry+slDist;
      const tp=ind.middle; // middle band
      if(Math.abs(tp-entry)<Math.abs(entry-sl)) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'BB Touch',slPips:3});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S5: Bollinger Band Squeeze Breakout
function runBBSqueeze(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const closes=allC.map(c=>c.close);
  const bb=calcBB(closes,20,2);
  const indMap=buildIndMap(allC,i=>({
    upper:bb.upper[i],middle:bb.middle[i],lower:bb.lower[i],
    width:bb.upper[i]&&bb.lower[i]?bb.upper[i]-bb.lower[i]:null
  }));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=5;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i];
      const ind=indMap[c.datetime];
      if(!ind||!ind.width) continue;

      // Detect squeeze: current width < avg of last 5 widths
      const prevWidths=dayCandles.slice(i-5,i).map(cc=>indMap[cc.datetime]?.width||0).filter(w=>w>0);
      if(prevWidths.length<5) continue;
      const avgW=prevWidths.reduce((a,b)=>a+b,0)/prevWidths.length;
      const squeezed=ind.width<avgW*0.7;
      if(!squeezed) continue;

      // Breakout
      const bullBreak=c.close>ind.upper;
      const bearBreak=c.close<ind.lower;
      if(!bullBreak&&!bearBreak) continue;

      const type=bullBreak?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?ind.lower:ind.upper;
      const tp=type==='bull'?entry+ind.width:entry-ind.width;
      if(Math.abs(entry-sl)<pip) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'BB Squeeze',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S6: ATR Breakout (momentum candle > 2×ATR)
function runATRBreakout(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const atr=calcATR(allC,14);
  const indMap=buildIndMap(allC,i=>({atr:atr[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i];
      const ind=indMap[c.datetime];
      if(!ind||!ind.atr) continue;

      const range=c.high-c.low;
      if(range<2*ind.atr) continue; // must be momentum candle

      const type=c.close>c.open?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?entry-0.5*ind.atr:entry+0.5*ind.atr;
      const tp=type==='bull'?entry+1*ind.atr:entry-1*ind.atr;
      if(Math.abs(entry-sl)<pip) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'ATR Break',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S7: VWAP Bounce
function runVWAPBounce(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const vwap=calcVWAP(allC);
  const atr=calcATR(allC,14);
  const indMap=buildIndMap(allC,i=>({vwap:vwap[i],atr:atr[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime];
      if(!ind||!ind.vwap||!ind.atr) continue;

      // Price touched VWAP and closed back on correct side
      const bullSig=pc.low<=ind.vwap&&c.close>ind.vwap; // bounce up from VWAP
      const bearSig=pc.high>=ind.vwap&&c.close<ind.vwap; // bounce down from VWAP
      if(!bullSig&&!bearSig) continue;

      const type=bullSig?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?entry-ind.atr:entry+ind.atr;
      const tp=nextCPRLevel(cpr,entry,type);
      if(Math.abs(entry-sl)<pip||Math.abs(tp-entry)<Math.abs(entry-sl)) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'VWAP',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// S8: Stochastic Cross at extremes
function runStochastic(dailyCandles, candlesByDate, sc, days) {
  const trades=[];
  const allC=getAllCandles(dailyCandles,candlesByDate,days);
  const stoch=calcStoch(allC,5,3,3);
  const indMap=buildIndMap(allC,i=>({k:stoch.k[i],d:stoch.d[i]}));
  const pip=sc.pip, dec=pip<0.01?5:pip<1?3:2;

  iterateDays(dailyCandles,candlesByDate,days,(date,dayCandles,cpr)=>{
    let traded=false;
    for(let i=1;i<dayCandles.length&&!traded;i++){
      const c=dayCandles[i], pc=dayCandles[i-1];
      const ind=indMap[c.datetime], pind=indMap[pc.datetime];
      if(!ind||!pind||ind.k==null||pind.k==null) continue;

      // %K crosses above %D below 20 = buy
      const bullSig=pind.k<pind.d&&ind.k>=ind.d&&ind.k<20;
      // %K crosses below %D above 80 = sell
      const bearSig=pind.k>pind.d&&ind.k<=ind.d&&ind.k>80;
      if(!bullSig&&!bearSig) continue;

      const type=bullSig?'bull':'bear';
      const entry=c.close;
      const sl=type==='bull'?c.low:c.high;
      const tp=nextCPRLevel(cpr,entry,type);
      if(Math.abs(entry-sl)<pip||Math.abs(tp-entry)<Math.abs(entry-sl)) continue;

      const res=simulateTrade(dayCandles,i+1,type,entry,sl,tp,sc);
      if(res){
        trades.push({date,type,direction:type==='bull'?'LONG':'SHORT',
          entry:+entry.toFixed(dec),sl:+sl.toFixed(dec),tp:+tp.toFixed(dec),...res,
          breakoutLevel:'Stoch',slPips:+Math.abs(entry-sl)/pip});
        traded=true;
      }
    }
  });
  return {trades,...summarise(trades,sc)};
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getAllCandles(dailyCandles, candlesByDate, days) {
  const allC=[];
  dailyCandles.slice(0,days).forEach(day=>{
    const date=(day.datetime||'').split(' ')[0];
    if(candlesByDate[date]) allC.push(...candlesByDate[date]);
  });
  return allC.sort((a,b)=>a.datetime.localeCompare(b.datetime));
}

function buildIndMap(candles, fn) {
  const map={};
  candles.forEach((c,i)=>map[c.datetime]=fn(i));
  return map;
}

function iterateDays(dailyCandles, candlesByDate, days, cb) {
  const tradingDays=dailyCandles.slice(0,days);
  for(let i=0;i<tradingDays.length;i++){
    if(i+1>=dailyCandles.length) break;
    const today=tradingDays[i], prev=dailyCandles[i+1];
    const date=(today.datetime||'').split(' ')[0];
    const dayCandles=candlesByDate[date];
    if(!dayCandles||dayCandles.length<10) continue;
    const cpr=calcCPR(+prev.high,+prev.low,+prev.close);
    cb(date,dayCandles,cpr);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const STRATEGIES = {
  'ema_cross':    { name:'EMA Crossover',      desc:'EMA8 × EMA21 crossover · Filter: EMA50 direction · TP: 2× EMA gap · SL: EMA21',          fn:runEMACross },
  'rsi50':        { name:'RSI 50 Cross',        desc:'RSI crosses 50 · TP: next CPR level · SL: signal candle low/high · Skip RSI >70/<30',    fn:runRSI50Cross },
  'rsi_reversal': { name:'RSI Reversal',        desc:'RSI exits 30/70 zone · TP: next CPR level · SL: 1.5× ATR',                               fn:runRSIReversal },
  'bb_touch':     { name:'BB Band Touch',       desc:'Price touches band + closes inside · TP: middle band · SL: 3 pips beyond band',           fn:runBBTouch },
  'bb_squeeze':   { name:'BB Squeeze Breakout', desc:'Band squeeze detected · Breakout direction · TP: band width · SL: opposite band',         fn:runBBSqueeze },
  'atr_breakout': { name:'ATR Breakout',        desc:'Momentum candle > 2× ATR · TP: 1× ATR · SL: 0.5× ATR (1:2 RR)',                         fn:runATRBreakout },
  'vwap_bounce':  { name:'VWAP Bounce',         desc:'Price bounces off VWAP · TP: next CPR level · SL: 1× ATR',                               fn:runVWAPBounce },
  'stochastic':   { name:'Stochastic Cross',    desc:'%K × %D at extremes (<20 buy, >80 sell) · TP: next CPR level · SL: signal candle',       fn:runStochastic },
};

function getStrategyList() {
  return Object.keys(STRATEGIES).map(k=>({key:k,name:STRATEGIES[k].name,desc:STRATEGIES[k].desc}));
}

async function runScriptBacktest(scriptKey, days=60, tf='15min', strategyKey='ema_cross') {
  const sc=TD_SCRIPTS[scriptKey];
  if(!sc) throw new Error('Unknown script: '+scriptKey);
  const strat=STRATEGIES[strategyKey];
  if(!strat) throw new Error('Unknown strategy: '+strategyKey);

  console.log(`[BT] ${sc.name} | ${tf} | ${days}d | ${strat.name}`);
  const {dailyCandles,candlesByDate}=await fetchCandles(scriptKey,tf,days);
  const result=strat.fn(dailyCandles,candlesByDate,sc,days);
  console.log(`  → ${result.total}T | ${result.winRate}% WR | ${result.totalPips}p | $${result.totalDollar}`);

  return {
    scriptKey,scriptName:sc.name,currency:sc.currency,
    strategyKey,strategyName:strat.name,strategyDesc:strat.desc,
    tf,days,period:`${days} days · ${tf}`,
    result,
  };
}

module.exports={runScriptBacktest,getScriptList,getStrategyList};
