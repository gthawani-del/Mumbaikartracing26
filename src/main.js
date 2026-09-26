import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import route from "./track.json";
import { newRace, tick, place, formatTime, LAPS } from "./race.js";
import "./style.css";
const $ = (id) => document.getElementById(id),
  touch = matchMedia("(pointer: coarse)").matches;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#91bfc6");
scene.fog = new THREE.Fog("#a9c6c6", 160, 620);
const camera = new THREE.PerspectiveCamera(
  55,
  innerWidth / innerHeight,
  0.1,
  1400,
);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
} catch (e) {
  $("loading").textContent =
    "WebGL is unavailable. Please use a browser with hardware acceleration.";
  throw e;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$("game").append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe4f8ff, 0x53634a, 2));
const sun = new THREE.DirectionalLight(0xffe1aa, 2.5);
sun.position.set(-80, 130, 50);
scene.add(sun);
const curve = new THREE.CatmullRomCurve3(
  route.map((p) => new THREE.Vector3(p[0], 0.1, p[2])),
  true,
  "centripetal",
);
curve.arcLengthDivisions = 2400;
const length = curve.getLength();
let race = newRace(length),
  mode = "loading",
  count = 3,
  clock = 0,
  ready = false,
  sound = false,
  audio,
  engine,
  gain;
const models = {},
  karts = [],
  input = {
    left: false,
    right: false,
    accelerate: false,
    brake: false,
    drift: false,
    boost: false,
  };
