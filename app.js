(() => {
'use strict';
const { HeapSortExchangeEngine, parent: parentOf, leftChild, rightChild } = window.HeapMatch;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const TICKERS = ['NVDA', 'AAPL', 'MSFT', 'TSLA'];
const BASE = { NVDA: 184.5, AAPL: 232.1, MSFT: 428.4, TSLA: 351.2 };
const MAKERS = ['Atlas Quant', 'Borealis Cap', 'Cinder Labs', 'Delta Hollow', 'Ember Trading', 'Fathom MM'];
const TICK = 10000;
const toTicks = (d) => Math.round(d * 100) * 100;
const usd = (t) => '$' + (t / TICK).toFixed(2);
const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const clock = (d) => d.toTimeString().slice(0, 5);

let seq = 1;       // logical timestamp used for FIFO tie-breaking
let orderNo = 9000;

/* ---------- state ---------- */
const S = {
  ticker: 'NVDA', view: 'overview', chartMode: 'both', barMode: 'slots', archSide: 'bids',
  eng: {}, mid: {}, hist: {}, passes: {}, matched: {}, expanded: new Set(), ops: [],
  sound: false, auto: true, countdown: 6, hover: null, sel: null,
};
const BATCH_SECONDS = 6;
TICKERS.forEach((t) => {
  S.eng[t] = new HeapSortExchangeEngine(t);
  S.mid[t] = BASE[t];
  S.hist[t] = [];
  S.passes[t] = { bid: new Array(7).fill(0), ask: new Array(7).fill(0) };
  S.matched[t] = { total: 0, last: 0, prev: 0 };
});

/* ---------- audio (Web Audio, no assets) ---------- */
let actx = null;
function tone(type, f0, f1, dur, vol, when = 0) {
  if (!S.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + when;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.01);
  } catch (e) { /* audio unavailable */ }
}
const click = () => tone('triangle', 1650, 520, 0.018, 0.05);
const chime = () => { tone('sine', 660, 660, 0.12, 0.05); tone('sine', 990, 990, 0.16, 0.05, 0.09); };

/* ---------- segmented pills ---------- */
function initSeg(el, cb) {
  const pill = $('.seg-pill', el);
  const place = (animate = true) => {
    const btn = $('button.active', el);
    if (!btn || !btn.offsetWidth) return;
    if (!animate) el.classList.add('no-anim');
    pill.style.width = btn.offsetWidth + 'px';
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (el.id === 'sideSeg') { pill.classList.toggle('is-buy', btn.dataset.v === 'BUY'); pill.classList.toggle('is-sell', btn.dataset.v === 'SELL'); }
    if (!animate) { void pill.offsetWidth; el.classList.remove('no-anim'); }
  };
  el._place = place;
  $$('button', el).forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('active')) return;
    $$('button', el).forEach((x) => x.classList.toggle('active', x === b));
    place(); click(); cb && cb(b.dataset.v);
  }));
  place(false);
}
const setSeg = (el, v) => { $$('button', el).forEach((b) => b.classList.toggle('active', b.dataset.v === v)); el._place(); };
const placeAll = () => $$('.seg').forEach((s) => s._place && s._place(false));

/* ---------- market simulation ---------- */
function genOrder(t, side) {
  const m = S.mid[t], z = Math.abs(gauss());
  const agg = Math.random() < 0.18;
  let p;
  if (side === 'BUY') p = agg ? m * (1 + z * 0.0012) : m * (1 - 0.0004 - z * 0.0016);
  else p = agg ? m * (1 - z * 0.0012) : m * (1 + 0.0004 + z * 0.0016);
  return { orderId: 'ORD-' + (++orderNo), traderId: pick(MAKERS), ticker: t, side, price: toTicks(p), quantity: 10 + Math.floor(Math.random() * 29) * 10, timestamp: seq++ };
}

function submit(t, order) {
  const e = S.eng[t];
  e.submitOrder(order);
  const arr = order.side === 'BUY' ? e.bids : e.asks;
  if (arr.length > 60) { e.heapSortOrders(arr); arr.pop(); } // drop lowest-priority tail
  else e.heapSortOrders(arr);
}

function sample(t) {
  const e = S.eng[t], h = S.hist[t], last = h[h.length - 1];
  const bid = e.bids[0] ? e.bids[0].price : (last ? last.bid : toTicks(S.mid[t] * 0.999));
  const ask = e.asks[0] ? e.asks[0].price : (last ? last.ask : toTicks(S.mid[t] * 1.001));
  h.push({ at: new Date(), bid, ask });
  if (h.length > 60) h.shift();
}

function simTick(t) {
  S.mid[t] *= 1 + gauss() * 0.0004;
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) { submit(t, genOrder(t, 'BUY')); submit(t, genOrder(t, 'SELL')); }
  sample(t);
}

