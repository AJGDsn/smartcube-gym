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
//    Hint names are then right too, by 3.
// 5. Following the app's own outer-turn routes at a human pace never re-holds.
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
  ALL_FB, CN_RUNGS, HOLDS, HOLD_ROTATION, SLICE_PAIR_MS, blockHoldLabel, bothBlocks, holdFor, isSlicePair, reholdAfterSlice, rungBlocks,
} from '../src/hold.ts';
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
  constructor(readonly fb: Cube3x3Mask) {}
  see(cube: Cube3x3, m: Move3x3, t: number) {
    this.moves.push(m); this.ts.push(t);
    const n = this.moves.length;
    if (n < 2 || n - 2 <= this.paired || this.ts[n - 1] - this.ts[n - 2] > SLICE_PAIR_MS) return;
    const [a, b] = [this.moves[n - 2], this.moves[n - 1]];
    if (!isSlicePair(a, b, this.fb)) return;
    this.h = reholdAfterSlice(applyMove(applyMove(cube, inv(b)), inv(a)), cube, this.fb, this.h);
    this.paired = n - 1;
  }
}
// Second-block moves a Roux solver makes, none touching the left block. Wide turns
// (r) are left out on purpose: a lone reported L can't be told from an L yet.
const SB_MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'M', 'M2', "M'"] as Move3x3[];
const FB_CFG = { moveSet: TURNS, pruningDepth: 4, depthLimit: 12 };
let turns = 0, offsetTurns = 0, slicesSeen = 0;
for (const fb of ALL_FB) {
  for (let rep = 0; rep < 3; rep++) {
    // A scramble with this first block built, as the drill serves it.
    let model = applyMoves(newSolved(), scramble(16));
    const sol = solveFromState(model, fb, FB_CFG);
    if (!sol) continue;
    model = applyMoves(model, sol);
    check(isMaskSolvedState(model, fb), 'built block is not solved');
    const H = holdFor(fb);
    let inHand = applyMoves(model, H as Move3x3[]); // the solver picks it up, block bottom-left
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
      evs.forEach((t, j) => { model = applyMove(model, t); tr.see(model, t, clock + j * 20); });
      check(model.encode() === next.encode(), 'reported turns do not reach the cube');
      turns++;
      if (tr.h !== 0) offsetTurns++;
      check(rotatedFacelets(model, [...(FRAMES[tr.h] as RotationMove[]), ...H]) === faceletString(inHand),
        `${blockHoldLabel(fb)} after ${m}: the picture is not the cube in hand (frame ${tr.h})`);
    }
  }
}

// --- 5. following the app's own routes never re-holds -----------------------------
// The routes are outer turns (they imitate M with the block's face). Turned at a
// human pace — reading each hint — they must leave the hold alone, even where a
// route has R and L' back to back.
const SB_STEP = TRAINERS.find((t) => t.id === 'b123R')!.steps[0];
let quiet = 0, backToBack = 0;
for (let t = 0; t < 16; t++) {
  const fb = ALL_FB[t % 8];
  let model = applyMoves(newSolved(), scramble(16));
  const built = solveFromState(model, fb, { ...SB_STEP.solver, depthLimit: 16 });
  if (!built) continue;
  model = applyMoves(model, built);
  const route = humanSolveFromState(model, bothBlocks(fb), SB_STEP.solver);
  if (!route) continue;
  const tr = new Tracker(fb);
  route.forEach((m, i) => {
    if (i > 0 && isSlicePair(route[i - 1], m, fb)) backToBack++;
    model = applyMove(model, m);
    tr.see(model, m, i * 600);
    quiet++;
    check(tr.h === 0, `${blockHoldLabel(fb)}: re-held following the route at ${m}`);
  });
}

console.log(`hold check — ${HOLDS.length} holds, ${ALL_FB.length} blocks on the ladder, ${turns} second-block turns in hand (${offsetTurns} with the centres off), ${slicesSeen} slices, ${quiet} route turns held still (${backToBack} back-to-back R/L pairs), ${checks} checks`);
console.log(`mismatches ${mismatches}`);
if (mismatches) process.exitCode = 1;
