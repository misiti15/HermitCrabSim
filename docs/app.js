// Hermit Crab Sim viewer. Plays back the pre-simulated day in sync with the
// real clock (live), or any past day at any speed (replay).
const DATA = 'data/';
const DAY = 86400;
const VIS = 1.5; // crabs are drawn larger than life so they are visible in a 60 cm tank
const ACT = {
  rest: 'resting', walk: 'walking', eat: 'eating', drink: 'drinking & bathing', bask: 'basking under the lamp',
  explore: 'exploring', social: 'with the others', dig: 'digging', climb: 'climbing', shell: 'inspecting a shell',
  build: 'building', cross: 'crossing over', watch: 'watching through the glass', molt: 'molting underground',
};
const S = {
  index: null, world: null, history: [], days: new Map(), minds: new Map(),
  mode: 'live', date: null, t: 0, speed: 60, viewTank: 'home', selected: null, gloss: true,
  lastReal: performance.now(), colors: {}, headings: new Map(), stale: false,
  view: '3d', v3: null,
};
const $ = (id) => document.getElementById(id);
const canvas = $('tank');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- data ----
async function getJSON(path) {
  const r = await fetch(DATA + path + (S.index?.updatedAt ? `?v=${encodeURIComponent(S.index.updatedAt)}` : `?v=${Date.now()}`));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadDay(date) {
  if (!S.days.has(date)) S.days.set(date, getJSON(`days/${date}.json`).then(prepDay).catch(() => null));
  return S.days.get(date);
}
function prepDay(day) {
  // headings per keyframe, for drawing crabs facing where they walk
  day._head = {};
  for (const [id, kf] of Object.entries(day.tracks)) {
    const h = []; let last = Math.random() * Math.PI * 2;
    for (let i = 0; i < kf.length; i++) {
      const n = kf[i + 1];
      if (n && (Math.abs(n[1] - kf[i][1]) + Math.abs(n[2] - kf[i][2])) > 0.2 && !n[4]) last = Math.atan2(n[2] - kf[i][2], n[1] - kf[i][1]);
      h.push(last);
    }
    day._head[id] = h;
  }
  return day;
}
const todayUTC = () => new Date().toISOString().slice(0, 10);
const secsUTC = () => { const d = new Date(); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000; };

async function init() {
  try {
    S.index = await getJSON('index.json');
    [S.world, S.history] = await Promise.all([getJSON('world.json'), getJSON('history.json').catch(() => [])]);
  } catch (e) {
    $('subline').textContent = 'The simulation has not started yet. Run genesis and the first advance to populate data/.';
    return;
  }
  S.world.crabs.forEach((c, i) => { c._ci = i; });
  refreshColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { refreshColors(); renderPanels(); });

  const sel = $('daySelect');
  for (const d of [...S.index.days].reverse()) sel.append(new Option(`Day ${d.day} · ${d.date}`, d.date));
  goLive();
  wire();
  renderPanels();
  renderCrabBar();
  document.querySelectorAll('.camrow button').forEach((b) => b.onclick = () => setCam(b.dataset.cam));
  setTimeout(() => { const h = $('hint'); if (h) h.style.opacity = '0'; }, 9000);
  await start3D();
  requestAnimationFrame(frame);
  setInterval(tick, 1000);
}

function refreshColors() {
  const cs = getComputedStyle(document.documentElement);
  S.world.crabs.forEach((c, i) => { S.colors[c.id] = i < 8 ? cs.getPropertyValue(`--c${i + 1}`).trim() : cs.getPropertyValue('--ink-2').trim(); });
}

function goLive() {
  S.mode = 'live';
  const today = todayUTC();
  const have = S.index.days.map((d) => d.date);
  S.stale = !have.includes(today);
  S.date = S.stale ? have[have.length - 1] : today;
  $('liveBtn').classList.add('on');
  $('daySelect').value = S.date;
  const b = $('banner');
  b.hidden = !S.stale;
  if (S.stale) b.textContent = `The simulation hasn't been advanced past ${have[have.length - 1]}, so this is a replay of the most recent simulated day at the current time of day.`;
}
function goReplay(date, t) {
  S.mode = 'replay';
  S.date = date; S.t = t ?? S.t;
  $('liveBtn').classList.remove('on');
  $('daySelect').value = date;
  $('banner').hidden = true;
}

function wire() {
  $('liveBtn').onclick = () => { goLive(); renderPanels(); };
  $('daySelect').onchange = (e) => { goReplay(e.target.value, S.t); renderPanels(); };
  $('speedSelect').value = String(S.speed);
  $('speedSelect').onchange = (e) => { S.speed = Number(e.target.value); if (S.mode === 'live') goReplay(S.date, S.t); };
  $('scrub').oninput = (e) => { goReplay(S.date, Number(e.target.value)); };
  $('glossToggle').onchange = (e) => { S.gloss = e.target.checked; };
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== 'pane-' + b.dataset.tab; });
    if (b.dataset.tab === 'growth') renderGrowth();
  });
  canvas.addEventListener('click', onCanvasClick);
  new ResizeObserver(sizeCanvas).observe($('tankWrap'));
  sizeCanvas();
}

function sizeCanvas() {
  const w = canvas.clientWidth || 600;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * 45 / 60 * dpr);
  canvas.style.height = (w * 45 / 60) + 'px';
}

// ---------------------------------------------------------------- time ----
async function frame(now) {
  const dt = (now - S.lastReal) / 1000; S.lastReal = now;
  if (S.mode === 'live') S.t = secsUTC();
  else {
    S.t += dt * S.speed;
    if (S.t >= DAY) {
      const i = S.index.days.findIndex((d) => d.date === S.date);
      const next = S.index.days[i + 1];
      if (next) { S.date = next.date; S.t -= DAY; $('daySelect').value = S.date; } else S.t = DAY - 1;
    }
  }
  const day = await loadDay(S.date);
  if (S.view === '3d' && S.v3 && day) {
    try { S.v3.render(frameData(day)); } catch (e) { console.error(e); useMap('The 3D view hit a problem, so the map is shown instead.'); }
  } else draw(day);
  requestAnimationFrame(frame);
}

