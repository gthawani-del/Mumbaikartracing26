import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinish, advanceFinish} from './race-finish.js';
import {createRace} from './race-logic.js';
import {createWeatherState, advanceWeather, tyreSurface} from './weather-state.js';
test('finish presentation locks results and coasts within the runoff without changing physics',()=>{
  const race=createRace({length:1000,rivals:0});
  Object.assign(race.player,{distance:1000,speed:250/3.6,finishTime:20.12});
  const before=JSON.stringify(race),finish=createFinish(race,1);
  for(let i=0;i<240;i++)advanceFinish(finish,1/60);
  assert.equal(finish.time,20.12); assert.equal(finish.position,1);
  assert.equal(advanceFinish(finish,0).done,true); assert.ok(advanceFinish(finish,0).coast<=6);
  assert.equal(JSON.stringify(race),before);
});
test('dry starts emit dust; wet roads keep water spray after rain stops',()=>{
  const weather=createWeatherState(()=>0);
  assert.equal(tyreSurface(weather.wetness),'dust');
  for(let i=0;i<19*60;i++)advanceWeather(weather,1/60);
  assert.equal(tyreSurface(weather.wetness),'water');
  weather.heavy=false;weather.rain=0;weather.remaining=100;
  advanceWeather(weather,1);
  assert.equal(tyreSurface(weather.wetness),'water');
});
