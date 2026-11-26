// Oracle harness for src/hold.ts — the solve is shown the way you hold the cube.
//
// 1. The fixed holds and the colour-neutrality ladder say what they mean: each
//    hold's label is its top/front colours, the ladder opens white-bottom /
//    blue-left → green → orange → red → the same on yellow, every block appears
//    once, and holdFor really puts each block at the bottom-left.
// 2. The second block is the opposite side block on the same layers, and the
//    orange/yellow case is exactly the app's original Roux F2B target.
// 3. Display renaming: a model move shown in a rotated frame turns the shown cube
//    the same way (orient.ts translation), for the hold rotations and every frame.
// 4. Against the cube in hand: hold a built first block bottom-left, turn the
//    second-block moves a Roux solver makes (U, R, M — slices included) on the
//    PHYSICAL cube, feed the app only what the smart cube reports, with timing (a
//    slice's two halves near-instant, other turns at human pace), and require the
//    picture the app draws — hand frame (main.ts updateHandFrame, replayed) + the
//    block's hold — to BE the cube in hand, sticker for sticker, after every turn.
//    Hint names are then right too, by 3. And the move list names every turn as
//    you made it: U, R, R2 under their own names, a slice pair shown as one M.
//    Wide turns (r) on a route the app showed are read as r (route-aware, main.ts
//    followRoute: r reports as a lone L); the held record (main.ts movesHeld — what
//    grading counts and replays) replays to the cube in hand, one token per turn.
// 5. Following the app's own routes, which now use M and r (notation.ts), turned
//    on the physical cube hint by hint or read off Show the route in one go (its
//    slices turned slowly, so only the route can name them): the picture stays the cube in hand,
//    every move is named as the route named it, and the target is reached — for
//    first blocks (outer turns + M + r) and second blocks (R r U M).
//
// Usage: npx tsx scripts/hold-check.ts

import {
  applyMove, applyMoves, faceletString, isMaskSolvedState, newSolved, solveFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3, type RotationMove,
} from '../src/engine-api.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { MASK_123_LEFT, MASK_123_RIGHT, side123Masks } from '../src/blocks.ts';
import { FRAMES, movesToFrame } from '../src/frame.ts';
import {
  ALL_FB, CN_RUNGS, HOLDS, HOLD_ROTATION, SLICE_PAIR_MS, blockHoldLabel, bothBlocks, holdFor, isSlicePair, reholdAfterSlice,
  resolveSolver, rungBlocks,
} from '../src/hold.ts';
import { cfgInFrame, inFrame, isTargetSolved, movesFromFrame, solveInFrames } from '../src/frame.ts';
import { ROUX_HELD, ROUX_SB_HELD, followTurn, isWide, renameMove, startFollow, unrename, type Follow } from '../src/notation.ts';
import { orientLabel, rotateHighlight, rotatedFacelets, toDisplayMoves } from '../src/orient.ts';
import { TRAINERS } from '../src/steps.ts';

let mismatches = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok && mismatches++ < 20) console.log('  MISMATCH', msg); };

let seed = 20261029;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const TURNS = FACES.flatMap((f) => SUF.map((x) => f + x)) as Move3x3[];
const scramble = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};

// --- 1. holds and the ladder ---------------------------------------------------
const COLOUR: Record<string, string> = { w: 'white', y: 'yellow', g: 'green', b: 'blue', r: 'red', o: 'orange' };
for (const h of HOLDS) {
  const want = `${COLOUR[h[0]]}-top / ${COLOUR[h[1]]}-front`;
  check(orientLabel(HOLD_ROTATION[h]) === want, `hold ${h}: ${orientLabel(HOLD_ROTATION[h])}, want ${want}`);
}
const LADDER = ['white-bottom / blue-left', 'white-bottom / green-left', 'white-bottom / orange-left', 'white-bottom / red-left',
  'yellow-bottom / blue-left', 'yellow-bottom / green-left', 'yellow-bottom / orange-left', 'yellow-bottom / red-left'];
