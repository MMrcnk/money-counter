'use strict';
/* ============================================================
   Budżet – PWA. Dane trzymane lokalnie w telefonie:
   - localStorage: budżet, wpisy, koszty stałe
   - IndexedDB: załączone potwierdzenia przelewów
   ============================================================ */

const STORE_KEY = 'budzet-v1';
const NOTE_IMGS = ['20.jpg', '50.jpg', '100.jpg', '200.jpg'];
const MAX_NOTES = 120;
const MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const WD = ['nd','pon','wt','śr','czw','pt','sob'];

/* ---------- pomocnicze ---------- */
const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => (n < 10 ? '0' : '') + n;
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseIso = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
const todayIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return iso(d); };
const daysAgoIso = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return iso(d); };
const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? NaN : x; };
const round2 = (x) => Math.round(x * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(n) {
  const neg = n < 0, c = Math.round(Math.abs(n) * 100), whole = Math.floor(c / 100), frac = c % 100;
  let s = String(whole);
  if (whole >= 10000) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + s + (frac ? ',' + pad(frac) : '');
}
const numStr = (n) => fmt(n).replace(/ /g, '');
function plural(n) {
  if (n === 1) return '1 koszt nieopłacony';
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' koszty nieopłacone';
  return n + ' kosztów nieopłaconych';
}
function lastReset(day) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const at = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  let r = at(t.getFullYear(), t.getMonth());
  if (r > t) r = at(t.getFullYear(), t.getMonth() - 1);
  return r;
}
const isPaid = (f) => !!f.paidAt && parseIso(f.paidAt) >= lastReset(f.day);

/* ---------- dane ---------- */
let S = { onboarded: false, start: 0, entries: [], fixed: [], nextId: 1 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved) S = Object.assign(S, saved);
} catch (e) {}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }
const newId = () => S.nextId++;
// konta: budżet = suma stanów wszystkich kont; stan konta = kwota przy założeniu + przychody − wydatki z tego konta
function migrate() {
  if (!Array.isArray(S.accounts)) {
    S.accounts = [];
    if (S.onboarded) {
      const a = { id: newId(), name: 'główne konto', opening: round2(S.start || 0) };
      S.accounts.push(a);
      S.entries.forEach((e) => { if (e.acc == null) e.acc = a.id; });
    }
  }
  if (S.lastAcc == null && S.accounts[0]) S.lastAcc = S.accounts[0].id;
}
migrate();
function accBalance(id) {
  const a = S.accounts.find((x) => x.id === id); if (!a) return 0;
  let b = a.opening;
  for (const e of S.entries) if (e.acc === id) b += e.type === 'in' ? e.amount : -e.amount;
  return round2(b);
}
function balance() {
  let b = 0;
  for (const a of S.accounts) b += accBalance(a.id);
  return round2(b);
}
const accName = (id) => { const a = S.accounts.find((x) => x.id === id); return a ? a.name : ''; };
function accChips(selected, type) {
  return '<div class="clabel">' + (type === 'in' ? 'na które konto?' : 'z którego konta?') + '</div><div class="chips">' +
    S.accounts.map((a) => '<button type="button" class="chip ' + type + (a.id === selected ? ' on' : '') + '" data-acc="' + a.id + '">' + CHIPCHK + esc(a.name) + '</button>').join('') + '</div>';
}
const CHIPCHK = '<svg class="ck" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7.3l2.6 2.6L11 4.5"/></svg>';
function mountChips(root, onPick) {
  root.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    root.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    onPick(Number(c.dataset.acc));
  }));
}

/* IndexedDB na załączniki */
const idb = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('budzet', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('att');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('att', mode); const req = fn(t.objectStore('att'));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
  }));
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
    clear: () => run('readwrite', (s) => s.clear()),
    keys: () => run('readonly', (s) => s.getAllKeys())
  };
})();

/* ---------- stan interfejsu ---------- */
const ui = { idx: 1, drag: 0, dragging: false, range: '14', balPos: 'home', balPhase: 'in', moved: false };
const L = { W: 390, H: 844, homeY: 272, topY: 40, fs: 72 };

const el = {
  app: $('#app'), rain: $('#rain'), glass: $('#glass2'), track: $('#track'),
  hist: $('#hist'), cal: $('#cal'), calLabel: $('#calLabel'),
  pill: $('#pill'), pillIco: $('#pillIco'), pillText: $('#pillText'),
  addIn: $('#addIn'), addOut: $('#addOut'),
  flist: $('#flist'), fsum: $('#fsum'),
  bal: $('#bal'), balInner: $('#balInner'),
  gear: $('#gear'), accBtn: $('#accBtn'), accInfo: $('#accInfo'), nav: $('#nav'), uline: $('#uline')
};

// napis „N konta” pod kwotą przesuwa się razem z ekranem Home
el.track.children[1].appendChild(el.accInfo);

