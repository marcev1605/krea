
const { useState, useEffect, useMemo } = React;
const html = htm.bind(React.createElement);
const EPS = 1e-9;
const LOGO = "icons/logo.jpg";

const fmt2 = n => n.toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fARS = n => isFinite(n) ? (n<0?"−$ ":"$ ") + fmt2(Math.abs(n)) : "—";
const fUSD = n => isFinite(n) ? (n<0?"−US$ ":"US$ ") + fmt2(Math.abs(n)) : "—";
const fSigned = (f,n) => (n>0?"+":"") + f(n);
const fPct = n => isFinite(n) ? (n>0?"+":n<0?"−":"") + Math.abs(n).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2}) + " %" : "—";
const fQty = n => n.toLocaleString("es-AR",{maximumFractionDigits:4});
const fDate = s => { const [y,m,d] = s.split("-"); return `${d}/${m}/${y}`; };
const today = () => { const t = new Date(); t.setMinutes(t.getMinutes()-t.getTimezoneOffset()); return t.toISOString().slice(0,10); };
// Acepta "1.234,56" o "1234.56"
const parse = s => { s = String(s??"").trim(); if (!s) return NaN; if (s.includes(",")) return Number(s.replace(/\./g,"").replace(",",".")); return Number(s); };
const toField = n => n==null || !isFinite(n) ? "" : String(n).replace(".",",");
const sign = n => n>EPS ? "pos" : n<-EPS ? "neg" : "";

/* ---------- almacenamiento: db del artifact, con respaldo local ---------- */
function useStore(){
  const [rows,setRows] = useState(null);
  const [mode,setMode] = useState("loading");
  const [api,setApi] = useState(null);
  const [precios,setPrecios] = useState(null);
  const [config,setConfig] = useState({});
  useEffect(()=>{
    let unsub = null, unsubP = null, unsubC = null, cancelled = false;
    const local = () => {
      const read = () => { try { return JSON.parse(localStorage.getItem("compras")||"[]"); } catch(e){ return []; } };
      const write = l => { localStorage.setItem("compras",JSON.stringify(l)); setRows([...l]); };
      setRows(read()); setMode("local");
      const rd = k => { try { return JSON.parse(localStorage.getItem(k)||"null"); } catch(e){ return null; } };
      setPrecios(rd("krea-precios")); setConfig(rd("krea-config")||{});
      setApi({
        setDoc: async (name,body)=>{ localStorage.setItem("krea-"+name,JSON.stringify(body)); (name==="precios"?setPrecios:setConfig)(body); },
        save: async (id,body)=>{ const l=read(); const i=l.findIndex(r=>r.id===id); if(i>=0) l[i]={id,...body}; else l.push({id,...body}); write(l); },
        remove: async id=> write(read().filter(r=>r.id!==id))
      });
    };
    (async()=>{
      const db = window.claude?.use ? await window.claude.use("db") : null;
      if (cancelled) return;
      if (!db){ local(); return; }
      const col = db.collection("compras");
      setMode("db");
      setApi({ save:(id,body)=> col.doc(id).set(body), remove:id=> col.doc(id).delete(), setDoc:(name,body)=> db.doc("ajustes/"+name).set(body) });
      unsub = col.onSnapshot(s=> setRows(s.docs.map(d=>({id:d.id,...d.data()}))), ()=> local());
      unsubP = db.doc("ajustes/precios").onSnapshot(d=> setPrecios(d.exists ? d.data() : null), ()=>{});
      unsubC = db.doc("ajustes/config").onSnapshot(d=> setConfig(d.exists ? d.data() : {}), ()=>{});
    })();
    return ()=>{ cancelled=true; unsub && unsub(); unsubP && unsubP(); unsubC && unsubC(); };
  },[]);
  return { rows, mode, api, precios, config };
}

/* ---------- cálculos ----------
   Compra: costo = cantidad × precio + comisión. El PPC incluye la comisión.
   Venta: costo de lo vendido = cantidad × PPC vigente; neto = cantidad × precio − comisión.
   Rendimiento USD usa el MEP de cada compra (vía PPC USD) y el MEP del día de venta. */
function compute(rows){
  const sorted = [...rows].sort((a,b)=> a.fecha===b.fecha ? (a.creado||0)-(b.creado||0) : a.fecha<b.fecha?-1:1);
  const acc = {};
  const out = sorted.map(r=>{
    const op = r.op || "compra";
    const com = r.comision || 0;
    const a = acc[r.ticker] ||= {ticker:r.ticker,tipo:r.tipo,cantidad:0,ars:0,usd:0,compras:0,ventas:0,resArs:0,resUsd:0,com:0,comUsd:0,qComprada:0,arsComprado:0,usdComprado:0,divArs:0,divUsd:0,divs:0,last:r.fecha};
    a.com += com; a.comUsd += com ? com/r.mep : 0; a.last = r.fecha;
    if (op==="ajuste"){
      const antes = a.cantidad, fx = r.factor>0 ? r.factor : 1;
      a.cantidad *= fx; a.qComprada *= fx;
      return {...r, op, comision:0, comUsd:0, antes, despues:a.cantidad, factor:fx,
        ppcArs: a.cantidad>EPS ? a.ars/a.cantidad : NaN, ppcUsd: a.cantidad>EPS ? a.usd/a.cantidad : NaN};
    }
    if (op==="dividendo"){
      const usdM = r.moneda==="USD";
      const divUsd = usdM ? r.monto : r.monto/r.mep, divArs = usdM ? r.monto*r.mep : r.monto;
      const ret = r.retencion||0, retUsd = usdM ? ret : ret/r.mep, retArs = usdM ? ret*r.mep : ret;
      const baseUsd = a.usd, baseArs = a.ars;
      a.divArs += divArs; a.divUsd += divUsd; a.divs++;
      return {...r, op, comision:0, comUsd:0, divArs, divUsd, retArs, retUsd, tenencia:a.cantidad,
        yieldUsd: baseUsd>EPS ? divUsd/baseUsd*100 : NaN, yieldArs: baseArs>EPS ? divArs/baseArs*100 : NaN};
    }
    if (op==="compra"){
      const brutoArs = r.cantidad * r.precioArs;
      const totalArs = brutoArs + com;
      const totalUsd = totalArs / r.mep;
      a.cantidad += r.cantidad; a.ars += totalArs; a.usd += totalUsd; a.compras++; a.tipo = r.tipo; a.qComprada += r.cantidad; a.arsComprado += totalArs; a.usdComprado += totalUsd;
      return {...r, op, usdUnit:r.precioArs/r.mep, brutoArs, comUsd:com/r.mep, totalArs, totalUsd, ppcArs:a.ars/a.cantidad, ppcUsd:a.usd/a.cantidad};
    }
    const tenencia = a.cantidad;
    const ppcArs = tenencia>EPS ? a.ars/tenencia : NaN, ppcUsd = tenencia>EPS ? a.usd/tenencia : NaN;
    const excede = r.cantidad > tenencia + EPS;
    const q = Math.min(r.cantidad, tenencia);
    const costoArs = q*ppcArs || 0, costoUsd = q*ppcUsd || 0;
    const brutoArs = r.cantidad * r.precioArs;
    const netoArs = brutoArs - com, netoUsd = netoArs / r.mep;
    const resArs = netoArs - costoArs, resUsd = netoUsd - costoUsd;
    a.cantidad -= q; a.ars -= costoArs; a.usd -= costoUsd; a.ventas++;
    if (a.cantidad < EPS){ a.cantidad = 0; a.ars = 0; a.usd = 0; }
    a.resArs += resArs; a.resUsd += resUsd;
    return {...r, op, tenencia, excede, ppcArs, ppcUsd, usdUnit:r.precioArs/r.mep, brutoArs, comUsd:com/r.mep,
            netoArs, netoUsd, costoArs, costoUsd, resArs, resUsd,
            pctArs: costoArs ? resArs/costoArs*100 : NaN, pctUsd: costoUsd ? resUsd/costoUsd*100 : NaN};
  });
  const all = Object.values(acc);
  const pos = all.filter(a=>a.cantidad>EPS).map(a=>({...a,ppcArs:a.ars/a.cantidad,ppcUsd:a.usd/a.cantidad})).sort((x,y)=>y.usd-x.usd);
  const ventas = out.filter(o=>o.op==="venta");
  const holdings = Object.fromEntries(all.map(a=>[a.ticker,{cantidad:a.cantidad,tipo:a.tipo}]));
  const outDesc = [...out].reverse();
  const grupos = all.map(a=>({...a,
      ppcArs: a.cantidad>EPS ? a.ars/a.cantidad : NaN, ppcUsd: a.cantidad>EPS ? a.usd/a.cantidad : NaN,
      ppcHistArs: a.arsComprado/a.qComprada, ppcHistUsd: a.usdComprado/a.qComprada,
      movs: outDesc.filter(m=>m.ticker===a.ticker)}))
    .sort((x,y)=> x.last===y.last ? 0 : x.last<y.last ? 1 : -1);
  const dividendos = out.filter(o=>o.op==="dividendo");
  return { grupos, movs: outDesc, pos, ventas: [...ventas].reverse(), dividendos: [...dividendos].reverse(), holdings,
    divArs: dividendos.reduce((s,v)=>s+v.divArs,0), divUsd: dividendos.reduce((s,v)=>s+v.divUsd,0),
    costoVArs: ventas.reduce((s,v)=>s+v.costoArs,0), costoVUsd: ventas.reduce((s,v)=>s+v.costoUsd,0),
    resArs: ventas.reduce((s,v)=>s+v.resArs,0), resUsd: ventas.reduce((s,v)=>s+v.resUsd,0) };
}

/* ---------- valuación con precios cargados ---------- */
function valuar(pos, precios){
  const mep = precios?.mep, P = precios?.p || {};
  const por = {}; let valArs=0, valUsd=0, invArs=0, invUsd=0, nrArs=0, nrUsd=0, conPrecio=0;
  pos.forEach(x=>{
    invArs += x.ars; invUsd += x.usd;
    const pr = P[x.ticker];
    if (pr>0 && mep>0){
      const vA = x.cantidad*pr, vU = vA/mep;
      por[x.ticker] = {precio:pr, valorArs:vA, valorUsd:vU, nrArs:vA-x.ars, nrUsd:vU-x.usd,
        pctArs: x.ars ? (vA-x.ars)/x.ars*100 : NaN, pctUsd: x.usd ? (vU-x.usd)/x.usd*100 : NaN};
      valArs += vA; valUsd += vU; nrArs += vA-x.ars; nrUsd += vU-x.usd; conPrecio++;
    } else { valArs += x.ars; valUsd += x.usd; }
  });
  return {por, mep, fecha: precios?.fecha, hay: conPrecio>0, faltan: pos.length-conPrecio,
    valArs, valUsd, invArs, invUsd, nrArs, nrUsd};
}
const ValCtx = React.createContext(null);
const ActCtx = React.createContext({});

/* ---------- componentes ---------- */
function KV({k,v,cls}){ return html`<div class="kv"><span>${k}</span><span class=${"num "+(cls||"")}>${v}</span></div>`; }

function MovHead({c,open,onToggle}){
  const v = c.op==="venta", d = c.op==="dividendo", aj = c.op==="ajuste";
  return html`<button class="mov-head" aria-expanded=${open} onClick=${onToggle}>
    <span class="tk">${c.ticker}<span class=${"tag "+(d?"div":v?"sell":aj?"":"buy")}>${d?"Dividendo":v?"Venta":aj?"Split":"Compra"}</span></span>
    <span class="mov-meta"><span class="num">${d ? (c.moneda==="USD"?fUSD(c.monto):fARS(c.monto)) : aj ? "×"+fQty(c.factor) : fQty(c.cantidad)+" u."}</span><span class="date">${fDate(c.fecha)}</span></span>
    <span class="chev" aria-hidden="true">${open?"▴":"▾"}</span>
  </button>`;
}
function EditRow({c,onOpen}){
  return html`<div class="edit-row"><span class="tag">${c.tipo}</span><button class="linkbtn" onClick=${()=>onOpen(c)}>Editar o borrar</button></div>`;
}