LADDER.forEach((want, i) => check(blockHoldLabel(ALL_FB[i]) === want, `ladder ${i}: ${blockHoldLabel(ALL_FB[i])}, want ${want}`));
check(ALL_FB.length === 24, `ALL_FB has ${ALL_FB.length} blocks`);
const keys = new Set(ALL_FB.map((m) => [...m.solvedFaceletIndices].sort((a, b) => a - b).join()));
check(keys.size === 24, 'ALL_FB blocks are distinct');
for (const m of side123Masks()) check(keys.has([...m.solvedFaceletIndices].sort((a, b) => a - b).join()), 'every side 1×2×3 is on the ladder');
const left = new Set(MASK_123_LEFT.solvedFaceletIndices);
for (const fb of ALL_FB) {
  const d = rotateHighlight(new Set(fb.solvedFaceletIndices), holdFor(fb));
  check(d.size === left.size && [...d].every((i) => left.has(i)), `holdFor ${blockHoldLabel(fb)} is not bottom-left`);
}
let prevLen = 0;
for (const r of CN_RUNGS) {
  const l = rungBlocks(r);
  check(l.length > prevLen && l.every((m, i) => m === ALL_FB[i]), `rung ${r} is not a growing prefix`);
  prevLen = l.length;
}

// --- 2. the second block ---------------------------------------------------------
const lr = new Set([...MASK_123_LEFT.solvedFaceletIndices, ...MASK_123_RIGHT.solvedFaceletIndices]);
const oy = ALL_FB.find((m) => blockHoldLabel(m) === 'yellow-bottom / orange-left')!;
const both = bothBlocks(oy).solvedFaceletIndices;
check(both.length === lr.size && both.every((i) => lr.has(i)), 'orange/yellow F2B is not the original Roux target');
const sides = new Set(side123Masks().map((m) => [...m.solvedFaceletIndices].sort((a, b) => a - b).join()));
for (const fb of ALL_FB) {
  const own = new Set(fb.solvedFaceletIndices);
  const sb = bothBlocks(fb).solvedFaceletIndices.filter((i) => !own.has(i));
  check(sb.length === own.size && sides.has([...sb].sort((a, b) => a - b).join()), `${blockHoldLabel(fb)}: second block is not a side 1×2×3`);
  // Solved cube held for this block: the SB sits bottom-right.
  const d = rotateHighlight(new Set(sb), holdFor(fb));
  check([...d].every((i) => MASK_123_RIGHT.solvedFaceletIndices.includes(i)), `${blockHoldLabel(fb)}: second block is not bottom-right`);
}
// The real step definition still matches the Roux target the drill used before.
const sbStep = TRAINERS.find((t) => t.id === 'b123R')!.steps[0];
check(sbStep.candidateMasks[0].solvedFaceletIndices.every((i) => lr.has(i)), 'b123R step target moved');

// --- 3. display renaming ---------------------------------------------------------
const rotLists: RotationMove[][] = [
  ...HOLDS.map((h) => HOLD_ROTATION[h]),
  ...ALL_FB.map(holdFor),
  ...FRAMES.map((f) => f as RotationMove[]),
  ...FRAMES.map((f) => [...f, ...holdFor(ALL_FB[0])] as RotationMove[]),
];
for (let t = 0; t < 4; t++) {
  const c = applyMoves(newSolved(), scramble(20));
  for (const rots of rotLists) for (const m of TURNS) {
    const x = toDisplayMoves([m], rots)[0];
    check(rotatedFacelets(applyMove(c, m), rots) === faceletString(applyMove(applyMoves(c, rots as Move3x3[]), x)),
      `[${rots.join(' ')}] shows ${m} as ${x}`);
  }
}
// Frames rename the same way the display does.
FRAMES.forEach((f, k) => {
  for (const m of TURNS) check(toDisplayMoves([m], f as RotationMove[])[0] === movesToFrame([m], k)[0], `frame ${k}: ${m}`);
});

