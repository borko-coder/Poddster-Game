'use strict';

/* =========================================================================
 * Podcast Tycoon — build a podcast empire on a city grid.
 * One tick = one in-game day. All tuning numbers live in CONFIG / BUILDINGS.
 * ========================================================================= */

const CONFIG = {
  cols: 6,
  rows: 8,
  startCash: 2500,
  baseCapacity: 1000,        // listeners you can host before buying servers
  baseGrowthPerStudio: 15,   // new listeners/day from a level-1 studio
  churn: 0.01,               // fraction of listeners lost each day
  revenuePerListener: 0.02,  // $ per listener per day before ad bonuses
  trendMultiplier: 2,
  trendEveryDays: 30,
  rebrandCost: 150,
  demolishRefund: 0.5,
  maxLevel: 3,
  bankruptAt: -1000,
  saveKey: 'podcast-tycoon-save-v1',
};

const GENRES = [
  { id: 'crime', name: 'True Crime', icon: '🕵️' },
  { id: 'comedy', name: 'Comedy', icon: '😂' },
  { id: 'tech', name: 'Tech', icon: '💻' },
  { id: 'sports', name: 'Sports', icon: '⚽' },
  { id: 'wellness', name: 'Wellness', icon: '🧘' },
  { id: 'history', name: 'History', icon: '📜' },
];
const genreById = (id) => GENRES.find((g) => g.id === id);

const BUILDINGS = {
  studio: {
    name: 'Studio', icon: '🎙️', cost: 500, upkeep: 6, staff: 2,
    desc: 'Records shows that attract listeners. Nearby Editing Suites, Cafés and Parks boost quality. Shows in the trending genre grow 2× faster.',
  },
  apartment: {
    name: 'Apartments', icon: '🏢', cost: 300, upkeep: 2, staff: 0, housing: 4,
    desc: 'Houses 4 staff per level (+1 for each adjacent Park). Buildings without enough staff run slower.',
  },
  server: {
    name: 'Servers', icon: '🖥️', cost: 450, upkeep: 5, staff: 1, capacity: 2500,
    desc: 'Hosting bandwidth: +2,500 listener capacity per level. Hit the cap and growth stops.',
  },
  editing: {
    name: 'Editing', icon: '🎚️', cost: 600, upkeep: 4, staff: 1, studioBonus: 0.3,
    desc: '+30% quality per level to adjacent Studios.',
  },
  cafe: {
    name: 'Café', icon: '☕', cost: 250, upkeep: 2, staff: 1, studioBonus: 0.15,
    desc: '+15% quality per level to adjacent Studios. Caffeinated hosts are better hosts.',
  },
  ads: {
    name: 'Ad Sales', icon: '💼', cost: 900, upkeep: 6, staff: 2, adBonus: 0.25,
    desc: '+25% revenue per listener per level, across your whole network.',
  },
  billboard: {
    name: 'Billboard', icon: '📣', cost: 700, upkeep: 4, staff: 0, marketing: 0.1,
    desc: '+10% listener growth per level for every Studio.',
  },
  park: {
    name: 'Park', icon: '🌳', cost: 120, upkeep: 0, staff: 0, studioBonus: 0.1,
    desc: '+10% quality to adjacent Studios and +1 housing to adjacent Apartments. Never needs upgrading.',
    maxLevel: 1,
  },
};

const MILESTONES = [
  { listeners: 1000, reward: 500, title: 'Garage Podcaster' },
  { listeners: 5000, reward: 1500, title: 'Local Favorite' },
  { listeners: 25000, reward: 5000, title: 'Chart Climber' },
  { listeners: 100000, reward: 15000, title: 'Top 100 Network' },
  { listeners: 500000, reward: 50000, title: 'Media Empire' },
  { listeners: 1000000, reward: 0, title: 'Podcast Mogul 👑' },
];

const EVENTS = [
  {
    weight: 3, kind: 'good',
    run: (s) => { const gain = Math.round(s.listeners * 0.2) + 200; s.listeners += gain; return `🚀 An episode went viral! +${fmt(gain)} listeners`; },
  },
  {
    weight: 2, kind: 'good',
    run: (s) => { const cash = 300 + Math.round(s.listeners * 0.05); s.cash += cash; return `🤝 A sponsor signed a deal: +$${fmt(cash)}`; },
  },
  {
    weight: 2, kind: 'bad', needsStudio: true,
    run: (s) => { s.cash -= 200; return '🎤 A microphone broke mid-recording. Repairs cost $200'; },
  },
  {
    weight: 2, kind: 'bad',
    run: (s) => { const loss = Math.round(s.listeners * 0.1); s.listeners -= loss; return `😬 Host drama on social media. −${fmt(loss)} listeners`; },
  },
  {
    weight: 1, kind: 'good', needsStudio: true,
    run: (s) => { s.cash += 1000; return '🏆 Your network won a podcast award! +$1,000 prize'; },
  },
];