function passHook(buckets, n) {
  return (ev) => {
    if (ev.t === 'compare' && ev.phase === 'extract') buckets[Math.min(6, Math.floor((1 - ev.size / n) * 7))]++;
  };
}

function clearBatch(t, silent) {
  const e = S.eng[t];
  const pb = new Array(7).fill(0), pa = new Array(7).fill(0);
  const r = e.clearBatchAuction({ bid: passHook(pb, Math.max(e.bids.length, 2)), ask: passHook(pa, Math.max(e.asks.length, 2)) });
  S.passes[t] = { bid: pb, ask: pa };
  const m = S.matched[t];
  m.prev = m.last;
  m.last = r.trades.reduce((s, x) => s + x.quantity * x.executionPrice / TICK, 0);
  m.total += m.last;
  if (!silent) {
    log('sort', 'ask', `In-place Heap Sort`, `${e.ticker} bids ${r.bidMetrics.swaps} swaps · asks ${r.askMetrics.swaps} swaps · aux 0 B`);
    r.trades.slice(0, 4).forEach((x) => log('trade', 'bid', `Matched ${x.quantity} ${x.ticker}`, `@ ${usd(x.executionPrice)} · ${x.buyOrderId}/${x.sellOrderId}`));
    if (r.trades.length > 4) log('trade', 'bid', `+${r.trades.length - 4} more fills`, `${t} batch cleared`);
    if (r.trades.length) chime();
  }
  sample(t);
  return r;
}

function log(kind, ring, text, sub) {
  S.ops.unshift({ kind, ring, text, sub, at: Date.now() });
  if (S.ops.length > 40) S.ops.pop();
}

// warm-up history so charts have shape at boot
TICKERS.forEach((t) => {
  for (let i = 0; i < 6; i++) { submit(t, genOrder(t, 'BUY')); submit(t, genOrder(t, 'SELL')); }
  for (let i = 0; i < 44; i++) { simTick(t); if (i % 5 === 4) clearBatch(t, true); }
  const ago = 1500;
  S.hist[t].forEach((p, i, a) => { p.at = new Date(Date.now() - (a.length - 1 - i) * ago * 8); });
});
log('sort', 'ask', 'Engine online', 'heapSortOrders() · O(1) aux space');

/* ---------- views: navigation ---------- */
function setView(v) {
  S.view = v;
  $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  placeAll();
  if (v === 'debug') buildDebug(false);
  renderAll();
}
$$('.rail-btn').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view !== S.view) { click(); setView(b.dataset.view); } }));

/* ---------- header ---------- */
function renderHeader() {
  const e = S.eng[S.ticker];
  $('#nodeCount').textContent = e.bids.length + e.asks.length;
  $('#batchClock').textContent = '00:' + String(S.countdown).padStart(2, '0');
}