// --- 4. against the cube in hand ---------------------------------------------------
const SOLVED = faceletString(newSolved());
const CENTRES = [4, 22, 25, 28, 31, 49];
/** What the smart cube reports: the physical cube with its centres home. */
function toModel(physical: Cube3x3): Cube3x3 {
  for (const r of FRAMES) {
    const c = applyMoves(physical, r);
    const f = faceletString(c);
    if (CENTRES.every((i) => f[i] === SOLVED[i])) return c;
  }
  throw new Error('no rotation brings the centres home');
}
/** The outer turns the smart cube reports for one physical turn: one, or an
 *  opposite-face pair for a slice. */
function reported(prev: Cube3x3, next: Cube3x3): Move3x3[] {
  const want = next.encode();
  for (const t of TURNS) if (applyMove(prev, t).encode() === want) return [t];
  for (const a of TURNS) for (const b of TURNS) {
    if (a[0] === b[0]) continue;
    if (applyMove(applyMove(prev, a), b).encode() === want) return [a, b];
  }
  throw new Error('no reported turns match');
}
const inv = (m: Move3x3) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`) as Move3x3;
/** main.ts updateHandFrame, replayed: re-hold on a timed slice pair only. */
class Tracker {
  h = 0; moves: Move3x3[] = []; ts: number[] = []; paired = -1;
  /** main.ts movesShown: each turn named in the hold before it, a slice pair relabelled. */
  shown: string[] = [];
  /** main.ts movesHeld: the same turns positional, named for the model at the start. */
  held: Move3x3[] = [];
  constructor(readonly fb: Cube3x3Mask) {}
  /** main.ts state.follow: the route on screen, from assist() (a hint or Show the
   *  route), named for the model at `base`. */
  f: Follow | null = null;
  follow(base: Cube3x3, route: Move3x3[]) { this.f = startFollow(base, route, this.h, this.shown.length); }
  see(cube: Cube3x3, m: Move3x3, t: number) {
    const D = [...(FRAMES[this.h] as RotationMove[]), ...holdFor(this.fb)];
    this.shown.push(toDisplayMoves([m], D)[0]);
    this.held.push(renameMove(m, FRAMES[this.h]));
    this.moves.push(m); this.ts.push(t);
    const n = this.moves.length;
    // main.ts followRoute, replayed.
    const f = this.f;
    if (f) {
      const before = f.done;
      const r = followTurn(f, cube);
      if (!r) this.f = null;
      else {
        this.h = r.hand;
        if (f.done !== before) {
          if (r.finished) {
            const k = this.shown.length - f.since;
            this.shown.splice(f.since, k, toDisplayMoves([r.finished], [...(FRAMES[f.hand] as RotationMove[]), ...holdFor(this.fb)])[0]);
            this.held.splice(f.since, k, renameMove(r.finished, FRAMES[f.hand]));
          }
          this.paired = n - 1;
          f.since = this.shown.length;
        }
      }
    }
    if (n < 2 || n - 2 <= this.paired || this.ts[n - 1] - this.ts[n - 2] > SLICE_PAIR_MS) return;
    const [a, b] = [this.moves[n - 2], this.moves[n - 1]];
    if (!isSlicePair(a, b, this.fb)) return;
    const r = reholdAfterSlice(applyMove(applyMove(cube, inv(b)), inv(a)), cube, this.fb, this.h);
    this.h = r.frame;
    this.paired = n - 1;
    if (r.slice) {
      this.shown.splice(-2, 2, r.slice);
      this.held.splice(-2, 2, unrename([r.slice], holdFor(this.fb))[0]);
    }
  }
}
// Second-block moves a Roux solver makes, none touching the left block. A wide turn
// is read as one only when the app suggested it (a lone reported L is otherwise an
// L), so each turn here is made as a hint-follower would: the hint on screen is the
// turn itself.
const SB_MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'M', 'M2', "M'", 'r', 'r2', "r'"] as Move3x3[];
const FB_CFG = { moveSet: TURNS, pruningDepth: 4, depthLimit: 12 };
let turns = 0, offsetTurns = 0, slicesSeen = 0, widesSeen = 0, named = 0;
for (const fb of ALL_FB) {
  for (let rep = 0; rep < 3; rep++) {
    const turnsBefore = turns;
    // A scramble with this first block built, as the drill serves it.
    let model = applyMoves(newSolved(), scramble(16));
    const sol = solveFromState(model, fb, FB_CFG);
    if (!sol) continue;
    model = applyMoves(model, sol);
    check(isMaskSolvedState(model, fb), 'built block is not solved');
    const H = holdFor(fb);
    let inHand = applyMoves(model, H as Move3x3[]); // the solver picks it up, block bottom-left
    const model0 = model;
    const tr = new Tracker(fb);
    let clock = 0;
    for (let k = 0; k < 25; k++) {
      const m = SB_MOVES[(rand() * SB_MOVES.length) | 0];
      inHand = applyMove(inHand, m);
      const next = toModel(inHand);
      const evs = reported(model, next);
      // A slice through the block's axis is reported as a pair (validates isSlicePair's senses).
      if (m[0] === 'M') { slicesSeen++; check(evs.length === 2 && isSlicePair(evs[0], evs[1], fb), `${m} reported as ${evs.join(' ')}`); }
      clock += 400; // human pace between turns; a slice's two halves land 20 ms apart
      const before = tr.shown.length;
      tr.follow(model, [unrename([m], [...FRAMES[tr.h], ...H])[0]]); // the hint on screen is this turn
      evs.forEach((t, j) => { model = applyMove(model, t); tr.see(model, t, clock + j * 20); });
      // The app names the turn exactly as you made it — one token, your hand's name.
      named++;
      check(tr.shown.length === before + 1 && tr.shown[before] === m,
        `${blockHoldLabel(fb)}: you turned ${m}, the app shows ${tr.shown.slice(before).join(' ')}`);
      check(model.encode() === next.encode(), 'reported turns do not reach the cube');
      turns++;
      if (m[0] === 'r') widesSeen++;
      // The held record replays to the cube in hand, one token per turn you made.
      check(tr.held.length === turns - turnsBefore && rotatedFacelets(applyMoves(model0, tr.held), H) === faceletString(inHand),
        `${blockHoldLabel(fb)} after ${m}: the held record ${tr.held.join(' ')} is not what you turned`);
      if (tr.h !== 0) offsetTurns++;
      check(rotatedFacelets(model, [...(FRAMES[tr.h] as RotationMove[]), ...H]) === faceletString(inHand),
        `${blockHoldLabel(fb)} after ${m}: the picture is not the cube in hand (frame ${tr.h})`);
    }
  }
}

// --- 5. following the app's own routes --------------------------------------------
// The routes use M and r now. A hint-follower turns each route move on the physical
// cube (a slice's halves 20 ms apart, otherwise reading-pace), the hint on screen
// being the route's next move as the app would show it from where the cube is now.
// The picture must stay the cube in hand, each move must be shown as the route
// named it, the held record must be the route, and the target must be reached.
// And re-planned from the live cube part-way — after slices have re-held the hands,
// as a hint is — the route must still be the step's own moves in the hands' names
// (the second block's R r U M are other model faces after an M: hold.ts
// resolveSolver takes the hand frame).
const SB_STEP = TRAINERS.find((t) => t.id === 'b123R')!.steps[0];
const FB_STEP = TRAINERS.find((t) => t.id === 'b123L')!.steps[0];
let routeTurns = 0, routeSlices = 0, routeWides = 0, routesDone = 0, replans = 0, replansOffset = 0;
for (let t = 0; t < 24; t++) {
  const fb = ALL_FB[t % 8];
  const second = t % 2 === 1;
  let model = applyMoves(newSolved(), scramble(16));
  if (second) {
    const built = solveFromState(model, fb, { ...FB_CFG, depthLimit: 16 });
    if (!built) continue;
    model = applyMoves(model, built);
  }
  const target = second ? bothBlocks(fb) : fb;
  const cfg = resolveSolver((second ? SB_STEP : FB_STEP).solver, fb);
  const route = humanSolveFromState(model, target, cfg);
  check(!!route, `${blockHoldLabel(fb)}: no ${second ? 'second' : 'first'}-block route`);
  if (!route) continue;
  const H = holdFor(fb);
  const model0 = model;
  let inHand = applyMoves(model, H as Move3x3[]);
  const tr = new Tracker(fb);
  const want = toDisplayMoves(route, H); // the route in your hands' names, all the way through
  let clock = 0;
  // Half the routes are shown once and followed from the screen (Show the route);
  // half hint by hint. Slices are turned slowly in the first kind (300 ms between
  // halves), so only the route can name them.
  const whole = t % 4 < 2;
  if (whole) tr.follow(model, route);
  route.forEach((m, i) => {
    const d = want[i];
    inHand = applyMove(inHand, d);
    const evs = reported(model, toModel(inHand));
    if (!whole) tr.follow(model, [unrename([d], [...FRAMES[tr.h], ...H])[0]]);
    clock += 600;
    evs.forEach((ev, j) => { model = applyMove(model, ev); tr.see(model, ev, clock + j * (whole ? 300 : 20)); });
    routeTurns++;
    if ('MES'.includes(m[0])) routeSlices++;
    if (isWide(m)) routeWides++;
    check(rotatedFacelets(model, [...(FRAMES[tr.h] as RotationMove[]), ...H]) === faceletString(inHand),
      `${blockHoldLabel(fb)}: following ${route.join(' ')}, the picture is not the cube in hand at ${d}`);
    if (i < route.length - 1 && !isTargetSolved(model, target)) {
      const step = second ? SB_STEP : FB_STEP;
      // Planned as main.ts coachRoute does: in the frame the target is closest to
      // (where the first block now sits, after the slices), then named back.
      const cfg = resolveSolver(step.solver, fb, tr.h);
      const g = solveInFrames(model, target, cfg)?.frame ?? 0;
      const inG = humanSolveFromState(inFrame(model, g), target, cfgInFrame(cfg, g));
      const again = inG && movesFromFrame(inG, g);
      const named = again ? toDisplayMoves(again, [...(FRAMES[tr.h] as RotationMove[]), ...H]) : [];
      const allowed = new Set<string>(second ? ROUX_SB_HELD : ROUX_HELD);
      replans++; if (tr.h) replansOffset++;
      check(!!again && named.every((x) => allowed.has(x)),
        `${blockHoldLabel(fb)} hand ${tr.h}: re-planned ${named.join(' ')} leaves ${second ? 'R r U M' : 'the Roux set'}`);
    }
  });
  check(tr.shown.join(' ') === want.join(' '), `${blockHoldLabel(fb)}: route ${want.join(' ')} shown as ${tr.shown.join(' ')}`);
  check(tr.held.join(' ') === route.join(' '), `${blockHoldLabel(fb)}: route ${route.join(' ')} held as ${tr.held.join(' ')}`);
  check(isTargetSolved(model, target), `${blockHoldLabel(fb)}: following ${route.join(' ')} as reported doesn't reach the target`);
  check(rotatedFacelets(applyMoves(model0, tr.held), H) === faceletString(inHand), 'held replay');
  routesDone++;
}

console.log(`hold check — ${HOLDS.length} holds, ${ALL_FB.length} blocks on the ladder, ${turns} second-block turns in hand (${offsetTurns} with the centres off), ${slicesSeen} slices, ${widesSeen} wide turns from a shown route, ${named} turns named as made, ${routesDone} app routes followed (${routeTurns} moves: ${routeSlices} slices, ${routeWides} wide; ${replans} re-plans, ${replansOffset} with the centres off), ${checks} checks`);
console.log(`mismatches ${mismatches}`);
if (mismatches) process.exitCode = 1;
