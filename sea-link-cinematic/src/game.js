import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRace, advanceRace, racePosition, clamp } from './race-logic.js';

const $ = (selector) => document.querySelector(selector);
const SCALE = 0.28;
const KART_SCALE = 0.43;
const ROAD_HALF = 2;
const held = new Set();
const keys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'accelerate', KeyW: 'accelerate', Space: 'accelerate', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'drift', ShiftRight: 'drift', KeyE: 'boost' };
let renderer, scene, camera, cameraTarget, race, curve, routeLength, routeMeters, kart, rivals = [], raf = 0, lastFrame = 0, lastUi = 0, shake = 0, eventTimeout, onExitCallback, uiBound = false;
let disposed = false, paused = false;

const mat = (color, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const materials = {
  asphalt: mat('#ffffff', 0.56, 0.07), marking: mat('#e2d7b6'), rail: mat('#c6cdd0', 0.38, 0.7), dark: mat('#14171b'), tire: mat('#101114'), hub: mat('#c4c8ca', 0.3, 0.85), seat: mat('#26212a'), skin: mat('#bb805f'), shirt: mat('#273b4c'), gold: mat('#e2ac51', 0.28, 0.55), glass: new THREE.MeshStandardMaterial({ color: '#bbd5dc', roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.6 })
};

function asphaltTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d'); const pixels = context.createImageData(128, 128);
  let seed = 2026;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = ((seed >>> 24) - 128) * 0.11;
    const worn = Math.sin(Math.floor(i / 4 / 128) * 0.12) * 2.5;
    pixels.data[i] = 52 + grain + worn;
    pixels.data[i + 1] = 55 + grain + worn;
    pixels.data[i + 2] = 59 + grain + worn;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function roadFrame(distance) {
  const u = clamp(distance / routeLength, 0, 1);
  const point = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u).normalize();
  const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  return { point, tangent, right, yaw: Math.atan2(tangent.x, tangent.z) };
}

function makeKart(color = '#a63e35') {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.32, 1.8), mat(color, 0.3, 0.25));
  body.position.y = 0.44; group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.65), mat(color, 0.28, 0.3)); nose.position.set(0, 0.42, 0.93); group.add(nose);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.11, 1.65), materials.dark); chassis.position.y = 0.27; group.add(chassis);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.38, 0.64), materials.seat); seat.position.set(0, 0.65, -0.25); group.add(seat);
  // Adult driver silhouette: seated torso, head, helmet and simple arms.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.46, 4, 8), materials.shirt); torso.position.set(0, 1.03, -0.24); group.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.13, 8), materials.skin); neck.position.set(0, 1.34, 0.01); group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), materials.skin); head.position.set(0, 1.53, 0.07); group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), mat('#ede7d4', 0.26, 0.35)); helmet.position.set(0, 1.61, 0.045); group.add(helmet);
  const armGeo = new THREE.CapsuleGeometry(0.07, 0.46, 3, 7);
  for (const side of [-1, 1]) { const arm = new THREE.Mesh(armGeo, materials.shirt); arm.position.set(side * 0.3, 1.02, 0.34); arm.rotation.x = -0.75; arm.rotation.z = side * -0.5; group.add(arm); }
  const steering = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 16), materials.dark); steering.position.set(0, 0.92, 0.48); steering.rotation.x = 0.8; group.add(steering);
  for (const side of [-1, 1]) for (const z of [-0.66, 0.65]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), materials.tire); wheel.rotation.z = Math.PI / 2; wheel.position.set(side * 0.77, 0.34, z); group.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.23, 12), materials.hub); hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position); group.add(hub);
  }
  group.userData.wheels = group.children.filter((child) => child.geometry?.type === 'CylinderGeometry' && child.geometry.parameters.radiusTop === 0.32);
  group.scale.setScalar(KART_SCALE);
  return group;
}

function modelKart(template, color) {
  const object = template.clone(true);
  const wheels = [];
  object.traverse((part) => {
    if (part.name.startsWith('Wheel')) wheels.push(part);
    if (!part.isMesh || !color) return;
    if (part.material.name === 'Crimson paint' || part.material.name === 'Fairing highlight') {
      part.material = part.material.clone();
      part.material.color.set(color);
    }
  });
  object.userData.wheels = wheels;
  object.scale.setScalar(KART_SCALE);
  return object;
}

