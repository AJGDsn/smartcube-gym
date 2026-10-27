// Oracle for placement-aware candidate selection (src/placement.ts).
//
// Replays real solves move-by-move, re-picking from (live state, step-start
// state) exactly as main.ts afterChange does, and asserts the module's contract:
//   R  placementReach agrees with an independent restatement that turns the
//      engine's own cube through every one- and two-turn sequence and counts
//      placed pieces with scorePlacement (sampled — the engine path is ~100×
//      slower than the permutation tables it checks);
//   A1 the pick is the step-start anchor unless some candidate STRICTLY
//      out-reaches the anchor (one turn, then two, then placed now), in which
//      case it is a best-reaching candidate;
//   A2 a NO-OP move sequence (U U U U, a wrong turn undone, six sexies) never
//      moves the pick — at any state, placed pieces or not. This is the
//      property the previous threaded-hysteresis design could not have: it was
//      a fold over the move path, so ~1 no-op in 5 moved the displayed ideal;
//   A3 whenever any candidate is finished, the pick's own mask is solved (so
//      a completed block is never coached as unfinished);
//   A4 single-candidate steps always pick index 0, and picks are deterministic.
// A random-walk phase after each solve re-asserts A1–A3 on messy states.

import {
  applyMove, applyMoves, isMaskSolvedState, newSolved, solveFromState, MOVESETS,
  type Cube3x3, type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import { activePlacement, canonicalIndexIn, placementReach, scorePlacement, type PlacementReach } from '../src/placement.ts';
import {
  all222Masks, all223Masks, side123Masks,
  MASK_123_LEFT, MASK_222_DLF, MASK_223_BOTTOM_LEFT,
} from '../src/blocks.ts';

const SCRAMBLE = 10; // short keeps IDA* cheap: a solution never exceeds the scramble
const WALK = 20;

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const TURNS = FACES.flatMap((f) => SUF.map((x) => f + x)) as Move3x3[];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(Math.random() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(Math.random() * 3) | 0]); }
  return o as Move3x3[];
};

let fail = 0;
const check = (c: boolean, m: string) => { if (!c) { console.log('MISMATCH: ' + m); fail++; } };

// R: reach by brute force through the engine — no permutation tables.
function slowReach(cube: Cube3x3, candidates: Cube3x3Mask[]): PlacementReach {
  const placed = (c: Cube3x3) => candidates.map((m) => scorePlacement(c, m).placed);
  const now = placed(cube), one = now.slice(), two = now.slice();
  const raise = (out: number[], v: number[]) => v.forEach((x, i) => { if (x > out[i]) out[i] = x; });
  for (const a of TURNS) {
    const c1 = applyMove(cube, a);
    const p1 = placed(c1);
    raise(one, p1); raise(two, p1);
    for (const b of TURNS) if (b[0] !== a[0]) raise(two, placed(applyMove(c1, b)));
  }
  return { now, one, two };
}

// Spec restatement of the ordering: one turn, then two, then placed now.
const key = (r: PlacementReach, i: number) => [r.one[i], r.two[i], r.now[i]];
const beats = (a: number[], b: number[]) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] > b[j]; return false; };

// Identity sequences a solver can actually produce on a real cube.
const NOOPS: Move3x3[][] = [
  ['U', 'U', 'U', 'U'], ['U', "U'"], ['R', 'R', 'R', 'R'], ['F2', 'F2'], ['D', "D'"], ['L', "L'"], ['B', "B'"],
  Array.from({ length: 6 }, () => ['R', 'U', "R'", "U'"]).flat(),
] as Move3x3[][];

// 223 solves use pruningDepth 5 like the app (a pd-4 table lets the vendored
// solver's 1e6-node budget run out on depth-9+ cases → spurious nulls), and a
// fixed target subset so the harness builds 6 pruning tables, not all 12.
interface Family {
  name: string; candidates: Cube3x3Mask[]; canonical: Cube3x3Mask; trials: number;
  pd: number; targets?: number[];
}
const FAMILIES: Family[] = [
  { name: '222', candidates: all222Masks(), canonical: MASK_222_DLF, trials: 40, pd: 4 },
  { name: '223', candidates: all223Masks(), canonical: MASK_223_BOTTOM_LEFT, trials: 30, pd: 5, targets: [0, 2, 4, 6, 8, 10] },
  { name: '123', candidates: side123Masks(), canonical: MASK_123_LEFT, trials: 25, pd: 4 },
];