/* ---------- układ zależny od ekranu ---------- */
// bezpieczne marginesy ekranu (notch / pasek na dole) odczytane z CSS
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
document.body.appendChild(safeProbe);
function safe() {
  const cs = getComputedStyle(safeProbe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}
// Pozycje liczone z wymiarów ekranu, a nie z położenia elementów –
// dzięki temu klawiatura iOS (która przesuwa widok) nie psuje układu.
function layout() {
  L.W = el.app.clientWidth || window.innerWidth;
  L.H = el.app.clientHeight || window.innerHeight;
  const sa = safe();
  const nb = Math.max(sa.bottom - 14, 18);
  const pillBottom = sa.top + 76 + (el.pill.offsetHeight || 46);
  const rndTop = L.H - nb - 170 - 86;
  L.fs = baseFont();
  const h = L.fs * 1.08;
  L.homeY = Math.round((pillBottom + rndTop) / 2 - h / 2);
  L.topY = Math.round(sa.top + 22);
  el.accInfo.style.top = Math.round(L.homeY + h + 16) + 'px';
  el.rain.style.setProperty('--fallH', (L.H + 140) + 'px');
  // zmiana rozmiaru ekranu (np. przy starcie aplikacji) nie może niczego animować
  el.app.classList.add('booting');
  placeAll();
  void el.app.offsetWidth;
  clearTimeout(layout.t);
  layout.t = setTimeout(() => el.app.classList.remove('booting'), 60);
}
function baseFont() {
  const len = fmt(balance()).length;
  const base = 72 * Math.min(1, L.W / 390);
  return Math.round(base * (len <= 5 ? 1 : Math.max(0.55, 1 - (len - 5) * 0.09)));
}

/* ---------- kwota z efektem bębna ---------- */
let reels = [], balStr = null;
function renderBalance(mode) {
  const str = fmt(balance());
  const n = str.length;
  L.fs = baseFont();
  el.bal.style.fontSize = L.fs + 'px';
  el.bal.setAttribute('aria-label', 'Budżet: ' + str + ' zł');
  const pattern = str.replace(/\d/g, 'd');
  const oldPattern = balStr == null ? null : balStr.replace(/\d/g, 'd');
  const rebuild = mode === 'intro' || pattern !== oldPattern;

  if (rebuild) {
    const prevDigits = (balStr || '').replace(/\D/g, '').split('').reverse();
    el.balInner.innerHTML = '';
    reels = [];
    const digitCount = str.replace(/\D/g, '').length;
    let di = 0;
    str.split('').forEach((ch, i) => {
      if (/\d/.test(ch)) {
        const col = document.createElement('span'); col.className = 'col';
        const reel = document.createElement('span'); reel.className = 'reel';
        let html = ''; for (let k = 0; k < 30; k++) html += '<span>' + (k % 10) + '</span>';
        reel.innerHTML = html; col.appendChild(reel); el.balInner.appendChild(col);
        const fromRight = digitCount - 1 - di; di++;
        const prev = prevDigits[fromRight];
        const startIdx = mode === 'intro' ? 0 : (prev != null ? 20 + Number(prev) : 20);
        reel.style.transition = 'none';
        reel.style.transform = 'translateY(' + (-startIdx * 1.9) + 'em)';
        reels.push({ el: reel, i, d: Number(ch) });
      } else {
        const s = document.createElement('span');
        s.className = ch === ' ' ? 'sp' : 'sym';
        if (ch !== ' ') s.textContent = ch;
        el.balInner.appendChild(s);
      }
    });
    const cur = document.createElement('span'); cur.className = 'cur'; cur.textContent = 'zł';
    el.balInner.appendChild(cur);
    void el.balInner.offsetWidth;
  } else {
    let k = 0;
    str.split('').forEach((ch, i) => { if (/\d/.test(ch)) { reels[k].d = Number(ch); reels[k].i = i; k++; } });
  }
  const go = () => reels.forEach((r) => {
    const dur = mode === 'intro' ? 1000 + r.i * 280 : 600 + (n - 1 - r.i) * 110;
    r.el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.16,.84,.24,1.02)';
    r.el.style.transform = 'translateY(' + (-(20 + r.d) * 1.9) + 'em)';
  });
  if (rebuild) requestAnimationFrame(() => requestAnimationFrame(go)); else go();
  balStr = str;
  layoutSoon();
}
let layoutT; function layoutSoon() { clearTimeout(layoutT); layoutT = setTimeout(layout, 30); }

/* ---------- pozycje elementów zależne od ekranu ---------- */
function placeAll() {
  const pos = ui.idx - ui.drag / L.W;
  const t = Math.min(1, Math.abs(pos - 1));
  [el.track, el.glass, el.uline].forEach((x) => x.classList.toggle('dragging', ui.dragging));
  // pozycja w % (niezależna od szerokości ekranu) + przesunięcie palca w px
  el.track.style.transform = 'translateX(calc(' + (-ui.idx * 100 / 3).toFixed(4) + '% + ' + ui.drag.toFixed(2) + 'px))';
  el.glass.style.opacity = t.toFixed(3);
  [...el.nav.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === ui.idx));
  const nw = el.nav.clientWidth;
  el.uline.style.transform = 'translateX(' + Math.round(nw / 6 - 15 + (nw / 3) * Math.max(0, Math.min(2, pos))) + 'px)';
  el.gear.classList.toggle('hide', !(ui.idx === 1 && !ui.dragging));
  el.accBtn.classList.toggle('hide', !(ui.idx === 1 && !ui.dragging));
  placeBal();
}
function placeBal() {
  const home = ui.balPos === 'home';
  const baseY = home ? L.homeY : L.topY;
  const sc = home ? 1 : 0.5;
  // na bocznych ekranach kwota jest „częścią” ekranu: przesuwa się dokładnie tak jak on
  const side = !home && ui.idx !== 1 && ui.balPhase === 'in';
  let y = baseY, o = 1, bx = 0;
  if (side && ui.dragging) {
    bx = ui.drag;
  } else if (home && ui.dragging && !ui.springing && !isOverscroll()) {
    const off = Math.min(1, Math.abs(ui.drag) / L.W * 3);
    y = baseY - 22 * off; o = 1 - off;
  } else if (ui.balPhase === 'out') { y = baseY - 22; o = 0; bx = ui.balX || 0; }
  else if (ui.balPhase === 'pre') { y = home ? baseY - 40 : baseY + 34; o = 0; }
  if (ui.balPhase !== 'out') ui.balX = bx;
  el.bal.classList.toggle('dragging', ui.dragging && (!ui.springing || side));
  el.bal.classList.toggle('ph-out', ui.balPhase === 'out');
  el.bal.classList.toggle('ph-pre', ui.balPhase === 'pre');
  el.bal.style.opacity = o;
  el.bal.style.transform = 'translateX(' + bx.toFixed(1) + 'px) translateY(' + Math.round(y) + 'px) scale(' + sc + ')';
}
let bt1, bt2;
// sprężyna dociągająca ekran po puszczeniu palca – zachowuje prędkość palca, bez szarpnięcia
let springRaf = 0;
function stopSpring() { if (springRaf) { cancelAnimationFrame(springRaf); springRaf = 0; return true; } return false; }
function springTo(fromDrag, v0) {
  stopSpring();
  const k = 190, c = 2 * Math.sqrt(k) * 0.92;
  let x = fromDrag, v = v0 || 0, last = performance.now();
  ui.springing = true; ui.dragging = true;
  const step = (t) => {
    const dt = Math.min(0.032, (t - last) / 1000); last = t;
    v += (-k * x - c * v) * dt; x += v * dt;
    if (Math.abs(x) < 0.4 && Math.abs(v) < 8) {
      springRaf = 0; ui.drag = 0; ui.dragging = false; ui.springing = false; placeAll(); return;
    }
    ui.drag = x; placeAll();
    springRaf = requestAnimationFrame(step);
  };
  ui.drag = x; placeAll();
  springRaf = requestAnimationFrame(step);
}
function goTo(i, spring) {
  const target = i === 1 ? 'home' : 'top';
  clearTimeout(bt1); clearTimeout(bt2);
  if (target !== ui.balPos) ui.balPhase = 'out';
  if (spring) { ui.idx = i; springTo(spring.drag, spring.v); }
  else { stopSpring(); ui.springing = false; ui.idx = i; ui.drag = 0; ui.dragging = false; }
  if (target === ui.balPos) { ui.balPhase = 'in'; placeAll(); return; }
  ui.balPhase = 'out'; placeAll();
  bt1 = setTimeout(() => {
    ui.balPos = target; ui.balPhase = 'pre'; placeBal();
    void el.bal.offsetWidth;
    bt2 = setTimeout(() => { ui.balPhase = 'in'; placeBal(); }, 30);
  }, 125);
}

