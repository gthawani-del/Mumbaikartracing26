import { createFinish, advanceFinish } from './race-finish.js';
import { createIntro, advanceIntro, skipIntro } from './race-intro.js';
import * as THREE from 'three';
import { createWeatherState, advanceWeather, tyreSurface } from './weather-state.js';
import { createOcean, createBoostEffects, updateBoostEffects } from './race-effects.js';
import { createSkyTexture, createWetSurfaceMaps } from './environment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRace, racePosition, clamp, MAX_SPEED, BOOST_MIN_CHARGE } from './race-logic.js';

import { createSimulation, advanceSimulation } from './simulation.js';

const $ = (selector) => document.querySelector(selector);
const SCALE = 0.28;
const KART_SCALE = 0.43;
const ROAD_HALF = 2;
const held = new Set();
const keys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'accelerate', KeyW: 'accelerate', Space: 'accelerate', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'drift', ShiftRight: 'drift', KeyE: 'boost' };
let renderer, scene, camera, cameraTarget, race, curve, routeLength, routeMeters, kart, rivals = [], weather, reflections, minimap, raf = 0, lastFrame = 0, lastUi = 0, shake = 0, eventTimeout, onExitCallback, uiBound = false;
let disposed = false, paused = false;
let simulation, ocean, boostEffects, intro, visualTime = 0;
let engineAudio = null;
let contactSparks;
let finishPresentation = null, finalPush = false, helmetEquipped = false, helmetPrompted = false;
let slowFrames = 0, pixelRatio = 1.6, reducedMotion = false;
let soundMuted = false;

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

function lampReflectionTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(32, 64, 2, 32, 64, 60);
  glow.addColorStop(0, 'rgba(255,214,153,0.9)');
  glow.addColorStop(0.28, 'rgba(255,175,105,0.34)');
  glow.addColorStop(1, 'rgba(255,175,105,0)');
  context.fillStyle = glow; context.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(canvas);
}

function sprayTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  glow.addColorStop(0, 'rgba(255,255,255,.85)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function roadSignTexture(title, subtitle) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#155a49'; ctx.fillRect(0, 0, 1024, 192);
  ctx.strokeStyle = '#e1eee7'; ctx.lineWidth = 11; ctx.strokeRect(10, 10, 1004, 172);
  ctx.fillStyle = '#f3f9f5'; ctx.textAlign = 'center';
  ctx.font = 'bold 66px sans-serif'; ctx.fillText(title, 512, 87);
  ctx.font = '39px sans-serif'; ctx.fillText(subtitle, 512, 149);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function roadHalfAt(distance) {
  return ROAD_HALF + 2.4 * (1 - THREE.MathUtils.smoothstep(distance, 12, 120 * SCALE));
}

function roadFrame(distance) {
  const u = clamp(distance / routeLength, 0, 1);
  const point = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u).normalize();
  // Driver right = forward cross world-up.
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return { point, tangent, right, width: roadHalfAt(distance), yaw: Math.atan2(tangent.x, tangent.z) };
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

function racerPlate(number, color) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef1df'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 128); ctx.fillRect(240, 0, 16, 128);
  ctx.fillStyle = '#17212c'; ctx.textAlign = 'center'; ctx.font = '900 77px sans-serif';
  ctx.fillText(String(number).padStart(2, '0'), 128, 84);
  ctx.font = 'bold 18px sans-serif'; ctx.fillText('MUMBAI • SEA LINK', 128, 112);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function modelKart(template, color = '#ea364e', number = 1) {
  const object = (template.getObjectByName('KartRoot') ?? template).clone(true);
  const wheels = [], lamps = [];
  const replacements = new Map();
  function personalise(material) {
    if (replacements.has(material)) return replacements.get(material);
    const copy = material.clone();
    const name = material.name.replace(/\.\d+$/, '');
    if (material.userData?.recolorable || name === 'Crimson paint') {
      copy.color.set(color); copy.roughness = 0.25; copy.envMapIntensity = 1.3;
    } else if (name === 'Driver navy cloth') {
      copy.color.set(color).multiplyScalar(0.6); copy.roughness = 0.95;
    } else if (name === 'Cloth raised seams' || name === 'Fairing highlight') {
      copy.color.set('#e5e9dd');
    } else if (name === 'Brushed alloy') {
      copy.roughness = 0.3; copy.envMapIntensity = 1.2;
    } else if (name === 'Red LED') {
      copy.emissive.set('#ff172b'); copy.emissiveIntensity = 0.7; lamps.push(copy);
    }
    replacements.set(material, copy);
    return copy;
  }
  object.traverse(part => {
    if (/^Wheel(?:Front|Rear)[LR]$/.test(part.name)) wheels.push(part);
    if (!part.isMesh) return;
    part.material = Array.isArray(part.material) ? part.material.map(personalise) : personalise(part.material);
  });
  // A mapped decal over the existing rear registration bracket.
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.265), new THREE.MeshStandardMaterial({
    map: racerPlate(number, color), roughness: 0.55, metalness: 0.1,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  plate.position.set(0, 0.51, -1.218); plate.rotation.y = Math.PI; object.add(plate);
  object.userData.driver = ['DriverTorso', 'DriverHead', 'DriverHands'].map(name => object.getObjectByName(name));
  object.userData.helmet = object.getObjectByName('RainHelmet');
  if (object.userData.helmet) object.userData.helmet.visible = false;
  object.userData.wheels = wheels; object.userData.lamps = lamps;
  object.scale.setScalar(KART_SCALE);
  return object;
}

function makeMinimap() {
  const points = curve.getSpacedPoints(90);
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const spanX = Math.max(...xs) - minX || 1, spanZ = Math.max(...zs) - minZ || 1;
  const scale = Math.min(70 / spanX, 100 / spanZ);
  const x0 = (100 - spanX * scale) / 2, z0 = (120 - spanZ * scale) / 2;
  const mapPoint = (distance) => { const p = curve.getPointAt(clamp(distance / race.length, 0, 1)); return [x0 + (p.x - minX) * scale, z0 + (p.z - minZ) * scale]; };
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(x0 + (p.x - minX) * scale).toFixed(1)} ${(z0 + (p.z - minZ) * scale).toFixed(1)}`).join(' ');
  const svg = $('#race-minimap');
  svg.innerHTML = `<path d="${path}" fill="none" stroke="#182129" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#e9f4f7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle id="map-player" r="5" fill="#ffbc48" stroke="white" stroke-width="1.5"/>${race.rivals.map((_, i) => `<circle id="map-rival-${i}" r="3" fill="#f37081" stroke="#fff" stroke-width=".6"/>`).join('')}<circle cx="${mapPoint(race.length)[0]}" cy="${mapPoint(race.length)[1]}" r="4" fill="#fff"/>`;
  return { mapPoint, player: $('#map-player'), rivals: race.rivals.map((_, i) => $(`#map-rival-${i}`)) };
}

function makeWeather() {
  // Two draw calls, reused buffers: camera-local rain and world-space tyre spray.
  const rainPositions = new Float32Array(700 * 6);
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#cbd8e2', transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
  rain.frustumCulled = false; camera.add(rain); scene.add(camera);
  const drops = Array.from({ length: 700 }, () => ({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 8, z: -2 - Math.random() * 13 }));
  const sprayPositions = new Float32Array(80 * 3);
  for (let i = 0; i < 80; i++) sprayPositions[i * 3 + 1] = -100;
  const sprayGeo = new THREE.BufferGeometry(); sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ map: sprayTexture(), color: '#d2dfe5', size: 0.12, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true }));
  spray.frustumCulled = false; scene.add(spray);
  return { state: createWeatherState(), sprayBudget: 0, rain, rainGeo, rainPositions, drops, spray, sprayGeo, sprayPositions, particles: [], cursor: 0 };
}

