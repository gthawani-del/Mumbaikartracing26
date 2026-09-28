export function createWeatherState(random = Math.random) {
  return { rain: 0.15, wetness: 0.35, heavy: false, remaining: 8 + random() * 8, random };
}

export function advanceWeather(state, dt) {
  state.remaining -= dt;
  let changed = false;
  while (state.remaining <= 0) {
    state.heavy = !state.heavy;
    state.remaining += state.heavy ? 12 + state.random() * 10 : 16 + state.random() * 12;
    changed = true;
  }
  const target = state.heavy ? 1 : 0.12;
  state.rain += (target - state.rain) * (1 - Math.exp(-dt / 3));
  // Puddles accumulate faster than they dry after a shower.
  state.wetness = Math.max(0.3, Math.min(1, state.wetness + (state.rain > 0.5 ? 0.045 * state.rain : -0.004) * dt));
  return changed;
}