/* ---------- przesuwanie ekranów ---------- */
let P = null, raf = 0;
el.app.addEventListener('pointerdown', (e) => {
  if (document.querySelector('.ov')) return;
  stopJelly();
  const caught = stopSpring();
  P = { x: e.clientX, y: e.clientY, axis: null, base: caught ? ui.drag : 0, samples: [] };
});
el.app.addEventListener('pointermove', (e) => {
  if (!P) return;
  const dx = e.clientX - P.x, dy = e.clientY - P.y;
  if (!P.axis) {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) P.axis = 'x';
    else if (Math.abs(dy) > 8) P.axis = 'y';
  }
  if (P.axis === 'x') {
    ui.moved = true;
    let d = dx + P.base;
    if ((ui.idx === 0 && d > 0) || (ui.idx === 2 && d < 0)) d = rubber(d);
    ui.drag = d; ui.dragging = true; ui.springing = false;
    const now = performance.now();
    P.samples.push({ x: e.clientX, t: now });
    while (P.samples.length > 2 && now - P.samples[0].t > 100) P.samples.shift();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; placeAll(); });
  }
});
// opór na krawędziach jak w iOS – im dalej ciągniesz, tym mocniej „trzyma”
function rubber(x) {
  const dim = L.W, c = 0.55, a = Math.abs(x);
  return Math.sign(x) * (1 - 1 / (a * c / dim + 1)) * dim;
}
const isOverscroll = () => (ui.idx === 0 && ui.drag > 0) || (ui.idx === 2 && ui.drag < 0);
// „żelek” – po puszczeniu krawędź odbija się jak sprężyna z lekkim drganiem
let jellyRaf = 0, jellyPanel = null;
function stopJelly() {
  if (!jellyRaf) return;
  cancelAnimationFrame(jellyRaf); jellyRaf = 0;
  if (jellyPanel) jellyPanel.style.transform = '';
  el.track.classList.remove('dragging');
  el.bal.classList.remove('dragging');
}
function jelly(fromX) {
  stopJelly();
  const panel = jellyPanel = el.track.children[ui.idx];
  const base = -ui.idx * L.W;
  const k = 260, c = 13;           // sztywność i tłumienie sprężyny
  let x = fromX, v = 0, last = performance.now();
  el.track.classList.add('dragging');
  el.bal.classList.add('dragging');
  const step = (t) => {
    const dt = Math.min(0.032, (t - last) / 1000); last = t;
    v += (-k * x - c * v) * dt; x += v * dt;
    el.track.style.transform = 'translateX(' + (base + x) + 'px)';
    const sk = Math.max(-3, Math.min(3, v * 0.0035));
    const sc = 1 + Math.min(0.025, Math.abs(x) / L.W * 0.12);
    panel.style.transform = 'skewX(' + (-sk).toFixed(3) + 'deg) scaleX(' + sc.toFixed(4) + ')';
    if (ui.balPos === 'top') el.bal.style.transform = 'translateX(' + x.toFixed(1) + 'px) translateY(' + L.topY + 'px) scale(0.5) skewX(' + (-sk).toFixed(3) + 'deg)';
    if (Math.abs(x) < 0.3 && Math.abs(v) < 4) {
      jellyRaf = 0; panel.style.transform = '';
      el.track.style.transform = 'translateX(' + base + 'px)';
      el.track.classList.remove('dragging');
      el.bal.classList.remove('dragging'); placeBal();
      return;
    }
    jellyRaf = requestAnimationFrame(step);
  };
  jellyRaf = requestAnimationFrame(step);
}
function endDrag() {
  if (!P) return;
  const axis = P.axis, base = P.base, samples = P.samples; P = null;
  if (axis !== 'x' && base) { springTo(ui.drag, 0); return; }
  if (axis === 'x') {
    if (isOverscroll()) {
      const from = ui.drag;
      ui.drag = 0; ui.dragging = false; ui.balPhase = 'in';
      placeAll();
      jelly(from);
      setTimeout(() => { ui.moved = false; }, 60);
      return;
    }
    let v = 0;
    if (samples.length > 1) {
      const a = samples[0], b = samples[samples.length - 1];
      if (b.t > a.t) v = (b.x - a.x) / ((b.t - a.t) / 1000);
    }
    let i = ui.idx;
    const flick = Math.abs(v) > 450;
    if ((flick && v < 0) || (!flick && ui.drag < -L.W * 0.22)) i = Math.min(2, i + 1);
    else if ((flick && v > 0) || (!flick && ui.drag > L.W * 0.22)) i = Math.max(0, i - 1);
    const fromDrag = ui.drag + (i - ui.idx) * L.W;
    goTo(i, { drag: fromDrag, v: Math.max(-4000, Math.min(4000, v)) });
    setTimeout(() => { ui.moved = false; }, 60);
  }
}
el.app.addEventListener('pointerup', endDrag);
el.app.addEventListener('pointercancel', endDrag);
// po przeciągnięciu nie traktuj puszczenia palca jako kliknięcia
el.app.addEventListener('click', (e) => { if (ui.moved) { e.stopPropagation(); e.preventDefault(); } }, true);

el.nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goTo(Number(b.dataset.i)); });
el.pill.addEventListener('click', () => goTo(2));