function CompraCard({c,onOpen}){
  const [open,setOpen] = useState(false);
  return html`<div class=${"card mov"+(open?" open":"")}>
    <${MovHead} c=${c} open=${open} onToggle=${()=>setOpen(!open)} />
    ${open && html`
    <div class="grid">
      <${KV} k="TC MEP" v=${fARS(c.mep)} />
      <${KV} k="Tipo" v=${c.tipo} />
      <${KV} k="Valor compra $" v=${fARS(c.precioArs)} cls="ars" />
      <${KV} k="Valor compra USD" v=${fUSD(c.usdUnit)} cls="usd" />
      <${KV} k="Comisión $" v=${fARS(c.comision||0)} cls="ars" />
      <${KV} k="Comisión USD" v=${fUSD(c.comUsd)} cls="usd" />
      <${KV} k="PPC $" v=${fARS(c.ppcArs)} cls="ars" />
      <${KV} k="PPC USD" v=${fUSD(c.ppcUsd)} cls="usd" />
    </div>
    <div class="total"><span class="date">Monto total (con comisión)</span><span><b class="ars">${fARS(c.totalArs)}</b> · <span class="num usd">${fUSD(c.totalUsd)}</span></span></div>
    <${EditRow} c=${c} onOpen=${onOpen} />`}
  </div>`;
}

function VentaCard({c,onOpen,startOpen}){
  const [open,setOpen] = useState(!!startOpen);
  return html`<div class=${"card mov"+(open?" open":"")}>
    <${MovHead} c=${c} open=${open} onToggle=${()=>setOpen(!open)} />
    ${open && html`
    <div class="grid">
      <${KV} k="TC MEP" v=${fARS(c.mep)} />
      <${KV} k="Tipo" v=${c.tipo} />
      <${KV} k="Precio venta $" v=${fARS(c.precioArs)} cls="ars" />
      <${KV} k="Precio venta USD" v=${fUSD(c.usdUnit)} cls="usd" />
      <${KV} k="PPC $" v=${fARS(c.ppcArs)} cls="ars" />
      <${KV} k="PPC USD" v=${fUSD(c.ppcUsd)} cls="usd" />
      <${KV} k="Comisión $" v=${fARS(c.comision||0)} cls="ars" />
      <${KV} k="Comisión USD" v=${fUSD(c.comUsd)} cls="usd" />
      <${KV} k="Neto cobrado $" v=${fARS(c.netoArs)} cls="ars" />
      <${KV} k="Neto cobrado USD" v=${fUSD(c.netoUsd)} cls="usd" />
    </div>
    <${Rend} v=${c} />
    ${c.excede && html`<div class="err">Vendiste más de lo que tenías registrado (${fQty(c.tenencia)}). El resultado se calcula sobre esa tenencia.</div>`}
    <${EditRow} c=${c} onOpen=${onOpen} />`}
  </div>`;
}

function DivCard({c,onOpen,startOpen}){
  const [open,setOpen] = useState(!!startOpen);
  return html`<div class=${"card mov"+(open?" open":"")}>
    <${MovHead} c=${c} open=${open} onToggle=${()=>setOpen(!open)} />
    ${open && html`
    <div class="grid">
      <${KV} k="Cobrado en" v=${c.moneda==="USD"?"Dólares":"Pesos"} />
      <${KV} k="TC MEP" v=${fARS(c.mep)} />
      <${KV} k="Neto $" v=${fARS(c.divArs)} cls="ars" />
      <${KV} k="Neto USD" v=${fUSD(c.divUsd)} cls="usd" />
      <${KV} k="Retención" v=${c.retencion ? (c.moneda==="USD"?fUSD(c.retencion):fARS(c.retencion)) : "—"} />
      <${KV} k="Tenencia ese día" v=${fQty(c.tenencia)+" u."} />
    </div>
    <div class="total"><span class="date">Rinde sobre tu costo (USD)</span><b class="divc">${isFinite(c.yieldUsd)?fPct(c.yieldUsd):"—"}</b></div>
    <${EditRow} c=${c} onOpen=${onOpen} />`}
  </div>`;
}
function AjusteCard({c,onOpen}){
  const [open,setOpen] = useState(false);
  return html`<div class=${"card mov"+(open?" open":"")}>
    <${MovHead} c=${c} open=${open} onToggle=${()=>setOpen(!open)} />
    ${open && html`
    <div class="grid">
      <${KV} k="Tenías" v=${fQty(c.antes)+" u."} />
      <${KV} k="Pasaste a tener" v=${fQty(c.despues)+" u."} />
      <${KV} k="PPC $ ajustado" v=${fARS(c.ppcArs)} cls="ars" />
      <${KV} k="PPC USD ajustado" v=${fUSD(c.ppcUsd)} cls="usd" />
    </div>
    <span class="hint">Cambió la cantidad, no lo invertido. Por eso el PPC se ajusta en la misma proporción.</span>
    <${EditRow} c=${c} onOpen=${onOpen} />`}
  </div>`;
}
function MovCard({m,onOpen,startOpen}){
  if (m.op==="ajuste") return html`<${AjusteCard} c=${m} onOpen=${onOpen} />`;
  return m.op==="venta" ? html`<${VentaCard} c=${m} onOpen=${onOpen} startOpen=${startOpen} />`
    : m.op==="dividendo" ? html`<${DivCard} c=${m} onOpen=${onOpen} startOpen=${startOpen} />`
    : html`<${CompraCard} c=${m} onOpen=${onOpen} />`;
}

function TickerDetail({g,onOpen}){
  const abierta = g.cantidad>EPS;
  const val = React.useContext(ValCtx), act = React.useContext(ActCtx);
  const v = val && val.por[g.ticker];
  return html`
    ${v && html`<div class="valbox">
      <div class="vb-top"><span>Precio actual</span><b>${fARS(v.precio)}</b></div>
      <div class="vb-row"><span>Valor hoy</span><span>${fARS(v.valorArs)} · ${fUSD(v.valorUsd)}</span></div>
      <div class="vb-row"><span>Ganancia sin realizar</span><span><b class=${sign(v.nrArs)}>${fSigned(fARS,v.nrArs)} (${fPct(v.pctArs)})</b></span></div>
      <div class="vb-row"><span></span><span><b class=${sign(v.nrUsd)}>${fSigned(fUSD,v.nrUsd)} (${fPct(v.pctUsd)})</b></span></div>
    </div>`}
    <div class="grid">
      <${KV} k="Cantidad actual" v=${fQty(g.cantidad)} />
      <${KV} k="MEP promedio" v=${abierta ? fARS(g.ars/g.usd) : fARS(g.arsComprado/g.usdComprado)} />
      <${KV} k=${abierta?"PPC $":"PPC histórico $"} v=${fARS(abierta?g.ppcArs:g.ppcHistArs)} cls="ars" />
      <${KV} k=${abierta?"PPC USD":"PPC histórico USD"} v=${fUSD(abierta?g.ppcUsd:g.ppcHistUsd)} cls="usd" />
      <${KV} k="Comisiones $" v=${fARS(g.com)} cls="ars" />
      <${KV} k="Comisiones USD" v=${fUSD(g.comUsd)} cls="usd" />
      <${KV} k="Total comprado" v=${fQty(g.qComprada)+" u."} />
      <${KV} k="Compras / Ventas" v=${g.compras+" / "+g.ventas+(g.divs?" · "+g.divs+" div.":"")} />
    </div>
    <div class="total"><span class="date">${abierta?"Invertido hoy":"Total comprado"}</span><span><b class="ars">${fARS(abierta?g.ars:g.arsComprado)}</b> · <span class="num usd">${fUSD(abierta?g.usd:g.usdComprado)}</span></span></div>
    ${g.ventas>0 && html`<div class="total"><span class="date">Resultado ventas</span><span><b class=${sign(g.resArs)}>${fSigned(fARS,g.resArs)}</b> · <span class=${"num "+sign(g.resUsd)}>${fSigned(fUSD,g.resUsd)}</span></span></div>`}
    ${g.divs>0 && html`<div class="total"><span class="date">Dividendos cobrados (${g.divs})</span><span><b class="divc">${fSigned(fARS,g.divArs)}</b> · <span class="num divc">${fSigned(fUSD,g.divUsd)}</span></span></div>`}
    <div class="grp-label">Detalle de movimientos</div>
    <div class="list sub">${g.movs.map(m=>html`<${MovCard} key=${m.id} m=${m} onOpen=${onOpen} />`)}</div>
    ${abierta && act.openSplit && html`<button class="linkbtn split-link" onClick=${()=>act.openSplit(g.ticker)}>Registrar split o cambio de ratio</button>`}`;
}

function TickerGroup({g,onOpen}){
  const [open,setOpen] = useState(false);
  const n = g.movs.length, abierta = g.cantidad>EPS;
  return html`<div class=${"card mov grp"+(open?" open":"")}>
    <button class="mov-head" aria-expanded=${open} onClick=${()=>setOpen(!open)}>
      <span class="tk">${g.ticker}<span class="tag">${g.tipo}</span>${!abierta && html`<span class="tag">Cerrada</span>`}</span>
      <span class="mov-meta"><span class="num">${fQty(g.cantidad)} u.</span><span class="date">${n} ${n===1?"movimiento":"movimientos"}</span></span>
      <span class="chev" aria-hidden="true">${open?"▴":"▾"}</span>
    </button>
    ${open && html`<${TickerDetail} g=${g} onOpen=${onOpen} />`}
  </div>`;
}

function Rend({v}){
  return html`<div class="result">
    <div class="r"><span class="date">Rendimiento en $</span><b class=${sign(v.resArs)}>${fSigned(fARS,v.resArs)}</b><small class=${sign(v.resArs)}>${fPct(v.pctArs)}</small></div>
    <div class="r"><span class="date">Rendimiento en USD</span><b class=${sign(v.resUsd)}>${fSigned(fUSD,v.resUsd)}</b><small class=${sign(v.resUsd)}>${fPct(v.pctUsd)}</small></div>
  </div>`;
}

function PosCard({p}){
  return html`<div class="card">
    <div class="card-head">
      <div class="tk">${p.ticker}<span class="tag">${p.tipo}</span></div>
      <div class="date">${p.compras} ${p.compras===1?"compra":"compras"}${p.ventas?` · ${p.ventas} ${p.ventas===1?"venta":"ventas"}`:""}</div>
    </div>
    <div class="grid">
      <${KV} k="Cantidad" v=${fQty(p.cantidad)} />
      <${KV} k="MEP promedio" v=${fARS(p.ars/p.usd)} />
      <${KV} k="PPC $" v=${fARS(p.ppcArs)} cls="ars" />
      <${KV} k="PPC USD" v=${fUSD(p.ppcUsd)} cls="usd" />
    </div>
    <div class="total"><span class="date">Invertido</span><span><b class="ars">${fARS(p.ars)}</b> · <span class="num usd">${fUSD(p.usd)}</span></span></div>
  </div>`;
}

