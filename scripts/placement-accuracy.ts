// How often does the coaching follow the block the user is ACTUALLY building?
// A measurement, not a gate (not in `npm run check`): it reports numbers to
// compare future changes to the placement pick against, rather than asserting.
//
// Ground truth comes from simulated human solves: scramble, choose a target
// placement, take the pedagogical trail to it (humanSolveFromState), and sprinkle
// in what real hands do — a wrong turn undone (X X') after 15% of moves, an AUF
// wiggle (U2 U2) after 5%. The pick is replayed move by move exactly as main.ts
// does, and scored only on states where the target is identifiable at all (it has
// the most pieces placed — otherwise no state-based pick could name it).
//
//   right%   pick == target, over identifiable states
//   late%    the same over the second half of the solve, where it matters most
//   switches visible changes of pick per solve (each one moves the ideal)
//   away     of those, switches to a block that isn't the target
//   drift%   identity sequences (U U U U, R R', sexies…) that moved the pick
//
// `placed-only` is the baseline the reach design replaced, minus its threaded
// memory: best whole-pieces-placed count, ties to the canonical placement.
//
// Usage: npx tsx scripts/placement-accuracy.ts [222|223|123] [solves] [random|easiest]
// `easiest` targets the placement with the shortest optimal solve (what a good
// solver picks in inspection) — slow for 123, impractical for 223.
// Reference (2026-10-27, this script, 300 / 60 / 150 random solves for
// 222 / 223 / 123): shipped late% 93.5 / 71.8 / 78.3, switches 2.5 / 6.0 / 4.6,
// drift 0; placed-only late% 58.6 / 43.0 / 49.0.

import {
  applyMove, applyMoves, isMaskSolvedState, newSolved, solveFromState, MOVESETS,
  type Cube3x3, type Move3x3,
} from '../src/engine-api.ts';
import { activePlacement, canonicalIndexIn, scorePlacement } from '../src/placement.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import {
  all222Masks, all223Masks, side123Masks, MASK_123_LEFT, MASK_222_DLF, MASK_223_BOTTOM_LEFT,
} from '../src/blocks.ts';

const [fam = '222', solvesArg = '100', targetMode = 'random'] = process.argv.slice(2);
const FAMILIES = {
  '222': { cands: all222Masks(), canon: MASK_222_DLF, pd: 4, depth: 11 },
  '223': { cands: all223Masks(), canon: MASK_223_BOTTOM_LEFT, pd: 5, depth: 14 },
  '123': { cands: side123Masks(), canon: MASK_123_LEFT, pd: 4, depth: 12 },
};
const F = FAMILIES[fam as keyof typeof FAMILIES];
if (!F) throw new Error(`unknown family ${fam}`);
const { cands } = F;
const solver = { moveSet: MOVESETS.RUFLDB, pruningDepth: F.pd, depthLimit: F.depth };
const preferred = canonicalIndexIn(cands, F.canon);

// Seeded so runs are repeatable and both policies see identical solves.
let seed = 20261027;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};
const inv = (m: Move3x3) => (m.endsWith("'") ? m[0] : m.endsWith('2') ? m : m + "'") as Move3x3;

const placedOnly = (cube: Cube3x3) => {
  const s = cands.map((m) => scorePlacement(cube, m).placed);
  let best = preferred;
  s.forEach((x, i) => { if (x > s[best]) best = i; });
  return best;
};
const POLICIES: Record<string, (cube: Cube3x3, start: Cube3x3) => number> = {
  shipped: (cube, start) => activePlacement(cube, cands, start, preferred),
  'placed-only': (cube) => placedOnly(cube),
};

const NOOPS = [
  ['U', 'U', 'U', 'U'], ['U', "U'"], ['R', "R'"], ['F2', 'F2'], ['D', "D'"],
  Array.from({ length: 6 }, () => ['R', 'U', "R'", "U'"]).flat(),
] as Move3x3[][];

type Tally = { states: number; right: number; late: number; lateRight: number; switches: number; away: number; probes: number; drift: number };
const T: Record<string, Tally> = Object.fromEntries(Object.keys(POLICIES).map((n) =>
  [n, { states: 0, right: 0, late: 0, lateRight: 0, switches: 0, away: 0, probes: 0, drift: 0 }]));

let solves = 0;
const t0 = Date.now();
for (let t = 0; t < Number(solvesArg); t++) {
  const start = applyMoves(newSolved(), rnd(16));
  let target = (rand() * cands.length) | 0;
  if (targetMode === 'easiest') {
    let best = Infinity;
    cands.forEach((m, i) => { const l = solveFromState(start, m, solver)?.length ?? Infinity; if (l < best) { best = l; target = i; } });
  }
  const trail = humanSolveFromState(start, cands[target], solver, 4);
  if (!trail) continue;
  const moves: Move3x3[] = [];
  for (const m of trail) {
    moves.push(m);
    const r = rand();
    if (r < 0.15) { const x = rnd(1)[0]; moves.push(x, inv(x)); } else if (r < 0.2) moves.push('U2', 'U2');
  }
  solves++;

  for (const [name, pol] of Object.entries(POLICIES)) {
    const x = T[name];
    let cube = start, prev = pol(start, start);
    moves.forEach((m, i) => {
      cube = applyMove(cube, m);
      const pick = pol(cube, start);
      const placed = cands.map((c) => scorePlacement(cube, c).placed);
      if (placed[target] === Math.max(...placed)) {
        x.states++; if (pick === target) x.right++;
        if (i >= moves.length / 2) { x.late++; if (pick === target) x.lateRight++; }
      }
      if (pick !== prev) { x.switches++; if (pick !== target) x.away++; }
      if (i % 3 === 0) {
        for (const seq of NOOPS) {
          x.probes++;
          if (pol(applyMoves(cube, seq), start) !== pick) x.drift++;
        }
      }
      prev = pick;
    });
    if (!isMaskSolvedState(cube, cands[target])) throw new Error('trail did not build its target');
  }
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '-').padStart(6);
console.log(`placement accuracy — ${fam} (${cands.length} placements), ${solves} ${targetMode}-target human solves, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('policy        right%  late%  switches  away  drift%');
for (const [n, x] of Object.entries(T)) {
  console.log(`${n.padEnd(12)} ${pct(x.right, x.states)} ${pct(x.lateRight, x.late)}  ${(x.switches / solves).toFixed(2).padStart(7)} ${(x.away / solves).toFixed(2).padStart(5)}  ${pct(x.drift, x.probes)}`);
}
