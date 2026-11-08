'use strict';

/* =========================================================================
 * Podcast Studio Tycoon
 * Start with one small garage studio, rent rooms to podcasters, grow your
 * reputation, and open studios in bigger cities until you own an empire.
 * One tick = one in-game day. Balance numbers live in the tables below.
 * ========================================================================= */

const CONFIG = {
  cols: 6,
  rows: 7,
  startCash: 1000,
  maxLevel: 3,
  bankruptAt: -1000,
  // Daily reputation: +repGain × √(sessions × happiness) ÷ stars^repHardness
  //                   −repLoss × √(clients turned away)
  // Square roots and the star divisor make every star harder to earn than the last.
  repGain: 0.5,
  repHardness: 2.3,
  repLoss: 0.6,
  repPerStar: 125,          // 1★ at 0 rep, 5★ at 500 rep
  maxRep: 500,
  expandBase: 150,          // cost of the first extra floor tile (× city price)
  expandGrowth: 1.15,       // each further tile at the same studio costs 15% more
  demolishRefund: 0.5,
  saveKey: 'podcast-studio-tycoon-v1',
};

const ROOMS = {
  booth: {
    name: 'Audio Booth', short: 'Booth', icon: '🎙️', cost: 500, upkeep: 10, sessions: 3, price: 25,
    desc: 'A soundproof booth podcasters rent by the session. 3 sessions a day per level.',
  },
  video: {
    name: 'Video Studio', short: 'Video', icon: '🎥', cost: 3000, upkeep: 40, sessions: 2, price: 90, stars: 2,
    desc: 'Cameras, lights and a slick set. Big shows pay big money. 2 sessions a day per level. Needs ⭐2.',
  },
  control: {
    name: 'Control Room', short: 'Control', icon: '🎛️', cost: 800, upkeep: 15, priceBonus: 0.25,
    desc: 'Pro mixing desk. +25% session price per level for adjacent booths and video studios.',
  },
  editing: {
    name: 'Editing Suite', short: 'Editing', icon: '🎞️', cost: 1200, upkeep: 20, addon: 6,
    desc: 'Sells post-production: +$6 per level (× city price) on every session at this studio.',
  },
  lounge: {
    name: 'Green Room', short: 'Lounge', icon: '🛋️', cost: 600, upkeep: 10, comfort: 2,
    desc: 'Clients relax before recording. Happier clients build your reputation faster.',
  },
  coffee: {
    name: 'Coffee Bar', short: 'Coffee', icon: '☕', cost: 250, upkeep: 5, comfort: 1,
    desc: 'Cheap comfort: slightly happier clients and slightly faster reputation.',
  },
  reception: {
    name: 'Reception', short: 'Reception', icon: '🛎️', cost: 1000, upkeep: 15, demand: 0.3,
    desc: '+30% booking requests per level at this studio.',
  },
};

const LOCATIONS = [
  // priceMult: what clients pay there. costMult: building and upkeep costs there.
  { id: 'garage', name: 'Garage Studio', city: 'Your hometown', icon: '🏠', price: 0, stars: 1, rent: 10, demand: 4, priceMult: 1, costMult: 1, start: 2 },
  { id: 'loft', name: 'Downtown Loft', city: 'Downtown', icon: '🏙️', price: 25000, stars: 2, rent: 120, demand: 8, priceMult: 1.4, costMult: 1.5, start: 3 },
  { id: 'brooklyn', name: 'Brooklyn Warehouse', city: 'New York', icon: '🗽', price: 150000, stars: 3, rent: 400, demand: 12, priceMult: 1.9, costMult: 2.5, start: 3 },
  { id: 'hollywood', name: 'Hollywood Lot', city: 'Los Angeles', icon: '🎬', price: 1000000, stars: 3.5, rent: 1000, demand: 16, priceMult: 2.5, costMult: 4, start: 3 },
  { id: 'london', name: 'Soho Studios', city: 'London', icon: '💂', price: 4000000, stars: 4.2, rent: 2200, demand: 20, priceMult: 3.2, costMult: 6, start: 3 },
  { id: 'tokyo', name: 'Shibuya Tower', city: 'Tokyo', icon: '🗼', price: 12000000, stars: 4.8, rent: 4500, demand: 25, priceMult: 4, costMult: 9, start: 3 },
];
const locById = (id) => LOCATIONS.find((l) => l.id === id);