/* ---------- overview: chart ---------- */
const CW = 800, CH = 260, PL = 52, PR = 16, PT = 18, PB = 28;
function spline(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const f = (n) => n.toFixed(1);
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
let chartGeom = null;
function renderChart() {
  const h = S.hist[S.ticker].slice(-48);
  const svg = $('#chart');
  svg.innerHTML = '';
  if (h.length < 2) return;
  const all = h.flatMap((p) => [p.bid, p.ask]);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.15, 200); lo -= pad; hi += pad;
  const X = (i) => PL + (i / (h.length - 1)) * (CW - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (CH - PT - PB);
  chartGeom = { h, X, Y, n: h.length };

  const defs = svgEl('defs');
  defs.innerHTML = '<linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C4B5FD" stop-opacity=".28"/><stop offset="1" stop-color="#C4B5FD" stop-opacity="0"/></linearGradient>';
  svg.appendChild(defs);

  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4, y = Y(v);
    svg.appendChild(svgEl('line', { x1: PL, x2: CW - PR, y1: y, y2: y, class: 'grid' }));
    const t = svgEl('text', { x: PL - 8, y: y + 3, 'text-anchor': 'end' }); t.textContent = (v / TICK).toFixed(2); svg.appendChild(t);
  }
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const i = Math.round(f * (h.length - 1));
    const t = svgEl('text', { x: X(i), y: CH - 8, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' });
    t.textContent = clock(h[i].at); svg.appendChild(t);
  });

  const bp = h.map((p, i) => [X(i), Y(p.bid)]), ap = h.map((p, i) => [X(i), Y(p.ask)]);
  const showB = S.chartMode !== 'ask', showA = S.chartMode !== 'bid';
  if (showB) {
    const d = spline(bp);
    svg.appendChild(svgEl('path', { d: `${d} L${X(h.length - 1)},${CH - PB} L${X(0)},${CH - PB}Z`, fill: 'url(#gb)' }));
    svg.appendChild(svgEl('path', { d, class: 'line', stroke: '#C4B5FD' }));
  }
  if (showA) svg.appendChild(svgEl('path', { d: spline(ap), class: 'line', stroke: '#D9F99D' }));

  // price badge pinned at the visible series' highest point
  const series = showA ? ap : bp, vals = showA ? h.map((p) => p.ask) : h.map((p) => p.bid);
  let mi = 0; vals.forEach((v, i) => { if (v > vals[mi]) mi = i; });
  const [bx, by] = series[mi];
  const label = usd(vals[mi]), bw = label.length * 7 + 16;
  const bxx = Math.min(Math.max(bx - bw / 2, PL), CW - PR - bw);
  const g = svgEl('g');
  g.appendChild(svgEl('circle', { cx: bx, cy: by, r: 4, fill: '#131316', stroke: showA ? '#D9F99D' : '#C4B5FD', 'stroke-width': 2 }));
  g.appendChild(svgEl('rect', { x: bxx, y: by - 30, width: bw, height: 20, rx: 10, fill: '#D9F99D' }));
  const bt = svgEl('text', { x: bxx + bw / 2, y: by - 16, 'text-anchor': 'middle', style: 'fill:#131316;font-weight:600' }); bt.textContent = label; g.appendChild(bt);
  svg.appendChild(g);

  // hover layer
  const hv = svgEl('g', { id: 'hoverG' });
  hv.appendChild(svgEl('line', { id: 'hLine', y1: PT, y2: CH - PB, stroke: '#8E8E9A', 'stroke-dasharray': '3 4', opacity: 0 }));
  hv.appendChild(svgEl('circle', { id: 'hB', r: 4, fill: '#C4B5FD', opacity: 0 }));
  hv.appendChild(svgEl('circle', { id: 'hA', r: 4, fill: '#D9F99D', opacity: 0 }));
  svg.appendChild(hv);
  applyHover();
}
function applyHover() {
  const co = $('#callout');
  if (S.hover == null || !chartGeom) { co.hidden = true; ['hLine', 'hB', 'hA'].forEach((id) => { const e = $('#' + id); if (e) e.setAttribute('opacity', 0); }); return; }
  const { h, X, Y, n } = chartGeom, i = Math.min(S.hover, n - 1), p = h[i], x = X(i);
  const ln = $('#hLine'); ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('opacity', 1);
  const hb = $('#hB'), ha = $('#hA');
  hb.setAttribute('cx', x); hb.setAttribute('cy', Y(p.bid)); hb.setAttribute('opacity', S.chartMode === 'ask' ? 0 : 1);
  ha.setAttribute('cx', x); ha.setAttribute('cy', Y(p.ask)); ha.setAttribute('opacity', S.chartMode === 'bid' ? 0 : 1);
  const svg = $('#chart'), k = svg.clientWidth / CW;
  co.hidden = false;
  co.style.left = Math.min(Math.max(x * k, 70), svg.clientWidth - 70) + 'px';
  co.style.top = Math.min(Y(p.bid), Y(p.ask)) * k + 'px';
  co.innerHTML = `<div class="cr mono"><span>${clock(p.at)}</span></div><div class="cr mono sp"><span>Spread</span><b>${((p.ask - p.bid) / TICK).toFixed(2)}</b></div><div class="cr mono"><span>Bid</span><b>${usd(p.bid)}</b></div><div class="cr mono"><span>Ask</span><b>${usd(p.ask)}</b></div>`;
}
$('#chart').addEventListener('mousemove', (ev) => {
  if (!chartGeom) return;
  const r = $('#chart').getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * CW;
  S.hover = Math.max(0, Math.min(chartGeom.n - 1, Math.round(((x - PL) / (CW - PL - PR)) * (chartGeom.n - 1))));
  applyHover();
});
$('#chart').addEventListener('mouseleave', () => { S.hover = null; applyHover(); });

