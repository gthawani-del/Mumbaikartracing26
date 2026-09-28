import * as THREE from 'three';

export function createOcean(scene, curve) {
  const bounds = new THREE.Box3().setFromPoints(curve.getSpacedPoints(100));
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, horizon: { value: scene.fog.color.clone() } },
    vertexShader: `uniform float time; varying vec3 world;
      void main() {
        vec3 p = position;
        p.z += sin(p.x * .045 + time * .7) * .18 + sin(p.y * .062 - time * .5) * .12;
        world = (modelMatrix * vec4(p, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }`,
    fragmentShader: `uniform float time; uniform vec3 horizon; varying vec3 world;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {
        vec2 uv=world.xz;
        float broad=noise(uv*.12+vec2(time*.035,0.));
        float small=noise(uv*1.3+vec2(-time*.16,time*.09));
        float ripple=broad*.7+small*.3;
        vec3 water=mix(vec3(.045,.060,.049),vec3(.085,.105,.084),ripple);
        float distanceToEye=length(cameraPosition-world);
        float glint=smoothstep(.8,.98,small)*.015*(1.-smoothstep(20.,160.,distanceToEye));
        water+=vec3(glint);
        water=mix(water,vec3(.15,.19,.21),smoothstep(40.,450.,distanceToEye)*.5);
        water=mix(water,horizon,smoothstep(250.,1600.,distanceToEye));
        gl_FragColor=vec4(water,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 3000, size.z + 3000, 128, 128), material);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(center.x, -2.6, center.z);
  scene.add(ocean);
  return ocean;
}

export function createBoostEffects(kart, scene) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, '#ffffed'); gradient.addColorStop(.18, '#fff1a5');
  gradient.addColorStop(.4, '#ff8e18'); gradient.addColorStop(.7, '#ff360055'); gradient.addColorStop(1, '#ff170000');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group(); group.position.set(-.38, .46, -1.3);
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.position.z = -i * .16; group.add(sprite);
  }
  kart.add(group);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(.8, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  scene.add(glow);
  const positions = new Float32Array(18 * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const sparks = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffd480', size: .045, map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; group.add(sparks);
  group.visible = glow.visible = false;
  return { group, glow, sparks, time: 0 };
}

export function updateBoostEffects(effect, active, dt, frame, kart, wetness) {
  effect.group.visible = effect.glow.visible = active;
  if (!active) return;
  effect.time += dt;
  effect.group.children.slice(0, 6).forEach((sprite, i) => {
    const pulse = 1 + Math.sin(effect.time * 43 + i * 2) * .15;
    sprite.scale.setScalar((.33 - i * .032) * pulse);
    sprite.material.opacity = 1 - i * .1;
  });
  const buffer = effect.sparks.geometry.attributes.position;
  for (let i = 0; i < buffer.count; i++) {
    const age = (effect.time * 1.8 + i / buffer.count) % 1;
    buffer.setXYZ(i, Math.sin(i * 17) * age * .3, Math.cos(i * 11) * age * .15, -age * 2);
  }
  buffer.needsUpdate = true;
  effect.glow.position.copy(kart.position).addScaledVector(frame.tangent, -1);
  effect.glow.position.y = .205; effect.glow.rotation.y = frame.yaw;
  effect.glow.material.opacity = .2 + wetness * .45;
}