function makeRoadReflections() {
  const contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.0, 1.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sprayTexture(), color: '#000000', transparent: true, opacity: 0.7, depthWrite: false }), race.rivals.length + 1);
  contact.instanceMatrix.setUsage(THREE.DynamicDrawUsage); contact.frustumCulled = false;
  scene.add(contact); scene.userData.contactShadows = contact;
  scene.userData.shadowTransform = new THREE.Object3D();
  const sheen = lampReflectionTexture();
  const ribbons = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 4.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sheen, color: '#a9bfd1', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 420);
  const marker = new THREE.Object3D();
  for (let i = 0; i < 420; i++) {
    const frame = roadFrame(routeLength * ((i + 0.5) / 420));
    const side = ((Math.imul(i + 11, 1664525) >>> 8) % 1000 / 1000 - 0.5) * 3;
    marker.position.copy(frame.point).addScaledVector(frame.right, side);
    marker.position.y = 0.195;
    marker.rotation.set(0, frame.yaw, 0);
    marker.scale.set(0.45 + (i % 5) * 0.2, 0.5 + (i % 4) * 0.25, 1); marker.updateMatrix();
    ribbons.setMatrixAt(i, marker.matrix);
  }
  scene.add(ribbons); scene.userData.wetRibbons = ribbons;
  const puddles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: sprayTexture(), color: '#34495b', roughness: 0.08, metalness: 0.3,
    transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.5,
  }), 210);
  for (let i = 0; i < 210; i++) {
    const frame = roadFrame(routeLength * (i + .5) / 210);
    marker.position.copy(frame.point).addScaledVector(frame.right, Math.sin(i * 11) * 1.1);
    marker.position.y = .188; marker.rotation.set(0, frame.yaw, 0);
    marker.scale.set(.65 + (i % 3) * .2, 1, .5 + (i % 4) * .3); marker.updateMatrix();
    puddles.setMatrixAt(i, marker.matrix);
  }
  scene.add(puddles); scene.userData.puddles = puddles;
  const texture = lampReflectionTexture();
  const colors = ['#f23c35', '#41a2ff', '#ffb238', '#48d29c', '#cc7bed', '#f85e71', '#44cbd6', '#ee5ca6'];
  const racers = [race.player, ...race.rivals].flatMap((_, i) => [-1, 1].map((side) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 3.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: texture, color: colors[i], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.userData = { racerIndex: i, side }; scene.add(mesh); return mesh;
  }));
  return racers;
}

function updateReflections() {
  const transform = scene.userData.shadowTransform;
  for (let i = 0; i <= race.rivals.length; i++) {
    const racer = i ? simulation.frame.rivals[i - 1] : simulation.frame.player;
    const frame = roadFrame(routeLength * racer.distance / race.length);
    transform.position.copy(frame.point).addScaledVector(frame.right, racer.lane * SCALE);
    transform.position.y = 0.175; transform.rotation.y = frame.yaw; transform.updateMatrix();
    scene.userData.contactShadows.setMatrixAt(i, transform.matrix);
  }
  scene.userData.contactShadows.instanceMatrix.needsUpdate = true;
  reflections.forEach((mesh) => {
    const i = mesh.userData.racerIndex;
    const racer = i ? simulation.frame.rivals[i - 1] : simulation.frame.player;
    const frame = roadFrame(routeLength * racer.distance / race.length);
    mesh.position.copy(frame.point).addScaledVector(frame.right, racer.lane * SCALE + mesh.userData.side * 0.22).addScaledVector(frame.tangent, -0.75);
    mesh.position.y = 0.204;
    mesh.rotation.y = frame.yaw;
    mesh.material.opacity = (0.15 + (weather?.state.wetness ?? 0.35) * 0.5) * Math.min(1, 0.4 + racer.speed / 80);
  });
}

