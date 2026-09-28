import { Scene, Color, Fog, PerspectiveCamera, WebGLRenderer, HemisphereLight, DirectionalLight, Group, Box3, Vector3, Mesh, PlaneGeometry, MeshStandardMaterial, Raycaster, Vector2, MathUtils, ACESFilmicToneMapping, CanvasTexture, MeshBasicMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './lobby.css';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const storage = { get(key) { try { return sessionStorage.getItem(key); } catch { return null; } }, set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* Private mode remains playable. */ } } };
let needsRender = true;
let selected = storage.get('lobby-race') === 'kart' ? 'kart' : 'auto';
let renderer, camera, scene, auto, kart, introStart = null, settled = false, ready = false, raf;
const endCamera = new Vector3(), target = new Vector3(), raycaster = new Raycaster();
const buttons = [...document.querySelectorAll('[data-race]')];
function choose(race) {
  selected = race;
  needsRender = true;
  storage.set('lobby-race', race);
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.race === race));
  $('race-meta').textContent = race === 'auto' ? '3 laps · 5 rivals · Arcade' : 'Bandra → Worli · 7 rivals · Sprint';
  $('launch').href = race === 'auto' ? '/marine-drive.html?race=1' : '/sea-link-cinematic/';
  $('launch').innerHTML = `Race ${race === 'auto' ? 'Marine Drive' : 'the Sea Link'} <span>↗</span>`;
}
buttons.forEach(button => button.addEventListener('click', () => choose(button.dataset.race)));
choose(selected);
function settle() {
  settled = true;
  needsRender = true;
  if (camera) camera.position.set(selected === 'auto' ? -.35 : .35, camera.aspect < .8 ? 5.5 : 3.7, camera.aspect < .8 ? 21 : 14);
  document.body.classList.remove('intro');
  $('skip').hidden = true;
  $('replay').hidden = reducedMotion || !ready;
  storage.set('lobby-seen', '1');
}
$('skip').onclick = settle;
$('replay').onclick = () => { settled = false; introStart = null; document.body.classList.add('intro'); $('skip').hidden = false; $('replay').hidden = true; };
function model(root, size, rotate = 0) {
  root.rotation.y = rotate;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root), dimension = box.getSize(new Vector3());
  root.scale.multiplyScalar(size / Math.max(dimension.x, dimension.y, dimension.z));
  root.updateMatrixWorld(true); box.setFromObject(root);
  const center = box.getCenter(new Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  const wrapper = new Group(); wrapper.add(root); return wrapper;
}
function plane(width, length, color, x, y, z, roughness = .8) {
  const mesh = new Mesh(new PlaneGeometry(width, length), new MeshStandardMaterial({ color, roughness, metalness: .12 }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh;
}
function resize() {
  needsRender = true;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
}
async function boot() {
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
    $('lobby-world').append(renderer.domElement);
    scene = new Scene(); scene.background = new Color('#344e60'); scene.fog = new Fog('#344e60', 45, 170);
    camera = new PerspectiveCamera(43, 1, .1, 400);
    scene.add(new HemisphereLight('#dfedff', '#a39274', 2.8));
    const sun = new DirectionalLight('#ffe4b8', 3.2); sun.position.set(-25, 35, 15); scene.add(sun);
    plane(400, 400, '#455e61', 0, -.9, -70, .32);
    plane(16, 250, '#222d33', 0, 0, -90, .46);
    plane(5, 250, '#817c6e', -10, .02, -90);
    plane(40, 250, '#344142', 28, -.02, -90);
    for (const x of [-7.4, 7.4]) plane(.12, 250, '#d8cdb8', x, .012, -90);
    for (let z = -200; z < 30; z += 7) plane(.12, 2.5, '#b8b6aa', 0, .013, z);
    resize(); window.addEventListener('resize', resize);
    renderer.render(scene, camera);
    const loader = new GLTFLoader();
    const assets = await Promise.all([
      loader.loadAsync('/assets/auto.glb'),
      loader.loadAsync(import.meta.env.DEV ? '/sea-link-cinematic/public/models/sea-link-kart.glb' : '/sea-link-cinematic/models/sea-link-kart.glb'),
      loader.loadAsync('/assets/building.glb'),
      loader.loadAsync('/assets/palm.glb'),
    ]);
    auto = model(assets[0].scene, 3.6, Math.PI / 2);
    kart = model((assets[1].scene.getObjectByName('KartRoot') ?? assets[1].scene).clone(true), 3.6);
    kart.traverse(part => { if (part.name === 'RainHelmet') part.visible = false; });
    scene.add(auto, kart);
    // Soft contact shadows keep the reused models grounded without a shadow pass.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,.6)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const shadowMaterial = new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false });
    for (const vehicle of [auto, kart]) {
      const shadow = new Mesh(new PlaneGeometry(4, 4.8), shadowMaterial);
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = .006; vehicle.add(shadow);
    }
    for (let i = 0; i < 16; i++) {
      const building = model(assets[2].scene.clone(true), 10 + i % 3 * 3);
      building.position.set(18 + i % 2 * 12, 0, 8 - i * 12); building.rotation.y = -Math.PI / 2; scene.add(building);
    }
    for (let i = 0; i < 14; i++) {
      const palm = model(assets[3].scene.clone(true), 8);
      palm.position.set(i % 2 ? 9 : -10, 0, 6 - i * 12); palm.rotation.y = i; scene.add(palm);
    }
    ready = true;
    $('load-status').textContent = 'Select your ride';
    if (reducedMotion || storage.get('lobby-seen')) settle();
    else { document.body.classList.add('intro'); $('skip').hidden = false; }
    renderer.domElement.addEventListener('pointerup', event => {
      if (!settled) return;
      raycaster.setFromCamera(new Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2), camera);
      const hits = raycaster.intersectObjects([auto, kart], true);
      if (!hits.length) return;
      let object = hits[0].object;
      while (object.parent && object !== auto && object !== kart) object = object.parent;
      choose(object === auto ? 'auto' : 'kart');
    });
    raf = requestAnimationFrame(tick);
  } catch (error) {
    console.error('Lobby preview unavailable', error);
    settle(); $('load-status').textContent = '3D preview unavailable · Both races remain available';
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && ready) settle(); });
let lastTime = 0;
function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min((now - (lastTime || now)) / 1000, .05); lastTime = now;
  if (document.hidden) { if (introStart !== null) introStart += dt * 1000; return; }
  if (introStart === null) introStart = now;
  const t = MathUtils.clamp((now - introStart) / 3800, 0, 1);
  const ease = value => value * value * (3 - 2 * value);
  const progress = settled ? 1 : ease(t);
  const portrait = camera.aspect < .8;
  endCamera.set(selected === 'auto' ? -.35 : .35, portrait ? 5.5 : 3.7, portrait ? 21 : 14);
  target.set(0, .5, portrait ? 2.2 : 0);
  if (!settled) {
    camera.position.lerpVectors(new Vector3(-14, 65, -48), endCamera, progress);
    camera.lookAt(new Vector3(0, 0, -30).lerp(target, progress));
  } else {
    camera.position.lerp(endCamera, reducedMotion ? 1 : 1 - Math.exp(-dt * 4)); camera.lookAt(target);
  }
  const spacing = portrait ? 1.8 : 2.7;
  auto.scale.setScalar(portrait ? .82 : 1);
  kart.scale.setScalar(portrait ? .82 : 1);
  auto.position.set(-spacing, .025, 0);
  auto.rotation.y = -.32 + (1 - progress) * Math.PI * 2;
  const arrival = settled ? 1 : ease(MathUtils.clamp((t - .35) / .6, 0, 1));
  kart.position.set(spacing + Math.sin(arrival * Math.PI) * 1.4, .025, -42 * (1 - arrival));
  kart.rotation.y = .25 + Math.sin(arrival * Math.PI) * -.4;
  if (!settled && t >= 1) settle();
  if (!settled || needsRender || camera.position.distanceTo(endCamera) > .002) {
    renderer.render(scene, camera);
    needsRender = false;
  }
}
window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); renderer?.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void boot();
