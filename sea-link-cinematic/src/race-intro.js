export const FLYOVER_SECONDS = 3.6;
export const COUNTDOWN_SECONDS = 3;
export function createIntro(skipFlyover = false) {
  return { elapsed: skipFlyover ? FLYOVER_SECONDS : 0, phase: skipFlyover ? 'countdown' : 'flyover', progress: skipFlyover ? 1 : 0, count: 3 };
}
export function skipIntro(intro) {
  if (intro.phase === 'flyover') intro.elapsed = FLYOVER_SECONDS;
}
export function advanceIntro(intro, dt) {
  intro.elapsed += Math.max(0, dt);
  intro.progress = Math.min(1, intro.elapsed / FLYOVER_SECONDS);
  intro.phase = intro.elapsed < FLYOVER_SECONDS ? 'flyover'
    : intro.elapsed < FLYOVER_SECONDS + COUNTDOWN_SECONDS ? 'countdown' : 'racing';
  intro.count = Math.max(0, Math.ceil(FLYOVER_SECONDS + COUNTDOWN_SECONDS - intro.elapsed));
  return intro.phase === 'racing';
}