function updateWeather(dt) {
  if (!weather) return;
  const changed = advanceWeather(weather.state, dt);
  const { rain, wetness } = weather.state;
  if (changed) showEvent(weather.state.heavy ? 'Heavy coastal shower — visibility reduced' : 'Rain easing — road still wet');
  const label = rain > 0.65 ? 'HEAVY RAIN' : rain > 0.08 ? 'RAIN' : wetness >= .12 ? 'WET ROAD' : 'DRY ROAD';
  if (rain > .65 && !helmetPrompted && !helmetEquipped && kart.userData.helmet) {
    helmetPrompted = true; $('#rain-helmet').hidden = false; $('#rain-helmet').classList.add('prompt');
  }
  if ($('#weather-status').textContent !== label) $('#weather-status').textContent = label;
  scene.backgroundIntensity = 1 - rain * .25;
  scene.environmentIntensity = 1 - rain * .2;
  weather.rainGeo.setDrawRange(0, Math.round(rain * 700) * 2);
  weather.rain.material.opacity = 0.16 + rain * 0.32;
  materials.asphalt.roughness = 0.65 - wetness * 0.43;
  materials.asphalt.envMapIntensity = 0.7 + wetness * 1.4;
  materials.asphalt.color.setRGB(0.65 - wetness * .25, 0.74 - wetness * .25, 0.82 - wetness * .25);
  scene.userData.puddles.material.opacity = wetness * .65;
  scene.userData.wetRibbons.material.opacity = 0.07 + wetness * 0.35;
  scene.userData.lampReflections.material.opacity = 0.25 + wetness * 0.65;
  scene.fog.far = 430 - rain * 180;
  const water = tyreSurface(wetness) === 'water';
  weather.spray.userData.surface = water ? 'water' : 'dust';
  weather.spray.material.color.set(water ? '#cbdce5' : '#98806b');
  weather.spray.material.opacity = water ? .45 + wetness * .25 : .18;
  weather.spray.material.size = water ? .07 + wetness * .06 : .16;
  ocean.material.uniforms.time.value += dt;
  weather.drops.forEach((drop, i) => {
    drop.y -= dt * (12 + rain * 12); drop.x -= dt * (2 + rain * 4);
    if (drop.y < -4.5 || drop.x < -7) { drop.y = 4.5; drop.x = (Math.random() - 0.5) * 14; }
    const offset = i * 6, buffer = weather.rainPositions;
    buffer[offset] = drop.x; buffer[offset + 1] = drop.y; buffer[offset + 2] = drop.z;
    buffer[offset + 3] = drop.x + 0.09 + rain * .1; buffer[offset + 4] = drop.y + 0.34 + rain * .3; buffer[offset + 5] = drop.z;
  });
  weather.rainGeo.attributes.position.needsUpdate = true;
  const frame = roadFrame(routeLength * simulation.frame.player.distance / race.length);
  weather.sprayBudget = Math.min(4, weather.sprayBudget + dt * (water ? 18 + wetness * 48 : 12));
  const sprayBursts = Math.floor(weather.sprayBudget); weather.sprayBudget -= sprayBursts;
  if (race.player.speed > 10) for (let burst = 0; burst < sprayBursts; burst++) for (const side of [-1, 1]) {
    const particle = weather.particles[weather.cursor] ?? {};
    particle.position = kart.position.clone().addScaledVector(frame.right, side * 0.36).addScaledVector(frame.tangent, -0.33);
    particle.position.y = 0.27;
    particle.velocity = frame.tangent.clone().multiplyScalar(-0.7 - Math.random() * 1.2).addScaledVector(frame.right, side * (0.3 + Math.random()));
    particle.velocity.y = water ? .25 + Math.random() * .35 : .1; particle.life = water ? .25 + Math.random() * .15 : .5;
    particle.gravity = water ? 2.2 : 0;
    weather.particles[weather.cursor] = particle; weather.cursor = (weather.cursor + 1) % 80;
  }
  weather.particles.forEach((particle, i) => {
    if (particle.life > 0) {
      particle.life -= dt; particle.position.addScaledVector(particle.velocity, dt);
      particle.velocity.y -= particle.gravity * dt;
    }
    const offset = i * 3, buffer = weather.sprayPositions;
    if (particle.life > 0) { buffer[offset] = particle.position.x; buffer[offset + 1] = Math.max(0.2, particle.position.y); buffer[offset + 2] = particle.position.z; }
    else { buffer[offset] = 0; buffer[offset + 1] = -100; buffer[offset + 2] = 0; }
  });
  weather.sprayGeo.attributes.position.needsUpdate = true;
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

function cableBranding(frame, timeOfDay) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 74px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = timeOfDay === 'Night' ? '#ffe3a0' : '#ecede2';
  ctx.fillText('Branding Available', 512, 128);
  // Cable-like strips break up the lettering, leaving sky and actual stays visible.
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 1024; x += 14) ctx.clearRect(x, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  for (const side of [1]) {
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(34, 8.5), new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: timeOfDay === 'Night' ? .95 : .65,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ad.name = 'Cable fan Branding Available';
    ad.position.copy(frame.point).addScaledVector(frame.tangent, 18).addScaledVector(frame.right, side * 3.15);
    ad.position.y = 9; ad.rotation.y = frame.yaw - side * Math.PI / 2;
    ad.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'vec2 brandUV = vMapUv; if (!gl_FrontFacing) brandUV.x = 1.0 - brandUV.x; diffuseColor *= texture2D(map, brandUV);');
    };
    scene.add(ad);
  }
}

