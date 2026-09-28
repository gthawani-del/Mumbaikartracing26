// Presentation only. The recorded simulation result never advances during this sequence.
export function createFinish(race, position) {
  return { elapsed: 0, duration: 3.4, position, time: race.player.finishTime,
    overtakes: race.overtakes, speed: race.player.speed, distance: race.player.distance,
    lane: race.player.lane, cameraPosition: null, cameraTarget: null };
}
export function advanceFinish(finish, dt) {
  finish.elapsed = Math.min(finish.duration, finish.elapsed + Math.max(0, dt));
  return { progress: finish.elapsed / finish.duration,
    coast: Math.min(6, finish.speed * .28 * .16 * finish.elapsed),
    done: finish.elapsed >= finish.duration };
}