async function surfaceTexture(name) {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(new URL(`./textures/${name}.webp`, document.baseURI).href);
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  } catch (error) {
    console.warn(`${name} texture unavailable; using the material color.`, error);
    return null;
  }
}

function textureModels(kartTemplate, pylonTemplate, fabric, concrete) {
  if (kartTemplate && fabric) kartTemplate.traverse((part) => {
    if (!part.isMesh || part.material?.name !== 'Racing jersey') return;
    part.material = part.material.clone(); part.material.color.set('#e5e5e5');
    part.material.map = fabric; part.material.roughness = 0.9;
  });
  if (pylonTemplate && concrete) pylonTemplate.traverse((part) => {
    if (!part.isMesh || !part.material?.name?.toLowerCase().includes('concrete')) return;
    if (!part.geometry.getAttribute('uv')) {
      const geometry = part.geometry.clone(); const positions = geometry.getAttribute('position'); const normals = geometry.getAttribute('normal');
      const uvs = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        uvs[i * 2] = (Math.abs(normals.getX(i)) > Math.abs(normals.getZ(i)) ? positions.getZ(i) : positions.getX(i)) * 0.25;
        uvs[i * 2 + 1] = positions.getY(i) * 0.25;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); part.geometry = geometry;
    }
    part.material = part.material.clone(); part.material.color.set('#eeeeee');
    part.material.map = concrete; part.material.roughness = 0.78;
  });
}

