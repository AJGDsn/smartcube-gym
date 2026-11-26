// Oracle for the generalized block pedagogy (src/human-solve.ts): for ANY
// placement of the block families — not just the canonical bottom-left the old
// hand-written table covered — humanSolveFromState must
//   1. return a trail that REACHES the mask;
//   2. for the staged families (2×2×3, side 1×2×3), pass through a milestone:
//      at some prefix of the trail, one of the two long-axis sub-blocks (a
//      contained 2×2×2 / 1×2×2 square) is solved — the build-then-extend
//      contract (prefix 0 counts: a scramble can hand you a milestone);
//   3. for the single-stage 2×2×2, stay within the comfort band (≤ optimal+2);
//   4. never turn the same layer twice in a row — the build-then-extend seam used to
//      read "U′ U" (stage 2 undoing the move that finished stage 1's milestone);
//   5. the same for the Roux 1×2×3 move set (outer turns + M + r, named for each
//      block by hold.ts resolveSolver): trails reach the block, through a milestone.
// EO-mask routing (plain optimal, byte-identical) is human-solve-eo-check.ts.

import {
  applyMoves, isMaskSolvedState, newSolved, solveFromState, MOVESETS,
  type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { all222Masks, all223Masks, side123Masks, blockMaskFromRanges, NET_COORDS } from '../src/blocks.ts';
import { ALL_FB, resolveSolver } from '../src/hold.ts';
import { ROUX_HELD } from '../src/notation.ts';
import type { StepSolverConfig } from '../src/engine-api.ts';

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(Math.random() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(Math.random() * 3) | 0]); }
  return o as Move3x3[];
};

let n = 0, fail = 0;
const check = (c: boolean, m: string) => { if (!c) { console.log('MISMATCH: ' + m); fail++; } };

// Independent (re-)derivation of the two long-axis milestones from the mask's
// own facelet coords — a spec restatement the module must agree with.
function milestones(mask: Cube3x3Mask): Cube3x3Mask[] {
  const vals = [new Set<number>(), new Set<number>(), new Set<number>()];
  for (const i of mask.solvedFaceletIndices) {
    const c = NET_COORDS[i];
    vals[0].add(c[0]); vals[1].add(c[1]); vals[2].add(c[2]);
  }
  const ax = vals.map((s) => [...s].sort((a, b) => a - b));
  const long = ax.findIndex((a) => a.length === 3);
  return [[1, 2], [0, 1]].map((pair) => {
    const r = ax.map((a, i) => (i === long ? pair : a));
    return blockMaskFromRanges(r[0], r[1], r[2]);
  });
}

interface Fam { name: string; masks: readonly Cube3x3Mask[]; targets: number[]; pd: number; staged: boolean; trials: number; roux?: boolean; }
const FAMS: Fam[] = [
  { name: '222', masks: all222Masks(), targets: [0, 1, 2, 3, 4, 5, 6, 7], pd: 4, staged: false, trials: 16 },
  { name: '223', masks: all223Masks(), targets: [0, 2, 4, 6, 8, 10], pd: 5, staged: true, trials: 10 },
  { name: '123', masks: side123Masks(), targets: [0, 3, 6, 9, 12, 15, 18, 21], pd: 4, staged: true, trials: 14 },
  { name: '123 Roux', masks: ALL_FB, targets: [0, 1, 2, 3, 4, 5, 6, 7, 11, 17, 23], pd: 4, staged: true, trials: 16, roux: true },
];
const layer = (m: string) => m.replace(/['2]$/, '');
let slices = 0;

for (const fam of FAMS) {
  const base: StepSolverConfig = { moveSet: MOVESETS.RUFLDB, pruningDepth: fam.pd, depthLimit: 14, ...(fam.roux ? { heldMoves: ROUX_HELD } : {}) };
  for (let t = 0; t < fam.trials; t++) {
    const mask = fam.masks[fam.targets[(Math.random() * fam.targets.length) | 0]];
    const cfg = fam.roux ? resolveSolver(base, mask) : base;
    const cube = applyMoves(newSolved(), rnd(10));
    if (isMaskSolvedState(cube, mask)) continue; // nothing to teach
    const trail = humanSolveFromState(cube, mask, cfg);
    n++;
    if (!trail) { check(false, `${fam.name}: humanSolve returned null`); continue; }
    check(isMaskSolvedState(applyMoves(cube, trail), mask), `${fam.name}: trail doesn't reach the mask`);
    check(trail.every((m, i) => i === 0 || layer(m) !== layer(trail[i - 1])), `${fam.name}: same layer twice in a row: ${trail.join(' ')}`);
    if (fam.roux) slices += trail.filter((m) => !'UDLRFB'.includes(m[0])).length;
    if (fam.staged) {
      const [a, b] = milestones(mask);
      let hit = isMaskSolvedState(cube, a) || isMaskSolvedState(cube, b);
      let c = cube;
      for (const m of trail) {
        if (hit) break;
        c = applyMoves(c, [m]);
        if (isMaskSolvedState(c, a) || isMaskSolvedState(c, b)) hit = true;
      }
      check(hit, `${fam.name}: trail never passes a build-then-extend milestone`);
    } else {
      const opt = solveFromState(cube, mask, cfg);
      if (opt) check(trail.length <= opt.length + 2, `${fam.name}: ranked trail ${trail.length} > optimal ${opt.length} + 2`);
    }
  }
}

console.log(`human-solve blocks: ${n} trails checked (Roux trails used ${slices} slice/wide turns), mismatches ${fail}`);
if (fail > 0) { console.log('HUMAN-SOLVE BLOCKS FAIL'); process.exitCode = 1; }
else console.log('HUMAN-SOLVE BLOCKS OK — any-placement trails reach the target via a milestone');