/* ---------- overview: gauge, KPIs, bars, book ---------- */
const sumQty = (a) => a.reduce((s, o) => s + o.quantity, 0);
const sumNot = (a) => a.reduce((s, o) => s + (o.quantity * o.price) / TICK, 0);
const kpiMemo = {};
function setDelta(el, v) {
  el.textContent = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  el.className = 'delta ' + (v >= 0 ? 'pos' : 'neg');
}
function renderKpis() {
  const e = S.eng[S.ticker], t = S.ticker;
  const bq = sumQty(e.bids), aq = sumQty(e.asks), tot = bq + aq || 1;
  const C = 2 * Math.PI * 74, gap = 6, bl = Math.max(0, (bq / tot) * C - gap), al = Math.max(0, (aq / tot) * C - gap);
  $('#gBid').style.strokeDasharray = `${bl} ${C - bl}`;
  $('#gBid').style.strokeDashoffset = 0;
  $('#gAsk').style.strokeDasharray = `${al} ${C - al}`;
  $('#gAsk').style.strokeDashoffset = -(bq / tot) * C;

  const notional = sumNot(e.bids) + sumNot(e.asks);
  const m = (kpiMemo[t] = kpiMemo[t] || { ref: notional });
  $('#kpi1').textContent = fmt(notional, 2);
  setDelta($('#kpi1d'), ((notional - m.ref) / m.ref) * 100);
  const mm = S.matched[t];
  $('#kpi2').textContent = fmt(mm.total, 2);
  setDelta($('#kpi2d'), mm.prev ? ((mm.last - mm.prev) / mm.prev) * 100 : 0);
}
let capsKey = '';
function renderBars() {
  const e = S.eng[S.ticker], mode = S.barMode, wrap = $('#caps');
  let cols = [];
  const mx = (arr) => Math.max(1, ...arr);
  if (mode === 'slots') {
    $('#barsTitle').textContent = 'Array Slots';
    const order = [['B', 0], ['A', 0], ['B', 1], ['A', 1], ['B', 2], ['A', 2], ['B', 3]];
    const vals = order.map(([s, i]) => (s === 'B' ? e.bids[i] : e.asks[i]));
    const m = mx(vals.map((o) => (o ? o.quantity : 0)));
    cols = order.map(([s, i], k) => ({ label: `${s}[${i}]`, bars: [{ c: s === 'B' ? 'b' : 'a', h: vals[k] ? vals[k].quantity / m : 0 }] }));
  } else if (mode === 'levels') {
    $('#barsTitle').textContent = 'Tree Depth Levels';
    const lv = (arr, k) => { let s = 0; for (let i = (1 << k) - 1; i < (1 << (k + 1)) - 1 && i < arr.length; i++) s += arr[i].quantity; return s; };
    const L = [0, 1, 2, 3].map((k) => [lv(e.bids, k), lv(e.asks, k)]);
    const m = mx(L.flat());
    cols = L.map(([b, a], k) => ({ label: 'L' + k, bars: [{ c: 'b', h: b / m }, { c: 'a', h: a / m }] }));
  } else {
    $('#barsTitle').textContent = 'Heap Sort Pass Workload';
    const P = S.passes[S.ticker], m = mx([...P.bid, ...P.ask]);
    cols = P.bid.map((b, k) => ({ label: 'P' + (k + 1), bars: [{ c: 'b', h: b / m }, { c: 'a', h: P.ask[k] / m }] }));
  }
  const key = mode + cols.length;
  if (key !== capsKey) {
    capsKey = key;
    wrap.innerHTML = cols.map((c) => `<div class="cap-col"><div class="cap">${c.bars.map((b) => `<div class="bar ${b.c}"></div>`).join('')}</div><span class="cap-lbl">${c.label}</span></div>`).join('');
    void wrap.offsetHeight;
  }
  $$('.cap-col', wrap).forEach((col, k) => {
    $$('.bar', col).forEach((bar, j) => { bar.style.height = Math.max(4, cols[k].bars[j].h * 100) + '%'; });
    $('.cap-lbl', col).textContent = cols[k].label;
  });
}
function bookRow(o, i, side) {
  const open = S.expanded.has(o.orderId);
  const arr = side === 'bid' ? S.eng[S.ticker].bids : S.eng[S.ticker].asks;
  let html = `<button class="row${open ? ' open' : ''}" data-id="${o.orderId}"><span class="pill ${side}">${side === 'bid' ? 'Bid' : 'Ask'}</span><span class="mono">${o.orderId}</span><span class="mono muted hi">Heap Index [${i}]</span><span class="mono num">${o.quantity} sh</span><span class="mono num">${usd(o.price)}</span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>`;
  if (open) {
    const p = parentOf(i), l = leftChild(i), r = rightChild(i);
    const ref = (j) => (arr[j] ? `[${j}] ${usd(arr[j].price)}` : '—');
    html += `<div class="drawer-row"><span>Parent(i) = <b>${i === 0 ? 'none (root)' : ref(p)}</b></span><span>Left 2i+1 = <b>${ref(l)}</b></span><span>Right 2i+2 = <b>${ref(r)}</b></span><span>${o.traderId}</span></div>`;
  }
  return html;
}
function renderBook() {
  const e = S.eng[S.ticker];
  let h = '';
  const asks = e.asks.slice(0, 5), bids = e.bids.slice(0, 5);
  h += '<div class="row-divider">Asks — min-heap, lowest price first</div>';
  h += asks.length ? asks.map((o, i) => bookRow(o, i, 'ask')).join('') : '<div class="empty">No asks</div>';
  h += '<div class="row-divider">Bids — max-heap, highest price first</div>';
  h += bids.length ? bids.map((o, i) => bookRow(o, i, 'bid')).join('') : '<div class="empty">No bids</div>';
  $('#book').innerHTML = h;
  const sp = e.bids[0] && e.asks[0] ? (e.asks[0].price - e.bids[0].price) / TICK : null;
  $('#bookMeta').textContent = `bids[${e.bids.length}] asks[${e.asks.length}]${sp != null ? ' · spread ' + sp.toFixed(2) : ''}`;
}
$('#book').addEventListener('click', (ev) => {
  const r = ev.target.closest('.row'); if (!r) return;
  const id = r.dataset.id; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
  click(); renderBook();
});