/* ---------- spadające banknoty ---------- */
const notes = [];
const retiring = [];
let rainStarted = false;
// banknot oznaczony do usunięcia znika dopiero, gdy skończy spadać (koniec jednego przelotu)
function onNoteLoop(e) {
  const n = e.currentTarget;
  if (e.target !== n || !n.dataset.retire) return;
  const i = retiring.indexOf(n); if (i >= 0) retiring.splice(i, 1);
  n.remove();
}
// ile banknotów: mało przy małych kwotach, coraz więcej przy dużych
// 0–749 zł → 2, 750 zł → 5, 1 500 zł → 8, … 10 000 zł → 41, 50 000 zł → 73, 100 000 zł → 101, ~150 000 zł+ → 120
function notesFor(bal) {
  if (bal <= 0) return 0;
  // do 10 000 zł: co każde pełne 750 zł dochodzą od razu 3 banknoty (wyraźnie widać zmianę);
  // powyżej przybywa ich dalej, aż do limitu
  const steps = Math.floor(Math.min(bal, 10000) / 750);
  let n = 2 + steps * 3;
  if (bal > 10000) n += 0.0778 * (Math.pow(bal, 0.602) - Math.pow(10000, 0.602));
  return Math.min(MAX_NOTES, Math.floor(n));
}
// jakie nominały: przy małym budżecie głównie 20 i 50 zł, przy dużym coraz więcej 100 i 200 zł
function pickNote(bal) {
  const t = Math.max(0, Math.min(1, Math.log10(Math.max(bal, 10)) / 5));
  const w = [1.4 - t, 1, 0.4 + t, 1.6 * t * t + 0.1];
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 4; k++) { x -= w[k]; if (x <= 0) return NOTE_IMGS[k]; }
  return NOTE_IMGS[3];
}
function renderRain() {
  const bal = balance();
  const want = notesFor(bal);
  // nadmiarowe banknoty nie znikają nagle: dolatują do dołu ekranu i po prostu nie wracają na górę
  let drop = notes.length - want;
  while (drop-- > 0) {
    const n = notes.pop();
    n.dataset.retire = '1';
    retiring.push(n);
  }
  // gdy budżet znów wzrośnie, najpierw „zatrzymujemy” banknoty, które właśnie miały odejść
  while (notes.length < want && retiring.length) {
    const n = retiring.pop(); delete n.dataset.retire; notes.push(n);
  }
  let added = 0;
  while (notes.length < want) {
    const r = Math.random, sgn = () => (r() < 0.5 ? -1 : 1);
    const sc = 1 + r() * 0.75, dur = 6 + r() * 8, r0 = Math.round(-45 + r() * 90);
    // przy starcie banknoty są już rozsiane po ekranie; nowe (po przychodzie) spadają od góry, jeden po drugim
    const delay = rainStarted ? (added * 0.18 + r() * 0.25) : -r() * dur;
    added++;
    const n = document.createElement('span');
    n.className = 'note';
    n.style.cssText = 'left:' + Math.round(r() * 80) + '%;animation-duration:' + dur.toFixed(2) + 's;animation-delay:' + delay.toFixed(2) + 's;--drift:' + Math.round(-70 + r() * 140) + 'px';
    const swayDur = 1.4 + r() * 3.2;
    n.innerHTML = '<span class="ni" style="animation-duration:' + swayDur.toFixed(2) + 's;animation-delay:' + (-r() * 4).toFixed(2) + 's;--sx:' + Math.round(6 + r() * 26) + 'px;--r0:' + r0 + 'deg;--r1:' + (r0 + sgn() * Math.round(20 + r() * 45)) + 'deg;--ry:' + (sgn() * Math.round(60 + r() * 240)) + 'deg;--rx0:' + Math.round(-40 + r() * 80) + 'deg;--rx1:' + Math.round(-40 + r() * 80) + 'deg">' +
      '<img src="' + pickNote(bal) + '" alt="" width="' + Math.round(56 * sc) + '" height="' + Math.round(28 * sc) + '"></span>';
    n.addEventListener('animationiteration', onNoteLoop);
    el.rain.appendChild(n);
    notes.push(n);
  }
  if (want > 0 || notes.length) rainStarted = true;
}

/* ---------- pigułka statusu ---------- */
function renderPill() {
  const unpaid = S.fixed.filter((f) => !isPaid(f)).length;
  const ok = unpaid === 0;
  el.pill.className = 'pill ' + (ok ? 'ok' : 'bad');
  el.pillText.textContent = ok ? 'wszystkie koszty opłacone' : plural(unpaid);
  el.pillIco.innerHTML = ok
    ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 7.3l2.6 2.6L11 4.5"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M7 3v5M7 10.5v.5"/></svg>';
  el.pill.setAttribute('aria-label', el.pillText.textContent + ' – przejdź do kosztów stałych');
}

/* ---------- historia ---------- */
const ICO_IN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9fd09f" stroke-width="1.3"><path d="M8 2v12M2 8h12"/></svg>';
const ICO_OUT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ffb3b3" stroke-width="1.3"><path d="M2 8h12"/></svg>';
function renderHistory() {
  el.calLabel.textContent = ui.range === '14' ? '14 dni' : 'wszystko';
  el.cal.classList.toggle('on', ui.range !== '14');
  const from = ui.range === '14' ? daysAgoIso(13) : '0000-00-00';
  const list = S.entries.filter((e) => e.date >= from)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  if (!list.length) { el.hist.innerHTML = '<div class="empty">brak wpisów w tym okresie</div>'; return; }
  const months = []; const mMap = {};
  list.forEach((e) => {
    const key = e.date.slice(0, 7), d = parseIso(e.date);
    let m = mMap[key];
    if (!m) { m = mMap[key] = { label: MONTHS[d.getMonth()] + ' ' + d.getFullYear(), total: 0, days: [], dMap: {} }; months.push(m); }
    m.total += e.type === 'in' ? e.amount : -e.amount;
    let day = m.dMap[e.date];
    if (!day) { day = m.dMap[e.date] = { wd: WD[d.getDay()], dm: pad(d.getDate()) + '.' + pad(d.getMonth() + 1), rows: [] }; m.days.push(day); }
    day.rows.push(e);
  });
  let n = 0, html = '';
  months.forEach((m) => {
    html += '<div class="month"><span>' + m.label + '</span><b>' + (m.total >= 0 ? '+' : '') + fmt(m.total) + ' zł</b></div>';
    m.days.forEach((d, di) => {
      if (di > 0) html += '<div class="dsep" aria-hidden="true"><span></span></div>';
      html += '<div class="day"><div class="dlab"><span>' + d.wd + '</span><small>' + d.dm + '</small></div><div class="rows">';
      d.rows.forEach((e) => {
        const isIn = e.type === 'in';
        html += '<button class="row ' + (isIn ? 'in' : 'out') + '" data-id="' + e.id + '" style="animation-delay:' + Math.min(n++, 12) * 40 + 'ms">' +
          '<span class="ico">' + (isIn ? ICO_IN : ICO_OUT) + '</span>' +
          '<span class="amt">' + (isIn ? '' : '-') + fmt(e.amount) + ' zł</span><span class="sep"></span>' +
          '<span class="nm">' + esc(e.name) + (S.accounts.length > 1 && e.acc != null ? '<small class="acct">' + esc(accName(e.acc)) + '</small>' : '') + '</span></button>';
      });
      html += '</div></div>';
    });
  });
  el.hist.innerHTML = html;
}
el.hist.addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) openEntry(Number(r.dataset.id)); });
el.cal.addEventListener('click', () => { ui.range = ui.range === '14' ? 'all' : '14'; renderHistory(); });