// Everything the 3D view needs for one frame.
function frameData(day) {
  const tank = S.world.tanks.find((t) => t.id === S.viewTank) ?? S.world.tanks[0];
  const off = day.tzOffsetMinutes ?? 0;
  const localHour = ((S.t / 3600 + off / 60) % 24 + 24) % 24;
  const live = S.mode === 'live';
  const crabs = [];
  for (const c of S.world.crabs) {
    const st = stateAt(day, c.id, S.t);
    if (!st || st.tank !== tank.id) continue;
    crabs.push({ c, st, color: S.colors[c.id],
      said: latest(day.speech, c.id, S.t, live ? 75 : Math.max(75, S.speed * 6)),
      thought: latest(day.thoughts, c.id, S.t, live ? 240 : Math.max(240, S.speed * 10)) });
  }
  return { world: S.world, tank, t: S.t, localHour, crabs, selected: S.selected, gloss: S.gloss };
}

async function start3D() {
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no WebGL');
    const { TankView3D } = await import('./view3d.js');
    S.v3 = new TankView3D($('view3d'), $('overlay'), { onPick: (id) => pick(id) });
  } catch (e) {
    console.warn('3D unavailable:', e);
    useMap('Your device could not start the 3D view, so the map is shown instead.');
  }
}
function useMap(msg) {
  S.view = 'map';
  $('view3d').hidden = true; $('tank').hidden = false; sizeCanvas();
  if (msg) { const b = $('banner'); b.hidden = false; b.textContent = msg; }
}
function setCam(mode) {
  if (mode === 'map') { S.view = 'map'; $('view3d').hidden = true; $('tank').hidden = false; sizeCanvas(); addMapBack(); return; }
  if ((mode === 'follow' || mode === 'eye') && !S.selected) { const first = S.world.crabs.find((c) => c.alive); S.selected = first?.id ?? null; renderColony(); }
  S.v3.userMoved = false;
  S.v3.setView(mode);
  document.querySelectorAll('.camrow button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
}
function addMapBack() {
  if ($('mapBack')) { $('mapBack').hidden = false; return; }
  const b = document.createElement('button'); b.id = 'mapBack'; b.type = 'button'; b.className = 'chip on'; b.textContent = 'Back to 3D';
  b.onclick = () => { S.view = '3d'; $('view3d').hidden = false; $('tank').hidden = true; b.hidden = true; };
  $('tankWrap').after(b);
}
function pick(id) {
  S.selected = id;
  if (id) {
    const c = S.world.crabs.find((x) => x.id === id);
    if (c && c.tank !== S.viewTank) S.viewTank = c.tank;
    if (S.v3 && S.v3.mode !== 'eye') setCam('follow');
  } else if (S.v3 && (S.v3.mode === 'follow' || S.v3.mode === 'eye')) setCam('front');
  renderColony(); renderCrabBar();
  const card = id && document.querySelector(`[data-crab="${id}"]`);
  const pane = $('pane-colony');
  if (card && pane.scrollHeight > pane.clientHeight) pane.scrollTo({ top: card.offsetTop - pane.offsetTop - 8, behavior: 'smooth' });
}
function renderCrabBar(day) {
  const el = $('crabbar');
  const living = S.world.crabs.filter((c) => c.alive);
  if (el.childElementCount !== living.length) {
    el.innerHTML = living.map((c) => `<button type="button" data-id="${c.id}"><span class="dot" style="background:${S.colors[c.id]}"></span><span class="txt"><span class="nm">${esc(c.name)}</span><span class="act" id="bar-${c.id}">…</span></span></button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.onclick = () => pick(S.selected === b.dataset.id ? null : b.dataset.id));
  }
  el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === S.selected));
  if (!day) return;
  for (const c of living) {
    const st = stateAt(day, c.id, S.t);
    const out = document.getElementById('bar-' + c.id);
    if (out && st) out.textContent = (ACT[st.act] ?? st.act) + (st.tank !== S.viewTank ? ` · in ${S.world.tanks.find((t) => t.id === st.tank)?.name}` : '');
  }
}

function tick() {
  const day = S.days.get(S.date);
  Promise.resolve(day).then((d) => {
    if (!d) return;
    const off = d.tzOffsetMinutes ?? 0;
    const local = ((S.t / 3600 + off / 60) % 24 + 24) % 24;
    $('clockText').textContent = `${d.date} · tank time ${fmtClock(local * 3600)}`;
    $('clockMode').textContent = S.mode === 'live' ? (S.stale ? 'Replay (no new data)' : 'Live') : `Replay ${S.speed}×`;
    $('liveDot').classList.toggle('off', S.mode !== 'live' || S.stale);
    $('scrub').value = String(Math.floor(S.t));
    const living = S.world.crabs.filter((c) => c.alive);
    $('subline').textContent = `Day ${d.day} of ${living.map((c) => c.name).join(', ')}${living.length > 4 ? '' : ''}. ${d.headline}`;
    updateDoing(d);
    renderCrabBar(d);
    renderFeed(d);
    renderTankTabs(d);
  });
}
const fmtClock = (s) => { s = ((s % DAY) + DAY) % DAY; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };

// where crab `id` is at time t in `day`
function stateAt(day, id, t) {
  const kf = day.tracks[id];
  if (!kf) return null;
  let lo = 0, hi = kf.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (kf[mid][0] <= t) lo = mid; else hi = mid - 1; }
  const a = kf[lo], b = kf[lo + 1];
  let tank = day.startTank?.[id] ?? 'home';
  for (let i = 0; i <= lo; i++) if (kf[i][4]) tank = kf[i][4];
  let x = a[1], y = a[2];
  let moving = false;
  if (b && !b[4] && t > a[0]) {
    const f = Math.min(1, (t - a[0]) / Math.max(1, b[0] - a[0]));
    x = a[1] + (b[1] - a[1]) * f; y = a[2] + (b[2] - a[2]) * f;
    moving = (b[1] !== a[1] || b[2] !== a[2]);
  }
  return { x, y, act: moving ? 'walk' : a[3], tank, heading: day._head[id][lo], moving };
}

// ---------------------------------------------------------------- draw ----
const sandCache = new Map();
function sandTexture(tank, w, h) {
  const key = `${tank.id}/${tank.substrate}/${w}x${h}`;
  if (sandCache.has(key)) return sandCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const base = { sand: ['#d9c7a3', '#cdb88f'], soil: ['#5a4232', '#4a3628'], wood: ['#8a6a48', '#7a5c3c'], tile: ['#bfc4c2', '#aeb4b2'] }[tank.substrate] ?? ['#d9c7a3', '#cdb88f'];
  const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, base[0]); grd.addColorStop(1, base[1]);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < (w * h) / 40; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '60,45,25' : '255,250,235'},${0.06 + rnd() * 0.1})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  // raked ripples like the real substrate
  g.strokeStyle = 'rgba(90,70,40,0.07)'; g.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) { const y0 = rnd() * h, x0 = rnd() * w; g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0 + 20, y0 - 6, x0 + 40, y0 + 6, x0 + 60, y0); g.stroke(); }
  sandCache.set(key, c);
  return c;
}

function draw(day) {
  const W = canvas.width, H = canvas.height;
  const tank = S.world.tanks.find((t) => t.id === S.viewTank) ?? S.world.tanks[0];
  const k = W / tank.w;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sandTexture(tank, W, H), 0, 0);
  if (!day) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, H); return; }
  const off = day.tzOffsetMinutes ?? 0;
  const localH = ((S.t / 3600 + off / 60) % 24 + 24) % 24;
  const lampsOn = localH >= 8 && localH < 20;
  ctx.save(); ctx.scale(k, k);

  // heat glow under lamps
  if (lampsOn) for (const o of tank.objects.filter((o) => o.kind === 'heat-lamp')) {
    const g = ctx.createRadialGradient(o.x, o.y + 6, 1, o.x, o.y + 6, 18);
    g.addColorStop(0, 'rgba(255,190,90,0.35)'); g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g; ctx.fillRect(o.x - 20, 0, 40, 30);
  }
  for (const o of tank.objects) drawObject(o, lampsOn);
  for (const p of S.world.projects.filter((p) => p.tank === tank.id && !p.done)) drawProject(p);
  for (const s of tank.shells) drawShell(s.x, s.y, s.size, s.type, 0.6, 0.85);

  // crabs
  const vis = [];
  for (const c of S.world.crabs) {
    const st = stateAt(day, c.id, S.t);
    if (!st || st.tank !== tank.id) continue;
    vis.push([c, st]);
  }
  vis.sort((a, b) => a[1].y - b[1].y);
  for (const [c, st] of vis) drawCrab(c, st, tank);
  ctx.restore();

  // night: dim with a moonlit blue; dusk/dawn partial
  const night = localH >= 21 || localH < 6 ? 1 : localH >= 20 ? localH - 20 : localH < 7 ? 7 - localH : 0;
  if (night > 0 && !lampsOn) { ctx.fillStyle = `rgba(10,20,45,${0.42 * night})`; ctx.fillRect(0, 0, W, H); }

  // labels & bubbles on top (unscaled for crisp text)
  for (const [c, st] of vis) drawLabels(day, c, st, k);
  canvas._vis = vis.map(([c, st]) => ({ id: c.id, x: st.x * k, y: st.y * k, r: Math.max(2.2, c.body.size) * VIS * k }));
}

function drawObject(o, lampsOn) {
  ctx.save();
  switch (o.kind) {
    case 'coconut-hut': {
      const g = ctx.createRadialGradient(o.x - 2, o.y - 2, 1, o.x, o.y, o.r);
      g.addColorStop(0, '#9a5a32'); g.addColorStop(1, '#5c3118');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,140,90,0.35)'; ctx.lineWidth = 0.15;
      for (let i = 0; i < 70; i++) { const a = i * 2.39, r = (i % 9) / 9 * o.r; ctx.beginPath(); ctx.moveTo(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r); ctx.lineTo(o.x + Math.cos(a + 0.3) * (r + 1.4), o.y + Math.sin(a + 0.3) * (r + 1.4)); ctx.stroke(); }
      ctx.fillStyle = '#26140a'; ctx.beginPath(); ctx.ellipse(o.x + 2, o.y + o.r - 1.2, 2.6, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'moss-path': {
      const path = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.stroke(); };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [w, col] of [[4.2, '#6b6a2a'], [3, '#8a8436'], [1.4, '#a7a04a']]) { ctx.lineWidth = w; ctx.strokeStyle = col; path(o.points); if (o.branch) path(o.branch); }
      ctx.fillStyle = 'rgba(70,80,25,0.6)';
      for (const p of [...o.points, ...(o.branch ?? [])]) for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(p[0] + Math.sin(i * 7 + p[0]) * 1.6, p[1] + Math.cos(i * 5 + p[1]) * 1.6, 0.5, 0, 7); ctx.fill(); }
      break;
    }
    case 'food-pile': {
      for (let i = 0; i < 40; i++) { const a = i * 2.4, r = Math.sqrt(i / 40) * o.r; ctx.fillStyle = i % 3 ? '#8a5a2b' : '#b07a3a'; ctx.beginPath(); ctx.arc(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r, 0.45, 0, 7); ctx.fill(); }
      break;
    }
    case 'sponge': {
      ctx.fillStyle = '#b8873e'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.85, 0.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#7d5824'; for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(o.x + Math.cos(i * 2.3) * o.r * 0.6, o.y + Math.sin(i * 2.3) * o.r * 0.5, 0.35, 0, 7); ctx.fill(); }
      break;
    }
    case 'water-dish': {
      ctx.fillStyle = o.water === 'salt' ? '#2b6c8c' : '#2f9e3e';
      roundTri(o.x, o.y, o.r); ctx.fill();
      ctx.fillStyle = o.water === 'salt' ? 'rgba(120,200,230,0.75)' : 'rgba(150,215,200,0.7)';
      roundTri(o.x, o.y + 0.3, o.r * 0.72); ctx.fill();
      break;
    }
    case 'shell-fragment': ctx.fillStyle = '#e6d7bd'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.7, 0.6, 0, 7); ctx.fill(); ctx.strokeStyle = '#b8a688'; ctx.lineWidth = 0.15; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(o.x + i * 0.5, o.y - o.r * 0.6); ctx.lineTo(o.x + i * 0.7, o.y + o.r * 0.6); ctx.stroke(); } break;
    case 'heat-lamp': {
      ctx.fillStyle = 'rgba(20,20,20,0.55)'; ctx.beginPath(); ctx.ellipse(o.x, 1.2, 6.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      if (lampsOn) { ctx.fillStyle = 'rgba(255,200,120,0.8)'; ctx.beginPath(); ctx.ellipse(o.x, 1.6, 2, 0.8, 0, 0, 7); ctx.fill(); }
      break;
    }
    case 'cord-port': if (S.world.projects.some((p) => p.type === 'moss-ladder')) { ctx.fillStyle = '#111'; ctx.fillRect(o.x - 2, 0, 4, 1.2); } break;
    case 'plant': for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#3f8a3a' : '#5fa84a'; ctx.beginPath(); ctx.ellipse(o.x + Math.cos(i * 0.7) * o.r * 0.6, o.y + Math.sin(i * 0.7) * o.r * 0.6, o.r * 0.35, o.r * 0.2, i * 0.7, 0, 7); ctx.fill(); } break;
    case 'cork-bark': ctx.fillStyle = '#5b4231'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.55, -0.3, 0, 7); ctx.fill(); ctx.strokeStyle = '#3d2b1f'; ctx.lineWidth = 0.3; ctx.stroke(); break;
    case 'rock': ctx.fillStyle = '#4b4f52'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.8, 0.4, 0, 7); ctx.fill(); break;
    case 'hide-box': ctx.fillStyle = '#e8ece9'; ctx.fillRect(o.x - o.r, o.y - o.r * 0.7, o.r * 2, o.r * 1.4); ctx.fillStyle = '#222'; ctx.fillRect(o.x - 1.2, o.y + o.r * 0.7 - 0.6, 2.4, 0.6); break;
    case 'shell-cache': for (let i = 0; i < 7; i++) drawShell(o.x + Math.cos(i) * 2, o.y + Math.sin(i * 1.3) * 1.5, 1.2, ['turbo', 'white-moon', 'babylon'][i % 3], 0.4, 1); break;
    case 'burrow-network': ctx.fillStyle = 'rgba(60,40,20,0.55)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(o.x + Math.cos(i * 1.3) * 4, o.y + Math.sin(i * 1.3) * 3, 0.9, 0, 7); ctx.fill(); } break;
    default: ctx.fillStyle = 'rgba(120,100,70,0.6)'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r ?? 3, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function roundTri(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r * 0.6); ctx.quadraticCurveTo(x, y - r * 0.85, x + r, y - r * 0.6);
  ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.9, x, y + r * 0.75); ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.9, x - r, y - r * 0.6);
  ctx.closePath();
}
function drawProject(p) {
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.5 * p.progress;
  ctx.fillStyle = '#7d7a35'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + 3 * p.progress, 0, 7); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(p.x - 4, p.y + 5, 8, 0.7);
  ctx.fillStyle = '#f2a600'; ctx.fillRect(p.x - 4, p.y + 5, 8 * p.progress, 0.7);
  ctx.restore();
}

const SHELLS = {
  turbo: { base: '#3f8f72', band: '#2c6a55', hi: '#9fd7b8' },
  babylon: { base: '#f3ece0', band: '#8b4a2b', hi: '#ffffff', spots: true },
  whelk: { base: '#c7a27a', band: '#9b7752', hi: '#ead2b4' },
  'white-moon': { base: '#f2f0ea', band: '#d8d2c4', hi: '#ffffff' },
};
function drawShell(x, y, size, type, rot = 0, alpha = 1) {
  const s = SHELLS[type] ?? SHELLS.whelk;
  const r = size * 0.62;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(0.25, 0.35, r, r * 0.85, 0, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, s.hi); g.addColorStop(1, s.base);
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, 7); ctx.fill();
  if (s.spots) { ctx.fillStyle = s.band; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(Math.cos(i * 2.1) * r * 0.55, Math.sin(i * 2.1) * r * 0.45, r * 0.16, r * 0.1, i, 0, 7); ctx.fill(); } }
  else { ctx.strokeStyle = s.band; ctx.lineWidth = r * 0.12; ctx.beginPath(); for (let a = 0; a < 9; a += 0.2) { const rr = r * 0.85 * (1 - a / 10); ctx.lineTo(Math.cos(a) * rr * 0.7 - r * 0.1, Math.sin(a) * rr * 0.6); } ctx.stroke(); }
  ctx.restore();
}

function bodyColor(hue) {
  // purple → red → orange, the range of real Coenobita
  const stops = [[123, 63, 140], [184, 64, 47], [217, 119, 43]];
  const f = Math.min(0.999, Math.max(0, hue)) * 2, i = Math.floor(f), u = f - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * u)).join(',')})`;
}

function drawCrab(c, st, tank) {
  const b = c.body, size = Math.max(0.8, b.size) * VIS;
  const t = S.t;
  ctx.save();
  ctx.translate(st.x, st.y);
  if (st.act === 'molt') {
    ctx.fillStyle = 'rgba(120,95,60,0.55)'; ctx.beginPath(); ctx.ellipse(0, 0, size * 1.1, size * 0.8, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(80,60,35,0.6)'; ctx.lineWidth = 0.2; ctx.stroke();
    ctx.restore(); return;
  }
  const hidden = st.act === 'rest' && tank.objects.some((o) => o.hide && Math.hypot(o.x - st.x, o.y - st.y) < o.r);
  ctx.globalAlpha = hidden ? 0.4 : 1;
  ctx.rotate(st.heading ?? 0);
  const col = bodyColor(b.hue);
  const walking = st.moving;
  const phase = walking ? Math.sin(t * 9 + c._ci) : 0;
  const leg = 0.9 * size * b.legLen * (1 + b.posture * 0.4);
  // legs (two walking pairs each side)
  ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = 0.22 * size;
  for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
    const bx = size * (0.15 + i * 0.18), by = side * size * 0.22;
    const sw = (i % 2 ? phase : -phase) * 0.35;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + leg * 0.35, by + side * leg * 0.55, bx + leg * (0.25 + sw * 0.4) , by + side * leg * 0.95);
    ctx.stroke();
  }
  // shell behind (or armoured abdomen if shell-free)
  if (c.shell) drawShell(-size * 0.55, 0, c.shell.size * VIS, c.shell.type, 0.4);
  else { ctx.fillStyle = col; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(-size * (0.35 + i * 0.22), 0, size * (0.35 - i * 0.05), size * (0.3 - i * 0.04), 0, 0, 7); ctx.fill(); } }
  // head / carapace (grows a little "brow" with cranium)
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(size * 0.2, 0, size * (0.32 + b.cranium * 0.08), size * (0.28 + b.cranium * 0.06), 0, 0, 7); ctx.fill();
  // claws: big left, small right (Coenobita have an enlarged left cheliped)
  const clawPhase = (st.act === 'eat' || st.act === 'build' || st.act === 'dig') ? Math.sin(t * 5 + c._ci) * 0.15 : 0;
  for (const [side, scale] of [[-1, b.clawL], [1, b.clawR]]) {
    ctx.save(); ctx.translate(size * 0.42, side * size * 0.2); ctx.rotate(side * (0.25 + clawPhase));
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(size * 0.28 * scale, 0, size * 0.3 * scale, size * 0.17 * scale, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(size * 0.32 * scale, -size * 0.05 * scale, size * 0.12 * scale, size * 0.05 * scale, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  // eyestalks + antennae
  ctx.strokeStyle = col; ctx.lineWidth = 0.1 * size;
  for (const side of [-1, 1]) {
    const ex = size * (0.45 + 0.15 * b.eyeStalk), ey = side * size * 0.12;
    ctx.beginPath(); ctx.moveTo(size * 0.38, side * size * 0.06); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex, ey, size * 0.07, 0, 7); ctx.fill();
    const flick = Math.sin(t * 3 + side + c._ci * 2) * 0.25;
    ctx.strokeStyle = 'rgba(230,140,90,0.85)'; ctx.lineWidth = 0.05 * size;
    ctx.beginPath(); ctx.moveTo(size * 0.42, side * size * 0.03);
    ctx.quadraticCurveTo(size * (0.9 + b.antenna * 0.3), side * size * (0.35 + flick), size * (1.3 + b.antenna * 0.4), side * size * (0.6 + flick));
    ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 0.1 * size;
  }
  ctx.restore();
  if (S.selected === c.id) {
    ctx.save(); ctx.strokeStyle = S.colors[c.id]; ctx.lineWidth = 0.25; ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath(); ctx.arc(st.x, st.y, size * 1.6, 0, 7); ctx.stroke(); ctx.restore();
  }
}

function drawLabels(day, c, st, k) {
  const x = st.x * k, y = st.y * k;
  const dpr = canvas.width / canvas.clientWidth;
  const fs = 11 * dpr;
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const label = c.name + (st.act === 'molt' ? ' (molting)' : '');
  const ly = y + Math.max(1.6, c.body.size) * VIS * k + 2 * dpr;
  const w = ctx.measureText(label).width + 14 * dpr;
  ctx.fillStyle = 'rgba(15,20,19,0.62)'; roundRect(x - w / 2, ly, w, fs + 6 * dpr, 4 * dpr); ctx.fill();
  ctx.fillStyle = S.colors[c.id]; ctx.beginPath(); ctx.arc(x - w / 2 + 6 * dpr, ly + (fs + 6 * dpr) / 2, 3 * dpr, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(label, x + 3 * dpr, ly + 3 * dpr);

  const win = Math.max(75, S.speed * 6) * (S.mode === 'live' ? 1 : 1);
  const said = latest(day.speech, c.id, S.t, S.mode === 'live' ? 75 : win);
  const thought = latest(day.thoughts, c.id, S.t, S.mode === 'live' ? 240 : Math.max(240, S.speed * 10));
  let top = y - Math.max(1.6, c.body.size) * VIS * k - 6 * dpr;
  if (said) top = bubble(x, top, [said.form, S.gloss && said.gloss ? said.gloss.toLowerCase() : null], false, dpr);
  if (thought && (S.selected === c.id || !said)) bubble(x, top, wrap(thought.text, 34), true, dpr);
}
function latest(list, id, t, win) {
  if (!list) return null;
  let best = null;
  for (const s of list) { if (s.t > t) break; if (s.crab === id && t - s.t < win) best = s; }
  return best;
}
function wrap(text, n) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > n) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 4);
}
function bubble(x, bottom, lines, thought, dpr) {
  lines = lines.filter(Boolean);
  if (!lines.length) return bottom;
  const fs = 11.5 * dpr, lh = fs * 1.3, pad = 6 * dpr;
  ctx.font = `${thought ? 'italic 400' : '600'} ${fs}px ${thought ? 'Inter' : "'JetBrains Mono'"}, system-ui, monospace`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lh + pad * 1.4;
  const bx = Math.max(4, Math.min(canvas.width - w - 4, x - w / 2)), by = Math.max(4, bottom - h);
  ctx.fillStyle = thought ? 'rgba(255,255,255,0.86)' : 'rgba(255,253,245,0.96)';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = dpr;
  roundRect(bx, by, w, h, (thought ? 12 : 6) * dpr); ctx.fill(); ctx.stroke();
  if (!thought) { ctx.beginPath(); ctx.moveTo(x - 5 * dpr, by + h); ctx.lineTo(x, by + h + 6 * dpr); ctx.lineTo(x + 5 * dpr, by + h); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(x, by + h + 5 * dpr, 3 * dpr, 0, 7); ctx.fill(); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.fillStyle = (!thought && i > 0) ? '#5b6663' : '#1b2321';
    if (!thought && i > 0) ctx.font = `italic 400 ${fs * 0.92}px Inter, system-ui, sans-serif`;
    ctx.fillText(l, bx + pad, by + pad * 0.7 + i * lh);
  });
  return by - 6 * dpr;
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

function onCanvasClick(e) {
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / r.width;
  const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  const hit = (canvas._vis ?? []).find((v) => Math.hypot(v.x - x, v.y - y) < v.r * 1.8 + 10 * dpr);
  S.selected = hit ? (S.selected === hit.id ? null : hit.id) : null;
  renderColony(); renderCrabBar();
}

// ---------------------------------------------------------------- panels --
function renderPanels() { renderColony(); renderJournal(); renderLanguage(); }

function renderTankTabs(day) {
  const known = S.world.tanks.filter((t) => t.discoveredDay !== null && t.discoveredDay !== undefined);
  const el = $('tankTabs');
  el.hidden = known.length < 2;
  const sig = known.map((t) => t.id).join() + S.viewTank;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig; el.innerHTML = '';
  for (const t of known) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t.crabName ? `${t.name} (“${t.crabName}”)` : t.name;
    b.className = t.id === S.viewTank ? 'on' : ''; b.onclick = () => { S.viewTank = t.id; el.dataset.sig = ''; renderTankTabs(day); };
    el.append(b);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const CAPNAMES = {
  'scent-mapping': 'Scent mapping', 'chirp-signals': 'Meaningful chirps', 'social-attention': 'Social attention', imitation: 'Imitation', naming: 'Naming', 'tool-use': 'Tool use',
  'self-name': 'Self-naming', 'two-word': 'Word pairs', teaching: 'Teaching', planning: 'Planning', cooperation: 'Cooperation', construction: 'Construction', counting: 'Counting',
  grammar: 'Grammar', 'abstract-thought': 'Abstract thought', 'escape-engineering': 'Escape engineering', storytelling: 'Storytelling', 'observer-awareness': 'Awareness of the watchers',
  ritual: 'Ritual', 'saltwater-engineering': 'Making a sea', marking: 'Sand marks', 'route-building': 'Route building', philosophy: 'Philosophy', science: 'Experiment',
};
const STAGES = [[0, 'Sensory'], [0.1, 'Associative'], [0.3, 'Social learner'], [0.6, 'Proto-linguistic'], [1.2, 'Tool & plan'], [2.5, 'Symbolic'], [5, 'Reflective'], [10, 'Philosophical'], [20, 'Uncharted']];
const stageOf = (n) => STAGES.filter((s) => n >= s[0]).pop()[1];

function renderColony() {
  const el = $('pane-colony');
  const crabs = S.world.crabs.filter((c) => c.alive);
  const gone = S.world.crabs.filter((c) => !c.alive);
  el.innerHTML = crabs.map((c) => crabCard(c)).join('') + (gone.length ? `<h2>Remembered</h2>${gone.map((c) => `<p class="muted">${esc(c.name)}, died on day ${c.diedDay}.</p>`).join('')}` : '') +
    `<p class="muted" style="font-size:.8rem">Figures are as of the end of the latest simulated day (day ${S.world.day}).</p>`;
  el.querySelectorAll('.crab-head').forEach((h) => h.onclick = () => { const id = h.parentElement.dataset.crab; pick(S.selected === id ? null : id); });
}
function crabCard(c) {
  const caps = Object.keys(c.mind.caps).filter((k) => !k.startsWith('discovery:')).map((k) => CAPNAMES[k] ?? k);
  const discoveries = Object.keys(c.mind.caps).filter((k) => k.startsWith('discovery:')).map((k) => S.world.culture.discoveries?.[Number(k.split(':')[1]) - 1]?.name).filter(Boolean);
  const named = (id) => S.world.crabs.find((x) => x.id === id)?.name ?? id;
  const rels = Object.entries(c.relations).filter(([id]) => S.world.crabs.find((x) => x.id === id)?.alive).sort((a, b) => b[1] - a[1]);
  const sex = c.sex.revealed ? (c.sex.value === 'F' ? 'Female' : 'Male') : 'Unknown';
  const molt = { none: '—', pre: 'Preparing to molt', buried: `Buried, molting (day ${c.molt.daysIn})`, post: 'Freshly molted, soft' }[c.molt.stage];
  const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></span>`;
  const selfName = c.mind.lexicon['NAME:' + c.id]?.form;
  return `<article class="crab ${S.selected === c.id ? 'sel' : ''}" data-crab="${c.id}">
    <div class="crab-head"><span class="swatch" style="background:${S.colors[c.id]}"></span><h3>${esc(c.name)}</h3>${selfName ? `<span class="cn" title="What this crab calls itself">“${esc(selfName)}”</span>` : ''}<span class="doing" id="doing-${c.id}"></span></div>
    <div><span class="pill stage">${stageOf(c.mind.neuro)} mind</span>${caps.map((k) => `<span class="pill">${esc(k)}</span>`).join('')}${discoveries.map((k) => `<span class="pill" title="An original discovery">✦ ${esc(k)}</span>`).join('')}</div>
    <div class="facts">
      <div><span>Shell</span><span>${c.shell ? `${esc(c.shell.type.replace('-', ' '))} · ${c.shell.size.toFixed(1)} cm` : 'None (armoured)'}</span></div>
      <div><span>Body size</span><span class="mono">${c.body.size.toFixed(2)} cm</span></div>
      <div><span>Sex</span><span>${sex}</span></div>
      <div><span>Molts</span><span class="mono">${c.molt.count}</span></div>
      <div><span>Molt state</span><span>${molt}</span></div>
      <div><span>Words known</span><span class="mono">${Object.keys(c.mind.lexicon).filter((k) => !k.startsWith('NAME:')).length}</span></div>
    </div>
    ${c.mind.thoughts?.length ? `<div class="thoughts">${c.mind.thoughts.slice(0, 3).map((t) => `<p>“${esc(t)}”</p>`).join('')}</div>` : ''}
    <details><summary>Temperament, body & bonds</summary>
      <div class="bars" style="margin-top:8px">
        ${bar('Boldness', c.genome.boldness)}${bar('Sociability', c.genome.sociability)}${bar('Curiosity', c.genome.curiosity)}${bar('Aggression', c.genome.aggression)}${bar('Patience', c.genome.patience)}${bar('Playfulness', c.genome.playfulness)}
        ${bar('Claw control', c.body.dexterity)}${bar('Voice range', c.body.voice)}${bar('Upright stance', c.body.posture)}${bar('Abdomen armour', c.body.armor)}${bar('Restlessness', c.mind.restlessness)}
      </div>
      <p style="font-size:.82rem;margin:8px 0 0">Closest to: ${rels.slice(0, 3).map(([id, v]) => `${esc(named(id))} <span class="muted mono">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span>`).join(', ') || '—'}</p>
      ${c.mind.memories.length ? `<p style="font-size:.82rem;margin:6px 0 0"><span class="muted">Remembers:</span> ${c.mind.memories.slice(0, 4).map((m) => esc(m.text)).join('; ')}</p>` : ''}
    </details>
  </article>`;
}
function updateDoing(day) {
  const tank = (id) => S.world.tanks.find((t) => t.id === id);
  for (const c of S.world.crabs) {
    const el = document.getElementById('doing-' + c.id);
    if (!el) continue;
    const st = stateAt(day, c.id, S.t);
    if (!st) { el.textContent = ''; continue; }
    const tk = tank(st.tank);
    const near = tk?.objects.find((o) => o.r && Math.hypot(o.x - st.x, o.y - st.y) < o.r + 1.5);
    el.textContent = `${ACT[st.act] ?? st.act}${near && !['walk', 'molt'].includes(st.act) ? ` · ${near.label.toLowerCase()}` : ''}${st.tank !== 'home' ? ` · ${tk?.name}` : ''}`;
  }
}

function renderFeed(day) {
  const el = $('feed');
  const items = [];
  const name = (id) => S.world.crabs.find((c) => c.id === id)?.name ?? id;
  for (const s of day.speech) if (s.t <= S.t) items.push({ t: s.t, html: `<span class="who" style="color:${S.colors[s.crab]}">${esc(name(s.crab))}</span><span class="what"><span class="word">“${esc(s.form)}”</span>${S.gloss && s.gloss ? ` <span class="gl">${esc(s.gloss.toLowerCase())}</span>` : ''} <span class="muted">to ${esc(name(s.to))}</span></span>` });
  for (const s of day.thoughts ?? []) if (s.t <= S.t) items.push({ t: s.t, html: `<span class="who" style="color:${S.colors[s.crab]}">${esc(name(s.crab))}</span><span class="what"><i>thinks: ${esc(s.text)}</i></span>` });
  items.sort((a, b) => b.t - a.t);
  const off = day.tzOffsetMinutes ?? 0;
  const html = items.slice(0, 30).map((i) => `<li><time>${fmtClock(i.t + off * 60)}</time>${i.html}</li>`).join('') || '<li class="muted">Nothing heard yet today. Hermit crabs are most active at night.</li>';
  if (el._last !== html) { el.innerHTML = html; el._last = html; }
}

function renderJournal() {
  const el = $('pane-journal');
  const days = [...S.index.days].reverse();
  el.innerHTML = days.map((d) => `<div class="entry" data-date="${d.date}">
    <h3>Day ${d.day} <span class="mono">${d.date}</span></h3>
    <p style="margin:4px 0 0">${esc(d.headline)}</p>
    ${d.major?.length > 1 ? `<ul>${d.major.slice(1).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    <div class="narr" hidden></div>
    <button type="button" class="chip">Field notes & thoughts</button>
    <button type="button" class="chip watch">Watch this day</button>
  </div>`).join('');
  el.querySelectorAll('.entry').forEach((en) => {
    const [notes, watch] = en.querySelectorAll('button');
    watch.onclick = () => { goReplay(en.dataset.date, 0); $('speedSelect').value = '1200'; S.speed = 1200; };
    notes.onclick = async () => {
      const box = en.querySelector('.narr');
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.textContent = 'Loading…';
      try {
        const m = await getJSON(`minds/${en.dataset.date}.json`);
        const name = (id) => S.world.crabs.find((c) => c.id === id)?.name ?? id;
        box.innerHTML = (m.journal ? `<p>${esc(m.journal)}</p>` : '<p class="muted">No observer notes for this day (written by the simple rule-based minds).</p>') +
          Object.entries(m.crabs ?? {}).map(([id, c]) => `<p><b>${esc(name(id))}:</b> <i>${(c.thoughts ?? []).map(esc).join(' · ')}</i></p>`).join('');
      } catch { box.textContent = 'No notes for this day.'; }
    };
  });
}

function renderLanguage() {
  const el = $('pane-language');
  const tally = {};
  for (const c of S.world.crabs.filter((c) => c.alive)) for (const [m, w] of Object.entries(c.mind.lexicon)) {
    if (m.startsWith('NAME:')) continue;
    (tally[m] = tally[m] || {})[w.form] = [...((tally[m] || {})[w.form] || []), c.name];
  }
  const rows = Object.entries(tally).map(([m, forms]) => { const [form, who] = Object.entries(forms).sort((a, b) => b[1].length - a[1].length)[0]; return { m, form, who, variants: Object.keys(forms).length }; })
    .sort((a, b) => b.who.length - a.who.length || a.m.localeCompare(b.m));
  const names = S.world.crabs.filter((c) => c.alive && c.mind.lexicon['NAME:' + c.id]);
  el.innerHTML = `<p class="muted" style="font-size:.88rem">Every word here was invented by one of the crabs and spread by conversation. Early "words" are stridulation patterns (clicks and rasps). Vowel sounds only appear as their bodies evolve a wider voice.</p>` +
    (names.length ? `<h2>What they call themselves</h2><p>${names.map((c) => `${esc(c.name)} → <b class="mono">${esc(c.mind.lexicon['NAME:' + c.id].form)}</b>`).join(' · ')}</p>` : '') +
    (rows.length ? `<h2>Shared vocabulary</h2><div class="tablewrap"><table><thead><tr><th>Meaning</th><th>Word</th><th>Used by</th><th>Rival forms</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.m.toLowerCase())}</td><td class="mono">${esc(r.form)}</td><td>${esc(r.who.join(', '))}</td><td class="mono">${r.variants - 1 || ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<h2>No words yet</h2><p>The crabs communicate the way real hermit crabs do: chirps, antenna touches and shell taps. Invented words, if they ever come, will appear here.</p>');
}

// growth chart: one line per crab, neuro (cognitive capacity) over days
function renderGrowth() {
  const el = $('pane-growth');
  const H = S.history;
  if (!H.length) { el.innerHTML = '<p class="muted">No history yet.</p>'; return; }
  const ids = S.world.crabs.map((c) => c.id);
  const chart = (key, label, fmt) => {
    const w = 520, h = 220, m = { l: 40, r: 14, t: 12, b: 26 };
    const xs = H.map((r) => r.day);
    const vals = H.flatMap((r) => ids.map((id) => r.crabs[id]?.[key]).filter((v) => v !== undefined));
    const x0 = Math.min(...xs), x1 = Math.max(x0 + 1, ...xs);
    const y1 = niceMax(Math.max(...vals) * 1.05 || 1);
    const X = (d) => m.l + (d - x0) / (x1 - x0) * (w - m.l - m.r);
    const Y = (v) => h - m.b - v / y1 * (h - m.t - m.b);
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label} over time" data-key="${key}">`;
    for (let i = 0; i <= 4; i++) { const v = y1 * i / 4; svg += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    svg += `<text x="${m.l}" y="${h - 6}">Day ${x0}</text><text x="${w - m.r}" y="${h - 6}" text-anchor="end">Day ${x1}</text>`;
    for (const id of ids) {
      const pts = H.filter((r) => r.crabs[id]).map((r) => `${X(r.day).toFixed(1)},${Y(r.crabs[id][key]).toFixed(1)}`);
      if (pts.length) svg += `<polyline fill="none" stroke="${S.colors[id]}" stroke-width="2" stroke-linejoin="round" points="${pts.join(' ')}"/>`;
      const last = [...H].reverse().find((r) => r.crabs[id]);
      if (last) svg += `<circle cx="${X(last.day)}" cy="${Y(last.crabs[id][key])}" r="4" fill="${S.colors[id]}" stroke="var(--surface)" stroke-width="2"/>`;
    }
    svg += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${h - m.b}" stroke="var(--ink-2)" stroke-dasharray="3 3" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${w - m.l - m.r}" height="${h - m.t - m.b}" fill="transparent" class="hit"/></svg>`;
    return { svg, X, x0, x1, m, w };
  };
  const legend = `<div class="legend">${S.world.crabs.map((c) => `<span><span class="swatch" style="background:${S.colors[c.id]}"></span>${esc(c.name)}</span>`).join('')}</div>`;
  const a = chart('n', 'Cognitive capacity', (v) => v.toFixed(v < 1 ? 2 : 1));
  const b = chart('s', 'Body size (cm)', (v) => v.toFixed(1));
  el.innerHTML = `<h2>Cognitive capacity</h2><p class="muted" style="font-size:.85rem">An internal measure of how much each mind can hold. New abilities become possible as it rises, but they still have to be found.</p>${legend}${a.svg}<h2>Body size</h2>${b.svg}
    <h2>Colony</h2><p>Shared words: <b class="mono">${S.world.culture.sharedWords}</b> · Original discoveries: <b class="mono">${S.world.culture.discoveries?.length ?? 0}</b> · Known places: <b class="mono">${S.world.tanks.filter((t) => t.discoveredDay !== null).length}</b> · Structures built: <b class="mono">${S.world.projects.filter((p) => p.done).length}</b></p>`;
  el.querySelectorAll('svg.chart').forEach((svg, i) => {
    const spec = [a, b][i], key = svg.dataset.key;
    const tip = $('tooltip'), xh = svg.querySelector('.xh');
    svg.querySelector('.hit').addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * spec.w;
      const d = Math.round(spec.x0 + (px - spec.m.l) / (spec.w - spec.m.l - spec.m.r) * (spec.x1 - spec.x0));
      const row = H.reduce((best, r2) => (Math.abs(r2.day - d) < Math.abs(best.day - d) ? r2 : best));
      xh.setAttribute('x1', spec.X(row.day)); xh.setAttribute('x2', spec.X(row.day)); xh.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 10) + 'px';
      tip.innerHTML = `<b>Day ${row.day}</b> <span class="muted">${row.date}</span><br>` + ids.filter((id) => row.crabs[id]).map((id) => `<span class="swatch" style="display:inline-block;background:${S.colors[id]}"></span> ${esc(S.world.crabs.find((c) => c.id === id).name)}: <span class="mono">${row.crabs[id][key]}</span>${key === 'n' ? ` · ${row.crabs[id].stage}` : ''}`).join('<br>');
    });
    svg.querySelector('.hit').addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); });
  });
}
function niceMax(v) { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p * 2) / 2 * p; }

init();