/* ------------------------------------------------------------------------- */
/* State                                                                     */
/* ------------------------------------------------------------------------- */

function newGame() {
  return {
    cash: CONFIG.startCash,
    listeners: 0,
    day: 1,
    tiles: Array(CONFIG.cols * CONFIG.rows).fill(null),
    trending: GENRES[Math.floor(Math.random() * GENRES.length)].id,
    milestones: 0,
    speed: 1,
    seenIntro: false,
    over: false,
  };
}

let state = load() || newGame();
let tool = null;      // building key, 'demolish', or null (inspect)
let selected = -1;    // tile index shown in the inspect sheet

function save() {
  try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tiles) || s.tiles.length !== CONFIG.cols * CONFIG.rows) return null;
    return { ...newGame(), ...s };
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Simulation                                                                */
/* ------------------------------------------------------------------------- */

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

function maxLevelOf(type) {
  return BUILDINGS[type].maxLevel || CONFIG.maxLevel;
}

function studioQuality(s, i) {
  let q = 1;
  for (const n of neighbors(i)) {
    const t = s.tiles[n];
    if (t && BUILDINGS[t.type].studioBonus) q += BUILDINGS[t.type].studioBonus * t.level;
  }
  return q;
}

function apartmentHousing(s, i) {
  const t = s.tiles[i];
  const parks = neighbors(i).filter((n) => s.tiles[n] && s.tiles[n].type === 'park').length;
  return BUILDINGS.apartment.housing * t.level + parks;
}

/** Derive every network-wide number from the current map. */
function computeStats(s) {
  let housing = 0, demand = 0, upkeep = 0;
  let capacity = CONFIG.baseCapacity, adMult = 1, marketing = 1;
  const studios = [];

  s.tiles.forEach((t, i) => {
    if (!t) return;
    const def = BUILDINGS[t.type];
    upkeep += def.upkeep * t.level;
    demand += def.staff * t.level;
    if (def.housing) housing += apartmentHousing(s, i);
    if (def.capacity) capacity += def.capacity * t.level;
    if (def.adBonus) adMult += def.adBonus * t.level;
    if (def.marketing) marketing += def.marketing * t.level;
    if (t.type === 'studio') studios.push(i);
  });

  const efficiency = demand === 0 ? 1 : Math.min(1, housing / demand);

  let growth = 0;
  const perStudio = {};
  for (const i of studios) {
    const t = s.tiles[i];
    const trend = t.genre === s.trending ? CONFIG.trendMultiplier : 1;
    const g = CONFIG.baseGrowthPerStudio * t.level * studioQuality(s, i) * trend * marketing * efficiency;
    perStudio[i] = g;
    growth += g;
  }

  const revenue = s.listeners * CONFIG.revenuePerListener * adMult;
  return { housing, demand, upkeep, capacity, adMult, marketing, efficiency, growth, perStudio, revenue, profit: revenue - upkeep };
}

function pickEvent(s) {
  const hasStudio = s.tiles.some((t) => t && t.type === 'studio');
  const pool = EVENTS.filter((e) => !e.needsStudio || hasStudio);
  let r = Math.random() * pool.reduce((a, e) => a + e.weight, 0);
  for (const e of pool) { r -= e.weight; if (r <= 0) return e; }
  return pool[pool.length - 1];
}

/** Advance one day. */
function tick() {
  if (state.over) return;
  const s = state;
  const st = computeStats(s);

  s.listeners += st.growth - s.listeners * CONFIG.churn;
  s.listeners = Math.max(0, Math.min(st.capacity, s.listeners));
  s.cash += st.revenue - st.upkeep;
  s.day += 1;

  if (s.day % CONFIG.trendEveryDays === 0) {
    const others = GENRES.filter((g) => g.id !== s.trending);
    s.trending = others[Math.floor(Math.random() * others.length)].id;
    const g = genreById(s.trending);
    toast(`🔥 ${g.icon} ${g.name} is trending! Matching studios grow ${CONFIG.trendMultiplier}× faster.`);
  }

  if (s.day > 10 && s.listeners > 0 && Math.random() < 1 / 25) {
    const e = pickEvent(s);
    toast(e.run(s), e.kind);
    s.listeners = Math.max(0, Math.min(st.capacity, s.listeners));
  }

  while (s.milestones < MILESTONES.length && s.listeners >= MILESTONES[s.milestones].listeners) {
    const m = MILESTONES[s.milestones];
    s.cash += m.reward;
    s.milestones += 1;
    toast(`🎉 Milestone: ${m.title}! ${m.reward ? `+$${fmt(m.reward)} bonus` : ''}`, 'good');
    if (s.milestones === MILESTONES.length) showWin();
  }

  if (s.cash < CONFIG.bankruptAt) {
    s.over = true;
    showBankrupt();
  }

  if (s.day % 5 === 0) save();
  render();
}