function addWorld(data, pylonTemplate, asphalt, concrete) {
  const [lon0, lat0] = data.route[0]; const cos = Math.cos(lat0 * Math.PI / 180);
  const pts = data.route.map(([lon, lat]) => new THREE.Vector3((lon - lon0) * 111320 * cos * SCALE, 0, (lat0 - lat) * 111320 * SCALE));
  curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.25);
  const samples = curve.getSpacedPoints(600);
  routeLength = curve.getLength();
  const vertices = [], uvs = [], indices = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i], t = curve.getTangentAt(i / (samples.length - 1)); const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    for (const side of [-1, 1]) {
      vertices.push(p.x + right.x * ROAD_HALF * side, 0.16, p.z + right.z * ROAD_HALF * side);
      uvs.push((side + 1) / 2, i / (samples.length - 1) * routeLength / 4);
    }
    if (i < samples.length - 1) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const roadGeo = new THREE.BufferGeometry(); roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); roadGeo.setIndex(indices); roadGeo.computeVertexNormals();
  materials.asphalt.map = asphalt ?? asphaltTexture(); materials.asphalt.roughness = 0.45; materials.asphalt.needsUpdate = true;
  const road = new THREE.Mesh(roadGeo, materials.asphalt); road.material.side = THREE.DoubleSide; scene.add(road);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, routeLength + 1000), new THREE.MeshStandardMaterial({ color: '#547b86', roughness: 0.3, metalness: 0.18 })); sea.rotation.x = -Math.PI / 2; sea.position.set(-65, -4.2, routeLength / 2); scene.add(sea);
  const deck = new THREE.Mesh(roadGeo.clone().translate(0, -0.5, 0), mat('#50545a', 0.65, 0.35)); deck.material.side = THREE.DoubleSide; scene.add(deck);
  const barrierMaterial = mat(concrete ? '#eeeeee' : '#aeb6b7', 0.75);
  if (concrete) barrierMaterial.map = concrete;
  const barriers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.42, 1), barrierMaterial, 2 * 150);
  const railPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), materials.rail, 2 * 151);
  const railRuns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1), materials.rail, 2 * 150);
  const dummy = new THREE.Object3D(); let postIndex = 0, runIndex = 0;
  for (let i = 0; i <= 150; i++) {
    const frame = roadFrame(routeLength * i / 150);
    for (const side of [-1, 1]) {
      const pos = frame.point.clone().addScaledVector(frame.right, side * (ROAD_HALF + 0.12));
      dummy.position.set(pos.x, 0.75, pos.z); dummy.rotation.set(0, frame.yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); railPosts.setMatrixAt(postIndex++, dummy.matrix);
      if (i < 150) {
        const next = roadFrame(routeLength * (i + 1) / 150);
        const end = next.point.clone().addScaledVector(next.right, side * (ROAD_HALF + 0.12));
        const span = end.clone().sub(pos); const mid = pos.clone().add(end).multiplyScalar(0.5);
        dummy.position.set(mid.x, 1.05, mid.z); dummy.rotation.set(0, Math.atan2(span.x, span.z), 0); dummy.scale.set(1, 1, span.length() + 0.08); dummy.updateMatrix(); railRuns.setMatrixAt(runIndex++, dummy.matrix);
        dummy.position.y = 0.34; dummy.scale.z = Math.max(0.1, span.length() - 0.05); dummy.updateMatrix(); barriers.setMatrixAt(runIndex - 1, dummy.matrix);
      }
    }
  }
  railPosts.count = postIndex; railRuns.count = barriers.count = runIndex; scene.add(barriers, railPosts, railRuns);
  // Dashed center line, edge reflectors and bridge lighting.
  const centerMarks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.035, 1.12), materials.marking, 600);
  const markerTransform = new THREE.Object3D(); let markerCount = 0;
  for (let i = 0; i < 600; i += 2) {
    const p = samples[i], t = curve.getTangentAt(i / 600), right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    for (const side of [-1, 1]) {
      markerTransform.position.set(p.x + right.x * side * ROAD_HALF / 3, 0.19, p.z + right.z * side * ROAD_HALF / 3);
      markerTransform.rotation.set(0, Math.atan2(t.x, t.z), 0); markerTransform.updateMatrix(); centerMarks.setMatrixAt(markerCount++, markerTransform.matrix);
    }
    if (i % 8 === 0) for (const side of [-1, 1]) {
      const lamp = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 4.4, 7), materials.rail); pole.position.y = 2.25; lamp.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.12), materials.rail); arm.position.set(-side * 0.9, 4.3, 0); lamp.add(arm);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffd7a0' })); bulb.position.set(-side * 0.9, 4.22, 0); lamp.add(bulb);
      const offset = p.clone().addScaledVector(right, side * (ROAD_HALF + 0.55)); lamp.position.set(offset.x, 0, offset.z); lamp.rotation.y = Math.atan2(t.x, t.z); scene.add(lamp);
    }
  }
  centerMarks.count = markerCount; scene.add(centerMarks);
  // Cable-stayed pylons and fine cables at four cinematic spans.
  for (const fraction of [0.18, 0.28, 0.72, 0.82]) {
    const frame = roadFrame(routeLength * fraction);
    if (pylonTemplate) {
      const pylon = pylonTemplate.clone(true); pylon.scale.setScalar(SCALE); pylon.position.copy(frame.point); pylon.position.y = 0.16; pylon.rotation.y = frame.yaw; scene.add(pylon);
    } else for (const side of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.55, 24, 0.55), mat('#aab4b7', 0.34, 0.65)); tower.position.copy(frame.point).addScaledVector(frame.right, side * (ROAD_HALF + 1.8)); tower.y += 12.2; scene.add(tower);
    }
    for (const side of [-1, 1]) for (let j = 0; j < 8; j++) {
      const end = roadFrame(routeLength * (fraction + (j - 3.5) * 0.015));
      const startPoint = frame.point.clone().addScaledVector(frame.right, side * (ROAD_HALF + 1.8)); startPoint.y = 22 - j * 0.6;
      const endPoint = end.point.clone().addScaledVector(end.right, side * (ROAD_HALF + 0.1)); endPoint.y = 0.95;
      const cable = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]); scene.add(new THREE.Line(cable, new THREE.LineBasicMaterial({ color: '#aab8c1', transparent: true, opacity: 0.62 })));
    }
  }
  // Keep shore buildings beyond the ends of the bridge and away from the road frame.
  const buildingMat = [mat('#83919b'), mat('#9ba3a2'), mat('#71838b')];
  for (const shore of [0, 1]) for (let i = 0; i < 24; i++) {
    const end = roadFrame(routeLength * shore);
    const side = i % 2 ? 1 : -1;
    const depth = 30 + Math.floor(i / 2) * 11;
    const h = 10 + (i * 17 % 23);
    const position = end.point.clone()
      .addScaledVector(end.tangent, (shore ? 1 : -1) * depth)
      .addScaledVector(end.right, side * (28 + (i * 13 % 55)));
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5 + (i % 4) * 2, h, 7 + (i % 3) * 2), buildingMat[i % buildingMat.length]);
    tower.position.set(position.x, h / 2 - 4, position.z); tower.rotation.y = end.yaw; scene.add(tower);
  }
}

