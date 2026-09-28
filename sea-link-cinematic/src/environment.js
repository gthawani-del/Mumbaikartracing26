import * as THREE from 'three';

const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

function textureFromPixels(width, height, sample) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = sample(x / width, y / height);
    const i = (y * width + x) * 4;
    pixels.data[i] = rgb[0]; pixels.data[i + 1] = rgb[1]; pixels.data[i + 2] = rgb[2]; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// Periodic waves avoid seams at the edge of both the sky and road textures.
function cloudField(u, v) {
  return Math.sin(TAU * (u * 3 + v * 2 + .14 * Math.sin(v * TAU * 3))) * .48
    + Math.cos(TAU * (u * 7 - v * 5)) * .22
    + Math.sin(TAU * (u * 13 + v * 9)) * .12
    + Math.cos(TAU * (u * 29 - v * 17)) * .06;
}

export function createSkyTexture(timeOfDay) {
  const palettes = {
    Morning: [[72, 116, 153], [209, 188, 159], [94, 113, 132]],
    Day: [[62, 118, 159], [183, 201, 205], [125, 146, 162]],
    Sunset: [[29, 45, 75], [194, 152, 139], [62, 70, 88]],
    Night: [[8, 16, 34], [47, 59, 84], [18, 28, 48]],
  };
  const [zenith, horizon, cloud] = palettes[timeOfDay] ?? palettes.Sunset;
  const texture = textureFromPixels(512, 256, (u, v) => {
    const elevation = Math.abs(v - .5) * 2;
    const horizonWeight = Math.exp(-elevation * 5);
    const cover = clamp((cloudField(u, v * 1.4) + .18) * 1.35) * clamp(elevation * 5) * .78;
    return zenith.map((value, c) => mix(mix(value, horizon[c], horizonWeight), cloud[c], cover));
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

export function createWetSurfaceMaps() {
  const roughness = textureFromPixels(256, 256, (u, v) => {
    const puddle = clamp((cloudField(u, v) + .12) * 1.8);
    const grain = Math.sin(TAU * (u * 47 + v * 31)) * .005;
    const value = 255 * clamp(mix(.86, .58, puddle) + grain);
    return [value, value, value];
  });
  roughness.repeat.set(0.4, 0.35);
  const normal = textureFromPixels(256, 256, (u, v) => [
    128 + 12 * Math.sin(TAU * (u * 19 + v * 11)),
    128 + 12 * Math.cos(TAU * (v * 23 - u * 7)), 254,
  ]);
  for (const map of [roughness, normal]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
  }
  return { roughness, normal };
}