/* ------------------------------------------------------------------------- */
/* Player actions                                                            */
/* ------------------------------------------------------------------------- */

function upgradeCost(t) {
  return Math.round(BUILDINGS[t.type].cost * 1.5 * t.level);
}

function place(i, type) {
  const def = BUILDINGS[type];
  if (state.tiles[i]) return;
  if (state.cash < def.cost) { toast(`Not enough cash for ${def.name} ($${fmt(def.cost)})`, 'bad'); return; }
  state.cash -= def.cost;
  const t = { type, level: 1 };
  if (type === 'studio') t.genre = GENRES[Math.floor(Math.random() * GENRES.length)].id;
  state.tiles[i] = t;
  floatText(i, `−$${fmt(def.cost)}`);
  if (type === 'studio') {
    const g = genreById(t.genre);
    toast(`New ${g.icon} ${g.name} show launched! Tap the studio to rebrand it.`);
  }
  save();
  render(i);
}

function upgrade(i) {
  const t = state.tiles[i];
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
  const t = state.tiles[i];
  if (!t) return;
  const refund = Math.round(BUILDINGS[t.type].cost * CONFIG.demolishRefund);
  state.cash += refund;
  state.tiles[i] = null;
  floatText(i, `+$${fmt(refund)}`);
  save();
  render();
}

function rebrand(i, genre) {
  const t = state.tiles[i];
  if (!t || t.type !== 'studio' || t.genre === genre || state.cash < CONFIG.rebrandCost) return;
  state.cash -= CONFIG.rebrandCost;
  t.genre = genre;
  save();
  render();
}

/* ------------------------------------------------------------------------- */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const toolbarEl = $('toolbar');
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
  for (let i = 0; i < CONFIG.cols * CONFIG.rows; i++) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.i = i;
    b.addEventListener('click', () => onTile(i));
    boardEl.appendChild(b);
  }
}

function buildToolbar() {
  toolbarEl.innerHTML = '';
  const entries = Object.entries(BUILDINGS).map(([k, d]) => ({ key: k, icon: d.icon, name: d.name, cost: d.cost }));
  entries.push({ key: 'demolish', icon: '🚧', name: 'Demolish', cost: null });
  for (const e of entries) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = e.key;
    b.innerHTML = `<span class="ico">${e.icon}</span><span class="nm">${e.name}</span>` +
      `<span class="cost">${e.cost == null ? '50% back' : '$' + fmt(e.cost)}</span>`;
    b.addEventListener('click', () => {
      tool = tool === e.key ? null : e.key;
      render();
    });
    toolbarEl.appendChild(b);
  }
}