function makeEnvironment(timeOfDay) {
  const tones = { Morning: ['#a7c9d8', '#f1c79b', 0xffe0b0], Day: ['#87b6cd', '#d3e1db', 0xffffff], Sunset: ['#65496d', '#ef9f72', 0xffc179], Night: ['#101a34', '#2a315b', 0x99b8ff] };
  const [sky, horizon, sun] = tones[timeOfDay] ?? tones.Sunset;
  scene.background = new THREE.Color(sky);
  const skyGeometry = new THREE.SphereGeometry(1500, 40, 20);
  const positions = skyGeometry.getAttribute('position'); const colors = [];
  const high = new THREE.Color(sky), low = new THREE.Color(horizon);
  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i) / 1500;
    const color = low.clone().lerp(high, THREE.MathUtils.smoothstep(height, -0.08, 0.62));
    colors.push(color.r, color.g, color.b);
  }
  skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const skyDome = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  skyDome.frustumCulled = false; scene.add(skyDome); scene.userData.skyDome = skyDome;
  scene.fog = new THREE.Fog(horizon, 90, 450);
  const hemi = new THREE.HemisphereLight(0xc5d8e9, 0x26303a, timeOfDay === 'Night' ? 0.6 : 1.45); scene.add(hemi);
  const key = new THREE.DirectionalLight(sun, timeOfDay === 'Night' ? 1.2 : 2.2); key.position.set(-60, 90, 40); scene.add(key);
  const disk = new THREE.Mesh(new THREE.SphereGeometry(timeOfDay === 'Night' ? 4 : 12, 20, 16), new THREE.MeshBasicMaterial({ color: timeOfDay === 'Night' ? '#d9e5ff' : '#ffd29a' })); disk.position.set(-110, 105, routeLength * 0.22); scene.add(disk);
}

function showEvent(message) {
  const banner = $('#event-banner'); banner.textContent = message; banner.classList.add('visible'); window.clearTimeout(eventTimeout); eventTimeout = window.setTimeout(() => banner.classList.remove('visible'), 2400);
}

function controls() {
  const input = Object.fromEntries(['left', 'right', 'accelerate', 'brake', 'drift', 'boost'].map((key) => [key, held.has(key)]));
  input.accelerate ||= held.has('accelerate');
  return input;
}

function updateKart(object, distance, lane, dt, playerKart = false) {
  const frame = roadFrame(routeLength * distance / race.length); const target = frame.point.clone().addScaledVector(frame.right, lane * SCALE);
  object.position.set(target.x, 0.16, target.z); object.rotation.y = frame.yaw;
  if (playerKart) {
    object.position.y += Math.sin(performance.now() * 0.012) * 0.004;
    for (const wheel of object.userData.wheels) wheel.rotation.x -= race.player.speed * dt / 0.32;
    object.rotation.z = THREE.MathUtils.damp(object.rotation.z, -race.player.lateralSpeed * 0.018, 7, dt);
  }
}