function renderOverview() { renderChart(); renderKpis(); renderBars(); renderBook(); }

/* ---------- array strip + tree (shared) ---------- */
function strip(el, arr, max, cls) {
  const n = Math.min(arr.length, max);
  el.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'cell ' + (cls ? cls(i) : '');
    c.dataset.i = i;
    c.innerHTML = `<span class="ix">[${i}]</span><span class="pv">${(arr[i].price / TICK).toFixed(2)}</span>`;
    el.appendChild(c);
  }
  if (!n) el.innerHTML = '<div class="empty">Empty array</div>';
}
function tree(svg, arr, max, cls) {
  const n = Math.min(arr.length, max), W = 720, levels = Math.max(1, Math.ceil(Math.log2(n + 1)));
  svg.innerHTML = '';
  const pos = (i) => { const k = Math.floor(Math.log2(i + 1)), idx = i - ((1 << k) - 1); return [((idx + 0.5) / (1 << k)) * W, 30 + k * 70]; };
  for (let i = 1; i < n; i++) { const [x1, y1] = pos(parentOf(i)), [x2, y2] = pos(i); svg.appendChild(svgEl('line', { x1, y1, x2, y2, class: 'edge' })); }
  for (let i = 0; i < n; i++) {
    const [x, y] = pos(i), g = svgEl('g', { class: 'nd ' + (cls ? cls(i) : ''), 'data-i': i });
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: 17 }));
    const t = svgEl('text', { x, y: y + 4 }); t.textContent = i; g.appendChild(t);
    const p = svgEl('text', { x, y: y + 32, class: 'pr' }); p.textContent = (arr[i].price / TICK).toFixed(2); g.appendChild(p);
    svg.appendChild(g);
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${30 + (levels - 1) * 70 + 44}`);
}

/* ---------- view: array & tree ---------- */
function relatedClass(sel) {
  return (i) => (sel == null ? '' : i === sel ? 'sel' : (i === parentOf(sel) && sel > 0) || i === leftChild(sel) || i === rightChild(sel) ? 'rel' : 'dim');
}
function renderArray() {
  const e = S.eng[S.ticker], arr = S.archSide === 'bids' ? e.bids : e.asks, cls = relatedClass(S.sel);
  strip($('#arrStrip'), arr, 15, cls);
  tree($('#treeSvg'), arr, 15, cls);
  const i = S.sel;
  $('#idxInfo').innerHTML = i == null ? 'Hover a slot.' : `<b>[${i}]</b> ${arr[i] ? usd(arr[i].price) + ' · ' + arr[i].quantity + ' sh · ' + arr[i].orderId : ''} &nbsp; Parent = ${i === 0 ? 'none' : '[' + parentOf(i) + ']'} &nbsp; Children = [${leftChild(i)}], [${rightChild(i)}]`;
  let ok = true;
  for (let k = 1; k < arr.length; k++) if (e.hasHigherPriority(arr[k], arr[parentOf(k)])) { ok = false; break; }
  $('#heapProof').textContent = `Heap invariant check over ${arr.length} slots: ${ok ? 'PASS — no child outranks its parent. A priority-sorted array is itself a valid max-priority heap.' : 'FAIL'}${arr.length > 15 ? ' (showing the first 15 slots)' : ''}`;
}
function hoverSel(ev) {
  const t = ev.target.closest('[data-i]');
  const v = t ? +t.dataset.i : null;
  if (v === S.sel) return;
  S.sel = v; renderArray();
}
['#arrStrip', '#treeSvg'].forEach((s) => { $(s).addEventListener('mouseover', hoverSel); $(s).addEventListener('mouseleave', () => { S.sel = null; renderArray(); }); $(s).addEventListener('click', hoverSel); });

/* ---------- view: debugger ---------- */
const D = { steps: [], pos: 0, side: 'bids', playing: null, seed: 1 };
function seeded() { let s = (D.seed = (D.seed * 1664525 + 1013904223) >>> 0); return s / 4294967296; }
function buildDebug(reshuffle) {
  if (reshuffle) D.seed = (Math.random() * 1e9) | 0 || 1;
  stopPlay();
  const e = S.eng[S.ticker], src = (D.side === 'bids' ? e.bids : e.asks).slice(0, 11).map((o) => ({ ...o }));
  let sd = D.seed;
  const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  for (let i = src.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [src[i], src[j]] = [src[j], src[i]]; }
  const steps = [{ arr: src.slice(), phase: 'init', sortedFrom: src.length, hi: [], sw: [], msg: 'Unsorted copy of the live book. Press play or step with the arrow keys.', cmp: 0, swp: 0 }];
  let cmp = 0, swp = 0;
  const priceStr = (o) => (o.price / TICK).toFixed(2);
  const hook = (ev, a) => {
    let msg, hi = [], sw = [], phase = ev.phase || ev.t;
    if (ev.t === 'compare') { cmp++; hi = [ev.i, ev.j]; msg = `compare [${ev.i}]=${priceStr(a[ev.i])} with child [${ev.j}]=${priceStr(a[ev.j])} — does the current candidate outrank the child?`; }
    else if (ev.t === 'swap') { swp++; sw = [ev.i, ev.j]; msg = `siftDown swap [${ev.i}] ↔ [${ev.j}] — lower-priority order sinks toward the leaves.`; }
    else if (ev.t === 'extract') { swp++; sw = [0, ev.j]; msg = `extract root: swap [0] ↔ [${ev.j}], lock the order at [${ev.j}] into the sorted suffix.`; phase = 'extract'; }
    else if (ev.t === 'built') { msg = 'buildHeap complete — lowest priority order is at the root.'; phase = 'build'; }
    else { msg = 'Sorted. Index 0 is the highest-priority order.'; phase = 'done'; }
    const sizeNow = ev.t === 'done' ? 0 : ev.t === 'built' ? a.length : ev.size;
    steps.push({ arr: a.slice(), phase, sortedFrom: ev.t === 'done' ? 0 : phase === 'extract' ? sizeNow : a.length, hi, sw, msg, cmp, swp, size: sizeNow });
  };
  e.heapSortOrders(src, hook);
  D.steps = steps; D.pos = 0;
  const sc = $('#dbgScrub'); sc.max = steps.length - 1; sc.value = 0;
  renderDebug();
}
function renderDebug() {
  const st = D.steps[D.pos]; if (!st) return;
  const cls = (i) => {
    if (st.sw.includes(i)) return 'lime';
    if (i >= st.sortedFrom) return 'sorted';
    if (st.hi.includes(i)) return 'lav';
    return '';
  };
  strip($('#dbgStrip'), st.arr, 15, cls);
  tree($('#dbgTree'), st.arr, 15, cls);
  const labels = { init: 'Initial', build: 'Phase 1 · buildHeap (bottom-up, O(n))', extract: 'Phase 2 · root extraction (O(n log n))', done: 'Complete' };
  $('#dbgPhase').textContent = labels[st.phase] || st.phase;
  $('#dbgMsg').textContent = st.msg;
  $('#dbgPos').textContent = `${D.pos} / ${D.steps.length - 1}`;
  $('#dbgScrub').value = D.pos;
  $('#dbgStats').innerHTML = `<span>comparisons <b>${st.cmp}</b></span><span>swaps <b>${st.swp}</b></span><span>heap size <b>${st.sortedFrom}</b></span><span>aux memory <b>0 B</b></span>`;
}
function dbgGo(p) { D.pos = Math.max(0, Math.min(D.steps.length - 1, p)); renderDebug(); }
function stopPlay() { if (D.playing) { clearInterval(D.playing); D.playing = null; } $('#dbgPlay').textContent = 'Play'; }
$('#dbgPlay').addEventListener('click', () => {
  if (D.playing) return stopPlay();
  if (D.pos >= D.steps.length - 1) D.pos = 0;
  $('#dbgPlay').textContent = 'Pause';
  D.playing = setInterval(() => { if (D.pos >= D.steps.length - 1) return stopPlay(); dbgGo(D.pos + 1); if (D.steps[D.pos].sw.length) click(); }, 320);
});
$('#dbgNext').addEventListener('click', () => { stopPlay(); dbgGo(D.pos + 1); click(); });
$('#dbgPrev').addEventListener('click', () => { stopPlay(); dbgGo(D.pos - 1); click(); });
$('#dbgReshuffle').addEventListener('click', () => { click(); buildDebug(true); });
$('#dbgScrub').addEventListener('input', (e) => { stopPlay(); dbgGo(+e.target.value); });
document.addEventListener('keydown', (e) => {
  if (S.view !== 'debug' || /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight') { dbgGo(D.pos + 1); } else if (e.key === 'ArrowLeft') { dbgGo(D.pos - 1); }
});

/* ---------- view: stress lab ---------- */
const ST = { pattern: 'random', rows: [] };
function genFlow(pattern, n) {
  const arr = new Array(n), base = 1000000;
  for (let i = 0; i < n; i++) {
    let p;
    if (pattern === 'ascending') p = base + i * 100;
    else if (pattern === 'descending') p = base + (n - i) * 100;
    else if (pattern === 'duplicate') p = base + 18450;
    else p = base + Math.floor(Math.random() * 200000) * 100;
    arr[i] = { orderId: 'S' + i, traderId: 'stress', ticker: 'STRS', side: 'BUY', price: p, quantity: 100, timestamp: i };
  }
  return arr;
}
function runStress(pattern, n) {
  const eng = new HeapSortExchangeEngine('STRS'), arr = genFlow(pattern, n);
  const t0 = performance.now();
  const m = eng.heapSortOrders(arr);
  const ms = performance.now() - t0;
  let ok = true;
  for (let i = 1; i < arr.length; i++) if (eng.hasHigherPriority(arr[i], arr[i - 1])) { ok = false; break; }
  return { pattern, n, ms, cmp: m.comparisons, swp: m.swaps, ok, bound: n * Math.log2(Math.max(n, 2)) };
}
function renderStress() {
  const last = ST.rows[0];
  const box = $('#stressStats');
  if (!last) { box.innerHTML = '<div class="stat"><div class="l">Status</div><div class="v">Idle</div><div class="s">Press Run</div></div>'; $('#stressTable').innerHTML = ''; return; }
  const ratio = last.cmp / last.bound;
  box.innerHTML = `
    <div class="stat"><div class="l">Sort time</div><div class="v">${last.ms.toFixed(2)} ms</div><div class="s">${last.n < 50000 ? '' : last.ms <= 1.5 ? '<span class="ok">≤ 1.5 ms target</span>' : '<span class="bad">&gt; 1.5 ms target</span>'}${last.n < 50000 ? 'target applies at 50k+' : ''}</div></div>
    <div class="stat"><div class="l">Comparisons</div><div class="v">${fmt(last.cmp)}</div><div class="s">${ratio.toFixed(2)} × n·log₂n</div></div>
    <div class="stat"><div class="l">Swaps</div><div class="v">${fmt(last.swp)}</div><div class="s">${(last.swp / last.n).toFixed(2)} per order</div></div>
    <div class="stat"><div class="l">Aux memory</div><div class="v">0 B</div><div class="s">in-place, O(1)</div></div>
    <div class="stat"><div class="l">Verified order</div><div class="v ${last.ok ? 'ok' : 'bad'}">${last.ok ? 'PASS' : 'FAIL'}</div><div class="s">price-time priority</div></div>`;
  const mx = Math.max(...ST.rows.map((r) => r.ms), 0.001);
  $('#stressTable').innerHTML = ST.rows.map((r) => `<div class="st-row"><span>${r.pattern}</span><span>${fmt(r.n)}</span><span class="c3">${r.ok ? 'PASS' : 'FAIL'}</span><span class="st-bar"><i style="width:${(r.ms / mx) * 100}%"></i></span><span style="text-align:right">${r.ms.toFixed(1)} ms</span></div>`).join('');
}
function stressOne(pattern) {
  const n = +$('#stressN').value;
  ST.rows.unshift(runStress(pattern, n));
  if (ST.rows.length > 8) ST.rows.pop();
}
function withBusy(btn, fn) {
  const label = btn.textContent; btn.textContent = 'Running…';
  setTimeout(() => { fn(); btn.textContent = label; renderStress(); }, 30);
}
initSeg($('#patSeg'), (v) => { ST.pattern = v; });
$('#stressN').addEventListener('input', (e) => { $('#stressNVal').textContent = fmt(+e.target.value); });
$('#stressRun').addEventListener('click', (e) => withBusy(e.currentTarget, () => stressOne(ST.pattern)));
$('#stressAll').addEventListener('click', (e) => withBusy(e.currentTarget, () => ['random', 'ascending', 'descending', 'duplicate'].forEach(stressOne)));

/* ---------- right rail ---------- */
function avatar(k) {
  const cols = ['#C4B5FD', '#D9F99D', '#F4F4F6', '#8E8E9A'], c = cols[k % 4];
  const shapes = [
    `<circle cx="18" cy="18" r="7" fill="none" stroke="${c}" stroke-width="1.5"/>`,
    `<path d="M18 9l8 14H10z" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
    `<rect x="11" y="11" width="14" height="14" rx="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
    `<path d="M18 9l8 5v8l-8 5-8-5v-8z" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
  ];
  return `<svg viewBox="0 0 36 36">${shapes[k % 4]}</svg>`;
}
$('#avatars').innerHTML = [0, 1, 2, 3].map(avatar).join('') + '<div class="more">+25</div>';
function ago(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + 's ago' : Math.floor(s / 60) + 'm ago'; }
function renderTimeline() {
  $('#timeline').innerHTML = S.ops.slice(0, 9).map((o) => `<li class="${o.ring}"><span>${o.text}</span><span class="sub-t">${o.sub} · ${ago(o.at)}</span></li>`).join('');
}
$('#stepBtn').addEventListener('click', () => {
  click();
  if (S.view !== 'debug') { setView('debug'); } else { stopPlay(); dbgGo(D.pos + 1); }
});