function render(popIndex = -1) {
  const s = state;
  const st = computeStats(s);

  // HUD
  $('cash').textContent = '$' + fmt(s.cash);
  $('cash').classList.toggle('neg', s.cash < 0);
  const p = $('profit');
  p.textContent = `${st.profit >= 0 ? '+' : ''}${fmt(st.profit)}/day`;
  p.className = st.profit >= 0 ? 'pos' : 'neg';
  $('listeners').textContent = fmt(s.listeners);
  $('capacity').textContent = '/ ' + fmt(st.capacity);
  $('stat-listeners').classList.toggle('warn', s.listeners >= st.capacity * 0.98 && st.growth > 0);
  $('staff').textContent = `${st.housing}/${st.demand}`;
  $('stat-staff').classList.toggle('warn', st.efficiency < 1);
  $('day').textContent = s.day;
  const g = genreById(s.trending);
  $('trending').textContent = `${g.icon} ${g.name}`;
  document.querySelectorAll('.speed button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s.speed));

  const next = MILESTONES[s.milestones];
  $('goal').innerHTML = next
    ? `Goal: <b>${fmt(next.listeners)}</b> listeners → ${next.title}`
    : '<b>👑 Podcast Mogul!</b> Keep growing.';

  // Board
  boardEl.querySelectorAll('.tile').forEach((el, i) => {
    const t = s.tiles[i];
    el.className = 'tile';
    if (t) {
      const def = BUILDINGS[t.type];
      el.classList.add('built', t.type);
      const stars = maxLevelOf(t.type) > 1 ? '★'.repeat(t.level) : '';
      let badge = '';
      if (t.type === 'studio') {
        badge = `<span class="badge">${genreById(t.genre).icon}</span>`;
        if (t.genre === s.trending) el.classList.add('trending');
      }
      if (def.staff && st.efficiency < 0.5) el.classList.add('idle');
      el.innerHTML = `${def.icon}${badge}<span class="lvl">${stars}</span>`;
      el.setAttribute('aria-label', `${def.name} level ${t.level}`);
    } else {
      el.innerHTML = '';
      el.setAttribute('aria-label', 'Empty lot');
    }
    if (tool && tool !== 'demolish') el.classList.add('can-place');
    if (tool === 'demolish') el.classList.add('can-demolish');
    if (i === selected) el.classList.add('selected');
    if (i === popIndex) el.classList.add('pop');
  });

  // Toolbar
  toolbarEl.querySelectorAll('.tool').forEach((b) => {
    const k = b.dataset.tool;
    b.classList.toggle('active', k === tool);
    b.classList.toggle('unaffordable', BUILDINGS[k] ? s.cash < BUILDINGS[k].cost : false);
  });

  // Hint
  let hint;
  if (tool === 'demolish') hint = 'Tap a building to demolish it (50% refund).';
  else if (tool) hint = `Tap an empty lot to build a ${BUILDINGS[tool].name}. ${BUILDINGS[tool].desc}`;
  else if (!s.tiles.some(Boolean)) hint = 'Pick a building below, then tap the map. Start with a 🎙️ Studio and 🏢 Apartments!';
  else if (st.efficiency < 1) hint = `⚠️ Short on staff: buildings run at ${Math.round(st.efficiency * 100)}%. Build Apartments.`;
  else if (s.listeners >= st.capacity * 0.98 && st.growth > 0) hint = '⚠️ Servers are full! Build 🖥️ Servers to grow further.';
  else hint = 'Tap a building to inspect or upgrade it.';
  $('hint').textContent = hint;

  if (!sheetEl.classList.contains('hidden') && selected >= 0) renderInspect(selected, st);
}

/* ------------------------------------------------------------------------- */
/* Interaction                                                               */
/* ------------------------------------------------------------------------- */

function onTile(i) {
  if (state.over) return;
  const t = state.tiles[i];
  if (tool === 'demolish') {
    if (t) demolish(i);
    return;
  }
  if (tool) {
    if (t) { openInspect(i); return; }
    place(i, tool);
    return;
  }
  if (t) openInspect(i);
  else toast('Pick something to build from the menu below 👇');
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

function renderInspect(i, st) {
  const t = state.tiles[i];
  if (!t) { closeSheet(); return; }
  const def = BUILDINGS[t.type];
  const rows = [['Level', `${t.level} / ${maxLevelOf(t.type)}`], ['Upkeep', `$${fmt(def.upkeep * t.level)}/day`]];
  if (def.staff) rows.push(['Staff needed', def.staff * t.level]);
  if (t.type === 'studio') {
    const g = genreById(t.genre);
    rows.push(['Genre', `${g.icon} ${g.name}${t.genre === state.trending ? ' 🔥' : ''}`]);
    rows.push(['Quality', `${Math.round(studioQuality(state, i) * 100)}%`]);
    rows.push(['New listeners', `+${fmt(st.perStudio[i] || 0)}/day`]);
  }
  if (t.type === 'apartment') rows.push(['Houses', `${apartmentHousing(state, i)} staff`]);
  if (def.capacity) rows.push(['Capacity', `+${fmt(def.capacity * t.level)} listeners`]);
  if (def.adBonus) rows.push(['Ad revenue', `+${Math.round(def.adBonus * t.level * 100)}%`]);
  if (def.marketing) rows.push(['Growth boost', `+${Math.round(def.marketing * t.level * 100)}%`]);
  if (def.studioBonus) rows.push(['Studio bonus', `+${Math.round(def.studioBonus * t.level * 100)}% to neighbors`]);

  const canUp = t.level < maxLevelOf(t.type);
  const upCost = canUp ? upgradeCost(t) : 0;
  const refund = Math.round(def.cost * CONFIG.demolishRefund);

  let genres = '';
  if (t.type === 'studio') {
    genres = `<p>Rebrand show ($${CONFIG.rebrandCost}):</p><div class="genres">` +
      GENRES.map((g) => `<button class="btn${g.id === t.genre ? ' current' : ''}" data-genre="${g.id}" ${g.id === t.genre || state.cash < CONFIG.rebrandCost ? 'disabled' : ''}>${g.icon} ${g.name}</button>`).join('') +
      '</div>';
  }

  sheetEl.innerHTML = `
    <h2>${def.icon} ${def.name}</h2>
    <p>${def.desc}</p>
    <div class="rows">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>
    ${genres}
    <div class="btns">
      ${canUp ? `<button class="btn primary" data-act="upgrade" ${state.cash < upCost ? 'disabled' : ''}>⬆ Upgrade $${fmt(upCost)}</button>` : ''}
      <button class="btn danger" data-act="demolish">🚧 Demolish +$${fmt(refund)}</button>
      <button class="btn" data-act="close">Close</button>
    </div>`;
}

sheetEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const i = selected;
  if (btn.dataset.genre) rebrand(i, btn.dataset.genre);
  else if (btn.dataset.act === 'upgrade') upgrade(i);
  else if (btn.dataset.act === 'demolish') { demolish(i); closeSheet(); }
  else if (btn.dataset.act === 'close') closeSheet();
  else if (btn.dataset.act === 'restart') restart();
  else if (btn.dataset.act === 'dismiss') { state.seenIntro = true; save(); closeSheet(); }
});
backdropEl.addEventListener('click', () => {
  if (state.over) return;
  if (!state.seenIntro) { state.seenIntro = true; save(); }
  closeSheet();
});

