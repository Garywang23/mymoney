
let DATA=null, HOLD=null, DIM='distributor', SEL='全部机构', MULTI=null, VIEW='today';
const fmt=(n,d=2)=> (n>=0?'+':'')+n.toFixed(d);
const parseD=s=>new Date(s+'T00:00:00');
const daysBetween=(a,b)=>Math.round((parseD(b)-parseD(a))/86400000);
let TX=null;
let LOCAL=null;
function loadLocal(){
  try{ LOCAL=JSON.parse(localStorage.getItem('mymoney_local_v1')||'null')||{}; }
  catch(e){ LOCAL={}; }
  LOCAL.added=LOCAL.added||[]; LOCAL.pendingAdded=LOCAL.pendingAdded||[]; LOCAL.pendingRemoved=LOCAL.pendingRemoved||[]; LOCAL.holdShares=LOCAL.holdShares||{}; LOCAL.navAdded=LOCAL.navAdded||[]; LOCAL.holdAdded=LOCAL.holdAdded||[]; LOCAL.holdDeleted=LOCAL.holdDeleted||[]; LOCAL.dataAdded=LOCAL.dataAdded||[];
  return LOCAL;
}
function saveLocal(){
  try{ localStorage.setItem('mymoney_local_v1', JSON.stringify(LOCAL)); }catch(e){}
}
function clearLocal(){ try{ localStorage.removeItem('mymoney_local_v1'); }catch(e){} LOCAL={added:[],pendingAdded:[],pendingRemoved:[],holdShares:{},navAdded:[],holdAdded:[],holdDeleted:[],dataAdded:[]}; }
async function loadData(){
  DATA=await (await fetch('nav-history.json')).json();
  HOLD=await (await fetch('holdings.json')).json();
  try{ TX=await (await fetch('transactions.json')).json(); }catch(e){ TX=null; }
  loadLocal();
  if(LOCAL.holdDeleted && LOCAL.holdDeleted.length) HOLD.products=HOLD.products.filter(p=>!LOCAL.holdDeleted.includes(p.share_code));
  (LOCAL.holdAdded||[]).forEach(h=>{ if(!HOLD.products.some(p=>p.share_code===h.share_code)) HOLD.products.push(h); });
  (LOCAL.dataAdded||[]).forEach(d=>{ if(!DATA.products.some(p=>p.share_code===d.share_code)) DATA.products.push(d); });
  if(TX){
    if(!TX.pending) TX.pending=[];
    (LOCAL.added||[]).forEach(t=>{ if(!TX.transactions.some(x=>x.product===t.product&&x.date===t.date&&x.nav_date===t.nav_date&&x.amount===t.amount&&x.shares===t.shares&&x.type===t.type)) TX.transactions.push(t); });
    (LOCAL.pendingAdded||[]).forEach(t=>{ if(!TX.pending.some(x=>x.product===t.product&&x.amount===t.amount)) TX.pending.push(t); });
    if(LOCAL.pendingRemoved && LOCAL.pendingRemoved.length) TX.pending=TX.pending.filter(p=>!LOCAL.pendingRemoved.some(r=>r.product===p.product&&r.amount===p.amount));
    if(LOCAL.holdShares) HOLD.products.forEach(p=>{ if(LOCAL.holdShares[p.share_code]!=null) p.shares=LOCAL.holdShares[p.share_code]; });
  }
  (LOCAL.navAdded||[]).forEach(n=>{
    const prod=DATA.products.find(x=>x.share_code===n.share_code); if(!prod) return;
    const existing=prod.history_desc.find(x=>x[0]===n.date);
    if(existing) existing[1]=n.nav; else { prod.history_desc.push([n.date,n.nav]); prod.history_desc.sort((a,b)=>b[0].localeCompare(a[0])); }
  });
}
function deleteProduct(share){
  const prod=HOLD.products.find(p=>p.share_code===share); if(!prod) return;
  if(!confirm('确定删除 '+prod.ledger_name+' 吗？')) return;
  HOLD.products=HOLD.products.filter(p=>p.share_code!==share);
  const inLocalAdded=LOCAL.holdAdded.some(h=>h.share_code===share);
  LOCAL.holdAdded=LOCAL.holdAdded.filter(h=>h.share_code!==share);
  if(LOCAL.holdShares) delete LOCAL.holdShares[share];
  if(!inLocalAdded && !LOCAL.holdDeleted.includes(share)) LOCAL.holdDeleted.push(share);
  saveLocal();
  if(document.getElementById('compareTable')) renderCompare();
}
function addProductToHoldings(obj){
  if(HOLD.products.some(p=>p.share_code===obj.share_code)) return {ok:false, msg:'该子份额代码已在持仓中'};
  const hold={group:obj.distributor, ledger_name:obj.ledger_name, share_code:obj.share_code, shares:obj.shares, distributor:obj.distributor, manager_short:obj.manager_short||'', manager:obj.manager||obj.manager_short||'', purchase_date:obj.purchase_date, purchase_nav:obj.purchase_nav};
  HOLD.products.push(hold); LOCAL.holdAdded.push(hold);
  LOCAL.holdDeleted=LOCAL.holdDeleted.filter(s=>s!==obj.share_code);
  let dataExists=DATA.products.some(p=>p.share_code===obj.share_code);
  if(!dataExists){
    const data={ledger_name:obj.ledger_name, share_code:obj.share_code, manager:obj.manager||obj.manager_short||'', registration_code:obj.registration_code||'', history_desc:[[obj.purchase_date, obj.purchase_nav]], official_source:''};
    DATA.products.push(data); LOCAL.dataAdded.push(data);
  }
  if(TX){
    const rec={type:'买入', product:obj.ledger_name, distributor:obj.distributor, date:nextWorkingDay(obj.purchase_date), shares:obj.shares, amount:Math.round(obj.shares*obj.purchase_nav*100)/100, nav_date:obj.purchase_date};
    TX.transactions.push(rec); LOCAL.added.push(rec);
  }
  saveLocal();
  return {ok:true};
}
function setTxt(id, txt){const e=document.getElementById(id); if(e) e.textContent=txt;}
function navProd(share){ return DATA.products.find(x=>x.share_code===share); }
function histAsc(share){ const p=navProd(share); return p?p.history_desc.slice().sort((a,b)=>a[0].localeCompare(b[0])):[]; }
function navAsOf(share, dateStr){
  const h=histAsc(share).filter(x=>x[0]<=dateStr);
  return h.length?h[h.length-1]:null;
}
function prevNav(share, dateStr){
  const h=histAsc(share).filter(x=>x[0]<=dateStr);
  return h.length>1?h[h.length-2]:null;
}
function calc(share, asOf){
  const hold=HOLD.products.find(p=>p.share_code===share); if(!hold) return null;
  const cur=navAsOf(share, asOf); if(!cur) return null;
  const prev=prevNav(share, asOf);
  const amount=hold.shares*cur[1];
  const daily=prev?hold.shares*(cur[1]-prev[1]):0;
  const month=cur[0].slice(0,7);
  // 本月收益必须按日份额算，不能按现在份额 ×（最新 - 月初）：诚享10月内多次买卖，旧算法算出 630.00，实际按日份额是 492.99（目标 509.26，差在四舍五入净值）
  let monthly=0, monthStartNav=null, monthStartDate=null;
  if(TX){
    const h=histAsc(share);
    for(let i=1;i<h.length;i++){
      if(!h[i][0].startsWith(month) || h[i][0]>asOf) continue;
      monthly+=lotShares(hold.ledger_name, h[i][0])*(h[i][1]-h[i-1][1]);
    }
    const beforeMonth=h.filter(x=>x[0]<month+'-01');
    if(beforeMonth.length){ monthStartNav=beforeMonth[beforeMonth.length-1][1]; monthStartDate=beforeMonth[beforeMonth.length-1][0]; }
  } else {
    const beforeMonth=histAsc(share).filter(x=>x[0]<month+'-01');
    if(hold.purchase_date.slice(0,7)===month){ monthStartNav=hold.purchase_nav; monthStartDate=hold.purchase_date; }
    else if(beforeMonth.length){ monthStartNav=beforeMonth[beforeMonth.length-1][1]; monthStartDate=beforeMonth[beforeMonth.length-1][0]; }
    monthly=monthStartNav!=null?hold.shares*(cur[1]-monthStartNav):0;
  }
  const holdingPnl=hold.shares*(cur[1]-hold.purchase_nav);
  const principal=hold.shares*hold.purchase_nav;
  const daysHeld=daysBetween(hold.purchase_date, cur[0]);
  const holdingAnn=daysHeld>0?holdingPnl/principal*365/daysHeld*100:0;
  return {hold, cur, prev, amount, daily, monthly, holdingPnl, holdingAnn, monthStartNav, monthStartDate, principal, daysHeld};
}
function viewAsOf(share){
  const h=histAsc(share); return h.length?h[h.length-1][0]:null;
}
function lotShares(ledgerName, dateStr){
  if(!TX) return 0;
  let sh=0;
  const mine=TX.transactions.filter(t=>t.product===ledgerName);
  mine.forEach(t=>{
    const nd=t.nav_date||t.date;
    if(nd < dateStr) sh += (t.type==='卖出' ? -t.shares : t.shares);
  });
  // 份额锚点：交易单合计与持仓不一致时，以持仓为准。诚享交易单合计 349,999.99，持仓 350,000.00，差 0.01（某笔份额四舍五入），
  // 日期晚于最后一笔交易净值日时直接返回持仓份额，不再用合计的 349,999.99。
  if(HOLD && mine.length){
    const hold=HOLD.products.find(x=>x.ledger_name===ledgerName);
    if(hold){
      const lastNd=mine.map(t=>t.nav_date||t.date).sort().pop();
      if(dateStr > lastNd) return hold.shares;
    }
  }
  return sh;
}
function lotCalendar(){
  const cal={}, det={};
  HOLD.products.forEach(p=>{
    const h=histAsc(p.share_code);
    for(let i=1;i<h.length;i++){
      const d=h[i][0];
      const sh=lotShares(p.ledger_name, d);
      if(sh<=0) continue;
      const gain=sh*(h[i][1]-h[i-1][1]);
      cal[d]=(cal[d]||0)+gain;
      (det[d]=det[d]||[]).push({name:p.ledger_name, code:p.share_code, distributor:p.distributor, shares:sh, prev:h[i-1][1], prevDate:h[i-1][0], nav:h[i][1], gain});
    }
  });
  return {cal, det};
}
const OLD_CAL={'2026-10-08':341.20,'2026-10-09':146.30,'2026-10-10':9.16,'2026-10-12':271.94,'2026-10-13':116.70,'2026-10-14':155.03,'2026-10-15':241.77,'2026-10-16':193.55,'2026-10-19':54.44,'2026-10-20':332.72,'2026-10-21':229.79,'2026-10-22':81.60,'2026-10-23':128.60};
function applyView(){
  const {cal}=lotCalendar();
  let total=0, dailyLatest=0;
  HOLD.products.forEach(p=>{
    const asOf=viewAsOf(p.share_code); const c=calc(p.share_code, asOf);
    total+=c.amount; dailyLatest+=c.daily;
  });
  const monthTotal=Object.keys(cal).reduce((a,d)=>a+cal[d],0);
  setTxt('totalHolding', total.toLocaleString(undefined,{maximumFractionDigits:2}));
  setTxt('leftTitle', '收益总揽');
  setTxt('leftBig', total.toLocaleString(undefined,{maximumFractionDigits:2}));
  setTxt('leftSub', '持仓总金额（元）= 份额 × 各产品最新管理人官网净值');
  setTxt('detailTitle', '收益明细 · 各产品最新净值日');
  setTxt('monthPnl', fmt(monthTotal));
  setTxt('monthAnn', '当前8只10月合计（见说明）');
  const _tt=document.getElementById('tabToday'); if(_tt) _tt.className='on';
}
function renderTx(){
  if(!TX || !document.getElementById('txSummary')) return;
  const buys=TX.transactions.filter(t=>t.type==='买入').length;
  const sells=TX.transactions.filter(t=>t.type==='卖出').length;
  const pend=TX.pending||[];
  document.getElementById('txSummary').textContent='目前8只：买入'+buys+'次、卖出'+sells+'次、待确认'+pend.length+'笔'+(pend.length?'（'+pend.map(p=>p.product+' '+p.amount.toLocaleString(undefined,{minimumFractionDigits:2})).join('、')+'）':'')+'。';
  const draw=()=>{
    const m=document.getElementById('txMonth').value, inst=document.getElementById('txInst').value;
    let list=TX.transactions.filter(t=>(m==='全部月份'||t.date.startsWith(m))&&(inst==='全部机构'||t.distributor===inst));
    list=list.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.amount-a.amount);
    let html=pend.length?pend.map(p=>'<div class="muted" style="margin-top:10px">待确认：'+p.product+' · '+(p.distributor||'')+' · 确认日 -- · 份额 -- · '+p.amount.toLocaleString(undefined,{minimumFractionDigits:2})+'</div>').join(''):'<div class="muted" style="margin-top:10px">暂无待确认交易。</div>';
    let lastMonth='';
    list.forEach(t=>{
      const mm=t.date.slice(0,7); if(mm!==lastMonth){ lastMonth=mm; html+='<div class="groupHead"><span>'+mm+'</span></div>'; }
      html+='<div class="row" style="border-bottom:1px solid #eee;padding:8px 0"><span><b style="color:'+(t.type==='卖出'?'#0a7d4a':'#e60012')+'">'+(t.type==='卖出'?'赎回':t.type)+'</b> '+t.product+'<br><span class="muted">'+t.distributor+' · 确认日 '+t.date+' · 净值日 '+(t.nav_date||'--')+' · 份额 '+t.shares.toLocaleString()+'</span></span><b>'+t.amount.toLocaleString(undefined,{minimumFractionDigits:2})+'</b></div>';
    });
    document.getElementById('txList').innerHTML=html;
  };
  document.getElementById('txMonth').onchange=draw; document.getElementById('txInst').onchange=draw; draw();
}
let CAL_MONTH=null, CAL_VIEW='day';
function calMonths(){ const s=new Set(); DATA.products.forEach(p=>p.history_desc.forEach(([d])=>s.add(d.slice(0,7)))); return [...s].sort(); }
function setCalMonth(m){ CAL_MONTH=m; renderCalendar(); }
function setCalView(v){ CAL_VIEW=v; renderCalendar(); }
function setCalMonthView(m){ CAL_MONTH=m; CAL_VIEW='day'; renderCalendar(); }
function monthTotal(cal, month){ return Object.keys(cal).filter(d=>d.startsWith(month)).reduce((a,d)=>a+cal[d],0); }
function fmtDateLocal(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
function latestCompleteDate(){
  let common=null;
  HOLD.products.forEach(p=>{
    const dates=new Set(histAsc(p.share_code).map(x=>x[0]));
    common = common===null ? dates : new Set([...common].filter(d=>dates.has(d)));
  });
  if(!common || !common.size) return null;
  return [...common].sort().pop();
}

function renderTodaySummary(){
  const wrap=document.getElementById('todaySummary'); if(!wrap) return;
  const {cal, det}=lotCalendar();
  const ds=latestCompleteDate(); if(!ds){ wrap.innerHTML='<p class="muted">暂无8只共有的净值日。</p>'; return; }
  const rows=det[ds]||[];
  const todayGain=cal[ds]||0;
  const todayAmt=rows.reduce((a,r)=>a+r.shares*r.nav,0);
  const wan=todayAmt?todayGain/todayAmt*10000:0;
  const month=ds.slice(0,7);
  const monthGain=Object.keys(cal).filter(d=>d.startsWith(month)).reduce((a,d)=>a+cal[d],0);
  const pm=new Date(month+'-01T00:00:00'); pm.setMonth(pm.getMonth()-1);
  const prevMonth=pm.getFullYear()+'-'+String(pm.getMonth()+1).padStart(2,'0');
  const prevGain=Object.keys(cal).filter(d=>d.startsWith(prevMonth)).reduce((a,d)=>a+cal[d],0);
  const prevAmt=(()=>{
    const [py,pm]=prevMonth.split('-').map(Number);
    const nextStr=fmtDateLocal(new Date(py, pm, 1));
    let total=0;
    HOLD.products.forEach(p=>{
      const h=histAsc(p.share_code).filter(x=>x[0]<nextStr);
      if(!h.length) return;
      const last=h[h.length-1];
      let sh=0;
      (TX?TX.transactions:[]).filter(t=>t.product===p.ledger_name).forEach(t=>{ const nd=t.nav_date||t.date; if(nd<nextStr) sh+=t.type==='卖出'?-t.shares:t.shares; });
      total+=sh*last[1];
    });
    return total;
  })();
  const monthAnn=todayAmt?monthGain/todayAmt*12*100:null;
  const prevAnn=prevAmt?prevGain/prevAmt*12*100:null;
  wrap.innerHTML='<div class="row"><h2>今日收益总揽</h2><span class="muted">'+ds+' 已全部更新</span></div>'
    +'<div style="text-align:center;margin:8px 0"><b'+gainCls(todayGain)+' style="font-size:28px">'+fmt(todayGain)+' ('+fmt(wan)+')</b></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +'<div style="background:#f7f7f7;padding:10px;border-radius:8px"><div class="muted">本月收益</div><b'+gainCls(monthGain)+'>'+fmt(monthGain)+'</b></div>'
    +'<div style="background:#f7f7f7;padding:10px;border-radius:8px"><div class="muted">本月年化</div><b'+annCls(monthAnn)+'>'+pctTxt(monthAnn)+'</b></div>'
    +'<div style="background:#f7f7f7;padding:10px;border-radius:8px"><div class="muted">上月收益</div><b'+gainCls(prevGain)+'>'+fmt(prevGain)+'</b></div>'
    +'<div style="background:#f7f7f7;padding:10px;border-radius:8px"><div class="muted">上月年化</div><b'+annCls(prevAnn)+'>'+pctTxt(prevAnn)+'</b></div>'
    +'</div>';
}

function renderHomeTotal(){
  const wrap=document.getElementById('homeTotal'); if(!wrap) return;
  let total=0;
  HOLD.products.forEach(p=>{ const c=calc(p.share_code, viewAsOf(p.share_code)); total+=c.amount; });
  wrap.innerHTML='<div class="muted">持仓总金额（元）</div><div style="font-size:30px;font-weight:800;color:#e60012">'+total.toLocaleString(undefined,{maximumFractionDigits:2})+'</div>';
}
function renderHomeDetail(){
  const wrap=document.getElementById('homeDetail'); if(!wrap) return;
  const ds=latestCompleteDate(); if(!ds){ wrap.innerHTML='<p class="muted">暂无8只共有的净值日。</p>'; return; }
  const {det}=lotCalendar(); const rows=det[ds]||[];
  let html='<h4 style="margin:0 0 8px">收益明细 · '+ds+' · <a href="day.html?date='+ds+'">查看每日详细 →</a></h4>';
  ['网商银行','微众稳健'].forEach(g=>{
    const gr=rows.filter(r=>r.distributor===g);
    if(!gr.length) return;
    const gGain=gr.reduce((a,r)=>a+r.gain,0); const gAmt=gr.reduce((a,r)=>a+r.shares*r.nav,0); const gWan=gAmt?gGain/gAmt*10000:0;
    html+='<div class="groupHead"><span>'+g+'('+gr.length+')</span><span'+gainCls(gGain)+'>'+fmt(gGain)+' 万收('+fmt(gWan)+')</span></div>';
    html+='<table><tr><th>产品</th><th>持有份额</th><th>持有金额</th><th>当日盈亏</th><th>本月收益</th><th>持仓盈亏</th><th>持有年化</th></tr>';
    gr.forEach(r=>{
      const hold=HOLD.products.find(p=>p.ledger_name===r.name); const c=calc(hold.share_code, ds);
      const wan=(r.shares*r.nav)?r.gain/(r.shares*r.nav)*10000:0;
      html+='<tr><td><a href="detail.html?share='+encodeURIComponent(hold.share_code)+'">'+r.name+'</a> <span'+gainCls(wan)+'>('+wan.toFixed(2)+')</span></td><td>'+r.shares.toLocaleString()+'</td><td>'+(r.shares*r.nav).toLocaleString(undefined,{maximumFractionDigits:2})+'</td><td'+gainCls(r.gain)+'>'+fmt(r.gain)+'</td><td'+gainCls(c.monthly)+'>'+fmt(c.monthly)+'</td><td'+gainCls(c.holdingPnl)+'>'+fmt(c.holdingPnl)+'</td><td'+gainCls(c.holdingAnn)+'>'+fmt(c.holdingAnn)+'%</td></tr>';
    });
    html+='</table>';
  });
  wrap.innerHTML=html;
}
function prevCalMonth(){ const months=calMonths(); const i=months.indexOf(CAL_MONTH); if(i>0) setCalMonth(months[i-1]); }
function nextCalMonth(){ const months=calMonths(); const i=months.indexOf(CAL_MONTH); if(i>=0&&i<months.length-1) setCalMonth(months[i+1]); }
function renderCalendar(){
  const wrap=document.getElementById('calendar'); if(!wrap) return;
  const {cal}=lotCalendar();
  const months=calMonths();
  if(!CAL_MONTH || !months.includes(CAL_MONTH)) CAL_MONTH=months[months.length-1];
  const ctrl=document.getElementById('calControls');
  if(ctrl){
    ctrl.innerHTML='<div class="row" style="flex-wrap:wrap;gap:8px"><span>'+['day','week','month'].map(v=>'<button class="pill '+(CAL_VIEW===v?'on':'')+'" onclick="setCalView(\''+v+'\')">'+(v==='day'?'日':v==='week'?'周':'月')+'</button>').join(' ')+'</span><span><button class="pill" onclick="prevCalMonth()">‹</button><b>'+CAL_MONTH.slice(0,4)+'年'+CAL_MONTH.slice(5)+'月</b><button class="pill" onclick="nextCalMonth()">›</button><select onchange="setCalMonth(this.value)">'+months.map(m=>'<option value="'+m+'"'+(m===CAL_MONTH?' selected':'')+'>'+m+'</option>').join('')+'</select><span'+gainCls(monthTotal(cal,CAL_MONTH))+'> '+CAL_MONTH+'合计 '+fmt(monthTotal(cal,CAL_MONTH))+'</span></span></div>';
  }
  if(CAL_VIEW==='week'){
    wrap.style.display='block';
    const weeks={};
    Object.keys(cal).filter(d=>d.startsWith(CAL_MONTH)).sort().forEach(d=>{
      const dt=parseD(d); const start=new Date(dt); start.setDate(dt.getDate()-dt.getDay());
      const key=fmtDateLocal(start); const end=new Date(start); end.setDate(start.getDate()+6);
      if(!weeks[key]) weeks[key]={start:key, end:fmtDateLocal(end), total:0, count:0};
      weeks[key].total+=cal[d]; weeks[key].count++;
    });
    let html='';
    Object.values(weeks).forEach(w=>{ html+='<div class="row" style="border-bottom:1px solid #eee;padding:10px 0"><span style="white-space:nowrap">'+w.start.slice(5)+' ~ '+w.end.slice(5)+' <span class="muted">'+w.count+'日</span></span><b'+gainCls(w.total)+'>'+fmt(w.total)+'</b></div>'; });
    wrap.innerHTML=html; return;
  }
  if(CAL_VIEW==='month'){
    wrap.style.display='block';
    let html='';
    months.forEach(m=>{
      const dates=Object.keys(cal).filter(d=>d.startsWith(m));
      html+='<div class="row" style="border-bottom:1px solid #eee;padding:10px 0"><span style="white-space:nowrap">'+m+' <span class="muted">'+dates.length+'日</span></span><span><b'+gainCls(monthTotal(cal,m))+'>'+fmt(monthTotal(cal,m))+'</b> <button class="pill" onclick="setCalMonthView(\''+m+'\')">看日历</button></span></div>';
    });
    wrap.innerHTML=html; return;
  }
  wrap.style.display='';
  const [y, mo]=CAL_MONTH.split('-').map(Number);
  const firstWeekday=new Date(y, mo-1, 1).getDay();
  const daysInMonth=new Date(y, mo, 0).getDate();
  let html=['日','一','二','三','四','五','六'].map(d=>'<div class="muted"><b>'+d+'</b></div>').join('');
  for(let i=0;i<firstWeekday;i++) html+='<div></div>';
  for(let d=1;d<=daysInMonth;d++){
    const ds=CAL_MONTH+'-'+String(d).padStart(2,'0'); const v=cal[ds];
    if(v!=null){
      html+='<div class="cell has"><a href="day.html?date='+ds+'">'+d+'<div class="v" style="color:'+(v>0?'#e60012':'#0a7d4a')+'">'+fmt(v)+'</div></a></div>';
    } else {
      html+='<div class="cell">'+d+'</div>';
    }
  }
  wrap.innerHTML=html;
}
let CMP_SORT={key:'wan',dir:-1};
function sortCompare(key){ if(CMP_SORT.key===key) CMP_SORT.dir*=-1; else CMP_SORT={key,dir:key==='name'?1:-1}; renderCompare(); }
function gainCls(v){ return v==null?'':(v>0?' class="gain-pos"':' class="gain-neg"'); }
function annCls(v){ if(v==null) return ''; if(v<0) return ' class="gain-neg"'; return v>2?' class="ann-high"':''; }
function zeroDays(share){ const rows=metricsFor(share); if(!rows.length) return {count:0, dates:[], list:[]}; const month=rows[0].date.slice(0,7); const bad=rows.filter(r=>r.wan!=null && r.wan<=0 && r.date.startsWith(month)); return {count:bad.length, dates:bad.map(r=>r.date), list:bad}; }
function renderCompare(){
  const wrap=document.getElementById('compareTable'); if(!DATA||!HOLD) return;
  if(CMP_SORT.key==='rise7'||CMP_SORT.key==='rise14') CMP_SORT={key:'rise30',dir:-1};
  if(CMP_SORT.key==='shares'||CMP_SORT.key==='amount'||CMP_SORT.key==='daily') CMP_SORT={key:'wan',dir:-1};
  const countEl=document.getElementById('compareCount'); if(countEl) countEl.textContent=HOLD.products.length+'只';
  const rows=[];
  HOLD.products.forEach(p=>{
    const h=histAsc(p.share_code); if(!h.length) return;
    const latest=h[h.length-1], prev=h.length>1?h[h.length-2]:null;
    const allM=metricsFor(p.share_code);
    const m=allM.find(r=>r.date===latest[0]) || allM[0];
    const month=allM.length?allM[0].date.slice(0,7):''; const zero=allM.filter(r=>r.wan!=null && r.wan<=0 && r.date.startsWith(month)).length;
    const wan=prev?(latest[1]/prev[1]-1)*10000:0;
    const rise=win=>{
      const td=parseD(latest[0]); const cutoff=new Date(td); cutoff.setDate(cutoff.getDate()-win);
      const cand=h.filter(x=>parseD(x[0])<=cutoff);
      if(!cand.length) return null;
      const base=cand[cand.length-1];
      const days=daysBetween(base[0], latest[0]);
      return {pct:(latest[1]/base[1]-1)*100, ann:days>0?(latest[1]/base[1]-1)*365/days*100:null};
    };
    const r30=rise(30);
    const c=calc(p.share_code, latest[0]); if(!c) return;
    rows.push({name:p.ledger_name, code:p.share_code, distributor:p.distributor, date:latest[0], nav:latest[1], wan, avg7:m?m.avg7:0, avg14:m?m.avg14:0, ann7:m?m.ann7:null, ann14:m?m.ann14:null, ann30:m?m.ann30:null, rise30:r30?r30.pct:null, zero, daily:c.daily});
  });
  const k=CMP_SORT.key, d=CMP_SORT.dir;
  rows.sort((a,b)=>{
    const va=a[k], vb=b[k];
    if(va==null&&vb==null) return 0;
    if(va==null) return 1;
    if(vb==null) return -1;
    if(typeof va==='string') return d*va.localeCompare(vb);
    return d*(va-vb);
  });
  const cols=[['name','产品'],['date','净值日期'],['wan','当日万收'],['avg7','7日日均'],['avg14','14日日均'],['zero','挂0'],['ann7','7日年化'],['ann14','14日年化'],['ann30','1月年化'],['rise30','1月涨幅'],['nav','最新净值'],['del','操作']];
  const header='<tr>'+cols.map(([key,label])=>key==='del'?'<th>操作</th>':'<th onclick="sortCompare(\''+key+'\')">'+label+(CMP_SORT.key===key?(CMP_SORT.dir===1?' ▲':' ▼'):'')+'</th>').join('')+'</tr>';
  const groupOrder=['网商银行','微众稳健'];
  rows.forEach(r=>{ if(!groupOrder.includes(r.distributor)) groupOrder.push(r.distributor); });
  let html='', globalIdx=0;
  groupOrder.forEach(g=>{
    const gr=rows.filter(r=>r.distributor===g); if(!gr.length) return;
    html+='<div class="split-group"><div class="groupHead"><span>'+g+'('+gr.length+')</span></div><div style="overflow-x:auto">';
    html+='<table>'+header;
    gr.forEach(r=>{
      html+='<tr'+(globalIdx===0?' style="background:#fff7e6"':'')+'><td><a href="detail.html?share='+encodeURIComponent(r.code)+'">'+r.name+'</a><br><span class="muted">'+r.code+'</span></td><td>'+r.date.slice(5)+'</td><td'+gainCls(r.wan)+'>'+r.wan.toFixed(2)+'</td><td'+gainCls(r.avg7)+'>'+r.avg7.toFixed(2)+'</td><td'+gainCls(r.avg14)+'>'+r.avg14.toFixed(2)+'</td><td'+(r.zero>0?' class="gain-neg"':'')+'>'+r.zero+'</td><td'+annCls(r.ann7)+'>'+pctTxt(r.ann7)+'</td><td'+annCls(r.ann14)+'>'+pctTxt(r.ann14)+'</td><td'+annCls(r.ann30)+'>'+pctTxt(r.ann30)+'</td><td'+gainCls(r.rise30)+'>'+(r.rise30==null?'—':r.rise30.toFixed(2)+'%')+'</td><td>'+r.nav+'</td><td><button class="pill" onclick="deleteProduct(\''+r.code+'\')">删除</button></td></tr>';
      globalIdx++;
    });
    html+='</table></div></div>';
  });
  wrap.innerHTML=html;
}
function instList(){ return DIM==='distributor'?HOLD.institutions.distributor:HOLD.institutions.manager_short; }
function instOf(p){ return DIM==='distributor'?p.distributor:p.manager_short; }
function buildInstControls(){
  const sel=document.getElementById('instSel'); sel.innerHTML='';
  ['全部机构',...instList()].forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
  sel.value=SEL;
  sel.onchange=()=>{SEL=sel.value;MULTI=null;renderHoldings();};
  document.getElementById('dTabDist').onclick=()=>{DIM='distributor';SEL='全部机构';MULTI=null;document.getElementById('dTabDist').className='pill on';document.getElementById('dTabMgr').className='pill';buildInstControls();renderHoldings();};
  document.getElementById('dTabMgr').onclick=()=>{DIM='manager_short';SEL='全部机构';MULTI=null;document.getElementById('dTabDist').className='pill';document.getElementById('dTabMgr').className='pill on';buildInstControls();renderHoldings();};
  document.getElementById('multiBtn').onclick=()=>{
    const box=document.getElementById('multiBox'); box.style.display=box.style.display==='block'?'none':'block';
    if(box.style.display!=='block') return;
    box.innerHTML=instList().map(n=>'<label style="display:inline-block;margin:4px"><input type="checkbox" value="'+n+'"> '+n+'</label>').join('')+' <button id="multiOk">确定</button>';
    box.querySelector('#multiOk').onclick=()=>{
      const checked=[...box.querySelectorAll('input:checked')].map(x=>x.value);
      MULTI=(checked.length===0||checked.length===instList().length)?null:checked;
      box.style.display='none'; renderHoldings();
    };
  };
}
function renderHoldings(){
  const wrap=document.getElementById('holdings'); let html='';
  const groups=MULTI?MULTI:(SEL==='全部机构'?instList():[SEL]);
  groups.forEach(gname=>{
    const prods=HOLD.products.filter(p=>instOf(p)===gname);
    let total=0, daily=0;
    prods.forEach(p=>{ const c=calc(p.share_code, viewAsOf(p.share_code)); total+=c.amount; if(!(VIEW==='next' && viewAsOf(p.share_code)==='2026-10-23')) daily+=c.daily; });
    const wanTxt=total?fmt(daily/total*10000):'0.00';
    html+='<div class="groupHead"><span>'+gname+'('+prods.length+')</span><span'+gainCls(daily)+'>'+fmt(daily)+' 万收('+wanTxt+')</span></div>';
    if(!prods.length){ html+='<div class="muted" style="padding:10px">暂无持仓明细，持仓总金额 0.00、当日收益 0.00</div>'; return; }
    prods.forEach(p=>{
      const asOf=viewAsOf(p.share_code); const c=calc(p.share_code, asOf); const other=DIM==='distributor'?('管理：'+p.manager_short):('代销：'+p.distributor);
      const updated=true;
      const badge=asOf.slice(5)+' ('+fmt(c.daily/c.amount*10000)+')';
      html+='<div class="card prod" data-share="'+p.share_code+'"><div class="row"><b>'+p.ledger_name+' <span class="muted">('+p.share_code+')</span></b><span'+gainCls(c.holdingAnn)+' style="font-size:18px;font-weight:800">持有年化 '+fmt(c.holdingAnn)+'%</span><span style="color:'+(updated?'#2563eb':'#e60012')+'">'+badge+'</span></div>'
        +'<div class="prod cols"><div><span class="muted">持有金额</span><b>'+c.amount.toLocaleString(undefined,{maximumFractionDigits:2})+'</b></div><div><span class="muted">当日盈亏</span><b'+gainCls(c.daily)+'>'+(updated?fmt(c.daily):'—')+'</b></div><div><span class="muted">本月收益</span><b'+gainCls(c.monthly)+'>'+fmt(c.monthly)+'</b></div><div><span class="muted">持仓盈亏</span><b'+gainCls(c.holdingPnl)+'>'+fmt(c.holdingPnl)+'</b></div><div><span class="muted">持有年化</span><b'+gainCls(c.holdingAnn)+'>'+fmt(c.holdingAnn)+'%</b></div></div>'
        +'<div class="muted">份额 '+p.shares.toLocaleString()+' · 净值 '+c.cur[1]+'（'+c.cur[0]+'） · 买入 '+p.purchase_date+' @ '+p.purchase_nav+' · '+other+'</div></div>';
    });
  });
  wrap.innerHTML=html;
  wrap.querySelectorAll('.prod').forEach(el=>{
    el.onclick=()=>{ location.href='detail.html?share='+encodeURIComponent(el.dataset.share); };
  });
}
function metricsFor(share){
  const hold=HOLD.products.find(p=>p.share_code===share); if(!hold) return [];
  const h=histAsc(share).filter(x=>x[0]>=hold.purchase_date); const wan={};
  for(let i=0;i<h.length;i++){
    if(h[i][0]===hold.purchase_date) continue;
    let prevNav;
    if(i===0) prevNav=hold.purchase_nav;
    else if(h[i-1][0]<hold.purchase_date) prevNav=hold.purchase_nav;
    else prevNav=h[i-1][1];
    // first NAV after purchase: prev is purchase_nav, handled by i===0 case when history starts at purchase, otherwise previous entry is purchase date itself
    if(i>0 && h[i-1][0]===hold.purchase_date) prevNav=hold.purchase_nav;
    wan[h[i][0]]=(h[i][1]/prevNav-1)*10000;
  }
  const rows=[];
  h.slice().reverse().forEach(([date,nav])=>{
    if(date<=hold.purchase_date) return;
    const td=parseD(date);
    const avg=n=>{ let s=0; Object.keys(wan).forEach(d=>{ const dd=parseD(d); if(dd<=td && (td-dd)/86400000 < n) s+=wan[d]; }); return s/n; };
    const ann=windowDays=>{
      const cutoff=new Date(td); cutoff.setDate(cutoff.getDate()-windowDays);
      let cand=h.filter(x=>parseD(x[0])<=cutoff && parseD(x[0])>=parseD(hold.purchase_date));
      let base, days;
      if(cand.length){ base=cand[cand.length-1]; days=daysBetween(base[0], date); }
      else { base=[hold.purchase_date, hold.purchase_nav]; days=daysBetween(hold.purchase_date, date); }
      if(days<=0) return null;
      return (nav/base[1]-1)*365/days*100;
    };
    const risePct=windowDays=>{
      const cutoff=new Date(td); cutoff.setDate(cutoff.getDate()-windowDays);
      let cand=h.filter(x=>parseD(x[0])<=cutoff && parseD(x[0])>=parseD(hold.purchase_date));
      let base, days;
      if(cand.length){ base=cand[cand.length-1]; days=daysBetween(base[0], date); }
      else { base=[hold.purchase_date, hold.purchase_nav]; days=daysBetween(hold.purchase_date, date); }
      if(days<=0) return null;
      return (nav/base[1]-1)*100;
    };
    rows.push({date, nav, wan:wan[date]!=null?wan[date]:null, avg7:avg(7), avg14:avg(14), ann7:ann(7), ann14:ann(14), ann30:ann(30), rise30:risePct(30)});
  });
  return rows;
}
function wanTxt(n){ return n==null?'—':n.toFixed(2); }
function pctTxt(n){ return n==null?'—':fmt(n)+'%'; }
function render(){
  const wrap=document.getElementById('list'); wrap.innerHTML='';
  DATA.products.forEach(p=>{
    const hist=p.history_desc, latest=hist.slice().sort((a,b)=>b[0].localeCompare(a[0]))[0];
    const rows=metricsFor(p.share_code);
    const el=document.createElement('div'); el.className='card'; el.dataset.share=p.share_code;
    el.innerHTML='<h3 style="margin:0">'+p.ledger_name+' · '+latest[1]+'</h3><div class="muted">'+p.share_code+'</div>'
      +'<div class="detail"><h4>近30日</h4><table><tr><th>净值日期</th><th>当日万收</th><th>近七日日均</th><th>近14日日均</th><th>近7日年化</th><th>近14日年化</th><th>近一月年化</th><th>1月涨幅</th></tr>'
      +rows.map(r=>'<tr><td>'+r.date+'</td><td'+gainCls(r.wan)+'>'+wanTxt(r.wan)+'</td><td'+gainCls(r.avg7)+'>'+r.avg7.toFixed(2)+'</td><td'+gainCls(r.avg14)+'>'+r.avg14.toFixed(2)+'</td><td'+annCls(r.ann7)+'>'+pctTxt(r.ann7)+'</td><td'+annCls(r.ann14)+'>'+pctTxt(r.ann14)+'</td><td'+annCls(r.ann30)+'>'+pctTxt(r.ann30)+'</td><td'+gainCls(r.rise30)+'>'+(r.rise30==null?'—':r.rise30.toFixed(2)+'%')+'</td></tr>').join('')+'</table></div>';
    el.querySelector('h3').onclick=()=>{const d=el.querySelector('.detail'); d.style.display=d.style.display==='block'?'none':'block';};
    wrap.appendChild(el);
  });
}
function addDaysStr(dateStr, n){ const d=parseD(dateStr); d.setDate(d.getDate()+n); return fmtDateLocal(d); }
function nextWorkingDay(dateStr){
  let d=parseD(dateStr);
  do{ d.setDate(d.getDate()+1); }while(d.getDay()===0 || d.getDay()===6);
  return fmtDateLocal(d);
}
function minHoldingDays(ledgerName){
  const m=ledgerName.match(/(\d+)天/); return m?parseInt(m[1],10):null;
}
function txForProduct(ledgerName){
  if(!TX) return {buys:[], sells:[], pending:[]};
  const all=TX.transactions.filter(t=>t.product===ledgerName);
  const buys=all.filter(t=>t.type==='买入').sort((a,b)=>b.date.localeCompare(a.date)||b.amount-a.amount);
  const sells=all.filter(t=>t.type==='卖出').sort((a,b)=>b.date.localeCompare(a.date)||b.amount-a.amount);
  const pending=(TX.pending||[]).filter(t=>t.product===ledgerName);
  return {buys, sells, pending};
}
function redeemableDates(ledgerName){
  const {buys}=txForProduct(ledgerName); const days=minHoldingDays(ledgerName);
  if(!days || !buys.length) return null;
  const dates=buys.map(t=>addDaysStr(t.date, days)).sort();
  return {days, earliest:dates[0], latest:dates[dates.length-1]};
}
function renderProductDetail(share){
  const wrap=document.getElementById('list'); if(!wrap) return null;
  const p=navProd(share); if(!p) { wrap.innerHTML='<p class="muted">找不到该产品。</p>'; return null; }
  const hold=HOLD.products.find(x=>x.share_code===share); if(!hold) { wrap.innerHTML='<p class="muted">该产品已不在当前持仓。</p>'; return null; }
  const asOf=viewAsOf(share); const c=calc(share, asOf); if(!c) { wrap.innerHTML='<p class="muted">该产品暂无净值。</p>'; return null; }
  const rows=metricsFor(share);
  const {buys, sells, pending}=txForProduct(hold.ledger_name);
  const red=redeemableDates(hold.ledger_name);
  const navOn=ds=>{ const h=histAsc(share).find(x=>x[0]===ds); return h?h[1]:null; };
  const txRow=t=>{
    const isBuy=t.type==='买入';
    const nav=navOn(t.nav_date); const implied=t.shares?(t.amount/t.shares):null;
    const navTxt=nav!=null?nav.toFixed(6):(implied!=null?implied.toFixed(6)+'（金额/份额反推）':'—');
    let redTxt='—';
    if(isBuy && red){
      const redDate=addDaysStr(t.date, red.days);
      const today=fmtDateLocal(new Date());
      const left=daysBetween(today, redDate);
      redTxt=redDate+(left>0?'（还有'+left+'天）':'');
    }
    return '<tr><td style="color:'+(isBuy?'#e60012':'#0a7d4a')+'">'+(isBuy?'买入':'赎回')+'</td><td>'+t.amount.toLocaleString(undefined,{minimumFractionDigits:2})+'</td><td>'+t.shares.toLocaleString()+'</td><td>'+navTxt+'</td><td>'+t.nav_date+'（申请日）</td><td>'+t.date+'（确认日）</td><td>'+redTxt+'</td></tr>';
  };
  let html='<h3 style="margin:0">'+hold.ledger_name+' · '+c.cur[1]+'（'+c.cur[0]+'）</h3>'
    +'<div class="muted">'+hold.distributor+' · '+p.share_code+'</div>'
    +'<div'+gainCls(c.holdingAnn)+' style="font-size:18px;font-weight:800;margin-top:8px">持有年化 '+fmt(c.holdingAnn)+'%</div>'
    +'<div class="prod cols"><div><span class="muted">持有金额</span><b>'+c.amount.toLocaleString(undefined,{maximumFractionDigits:2})+'</b></div><div><span class="muted">当日盈亏</span><b'+gainCls(c.daily)+'>'+fmt(c.daily)+'</b></div><div><span class="muted">本月收益</span><b'+gainCls(c.monthly)+'>'+fmt(c.monthly)+'</b></div><div><span class="muted">持仓盈亏</span><b'+gainCls(c.holdingPnl)+'>'+fmt(c.holdingPnl)+'</b></div></div>'
    +'<div class="muted">份额 '+hold.shares.toLocaleString()+' · 买入 '+hold.purchase_date+' @ '+hold.purchase_nav+'</div>'
    +(()=>{ const bad=zeroDays(share); return '<div'+(bad.count>0?' class="gain-neg"':' class="muted"')+'>挂0：'+bad.count+(bad.count?' · '+bad.list.map(r=>r.date.slice(5)+'('+wanTxt(r.wan)+')').join('、'):'')+'</div>'; })()
    +'<div class="detail" style="display:block"><h4>近30日</h4><table><tr><th>净值日期</th><th>当日万收</th><th>近七日日均</th><th>近14日日均</th><th>近7日年化</th><th>近14日年化</th><th>近一月年化</th><th>1月涨幅</th></tr>'
    +rows.map(r=>'<tr><td>'+r.date+'</td><td'+gainCls(r.wan)+'>'+wanTxt(r.wan)+'</td><td'+gainCls(r.avg7)+'>'+r.avg7.toFixed(2)+'</td><td'+gainCls(r.avg14)+'>'+r.avg14.toFixed(2)+'</td><td'+annCls(r.ann7)+'>'+pctTxt(r.ann7)+'</td><td'+annCls(r.ann14)+'>'+pctTxt(r.ann14)+'</td><td'+annCls(r.ann30)+'>'+pctTxt(r.ann30)+'</td><td'+gainCls(r.rise30)+'>'+(r.rise30==null?'—':r.rise30.toFixed(2)+'%')+'</td></tr>').join('')+'</table></div>';
  html+='<h4 style="margin-top:20px">买入 / 赎回 · 本产品</h4>';
  html+='<h5>买入（'+buys.length+'笔）</h5>'+(buys.length?'<table><tr><th>类型</th><th>金额</th><th>份额</th><th>净值</th><th>净值日</th><th>确认日</th><th>预估最早可赎回日</th></tr>'+buys.map(txRow).join('')+'</table>':'<p class="muted">本产品暂无买入记录。</p>');
  html+='<h5>赎回（'+sells.length+'笔）</h5>'+(sells.length?'<table><tr><th>类型</th><th>金额</th><th>份额</th><th>净值</th><th>净值日</th><th>确认日</th><th>预估最早可赎回日</th></tr>'+sells.map(txRow).join('')+'</table>':'<p class="muted">本产品暂无赎回记录。</p>');
  html+='<h5>待确认（'+pending.length+'笔）</h5>'+(pending.length?pending.map(t=>'<div class="row" style="border-bottom:1px solid #eee;padding:8px 0"><span>待确认 · '+(t.redeem_shares?'赎回份额 '+t.redeem_shares.toLocaleString()+' · 金额待净值公布后算':'金额 '+t.amount.toLocaleString(undefined,{minimumFractionDigits:2}))+' · 份额 -- · 确认日 '+(t.planned_confirm||'--')+(t.nav_date?' · 净值日 '+t.nav_date:'')+'</span></div>').join(''):'<p class="muted">本产品暂无待确认交易。</p>');
  wrap.innerHTML=html;
  return {product:p, hold, calc:c, buys, sells, pending, redeemable:red};
}
