import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import route from "./track.json";
import { newRace, tick, place, formatTime, LAPS } from "./race.js";
import "./style.css";
const $ = (id) => document.getElementById(id),
  touch = matchMedia("(pointer: coarse)").matches;
const scene = new THREE.Scene();
const skyCanvas = document.createElement("canvas");
skyCanvas.width = 8;
skyCanvas.height = 256;
const skyContext = skyCanvas.getContext("2d");
const skyGradient = skyContext.createLinearGradient(0, 0, 0, skyCanvas.height);
skyGradient.addColorStop(0, "#172b48");
skyGradient.addColorStop(0.48, "#526981");
skyGradient.addColorStop(0.76, "#d17c65");
skyGradient.addColorStop(1, "#f3b276");
skyContext.fillStyle = skyGradient;
skyContext.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
const sky = new THREE.CanvasTexture(skyCanvas);
sky.colorSpace = THREE.SRGBColorSpace;
scene.background = sky;
scene.fog = new THREE.Fog("#53677a", 220, 760);
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
scene.add(new THREE.HemisphereLight(0xc8dcff, 0x5a3b33, 1.55));
const sun = new THREE.DirectionalLight(0xffb47c, 2.2);
sun.position.set(-90, 55, 80);
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
  engineFilter,
  gain;
const models = {},
  karts = [],
  wheelSets = [],
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
const kartColors = [
  0xffd080, 0x55c8dd, 0xef816d, 0xa6d97c, 0xbe9bea, 0xf0f2eb,
];
function makeDriver(kart, index) {
  const driver = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: [0x21364a, 0x622f28, 0x293d2a, 0x45315b, 0x173b49, 0x4f3b24][index],
    roughness: 0.82,
  });
  const helmet = new THREE.MeshStandardMaterial({
    color: kartColors[index],
    roughness: 0.35,
    metalness: 0.12,
  });
  const visor = new THREE.MeshStandardMaterial({
    color: 0x14242f,
    roughness: 0.2,
    metalness: 0.2,
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 3, 8), suit);
  torso.position.set(0, 1.18, 0.05);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), helmet);
  head.position.set(0, 1.54, 0.13);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.075, 0.12), visor);
  face.position.set(0, 1.55, 0.29);
  driver.add(torso, head, face);
  driver.traverse((part) => {
    if (part.isMesh) {
      part.castShadow = false;
      part.receiveShadow = false;
    }
  });
  kart.add(driver);
}
function makeWheels(kart) {
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x171c20, roughness: 0.92 });
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: 0xa9b2b5,
    metalness: 0.72,
    roughness: 0.32,
  });
  const centers = [
    [0, 0.35, 1.22],
    [-0.53, 0.35, -0.9],
    [0.53, 0.35, -0.9],
  ];
  const wheels = centers.map(([x, y, z]) => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 7, 14), tireMaterial);
    tire.rotation.y = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.15, 10), hubMaterial);
    hub.rotation.z = Math.PI / 2;
    wheel.add(tire, hub);
    wheel.position.set(x, y, z);
    wheel.traverse((part) => {
      if (part.isMesh) {
        part.castShadow = false;
        part.receiveShadow = false;
      }
    });
    kart.add(wheel);
    return wheel;
  });
  wheelSets.push(wheels);
}
function addStreetLights() {
  const poleGeometry = new THREE.CylinderGeometry(0.07, 0.11, 5.2, 7);
  const armGeometry = new THREE.CylinderGeometry(0.055, 0.08, 1.1, 7);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x253849,
    metalness: 0.7,
    roughness: 0.42,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffa649,
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  for (let i = 0; i < 18; i++) {
    const at = locate((i / 18) * length, i % 2 ? 16 : -16);
    const light = new THREE.Group();
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 2.6;
    const arm = new THREE.Mesh(armGeometry, poleMaterial);
    arm.position.set(i % 2 ? -0.42 : 0.42, 5.04, 0);
    arm.rotation.z = i % 2 ? -0.55 : 0.55;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampMaterial);
    bulb.position.set(i % 2 ? -0.78 : 0.78, 4.75, 0);
    light.add(pole, arm, bulb);
    light.position.copy(at.p);
    light.rotation.y = at.angle;
    scene.add(light);
  }
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
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const material of materials) {
          if (!material?.name?.toLowerCase().includes("asphalt")) continue;
          material.roughness = 0.4;
          material.metalness = 0.12;
          material.envMapIntensity = 0.7;
          material.needsUpdate = true;
        }
      }
    });
    scene.add(models.track);
    for (let i = 0; i < 6; i++) {
      const kart = clone("auto", 3.6);
      const livery = [0xfff4e2, 0xc6e7f2, 0xf2d0c6, 0xd8ecc7, 0xe1d7f0, 0xf1f1e8][i];
      kart.traverse((part) => {
        if (!part.isMesh) return;
        part.material = Array.isArray(part.material)
          ? part.material.map((material) => material.clone())
          : part.material.clone();
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        for (const material of materials) material.color?.multiply(new THREE.Color(livery));
      });
      scene.add(kart);
      karts.push(kart);
      makeWheels(kart);
      makeDriver(kart, i);
    }
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? 1 : -1;
      const at = locate((i / 24) * length, side * (27 + (i % 3) * 3)),
        b = clone("building", 10 + (i % 4) * 1.5);
      b.position.copy(at.p);
      b.rotation.y = at.angle + Math.PI / 2;
      scene.add(b);
    }
    for (let i = 0; i < 36; i++) {
      const at = locate((i / 36) * length, i % 2 ? 13.5 : -13.5),
        p = clone("palm", 7.5 + (i % 3) * 0.8);
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
    addStreetLights();
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
    karts[i].rotation.z = i === 0 ? -race.player.lateralSpeed * 0.009 : 0;
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
  camera.position.y += 2.8;
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
    if (mode === "racing") input[keymap[e.code]] = true;
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
    if (mode !== "racing") return;
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
    engineFilter = audio.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 950;
    gain = audio.createGain();
    gain.gain.value = 0;
    engine.connect(engineFilter);
    engineFilter.connect(gain);
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
    for (let i = 0; i < wheelSets.length; i++) {
      const kartSpeed = i === 0 ? race.player.speed : race.rivals[i - 1]?.speed ?? 0;
      const wheels = wheelSets[i];
      for (const wheel of wheels) {
        wheel.rotation.x =
          (wheel.rotation.x + kartSpeed * dt / 0.3) % (Math.PI * 2);
      }
    }
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
      camTarget.copy(at.p).addScaledVector(at.v, -11);
      camTarget.y += 2.8;
    }
    camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4));
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
      sound && mode === "racing" ? 0.01 + (race.player.speed / 31) * 0.014 : 0,
      audio.currentTime,
      0.1,
    );
    engine.frequency.setTargetAtTime(
      45 + race.player.speed * 4,
      audio.currentTime,
      0.1,
    );
    engineFilter.frequency.setTargetAtTime(
      550 + race.player.speed * 32,
      audio.currentTime,
      0.12,
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