function addWorld(data, pylonTemplate, asphalt, concrete, timeOfDay) {
  const [lon0, lat0] = data.route[0]; const cos = Math.cos(lat0 * Math.PI / 180);
  const pts = data.route.map(([lon, lat]) => new THREE.Vector3((lon - lon0) * 111320 * cos * SCALE, 0, (lat0 - lat) * 111320 * SCALE));
  curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.25);
  curve.arcLengthDivisions = 4096; curve.updateArcLengths();
  const samples = curve.getSpacedPoints(600);
  routeLength = curve.getLength();
  const roadSamples = [samples[0].clone().addScaledVector(curve.getTangentAt(0), -8), ...samples, samples.at(-1).clone().addScaledVector(curve.getTangentAt(1), 8)];
  const roadTangent = (i) => curve.getTangentAt(clamp((i - 1) / 600, 0, 1));
  const vertices = [], uvs = [], indices = [];
  for (let i = 0; i < roadSamples.length; i++) {
    const p = roadSamples[i], t = roadTangent(i); const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    for (const side of [-1, 1]) {
      vertices.push(p.x + right.x * roadHalfAt((i - 1) / 600 * routeLength) * side, 0.16, p.z + right.z * roadHalfAt((i - 1) / 600 * routeLength) * side);
      uvs.push(side + 1, (i - 1) / 600 * routeLength / 2);
    }
    if (i < roadSamples.length - 1) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const roadGeo = new THREE.BufferGeometry(); roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); roadGeo.setIndex(indices); roadGeo.computeVertexNormals();
  materials.asphalt.map = asphalt ?? asphaltTexture();
  // Neutralise the warm source texture so wet asphalt reads as slate, not dirt.
  materials.asphalt.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722))) * vec3(.7,.84,1.);');
  };
  const wetMaps = createWetSurfaceMaps();
  materials.asphalt.color.set('#64768a');
  materials.asphalt.roughness = 0.55; materials.asphalt.roughnessMap = wetMaps.roughness;
  materials.asphalt.normalMap = wetMaps.normal; materials.asphalt.normalScale.set(0.18, 0.18);
  materials.asphalt.envMapIntensity = 0.85;
  materials.asphalt.metalness = 0.02; materials.asphalt.needsUpdate = true;
  const road = new THREE.Mesh(roadGeo, materials.asphalt); road.material.side = THREE.DoubleSide; scene.add(road);
  ocean = createOcean(scene, curve);
  const deck = new THREE.Mesh(roadGeo.clone().translate(0, -0.5, 0), mat('#50545a', 0.65, 0.35)); deck.material.side = THREE.DoubleSide; scene.add(deck);
  const checks = new THREE.InstancedMesh(new THREE.PlaneGeometry(ROAD_HALF / 4, 0.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f3eee3', roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), 16);
  const checkPose = new THREE.Object3D(); let checkCount = 0;
  for (const finish of [false, true]) for (let row = 0; row < 2; row++) for (let col = 0; col < 8; col++) {
    if ((row + col) % 2) continue;
    const frame = roadFrame(finish ? routeLength - 1 + row * 0.4 : 1 + row * 0.4);
    checkPose.position.copy(frame.point).addScaledVector(frame.right, (col - 3.5) * ROAD_HALF / 4);
    checkPose.position.y = 0.19; checkPose.rotation.y = frame.yaw; checkPose.updateMatrix(); checks.setMatrixAt(checkCount++, checkPose.matrix);
  }
  scene.add(checks);
  // Continuous shoulder lines follow the sampled OSM curve, including its bends.
  const edgeVertices = [], edgeIndices = [];
  for (let i = 0; i < roadSamples.length; i++) {
    const p = roadSamples[i], t = roadTangent(i);
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    for (const side of [-1, 1]) for (const offset of [-0.035, 0.035]) {
      edgeVertices.push(p.x + right.x * (roadHalfAt((i - 1) / 600 * routeLength) - 0.28 + offset) * side, 0.185, p.z + right.z * (roadHalfAt((i - 1) / 600 * routeLength) - 0.28 + offset) * side);
    }
    if (i < roadSamples.length - 1) for (let side = 0; side < 2; side++) {
      const a = i * 4 + side * 2; edgeIndices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
    }
  }
  const edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3)); edgeGeo.setIndex(edgeIndices); edgeGeo.computeVertexNormals();
  const edges = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: '#e0ddd0', side: THREE.DoubleSide })); scene.add(edges);
  const barrierMaterial = mat(concrete ? '#eeeeee' : '#aeb6b7', 0.75);
  if (concrete) barrierMaterial.map = concrete;
  const barriers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.42, 1), barrierMaterial, 2 * 150);
  const railPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), materials.rail, 2 * 151);
  const railRuns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1), materials.rail, 2 * 150);
  const dummy = new THREE.Object3D(); let postIndex = 0, runIndex = 0;
  for (let i = 0; i <= 150; i++) {
    const frame = roadFrame(routeLength * i / 150);
    for (const side of [-1, 1]) {
      const pos = frame.point.clone().addScaledVector(frame.right, side * (frame.width + 0.12));
      dummy.position.set(pos.x, 0.75, pos.z); dummy.rotation.set(0, frame.yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); railPosts.setMatrixAt(postIndex++, dummy.matrix);
      if (i < 150) {
        const next = roadFrame(routeLength * (i + 1) / 150);
        const end = next.point.clone().addScaledVector(next.right, side * (next.width + 0.12));
        const span = end.clone().sub(pos); const mid = pos.clone().add(end).multiplyScalar(0.5);
        dummy.position.set(mid.x, 1.05, mid.z); dummy.rotation.set(0, Math.atan2(span.x, span.z), 0); dummy.scale.set(1, 1, span.length() + 0.08); dummy.updateMatrix(); railRuns.setMatrixAt(runIndex++, dummy.matrix);
        dummy.position.y = 0.34; dummy.scale.z = Math.max(0.1, span.length() - 0.05); dummy.updateMatrix(); barriers.setMatrixAt(runIndex - 1, dummy.matrix);
      }
    }
  }
  railPosts.count = postIndex; railRuns.count = barriers.count = runIndex; scene.add(barriers, railPosts, railRuns);
  const reflectors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.09, 0.32), new THREE.MeshBasicMaterial({ color: '#ffd18a' }), 2 * 76);
  let reflectorCount = 0;
  for (let i = 0; i <= 150; i += 2) {
    const frame = roadFrame(routeLength * i / 150);
    for (const side of [-1, 1]) {
      const pos = frame.point.clone().addScaledVector(frame.right, side * (frame.width - 0.03));
      dummy.position.set(pos.x, 0.48, pos.z); dummy.rotation.set(0, frame.yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      reflectors.setMatrixAt(reflectorCount++, dummy.matrix);
    }
  }
  reflectors.count = reflectorCount; scene.add(reflectors);
  // Dashed center line, edge reflectors and bridge lighting.
  const centerMarks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.035, 1.12), materials.marking, 600);
  const markerTransform = new THREE.Object3D(); let markerCount = 0;
  const lampCount = 2 * 50;
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.07, 4.4, 7), materials.rail, lampCount);
  const lampArm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.1, 0.12), materials.rail, lampCount);
  const lampBulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffe4b8' }), lampCount);
  const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffca83', transparent: true, opacity: 0.12, depthWrite: false }), lampCount);
  const reflections = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.15, 5.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: lampReflectionTexture(), transparent: true, opacity: timeOfDay === 'Night' ? 0.9 : timeOfDay === 'Sunset' ? 0.75 : 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), lampCount);
  let lightCount = 0;
  for (let i = 0; i < 600; i += 2) {
    const p = samples[i], t = curve.getTangentAt(i / 600), right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    for (const side of [-1, 1]) {
      markerTransform.position.set(p.x + right.x * side * ROAD_HALF / 3, 0.19, p.z + right.z * side * ROAD_HALF / 3);
      markerTransform.rotation.set(0, Math.atan2(t.x, t.z), 0); markerTransform.updateMatrix(); centerMarks.setMatrixAt(markerCount++, markerTransform.matrix);
    }
    if (i % 12 === 0) for (const side of [-1, 1]) {
      const base = p.clone().addScaledVector(right, side * (roadHalfAt(routeLength * i / 600) + 0.55));
      const inward = base.clone().addScaledVector(right, -side * 0.9);
      markerTransform.rotation.set(0, Math.atan2(t.x, t.z), 0); markerTransform.scale.set(1, 1, 1);
      markerTransform.position.set(base.x, 2.25, base.z); markerTransform.updateMatrix(); lampPole.setMatrixAt(lightCount, markerTransform.matrix);
      markerTransform.position.set(inward.x, 4.3, inward.z); markerTransform.updateMatrix(); lampArm.setMatrixAt(lightCount, markerTransform.matrix);
      markerTransform.position.y = 4.22; markerTransform.updateMatrix(); lampBulb.setMatrixAt(lightCount, markerTransform.matrix); glow.setMatrixAt(lightCount, markerTransform.matrix);
      markerTransform.position.y = 0.198; markerTransform.updateMatrix(); reflections.setMatrixAt(lightCount, markerTransform.matrix);
      lightCount++;
    }
  }
  centerMarks.count = markerCount; lampPole.count = lampArm.count = lampBulb.count = glow.count = reflections.count = lightCount;
  scene.add(centerMarks, lampPole, lampArm, lampBulb, glow, reflections);
  scene.userData.lampReflections = reflections;
  // Route signs sit near the bridge approaches, where overhead guidance belongs.
  for (const [fraction, title, subtitle] of [[0.11, 'To worli check point', 'KEEP LEFT  ↑'], [0.86, 'To worli check point', 'KEEP TO YOUR LANE  ↑']]) {
    const frame = roadFrame(routeLength * fraction);
    const gantry = new THREE.Group(); gantry.position.copy(frame.point); gantry.rotation.y = frame.yaw;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.65, 0.12), materials.rail);
      post.position.set(side * (ROAD_HALF + 0.62), 1.9, 0); gantry.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.12, 0.12), materials.rail); crossbar.position.y = 3.75; gantry.add(crossbar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.45, 0.84), new THREE.MeshBasicMaterial({ map: roadSignTexture(title, subtitle) }));
    sign.rotation.y = Math.PI; sign.position.set(0, 3.37, -0.09); gantry.add(sign); scene.add(gantry);
  }
  // Cable-stayed pylons and fine cables at four cinematic spans.
  for (const fraction of [0.035, 0.28, 0.72, 0.92]) {
    const frame = roadFrame(routeLength * fraction);
    cableBranding(frame, timeOfDay);
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
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.48, 0.85), new THREE.MeshBasicMaterial({ color: '#ffd99a', transparent: true, opacity: timeOfDay === 'Day' ? 0.25 : 0.8 }), 2400);
  const windowPose = new THREE.Object3D(); let windowCount = 0;
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
    tower.updateMatrixWorld();
    for (const face of [-1, 1]) for (let row = 0; row < Math.floor(h / 2.3); row++) for (let col = 0; col < 4; col++) {
      if ((row * 7 + col * 3 + i) % 5 < 2) continue;
      windowPose.position.set((col - 1.5) * 1.05, -h / 2 + 1.5 + row * 2.3, face * (3.51 + i % 3));
      windowPose.position.applyMatrix4(tower.matrixWorld);
      windowPose.rotation.set(0, end.yaw + (face < 0 ? Math.PI : 0), 0); windowPose.updateMatrix();
      windows.setMatrixAt(windowCount++, windowPose.matrix);
    }
  }
  windows.count = windowCount; scene.add(windows);
}

