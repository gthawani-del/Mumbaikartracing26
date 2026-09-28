import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherState, advanceWeather } from './weather-state.js';

test('showers ramp up and leave wet asphalt after easing', () => {
  const state = createWeatherState(() => 0);
  for (let i = 0; i < 19 * 60; i++) advanceWeather(state, 1 / 60);
  assert.ok(state.heavy && state.rain > 0.9);
  assert.ok(state.wetness > 0.6);
  const wet = state.wetness;
  for (let i = 0; i < 12 * 60; i++) advanceWeather(state, 1 / 60);
  assert.equal(state.heavy, false);
  assert.ok(state.rain < 0.2);
  assert.ok(state.wetness > wet - 0.08);
});

test('weather intervals vary with the per-race random source', () => {
  const early = createWeatherState(() => 0);
  const late = createWeatherState(() => 0.99);
  for (let i = 0; i < 10 * 60; i++) {
    advanceWeather(early, 1 / 60); advanceWeather(late, 1 / 60);
  }
  assert.equal(early.heavy, true); assert.equal(late.heavy, false);
});