function renderHud(now) {
  if (now - lastUi < 80) return; lastUi = now;
  const p = race.player; const progress = p.distance / race.length;
  $('#hud-speed').textContent = Math.round(p.speed * 3.6);
  $('#hud-position').textContent = String(stepPosition());
  $('#hud-field').textContent = `/ ${race.rivals.length + 1}`;
  $('#hud-time').textContent = `${String(Math.floor(race.elapsed / 60)).padStart(2, '0')}:${(race.elapsed % 60).toFixed(1).padStart(4, '0')}`;
  $('#hud-progress').style.width = `${(progress * 100).toFixed(1)}%`;
  $('#hud-sector').textContent = progress < 0.34 ? 'BANDRA · START' : progress < 0.67 ? 'MAHIM BAY · SECTOR 2' : 'WORLI · FINAL SECTOR';
  $('#hud-boost').style.width = `${Math.round(p.charge * 100)}%`;
}
function stepPosition() { return racePosition(race); }

function tick(now) {
  if (disposed || paused) return;
  raf = requestAnimationFrame(tick);
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.25) : 1 / 60; lastFrame = now;
  const result = advanceRace(race, controls(), dt);
  updateKart(kart, race.player.distance, race.player.lane, dt, true);
  race.rivals.forEach((rival, i) => updateKart(rivals[i], rival.distance, rival.lane, dt));
  const frame = roadFrame(routeLength * race.player.distance / race.length); const look = frame.point.clone().addScaledVector(frame.tangent, 5.2).addScaledVector(frame.right, race.player.lane * SCALE * 0.35); look.y += 0.9;
  const desired = frame.point.clone().addScaledVector(frame.tangent, -2.55).add(new THREE.Vector3(0, 1.65, 0));
  desired.addScaledVector(frame.right, race.player.lane * SCALE * 0.65);
  if (shake > 0) { desired.x += (Math.random() - 0.5) * shake; desired.y += (Math.random() - 0.5) * shake * 0.6; shake = Math.max(0, shake - dt * 2.4); }
  const alpha = 1 - Math.exp(-5.5 * dt); camera.position.lerp(desired, alpha); cameraTarget.lerp(look, alpha); camera.lookAt(cameraTarget);
  scene.userData.skyDome.position.copy(camera.position);
  renderer.render(scene, camera); renderHud(now);
  if (result.collision) shake = Math.max(shake, 0.25 + race.player.speed * 0.006);
  for (const event of result.events) {
    showEvent(event.text);
    if (event.type === 'finish') finishRace();
  }
}

function finishRace() {
  held.clear();
  const position = stepPosition(); $('#finish-title').textContent = position === 1 ? 'You won the Sea Link.' : `You finished ${position}${position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'}.`;
  $('#finish-copy').textContent = `Bandra to Worli · ${race.elapsed.toFixed(1)} seconds · ${race.rivals.length + 1} racers`;
  $('#finish-overlay').hidden = false;
}

function keyDown(event) { if (disposed) return; const key = keys[event.code]; if (key) { held.add(key); event.preventDefault(); } if (event.code === 'Escape') pause(true); }
function keyUp(event) { if (disposed) return; const key = keys[event.code]; if (key) { held.delete(key); event.preventDefault(); } }
function pause(value) {
  if (disposed || race.finished) return;
  paused = value; $('#pause-overlay').hidden = !value;
  if (value) { held.clear(); cancelAnimationFrame(raf); }
  else { lastFrame = 0; raf = requestAnimationFrame(tick); }
}

function bindUi() {
  if (uiBound) return; uiBound = true;
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', () => held.clear());
  window.addEventListener('resize', resize);
  document.querySelectorAll('[data-control]').forEach((button) => {
    const start = (event) => { event.preventDefault(); held.add(button.dataset.control); button.classList.add('pressed'); button.setPointerCapture?.(event.pointerId); };
    const end = (event) => { event.preventDefault(); held.delete(button.dataset.control); button.classList.remove('pressed'); };
    button.addEventListener('pointerdown', start); button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end); button.addEventListener('lostpointercapture', end);
  });
  $('#pause-race').addEventListener('click', () => pause(true)); $('#resume-race').addEventListener('click', () => pause(false));
  $('#exit-race').addEventListener('click', leave); $('#finish-exit').addEventListener('click', leave);
  $('#restart-race').addEventListener('click', () => { $('#finish-overlay').hidden = true; start(raceConfig); });
}
let raceConfig;
function leave() { dispose(); onExitCallback?.(); }
function dispose() {
  disposed = true; cancelAnimationFrame(raf); held.clear();
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
  scene?.traverse((object) => { object.geometry?.dispose?.(); if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.()); else object.material?.dispose?.(); });
  renderer = scene = camera = cameraTarget = null;
}