/* ---------- torta ---------- */
const COLORS = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)"];
function Pie({pos,grupos,onOpen,valuado}){
  const [cur,setCur] = useState("usd");
  const [pick,setPick] = useState(null);
  const key = cur==="usd" ? "usd" : "ars";
  const sorted = [...pos].sort((a,b)=>b[key]-a[key]);
  let slices = sorted.slice(0,7).map((p,i)=>({label:p.ticker,val:p[key],qty:p.cantidad,color:COLORS[i]}));
  if (sorted.length>7){
    const rest = sorted.slice(7);
    slices.push({label:`Otros (${rest.length})`,val:rest.reduce((s,p)=>s+p[key],0),color:"var(--c8)"});
  }
  const total = slices.reduce((s,x)=>s+x.val,0);
  const R=90, r=56, C=100;
  const pt = (ang,rad)=>[C+rad*Math.sin(ang), C-rad*Math.cos(ang)];
  let a0 = 0;
  const paths = slices.map((s,i)=>{
    const frac = s.val/total;
    if (frac>=0.9999) return html`<g key=${i}><circle cx=${C} cy=${C} r=${(R+r)/2} fill="none" stroke=${s.color} stroke-width=${R-r} /></g>`;
    const a1 = a0 + frac*2*Math.PI, large = frac>0.5?1:0;
    const [x0,y0]=pt(a0,R),[x1,y1]=pt(a1,R),[x2,y2]=pt(a1,r),[x3,y3]=pt(a0,r);
    const d = `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return html`<path key=${i} d=${d} fill=${s.color} stroke="var(--surface)" stroke-width="2" />`;
  });
  const fmt = cur==="usd" ? fUSD : fARS;
  return html`<div class="pie-card">
    <div class="card-head"><h3>Composición de la cartera</h3>
      <div class="seg-mini" role="group" aria-label="Moneda">
        <button aria-pressed=${cur==="usd"} onClick=${()=>setCur("usd")}>USD</button>
        <button aria-pressed=${cur==="ars"} onClick=${()=>setCur("ars")}>$</button>
      </div>
    </div>
    <div class="pie-wrap">
      <svg viewBox="0 0 200 200" role="img" aria-label="Gráfico de torta de la cartera">
        ${paths}
        <text x="100" y="94" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="10" fill="var(--muted)">${valuado?"Valor hoy":"Invertido"}</text>
        <text x="100" y="112" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink)">${cur==="usd"?"US$ ":"$ "}${Math.round(total).toLocaleString("es-AR")}</text>
      </svg>
    </div>
    <div class="legend">
      ${slices.map((s,i)=>{ const g = grupos && grupos.find(x=>x.ticker===s.label), op = g && pick===s.label;
        return html`<div key=${i} class=${"leg-wrap"+(op?" open":"")}>
        <button class="leg" disabled=${!g} aria-expanded=${!!op} onClick=${()=>setPick(op?null:s.label)}>
        <span class="dot" style=${{background:s.color}}></span>
        <span class="name">${s.label}${g && html`<span class="chev-s" aria-hidden="true">${op?" ▴":" ▾"}</span>`}</span>
        <span class="pct">${(s.val/total*100).toLocaleString("es-AR",{minimumFractionDigits:1,maximumFractionDigits:1})} %</span>
        <span class="track"><i style=${{width:(s.val/total*100)+"%",background:s.color}}></i></span>
        <span class="amt"><span>${fmt(s.val)}</span>${s.qty!=null && html`<span>${fQty(s.qty)} u.</span>`}</span>
        </button>
        ${op && html`<div class="leg-detail"><${TickerDetail} g=${g} onOpen=${onOpen} /></div>`}
      </div>`; })}
    </div>
    <span class="hint">${valuado ? `Valuado con tus precios del ${fDate(valuado)}` : "Calculado al costo de compra (PPC × tenencia)"}, de mayor a menor. Tocá un instrumento para ver sus movimientos.</span>
  </div>`;
}

/* ---------- hoja de carga ---------- */
function Sheet({op,initial,rows,holdings,onClose,onSave,onDelete,defaultMep,config,onSaveConfig}){
  const isVenta = op==="venta";
  const tickers = Object.entries(holdings).filter(([t,h])=>h.cantidad>EPS || t===initial?.ticker).map(([t])=>t).sort();
  const [f,setF] = useState(()=> initial ? {
      fecha:initial.fecha,tipo:initial.tipo,ticker:initial.ticker,
      cantidad:toField(initial.cantidad),precio:toField(initial.precioArs),mep:toField(initial.mep),comision:toField(initial.comision),
      pct:toField(config?.comPct), comManual:true
    } : {fecha:today(),tipo:"CEDEAR",ticker:isVenta?(tickers[0]||""):"",cantidad:"",precio:"",mep:toField(defaultMep),comision:"",
      pct:toField(config?.comPct), comManual:false});
  const mepPre = !initial && defaultMep>0;
  const [confirm,setConfirm] = useState(false);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");
  const set = k => e => setF({...f,[k]: k==="ticker"? e.target.value.toUpperCase().replace(/\s/g,"") : e.target.value});
  const cant = parse(f.cantidad), precio = parse(f.precio), mep = parse(f.mep);
  const pct = parse(f.pct);
  const autoCom = !f.comManual && pct>0 && cant>0 && precio>0 ? Math.round(cant*precio*pct)/100 : null;
  const comTxt = autoCom!=null ? toField(autoCom) : f.comision;
  const com = autoCom!=null ? autoCom : (f.comision.trim()==="" ? 0 : parse(f.comision));
  const ok = f.fecha && f.ticker && cant>0 && precio>0 && mep>0 && com>=0;
  const tipo = isVenta ? (holdings[f.ticker]?.tipo || f.tipo) : f.tipo;

  const prev = useMemo(()=>{
    if (!ok) return null;
    const draft = {id: initial?.id || "__draft", op, fecha:f.fecha, tipo, ticker:f.ticker, cantidad:cant, precioArs:precio, mep, comision:com, creado: initial?.creado || Date.now()};
    return compute([...rows.filter(r=>r.id!==draft.id), draft]).movs.find(c=>c.id===draft.id);
  },[f,rows]);

  const save = async()=>{
    if(!ok){ setErr(`Completá fecha, ticker, cantidad, ${isVenta?"precio de venta":"valor de compra"} y TC MEP con números mayores a cero. La comisión puede quedar vacía.`); return; }
    if(isVenta && prev?.excede){ setErr(`A esa fecha tenías ${fQty(prev.tenencia)} de ${f.ticker}. No podés vender más que eso.`); return; }
    setBusy(true); setErr("");
    try{
      await onSave(initial?.id || ((isVenta?"v":"c")+Date.now().toString(36)+Math.random().toString(36).slice(2,6)), {
        op, fecha:f.fecha, tipo, ticker:f.ticker, cantidad:cant, precioArs:precio, mep, comision:com, creado: initial?.creado || Date.now()
      });
      const np = f.pct.trim()==="" ? null : pct;
      if (onSaveConfig && (np===null || np>=0) && np !== (config?.comPct ?? null)) { try{ await onSaveConfig({...config, comPct:np}); }catch(e){} }
      onClose();
    }catch(e){ setErr("No se pudo guardar. Revisá tu conexión e intentá de nuevo."); setBusy(false); }
  };
  const del = async()=>{ setBusy(true); try{ await onDelete(initial.id); onClose(); }catch(e){ setErr("No se pudo borrar."); setBusy(false);} };
  const disp = holdings[f.ticker]?.cantidad ?? 0;

  return html`<div class="scrim" onClick=${e=>e.target===e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${isVenta?"Venta":"Compra"}>
      <div class="sheet-head"><h2>${initial?(isVenta?"Editar venta":"Editar compra"):(isVenta?"Nueva venta":"Nueva compra")}</h2><button class="linkbtn" onClick=${onClose}>Cerrar</button></div>
      ${!isVenta && html`<div class="seg" role="group" aria-label="Tipo">
        ${["CEDEAR","Acción"].map(t=>html`<button key=${t} aria-pressed=${f.tipo===t} onClick=${()=>setF({...f,tipo:t})}>${t}</button>`)}
      </div>`}
      <div class="two">
        <div class="field"><label for="fecha">Fecha</label><input id="fecha" type="date" value=${f.fecha} onChange=${set("fecha")} /></div>
        ${isVenta
          ? html`<div class="field"><label for="ticker">Ticker</label>
              <select id="ticker" value=${f.ticker} onChange=${set("ticker")}>${tickers.map(t=>html`<option key=${t} value=${t}>${t}</option>`)}</select></div>`
          : html`<div class="field"><label for="ticker">Ticker</label><input id="ticker" autocapitalize="characters" autocomplete="off" placeholder="AAPL" value=${f.ticker} onChange=${set("ticker")} /></div>`}
      </div>
      <div class="two">
        <div class="field"><label for="cantidad">Cantidad</label><input id="cantidad" inputmode="decimal" placeholder="10" value=${f.cantidad} onChange=${set("cantidad")} />
          ${isVenta && html`<span class="hint">Tenés hoy ${fQty(disp)}${f.ticker && !initial ? html` · <button class="linkbtn" style=${{padding:0}} onClick=${()=>setF({...f,cantidad:toField(disp)})}>vender todo</button>`:""}</span>`}
        </div>
        <div class="field"><label for="mep">TC MEP</label><input id="mep" inputmode="decimal" placeholder="1450,50" value=${f.mep} onChange=${set("mep")} />
          ${mepPre && f.mep===toField(defaultMep) && html`<span class="hint">Último MEP que usaste. Cambialo si hoy es otro.</span>`}</div>
      </div>
      <div class="field"><label for="precio">${isVenta?"Precio venta $":"Valor compra $"} (por unidad)</label><input id="precio" inputmode="decimal" placeholder="18500,00" value=${f.precio} onChange=${set("precio")} /></div>
      <div class="two com-row">
        <div class="field"><label for="pct">Comisión broker %</label><input id="pct" inputmode="decimal" placeholder="0,6" value=${f.pct} onChange=${e=>setF({...f,pct:e.target.value,comManual:false})} />
          <span class="hint">Se recuerda para la próxima.</span></div>
        <div class="field"><label for="comision">Comisión $ (total)</label><input id="comision" inputmode="decimal" placeholder="0,00" value=${comTxt} onChange=${e=>setF({...f,comision:e.target.value,comManual:true})} />
          <span class="hint usd">${mep>0 && com>0 ? "= "+fUSD(com/mep) : autoCom==null && pct>0 ? "Se calcula sola" : "Incluí derechos e IVA"}</span>
          ${f.comManual && pct>0 && html`<button class="linkbtn" style=${{padding:0,justifySelf:"start"}} onClick=${()=>setF({...f,comManual:false})}>Usar ${f.pct} %</button>`}</div>
      </div>

      <div class="preview">
        ${!prev ? html`<span class="date">${isVenta
            ? "Completá los datos y acá vas a ver cuánto cobrás neto y el rendimiento en pesos y en dólares."
            : "Completá los datos y acá vas a ver el valor en USD, la comisión, el monto total y cómo queda tu PPC."}</span>`
          : isVenta ? html`
            <div class="grid">
              <${KV} k="Precio venta USD" v=${fUSD(prev.usdUnit)} cls="usd" />
              <${KV} k="Comisión USD" v=${fUSD(prev.comUsd)} cls="usd" />
              <${KV} k="Neto cobrado $" v=${fARS(prev.netoArs)} cls="ars" />
              <${KV} k="Neto cobrado USD" v=${fUSD(prev.netoUsd)} cls="usd" />
              <${KV} k="Costo (PPC) $" v=${fARS(prev.costoArs)} cls="ars" />
              <${KV} k="Costo (PPC) USD" v=${fUSD(prev.costoUsd)} cls="usd" />
            </div>
            <${Rend} v=${prev} />`
          : html`
            <div class="grid">
              <${KV} k="Valor compra USD" v=${fUSD(prev.usdUnit)} cls="usd" />
              <${KV} k="Comisión USD" v=${fUSD(prev.comUsd)} cls="usd" />
              <${KV} k=${"PPC $ "+f.ticker} v=${fARS(prev.ppcArs)} cls="ars" />
              <${KV} k=${"PPC USD "+f.ticker} v=${fUSD(prev.ppcUsd)} cls="usd" />
            </div>
            <div class="total"><span class="date">Monto total (con comisión)</span><span><b class="ars">${fARS(prev.totalArs)}</b> · <span class="num usd">${fUSD(prev.totalUsd)}</span></span></div>`}
      </div>
      ${err && html`<div class="err">${err}</div>`}
      <div class="actions"><button class=${"btn "+(isVenta?"sellbtn":"primary")} disabled=${busy} onClick=${save}>${initial?"Guardar cambios":(isVenta?"Registrar venta":"Agregar compra")}</button></div>
      ${initial && (confirm
        ? html`<div class="actions"><button class="btn ghost" onClick=${()=>setConfirm(false)}>Cancelar</button><button class="btn danger" disabled=${busy} onClick=${del}>Sí, borrar</button></div>`
        : html`<div class="actions"><button class="btn danger" onClick=${()=>setConfirm(true)}>Borrar ${isVenta?"venta":"compra"}</button></div>`)}
    </div>
  </div>`;
}

function DivSheet({initial,grupos,onClose,onSave,onDelete,defaultMep}){
  const tickers = grupos.map(g=>g.ticker).sort();
  const [f,setF] = useState(()=> initial ? {fecha:initial.fecha,ticker:initial.ticker,moneda:initial.moneda||"USD",monto:toField(initial.monto),retencion:toField(initial.retencion),mep:toField(initial.mep)}
    : {fecha:today(),ticker:(grupos.find(g=>g.cantidad>EPS)||grupos[0])?.ticker||"",moneda:"USD",monto:"",retencion:"",mep:toField(defaultMep)});
  const [confirm,setConfirm] = useState(false), [busy,setBusy] = useState(false), [err,setErr] = useState("");
  const set = k => e => setF({...f,[k]:e.target.value});
  const monto = parse(f.monto), mep = parse(f.mep), ret = f.retencion.trim()==="" ? 0 : parse(f.retencion);
  const ok = f.fecha && f.ticker && monto>0 && mep>0 && ret>=0;
  const U = f.moneda==="USD";
  const g = grupos.find(x=>x.ticker===f.ticker);
  const save = async()=>{
    if(!ok){ setErr("Completá fecha, ticker, monto cobrado y TC MEP con números mayores a cero. La retención puede quedar vacía."); return; }
    setBusy(true); setErr("");
    try{
      await onSave(initial?.id || ("d"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)),
        {op:"dividendo", fecha:f.fecha, ticker:f.ticker, tipo:g?.tipo||"CEDEAR", moneda:f.moneda, monto, retencion:ret, mep, creado: initial?.creado || Date.now()});
      onClose();
    }catch(e){ setErr("No se pudo guardar. Revisá tu conexión e intentá de nuevo."); setBusy(false); }
  };
  const del = async()=>{ setBusy(true); try{ await onDelete(initial.id); onClose(); }catch(e){ setErr("No se pudo borrar."); setBusy(false);} };
  const usd = U ? monto : monto/mep, ars = U ? monto*mep : monto;
  return html`<div class="scrim" onClick=${e=>e.target===e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Dividendo">
      <div class="sheet-head"><h2>${initial?"Editar dividendo":"Nuevo dividendo"}</h2><button class="linkbtn" onClick=${onClose}>Cerrar</button></div>
      <div class="two">
        <div class="field"><label for="dfecha">Fecha de cobro</label><input id="dfecha" type="date" value=${f.fecha} onChange=${set("fecha")} /></div>
        <div class="field"><label for="dticker">Ticker</label><select id="dticker" value=${f.ticker} onChange=${set("ticker")}>${tickers.map(t=>html`<option key=${t} value=${t}>${t}</option>`)}</select></div>
      </div>
      <div class="field"><label>Lo cobraste en</label>
        <div class="seg" role="group" aria-label="Moneda del dividendo">
          <button aria-pressed=${U} onClick=${()=>setF({...f,moneda:"USD"})}>Dólares</button>
          <button aria-pressed=${!U} onClick=${()=>setF({...f,moneda:"ARS"})}>Pesos</button>
        </div></div>
      <div class="two">
        <div class="field"><label for="dmonto">Neto cobrado ${U?"USD":"$"}</label><input id="dmonto" inputmode="decimal" placeholder=${U?"12,50":"18000"} value=${f.monto} onChange=${set("monto")} />
          <span class="hint">Lo que te acreditaron, ya descontada la retención.</span></div>
        <div class="field"><label for="dmep">TC MEP</label><input id="dmep" inputmode="decimal" placeholder="1450,50" value=${f.mep} onChange=${set("mep")} /></div>
      </div>
      <div class="field"><label for="dret">Retención ${U?"USD":"$"} (opcional)</label><input id="dret" inputmode="decimal" placeholder="0" value=${f.retencion} onChange=${set("retencion")} /></div>
      <div class="preview">
        ${ok ? html`<div class="grid">
            <${KV} k="Equivale en $" v=${fARS(ars)} cls="ars" />
            <${KV} k="Equivale en USD" v=${fUSD(usd)} cls="usd" />
            <${KV} k="Tenés hoy" v=${g?fQty(g.cantidad)+" u.":"—"} />
            <${KV} k="Rinde sobre tu costo" v=${g && g.usd>EPS ? fPct(usd/g.usd*100) : "—"} cls="divc" />
          </div>`
          : html`<span class="date">El dividendo se suma a tu ganancia realizada y no cambia tu PPC.</span>`}
      </div>
      ${err && html`<div class="err">${err}</div>`}
      <div class="actions"><button class="btn divbtn" disabled=${busy} onClick=${save}>${initial?"Guardar cambios":"Registrar dividendo"}</button></div>
      ${initial && (confirm
        ? html`<div class="actions"><button class="btn ghost" onClick=${()=>setConfirm(false)}>Cancelar</button><button class="btn danger" disabled=${busy} onClick=${del}>Sí, borrar</button></div>`
        : html`<div class="actions"><button class="btn danger" onClick=${()=>setConfirm(true)}>Borrar dividendo</button></div>`)}
    </div>
  </div>`;
}

function SplitSheet({initial,ticker,rows,grupos,onClose,onSave,onDelete}){
  const [f,setF] = useState(()=>({fecha: initial?.fecha || today(), ticker: initial?.ticker || ticker || grupos.find(g=>g.cantidad>EPS)?.ticker || "", nueva:""}));
  const [confirm,setConfirm] = useState(false), [busy,setBusy] = useState(false), [err,setErr] = useState("");
  const tickers = grupos.filter(g=>g.cantidad>EPS || g.ticker===f.ticker).map(g=>g.ticker).sort();
  const tenia = useMemo(()=>{
    const before = rows.filter(r=>r.id!==initial?.id && r.ticker===f.ticker && r.fecha<=f.fecha);
    const gg = compute(before).grupos.find(x=>x.ticker===f.ticker); return gg ? gg.cantidad : 0;
  },[rows,f.ticker,f.fecha]);
  useEffect(()=>{ if (initial && f.nueva==="" && tenia>0) setF(x=>({...x, nueva:toField(Math.round(tenia*initial.factor*1e6)/1e6)})); },[tenia]);
  const nueva = parse(f.nueva);
  const factor = tenia>EPS && nueva>0 ? nueva/tenia : NaN;
  const ok = f.fecha && f.ticker && isFinite(factor) && Math.abs(factor-1)>1e-9;
  const g = grupos.find(x=>x.ticker===f.ticker);
  const save = async()=>{
    if(!ok){ setErr(tenia>EPS ? "Poné la cantidad que tenés después del split (distinta de la de antes)." : "A esa fecha no tenías ese ticker."); return; }
    setBusy(true); setErr("");
    try{ await onSave(initial?.id || ("a"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)),
      {op:"ajuste", fecha:f.fecha, ticker:f.ticker, tipo:g?.tipo||"CEDEAR", factor, creado: initial?.creado || Date.now()}); onClose(); }
    catch(e){ setErr("No se pudo guardar. Revisá tu conexión e intentá de nuevo."); setBusy(false); }
  };
  const del = async()=>{ setBusy(true); try{ await onDelete(initial.id); onClose(); }catch(e){ setErr("No se pudo borrar."); setBusy(false);} };
  const rel = isFinite(factor) ? (factor>=1 ? `1 → ${fQty(Math.round(factor*1e4)/1e4)}` : `${fQty(Math.round(1/factor*1e4)/1e4)} → 1`) : "—";
  return html`<div class="scrim" onClick=${e=>e.target===e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Split">
      <div class="sheet-head"><h2>${initial?"Editar split":"Split o cambio de ratio"}</h2><button class="linkbtn" onClick=${onClose}>Cerrar</button></div>
      <span class="hint">Usalo cuando el broker te cambia la cantidad de un CEDEAR o acción sin que compres ni vendas. Lo invertido no cambia; se ajustan la cantidad y el PPC.</span>
      <div class="two">
        <div class="field"><label for="sfecha">Fecha</label><input id="sfecha" type="date" value=${f.fecha} onChange=${e=>setF({...f,fecha:e.target.value})} /></div>
        <div class="field"><label for="sticker">Ticker</label><select id="sticker" value=${f.ticker} onChange=${e=>setF({...f,ticker:e.target.value})}>${tickers.map(t=>html`<option key=${t} value=${t}>${t}</option>`)}</select></div>
      </div>
      <div class="two">
        <div class="field"><label>Tenías</label><div class="ro num">${fQty(tenia)} u.</div></div>
        <div class="field"><label for="snueva">Ahora tenés</label><input id="snueva" inputmode="decimal" placeholder=${tenia?toField(tenia*3):"30"} value=${f.nueva} onChange=${e=>setF({...f,nueva:e.target.value})} /></div>
      </div>
      <div class="preview">
        ${ok && g ? html`<div class="grid">
            <${KV} k="Relación" v=${rel} />
            <${KV} k="Factor" v=${"×"+fQty(Math.round(factor*1e4)/1e4)} />
            <${KV} k="PPC $ antes → después" v=${fARS(g.ppcArs)+" → "+fARS(g.ppcArs/factor)} cls="ars" />
            <${KV} k="PPC USD antes → después" v=${fUSD(g.ppcUsd)+" → "+fUSD(g.ppcUsd/factor)} cls="usd" />
          </div>`
          : html`<span class="date">Ejemplo: si tenías 10 y el broker te dejó 30, es un split 1 → 3 y tu PPC se divide por 3.</span>`}
      </div>
      ${err && html`<div class="err">${err}</div>`}
      <div class="actions"><button class="btn primary" disabled=${busy} onClick=${save}>${initial?"Guardar cambios":"Registrar split"}</button></div>
      ${initial && (confirm
        ? html`<div class="actions"><button class="btn ghost" onClick=${()=>setConfirm(false)}>Cancelar</button><button class="btn danger" disabled=${busy} onClick=${del}>Sí, borrar</button></div>`
        : html`<div class="actions"><button class="btn danger" onClick=${()=>setConfirm(true)}>Borrar split</button></div>`)}
    </div>
  </div>`;
}

function PriceSheet({pos,precios,defaultMep,onClose,onSave}){
  const [mepTxt,setMepTxt] = useState(toField(precios?.mep || defaultMep));
  const [vals,setVals] = useState(()=>Object.fromEntries(pos.map(x=>[x.ticker, toField(precios?.p?.[x.ticker])])));
  const [busy,setBusy] = useState(false), [err,setErr] = useState("");
  const mep = parse(mepTxt);
  const nums = Object.fromEntries(pos.map(x=>[x.ticker, parse(vals[x.ticker])]));
  const v = valuar(pos, {mep, p: Object.fromEntries(Object.entries(nums).filter(([,n])=>n>0))});
  const save = async()=>{
    if (!(mep>0)){ setErr("Cargá el MEP de hoy."); return; }
    const p = {...(precios?.p||{})}; Object.entries(nums).forEach(([t,n])=>{ if(n>0) p[t]=n; });
    setBusy(true); setErr("");
    try{ await onSave({mep, fecha: today(), at: Date.now(), p}); onClose(); }
    catch(e){ setErr("No se pudo guardar. Revisá tu conexión e intentá de nuevo."); setBusy(false); }
  };
  return html`<div class="scrim" onClick=${e=>e.target===e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Actualizar precios">
      <div class="sheet-head"><h2>Actualizar precios</h2><button class="linkbtn" onClick=${onClose}>Cerrar</button></div>
      <span class="hint">Copiá de tu broker el último precio en pesos de cada uno. Con eso calculo cuánto vale hoy tu cartera.</span>
      <div class="field"><label for="pmep">TC MEP de hoy</label><input id="pmep" inputmode="decimal" placeholder="1450,50" value=${mepTxt} onChange=${e=>setMepTxt(e.target.value)} /></div>
      <div class="plist">${pos.map(x=>{ const pv = v.por[x.ticker];
        return html`<div class="prow" key=${x.ticker}>
          <div class="pinfo"><b>${x.ticker}</b><span class="hint">${fQty(x.cantidad)} u. · PPC ${fARS(x.ppcArs)}</span>
            ${pv && html`<span class=${"num "+sign(pv.nrUsd)} style=${{fontSize:"12px"}}>${fSigned(fUSD,pv.nrUsd)} (${fPct(pv.pctUsd)})</span>`}</div>
          <input id=${"pr-"+x.ticker} aria-label=${"Precio de "+x.ticker} inputmode="decimal" placeholder="Precio $" value=${vals[x.ticker]} onChange=${e=>setVals({...vals,[x.ticker]:e.target.value})} />
        </div>`; })}</div>
      ${v.hay && html`<div class="preview"><div class="grid">
        <${KV} k="Valor hoy" v=${fUSD(v.valUsd)} cls="usd" />
        <${KV} k="Sin realizar" v=${fSigned(fUSD,v.nrUsd)} cls=${sign(v.nrUsd)} />
      </div></div>`}
      ${err && html`<div class="err">${err}</div>`}
      <div class="actions"><button class="btn primary" disabled=${busy} onClick=${save}>Guardar precios</button></div>
    </div>
  </div>`;
}

/* ---------- Excel ---------- */
const HEAD = ["Fecha","Operación","Tipo","Ticker","Cantidad","Precio $ (unidad)","TC MEP","Comisión $","ID",
  "Precio USD (unidad)","Comisión USD","Monto total $","Monto total USD","PPC $","PPC USD",
  "Costo vendido $","Costo vendido USD","Rendimiento $","Rendimiento $ %","Rendimiento USD","Rendimiento USD %",
  "Moneda dividendo","Dividendo neto","Retención","Factor split"];
const serial = s => { const [y,m,d]=s.split("-").map(Number); return (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000; };
const pad = n => String(n).padStart(2,"0");
function cellDate(v){
  if (typeof v==="number"){ const p = XLSX.SSF.parse_date_code(v); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null; }
  const s = String(v??"").trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) return `${m[3].length===2?"20"+m[3]:m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
const cellNum = v => typeof v==="number" ? v : parse(v);

function buildWorkbook(rows){
  const data = compute(rows);
  const movs = [...data.movs].reverse(); // cronológico
  const aoa = [HEAD, ...movs.map(m=>{
    if (m.op==="dividendo") return [serial(m.fecha),"Dividendo",m.tipo,m.ticker,"","",m.mep,"",m.id,"","",m.divArs,m.divUsd,"","","","",m.divArs,"",m.divUsd,"",
      m.moneda==="USD"?"USD":"$", m.monto, m.retencion||0, ""];
    if (m.op==="ajuste") return [serial(m.fecha),"Split",m.tipo,m.ticker,m.despues,"","","",m.id,"","","","","","","","","","","","","","","",m.factor];
    const v = m.op==="venta";
    return [serial(m.fecha), v?"Venta":"Compra", m.tipo, m.ticker, m.cantidad, m.precioArs, m.mep, m.comision||0, m.id,
      m.usdUnit, m.comUsd, v?m.netoArs:m.totalArs, v?m.netoUsd:m.totalUsd, m.ppcArs, m.ppcUsd,
      v?m.costoArs:"", v?m.costoUsd:"", v?m.resArs:"", v&&isFinite(m.pctArs)?m.pctArs/100:"", v?m.resUsd:"", v&&isFinite(m.pctUsd)?m.pctUsd/100:"","","","",""];
  })];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const money = [5,6,7,9,10,11,12,13,14,15,16,17,19,22,23], pct = [18,20];
  for (let r=1; r<aoa.length; r++){
    const a = XLSX.utils.encode_cell({r,c:0}); if (ws[a]) ws[a].z = "dd/mm/yyyy";
    money.forEach(c=>{ const k=XLSX.utils.encode_cell({r,c}); if (ws[k] && ws[k].t==="n") ws[k].z = "#,##0.00"; });
    pct.forEach(c=>{ const k=XLSX.utils.encode_cell({r,c}); if (ws[k] && ws[k].t==="n") ws[k].z = "0.00%"; });
  }
  ws["!cols"] = HEAD.map((h,i)=>({wch: i===8?16 : Math.max(11,h.length+2)}));
  ws["!autofilter"] = {ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(aoa.length-1,0),c:HEAD.length-1}})};

  const totUsd = data.pos.reduce((s,p)=>s+p.usd,0);
  const cart = [["Ticker","Tipo","Cantidad","PPC $","PPC USD","Invertido $","Invertido USD","% de la cartera"],
    ...data.pos.map(p=>[p.ticker,p.tipo,p.cantidad,p.ppcArs,p.ppcUsd,p.ars,p.usd,totUsd?p.usd/totUsd:0])];
  const ws2 = XLSX.utils.aoa_to_sheet(cart);
  for (let r=1; r<cart.length; r++){
    [3,4,5,6].forEach(c=>{ ws2[XLSX.utils.encode_cell({r,c})].z = "#,##0.00"; });
    ws2[XLSX.utils.encode_cell({r,c:7})].z = "0.00%";
  }
  ws2["!cols"] = cart[0].map(h=>({wch:Math.max(12,h.length+2)}));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
  XLSX.utils.book_append_sheet(wb, ws2, "Cartera");
  return XLSX.write(wb, {type:"array", bookType:"xlsx"});
}

function readWorkbook(buf){
  const wb = XLSX.read(buf, {type:"array"});
  const name = wb.SheetNames.find(n=>/operaciones/i.test(n)) || wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true, defval:""});
  if (!raw.length) return {ok:[], errors:["La hoja está vacía."]};
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z$]/g,"");
  const head = raw[0].map(norm);
  const col = (...keys) => head.findIndex(h=> keys.some(k=> h===k || h.startsWith(k)));
  const C = { fecha:col("fecha"), op:col("operacion","op"), tipo:col("tipo"), ticker:col("ticker","especie"),
    cant:col("cantidad"), precio:col("precio$","preciounidad","valorcompra$","precio"), mep:col("tcmep","mep"), com:col("comision$","comision"), id:col("id"),
    dmon:col("monedadividendo"), dmonto:col("dividendoneto","dividendo"), ret:col("retencion"), factor:col("factorsplit","factor") };
  const miss = ["fecha","ticker","mep"].filter(k=>C[k]<0);
  if (miss.length) return {ok:[], errors:[`Faltan columnas en la hoja "${name}": ${miss.map(k=>({fecha:"Fecha",ticker:"Ticker",cant:"Cantidad",precio:"Precio $ (unidad)",mep:"TC MEP"})[k]).join(", ")}.`]};
  const ok = [], errors = [];
  raw.slice(1).forEach((r,i)=>{
    const fila = i+2;
    if (r.every(v=>v===""||v==null)) return;
    const fecha = cellDate(r[C.fecha]);
    const opTxt = C.op>=0 ? norm(r[C.op]) : "compra";
    const op = opTxt.startsWith("v") ? "venta" : opTxt.startsWith("d") ? "dividendo" : opTxt.startsWith("s") || opTxt.startsWith("aj") ? "ajuste" : opTxt.startsWith("c") || opTxt==="" ? "compra" : null;
    const tipoTxt = C.tipo>=0 ? norm(r[C.tipo]) : "";
    const tipo = tipoTxt.startsWith("acc") ? "Acción" : "CEDEAR";
    const ticker = String(r[C.ticker]??"").toUpperCase().replace(/\s/g,"");
    const cantidad = C.cant>=0 ? cellNum(r[C.cant]) : NaN, precioArs = C.precio>=0 ? cellNum(r[C.precio]) : NaN, mep = cellNum(r[C.mep]);
    const comision = C.com>=0 && r[C.com]!=="" ? cellNum(r[C.com]) : 0;
    const id = C.id>=0 ? String(r[C.id]??"").trim() : "";
    const bad = [];
    if (op==="ajuste"){
      const factor = C.factor>=0 ? cellNum(r[C.factor]) : NaN;
      if (!fecha) bad.push("fecha"); if (!ticker) bad.push("ticker"); if (!(factor>0)) bad.push("factor split");
      if (bad.length){ errors.push(`Fila ${fila}: revisá ${bad.join(", ")}.`); return; }
      ok.push({ id: /^[A-Za-z0-9_\-.~:@+]{1,100}$/.test(id) ? id : "", op, fecha, tipo, ticker, factor, creado: Date.now()+i });
      return;
    }
    if (op==="dividendo"){
      const monto = C.dmonto>=0 ? cellNum(r[C.dmonto]) : NaN, retencion = C.ret>=0 && r[C.ret]!=="" ? cellNum(r[C.ret]) : 0;
      const moneda = C.dmon>=0 && /^\$|ars|peso/i.test(String(r[C.dmon]).trim()) ? "ARS" : "USD";
      if (!fecha) bad.push("fecha"); if (!ticker) bad.push("ticker"); if (!(monto>0)) bad.push("dividendo neto"); if (!(mep>0)) bad.push("TC MEP"); if (!(retencion>=0)) bad.push("retención");
      if (bad.length){ errors.push(`Fila ${fila}: revisá ${bad.join(", ")}.`); return; }
      ok.push({ id: /^[A-Za-z0-9_\-.~:@+]{1,100}$/.test(id) ? id : "", op, fecha, tipo, ticker, moneda, monto, retencion, mep, creado: Date.now()+i });
      return;
    }
    if (C.cant<0 || C.precio<0){ errors.push(`Fila ${fila}: faltan las columnas Cantidad o Precio $ (unidad).`); return; }
    if (!fecha) bad.push("fecha"); if (!op) bad.push("operación (Compra, Venta, Dividendo o Split)"); if (!ticker) bad.push("ticker");
    if (!(cantidad>0)) bad.push("cantidad"); if (!(precioArs>0)) bad.push("precio"); if (!(mep>0)) bad.push("TC MEP");
    if (!(comision>=0)) bad.push("comisión");
    if (bad.length){ errors.push(`Fila ${fila}: revisá ${bad.join(", ")}.`); return; }
    ok.push({ id: /^[A-Za-z0-9_\-.~:@+]{1,100}$/.test(id) ? id : "", op, fecha, tipo, ticker, cantidad, precioArs, mep, comision, creado: Date.now()+i });
  });
  return {ok, errors, sheet:name};
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Guarda un archivo sin depender de Claude: en iPhone abre el menú Compartir (Guardar en Archivos, Mail, WhatsApp…);
// donde no se puede compartir archivos, lo descarga con un enlace temporal.
async function guardarArchivo(nombre, blob){
  try{
    const file = new File([blob], nombre, {type: blob.type});
    if (navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:nombre}); return "compartido"; }
  }catch(e){ if (e && e.name==="AbortError") throw e; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 10000);
  return "descargado";
}