/* ---------- koszty stałe ---------- */
const CHK = '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5l3.2 3.2L14 5.8"/></svg>';
function renderFixed() {
  let html = '', sum = 0;
  S.fixed.forEach((f, i) => {
    const paid = isPaid(f); sum += f.amount;
    html += '<div class="frow' + (paid ? ' paid' : '') + '" data-id="' + f.id + '" style="animation-delay:' + 60 * i + 'ms">' +
      '<button class="chk' + (paid ? ' on' : '') + '" data-act="toggle" aria-label="' + (paid ? 'Odznacz: ' : 'Oznacz jako opłacony: ') + esc(f.name) + '">' + CHK + '</button>' +
      '<button class="fbody" data-act="edit" aria-label="Edytuj: ' + esc(f.name) + '"><span class="famt">-' + fmt(f.amount) + ' zł</span><span class="sep"></span><span class="fnm">' + esc(f.name) + '</span></button></div>';
  });
  if (!S.fixed.length) html += '<div class="empty" style="padding-top:0;margin-top:48px">brak kosztów stałych</div>';
  html += '<button class="addf" data-act="add">dodaj nowy</button>';
  el.flist.innerHTML = html;
  el.fsum.textContent = fmt(sum) + ' zł';
}
el.flist.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'add') return openFixedAdd();
  const row = b.closest('.frow'); const id = Number(row.dataset.id);
  const f = S.fixed.find((x) => x.id === id); if (!f) return;
  if (act === 'toggle') {
    const paid = isPaid(f);
    f.paidAt = paid ? null : todayIso(); save();
    row.classList.toggle('paid', !paid); b.classList.toggle('on', !paid);
    b.setAttribute('aria-label', (!paid ? 'Odznacz: ' : 'Oznacz jako opłacony: ') + f.name);
    renderPill();
  } else if (act === 'edit') openFixedEdit(id);
});

function renderAccInfo() {
  const n = S.accounts.length;
  el.accInfo.textContent = ''; void n;
}
function renderAll() { renderPill(); renderHistory(); renderFixed(); renderRain(); renderBalance(); renderAccInfo(); }