const EVENTS = [
  {
    weight: 3, kind: 'good', needs: (s) => countRooms(s, 'video') > 0,
    run: (s) => { const c = Math.round(800 * topPriceMult(s)); s.cash += c; s.rep += 15; return `🌟 A celebrity booked your video studio for a whole series! +$${fmt(c)} and reputation`; },
  },
  {
    weight: 3, kind: 'good',
    run: (s) => { s.rep += 20; return '🚀 A show recorded at your studio went viral. Everyone wants to book with you! +reputation'; },
  },
  {
    weight: 2, kind: 'good', needs: (s) => countRooms(s, 'booth') >= 3,
    run: (s) => { const c = Math.round(600 * topPriceMult(s)); s.cash += c; return `📚 A publisher hired your booths to record audiobooks: +$${fmt(c)}`; },
  },
  {
    weight: 2, kind: 'bad',
    run: (s) => { const c = Math.round(150 * topPriceMult(s)); s.cash -= c; return `🔌 A mixing desk blew a fuse. Repairs cost $${fmt(c)}`; },
  },
  {
    weight: 2, kind: 'bad',
    run: (s) => { s.rep -= 15; return '📢 The neighbors complained about late-night recording noise. −reputation'; },
  },
];

/* ------------------------------------------------------------------------- */
/* State                                                                     */
/* ------------------------------------------------------------------------- */

const TILE_COUNT = CONFIG.cols * CONFIG.rows;

function startTiles(n) {
  const out = [];
  const x0 = Math.floor((CONFIG.cols - n) / 2);
  for (let y = CONFIG.rows - n; y < CONFIG.rows; y++) {
    for (let x = x0; x < x0 + n; x++) out.push(y * CONFIG.cols + x);
  }
  return out;
}

function newStudio(loc) {
  const st = { tiles: Array(TILE_COUNT).fill(null), unlocked: Array(TILE_COUNT).fill(false), expansions: 0 };
  for (const i of startTiles(loc.start)) st.unlocked[i] = true;
  return st;
}

function newGame() {
  const garage = locById('garage');
  const studio = newStudio(garage);
  studio.tiles[startTiles(garage.start)[0]] = { type: 'booth', level: 1 };
  return {
    cash: CONFIG.startCash,
    rep: 0,
    day: 1,
    studios: { garage: studio },
    current: 'garage',
    speed: 1,
    seenIntro: false,
    won: false,
    over: false,
    totalSessions: 0,
  };
}

let state = load() || newGame();
let tool = null;      // room key, 'demolish', or null (inspect)
let selected = -1;    // tile index shown in the inspect sheet
let lastStats = null;

function save() {
  try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.studios || !s.studios.garage) return null;
    return { ...newGame(), ...s };
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Simulation                                                                */
/* ------------------------------------------------------------------------- */

const stars = (s) => Math.min(5, 1 + s.rep / CONFIG.repPerStar);
const maxLevelOf = () => CONFIG.maxLevel;
const owned = (s) => LOCATIONS.filter((l) => s.studios[l.id]);
const topPriceMult = (s) => Math.max(...owned(s).map((l) => l.priceMult));

function countRooms(s, type) {
  let n = 0;
  for (const st of Object.values(s.studios)) for (const t of st.tiles) if (t && t.type === type) n++;
  return n;
}

function neighbors(i) {
  const { cols, rows } = CONFIG;
  const x = i % cols, y = Math.floor(i / cols);
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < cols - 1) out.push(i + 1);
  if (y > 0) out.push(i - cols);
  if (y < rows - 1) out.push(i + cols);
  return out;
}

function priceBonus(studio, i) {
  let b = 0;
  for (const n of neighbors(i)) {
    const t = studio.tiles[n];
    if (t && ROOMS[t.type].priceBonus) b += ROOMS[t.type].priceBonus * t.level;
  }
  return b;
}