function ExcelSheet({rows,api,onClose}){
  const [msg,setMsg] = useState("");
  const [busy,setBusy] = useState(false);
  const [plan,setPlan] = useState(null);   // {ok, errors, file}
  const [progress,setProgress] = useState(null);
  const [dl,setDl] = useState(undefined);
  // En Claude se usa su capacidad de descargas; instalada como PWA se usa el guardado nativo del navegador.
  useEffect(()=>{ (async()=>{ const c = window.claude?.use ? await window.claude.use("downloads") : null; setDl(c || "nativo"); })(); },[]);

  const exportar = async()=>{
    setMsg(""); setBusy(true);
    try{
      const buf = buildWorkbook(rows);
      const nombre = `cartera-mep-${today()}.xlsx`;
      if (dl==="nativo"){
        const r = await guardarArchivo(nombre, new Blob([buf],{type:XLSX_MIME}));
        setMsg(r==="compartido" ? "Listo. Elegí “Guardar en Archivos” para tenerlo en tu iPhone." : "Listo, el Excel se descargó.");
      } else {
        const r = await dl.save({filename:nombre, data:new Blob([buf])});
        setMsg(r.status==="saved" ? "Listo, el Excel se descargó." : "Listo, el Excel se envió.");
      }
    }catch(e){
      setMsg(e?.name==="AbortError" || e?.code==="declined" ? "Cancelaste la descarga." : e?.code==="rate_limited" ? "Ya hay una descarga esperando confirmación." : "No se pudo generar la descarga en esta vista.");
    }
    setBusy(false);
  };

  const elegir = async e=>{
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setMsg(""); setPlan(null);
    try{ const res = readWorkbook(await file.arrayBuffer()); setPlan({...res, file:file.name}); }
    catch(err){ setMsg("No pude leer ese archivo. Tiene que ser un Excel (.xlsx o .xls) o un .csv."); }
  };

  const aplicar = async reemplazar=>{
    setBusy(true); setMsg("");
    const writes = plan.ok.map((r,i)=>{
      const {id,...body} = r;
      const nid = id ? id : (r.op==="venta"?"v":"c")+Date.now().toString(36)+i.toString(36)+Math.random().toString(36).slice(2,5);
      return [nid, body];
    });
    const keep = new Set(writes.map(w=>w[0]));
    const borrar = reemplazar ? rows.filter(r=>!keep.has(r.id)).map(r=>r.id) : [];
    const total = writes.length + borrar.length; let done = 0, fail = 0;
    setProgress({done,total});
    for (const id of borrar){ try{ await api.remove(id); }catch(e){ fail++; } setProgress({done:++done,total}); }
    for (const [id,body] of writes){ try{ await api.save(id,body); }catch(e){ fail++; } setProgress({done:++done,total}); }
    setProgress(null); setBusy(false); setPlan(null);
    setMsg(fail ? `Se importaron ${writes.length-fail} de ${writes.length} operaciones. Algunas no se pudieron guardar; probá importar de nuevo.`
                : `Listo: ${writes.length} ${writes.length===1?"operación importada":"operaciones importadas"}${borrar.length?` y ${borrar.length} anteriores borradas`:""}.`);
  };

  const nuevas = plan ? plan.ok.filter(r=>!r.id || !rows.some(x=>x.id===r.id)).length : 0;
  const actualiza = plan ? plan.ok.length - nuevas : 0;

  return html`<div class="scrim" onClick=${e=>e.target===e.currentTarget && !busy && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Excel">
      <div class="sheet-head"><h2>Excel</h2><button class="linkbtn" disabled=${busy} onClick=${onClose}>Cerrar</button></div>

      <div class="preview">
        <h3>Exportar</h3>
        <span class="hint">Descarga un .xlsx con dos hojas: <b>Operaciones</b> (todas tus compras y ventas, con PPC, comisiones en $ y USD y rendimientos) y <b>Cartera</b> (tenencia actual por ticker).</span>
        ${dl===null
          ? html`<span class="err">La descarga de archivos no está disponible en esta vista. Abrí la app desde claude.ai con tu sesión iniciada.</span>`
          : html`<button class="btn primary" disabled=${busy || dl===undefined} onClick=${exportar}>Descargar Excel (${rows.length} ${rows.length===1?"operación":"operaciones"})</button>`}
      </div>

      <div class="preview">
        <h3>Importar</h3>
        <span class="hint">Usá la hoja <b>Operaciones</b> de un Excel exportado desde acá, o una propia con las columnas Fecha, Operación (Compra/Venta), Tipo (CEDEAR/Acción), Ticker, Cantidad, Precio $ (unidad), TC MEP y Comisión $. Las demás columnas se recalculan solas.</span>
        <label class="btn ghost" style=${{textAlign:"center",display:"block"}} for="xls">Elegir archivo…</label>
        <input id="xls" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="vh-input" onChange=${elegir} />
        ${plan && html`
          <div class="grid">
            <${KV} k="Archivo" v=${plan.file} />
            <${KV} k="Válidas" v=${plan.ok.length} cls=${plan.ok.length?"pos":""} />
            <${KV} k="Nuevas" v=${nuevas} />
            <${KV} k="Actualiza" v=${actualiza} />
          </div>
          ${plan.errors.length>0 && html`<div class="err">${plan.errors.length} ${plan.errors.length===1?"fila con problemas no se va a importar":"filas con problemas no se van a importar"}:<br/>${plan.errors.slice(0,6).map((e,i)=>html`<span key=${i}>${e}<br/></span>`)}${plan.errors.length>6?`y ${plan.errors.length-6} más.`:""}</div>`}
          ${plan.ok.length>0 && html`
            <div class="actions"><button class="btn primary" disabled=${busy} onClick=${()=>aplicar(false)}>Agregar a mis datos</button></div>
            <div class="actions"><button class="btn danger" disabled=${busy} onClick=${()=>aplicar(true)}>Reemplazar todo por el Excel</button></div>
            <span class="hint">“Agregar” suma las filas nuevas y actualiza las que tienen el mismo ID. “Reemplazar” borra lo que tengas cargado y deja solo lo del archivo.</span>`}`}
        ${progress && html`<span class="hint">Guardando ${progress.done} de ${progress.total}…</span>`}
      </div>
      ${msg && html`<div class="hint" style=${{color:"var(--ink)"}}>${msg}</div>`}
    </div>
  </div>`;
}