/* order drawer */
const O = { side: 'BUY' };
$('#ordTrader').innerHTML = MAKERS.map((m) => `<option>${m}</option>`).join('');
function ordHint() {
  const e = S.eng[S.ticker], b = e.bids[0], a = e.asks[0];
  $('#ordTarget').textContent = O.side === 'BUY' ? 'bids[]' : 'asks[]';
  $('#ordHint').textContent = `${S.ticker} top of book: bid ${b ? usd(b.price) : '—'} / ask ${a ? usd(a.price) : '—'}. A BUY at or above the best ask crosses at the next batch.`;
}
initSeg($('#sideSeg'), (v) => { O.side = v; ordHint(); });
$('#openOrder').addEventListener('click', () => {
  click();
  const e = S.eng[S.ticker], ref = O.side === 'BUY' ? (e.asks[0] || e.bids[0]) : (e.bids[0] || e.asks[0]);
  $('#ordPrice').value = ref ? (ref.price / TICK).toFixed(2) : S.mid[S.ticker].toFixed(2);
  $('#drawer').hidden = false; $('#sideSeg')._place(false); ordHint();
});
$('#closeOrder').addEventListener('click', () => { click(); $('#drawer').hidden = true; });
$('#ordQty').addEventListener('input', (e) => { $('#ordQtyVal').textContent = e.target.value; click(); });
$('#ordSubmit').addEventListener('click', () => {
  const price = parseFloat($('#ordPrice').value), qty = +$('#ordQty').value;
  if (!(price > 0)) { $('#ordHint').textContent = 'Enter a positive limit price.'; return; }
  const t = S.ticker;
  const o = { orderId: 'ORD-' + (++orderNo), traderId: $('#ordTrader').value, ticker: t, side: O.side, price: toTicks(price), quantity: qty, timestamp: seq++ };
  submit(t, o);
  const arr = O.side === 'BUY' ? S.eng[t].bids : S.eng[t].asks;
  const idx = arr.indexOf(o);
  log('submit', O.side === 'BUY' ? 'bid' : 'ask', `${O.side} ${qty} ${t} @ ${usd(o.price)}`, `${o.orderId} → ${O.side === 'BUY' ? 'bids' : 'asks'}[${idx < 0 ? 'dropped' : idx}] after sort`);
  $('#drawer').hidden = true; click();
  renderAll();
});