document.querySelectorAll('.speed button').forEach((b) => {
  b.addEventListener('click', () => { setSpeed(Number(b.dataset.speed)); });
});

$('menu-btn').addEventListener('click', showMenu);

function showMenu() {
  selected = -1;
  const ms = MILESTONES.map((m, idx) =>
    `<li class="${idx < state.milestones ? 'done' : ''}">${idx < state.milestones ? '✅' : '⬜'} ${fmt(m.listeners)} listeners: ${m.title}${m.reward ? ` (+$${fmt(m.reward)})` : ''}</li>`).join('');
  openSheet(`
    <h2>🎧 Podcast Tycoon</h2>
    <p>Day ${state.day}. Milestones:</p>
    <ul class="milestones">${ms}</ul>
    <div class="btns">
      <button class="btn" data-act="help">❓ How to play</button>
      <button class="btn danger" data-act="restart">🔄 New game</button>
      <button class="btn" data-act="close">Close</button>
    </div>`);
  sheetEl.querySelector('[data-act="help"]').addEventListener('click', showIntro);
}

function showIntro() {
  selected = -1;
  openSheet(`
    <h2>🎙️ Podcast Tycoon</h2>
    <p>Build a podcast empire! Grow your network to <b>1 million listeners</b> to become a Podcast Mogul.</p>
    <ul>
      <li>🎙️ <b>Studios</b> make shows that attract listeners.</li>
      <li>🏢 <b>Apartments</b> house the staff your buildings need.</li>
      <li>🖥️ <b>Servers</b> raise your listener cap.</li>
      <li>🎚️☕🌳 Put <b>Editing, Cafés and Parks next to Studios</b> to boost quality.</li>
      <li>💼 <b>Ad Sales</b> and 📣 <b>Billboards</b> boost your whole network.</li>
      <li>🔥 Shows in the <b>trending genre</b> grow 2× faster. Trends change every 30 days.</li>
      <li>Tap a building to <b>upgrade</b> it. Don't let cash fall below −$1,000!</li>
    </ul>
    <div class="btns"><button class="btn primary" data-act="dismiss">Let's go!</button></div>`);
}

function showWin() {
  setSpeed(0);
  openSheet(`
    <h2>👑 Podcast Mogul!</h2>
    <p>You reached 1,000,000 listeners on day ${state.day}. Your network is the biggest in the city!</p>
    <div class="btns">
      <button class="btn primary" data-act="close">Keep playing</button>
      <button class="btn" data-act="restart">New game</button>
    </div>`);
}

function showBankrupt() {
  openSheet(`
    <h2>💸 Bankrupt!</h2>
    <p>Your cash fell below −$${fmt(-CONFIG.bankruptAt)} on day ${state.day}. The bank shut your network down.</p>
    <p>Tip: keep an eye on the profit per day under your cash, and don't build more than your listeners can pay for.</p>
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
setSpeed(state.over ? 0 : state.speed);
if (!state.seenIntro) showIntro();
if (state.over) showBankrupt();