/* ---------- períodos y gráficos ---------- */
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const perLabel = (k,largo) => k.length===4 ? k : largo
  ? MESES[+k.slice(5,7)-1].replace(/^./,c=>c.toUpperCase())+" "+k.slice(0,4)
  : MESES[+k.slice(5,7)-1].slice(0,3)+" "+k.slice(2,4);
function periodos(movs, anual){
  const m = {};
  movs.forEach(x=>{
    const k = anual ? x.fecha.slice(0,4) : x.fecha.slice(0,7);
    const p = m[k] ||= {k,n:0,compArs:0,compUsd:0,ventArs:0,ventUsd:0,resArs:0,resUsd:0,costoArs:0,costoUsd:0,comArs:0,comUsd:0,divArs:0,divUsd:0,nv:0,nd:0,na:0,movs:[]};
    p.n++; p.movs.push(x); p.comArs += x.comision||0; p.comUsd += x.comUsd||0;
    if (x.op==="ajuste"){ p.na++; }
    else if (x.op==="dividendo"){ p.divArs+=x.divArs; p.divUsd+=x.divUsd; p.nd++; }
    else if (x.op==="venta"){ p.nv++; p.ventArs+=x.netoArs; p.ventUsd+=x.netoUsd; p.resArs+=x.resArs; p.resUsd+=x.resUsd; p.costoArs+=x.costoArs; p.costoUsd+=x.costoUsd; }
    else { p.compArs+=x.totalArs; p.compUsd+=x.totalUsd; }
  });
  return Object.values(m).sort((a,b)=>a.k<b.k?-1:1);
}
function niceMax(v){ if(!(v>0)) return 1; const p=10**Math.floor(Math.log10(v)); const n=v/p; return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p; }
const fCompact = n => (n<0?"−":"") + Math.abs(n).toLocaleString("es-AR",{notation:"compact",maximumFractionDigits:1});
function useWidth(){
  const ref = React.useRef(null); const [w,setW] = useState(320);
  useEffect(()=>{ const el=ref.current; if(!el) return; const ro=new ResizeObserver(e=>setW(Math.max(260,Math.floor(e[0].contentRect.width)))); ro.observe(el); return ()=>ro.disconnect(); },[]);
  return [ref,w];
}
function bar(x,yb,w,yt,rr=4){ // redondeado en el extremo libre, anclado a la base
  const h = Math.abs(yb-yt); if (h<0.5) return `M${x} ${yb-0.5}h${w}v1h${-w}Z`;
  const r = Math.min(rr,w/2,h);
  if (!r) return `M${x} ${yb}H${x+w}V${yt}H${x}Z`;
  return yt<yb
    ? `M${x} ${yb}V${yt+r}Q${x} ${yt} ${x+r} ${yt}H${x+w-r}Q${x+w} ${yt} ${x+w} ${yt+r}V${yb}Z`
    : `M${x} ${yb}V${yt-r}Q${x} ${yt} ${x+r} ${yt}H${x+w-r}Q${x+w} ${yt} ${x+w} ${yt-r}V${yb}Z`;
}
function PerChart({pers,sel,setSel,series,stacked}){
  const [ref,cw] = useWidth();
  const padL=40, padR=4, padT=10, H=180, axisH=22;
  const gw = Math.max(44, (cw-padL-padR)/Math.max(pers.length,1));
  const W = Math.max(cw, padL+padR+gw*pers.length);
  let hiV=0, loV=0;
  pers.forEach(p=>{ let ps=0, ns=0; series.forEach(s=>{ const v=s.get(p)||0; if(stacked){ v>=0?ps+=v:ns+=v; } else { ps=Math.max(ps,v); ns=Math.min(ns,v); } }); hiV=Math.max(hiV,ps); loV=Math.min(loV,ns); });
  const R = niceMax(Math.max(hiV,-loV));
  const hi = hiV>0 || loV===0 ? (loV<0 ? R : niceMax(hiV)) : 0, lo = loV<0 ? (hiV>0 ? -R : -niceMax(-loV)) : 0;
  const plotH = H-padT-axisH;
  const y = v => padT + (hi-v)/(hi-lo)*plotH;
  const ticks = lo<0 && hi>0 ? [hi,0,lo] : lo<0 ? [0,lo/2,lo] : [hi,hi/2,0];
  const n = stacked ? 1 : series.length;
  const bw = Math.max(6, Math.min(stacked?22:14, (gw-16)/n-2));
  useEffect(()=>{ const el=ref.current; if(el) el.scrollLeft = el.scrollWidth; },[pers.length,cw]);
  return html`<div class="chart-scroll" ref=${ref}>
    <svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Gráfico por período">
      ${ticks.map((t,i)=>html`<g key=${"t"+i}>
        <line x1=${padL} x2=${W-padR} y1=${y(t)} y2=${y(t)} stroke="var(--line)" stroke-width="1" stroke-dasharray=${t===0?"":"2 4"} />
        <text x=${padL-8} y=${y(t)+3} text-anchor="end">${fCompact(t)}</text></g>`)}
      ${pers.map((p,i)=>{
        const gx = padL + i*gw, cx = gx+gw/2, x0 = cx - (n*bw + (n-1)*2)/2, on = sel===p.k;
        let marks;
        if (stacked){
          const vals = series.map(s=>s.get(p)||0);
          const lastPos = vals.map((v,j)=>v>0?j:-1).filter(j=>j>=0).pop(), lastNeg = vals.map((v,j)=>v<0?j:-1).filter(j=>j>=0).pop();
          let pb=0, nb=0;
          marks = series.map((s,j)=>{ const v=vals[j]; if(!v) return null;
            const b0 = v>0?pb:nb, b1 = b0+v; if(v>0) pb=b1; else nb=b1;
            const gap = b0===0 ? 0 : (v>0?-1:1);
            return html`<path key=${j} d=${bar(x0, y(b0)+gap, bw, y(b1), (j===lastPos||j===lastNeg)?4:0)} fill=${typeof s.color==="function"?s.color(v):s.color} />`; });
        } else marks = series.map((s,j)=>{ const v=s.get(p)||0;
            return html`<path key=${j} d=${bar(x0+j*(bw+2), y(0), bw, y(v))} fill=${typeof s.color==="function"?s.color(v):s.color} />`; });
        return html`<g key=${p.k} onClick=${()=>setSel(p.k)} style=${{cursor:"pointer"}} opacity=${sel && !on ? 0.55 : 1}>
          ${on && html`<rect x=${gx+3} y=${padT-6} width=${gw-6} height=${plotH+12} rx="8" fill="var(--chip)" />`}
          ${marks}
          <text x=${cx} y=${H-6} text-anchor="middle" style=${on?{fill:"var(--ink)",fontWeight:600}:null}>${perLabel(p.k)}</text>
          <rect x=${gx} y="0" width=${gw} height=${H} fill="transparent" />
        </g>`; })}
    </svg></div>`;
}