/** Everything that happens at one studio in one day. */
function computeStudio(s, loc) {
  const studio = s.studios[loc.id];
  const st = stars(s);
  let upkeep = loc.rent, comfort = 0, demandBonus = 0, addon = 0;
  const recording = [];

  studio.tiles.forEach((t, i) => {
    if (!t) return;
    const def = ROOMS[t.type];
    upkeep += def.upkeep * t.level * loc.costMult;
    if (def.comfort) comfort += def.comfort * t.level;
    if (def.demand) demandBonus += def.demand * t.level;
    if (def.addon) addon += def.addon * t.level * loc.priceMult;
    if (def.sessions) recording.push(i);
  });

  const demand = Math.round(loc.demand * (1 + demandBonus) * (0.5 + 0.5 * st));
  const starPrice = 1 + 0.1 * (st - 1);

  // Fill the most expensive rooms first.
  const rooms = recording.map((i) => {
    const t = studio.tiles[i];
    const def = ROOMS[t.type];
    return { i, cap: def.sessions * t.level, price: def.price * loc.priceMult * (1 + priceBonus(studio, i)) * starPrice + addon };
  }).sort((a, b) => b.price - a.price);

  let left = demand, sessions = 0, revenue = 0, capacity = 0;
  const perRoom = {};
  for (const r of rooms) {
    capacity += r.cap;
    const n = Math.min(r.cap, left);
    left -= n;
    sessions += n;
    revenue += n * r.price;
    perRoom[r.i] = { sessions: n, cap: r.cap, price: r.price };
  }

  const satisfaction = Math.min(2, 1 + 0.15 * comfort);
  const turnedAway = Math.max(0, demand - capacity);
  return { demand, capacity, sessions, turnedAway, revenue, upkeep, satisfaction, perRoom, addon };
}

function computeAll(s) {
  const per = {};
  const total = { demand: 0, sessions: 0, turnedAway: 0, revenue: 0, upkeep: 0, happySessions: 0 };
  for (const loc of owned(s)) {
    const r = computeStudio(s, loc);
    per[loc.id] = r;
    total.demand += r.demand;
    total.sessions += r.sessions;
    total.turnedAway += r.turnedAway;
    total.revenue += r.revenue;
    total.upkeep += r.upkeep;
    total.happySessions += r.sessions * r.satisfaction;
  }
  total.profit = total.revenue - total.upkeep;
  total.repDelta = CONFIG.repGain * Math.sqrt(total.happySessions) / Math.pow(stars(s), CONFIG.repHardness)
    - CONFIG.repLoss * Math.sqrt(total.turnedAway);
  return { per, total };
}

function pickEvent(s) {
  const pool = EVENTS.filter((e) => !e.needs || e.needs(s));
  let r = Math.random() * pool.reduce((a, e) => a + e.weight, 0);
  for (const e of pool) { r -= e.weight; if (r <= 0) return e; }
  return pool[pool.length - 1];
}

/** Advance one day. */
function tick() {
  if (state.over) return;
  const s = state;
  const before = stars(s);
  const { per, total } = computeAll(s);

  s.cash += total.profit;
  s.rep = clampRep(s.rep + total.repDelta);
  s.totalSessions += total.sessions;
  s.day += 1;

  if (s.day > 8 && Math.random() < 1 / 20) {
    const e = pickEvent(s);
    toast(e.run(s), e.kind);
    s.rep = clampRep(s.rep);
  }

  const after = stars(s);
  if (Math.floor(after) > Math.floor(before)) toast(`⭐ Your studios are now rated ${Math.floor(after)} stars! More bookings and higher prices.`, 'good');
  if (Math.floor(after) < Math.floor(before)) toast(`⭐ Your rating dropped to ${Math.floor(after)} stars. Turned-away clients hurt your reputation.`, 'bad');

  if (s.cash < CONFIG.bankruptAt) {
    s.over = true;
    setSpeed(0);
    showBankrupt();
  }

  if (s.day % 5 === 0) save();
  showDayFloats(per[s.current]);
  render();
}

const clampRep = (r) => Math.max(0, Math.min(CONFIG.maxRep, r));

/* ------------------------------------------------------------------------- */
/* Player actions                                                            */
/* ------------------------------------------------------------------------- */

const studioHere = () => state.studios[state.current];
const locHere = () => locById(state.current);