function makeEnvironment(timeOfDay) {
  const tones = { Morning: ['#a8a9ac', 0xffdab4], Day: ['#b7c9cd', 0xfff1dc], Sunset: ['#9c8a90', 0xffd0b2], Night: ['#2f3b54', 0x9cb9ef] };
  const [horizon, sun] = tones[timeOfDay] ?? tones.Sunset;
  scene.background = createSkyTexture(timeOfDay);
  scene.fog = new THREE.Fog(horizon, 100, 430);
  scene.add(new THREE.HemisphereLight(0xbacfe7, 0x293543, timeOfDay === 'Night' ? 0.5 : 0.95));
  const key = new THREE.DirectionalLight(sun, timeOfDay === 'Night' ? 0.65 : 1.55);
  key.position.set(-60, 70, 40); scene.add(key);
}

function showEvent(message) {
  const banner = $('#event-banner'); banner.textContent = message; banner.classList.add('visible'); window.clearTimeout(eventTimeout); eventTimeout = window.setTimeout(() => banner.classList.remove('visible'), 2400);
}

// Base (180 km/h) and boost (250 km/h) limits live in race-logic.js.
function unlockEngineAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context || disposed) return;
  try {
    if (!engineAudio) {
      const context = new Context();
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = 45;
      filter.type = 'lowpass';
      filter.frequency.value = 450;
      gain.gain.value = 0;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      const wind = context.createBufferSource(), windFilter = context.createBiquadFilter(), windGain = context.createGain();
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      wind.buffer = buffer; wind.loop = true; windFilter.type = 'highpass'; windFilter.frequency.value = 700;
      windGain.gain.value = 0; wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(gain); wind.start();
      const whine = context.createOscillator(), whineGain = context.createGain(), cues = context.createGain();
      whine.type = 'sine'; whineGain.gain.value = 0; whine.connect(whineGain); whineGain.connect(gain); whine.start();
      cues.gain.value = .1; cues.connect(context.destination);
      engineAudio = { context, oscillator, filter, gain, wind, windGain, whine, whineGain, cues };
    }
    void engineAudio.context.resume().catch(() => {});
  } catch {
    // Sound must never prevent driving.
  }
}

function updateEngineAudio(playerFrame, input) {
  if (!engineAudio) return;
  const { context, oscillator, filter, gain } = engineAudio;
  const active = !disposed && !paused && !race.finished && !document.hidden && !soundMuted;
  const speedRatio = clamp(playerFrame.speed / MAX_SPEED, 0, 1.4);
  const throttle = active && input.accelerate ? 1 : 0;
  const now = context.currentTime;
  oscillator.frequency.setTargetAtTime(45 + speedRatio * 140 + throttle * 15, now, 0.05);
  filter.frequency.setTargetAtTime(350 + speedRatio * 1100, now, 0.05);
  engineAudio.windGain.gain.setTargetAtTime(active ? speedRatio * .65 : 0, now, .1);
  engineAudio.whine.frequency.setTargetAtTime(550 + speedRatio * 450, now, .08);
  engineAudio.whineGain.gain.setTargetAtTime(active && race.player.boosting ? .45 : 0, now, .08);
  gain.gain.setTargetAtTime(active ? 0.025 + throttle * 0.025 : 0, now, 0.025);
}

// Reused world-space spark pool; no per-frame mesh allocation.
function createContactSparks() {
  const count = 48, positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions[i * 3 + 1] = -100;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: '#ffbd61', size: .055, transparent: true,
    opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false;
  scene.add(points);
  contactSparks = { points, positions, particles: Array.from({ length: count }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 })), cursor: 0 };
}

function emitContact(event) {
  if (event.speed < 2) return;
  const frame = roadFrame(routeLength * event.distance / race.length);
  const point = frame.point.clone().addScaledVector(frame.right, event.lane * SCALE);
  const count = Math.min(12, Math.ceil(event.speed));
  for (let n = 0; n < count; n++) {
    const i = contactSparks.cursor++ % contactSparks.particles.length, p = contactSparks.particles[i];
    p.life = .12 + Math.random() * .16;
    p.vx = (Math.random() - .5) * 2; p.vy = .6 + Math.random(); p.vz = (Math.random() - .5) * 2;
    contactSparks.positions.set([point.x, .35, point.z], i * 3);
  }
}

function updateContactSparks(dt) {
  const { particles, positions, points } = contactSparks;
  particles.forEach((p, i) => {
    p.life -= dt;
    if (p.life <= 0) { positions[i * 3 + 1] = -100; return; }
    p.vy -= 5 * dt;
    positions[i * 3] += p.vx * dt; positions[i * 3 + 1] += p.vy * dt; positions[i * 3 + 2] += p.vz * dt;
  });
  points.geometry.attributes.position.needsUpdate = true;
}