function Resultados({data,cur,setCur,open}){
  const val = React.useContext(ValCtx);
  const hay = data.ventas.length + data.dividendos.length > 0;
  const [anual,setAnual] = useState(false);
  const [vista,setVista] = useState(hay ? "gan" : "flujo");
  const pers = useMemo(()=>periodos([...data.movs].reverse(), anual),[data,anual]);
  const [sel,setSel] = useState(null);
  const [tk,setTk] = useState(null);
  const selK = pers.some(p=>p.k===sel) ? sel : pers[pers.length-1]?.k;
  const U = cur==="usd", f = U ? fUSD : fARS;
  const g = (o,a,b) => U ? o[b] : o[a];
  const ganV = g(data,"resArs","resUsd"), ganD = g(data,"divArs","divUsd"), gan = ganV + ganD;
  const costo = g(data,"costoVArs","costoVUsd");
  const sp = pers.find(p=>p.k===selK);
  const gp = p => g(p,"resArs","resUsd") + g(p,"divArs","divUsd");
  const series = vista==="gan"
    ? [{name:"Ventas", color:v=>v<0?"var(--danger)":"var(--gain)", get:p=>g(p,"resArs","resUsd")},
       {name:"Dividendos", color:"var(--div)", get:p=>g(p,"divArs","divUsd")}]
    : [{name:"Compras", color:"var(--buy)", get:p=>g(p,"compArs","compUsd")},
       {name:"Ventas", color:"var(--sell)", get:p=>g(p,"ventArs","ventUsd")}];
  const tick = data.grupos.filter(x=>x.ventas||x.divs)
    .map(x=>({...x, gv:g(x,"resArs","resUsd"), gd:g(x,"divArs","divUsd")})).map(x=>({...x, gt:x.gv+x.gd}))
    .sort((a,b)=>b.gt-a.gt);
  const maxAbs = Math.max(1e-9, ...tick.map(t=>Math.abs(t.gt)));

  return html`<div class="res">
    <section class="summary res-hero" aria-label="Ganancia realizada">
      <div class="s-top"><span class="lbl">Ganancia realizada</span>
        <div class="cur-tg" role="group" aria-label="Moneda">
          <button aria-pressed=${!U} onClick=${()=>setCur("ars")}>$</button>
          <button aria-pressed=${U} onClick=${()=>setCur("usd")}>USD</button>
        </div></div>
      ${hay
        ? html`<div class=${"big "+(gan<-EPS?"hneg":"hpos")}>${fSigned(f,gan)}</div>
          <div class="hchips">
            <span class="hchip"><i style=${{background:"#2ee6a0"}}></i>Ventas <b>${fSigned(f,ganV)}</b>${costo?html` <em>${fPct(ganV/costo*100)}</em>`:""}</span>
            <span class="hchip"><i style=${{background:"#b79cff"}}></i>Dividendos <b>${fSigned(f,ganD)}</b></span>
          </div>`
        : html`<div class="big" style=${{fontSize:"22px"}}>Todavía sin ganancias</div>
          <div class="sub">Cuando vendas o cobres un dividendo, lo vas a ver acá.</div>`}
      ${val && val.hay && html`<div class="sub" style=${{marginTop:"8px"}}>Sin realizar (si vendieras hoy): <span class=${val[U?"nrUsd":"nrArs"]<0?"hneg-t":"hpos-t"}>${fSigned(f,val[U?"nrUsd":"nrArs"])}</span></div>`}
    </section>

    <div class="chart-card">
      <div class="ctl-row tight">
        <div class="seg-mini" role="group" aria-label="Qué ver">
          <button aria-pressed=${vista==="gan"} onClick=${()=>setVista("gan")}>Ganancia</button>
          <button aria-pressed=${vista==="flujo"} onClick=${()=>setVista("flujo")}>Compras y ventas</button>
        </div>
        <div class="seg-mini" role="group" aria-label="Período">
          <button aria-pressed=${!anual} onClick=${()=>setAnual(false)}>Mes</button>
          <button aria-pressed=${anual} onClick=${()=>setAnual(true)}>Año</button>
        </div>
      </div>
      <${PerChart} pers=${pers} sel=${selK} setSel=${setSel} series=${series} stacked=${vista==="gan"} />
      <div class="chart-legend">${vista==="gan"
        ? html`<span><i style=${{background:"var(--gain)"}}></i>Ganancia ventas</span><span><i style=${{background:"var(--danger)"}}></i>Pérdida ventas</span><span><i style=${{background:"var(--div)"}}></i>Dividendos</span>`
        : html`<span><i style=${{background:"var(--buy)"}}></i>Compras</span><span><i style=${{background:"var(--sell)"}}></i>Ventas (neto)</span>`}</div>
      ${sp && html`<div class="pdet">
        <div class="pdet-h"><b>${perLabel(sp.k,true)}</b>${vista==="gan"
          ? html`<b class=${sign(gp(sp))}>${fSigned(f,gp(sp))}</b>`
          : html`<span class="date">${sp.n} ${sp.n===1?"movimiento":"movimientos"}</span>`}</div>
        ${vista==="gan"
          ? html`<div class="pdet-r"><span>Ventas${sp.nv?` (${sp.nv})`:""}</span><span class=${sign(g(sp,"resArs","resUsd"))}>${sp.nv?fSigned(f,g(sp,"resArs","resUsd"))+(g(sp,"costoArs","costoUsd")?" · "+fPct(g(sp,"resArs","resUsd")/g(sp,"costoArs","costoUsd")*100):""):"—"}</span></div>
                 <div class="pdet-r"><span>Dividendos${sp.nd?` (${sp.nd})`:""}</span><span class="divc">${sp.nd?fSigned(f,g(sp,"divArs","divUsd")):"—"}</span></div>`
          : html`<div class="pdet-r"><span>Compras</span><span>${f(g(sp,"compArs","compUsd"))}</span></div>
                 <div class="pdet-r"><span>Ventas</span><span>${f(g(sp,"ventArs","ventUsd"))}</span></div>
                 <div class="pdet-r"><span>Comisiones</span><span>${f(g(sp,"comArs","comUsd"))}</span></div>`}
      </div>`}
    </div>

    ${tick.length>0 && html`<div class="chart-card">
      <div class="card-head"><h3>Por instrumento</h3><span class="date">Tocá para ver el detalle</span></div>
      <div class="ins-list">${tick.map(t=>{ const op = tk===t.ticker;
        return html`<div key=${t.ticker} class=${"ins"+(op?" open":"")}>
          <button class="ins-row" aria-expanded=${op} onClick=${()=>setTk(op?null:t.ticker)}>
            <span class="ins-name">${t.ticker}</span>
            <span class="ins-track"><i class=${t.gt<0?"neg":"pos"} style=${{width:Math.max(3,Math.abs(t.gt)/maxAbs*100)+"%"}}></i></span>
            <span class=${"ins-val "+sign(t.gt)}>${fSigned(f,t.gt)}</span>
          </button>
          ${op && html`<div class="ins-det">
            <div class="pdet-r"><span>Ventas (${t.ventas})</span><span class=${sign(t.gv)}>${t.ventas?fSigned(f,t.gv):"—"}</span></div>
            <div class="pdet-r"><span>Dividendos (${t.divs})</span><span class="divc">${t.divs?fSigned(f,t.gd):"—"}</span></div>
            <div class="list sub">${t.movs.filter(m=>m.op!=="compra").map(m=>html`<${MovCard} key=${m.id} m=${m} onOpen=${open} />`)}</div>
          </div>`}
        </div>`; })}</div>
    </div>`}
  </div>`;
}

