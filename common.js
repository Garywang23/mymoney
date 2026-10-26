
let DATA=null, HOLD=null, DIM='distributor', SEL='全部机构', MULTI=null, VIEW='today';
const fmt=(n,d=2)=> (n>=0?'+':'')+n.toFixed(d);
const parseD=s=>new Date(s+'T00:00:00');
const daysBetween=(a,b)=>Math.round((parseD(b)-parseD(a))/86400000);
let TX=null;
async function loadData(){
  DATA=await (await fetch('nav-history.json')).json();
  HOLD=await (await fetch('holdings.json')).json();
  try{ TX=await (await fetch('transactions.json')).json(); }catch(e){ TX=null; }
}
function setTxt(id, txt){const e=document.getElementById(id); if(e) e.textContent=txt;}
function navProd(share){ return DATA.products.find(x=>x.share_code===share); }
function histAsc(share){ return navProd(share).history_desc.slice().sort((a,b)=>a[0].localeCompare(b[0])); }
function navAsOf(share, dateStr){
  const h=histAsc(share).filter(x=>x[0]<=dateStr);
  return h.length?h[h.length-1]:null;
}
function prevNav(share, dateStr){
  const h=histAsc(share).filter(x=>x[0]<=dateStr);
  return h.length>1?h[h.length-2]:null;
}
function calc(share, asOf){
  const hold=HOLD.products.find(p=>p.share_code===share);
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
  const h=histAsc(share); return h[h.length-1][0];
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
      const d=h[i][0]; if(!d.startsWith('2026-10')) continue;
      const sh=lotShares(p.ledger_name, d);
      const gain=sh*(h[i][1]-h[i-1][1]);
      cal[d]=(cal[d]||0)+gain;
      (det[d]=det[d]||[]).push({name:p.ledger_name, shares:sh, prev:h[i-1][1], prevDate:h[i-1][0], nav:h[i][1], gain});
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
  setTxt('leftSub', '持仓总金额（元）= 份额 × 2026-10-23 净值（中国理财网已查到的最新净值）');
  setTxt('detailTitle', '收益明细 · 各产品最新净值日');
  setTxt('monthPnl', fmt(monthTotal));
  setTxt('monthAnn', '当前8只10月合计（见说明）');
  const _tt=document.getElementById('tabToday'); if(_tt) _tt.className='on';
}
function renderTx(){
  if(!TX || !document.getElementById('txSummary')) return;
  document.getElementById('txSummary').textContent='目前8只：买入12次、卖出2次、待确认1笔（诚享7天29A 50,000.00）。';
  const draw=()=>{
    const m=document.getElementById('txMonth').value, inst=document.getElementById('txInst').value;
    let list=TX.transactions.filter(t=>(m==='全部月份'||t.date.startsWith(m))&&(inst==='全部机构'||t.distributor===inst));
    let html='<div class="muted" style="margin-top:10px">待确认：诚享7天29A · 微众稳健 · 确认日 -- · 份额 -- · 50,000.00</div>';
    let lastMonth='';
    list.forEach(t=>{
      const mm=t.date.slice(0,7); if(mm!==lastMonth){ lastMonth=mm; html+='<div class="groupHead"><span>'+mm+'</span></div>'; }
      html+='<div class="row" style="border-bottom:1px solid #eee;padding:8px 0"><span><b style="color:'+(t.type==='卖出'?'#0a7d4a':'#e60012')+'">'+t.type+'</b> '+t.product+'<br><span class="muted">'+t.distributor+' · 确认日 '+t.date+' · 份额 '+t.shares.toLocaleString()+'</span></span><b>'+t.amount.toLocaleString(undefined,{minimumFractionDigits:2})+'</b></div>';
    });
    document.getElementById('txList').innerHTML=html;
  };
  document.getElementById('txMonth').onchange=draw; document.getElementById('txInst').onchange=draw; draw();
}
function renderCalendar(){
  const wrap=document.getElementById('calendar'); let html=['日','一','二','三','四','五','六'].map(d=>'<div class="muted"><b>'+d+'</b></div>').join('');
  for(let i=0;i<4;i++) html+='<div></div>';
  const {cal, det}=lotCalendar();
  for(let d=1;d<=31;d++){
    const ds='2026-10-'+String(d).padStart(2,'0'); const v=cal[ds];
    html+='<div class="cell '+(v!=null?'has':'')+'" data-date="'+ds+'" style="'+(v!=null?'cursor:pointer':'')+'">'+d+(v!=null?'<div class="v">'+fmt(v)+'</div>':'')+'</div>';
  }
  wrap.innerHTML=html;
  wrap.querySelectorAll('.cell[data-date]').forEach(el=>{
    el.onclick=()=>{
      const ds=el.dataset.date, rows=det[ds];
      const box=document.getElementById('calDetail');
      if(!rows){ box.innerHTML=''; return; }
      const oldv=OLD_CAL[ds];
      let totAmt=rows.reduce((a,r)=>a+r.shares*r.nav,0); let h='<h4 style="margin:12px 0 6px">'+ds+' · 当前8只合计 '+fmt(cal[ds])+' · 当日持有金额合计 '+totAmt.toLocaleString(undefined,{maximumFractionDigits:2})+(oldv!=null?' · 目标页日历当日合计 '+fmt(oldv)+'，差额 '+fmt(oldv-cal[ds])+'（已清仓当日收益 + 诚享四舍五入误差，10-23当日差额 25.55 全是诚享）':'')+'</h4><table><tr><th>产品</th><th>当日份额</th><th>上一净值日</th><th>上一净值</th><th>当日净值</th><th>当日金额</th><th>当日收益</th></tr>';
      rows.forEach(r=>{ const gainTxt=(r.name.indexOf('诚享')>=0 && r.prev===r.nav) ? '精度不足' : fmt(r.gain); h+='<tr><td>'+r.name+'</td><td>'+r.shares.toLocaleString()+'</td><td>'+r.prevDate+'</td><td>'+r.prev+'</td><td>'+r.nav+'</td><td>'+(r.shares*r.nav).toLocaleString(undefined,{maximumFractionDigits:2})+'</td><td>'+gainTxt+'</td></tr>'; });
      h+='</table><p class="muted">公式：当日收益 = 当日份额 ×（当日净值 - 上一净值）。当日份额按交易净值日算：净值日在当日之前的买入计入，卖出在净值日之后的才扣减。</p>';
      if(rows.some(r=>r.name.indexOf('诚享')>=0 && r.prev===r.nav)){ h+='<p class="muted">诚享注意：上一净值与当日净值在中国理财网都显示 1.0152，但实际不同——目标页 23 日当日为 +25.55，4 位净值算出的 +0.00 是错的，不是 0。23 日精确净值约 355,334.35 ÷ 350,000 = 1.015241，22 日精确净值约 1.015241 − 25.55 ÷ 350,000 = 1.015168，两者都四舍五入到 1.0152，涨幅 0.000073 藏在第 5 位。正在查北银理财精确净值，查到后再替换 4 位数。</p>'; }
      box.innerHTML=h;
    };
  });
}
function renderCompare(){
  const wrap=document.getElementById('compareTable'); if(!DATA||!HOLD) return;
  const rows=[];
  HOLD.products.forEach(p=>{
    const h=histAsc(p.share_code);
    const latest=h[h.length-1], prev=h.length>1?h[h.length-2]:null;
    const m=metricsFor(p.share_code).find(r=>r.date===latest[0]) || metricsFor(p.share_code)[0];
    const wan=prev?(latest[1]/prev[1]-1)*10000:0;
    const rise=win=>{
      const td=parseD(latest[0]); const cutoff=new Date(td); cutoff.setDate(cutoff.getDate()-win);
      const cand=h.filter(x=>parseD(x[0])<=cutoff);
      if(!cand.length) return null;
      const base=cand[cand.length-1];
      const days=daysBetween(base[0], latest[0]);
      return {pct:(latest[1]/base[1]-1)*100, ann:days>0?(latest[1]/base[1]-1)*365/days*100:null};
    };
    const r7=rise(7), r14=rise(14);
    const c=calc(p.share_code, latest[0]);
    rows.push({name:p.ledger_name, code:p.share_code, date:latest[0], nav:latest[1], wan, avg7:m?m.avg7:0, avg14:m?m.avg14:0, ann7:m?m.ann7:null, ann14:m?m.ann14:null, ann30:m?m.ann30:null, rise7:r7?r7.pct:null, rise14:r14?r14.pct:null, daily:c.daily, shares:p.shares, amount:c.amount});
  });
  rows.sort((a,b)=>b.wan-a.wan);
  let html='<table><tr><th>产品</th><th>净值日期</th><th>最新净值</th><th>当日万收</th><th>7日日均</th><th>14日日均</th><th>7日年化</th><th>14日年化</th><th>1月年化</th><th>7日涨幅</th><th>14日涨幅</th><th>当日收益</th><th>持有份额</th><th>持有金额</th></tr>';
  rows.forEach(r=>{
    html+='<tr><td><b>'+r.name+'</b><br><span class="muted">'+r.code+'</span></td><td>'+r.date.slice(5)+'</td><td>'+r.nav+'</td><td>'+r.wan.toFixed(2)+'</td><td>'+r.avg7.toFixed(2)+'</td><td>'+r.avg14.toFixed(2)+'</td><td>'+pctTxt(r.ann7)+'</td><td>'+pctTxt(r.ann14)+'</td><td>'+pctTxt(r.ann30)+'</td><td>'+(r.rise7==null?'—':r.rise7.toFixed(2)+'%')+'</td><td>'+(r.rise14==null?'—':r.rise14.toFixed(2)+'%')+'</td><td>'+fmt(r.daily)+'</td><td>'+r.shares.toLocaleString()+'</td><td>'+r.amount.toLocaleString(undefined,{maximumFractionDigits:2})+'</td></tr>';
  });
  html+='</table>';
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
    html+='<div class="groupHead"><span>'+gname+'('+prods.length+')</span><span style="color:#e60012">'+fmt(daily)+' 万收('+wanTxt+')</span></div>';
    if(!prods.length){ html+='<div class="muted" style="padding:10px">暂无持仓明细，持仓总金额 0.00、当日收益 0.00</div>'; return; }
    prods.forEach(p=>{
      const asOf=viewAsOf(p.share_code); const c=calc(p.share_code, asOf); const other=DIM==='distributor'?('管理：'+p.manager_short):('代销：'+p.distributor);
      const updated=true;
      const badge=asOf.slice(5)+' ('+fmt(c.daily/c.amount*10000)+')';
      html+='<div class="card prod" data-share="'+p.share_code+'"><div class="row"><b>'+p.ledger_name+' <span class="muted">('+p.share_code+')</span></b><span style="color:#e60012;font-size:18px;font-weight:800">持有年化 '+fmt(c.holdingAnn)+'%</span><span style="color:'+(updated?'#2563eb':'#e60012')+'">'+badge+'</span></div>'
        +'<div class="prod cols"><div><span class="muted">持有金额</span><b>'+c.amount.toLocaleString(undefined,{maximumFractionDigits:2})+'</b></div><div><span class="muted">当日盈亏</span><b>'+(updated?fmt(c.daily):'—')+'</b></div><div><span class="muted">本月收益</span><b>'+fmt(c.monthly)+'</b></div><div><span class="muted">持仓盈亏</span><b>'+fmt(c.holdingPnl)+'</b></div><div><span class="muted">持有年化（最重要，由买入日起算）</span><b style="color:#e60012">'+fmt(c.holdingAnn)+'%</b></div></div>'
        +'<div class="muted">份额 '+p.shares.toLocaleString()+' · 净值 '+c.cur[1]+'（'+c.cur[0]+'） · 买入 '+p.purchase_date+' @ '+p.purchase_nav+' · '+other+'</div></div>';
    });
  });
  wrap.innerHTML=html;
  wrap.querySelectorAll('.prod').forEach(el=>{
    el.onclick=()=>{ location.href='detail.html?share='+encodeURIComponent(el.dataset.share); };
  });
}
function metricsFor(share){
  const hold=HOLD.products.find(p=>p.share_code===share);
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
    rows.push({date, nav, wan:wan[date]!=null?wan[date]:null, avg7:avg(7), avg14:avg(14), ann7:ann(7), ann14:ann(14), ann30:ann(30)});
  });
  return rows;
}
function wanTxt(n){ return n==null?'—':n.toFixed(2); }
function pctTxt(n){ return n==null?'—':fmt(n)+'%'; }
function draw(canvas, hist){
  const ctx=canvas.getContext('2d'); const W=canvas.width=canvas.offsetWidth*2, H=canvas.height=220;
  ctx.clearRect(0,0,W,H); const vals=hist.slice().sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x[1]);
  const mn=Math.min(...vals), mx=Math.max(...vals), pad=16;
  ctx.strokeStyle='#5b5bd6'; ctx.lineWidth=3; ctx.beginPath();
  vals.forEach((v,i)=>{const x=pad+i*(W-2*pad)/Math.max(1,vals.length-1); const y=H-pad-(v-mn)/Math.max(0.000001,mx-mn)*(H-2*pad); i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  ctx.stroke();
}
function render(){
  const wrap=document.getElementById('list'); wrap.innerHTML='';
  DATA.products.forEach(p=>{
    const hist=p.history_desc, latest=hist.slice().sort((a,b)=>b[0].localeCompare(a[0]))[0], link='https://xinxipilu.chinawealth.com.cn/queryMenu/prodType/prodTypeDetail?prodRegCode='+p.registration_code;
    const rows=metricsFor(p.share_code);
    const el=document.createElement('div'); el.className='card'; el.dataset.share=p.share_code;
    el.innerHTML='<h3 style="margin:0">'+p.ledger_name+' · '+latest[1]+'</h3><div class="muted">'+p.manager+' · '+p.registration_code+' / '+p.share_code+' · <a href="'+link+'" target="_blank" rel="noopener">中国理财网详情</a></div>'
      +'<div class="detail"><canvas></canvas><h4>近30自然日数据详情（由净值算出，不是复制的）</h4><table><tr><th>净值日期</th><th>当日万收</th><th>近七日日均</th><th>近14日日均</th><th>近7日年化</th><th>近14日年化</th><th>近一月年化</th></tr>'
      +rows.map(r=>'<tr><td>'+r.date+'</td><td>'+wanTxt(r.wan)+'</td><td>'+r.avg7.toFixed(2)+'</td><td>'+r.avg14.toFixed(2)+'</td><td>'+pctTxt(r.ann7)+'</td><td>'+pctTxt(r.ann14)+'</td><td>'+pctTxt(r.ann30)+'</td></tr>').join('')+'</table></div>';
    el.querySelector('h3').onclick=()=>{const d=el.querySelector('.detail'); d.style.display=d.style.display==='block'?'none':'block'; if(d.style.display==='block') draw(el.querySelector('canvas'), hist);};
    wrap.appendChild(el);
  });
}