/** Building cost of a room at the studio you're looking at. */
function roomCost(type) {
  return Math.round(ROOMS[type].cost * locHere().costMult);
}

function upgradeCost(t) {
  return Math.round(roomCost(t.type) * 1.5 * t.level);
}

function expandCost(locId) {
  const loc = locById(locId);
  return Math.round(CONFIG.expandBase * loc.costMult * Math.pow(CONFIG.expandGrowth, state.studios[locId].expansions));
}

function isBuyable(studio, i) {
  return !studio.unlocked[i] && neighbors(i).some((n) => studio.unlocked[n]);
}

function build(i, type) {
  const def = ROOMS[type];
  const studio = studioHere();
  if (studio.tiles[i] || !studio.unlocked[i]) return;
  if (def.stars && stars(state) < def.stars) { toast(`${def.name} needs a ⭐${def.stars} reputation.`, 'bad'); return; }
  const cost = roomCost(type);
  if (state.cash < cost) { toast(`Not enough cash for ${def.name} ($${fmt(cost)})`, 'bad'); return; }
  state.cash -= cost;
  studio.tiles[i] = { type, level: 1 };
  floatText(i, `−$${fmt(cost)}`);
  save();
  render(i);
}

function expand(i) {
  const studio = studioHere();
  if (!isBuyable(studio, i)) return;
  const cost = expandCost(state.current);
  if (state.cash < cost) return;
  state.cash -= cost;
  studio.unlocked[i] = true;
  studio.expansions += 1;
  floatText(i, `−$${fmt(cost)}`);
  save();
  render(i);
}

function upgrade(i) {
  const t = studioHere().tiles[i];
  if (!t || t.level >= maxLevelOf(t.type)) return;
  const cost = upgradeCost(t);
  if (state.cash < cost) return;
  state.cash -= cost;
  t.level += 1;
  floatText(i, `⬆ Lv ${t.level}`);
  save();
  render(i);
}

function demolish(i) {
  const studio = studioHere();
  const t = studio.tiles[i];
  if (!t) return;
  const refund = Math.round(roomCost(t.type) * CONFIG.demolishRefund);
  state.cash += refund;
  studio.tiles[i] = null;
  floatText(i, `+$${fmt(refund)}`);
  save();
  render();
}

function buyLocation(id) {
  const loc = locById(id);
  if (state.studios[id] || state.cash < loc.price || stars(state) < loc.stars) return;
  state.cash -= loc.price;
  state.studios[id] = newStudio(loc);
  state.current = id;
  tool = null;
  toast(`${loc.icon} You opened ${loc.name} in ${loc.city}! Build some booths to start taking bookings.`, 'good');
  if (owned(state).length === LOCATIONS.length && !state.won) {
    state.won = true;
    save();
    showWin();
    return;
  }
  save();
  closeSheet();
}

/* ------------------------------------------------------------------------- */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const toolbarEl = $('toolbar');
const tabsEl = $('locations');
const sheetEl = $('sheet');
const backdropEl = $('sheet-backdrop');

function fmt(n) {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return sign + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
  return sign + Math.round(a).toLocaleString('en-US');
}

function buildBoard() {
  boardEl.innerHTML = '';
  for (let i = 0; i < TILE_COUNT; i++) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.addEventListener('click', () => onTile(i));
    boardEl.appendChild(b);
  }
}

function buildToolbar() {
  toolbarEl.innerHTML = '';
  const entries = Object.entries(ROOMS).map(([k, d]) => ({ key: k, icon: d.icon, name: d.short, cost: d.cost }));
  entries.push({ key: 'demolish', icon: '🚧', name: 'Demolish', cost: null });
  for (const e of entries) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = e.key;
    b.innerHTML = `<span class="ico">${e.icon}</span><span class="nm">${e.name}</span><span class="cost"></span>`;
    b.addEventListener('click', () => {
      const def = ROOMS[e.key];
      if (def && def.stars && stars(state) < def.stars) {
        toast(`${def.name} unlocks at ⭐${def.stars}. Serve more clients to raise your rating.`);
        return;
      }
      tool = tool === e.key ? null : e.key;
      render();
    });
    toolbarEl.appendChild(b);
  }
}