function MonthGroup({p,onOpen,cur}){
  const [open,setOpen] = useState(false);
  const U = cur==="usd", f = U?fUSD:fARS, g=(a,b)=>U?p[b]:p[a];
  const nv = p.nv, nd = p.nd, nc = p.n-nv-nd-p.na;
  return html`<div class=${"card mov grp"+(open?" open":"")}>
    <button class="mov-head" aria-expanded=${open} onClick=${()=>setOpen(!open)}>
      <span class="tk">${perLabel(p.k,true)}</span>
      <span class="mov-meta"><span class="num">${p.n} ${p.n===1?"mov.":"movs."}</span><span class="date">${nc} C · ${nv} V${nd?` · ${nd} D`:""}</span></span>
      <span class="chev" aria-hidden="true">${open?"▴":"▾"}</span>
    </button>
    ${open && html`
    <div class="month-sum">
      <${KV} k="Compras" v=${f(g("compArs","compUsd"))} cls=${U?"usd":"ars"} />
      <${KV} k="Ventas (neto)" v=${f(g("ventArs","ventUsd"))} cls=${U?"usd":"ars"} />
      <${KV} k="Comisiones" v=${f(g("comArs","comUsd"))} />
      <${KV} k="Resultado ventas" v=${nv? fSigned(f,g("resArs","resUsd")) : "—"} cls=${sign(g("resArs","resUsd"))} />
      ${nd>0 && html`<${KV} k="Dividendos" v=${fSigned(f,g("divArs","divUsd"))} cls="divc" />`}
    </div>
    <div class="grp-label">Movimientos del mes</div>
    <div class="list sub">${[...p.movs].reverse().map(m=>html`<${MovCard} key=${m.id} m=${m} onOpen=${onOpen} />`)}</div>`}
  </div>`;
}