const loader = new GLTFLoader();
function locate(distance, lane = 0) {
  const t = (((distance / length) % 1) + 1) % 1,
    p = curve.getPointAt(t),
    v = curve.getTangentAt(t);
  p.add(new THREE.Vector3(v.z, 0, -v.x).multiplyScalar(lane));
  return { p, v, angle: Math.atan2(v.x, v.z) };
}
function normalize(root, size) {
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root),
    dim = box.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(size / Math.max(dim.x, dim.y, dim.z));
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group();
  wrap.add(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return wrap;
}
function clone(name, size) {
  const root = models[name].clone(true);
  if (["auto", "bus", "taxi"].includes(name)) root.rotation.y = Math.PI / 2;
  return normalize(root, size);
}
async function load() {
  try {
    const assets = [
      ["track", "marine-drive.glb"],
      ["auto", "auto.glb"],
      ["bus", "bus.glb"],
      ["taxi", "taxi.glb"],
      ["building", "building.glb"],
      ["palm", "palm.glb"],
    ];
    for (let i = 0; i < assets.length; i++) {
      const [name, file] = assets[i];
      $("loading").textContent =
        `Loading ${name} · ${i + 1} / ${assets.length}`;
      models[name] = (await loader.loadAsync(`/assets/${file}`)).scene;
    }
    models.track.traverse((o) => {
      if (o.isLight || o.isCamera) o.visible = false;
    });
    scene.add(models.track);
    for (let i = 0; i < 6; i++) {
      const kart = clone("auto", 3.6);
      scene.add(kart);
      karts.push(kart);
      const color = [
        0xffd06a, 0x52cce0, 0xef7e65, 0xa8dc79, 0xbb94ef, 0xffffff,
      ][i];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.03, 32),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      kart.add(ring);
    }
    for (let i = 0; i < 32; i++) {
      const at = locate((i / 32) * length, -25 - (i % 3) * 7),
        b = clone("building", 15 + (i % 4) * 3);
      b.position.copy(at.p);
      b.rotation.y = at.angle + Math.PI / 2;
      scene.add(b);
    }
    for (let i = 0; i < 48; i++) {
      const at = locate((i / 48) * length, i % 2 ? 11.5 : -12.5),
        p = clone("palm", 9 + (i % 3));
      p.position.copy(at.p);
      p.rotation.y = i * 1.4;
      scene.add(p);
    }
    for (let i = 0; i < 8; i++) {
      const at = locate(((i + 0.45) / 8) * length, -19),
        v = clone(i % 3 === 0 ? "bus" : "taxi", i % 3 === 0 ? 8 : 4.2);
      v.position.copy(at.p);
      v.rotation.y = at.angle;
      scene.add(v);
    }
    ready = true;
    mode = "menu";
    $("start").disabled = false;
    $("start").textContent = "Start your engines →";
    $("loading").textContent = "Circuit ready · Keyboard + touch";
    placeKarts();
  } catch (e) {
    console.error(e);
    $("loading").textContent =
      "An asset could not load. Check your connection and reload.";
    $("start").textContent = "Reload assets";
    $("start").disabled = false;
    $("start").onclick = () => location.reload();
  }
}
function placeKarts() {
  [race.player, ...race.rivals].forEach((r, i) => {
    if (!karts[i]) return;
    const at = locate(r.distance, r.lane);
    karts[i].position.copy(at.p);
    karts[i].rotation.y = at.angle + (i === 0 ? race.player.drift * 0.22 : 0);
  });
}
function clearInput() {
  Object.keys(input).forEach((k) => (input[k] = false));
  document
    .querySelectorAll("[data-control]")
    .forEach((b) => b.classList.remove("active"));
}
function showRace(active) {
  $("menu").hidden = active;
  $("footer").hidden = active;
  $("hud").hidden = !active;
  $("dashboard").hidden = !active;
  $("touch").hidden = !active || !touch;
  $("pause").disabled = !active;
}
function start() {
  if (!ready) return;
  race = newRace(length);
  mode = "countdown";
  count = 3;
  clearInput();
  showRace(true);
  $("overlay").hidden = true;
  $("pause").textContent = "Pause";
  placeKarts();
  const at = locate(0);
  camera.position.copy(at.p).addScaledVector(at.v, -9);
  camera.position.y += 4.5;
  if (audio) audio.resume();
}
function pause() {
  if (!["racing", "countdown", "paused"].includes(mode)) return;
  if (mode === "paused") {
    mode = resumeMode;
    $("overlay").hidden = true;
    $("pause").textContent = "Pause";
    return;
  }
  resumeMode = mode;
  mode = "paused";
  clearInput();
  $("overlay").hidden = false;
  $("overlay-label").textContent = "RACE PAUSED";
  $("result").textContent = "Take a breather.";
  $("result-detail").textContent = "Your race will continue from here.";
  $("resume").hidden = false;
  $("pause").textContent = "Resume";
  $("countdown").textContent = "";
}
let resumeMode = "racing";
function finish() {
  mode = "finished";
  $("overlay").hidden = false;
  $("overlay-label").textContent = "CHEQUERED FLAG";
  $("result").textContent =
    `You finished ${["", "1st", "2nd", "3rd", "4th", "5th", "6th"][place(race)]}.`;
  $("result-detail").textContent =
    `3 laps · ${formatTime(race.time)} · Marine Drive`;
  $("resume").hidden = true;
  $("pause").disabled = true;
  clearInput();
  try {
    const prev = Number(localStorage.getItem("mkr26-best")) || Infinity;
    if (race.time < prev) localStorage.setItem("mkr26-best", race.time);
    $("result-detail").textContent +=
      ` · Best ${formatTime(Math.min(prev, race.time))}`;
  } catch {}
}
$("start").onclick = start;
$("restart").onclick = start;
$("resume").onclick = pause;
$("pause").onclick = pause;
$("home").onclick = () => {
  mode = "menu";
  clearInput();
  showRace(false);
  $("overlay").hidden = true;
  $("countdown").textContent = "";
};
const keymap = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "accelerate",
  KeyW: "accelerate",
  ArrowDown: "brake",
  KeyS: "brake",
  Space: "drift",
  ShiftLeft: "boost",
  ShiftRight: "boost",
};
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !e.repeat) pause();
  if (keymap[e.code]) {
    e.preventDefault();
    input[keymap[e.code]] = true;
  }
});
addEventListener("keyup", (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = false;
});
addEventListener("blur", () => {
  clearInput();
  if (mode === "racing" || mode === "countdown") pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInput();
    if (mode === "racing" || mode === "countdown") pause();
  }
});
for (const b of document.querySelectorAll("[data-control]")) {
  b.onpointerdown = (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    input[b.dataset.control] = true;
    b.classList.add("active");
  };
  const release = () => {
    input[b.dataset.control] = false;
    b.classList.remove("active");
  };
  b.onpointerup = release;
  b.onpointercancel = release;
  b.onlostpointercapture = release;
}
$("sound").onclick = () => {
  sound = !sound;
  if (sound && !audio) {
    audio = new AudioContext();
    engine = audio.createOscillator();
    engine.type = "sawtooth";
    gain = audio.createGain();
    gain.gain.value = 0;
    engine.connect(gain);
    gain.connect(audio.destination);
    engine.start();
  }
  if (audio) audio.resume();
  $("sound").textContent = sound ? "Sound on" : "Sound off";
};
const mini = $("minimap").getContext("2d"),
  mapPoints = route.map((p) => [90 + p[0] * 0.48, 90 + p[2] * 0.48]);
