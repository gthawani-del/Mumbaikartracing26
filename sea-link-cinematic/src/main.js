const svg = document.querySelector('#route-svg');
const mapLoading = document.querySelector('#map-loading');
const toast = document.querySelector('#toast');
const state = { rivals: 7, difficulty: 'Medium', timeOfDay: 'Sunset', events: new Set(['crosswind', 'boost']), zoom: 1 };
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function projectFactory(route, roads) {
  const points = [...route, ...roads.flatMap((road) => road.coordinates)];
  const lons = points.map((point) => point[0]); const lats = points.map((point) => point[1]);
  const west = Math.min(...lons); const east = Math.max(...lons); const south = Math.min(...lats); const north = Math.max(...lats);
  const cos = Math.cos(((north + south) / 2) * Math.PI / 180);
  const widthMeters = (east - west) * 111320 * cos; const heightMeters = (north - south) * 111320;
  const scale = Math.min(670 / widthMeters, 448 / heightMeters); const drawWidth = widthMeters * scale; const drawHeight = heightMeters * scale;
  const left = (760 - drawWidth) / 2; const top = (520 - drawHeight) / 2;
  return ([lon, lat]) => [left + (lon - west) * 111320 * cos * scale, top + (north - lat) * 111320 * scale];
}
function pathFor(coords, project) {
  return coords.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
}
function renderMap(data) {
  const project = projectFactory(data.route, data.roads);
  const roads = data.roads.map((road) => {
    const major = ['motorway', 'trunk', 'primary'].includes(road.highway);
    return `<path class="mapped-road ${major ? 'mapped-road-major' : ''}" d="${pathFor(road.coordinates, project)}"/>`;
  }).join('');
  const routePath = pathFor(data.route, project); const [startX, startY] = project(data.route[0]); const [endX, endY] = project(data.route.at(-1));
  const splits = [0.25, 0.5, 0.75].map((fraction) => project(data.route[Math.floor((data.route.length - 1) * fraction)]));
  svg.innerHTML = `<defs><linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dcebea"/><stop offset="1" stop-color="#c6dddd"/></linearGradient><filter id="route-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="760" height="520" fill="url(#water)"/><path class="shoreline" d="M0 0H198Q217 68 200 133T215 260Q226 340 202 410T213 520H0Z"/><path class="shoreline-detail" d="M205 0Q230 79 210 148T226 279Q236 360 213 430T224 520"/><g class="map-lines">${roads}</g><path class="route-halo" d="${routePath}"/><path class="race-route" d="${routePath}"/>${splits.map(([x, y], index) => `<g class="checkpoint"><circle cx="${x}" cy="${y}" r="9"/><text x="${x + 15}" y="${y + 4}">SPLIT ${index + 1}</text></g>`).join('')}<g class="endpoint start-point"><circle cx="${startX}" cy="${startY}" r="13"/><text x="${startX + 19}" y="${startY + 5}">BANDRA · START</text></g><g class="endpoint finish-point"><circle cx="${endX}" cy="${endY}" r="13"/><text x="${endX + 19}" y="${endY + 5}">WORLI · FINISH</text></g><text class="map-water-label" x="90" y="370">MAHIM BAY</text><text class="map-land-label" x="585" y="102">MUMBAI</text>`;
  mapLoading.hidden = true; window.routeData = data;
}
async function loadRoute() {
  try { const response = await fetch(new URL('./osm-sea-link.json', document.baseURI)); if (!response.ok) throw new Error(`Route data returned ${response.status}`); renderMap(await response.json()); }
  catch (error) { mapLoading.textContent = 'Route preview could not load. Check the local route data file.'; mapLoading.classList.add('error'); console.error('Failed to load cached OSM route geometry:', error); }
}
function updateSummary() {
  document.querySelector('#summary-title').textContent = `${state.rivals + 1} racers · 3 sectors · ${state.timeOfDay}`;
  document.querySelector('#summary-subtitle').textContent = `${state.events.size} surprise event${state.events.size === 1 ? '' : 's'} enabled · Bandra to Worli`;
}
function showToast(message) { toast.textContent = message; toast.classList.add('visible'); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2500); }

document.querySelectorAll('[data-rivals]').forEach((button) => button.addEventListener('click', () => {
  state.rivals = Number(button.dataset.rivals);
  document.querySelectorAll('[data-rivals]').forEach((item) => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected)); });
  updateSummary();
}));
document.querySelector('#difficulty').addEventListener('change', (event) => { state.difficulty = event.target.value; showToast(`${state.difficulty} rival pace selected`); });
document.querySelector('#timeOfDay').addEventListener('change', (event) => { state.timeOfDay = event.target.value; updateSummary(); });
document.querySelectorAll('[data-event]').forEach((button) => button.addEventListener('click', () => {
  const key = button.dataset.event; if (state.events.has(key)) state.events.delete(key); else state.events.add(key);
  const enabled = state.events.has(key); button.classList.toggle('enabled', enabled); button.setAttribute('aria-pressed', String(enabled)); updateSummary();
}));
document.querySelector('#kartInfo').addEventListener('click', () => showToast('Adult driver · four-wheel open-frame racing kart'));
function reviewRace() {
  document.querySelector('#dialog-detail').innerHTML = `<div><span>ROUTE</span><b>Bandra → Worli</b></div><div><span>RACERS</span><b>${state.rivals + 1} total · ${esc(state.difficulty)} AI</b></div><div><span>CONDITIONS</span><b>${esc(state.timeOfDay)} · ${state.events.size} events</b></div>`;
  document.querySelector('#review-dialog').showModal();
}
document.querySelector('#start-race').addEventListener('click', reviewRace);
document.querySelector('#dialog-close').addEventListener('click', () => document.querySelector('#review-dialog').close());
document.querySelector('#launch-race').addEventListener('click', async () => {
  const setup = document.querySelector('.app-shell');
  document.querySelector('#review-dialog').close();
  document.querySelector('#game-view').hidden = false;
  setup.classList.add('racing');
  try {
    const { startGame } = await import('./game.js');
    await startGame({ rivals: state.rivals, difficulty: state.difficulty, timeOfDay: state.timeOfDay, events: [...state.events] }, () => {
      setup.classList.remove('racing'); document.querySelector('#game-view').hidden = true;
    });
  } catch (error) {
    setup.classList.remove('racing'); document.querySelector('#game-view').hidden = true;
    showToast('Race could not start. Check WebGL support and try again.'); console.error('Could not start Sea Link race:', error);
  }
});
function changeZoom(delta) { state.zoom = Math.max(1, Math.min(1.8, state.zoom + delta)); const height = 520 / state.zoom; const width = 760 / state.zoom; svg.setAttribute('viewBox', `${(760 - width) / 2} ${(520 - height) / 2} ${width} ${height}`); }
document.querySelector('#zoom-in').addEventListener('click', () => changeZoom(0.2));
document.querySelector('#zoom-out').addEventListener('click', () => changeZoom(-0.2));
loadRoute();