function MonthBrowser({movs,onOpen,cur}){
  const pers = useMemo(()=>periodos([...movs].reverse(),false),[movs]);
  const keys = pers.map(p=>p.k);
  const [k,setK] = useState(null);
  const [filtro,setFiltro] = useState("todo");
  const key = keys.includes(k) ? k : keys[keys.length-1];
  const i = keys.indexOf(key), p = pers[i];
  if (!p) return null;
  const U = cur==="usd", f = U?fUSD:fARS, g=(a,b)=>U?p[b]:p[a];
  const nc = p.n-p.nv-p.nd-p.na;
  const lista = [...p.movs].reverse().filter(m=> filtro==="todo" || m.op===filtro);
  const res = g("resArs","resUsd") + g("divArs","divUsd");
  const F = [["todo","Todo",p.n],["compra","Compras",nc],["venta","Ventas",p.nv],["dividendo","Dividendos",p.nd]];
  const nombre = {compra:"compras",venta:"ventas",dividendo:"dividendos"}[filtro];
  return html`<div class="mb">
    <div class="mnav">
      <button class="marrow" aria-label="Mes anterior" disabled=${i<=0} onClick=${()=>setK(keys[i-1])}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <label class="mlabel">
        <span>${perLabel(key,true)}</span><span class="mcaret" aria-hidden="true">▾</span>
        <select id="mes-sel" aria-label="Elegir mes" value=${key} onChange=${e=>setK(e.target.value)}>
          ${[...keys].reverse().map(x=>html`<option key=${x} value=${x}>${perLabel(x,true)}</option>`)}
        </select>
      </label>
      <button class="marrow" aria-label="Mes siguiente" disabled=${i>=keys.length-1} onClick=${()=>setK(keys[i+1])}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    <div class="mpos">${i+1} de ${keys.length} ${keys.length===1?"mes":"meses"} con movimientos</div>

    <div class="msum">
      <div class="mtile"><span><i style=${{background:"var(--buy)"}}></i>Compras</span><b>${nc?f(g("compArs","compUsd")):"—"}</b></div>
      <div class="mtile"><span><i style=${{background:"var(--sell)"}}></i>Ventas</span><b>${p.nv?f(g("ventArs","ventUsd")):"—"}</b></div>
      <div class="mtile"><span><i style=${{background:"var(--div)"}}></i>Dividendos</span><b>${p.nd?f(g("divArs","divUsd")):"—"}</b></div>
      <div class="mtile"><span><i style=${{background:res<0?"var(--danger)":"var(--gain)"}}></i>Ganancia</span><b class=${p.nv||p.nd?sign(res):""}>${p.nv||p.nd?fSigned(f,res):"—"}</b></div>
    </div>

    <div class="fchips" role="group" aria-label="Filtrar">
      ${F.map(([v,l,n])=>html`<button key=${v} aria-pressed=${filtro===v} disabled=${!n && v!=="todo"} onClick=${()=>setFiltro(v)}>${l}<span>${n}</span></button>`)}
    </div>

    ${lista.length
      ? html`<div class="list">${lista.map(m=>html`<${MovCard} key=${m.id} m=${m} onOpen=${onOpen} />`)}</div>`
      : html`<div class="empty"><strong>Sin ${nombre} en ${perLabel(key,true).split(" ")[0].toLowerCase()}</strong>Probá con otro filtro o pasá a otro mes.</div>`}
  </div>`;
}

function App(){
  const { rows, mode, api, precios, config } = useStore();
  const [precioSheet,setPrecioSheet] = useState(false);
  const [tab,setTab] = useState("movs");
  const [sheet,setSheet] = useState(null); // {op, initial}
  const [excel,setExcel] = useState(false);
  const [movView,setMovView] = useState("ticker");
  const [cur,setCur] = useState(()=>{ try{ return localStorage.getItem("krea-cur")||"usd"; }catch(e){ return "usd"; } });
  const setCurPref = c => { setCur(c); try{ localStorage.setItem("krea-cur",c); }catch(e){} };
  const data = useMemo(()=> compute(rows||[]), [rows]);
  const totArs = data.pos.reduce((s,p)=>s+p.ars,0), totUsd = data.pos.reduce((s,p)=>s+p.usd,0);
  const val = useMemo(()=> valuar(data.pos, precios), [data, precios]);
  const lastMov = data.movs.find(m=>m.mep>0);
  const defaultMep = precios?.mep>0 && (!lastMov || (precios.fecha||"") >= lastMov.fecha) ? precios.mep : lastMov?.mep;
  const posVal = val.hay ? data.pos.map(x=>{ const v=val.por[x.ticker]; return v ? {...x, ars:v.valorArs, usd:v.valorUsd} : x; }) : data.pos;
  const U = cur==="usd", fC = U?fUSD:fARS;
  const nr = U?val.nrUsd:val.nrArs, inv = U?val.invUsd:val.invArs;
  const open = m => setSheet({op:m.op, initial:m});

  const body = rows===null ? html`<div class="empty"><strong>Cargando…</strong></div>`
    : rows.length===0 ? html`<div class="empty"><strong>Todavía no cargaste operaciones</strong>Tocá “+ Compra” y anotá fecha, ticker, cantidad, valor en pesos, comisión y el MEP del día. El resto se calcula solo.</div>`
    : tab==="movs" ? html`<div class="ctl-row"><div class="seg-mini" role="group" aria-label="Agrupar">
          <button aria-pressed=${movView==="ticker"} onClick=${()=>setMovView("ticker")}>Por ticker</button>
          <button aria-pressed=${movView==="mes"} onClick=${()=>setMovView("mes")}>Por mes</button></div></div>
        ${movView==="ticker"
          ? html`<div class="list">${data.grupos.map(g=>html`<${TickerGroup} key=${g.ticker} g=${g} onOpen=${open} />`)}</div>`
          : html`<${MonthBrowser} movs=${data.movs} onOpen=${open} cur=${cur} />`}`
    : tab==="cartera" ? (data.pos.length
        ? html`<div class="upd-row"><span class="date">${val.hay ? `Precios del ${fDate(val.fecha)}${val.faltan?` · faltan ${val.faltan}`:""}` : "Sin precios cargados"}</span>
            <button class="upd-btn" onClick=${()=>setPrecioSheet(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4"/></svg>Actualizar precios</button></div>
          <${Pie} pos=${posVal} grupos=${data.grupos} onOpen=${open} valuado=${val.hay ? val.fecha : null} />`
        : html`<div class="empty"><strong>No tenés tenencias abiertas</strong>Vendiste todo lo que compraste. Mirá tus resultados en la pestaña Resultados.</div>`)
    : html`<${Resultados} data=${data} cur=${cur} setCur=${setCurPref} open=${open} />`;

  const acts = useMemo(()=>({openSplit: t=>setSheet({op:"ajuste", ticker:t})}),[]);
  return html`<${ValCtx.Provider} value=${val}><${ActCtx.Provider} value=${acts}>
    <div class="top"><div class="brand"><img class="logo" src=${LOGO} alt="Krea" width="72" height="72" /><div><h1 class="sr">Krea</h1><small style=${{fontStyle:"italic"}}>“Domina tus hábitos. Krea tu destino”</small></div></div>
      <button class="xbtn" disabled=${!api} onClick=${()=>setExcel(true)}>Excel</button></div>
    <section class="summary" aria-label="Resumen">
      <div class="s-top"><span class="lbl">${val.hay ? "Valor hoy" : "Total invertido"}</span>
        <div class="cur-tg" role="group" aria-label="Moneda">
          <button aria-pressed=${!U} onClick=${()=>setCurPref("ars")}>$</button>
          <button aria-pressed=${U} onClick=${()=>setCurPref("usd")}>USD</button>
        </div></div>
      <div class="big"><span class="cur">${U?"US$":"$"}</span>${fmt2(val.hay ? (U?val.valUsd:val.valArs) : (U?totUsd:totArs))}</div>
      ${val.hay
        ? html`<div class="sub">Invertido ${fC(inv)} · <span class=${nr<0?"hneg-t":"hpos-t"}>${fSigned(fC,nr)} (${fPct(inv?nr/inv*100:NaN)})</span></div>`
        : html`<div class="sub">${data.pos.length} ${data.pos.length===1?"posición":"posiciones"}${totUsd?" · MEP prom. "+fARS(totArs/totUsd):""}</div>`}
      ${data.pos.length>0 && html`<div class="s-foot">
        <span>${val.hay ? `Precios del ${fDate(val.fecha)} · MEP ${fmt2(val.mep)}${val.faltan?` · faltan ${val.faltan}`:""}` : "Cargá precios para ver cuánto vale hoy"}</span>
        <button class="upd" onClick=${()=>setPrecioSheet(true)}>${val.hay?"Actualizar":"Cargar precios"}</button></div>`}
    </section>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected=${tab==="movs"} onClick=${()=>setTab("movs")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v15M3.5 15.5 7 19l3.5-3.5M17 20V5M13.5 8.5 17 5l3.5 3.5"/></svg>Movimientos</button>
      <button role="tab" aria-selected=${tab==="cartera"} onClick=${()=>setTab("cartera")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 2.6A9 9 0 0 1 21.4 9H15z"/></svg>Cartera</button>
      <button role="tab" aria-selected=${tab==="res"} onClick=${()=>setTab("res")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5.5-5.5 4 4L21 7"/><path d="M15 7h6v6"/></svg>Resultados</button>
    </div>
    ${body}
    ${mode==="local" && html`<p class="note">Tus datos se guardan solo en este dispositivo. Exportá a Excel cada tanto como respaldo.</p>`}
    <div class="bar"><div class="inner">
      <button class="buy" onClick=${()=>setSheet({op:"compra"})}><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>Compra</button>
      <button class="sell" disabled=${!data.pos.length} onClick=${()=>setSheet({op:"venta"})}><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></span>Venta</button>
      <button class="divb" disabled=${!data.grupos.length} onClick=${()=>setSheet({op:"dividendo"})}><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5"/></svg></span>Dividendo</button>
    </div></div>
    ${precioSheet && api && html`<${PriceSheet} pos=${data.pos} precios=${precios} defaultMep=${defaultMep} onClose=${()=>setPrecioSheet(false)} onSave=${b=>api.setDoc("precios",b)} />`}
    ${sheet && api && sheet.op==="ajuste" && html`<${SplitSheet} initial=${sheet.initial||null} ticker=${sheet.ticker} rows=${rows||[]} grupos=${data.grupos}
        onClose=${()=>setSheet(null)} onSave=${api.save} onDelete=${api.remove} />`}
    ${sheet && api && sheet.op==="dividendo" && html`<${DivSheet} defaultMep=${defaultMep} initial=${sheet.initial||null} grupos=${data.grupos}
        onClose=${()=>setSheet(null)} onSave=${api.save} onDelete=${api.remove} />`}
    ${sheet && api && (sheet.op==="compra"||sheet.op==="venta") && html`<${Sheet} defaultMep=${defaultMep} config=${config} onSaveConfig=${b=>api.setDoc("config",b)} op=${sheet.op} initial=${sheet.initial||null} rows=${rows||[]} holdings=${data.holdings}
        onClose=${()=>setSheet(null)} onSave=${api.save} onDelete=${api.remove} />`}
    ${excel && api && html`<${ExcelSheet} rows=${rows||[]} api=${api} onClose=${()=>setExcel(false)} />`}
  <//><//>`;
}

ReactDOM.createRoot(document.getElementById("app")).render(html`<${App} />`);