function buildTabs() {
  tabsEl.innerHTML = '';
  for (const loc of LOCATIONS) {
    const b = document.createElement('button');
    b.className = 'loc';
    b.dataset.loc = loc.id;
    b.addEventListener('click', () => onLocation(loc.id));
    tabsEl.appendChild(b);
  }
}

function render(popIndex = -1) {
  const s = state;
  const all = computeAll(s);
  lastStats = all;
  const here = all.per[s.current];
  const studio = studioHere();
  const st = stars(s);

  // HUD
  $('cash').textContent = '$' + fmt(s.cash);
  $('cash').classList.toggle('neg', s.cash < 0);
  const p = $('profit');
  p.textContent = `${all.total.profit >= 0 ? '+' : ''}${fmt(all.total.profit)}/day`;
  p.className = all.total.profit >= 0 ? 'pos' : 'neg';
  $('stars').textContent = st.toFixed(1);
  $('stars-fill').style.width = `${((st - 1) / 4) * 100}%`;
  $('bookings').textContent = `${fmt(all.total.sessions)}/${fmt(all.total.demand)}`;
  $('stat-bookings').classList.toggle('warn', all.total.turnedAway > 0);
  $('day').textContent = s.day;
  $('owned').textContent = `${owned(s).length}/${LOCATIONS.length}`;
  document.querySelectorAll('.speed button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s.speed));

  const next = LOCATIONS.find((l) => !s.studios[l.id]);
  $('goal').innerHTML = next
    ? `Next: ${next.icon} <b>$${fmt(next.price)}</b> + ⭐${next.stars}`
    : '<b>👑 Studio Empire!</b>';

  // Location tabs
  tabsEl.querySelectorAll('.loc').forEach((b) => {
    const loc = locById(b.dataset.loc);
    const has = !!s.studios[loc.id];
    const affordable = !has && s.cash >= loc.price && st >= loc.stars;
    b.className = `loc${loc.id === s.current ? ' active' : ''}${has ? '' : ' locked'}${affordable ? ' ready' : ''}`;
    b.innerHTML = has ? `${loc.icon} ${loc.name}` : `🔒 ${loc.icon} $${fmt(loc.price)}`;
  });

  // Board
  const loc = locHere();
  const expandPrice = expandCost(s.current);
  boardEl.children.length && Array.from(boardEl.children).forEach((el, i) => {
    const t = studio.tiles[i];
    el.className = 'tile';
    el.innerHTML = '';
    if (!studio.unlocked[i]) {
      el.classList.add('locked');
      if (isBuyable(studio, i)) {
        el.classList.add('buyable');
        el.innerHTML = `<span class="plus">＋</span><span class="price">$${fmt(expandPrice)}</span>`;
        el.setAttribute('aria-label', `Expand here for $${expandPrice}`);
      } else {
        el.setAttribute('aria-label', 'Neighboring property');
      }
    } else if (t) {
      const def = ROOMS[t.type];
      el.classList.add('built', t.type);
      const room = here.perRoom[i];
      const onAir = room && room.sessions > 0;
      if (def.sessions && onAir) el.classList.add('onair');
      if (def.sessions && !onAir) el.classList.add('idle');
      el.innerHTML = `${def.icon}${onAir ? '<span class="badge">🔴</span>' : ''}<span class="lvl">${'★'.repeat(t.level)}</span>`;
      el.setAttribute('aria-label', `${def.name} level ${t.level}`);
    } else {
      el.classList.add('floor');
      el.setAttribute('aria-label', 'Empty floor space');
    }
    if (tool && tool !== 'demolish' && studio.unlocked[i] && !t) el.classList.add('can-place');
    if (tool === 'demolish' && t) el.classList.add('can-demolish');
    if (i === selected) el.classList.add('selected');
    if (i === popIndex) el.classList.add('pop');
  });
  $('studio-name').textContent = `${loc.icon} ${loc.name}`;
  $('studio-stats').textContent = `📋 ${here.sessions}/${here.demand} booked · 💵 $${fmt(here.revenue - here.upkeep)}/day`;

  // Toolbar
  toolbarEl.querySelectorAll('.tool').forEach((b) => {
    const k = b.dataset.tool;
    const def = ROOMS[k];
    b.classList.toggle('active', k === tool);
    const locked = def && def.stars && st < def.stars;
    b.classList.toggle('locked', !!locked);
    b.classList.toggle('unaffordable', !!def && !locked && s.cash < roomCost(k));
    b.querySelector('.cost').textContent = !def ? '50% back' : locked ? `🔒 ⭐${def.stars}` : `$${fmt(roomCost(k))}`;
  });

  // Hint
  let hint;
  const free = studio.tiles.some((t, i) => !t && studio.unlocked[i]);
  if (tool === 'demolish') hint = 'Tap a room to demolish it (50% refund).';
  else if (tool) hint = `Tap empty floor to build: ${ROOMS[tool].desc}`;
  else if (here.capacity === 0) hint = 'No rooms yet! Pick 🎙️ Booth below, then tap the floor.';
  else if (here.turnedAway > 0 && !free) hint = `⚠️ Turning away ${here.turnedAway} client${here.turnedAway === 1 ? "" : "s"}/day and no floor left. Tap a ＋ tile to expand.`;
  else if (here.turnedAway > 0) hint = `⚠️ Turning away ${here.turnedAway} client${here.turnedAway === 1 ? "" : "s"}/day! Build more booths.`;
  else if (here.capacity > here.sessions * 1.5 && here.capacity - here.sessions >= 3) hint = 'Rooms sitting empty. A 🛎️ Reception brings more bookings.';
  else hint = 'Tap a room to inspect or upgrade it.';
  $('hint').textContent = hint;

  if (!sheetEl.classList.contains('hidden') && selected >= 0) renderInspect(selected, here);
}

/* ------------------------------------------------------------------------- */
/* Interaction                                                               */
/* ------------------------------------------------------------------------- */

function onTile(i) {
  if (state.over) return;
  const studio = studioHere();
  const t = studio.tiles[i];
  if (!studio.unlocked[i]) {
    if (isBuyable(studio, i)) showExpand(i);
    else toast('Expand next to your existing floor space first.');
    return;
  }
  if (tool === 'demolish') { if (t) demolish(i); return; }
  if (t) { openInspect(i); return; }
  if (tool) { build(i, tool); return; }
  toast('Pick a room to build from the menu below 👇');
}

function onLocation(id) {
  if (state.studios[id]) {
    state.current = id;
    tool = null;
    save();
    render();
  } else {
    showLocation(id);
  }
}

function openSheet(html) {
  sheetEl.innerHTML = html;
  sheetEl.classList.remove('hidden');
  backdropEl.classList.remove('hidden');
}

function closeSheet() {
  sheetEl.classList.add('hidden');
  backdropEl.classList.add('hidden');
  selected = -1;
  render();
}

function openInspect(i) {
  selected = i;
  sheetEl.classList.remove('hidden');
  backdropEl.classList.remove('hidden');
  render();
}

function renderInspect(i, here) {
  const t = studioHere().tiles[i];
  if (!t) { closeSheet(); return; }
  const def = ROOMS[t.type];
  const loc = locHere();
  const rows = [['Level', `${t.level} / ${maxLevelOf(t.type)}`], ['Upkeep', `$${fmt(def.upkeep * t.level * loc.costMult)}/day`]];
  const room = here.perRoom[i];
  if (room) {
    rows.push(['Booked today', `${room.sessions} / ${room.cap} sessions`]);
    rows.push(['Price per session', `$${fmt(room.price)}`]);
    rows.push(['Earning', `$${fmt(room.sessions * room.price)}/day`]);
  }
  if (def.priceBonus) rows.push(['Price boost', `+${Math.round(def.priceBonus * t.level * 100)}% to neighbors`]);
  if (def.addon) rows.push(['Post-production', `+$${fmt(def.addon * t.level * loc.priceMult)}/session`]);
  if (def.comfort) rows.push(['Client happiness', `+${Math.round(0.15 * def.comfort * t.level * 100)}%`]);
  if (def.demand) rows.push(['Extra bookings', `+${Math.round(def.demand * t.level * 100)}%`]);

  const canUp = t.level < maxLevelOf(t.type);
  const upCost = canUp ? upgradeCost(t) : 0;
  const refund = Math.round(roomCost(t.type) * CONFIG.demolishRefund);

  sheetEl.innerHTML = `
    <h2>${def.icon} ${def.name}</h2>
    <p>${def.desc}</p>
    <div class="rows">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>
    <div class="btns">
      ${canUp ? `<button class="btn primary" data-act="upgrade" ${state.cash < upCost ? 'disabled' : ''}>⬆ Upgrade $${fmt(upCost)}</button>` : ''}
      <button class="btn danger" data-act="demolish">🚧 Demolish +$${fmt(refund)}</button>
      <button class="btn" data-act="close">Close</button>
    </div>`;
}

function showExpand(i) {
  selected = -1;
  const cost = expandCost(state.current);
  openSheet(`
    <h2>🧱 Expand your studio</h2>
    <p>Knock through the wall and lease this space for <b>$${fmt(cost)}</b>. Each expansion at this studio costs a bit more than the last.</p>
    <div class="btns">
      <button class="btn primary" data-act="expand" data-i="${i}" ${state.cash < cost ? 'disabled' : ''}>Expand $${fmt(cost)}</button>
      <button class="btn" data-act="close">Cancel</button>
    </div>`);
}

function showLocation(id) {
  selected = -1;
  const loc = locById(id);
  const st = stars(state);
  const okStars = st >= loc.stars, okCash = state.cash >= loc.price;
  openSheet(`
    <h2>${loc.icon} ${loc.name}</h2>
    <p>Open a new studio in <b>${loc.city}</b>.</p>
    <div class="rows">
      <span>Price</span><span class="${okCash ? 'ok' : 'no'}">$${fmt(loc.price)}</span>
      <span>Rating needed</span><span class="${okStars ? 'ok' : 'no'}">⭐${loc.stars} (you: ${st.toFixed(1)})</span>
      <span>Rent</span><span>$${fmt(loc.rent)}/day</span>
      <span>Client demand</span><span>${loc.demand} bookings/day base</span>
      <span>Session prices</span><span>×${loc.priceMult}</span>
      <span>Building costs</span><span>×${loc.costMult}</span>
      <span>Starting space</span><span>${loc.start}×${loc.start}</span>
    </div>
    <div class="btns">
      <button class="btn primary" data-act="buyloc" data-loc="${id}" ${okStars && okCash ? '' : 'disabled'}>Open studio</button>
      <button class="btn" data-act="close">Not yet</button>
    </div>`);
}

sheetEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  if (act === 'upgrade') upgrade(selected);
  else if (act === 'demolish') { demolish(selected); closeSheet(); }
  else if (act === 'expand') { expand(Number(btn.dataset.i)); closeSheet(); }
  else if (act === 'buyloc') buyLocation(btn.dataset.loc);
  else if (act === 'close') closeSheet();
  else if (act === 'restart') restart();
  else if (act === 'help') showIntro();
  else if (act === 'dismiss') dismissIntro();
});
backdropEl.addEventListener('click', () => {
  if (state.over) return;
  if (!state.seenIntro) { dismissIntro(); return; }
  closeSheet();
});