function minimap() {
  mini.clearRect(0, 0, 180, 180);
  mini.strokeStyle = "#cadad8";
  mini.lineWidth = 4;
  mini.beginPath();
  mapPoints.forEach(([x, y], i) => (i ? mini.lineTo(x, y) : mini.moveTo(x, y)));
  mini.closePath();
  mini.stroke();
  [...race.rivals, race.player].forEach((r, i) => {
    const p = locate(r.distance).p;
    mini.beginPath();
    mini.fillStyle = i === 5 ? "#ffd078" : "#ffffff";
    mini.arc(
      90 + p.x * 0.48,
      90 + p.z * 0.48,
      i === 5 ? 4 : 2.5,
      0,
      Math.PI * 2,
    );
    mini.fill();
  });
}
const target = new THREE.Vector3(),
  camTarget = new THREE.Vector3();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  clock += dt;
  if (mode === "countdown") {
    count -= dt;
    $("countdown").textContent = count > 0 ? Math.ceil(count) : "GO!";
    if (count < -0.6) {
      mode = "racing";
      $("countdown").textContent = "";
    }
  }
  if (mode === "racing") {
    tick(race, { ...input, accelerate: touch || input.accelerate }, dt);
    if (race.finished) finish();
  }
  if (ready) {
    placeKarts();
    if (mode === "menu") {
      const at = locate(clock * 3);
      target.copy(at.p);
      target.y += 1;
      camTarget.copy(at.p).add(new THREE.Vector3(16, 9, 20));
    } else {
      const at = locate(race.player.distance, race.player.lane);
      target.copy(at.p).addScaledVector(at.v, 10);
      target.y += 1.7;
      camTarget.copy(at.p).addScaledVector(at.v, -9);
      camTarget.y += 4.5;
    }
    camera.position.lerp(camTarget, 1 - Math.exp(-dt * 5));
    camera.lookAt(target);
    $("speed").textContent = Math.round(race.player.speed * 3.6);
    $("lap").textContent =
      `${Math.min(LAPS, Math.floor(race.player.distance / length) + 1)} / 3`;
    $("position").textContent = `${place(race)} / 6`;
    $("time").textContent = formatTime(race.time);
    $("boost-fill").style.width = `${race.player.boost * 100}%`;
    minimap();
  } else {
    camera.position.set(100, 80, 180);
    camera.lookAt(0, 0, 0);
  }
  if (audio) {
    gain.gain.setTargetAtTime(
      sound && mode === "racing" ? 0.018 : 0,
      audio.currentTime,
      0.1,
    );
    engine.frequency.setTargetAtTime(
      45 + race.player.speed * 4,
      audio.currentTime,
      0.1,
    );
  }
  renderer.render(scene, camera);
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
requestAnimationFrame(frame);
load();