function playContactSound(speed) {
  if (!engineAudio || soundMuted || paused || document.hidden) return;
  const { context } = engineAudio, now = context.currentTime;
  const voice = context.createOscillator(), gain = context.createGain();
  voice.type = 'triangle'; voice.frequency.setValueAtTime(160, now);
  voice.frequency.exponentialRampToValueAtTime(45, now + .12);
  gain.gain.setValueAtTime(Math.min(1.5, .4 + speed * .04), now);
  gain.gain.exponentialRampToValueAtTime(.001, now + .14);
  voice.connect(gain); gain.connect(engineAudio.gain);
  voice.start(); voice.stop(now + .15);
  voice.onended = () => { voice.disconnect(); gain.disconnect(); };
}

function playRaceCue(finish = false) {
  if (!engineAudio || paused || soundMuted || document.hidden) return;
  const { context, cues } = engineAudio; cues.gain.value = .1;
  const notes = finish ? [392, 494, 587, 784] : [100, 120, 140, 180];
  notes.forEach((frequency, i) => {
    const voice = context.createOscillator(), envelope = context.createGain(), at = context.currentTime + i * .18;
    voice.type = finish ? 'triangle' : 'sine'; voice.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(.6, at + .015); envelope.gain.exponentialRampToValueAtTime(.001, at + .3);
    voice.connect(envelope); envelope.connect(cues); voice.start(at); voice.stop(at + .32);
    voice.onended = () => { voice.disconnect(); envelope.disconnect(); };
  });
}

function silenceEngineAudio() {
  if (!engineAudio) return;
  const { context, gain } = engineAudio;
  engineAudio.cues.gain.value = 0;
  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.setTargetAtTime(0, context.currentTime, 0.015);
}

function disposeEngineAudio() {
  if (!engineAudio) return;
  const { context, oscillator } = engineAudio;
  engineAudio = null;
  oscillator.stop();
  void context.close().catch(() => {});
}

function controls() {
  const input = Object.fromEntries(['left', 'right', 'accelerate', 'brake', 'drift', 'boost'].map((key) => [key, held.has(key)]));
  input.accelerate ||= input.boost || input.drift;
  return input;
}

function updateKart(object, playerFrame, dt, playerKart = false) {
  const { distance, lane, lateralSpeed } = playerFrame;
  const frame = roadFrame(routeLength * distance / race.length); const target = frame.point.clone().addScaledVector(frame.right, lane * SCALE);
  object.position.set(target.x, 0.16, target.z); object.rotation.y = frame.yaw;
  for (const wheel of object.userData.wheels) {
    const radius = wheel.name.includes('Rear') ? 0.35 : 0.30;
    wheel.rotation.x = -distance * SCALE / (radius * object.scale.x);
  }
  const [torso, head, hands] = object.userData.driver ?? [];
  const steer = clamp(lateralSpeed / 5.2, -1, 1);
  if (torso) {
    torso.rotation.z = THREE.MathUtils.damp(torso.rotation.z, -steer * .035 + Math.sin(visualTime * 2) * .003, 8, dt);
    head.rotation.y = THREE.MathUtils.damp(head.rotation.y, -steer * .12, 7, dt);
    head.rotation.x = Math.sin(visualTime * 1.7) * .012;
    hands.rotation.z = THREE.MathUtils.damp(hands.rotation.z, -steer * .1, 9, dt);
  }
  if (playerKart) {
    object.rotation.z = THREE.MathUtils.damp(object.rotation.z, -lateralSpeed * 0.018, 7, dt);
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
  $('#hud-sector').textContent = `SECTOR ${Math.min(3, Math.floor(progress * 3) + 1)} / 3`;
  $('#hud-boost').style.width = `${Math.round(p.charge * 100)}%`;
  const boostButton = $('[data-control=boost]');
  boostButton.classList.toggle('boost-active', p.boosting);
  boostButton.classList.toggle('recharging', !p.boosting && (p.charge < BOOST_MIN_CHARGE || p.boostExhausted));
  boostButton.style.setProperty('--charge', `${p.charge * 360}deg`);
  boostButton.setAttribute('aria-label', p.boosting ? 'Boost active' : p.boostExhausted ? 'Release boost to recharge' : p.charge < BOOST_MIN_CHARGE ? 'Boost recharging; hold to accelerate' : 'Hold boost to accelerate');
  const [x, y] = minimap.mapPoint(p.distance);
  minimap.player.setAttribute('cx', x); minimap.player.setAttribute('cy', y);
  race.rivals.forEach((rival, i) => { const [rx, ry] = minimap.mapPoint(rival.distance); minimap.rivals[i].setAttribute('cx', rx); minimap.rivals[i].setAttribute('cy', ry); });
}
function stepPosition() { return racePosition(race); }

function updateCamera(playerFrame, dt) {
  const frame = roadFrame(routeLength * playerFrame.distance / race.length);
  const tallPhone = camera.aspect < 0.52;
  const speed = clamp(playerFrame.speed / (250 / 3.6), 0, 1);
  const desiredFov = reducedMotion ? 60 : 60 + speed * 9 + (race.player.boosting ? 3 : 0);
  camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 5, dt); camera.updateProjectionMatrix();
  $('#speed-streaks').style.setProperty('--speed-intensity', reducedMotion ? 0 : Math.max(0, speed - .55) * (race.player.boosting ? .55 : .2));

  // Physics interpolation already smooths this pose; no extra camera follow lag.
  camera.position.copy(frame.point)
    .addScaledVector(frame.tangent, tallPhone ? -3 : -2.55)
    .addScaledVector(frame.right, playerFrame.lane * SCALE * 0.65);
  camera.position.y += tallPhone ? 1.75 : 1.65;

  cameraTarget.copy(frame.point)
    .addScaledVector(frame.tangent, 5.2)
    .addScaledVector(frame.right, playerFrame.lane * SCALE * 0.35);
  cameraTarget.y += 0.9;

  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 2.4);
  }
  camera.lookAt(cameraTarget);
  scene.userData.kartFill.position.copy(camera.position);
  scene.userData.kartFill.position.y += 2;
}