/** The clock stays paused until the player has read the welcome screen. */
function dismissIntro() {
  const first = !state.seenIntro;
  state.seenIntro = true;
  save();
  closeSheet();
  if (first) setSpeed(1);
}

document.querySelectorAll('.speed button').forEach((b) => {
  b.addEventListener('click', () => { if (!state.over) setSpeed(Number(b.dataset.speed)); });
});
$('menu-btn').addEventListener('click', showMenu);

function showMenu() {
  selected = -1;
  const list = LOCATIONS.map((l) => `<li class="${state.studios[l.id] ? 'done' : ''}">${state.studios[l.id] ? '✅' : '⬜'} ${l.icon} ${l.name}, ${l.city} ($${fmt(l.price)}, ⭐${l.stars})</li>`).join('');
  openSheet(`
    <h2>🎙️ Your Studio Empire</h2>
    <p>Day ${state.day} · ${fmt(state.totalSessions)} sessions recorded so far.</p>
    <ul class="checklist">${list}</ul>
    <div class="btns">
      <button class="btn" data-act="help">❓ How to play</button>
      <button class="btn danger" data-act="restart">🔄 New game</button>
      <button class="btn" data-act="close">Close</button>
    </div>`);
}

function showIntro() {
  selected = -1;
  openSheet(`
    <h2>🎙️ Podcast Studio Tycoon</h2>
    <p>You've got one booth in a garage. Podcasters pay to record in your rooms. Turn it into a <b>studio empire</b> with locations around the world.</p>
    <ul>
      <li>🎙️ <b>Booths</b> and 🎥 <b>Video Studios</b> are rented by the session. More rooms means more bookings.</li>
      <li>🎛️ <b>Control Rooms</b> raise the price of rooms <b>next to them</b>, so layout matters.</li>
      <li>🛋️☕ <b>Comfort</b> keeps clients happy and builds your ⭐ rating faster.</li>
      <li>🛎️ <b>Reception</b> brings more clients. 🎞️ <b>Editing</b> adds post-production money to every session.</li>
      <li>⭐ A higher rating brings more clients and higher prices. Turning clients away hurts it.</li>
      <li>🧱 Tap a <b>＋</b> tile to expand your floor space.</li>
      <li>🌍 Open studios in new cities from the tabs above the map. Own all ${LOCATIONS.length} to win.</li>
      <li>Rent and upkeep are paid daily. Don't let cash drop below −$1,000!</li>
    </ul>
    <div class="btns"><button class="btn primary" data-act="dismiss">Open the doors!</button></div>`);
}

