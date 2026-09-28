import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import route from "./track.json";
import {
  newRace,
  tick,
  place,
  formatTime,
  LAPS,
  HANDLING,
  clamp,
} from "./race.js";
import "./style.css";
const $ = (id) => document.getElementById(id),
  touch = matchMedia("(pointer: coarse)").matches;
const scene = new Scene();
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
const sky = new CanvasTexture(skyCanvas);
sky.colorSpace = SRGBColorSpace;
scene.background = sky;
scene.fog = new Fog("#53677a", 220, 760);
const camera = new PerspectiveCamera(
  55,
  innerWidth / innerHeight,
  0.1,
  1400,
);
let renderer;
try {
  renderer = new WebGLRenderer({
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
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$("game").append(renderer.domElement);
scene.add(new HemisphereLight(0xc8dcff, 0x5a3b33, 1.55));
const sun = new DirectionalLight(0xffb47c, 2.2);
sun.position.set(-90, 55, 80);
scene.add(sun);
const curve = new CatmullRomCurve3(
  route.map((p) => new Vector3(p[0], 0.1, p[2])),
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
  boostFlames = [],
  smokePuffs = [],
  skidMarks = [],
  impactSparks = [],
  input = {
    left: false,
    right: false,
    accelerate: false,
    brake: false,
    drift: false,
    boost: false,
  };
let smokeCursor = 0,
  skidCursor = 0,
  smokeClock = 0,
  skidClock = 0,
  impactShakeTime = 0,
  impactShakeDuration = 0.26,
  impactShakeStrength = 0;
const loader = new GLTFLoader();
function locate(distance, lane = 0) {
  const t = (((distance / length) % 1) + 1) % 1,
    p = curve.getPointAt(t),
    v = curve.getTangentAt(t);
  p.add(new Vector3(v.z, 0, -v.x).multiplyScalar(lane));
  return { p, v, angle: Math.atan2(v.x, v.z) };
}
function normalize(root, size) {
  root.updateMatrixWorld(true);
  let box = new Box3().setFromObject(root),
    dim = box.getSize(new Vector3());
  root.scale.multiplyScalar(size / Math.max(dim.x, dim.y, dim.z));
  root.updateMatrixWorld(true);
  box = new Box3().setFromObject(root);
  const c = box.getCenter(new Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new Group();
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
  const driver = new Group();
  const suit = new MeshStandardMaterial({
    color: [0x21364a, 0x622f28, 0x293d2a, 0x45315b, 0x173b49, 0x4f3b24][index],
    roughness: 0.82,
  });
  const helmet = new MeshStandardMaterial({
    color: kartColors[index],
    roughness: 0.35,
    metalness: 0.12,
  });
  const visor = new MeshStandardMaterial({
    color: 0x14242f,
    roughness: 0.2,
    metalness: 0.2,
  });
  const torso = new Mesh(new CapsuleGeometry(0.2, 0.34, 3, 8), suit);
  torso.position.set(0, 1.18, 0.05);
  const head = new Mesh(new SphereGeometry(0.19, 12, 8), helmet);
  head.position.set(0, 1.54, 0.13);
  const face = new Mesh(new BoxGeometry(0.25, 0.075, 0.12), visor);
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
function addPlayerAccent(kart) {
  const material = new MeshStandardMaterial({
    color: 0x29e0d0,
    emissive: 0x06433e,
    emissiveIntensity: 0.8,
    roughness: 0.38,
    metalness: 0.18,
  });
  const playerPlate = new Mesh(new BoxGeometry(0.72, 0.2, 0.06), material);
  playerPlate.position.set(0, 0.55, -1.76);
  playerPlate.castShadow = false;
  playerPlate.receiveShadow = false;
  kart.add(playerPlate);
}
function setupPlayerEffects(kart) {
  const flameGeometry = new ConeGeometry(0.17, 0.72, 7);
  const flameMaterial = new MeshBasicMaterial({
    color: 0xff9b43,
    transparent: true,
    opacity: 0.82,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (const x of [-0.27, 0.27]) {
    const flame = new Mesh(flameGeometry, flameMaterial);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, 0.42, -2.08);
    flame.visible = false;
    kart.add(flame);
    boostFlames.push(flame);
  }

  const smokeCanvas = document.createElement("canvas");
  smokeCanvas.width = 64;
  smokeCanvas.height = 64;
  const smokeContext = smokeCanvas.getContext("2d");
  const smokeGradient = smokeContext.createRadialGradient(32, 32, 2, 32, 32, 32);
  smokeGradient.addColorStop(0, "rgba(240,243,240,0.62)");
  smokeGradient.addColorStop(0.42, "rgba(220,226,222,0.34)");
  smokeGradient.addColorStop(0.78, "rgba(205,213,209,0.12)");
  smokeGradient.addColorStop(1, "rgba(205,213,209,0)");
  smokeContext.fillStyle = smokeGradient;
  smokeContext.fillRect(0, 0, 64, 64);
  const smokeTexture = new CanvasTexture(smokeCanvas);
  smokeTexture.colorSpace = SRGBColorSpace;
  const smokeMaterial = new SpriteMaterial({
    map: smokeTexture,
    color: 0xd5dad7,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  for (let i = 0; i < 8; i++) {
    const puff = new Sprite(smokeMaterial.clone());
    puff.visible = false;
    puff.userData.age = 0;
    scene.add(puff);
    smokePuffs.push(puff);
  }

  const skidGeometry = new PlaneGeometry(0.2, 0.55);
  const skidMaterial = new MeshBasicMaterial({
    color: 0x171918,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: DoubleSide,
  });
  for (let i = 0; i < 24; i++) {
    const mark = new Mesh(skidGeometry, skidMaterial.clone());
    mark.rotation.x = -Math.PI / 2;
    mark.visible = false;
    mark.userData.age = 0;
    scene.add(mark);
    skidMarks.push(mark);
  }

  const sparkGeometry = new SphereGeometry(0.055, 6, 4);
  const sparkMaterial = new MeshBasicMaterial({
    color: 0xffc56a,
    transparent: true,
    depthWrite: false,
  });
  for (let i = 0; i < 8; i++) {
    const spark = new Mesh(sparkGeometry, sparkMaterial.clone());
    spark.visible = false;
    spark.userData.velocity = new Vector3();
    spark.userData.age = 0;
    spark.userData.life = 0.28;
    scene.add(spark);
    impactSparks.push(spark);
  }
}
function emitDriftEffects(kart) {
  const rearWheels = [
    new Vector3(-0.53, 0.24, -0.9),
    new Vector3(0.53, 0.24, -0.9),
  ];
  for (const offset of rearWheels) {
    const puff = smokePuffs[smokeCursor++ % smokePuffs.length];
    puff.position.copy(kart.localToWorld(offset.clone()));
    puff.scale.setScalar(0.55);
    puff.material.opacity = 0.55;
    puff.userData.age = 0;
    puff.visible = true;

    const mark = skidMarks[skidCursor++ % skidMarks.length];
    const markPosition = kart.localToWorld(offset.clone());
    mark.position.set(markPosition.x, 0.145, markPosition.z);
    mark.rotation.set(-Math.PI / 2, kart.rotation.y, 0);
    mark.material.opacity = 0.32;
    mark.userData.age = 0;
    mark.visible = true;
  }
}
function startImpactBurst(kart, events) {
  const impactSpeed = events.impactSpeed || 0;
  const severity = clamp(impactSpeed / HANDLING.boostTopSpeed, 0, 1);
  impactShakeDuration = events.spinoutStarted ? 0.46 : 0.26;
  impactShakeTime = impactShakeDuration;
  impactShakeStrength =
    (0.015 + severity * 0.17) * (events.spinoutStarted ? 1.2 : 1);
  if (impactSpeed < 12) return;

  kart.updateMatrixWorld(true);
  const wallScrape = events.impactType === "wall";
  const localOrigin = new Vector3(
    wallScrape ? events.impactSide * 0.62 : events.impactSide * 0.24,
    0.38,
    wallScrape ? 0 : 1.42,
  );
  const origin = kart.localToWorld(localOrigin.clone());
  for (let i = 0; i < impactSparks.length; i++) {
    const spark = impactSparks[i];
    const angle = (i / impactSparks.length) * Math.PI * 2;
    const localDirection = wallScrape
      ? new Vector3(
          events.impactSide * (1 + Math.random() * 0.25),
          0.45 + Math.random() * 0.8,
          Math.sin(angle) * 0.6,
        )
      : new Vector3(
          Math.sin(angle) * 0.8,
          0.65 + Math.random() * 0.75,
          -0.75 + Math.cos(angle) * 0.35,
        );
    const velocityPoint = kart.localToWorld(
      localOrigin.clone().add(localDirection),
    );
    spark.position.copy(origin).add(
      new Vector3(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08,
      ),
    );
    spark.userData.velocity
      .copy(velocityPoint.sub(origin))
      .normalize()
      .multiplyScalar(3 + severity * 5);
    spark.userData.age = 0;
    spark.userData.life = 0.24 + severity * 0.08;
    spark.material.opacity = 0.9;
    spark.scale.setScalar(0.75 + severity * 0.45);
    spark.visible = true;
  }
}
function updatePlayerEffects(dt, events) {
  const boosting = mode === "racing" && Boolean(events?.boosting);
  $("speed-lines").classList.toggle("active", boosting);
  boostFlames.forEach((flame, i) => {
    flame.visible = boosting;
    if (boosting) {
      const pulse = 0.78 + Math.sin(clock * 42 + i * 1.7) * 0.2;
      flame.scale.set(0.8 + pulse * 0.25, pulse, 0.8 + pulse * 0.25);
    }
  });

  const drifting = mode === "racing" && Boolean(events?.drifting);
  if (drifting) {
    smokeClock += dt;
    skidClock += dt;
    if (smokeClock >= 0.13 || skidClock >= 0.17) {
      emitDriftEffects(karts[0]);
      smokeClock = 0;
      skidClock = 0;
    }
  } else {
    smokeClock = 0;
    skidClock = 0;
  }

  for (const puff of smokePuffs) {
    if (!puff.visible) continue;
    puff.userData.age += dt;
    const progress = puff.userData.age / 0.72;
    if (progress >= 1) {
      puff.visible = false;
      continue;
    }
    puff.position.y += dt * 0.3;
    puff.scale.set(0.62 + progress * 0.78, 0.48 + progress * 0.56, 1);
    puff.material.opacity = 0.55 * (1 - progress);
  }
  for (const mark of skidMarks) {
    if (!mark.visible) continue;
    mark.userData.age += dt;
    const progress = mark.userData.age / 1.9;
    if (progress >= 1) {
      mark.visible = false;
      continue;
    }
    mark.material.opacity = 0.32 * (1 - progress);
  }

  if (events?.impact && karts[0]) startImpactBurst(karts[0], events);
  impactShakeTime = Math.max(0, impactShakeTime - dt);
  for (const spark of impactSparks) {
    if (!spark.visible) continue;
    spark.userData.age += dt;
    const progress = spark.userData.age / spark.userData.life;
    if (progress >= 1) {
      spark.visible = false;
      continue;
    }
    spark.position.addScaledVector(spark.userData.velocity, dt);
    spark.userData.velocity.y -= 8 * dt;
    spark.material.opacity = 0.95 * (1 - progress);
    spark.scale.setScalar(1 - progress * 0.65);
  }
}
function makeWheels(kart) {
  const tireMaterial = new MeshStandardMaterial({ color: 0x171c20, roughness: 0.92 });
  const hubMaterial = new MeshStandardMaterial({
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
    const wheel = new Group();
    const tire = new Mesh(new TorusGeometry(0.3, 0.08, 7, 14), tireMaterial);
    tire.rotation.y = Math.PI / 2;
    const hub = new Mesh(new CylinderGeometry(0.135, 0.135, 0.15, 10), hubMaterial);
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
  const poleGeometry = new CylinderGeometry(0.07, 0.11, 5.2, 7);
  const armGeometry = new CylinderGeometry(0.055, 0.08, 1.1, 7);
  const poleMaterial = new MeshStandardMaterial({
    color: 0x253849,
    metalness: 0.7,
    roughness: 0.42,
  });
  const lampMaterial = new MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffa649,
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  for (let i = 0; i < 18; i++) {
    const at = locate((i / 18) * length, i % 2 ? 16 : -16);
    const light = new Group();
    const pole = new Mesh(poleGeometry, poleMaterial);
    pole.position.y = 2.6;
    const arm = new Mesh(armGeometry, poleMaterial);
    arm.position.set(i % 2 ? -0.42 : 0.42, 5.04, 0);
    arm.rotation.z = i % 2 ? -0.55 : 0.55;
    const bulb = new Mesh(new SphereGeometry(0.14, 8, 6), lampMaterial);
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
      if (o.name.startsWith("Finish_tile")) o.position.y += 0.005;
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
        for (const material of materials) material.color?.multiply(new Color(livery));
      });
      scene.add(kart);
      karts.push(kart);
      makeWheels(kart);
      makeDriver(kart, i);
      if (i === 0) {
        addPlayerAccent(kart);
        setupPlayerEffects(kart);
      }
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
      const lane = i % 2 ? 6.7 : -6.7;
      const at = locate(((i + 0.45) / 8) * length, lane),
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
    if (new URLSearchParams(location.search).has("race")) start();
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
    karts[i].rotation.y =
      at.angle +
      (i === 0
        ? race.player.drift * 0.22 + race.player.spinoutAngle
        : 0);
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
  physicsAccumulator = 0;
  mode = "countdown";
  count = 3;
  clearInput();
  impactShakeTime = 0;
  impactShakeStrength = 0;
  showRace(true);
  $("overlay").hidden = true;
  $("pause").textContent = "Pause";
  placeKarts();
  const at = locate(0);
  camera.position.copy(at.p).addScaledVector(at.v, -9);
  camera.position.y += 2.8;
  cameraBase.copy(camera.position);
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
$("home").onclick = () => { location.href = "/"; };
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
const target = new Vector3(),
  lookTarget = new Vector3(),
  camTarget = new Vector3(),
  cameraBase = new Vector3();
let cameraTargetInitialized = false;
let physicsAccumulator = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - last) / 1000);
  const dt = Math.min(elapsed, 0.05);
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
  let physicsEvents = null;
  let impactEvents = null;
  if (mode === "racing") {
    physicsAccumulator += elapsed;
    while (physicsAccumulator > 0 && !race.finished) {
      const step = Math.min(physicsAccumulator, 0.05);
      const stepEvents = tick(
        race,
        { ...input, accelerate: touch || input.accelerate },
        step,
      );
      physicsEvents = stepEvents;
      if (stepEvents.impact) impactEvents = stepEvents;
      physicsAccumulator = Math.max(0, physicsAccumulator - step);
    }
    if (physicsEvents && impactEvents) {
      physicsEvents.impact = true;
      physicsEvents.impactSpeed = impactEvents.impactSpeed;
      physicsEvents.impactType = impactEvents.impactType;
      physicsEvents.impactSide = impactEvents.impactSide;
      physicsEvents.spinoutStarted = impactEvents.spinoutStarted;
    }
    for (let i = 0; i < wheelSets.length; i++) {
      const kartSpeed = i === 0 ? race.player.speed : race.rivals[i - 1]?.speed ?? 0;
      const wheels = wheelSets[i];
      for (const wheel of wheels) {
        wheel.rotation.x =
          (wheel.rotation.x + kartSpeed * dt / 0.3) % (Math.PI * 2);
      }
    }
    if (race.finished) finish();
  } else {
    physicsAccumulator = 0;
  }
  if (ready) {
    placeKarts();
    updatePlayerEffects(dt, physicsEvents);
    if (mode === "menu") {
      // Keep the landing view clear; the moving preview camera can pass
      // through the palms and buildings placed along the circuit.
      const at = locate(0);
      lookTarget.copy(at.p);
      lookTarget.y += 1;
      camTarget.copy(at.p).add(new Vector3(16, 9, 20));
    } else {
      const at = locate(race.player.distance, race.player.lane);
      lookTarget.copy(at.p).addScaledVector(at.v, 10);
      lookTarget.y += 1.7;
      camTarget.copy(at.p).addScaledVector(at.v, -11);
      camTarget.y += 2.8;
    }
    const cameraSmoothing = 1 - Math.exp(-dt * 4);
    cameraBase.lerp(camTarget, cameraSmoothing);
    camera.position.copy(cameraBase);
    if (!cameraTargetInitialized) {
      target.copy(lookTarget);
      cameraTargetInitialized = true;
    } else {
      target.lerp(lookTarget, cameraSmoothing);
    }
    if (impactShakeTime > 0) {
      const shake =
        impactShakeStrength * (impactShakeTime / impactShakeDuration);
      camera.position.x += (Math.random() * 2 - 1) * shake;
      camera.position.y += (Math.random() * 2 - 1) * shake * 0.6;
      camera.position.z += (Math.random() * 2 - 1) * shake * 0.35;
    }
    camera.lookAt(target);
    $("speed").textContent = Math.round(race.player.speed * 3.6);
    $("lap").textContent =
      `${Math.min(LAPS, Math.floor(race.player.distance / length) + 1)} / 3`;
    $("position").textContent = `${place(race)} / 6`;
    $("time").textContent = formatTime(race.time);
    $("boost-fill").style.width = `${race.player.boost * 100}%`;
    minimap();
  } else {
    cameraBase.set(100, 80, 180);
    camera.position.copy(cameraBase);
    camera.lookAt(0, 0, 0);
  }
  if (audio) {
    gain.gain.setTargetAtTime(
      sound && mode === "racing"
        ? 0.01 + (race.player.speed / HANDLING.topSpeed) * 0.014
        : 0,
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