/* ---------- controls wiring ---------- */
initSeg($('#tickerSeg'), (v) => { S.ticker = v; S.sel = null; S.expanded.clear(); S.hover = null; if (S.view === 'debug') buildDebug(false); renderAll(); });
initSeg($('#chartSeg'), (v) => { S.chartMode = v; renderChart(); });
initSeg($('#barSeg'), (v) => { S.barMode = v; renderBars(); });
initSeg($('#archSeg'), (v) => { S.archSide = v; S.sel = null; renderArray(); });
initSeg($('#dbgSeg'), (v) => { D.side = v; buildDebug(false); });
$('#soundBtn').addEventListener('click', (e) => {
  S.sound = !S.sound; e.currentTarget.setAttribute('aria-pressed', S.sound); e.currentTarget.title = `Tactile audio detents (${S.sound ? 'on' : 'off'})`; click();
});
$('#autoToggle').addEventListener('change', (e) => { S.auto = e.target.checked; click(); });

/* ---------- render + loop ---------- */
function renderAll() {
  renderHeader(); renderTimeline();
  if (S.view === 'overview') renderOverview();
  else if (S.view === 'array') renderArray();
  else if (S.view === 'debug') renderDebug();
  else renderStress();
}
let tickN = 0;
setInterval(() => {
  if (!S.auto) { renderHeader(); renderTimeline(); return; }
  tickN++;
  TICKERS.forEach((t) => simTick(t));
  if (tickN % 4 === 0) {
    TICKERS.forEach((t) => clearBatch(t, t !== S.ticker ? true : false));
    S.countdown = BATCH_SECONDS;
  } else S.countdown = Math.max(0, BATCH_SECONDS - (tickN % 4) * 1.5 | 0);
  if (S.view !== 'debug' && S.view !== 'stress') { S.view === 'array' && S.sel != null ? 0 : renderAll(); }
  else { renderHeader(); renderTimeline(); }
}, 1500);
setInterval(renderTimeline, 1000);

window.addEventListener('resize', () => { placeAll(); applyHover(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeAll);
renderAll(); renderStress(); buildDebug(true);
placeAll();
})();