function showWin() {
  setSpeed(0);
  openSheet(`
    <h2>👑 Studio Empire!</h2>
    <p>On day ${state.day} you own podcast studios in every city, from a garage to Tokyo. ${fmt(state.totalSessions)} sessions recorded!</p>
    <div class="btns">
      <button class="btn primary" data-act="close">Keep building</button>
      <button class="btn" data-act="restart">New game</button>
    </div>`);
}

function showBankrupt() {
  openSheet(`
    <h2>💸 Bankrupt!</h2>
    <p>Your cash fell below −$${fmt(-CONFIG.bankruptAt)} on day ${state.day}, and the landlord changed the locks.</p>
    <p>Tip: watch the profit per day under your cash. Rooms with no bookings still cost upkeep, and new cities charge high rent.</p>
    <div class="btns"><button class="btn primary" data-act="restart">Try again</button></div>`);
}

function restart() {
  state = newGame();
  state.seenIntro = true;
  tool = null;
  save();
  closeSheet();
  setSpeed(1);
}

/* ------------------------------------------------------------------------- */
/* Feedback: toasts and floating text                                        */
/* ------------------------------------------------------------------------- */

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  const box = $('toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 2800);
  setTimeout(() => el.remove(), 3300);
}

function floatText(i, text) {
  const tileEl = boardEl.children[i];
  if (!tileEl) return;
  const r = tileEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/** Show a couple of "+$" pops over busy rooms so the studio feels alive. */
function showDayFloats(here) {
  if (!here || !sheetEl.classList.contains('hidden') || state.speed > 1) return;
  const busy = Object.entries(here.perRoom).filter(([, r]) => r.sessions > 0);
  for (let k = 0; k < Math.min(2, busy.length); k++) {
    const [i, r] = busy[Math.floor(Math.random() * busy.length)];
    floatText(Number(i), `+$${fmt(r.sessions * r.price)}`);
  }
}

/* ------------------------------------------------------------------------- */
/* Game loop                                                                 */
/* ------------------------------------------------------------------------- */

let loopId = null;
function setSpeed(speed) {
  state.speed = speed;
  if (loopId) clearInterval(loopId);
  loopId = speed > 0 ? setInterval(tick, 1000 / speed) : null;
  render();
}

// Pause when the app is backgrounded so you don't come back bankrupt.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); if (loopId) clearInterval(loopId); loopId = null; }
  else if (!state.over) setSpeed(state.speed);
});

buildBoard();
buildToolbar();
buildTabs();
setSpeed(state.over || state.won || !state.seenIntro ? 0 : state.speed);
if (!state.seenIntro) showIntro();
if (state.over) showBankrupt();