/* ---------- okna (karty) ---------- */
let modal = null;
function openModal(html, opts = {}) {
  const ov = document.createElement('div'); ov.className = 'ov' + (opts.pop ? ' pop' : '');
  const card = document.createElement('div'); card.className = 'card' + (opts.pop ? ' popc' : '');
  card.innerHTML = '<div class="swap">' + html + '</div>';
  ov.appendChild(card); document.body.appendChild(ov);
  if (!opts.locked) ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(opts.onClose); });
  // stuknięcie w pustą część karty chowa klawiaturę
  card.addEventListener('click', (e) => { if (!e.target.closest('input,button,label,.wheel') && document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  modal = { ov, card, closing: false };
  return card;
}
function swapModal(html) {
  if (!modal) return null;
  modal.card.innerHTML = '<div class="swap">' + html + '</div>';
  return modal.card;
}
function closeModal(after) {
  if (!modal || modal.closing) return;
  const m = modal; m.closing = true;
  if (document.activeElement) document.activeElement.blur();
  window.scrollTo(0, 0);
  m.ov.classList.add('closing'); m.card.classList.add('closing');
  setTimeout(() => { m.ov.remove(); if (modal === m) modal = null; if (typeof after === 'function') after(); }, 220);
}

/* koło wyboru dnia miesiąca */
function wheelHTML() {
  let items = '';
  for (let n = 1; n <= 31; n++) items += '<button class="witem" data-n="' + n + '">' + n + '</button>';
  return '<div class="amtrow dayrow"><span class="dsuf">zerowane</span><div class="wheel" aria-label="Dzień miesiąca zerowania"><div class="wband"></div><div class="wscroll"><div class="wpad"></div>' + items + '<div class="wpad"></div></div></div><span class="dsuf">dnia miesiąca</span></div>';
}
function mountWheel(root, initial, onChange) {
  const sc = $('.wscroll', root); let cur = initial;
  sc.addEventListener('scroll', () => { if (sc.scrollLeft) sc.scrollLeft = 0; }, { passive: true });
  const mark = () => sc.querySelectorAll('.witem').forEach((b) => b.classList.toggle('sel', Number(b.dataset.n) === cur));
  mark();
  requestAnimationFrame(() => { sc.scrollTop = (initial - 1) * 44; });
  sc.addEventListener('scroll', () => {
    const d = Math.max(1, Math.min(31, Math.round(sc.scrollTop / 44) + 1));
    if (d !== cur) { cur = d; mark(); onChange(d); if (navigator.vibrate) navigator.vibrate(4); }
  }, { passive: true });
  sc.addEventListener('click', (e) => {
    const b = e.target.closest('.witem'); if (b) sc.scrollTo({ top: (Number(b.dataset.n) - 1) * 44, behavior: 'smooth' });
  });
}

const CLIP = '<svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M23 12.5l-9.6 9.6a3 3 0 0 1-4.2-4.2l10.4-10.4a5 5 0 0 1 7 7L15.4 25.7a7 7 0 0 1-9.9-9.9L15 6.3"/></svg>';


/* ---------- dźwięk „cza-czing” kasy (generowany, bez plików) ---------- */
let AC = null;
function audio() {
  try {
    if (!AC) {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      if (navigator.audioSession) { try { navigator.audioSession.type = 'transient'; } catch (e) {} }
    }
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { AC = null; }
  return AC;
}
// dźwięki z plików – wczytane raz, odtwarzane przez Web Audio (niezawodnie na iOS)
// kasa.mp3 – po dodaniu przychodu, wydatek.mp3 – po dodaniu wydatku
const SOUNDS = {};
['kasa.mp3', 'wydatek.mp3'].forEach((f) => {
  SOUNDS[f] = { raw: null, buf: null };
  fetch(f).then((r) => r.arrayBuffer()).then((b) => { SOUNDS[f].raw = b; }).catch(() => {});
});
function decodeSound(ctx, f) {
  const s = SOUNDS[f];
  if (s.buf || !s.raw) return Promise.resolve(s.buf);
  const raw = s.raw; s.raw = null;
  return new Promise((res) => ctx.decodeAudioData(raw, (b) => { s.buf = b; res(b); }, () => res(null)));
}
function playSound(f) {
  const ctx = audio();
  const play = (buf) => {
    if (buf && ctx) {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(ctx.destination); src.start();
    } else {
      try { const a = new Audio(f); a.play().catch(() => {}); } catch (e) {}
    }
  };
  if (ctx) decodeSound(ctx, f).then(play); else play(null);
}

/* --- dodawanie przychodu / wydatku --- */
function openAdd(type) {
  const isIn = type === 'in';
  let acc = S.accounts.some((a) => a.id === S.lastAcc) ? S.lastAcc : (S.accounts[0] && S.accounts[0].id);
  const card = openModal(
    '<div class="ct">' + (isIn ? 'nazwij przychód i podaj kwotę' : 'nazwij wydatek i podaj kwotę') + '</div>' +
    '<input class="inp" id="fName" type="text" placeholder="nazwa" aria-label="Nazwa" autocomplete="off">' +
    '<div class="amtrow"><input class="inp" id="fAmt" type="text" inputmode="decimal" placeholder="kwota" aria-label="Kwota" autocomplete="off"><span class="zl">zł</span></div>' +
    accChips(acc, type) +
    (isIn ? '' : '<label class="attach" id="fAtt">' + CLIP + '<span id="fAttLbl">załącz potwierdzenie przelewu</span><input type="file" accept="image/*,application/pdf"></label>') +
    '<input class="date" id="fDate" type="date" value="' + todayIso() + '" aria-label="Data">' +
    '<button class="btn ' + (isIn ? 'in' : 'out') + '" id="fGo">dodaj</button>'
  );
  mountChips(card, (id) => { acc = id; });
  let file = null;
  const att = $('#fAtt', card);
  if (att) $('input', att).addEventListener('change', (e) => {
    file = e.target.files && e.target.files[0];
    if (file) { $('#fAttLbl', card).textContent = file.name; att.classList.add('has'); }
  });
  $('#fGo', card).addEventListener('click', async () => {
    audio(); // odblokowanie dźwięku w iOS – musi być w momencie stuknięcia
    const name = $('#fName', card).value.trim(), a = num($('#fAmt', card).value);
    $('#fName', card).classList.toggle('bad', !name);
    $('#fAmt', card).classList.toggle('bad', !(a > 0));
    if (!name || !(a > 0)) return;
    const e = { id: newId(), type, name, amount: round2(a), date: $('#fDate', card).value || todayIso(), acc };
    S.lastAcc = acc;
    if (file) {
      e.att = { name: file.name, type: file.type };
      try { await idb.set(e.id, file); } catch (err) { delete e.att; }
    }
    S.entries.push(e); save();
    playSound(isIn ? 'kasa.mp3' : 'wydatek.mp3');
    renderAll();
    closeModal();
  });
}
el.addIn.addEventListener('click', () => openAdd('in'));
el.addOut.addEventListener('click', () => openAdd('out'));

/* --- karta wpisu z historii --- */
function openEntry(id) {
  const e = S.entries.find((x) => x.id === id); if (!e) return;
  let changed = false;
  openModal('', { onClose: () => { if (changed) renderAll(); } });
  const main = () => {
    const card = swapModal(
      '<div class="ct">' + (e.type === 'in' ? 'karta przychodu' : 'karta wydatku') + '</div>' +
      '<input class="inp" id="eName" type="text" aria-label="Nazwa" value="' + esc(e.name) + '" autocomplete="off">' +
      '<div class="amtrow"><input class="inp" id="eAmt" type="text" inputmode="decimal" aria-label="Kwota" value="' + numStr(e.amount) + '" autocomplete="off"><span class="zl">zł</span></div>' +
      accChips(e.acc, e.type) +
      (e.att ? '<button class="attach has" id="eView">' + CLIP + '<span>zobacz potwierdzenie przelewu</span></button>' : '') +
      '<input class="date" id="eDate" type="date" aria-label="Data" value="' + e.date + '">' +
      '<button class="btn out" id="eDel">' + (e.type === 'in' ? 'usuń przychód' : 'usuń wydatek') + '</button>'
    );
    $('#eName', card).addEventListener('input', (ev) => { e.name = ev.target.value; changed = true; save(); });
    $('#eAmt', card).addEventListener('input', (ev) => { const a = num(ev.target.value); if (a > 0) { e.amount = round2(a); changed = true; save(); } });
    $('#eDate', card).addEventListener('change', (ev) => { if (ev.target.value) { e.date = ev.target.value; changed = true; save(); } });
    mountChips(card, (id) => { e.acc = id; changed = true; save(); });
    if (e.att) $('#eView', card).addEventListener('click', view);
    $('#eDel', card).addEventListener('click', confirmDel);
  };
  const view = async () => {
    let blob = null; try { blob = await idb.get(e.id); } catch (err) {}
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (!/^image\//.test(blob.type || e.att.type)) { window.open(url, '_blank'); return; }
    const card = swapModal('<img class="viewimg" src="' + url + '" alt="Potwierdzenie przelewu"><button class="btn ghost" id="vBack">wróć</button>');
    $('#vBack', card).addEventListener('click', () => { URL.revokeObjectURL(url); main(); });
  };
  const confirmDel = () => {
    const card = swapModal(
      '<div class="ct big">usunąć operację?</div>' +
      '<div class="warn">' + (e.type === 'in' ? '' : '-') + fmt(e.amount) + ' zł · ' + esc(e.name) + '</div>' +
      '<div class="btnrow" style="margin-top:6px"><button class="btn out" id="dYes">tak</button><button class="btn ghost" id="dNo">nie</button></div>'
    );
    $('#dNo', card).addEventListener('click', main);
    $('#dYes', card).addEventListener('click', () => {
      closeModal(() => {
        S.entries = S.entries.filter((x) => x.id !== e.id); save();
        if (e.att) idb.del(e.id).catch(() => {});
        renderAll();
      });
    });
  };
  main();
}

/* --- nowy koszt stały --- */
function openFixedAdd() {
  let day = 1;
  const card = openModal(
    '<div class="ct">nazwij stały wydatek i podaj kwotę</div>' +
    '<input class="inp" id="xName" type="text" placeholder="wpisz nazwę" aria-label="Nazwa" autocomplete="off">' +
    '<div class="amtrow"><input class="inp" id="xAmt" type="text" inputmode="decimal" placeholder="podaj kwotę" aria-label="Kwota" autocomplete="off"><span class="zl">zł</span></div>' +
    wheelHTML() +
    '<button class="btn out" id="xGo" style="margin-top:10px">dodaj</button>'
  );
  mountWheel(card, day, (d) => { day = d; });
  $('#xGo', card).addEventListener('click', () => {
    const name = $('#xName', card).value.trim(), a = num($('#xAmt', card).value);
    $('#xName', card).classList.toggle('bad', !name);
    $('#xAmt', card).classList.toggle('bad', !(a > 0));
    if (!name || !(a > 0)) return;
    S.fixed.push({ id: newId(), name, amount: round2(a), day, paidAt: null }); save();
    renderFixed(); renderPill();
    closeModal();
  });
}

/* --- edycja kosztu stałego --- */
function openFixedEdit(id) {
  const f = S.fixed.find((x) => x.id === id); if (!f) return;
  openModal('', { onClose: () => { renderFixed(); renderPill(); } });
  const main = () => {
    const card = swapModal(
      '<div class="ct">karta kosztu stałego</div>' +
      '<input class="inp" id="yName" type="text" aria-label="Nazwa" value="' + esc(f.name) + '" autocomplete="off">' +
      '<div class="amtrow"><input class="inp" id="yAmt" type="text" inputmode="decimal" aria-label="Kwota" value="' + numStr(f.amount) + '" autocomplete="off"><span class="zl">zł</span></div>' +
      wheelHTML() +
      '<button class="btn out" id="yDel" style="margin-top:10px">usuń koszt stały</button>'
    );
    $('#yName', card).addEventListener('input', (ev) => { f.name = ev.target.value; save(); });
    $('#yAmt', card).addEventListener('input', (ev) => { const a = num(ev.target.value); if (a > 0) { f.amount = round2(a); save(); } });
    mountWheel(card, f.day, (d) => { f.day = d; save(); });
    $('#yDel', card).addEventListener('click', confirmDel);
  };
  const confirmDel = () => {
    const card = swapModal(
      '<div class="ct big">usunąć koszt stały?</div>' +
      '<div class="warn">-' + fmt(f.amount) + ' zł · ' + esc(f.name) + ' · zerowane ' + f.day + '. dnia miesiąca</div>' +
      '<div class="btnrow" style="margin-top:6px"><button class="btn out" id="dYes">tak</button><button class="btn ghost" id="dNo">nie</button></div>'
    );
    $('#dNo', card).addEventListener('click', main);
    $('#dYes', card).addEventListener('click', () => {
      closeModal(() => { S.fixed = S.fixed.filter((x) => x.id !== f.id); save(); renderFixed(); renderPill(); });
    });
  };
  main();
}

/* --- ustawienia --- */
const ICO_EXP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
const ICO_IMP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
function openSettings() {
  openModal('');
  const main = () => {
    const card = swapModal(
      '<div class="ct">ustawienia</div>' +
      '<div class="sline"><span>konta</span><b>' + S.accounts.length + '</b></div>' +
      '<div class="sline"><span>wpisy w historii</span><b>' + S.entries.length + '</b></div>' +
      '<div class="btnrow" style="margin-top:6px"><button class="btn ghost sm" id="sExp">' + ICO_EXP + 'eksportuj</button><button class="btn ghost sm" id="sImp" type="button">' + ICO_IMP + 'importuj</button></div>' +
      '<input type="file" id="sImpFile" accept="application/json,.json" style="display:none">' +
      '<button class="btn out" id="sReset" style="margin-top:4px">resetuj budżet</button>'
    );
    $('#sExp', card).addEventListener('click', exportData);
    $('#sImp', card).addEventListener('click', () => $('#sImpFile', card).click());
    $('#sImpFile', card).addEventListener('change', (ev) => { const file = ev.target.files && ev.target.files[0]; if (file) confirmImport(file); });
    $('#sReset', card).addEventListener('click', confirmReset);
  };
  const confirmReset = () => {
    const card = swapModal(
      '<div class="ct">na pewno?</div>' +
      '<div class="warn">Usunie to całą historię przychodów i wydatków, a stan wszystkich kont wróci do 0 zł. Konta i koszty stałe zostaną. Tego nie da się cofnąć.</div>' +
      '<div class="btnrow"><button class="btn out" id="rYes">resetuj</button><button class="btn ghost" id="rNo">anuluj</button></div>'
    );
    $('#rNo', card).addEventListener('click', main);
    $('#rYes', card).addEventListener('click', () => {
      S.entries = []; S.start = 0; S.accounts.forEach((a) => { a.opening = 0; }); save();
      idb.clear().catch(() => {});
      closeModal(() => { goTo(1); renderPill(); renderHistory(); renderFixed(); renderRain(); renderBalance('intro'); });
    });
  };
  const confirmImport = (file) => {
    const card = swapModal(
      '<div class="ct">na pewno?</div>' +
      '<div class="warn">Import zastąpi wszystkie obecne dane danymi z pliku „' + esc(file.name) + '”.</div>' +
      '<div class="btnrow"><button class="btn out" id="iYes">zastąp</button><button class="btn ghost" id="iNo">anuluj</button></div>'
    );
    $('#iNo', card).addEventListener('click', main);
    $('#iYes', card).addEventListener('click', async () => {
      try {
        const data = JSON.parse(await file.text());
        if (!data || !data.state || !Array.isArray(data.state.entries)) throw new Error('zły plik');
        await idb.clear();
        for (const [k, v] of Object.entries(data.attachments || {})) {
          const blob = await (await fetch(v.dataUrl)).blob();
          await idb.set(Number(k), blob);
        }
        S = Object.assign({ onboarded: true, start: 0, entries: [], fixed: [], nextId: 1 }, data.state);
        migrate(); save();
        closeModal(() => { renderAll(); renderBalance('intro'); });
      } catch (err) {
        const c = swapModal('<div class="ct">nie udało się</div><div class="warn">To nie jest plik kopii z tej aplikacji.</div><button class="btn ghost" id="iOk">wróć</button>');
        $('#iOk', c).addEventListener('click', main);
      }
    });
  };
  main();
}
async function exportData() {
  const attachments = {};
  try {
    const keys = await idb.keys();
    for (const k of keys) {
      const blob = await idb.get(k);
      if (blob) attachments[k] = { type: blob.type, dataUrl: await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }) };
    }
  } catch (err) {}
  const json = JSON.stringify({ app: 'budzet', version: 1, exportedAt: new Date().toISOString(), state: S, attachments });
  const name = 'money-counter-kopia-' + todayIso() + '.json';
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
el.gear.addEventListener('click', openSettings);

/* --- konta --- */
function openAccounts() {
  const rows = S.accounts.map((a) => '<button class="accrow" data-id="' + a.id + '"><span class="an">' + esc(a.name) + '</span><span class="ab">' + fmt(accBalance(a.id)) + ' zł</span></button>').join('');
  const card = openModal(
    '<div class="ct">twoje konta</div>' +
    '<div class="acclist">' + (rows || '<div class="warn">brak kont</div>') + '</div>' +
    '<div class="sline" style="padding:2px 6px 0"><span>razem</span><b style="font-weight:500">' + fmt(balance()) + ' zł</b></div>' +
    '<button class="btn in" id="aAdd" style="margin-top:4px">+ dodaj konto</button>'
  );
  card.querySelectorAll('.accrow').forEach((r) => r.addEventListener('click', () => closeModal(() => openAccountEdit(Number(r.dataset.id)))));
  $('#aAdd', card).addEventListener('click', () => closeModal(openAccountAdd));
}
el.accBtn.addEventListener('click', openAccounts);

function openAccountAdd() {
  const card = openModal(
    '<div class="ct">nowe konto</div>' +
    '<input class="inp" id="nName" type="text" placeholder="nazwa konta, np. mBank" aria-label="Nazwa konta" autocomplete="off">' +
    '<div class="amtrow"><input class="inp" id="nAmt" type="text" inputmode="decimal" placeholder="ile masz na koncie" aria-label="Stan konta" autocomplete="off"><span class="zl">zł</span></div>' +
    '<div class="warn" style="color:#8a8a8a;font-size:13px">To stan konta – doliczy się do budżetu, ale nie trafi do historii jako przychód.</div>' +
    '<button class="btn in" id="nGo">dodaj konto</button>'
  );
  $('#nGo', card).addEventListener('click', () => {
    const name = $('#nName', card).value.trim(), v = num($('#nAmt', card).value || '0');
    $('#nName', card).classList.toggle('bad', !name);
    $('#nAmt', card).classList.toggle('bad', isNaN(v));
    if (!name || isNaN(v)) return;
    S.accounts.push({ id: newId(), name, opening: round2(v) }); save();
    closeModal(() => {});
    renderAll();
  });
}

function openAccountEdit(id) {
  const a = S.accounts.find((x) => x.id === id); if (!a) return;
  openModal('', { onClose: () => renderAll() });
  const used = () => S.entries.some((e) => e.acc === a.id);
  const main = () => {
    const card = swapModal(
      '<div class="ct">konto</div>' +
      '<input class="inp" id="kName" type="text" aria-label="Nazwa konta" value="' + esc(a.name) + '" autocomplete="off">' +
      '<div class="sline" style="padding:4px 6px"><span>stan konta</span><b style="font-size:18px">' + fmt(accBalance(a.id)) + ' zł</b></div>' +
      '<div class="sline" style="padding:0 6px"><span>wpisy z tym kontem</span><b>' + S.entries.filter((e) => e.acc === a.id).length + '</b></div>' +
      '<button class="btn out" id="kDel" style="margin-top:8px">usuń konto</button>'
    );
    $('#kName', card).addEventListener('input', (ev) => { a.name = ev.target.value; save(); });
    $('#kDel', card).addEventListener('click', confirmDel);
  };
  const confirmDel = () => {
    if (S.accounts.length <= 1) {
      const c = swapModal('<div class="ct">nie można usunąć</div><div class="warn">To jedyne konto – musi zostać przynajmniej jedno.</div><button class="btn ghost" id="kBack">wróć</button>');
      $('#kBack', c).addEventListener('click', main); return;
    }
    if (used()) {
      const c = swapModal('<div class="ct">nie można usunąć</div><div class="warn">Do tego konta są przypisane wpisy w historii. Najpierw zmień w nich konto albo je usuń.</div><button class="btn ghost" id="kBack">wróć</button>');
      $('#kBack', c).addEventListener('click', main); return;
    }
    const c = swapModal(
      '<div class="ct big">usunąć konto?</div>' +
      '<div class="warn">' + esc(a.name) + ' · ' + fmt(accBalance(a.id)) + ' zł</div>' +
      '<div class="btnrow" style="margin-top:6px"><button class="btn out" id="dYes">tak</button><button class="btn ghost" id="dNo">nie</button></div>'
    );
    $('#dNo', c).addEventListener('click', main);
    $('#dYes', c).addEventListener('click', () => closeModal(() => {
      S.accounts = S.accounts.filter((x) => x.id !== a.id);
      if (S.lastAcc === a.id) S.lastAcc = S.accounts[0] && S.accounts[0].id;
      save(); renderAll();
    }));
  };
  main();
}

/* --- pierwsze uruchomienie: budżet startowy --- */
function openOnboarding() {
  const card = openModal(
    '<div class="ct">dodaj pierwsze konto</div>' +
    '<div class="obsub">kolejne dodasz pod ikoną karty</div>' +
    '<input class="inp" id="oName" type="text" placeholder="nazwa konta, np. mBank" aria-label="Nazwa konta" autocomplete="off">' +
    '<div class="amtrow"><input class="inp" id="oAmt" type="text" inputmode="decimal" placeholder="ile masz na koncie" aria-label="Stan konta" autocomplete="off"><span class="zl">zł</span></div>' +
    '<button class="btn in" id="oGo" style="margin-top:6px">zaczynamy</button>',
    { locked: true }
  );
  $('#oGo', card).addEventListener('click', () => {
    const v = num($('#oAmt', card).value);
    $('#oAmt', card).classList.toggle('bad', isNaN(v));
    if (isNaN(v)) return;
    const nm = $('#oName', card).value.trim() || 'główne konto';
    const a = { id: newId(), name: nm, opening: round2(v) };
    S.accounts.push(a); S.lastAcc = a.id;
    S.start = 0; S.onboarded = true; save();
    renderAccInfo();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    closeModal(() => {});
    renderRain(); renderBalance('intro');
  });
}

/* ---------- start ---------- */
window.addEventListener('resize', layoutSoon);
document.addEventListener('focusout', () => setTimeout(() => window.scrollTo(0, 0), 50));
window.addEventListener('orientationchange', layoutSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderPill(); renderFixed(); } });

el.app.classList.add('booting');
renderPill(); renderHistory(); renderFixed(); renderRain(); renderAccInfo();
layout();

// iOS przy starcie przez chwilę podaje złe wymiary ekranu – czekamy, aż się ustabilizują,
// i dopiero wtedy płynnie pokazujemy aplikację (bez przeskakiwania elementów)
function whenStable(cb) {
  let last = '', same = 0;
  const t0 = performance.now();
  const tick = () => {
    const sa = safe();
    const key = el.app.clientWidth + 'x' + el.app.clientHeight + '|' + sa.top + '|' + sa.bottom;
    if (key === last) same++; else { same = 0; last = key; layout(); }
    if (same >= 8 || performance.now() - t0 > 1000) cb(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]) : Promise.resolve();
fontsReady.then(() => whenStable(() => {
  layout();
  el.app.classList.remove('hidden');
  renderBalance('intro');
  if (!S.onboarded) openOnboarding();
}));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