function tick(now) {
  if (disposed || paused) return;
  raf = requestAnimationFrame(tick);
  const dt = lastFrame ? Math.max(0, Math.min((now - lastFrame) / 1000, 0.25)) : 0; lastFrame = now;
  visualTime += dt;
  if (finishPresentation) { updateFinishPresentation(dt); return; }
  if (intro.phase === 'racing') {
    slowFrames = dt > .035 ? slowFrames + dt : Math.max(0, slowFrames - dt);
    if (slowFrames > 2 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - .2); renderer.setPixelRatio(pixelRatio); slowFrames = 0; }
  }
  if (intro.phase !== 'racing') {
    const ready = advanceIntro(intro, dt);
    updateKart(kart, simulation.frame.player, dt, true);
    simulation.frame.rivals.forEach((r, i) => updateKart(rivals[i], r, dt));
    updateReflections(); ocean.material.uniforms.time.value += dt;
    updateCamera(simulation.frame.player, dt);
    const start = roadFrame(0), t = intro.progress * intro.progress * (3 - 2 * intro.progress);
    const firstSpan = roadFrame(routeLength * .035);
    const aerial = firstSpan.point.clone().addScaledVector(firstSpan.tangent, 18).addScaledVector(firstSpan.right, 76).add(new THREE.Vector3(0, 18, 0));
    camera.position.lerpVectors(aerial, camera.position.clone(), t);
    cameraTarget.lerpVectors(firstSpan.point.clone().addScaledVector(firstSpan.tangent, 18).add(new THREE.Vector3(0, 9, 0)), cameraTarget.clone(), t);
    camera.lookAt(cameraTarget);
    scene.userData.kartFill.position.copy(camera.position).add(new THREE.Vector3(0, 2, 0));
    $('#intro-label').textContent = intro.phase === 'flyover' ? 'BANDRA TOLL PLAZA' : ready ? 'GO' : String(intro.count);
    $('#skip-intro').hidden = intro.phase !== 'flyover';
    $('#race-intro').hidden = ready;
    $('#game-view').classList.toggle('in-intro', !ready);
    renderer.render(scene, camera); renderHud(now);
    if (ready) showEvent('GO!');
    return;
  }
  const input = controls();
  const result = advanceSimulation(simulation, race, input, dt);
  updateEngineAudio(result.frame.player, input);
  if (!finalPush && !race.finished && race.length - race.player.distance <= 300) {
    finalPush = true; showEvent('FINAL PUSH · 300 m'); playRaceCue();
  }
  for (const lamp of kart.userData.lamps ?? []) lamp.emissiveIntensity = input.brake ? 2.5 : 0.7;
  updateKart(kart, result.frame.player, dt, true);
  result.frame.rivals.forEach((rivalFrame, i) => updateKart(rivals[i], rivalFrame, dt));
  updateReflections(); updateWeather(dt);
  updateBoostEffects(boostEffects, race.player.boosting && !race.finished, dt,
    roadFrame(routeLength * result.frame.player.distance / race.length), kart, weather.state.wetness);
  let strongestImpact = 0;
  for (const event of result.events) if (event.type === 'impact') {
    emitContact(event);
    if (event.a === 0 || event.b === 0) strongestImpact = Math.max(strongestImpact, event.speed);
  }
  if (strongestImpact > 0) {
    shake = Math.max(shake, Math.min(.14, strongestImpact * .004));
    playContactSound(strongestImpact);
  }
  if (result.events.some(event => event.type === 'barrier')) shake = Math.max(shake, .025);
  updateContactSparks(dt);
  // Late camera phase follows the exact same interpolated state as the models.
  updateCamera(result.frame.player, dt);
  renderer.render(scene, camera); renderHud(now);
  for (const event of result.events) {
    if (event.type !== 'impact') showEvent(event.text);
    if (event.type === 'finish') finishRace();
  }
}

function finishRace() {
  silenceEngineAudio(); clearControls();
  finishPresentation = createFinish(race, stepPosition());
  finishPresentation.rivals = simulation.frame.rivals.map(r => ({ ...r }));
  finishPresentation.cameraPosition = camera.position.clone(); finishPresentation.cameraTarget = cameraTarget.clone();
  $('#finish-moment').textContent = finishPresentation.position === 1 ? 'VICTORY' : 'FINISH';
  $('#finish-cinematic').hidden = false; $('#game-view').classList.add('finishing');
  $('#event-banner').classList.remove('visible'); $('#speed-streaks').style.setProperty('--speed-intensity', 0);
  playRaceCue(true);
  if (reducedMotion) finishPresentation.elapsed = finishPresentation.duration;
}

function showFinishResults() {
  const f = finishPresentation; if (!f) return;
  $('#finish-cinematic').hidden = true;
  $('#finish-title').textContent = f.position === 1 ? 'You won the Sea Link.' : `Finished ${f.position} / ${race.rivals.length + 1}`;
  $('#finish-copy').textContent = `Bandra to Worli · ${f.time.toFixed(2)} seconds · ${f.overtakes} overtakes`;
  $('#finish-overlay').hidden = false;
}

function updateFinishPresentation(dt) {
  const f = finishPresentation, state = advanceFinish(f, dt), end = roadFrame(routeLength);
  updateKart(kart, { distance: f.distance, lane: f.lane, lateralSpeed: 0 }, dt, true);
  kart.position.addScaledVector(end.tangent, state.coast);
  for (const wheel of kart.userData.wheels) wheel.rotation.x -= state.coast / (.35 * kart.scale.x);
  f.rivals.forEach((r, i) => updateKart(rivals[i], { ...r, distance: r.distance + Math.min(20, r.speed * .16 * f.elapsed) }, dt));
  const head = kart.userData.driver?.[1];
  if (head) head.rotation.x = f.position === 1 ? -.08 * Math.sin(state.progress * Math.PI) : .07 * Math.sin(state.progress * Math.PI);
  const target = kart.position.clone().add(new THREE.Vector3(0, .55, 0));
  const desired = kart.position.clone().addScaledVector(end.tangent, -2.4).addScaledVector(end.right, 2.2).add(new THREE.Vector3(0, 1.6, 0));
  const t = reducedMotion ? 0 : state.progress * state.progress * (3 - 2 * state.progress);
  camera.position.lerpVectors(f.cameraPosition, desired, t); cameraTarget.lerpVectors(f.cameraTarget, target, t); camera.lookAt(cameraTarget);
  scene.userData.kartFill.position.copy(camera.position).add(new THREE.Vector3(0, 2, 0));
  updateWeather(dt); updateContactSparks(dt);
  const shadow = scene.userData.shadowTransform;
  shadow.position.copy(kart.position); shadow.position.y = .18; shadow.rotation.set(0, end.yaw, 0); shadow.scale.set(1, 1, 1); shadow.updateMatrix();
  scene.userData.contactShadows.setMatrixAt(0, shadow.matrix); scene.userData.contactShadows.instanceMatrix.needsUpdate = true;
  renderer.render(scene, camera);
  if (state.done) { showFinishResults(); cancelAnimationFrame(raf); }
}

function clearControls() {
  held.clear();
  document.querySelectorAll('[data-control].pressed').forEach(button => button.classList.remove('pressed'));
}

function keyDown(event) { if (disposed) return; const key = keys[event.code]; if (key) { unlockEngineAudio(); held.add(key); event.preventDefault(); } if (event.code === 'Escape') pause(true); }
function keyUp(event) { if (disposed) return; const key = keys[event.code]; if (key) { held.delete(key); event.preventDefault(); } }
function pause(value) {
  if (disposed) return;
  paused = value; $('#pause-overlay').hidden = !value;
  if (value) { silenceEngineAudio(); clearControls(); cancelAnimationFrame(raf); }
  else { lastFrame = 0; raf = requestAnimationFrame(tick); }
}