async function start(config) {
  dispose(); disposed = false; paused = false; raceConfig = config; lastFrame = 0; lastUi = 0; shake = 0;
  $('#pause-overlay').hidden = true; $('#finish-overlay').hidden = true; $('#event-banner').classList.remove('visible'); window.clearTimeout(eventTimeout);
  const loader = new GLTFLoader();
  const model = (path) => loader.loadAsync(path).then((asset) => asset.scene).catch((error) => { console.warn(`${path} unavailable; using the lightweight fallback.`, error); return null; });
  const [route, kartTemplate, pylonTemplate, asphalt, concrete, fabric] = await Promise.all([
    fetch(new URL('./osm-sea-link.json', document.baseURI)).then((response) => { if (!response.ok) throw new Error('Could not load the cached Sea Link route.'); return response.json(); }),
    model(new URL('./models/sea-link-kart.glb', document.baseURI).href), model(new URL('./models/sea-link-pylon.glb', document.baseURI).href),
    surfaceTexture('coastal-asphalt'), surfaceTexture('sea-link-concrete'), surfaceTexture('driver-fabric'),
  ]);
  if (disposed) return;
  scene = new THREE.Scene();
  const [lon0, lat0] = route.route[0]; const cos = Math.cos(lat0 * Math.PI / 180);
  const raw = route.route.map(([lon, lat]) => new THREE.Vector3((lon - lon0) * 111320 * cos * SCALE, 0, (lat0 - lat) * 111320 * SCALE));
  curve = new THREE.CatmullRomCurve3(raw, false, 'centripetal', 0.25); routeLength = curve.getLength();
  routeMeters = route.route.slice(1).reduce((total, [lon, lat], index) => {
    const [prevLon, prevLat] = route.route[index]; const dx = (lon - prevLon) * 111320 * Math.cos(((lat + prevLat) * 0.5) * Math.PI / 180); const dz = (lat - prevLat) * 111320;
    return total + Math.hypot(dx, dz);
  }, 0);
  textureModels(kartTemplate, pylonTemplate, fabric, concrete);
  if (fabric) { materials.shirt.map = fabric; materials.shirt.color.set('#e5e5e5'); materials.shirt.needsUpdate = true; }
  makeEnvironment(config.timeOfDay); addWorld(route, pylonTemplate, asphalt, concrete);
  kart = kartTemplate ? modelKart(kartTemplate) : makeKart(); scene.add(kart);
  const colors = ['#4388bd', '#d99b34', '#55a16e', '#9c67c6', '#dc6853', '#48a0a0', '#d26b9b'];
  rivals = Array.from({ length: config.rivals }, (_, index) => { const object = kartTemplate ? modelKart(kartTemplate, colors[index % colors.length]) : makeKart(colors[index % colors.length]); object.scale.setScalar(KART_SCALE * 0.9); scene.add(object); return object; });
  race = createRace({ length: routeMeters, rivals: config.rivals, difficulty: config.difficulty, events: config.events });
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6)); renderer.setSize(window.innerWidth, window.innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  $('#game-canvas').replaceChildren(renderer.domElement);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2600);
  const start = roadFrame(0); camera.position.copy(start.point).addScaledVector(start.tangent, -2.55).add(new THREE.Vector3(0, 1.65, 0)); cameraTarget = start.point.clone().addScaledVector(start.tangent, 5.2).add(new THREE.Vector3(0, 0.9, 0)); camera.lookAt(cameraTarget);
  bindUi(); $('#hud-field').textContent = `/ ${config.rivals + 1}`; $('#game-view').hidden = false; $('#hud-speed').textContent = '0';
  raf = requestAnimationFrame(tick);
}
function resize() { if (!renderer || !camera) return; camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }

export function startGame(config, onExit) { onExitCallback = onExit; return start(config); }