let solves = 0, movesChecked = 0, reachChecked = 0, noopTrials = 0;

for (const fam of FAMILIES) {
  const { candidates } = fam;
  const preferred = canonicalIndexIn(candidates, fam.canonical);
  check(
    [...candidates[preferred].solvedFaceletIndices].sort((a, b) => a - b).join(',') ===
    [...fam.canonical.solvedFaceletIndices].sort((a, b) => a - b).join(','),
    `${fam.name}: canonicalIndexIn must find the canonical placement`,
  );

  const solver = { moveSet: MOVESETS.RUFLDB, pruningDepth: fam.pd, depthLimit: 14 };
  const pool = fam.targets ?? candidates.map((_, i) => i);
  for (let t = 0; t < fam.trials; t++) {
    const start = applyMoves(newSolved(), rnd(SCRAMBLE));
    let cube = start;
    const targetIdx = pool[(Math.random() * pool.length) | 0];
    const sol = solveFromState(cube, candidates[targetIdx], solver) ?? [];
    const anchor = activePlacement(start, candidates, start, preferred);
    let pick = anchor;

    const stepAndAssert = (m: Move3x3, phase: string) => {
      cube = applyMove(cube, m);
      pick = activePlacement(cube, candidates, start, preferred);
      check(pick === activePlacement(cube, candidates, start, preferred), `${fam.name} ${phase}: pick must be deterministic`);

      const r = placementReach(cube, candidates);
      if (movesChecked % 24 === 0) {
        const slow = slowReach(cube, candidates);
        reachChecked++;
        check(['now', 'one', 'two'].every((k) => (r as never)[k] + '' === (slow as never)[k] + ''),
          `${fam.name} ${phase}: reach disagrees with the engine (${r.one}|${r.two} vs ${slow.one}|${slow.two})`);
      }

      // A1: the anchor holds unless strictly out-reached; a switch lands on a best.
      const someoneBeatsAnchor = candidates.some((_, i) => beats(key(r, i), key(r, anchor)));
      if (!someoneBeatsAnchor) check(pick === anchor, `${fam.name} ${phase}: left the anchor ${anchor}->${pick} without being out-reached`);
      else check(candidates.every((_, i) => !beats(key(r, i), key(r, pick))), `${fam.name} ${phase}: switched to ${pick}, which is not a best-reaching candidate`);

      // A3: a finished block is the one coached.
      if (candidates.some((c) => isMaskSolvedState(cube, c))) {
        check(isMaskSolvedState(cube, candidates[pick]), `${fam.name} ${phase}: a block is finished but the pick's mask is not solved`);
      }

      // A2: identity sequences leave the pick alone, everywhere.
      if (movesChecked % 4 === 0) {
        for (const seq of NOOPS) {
          let c2 = cube, p2 = pick;
          for (const x of seq) { c2 = applyMove(c2, x); p2 = activePlacement(c2, candidates, start, preferred); }
          check(c2.encode() === cube.encode(), `${fam.name}: NOOP sequence is not identity (harness bug)`);
          noopTrials++;
          check(p2 === pick, `${fam.name} ${phase}: no-op ${seq.join(' ')} moved the pick ${pick}->${p2}`);
        }
      }
      movesChecked++;
    };

    for (const m of sol) stepAndAssert(m, 'solve');
    solves++;
    // End of the optimal solve: the chosen candidate is genuinely built (and A3 above
    // has already required the pick to be a finished block).
    check(isMaskSolvedState(cube, candidates[targetIdx]), `${fam.name}: solver failed to build the target`);

    for (const m of rnd(WALK)) stepAndAssert(m, 'walk');
  }

  // A4: pinned steps (single candidate) always pick 0.
  const one = applyMoves(newSolved(), rnd(SCRAMBLE));
  check(activePlacement(one, [candidates[0]], one, 5) === 0, `${fam.name}: single-candidate step must pick 0`);
}

console.log(`placement: ${solves} solves + walks, ${movesChecked} per-move checks, ${reachChecked} reach-vs-engine, ` +
  `${noopTrials} no-op replays, mismatches ${fail}`);
if (fail > 0) { console.log('PLACEMENT FAIL'); process.exitCode = 1; }
else console.log('PLACEMENT OK — reach matches the engine, anchor holds unless out-reached, no-ops never move the pick, finished blocks are picked');