function bindUi() {
  if (uiBound) return; uiBound = true;
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', () => { clearControls(); if (race && !disposed && !paused) pause(true); });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && race && !disposed && !paused) pause(true); });
  document.querySelectorAll('[data-control]').forEach((button) => {
    const start = (event) => { event.preventDefault(); if (disposed || paused || race.finished || intro.phase !== 'racing') return; unlockEngineAudio(); held.add(button.dataset.control); button.classList.add('pressed'); button.setPointerCapture?.(event.pointerId); };
    const end = (event) => { event.preventDefault(); held.delete(button.dataset.control); button.classList.remove('pressed'); };
    button.addEventListener('pointerdown', start); button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end); button.addEventListener('lostpointercapture', end);
  });
  $('#rain-helmet').addEventListener('click', () => {
    if (paused || disposed || race.finished || !kart.userData.helmet) return;
    helmetEquipped = true; kart.userData.helmet.visible = true;
    kart.userData.driver[1].traverse(part => { if (/hair/i.test(part.name)) part.visible = false; });
    $('#rain-helmet').classList.remove('prompt'); $('#rain-helmet').setAttribute('aria-pressed', 'true');
    $('#rain-helmet').setAttribute('aria-label', 'Rain helmet equipped');
    showEvent('Helmet on');
  });
  $('#skip-finish').addEventListener('click', () => { if (finishPresentation) { finishPresentation.elapsed = finishPresentation.duration; showFinishResults(); cancelAnimationFrame(raf); } });
  $('#skip-intro').addEventListener('click', () => { skipIntro(intro); });
  $('#pause-race').addEventListener('click', () => pause(true)); $('#resume-race').addEventListener('click', () => { unlockEngineAudio(); pause(false); });
  $('#exit-race').addEventListener('click', leave); $('#finish-exit').addEventListener('click', leave);
  $('#restart-race').addEventListener('click', () => { $('#finish-overlay').hidden = true; start(raceConfig, true); });
}
let raceConfig;
function leave() { dispose(); onExitCallback?.(); }
function dispose() {
  disposeEngineAudio();
  disposed = true; cancelAnimationFrame(raf); clearControls();
  scene?.background?.dispose?.();
  scene?.userData.environmentTarget?.dispose();
  const textures = new Set();
  scene?.traverse((object) => {
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  });
  textures.forEach((texture) => texture.dispose());
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
  scene?.traverse((object) => { object.geometry?.dispose?.(); if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.()); else object.material?.dispose?.(); });
  renderer = scene = camera = cameraTarget = weather = reflections = minimap = null;
}

async function start(config, retry = false) {
  dispose(); finishPresentation = null; finalPush = false; helmetEquipped = false; helmetPrompted = false; slowFrames = 0;
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#rain-helmet').hidden = true; $('#rain-helmet').classList.remove('prompt'); $('#rain-helmet').setAttribute('aria-pressed', 'false');
  $('#finish-cinematic').hidden = true; $('#game-view').classList.remove('finishing');
  disposed = false; paused = false; visualTime = 0; intro = createIntro(retry || window.matchMedia('(prefers-reduced-motion: reduce)').matches); raceConfig = config; lastFrame = 0; lastUi = 0; shake = 0;
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
  routeMeters = route.route.slice(1).reduce((total, [lon, lat], index) => {
    const [prevLon, prevLat] = route.route[index]; const dx = (lon - prevLon) * 111320 * Math.cos(((lat + prevLat) * 0.5) * Math.PI / 180); const dz = (lat - prevLat) * 111320;
    return total + Math.hypot(dx, dz);
  }, 0);
  textureModels(kartTemplate, pylonTemplate, fabric, concrete);
  if (fabric) { materials.shirt.map = fabric; materials.shirt.color.set('#e5e5e5'); materials.shirt.needsUpdate = true; }
  makeEnvironment(config.timeOfDay); addWorld(route, pylonTemplate, asphalt, concrete, config.timeOfDay);
  const plazaTemplate = kartTemplate?.getObjectByName('TollPlazaRoot');
  if (plazaTemplate) {
    const plaza = plazaTemplate.clone(true), frame = roadFrame(43 * SCALE);
    plaza.position.copy(frame.point); plaza.position.y = .16;
    plaza.rotation.set(0, frame.yaw, 0); plaza.scale.setScalar(SCALE); scene.add(plaza);
  }
  kart = kartTemplate ? modelKart(kartTemplate) : makeKart(); scene.add(kart);
  const kartFill = new THREE.DirectionalLight(0xd9e6ff, 1.15);
  kartFill.target = kart; scene.add(kartFill); scene.userData.kartFill = kartFill;
  const colors = ['#20baff', '#ffbd29', '#7fdf49', '#ac78ff', '#ff703e', '#29ddc5', '#fa62b5'];
  rivals = Array.from({ length: config.rivals }, (_, index) => { const object = kartTemplate ? modelKart(kartTemplate, colors[index % colors.length], index + 2) : makeKart(colors[index % colors.length]); object.scale.setScalar(KART_SCALE * 0.9); scene.add(object); return object; });
  race = createRace({ length: routeMeters, rivals: config.rivals, difficulty: config.difficulty, events: config.events });
  simulation = createSimulation(race);
  minimap = makeMinimap(); reflections = makeRoadReflections();
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6); renderer.setPixelRatio(pixelRatio); renderer.setSize(window.innerWidth, window.innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  // Filter the static sky once for PBR reflections, with no per-frame reflection pass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(scene.background);
  scene.environment = environment.texture; scene.userData.environmentTarget = environment;
  pmrem.dispose();
  $('#game-canvas').replaceChildren(renderer.domElement);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2600);
  weather = makeWeather(); createContactSparks(); boostEffects = createBoostEffects(kart, scene);
  const start = roadFrame(0); const tallPhone = camera.aspect < 0.52;
  camera.position.copy(start.point).addScaledVector(start.tangent, tallPhone ? -3 : -2.55).add(new THREE.Vector3(0, tallPhone ? 1.75 : 1.65, 0)); cameraTarget = start.point.clone().addScaledVector(start.tangent, 5.2).add(new THREE.Vector3(0, 0.9, 0)); camera.lookAt(cameraTarget);
  $('#race-intro').hidden = false; $('#game-view').classList.add('in-intro');
  bindUi(); $('#hud-field').textContent = `/ ${config.rivals + 1}`; $('#game-view').hidden = false; $('#hud-speed').textContent = '0';
  raf = requestAnimationFrame(tick);
}
function resize() { if (!renderer || !camera) return; camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }

export function startGame(config, onExit) { onExitCallback = onExit; return start(config); }
