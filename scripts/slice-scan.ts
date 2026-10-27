// Which training targets survive slice and wide turns? A measurement, not a gate
// (not in `npm run check`): it lists where the app's verdict disagrees with the
// cube in your hands, to decide the shared fix from.
//
// A smart cube reports only outer-face turns, named by centre colour, and the
// app's model keeps its centres fixed. So a physical M arrives as R L', r as L,
// u as D — the model is the physical cube re-held with every centre at home.
// That is harmless for state (the two differ only by a whole-cube rotation) but
// not for targets checked against fixed centres: after one M, a finished Roux
// first block sits a quarter turn off the U/F/D/B centres and stops counting.
//
// For each target: build it on a scrambled cube, apply a physical turn with the
// engine's real slice/wide moves, then compare three verdicts —
//   hand      the cube in hand: the target is solved however you hold it (any of
//             the 24 whole-cube rotations of the PHYSICAL state). EO is judged
//             against the green/blue centres, wherever they now sit.
//   app       what the app says today: any candidate mask solved in the MODEL.
//   proposed  the fix: any candidate solved in the model after a rotation that
//             leaves that candidate's own centres in place (EO: keeps the F/B
//             axis on F/B).
// Single outer turns (U, R) are controls: physical == model there, so all three
// must agree; a disagreement means the scan itself is wrong. R L' is NOT a control:
// it differs from M only by a whole-cube rotation, which is the whole problem.
//
// Usage: npx tsx scripts/slice-scan.ts [samples-per-target]

import {
  applyMoves, faceletString, isMaskSolvedState, newSolved, solveFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import {
  TRAINERS, STEP_PAIR, STEP_221, STEP_222_FROM_221, STEP_222_RECOVERY, STEP_223_BUILD, STEP_223_EXT,
  type StepDef,
} from '../src/steps.ts';

const samples = Number(process.argv[2] ?? '3');

// Engine facelet layout: U 0–8, then three rows of L F R B (12 each), then D 45–53.
const CENTRES = [4, 22, 25, 28, 31, 49];
const F_CENTRE = 25, B_CENTRE = 31;
const SOLVED = faceletString(newSolved());

const ROTATIONS: Move3x3[][] = (() => {
  const tops: string[][] = [[], ['x'], ['x2'], ["x'"], ['z'], ["z'"]];
  const spins: string[][] = [[], ['y'], ['y2'], ["y'"]];
  return tops.flatMap((t) => spins.map((s) => [...t, ...s] as Move3x3[]));
})();
// Where each rotation sends each centre position's colour: rotation r fixes
// centre position i when the rotated solved cube still has its own colour there.
const ROT_FACELETS = ROTATIONS.map((r) => faceletString(applyMoves(newSolved(), r)));
const fixes = (r: number, i: number) => ROT_FACELETS[r][i] === SOLVED[i];
const keepsFB = (r: number) => 'FB'.includes(ROT_FACELETS[r][F_CENTRE]) && 'FB'.includes(ROT_FACELETS[r][B_CENTRE]);

const isEo = (m: Cube3x3Mask) => !!m.eoFaceletIndices;
const centresOf = (m: Cube3x3Mask) => CENTRES.filter((i) => m.solvedFaceletIndices.includes(i));

/** Re-hold a physical cube with every centre at home: what the smart cube reports. */
function toModel(physical: Cube3x3): Cube3x3 {
  for (const r of ROTATIONS) {
    const c = applyMoves(physical, r);
    const f = faceletString(c);
    if (CENTRES.every((i) => f[i] === SOLVED[i])) return c;
  }
  throw new Error('no rotation brings the centres home');
}

function hand(physical: Cube3x3, cands: Cube3x3Mask[]): boolean {
  return ROTATIONS.some((r) => {
    const c = applyMoves(physical, r);
    const f = faceletString(c);
    return cands.some((m) => {
      // EO against green/blue: the model's F/B centres must sit on the F/B axis.
      if (isEo(m) && !['F', 'B'].includes(f[F_CENTRE])) return false;
      return isMaskSolvedState(c, m);
    });
  });
}
const app = (model: Cube3x3, cands: Cube3x3Mask[]) => cands.some((m) => isMaskSolvedState(model, m));
function proposed(model: Cube3x3, cands: Cube3x3Mask[]): boolean {
  return cands.some((m) => ROTATIONS.some((r, ri) =>
    centresOf(m).every((i) => fixes(ri, i)) && (!isEo(m) || keepsFB(ri)) && isMaskSolvedState(applyMoves(model, r), m)));
}

const TURNS: Record<string, string> = {
  'U (control)': 'U', 'R (control)': 'R', "R L' (= M)": "R L'",
  M: 'M', "M'": "M'", M2: 'M2', E: 'E', "E'": "E'", E2: 'E2', S: 'S', "S'": "S'", S2: 'S2',
  r: 'r', "r'": "r'", r2: 'r2', l: 'l', "l'": "l'", u: 'u', "u'": "u'", u2: 'u2',
  d: 'd', "d'": "d'", f: 'f', "f'": "f'", b: 'b',
  "M' U M (arrow)": "M' U M", "M U2 M'": "M U2 M'", "r U r'": "r U r'", "M' U": "M' U",
};

let seed = 20261027;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const scramble = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};

const steps = new Map<string, StepDef>();
for (const s of [...TRAINERS.flatMap((t) => t.steps), STEP_PAIR, STEP_221, STEP_222_FROM_221, STEP_222_RECOVERY, STEP_223_BUILD, STEP_223_EXT]) steps.set(s.id, s);

type Row = { app: number; proposed: number; n: number; handYes: number };
let controlErrors = 0;
const t0 = Date.now();
console.log(`slice scan — ${steps.size} targets × ${Object.keys(TURNS).length} turns, ${samples} built states each`);
console.log('Only disagreements are listed: app≠hand = today\'s bug, proposed≠hand = a gap in the fix.\n');
for (const step of steps.values()) {
  const cands = step.candidateMasks;
  const built: Cube3x3[] = [];
  for (let k = 0; built.length < samples && k < samples * 3; k++) {
    const start = applyMoves(newSolved(), scramble(20));
    const sol = solveFromState(start, step.canonicalMask, step.solver);
    if (sol) built.push(applyMoves(start, sol));
  }
  // A drill whose target can't be reached from a full scramble within the
  // solver's depth (the Roux second block, with the first already built): scramble
  // only the U layer, which every such target leaves free.
  for (let k = 0; built.length < samples && k < samples; k++) {
    const c = applyMoves(newSolved(), scramble(12).map((m) => `U${m.slice(1)}` as Move3x3));
    if (app(c, cands)) built.push(c);
  }
  if (!built.length) { console.log(`${step.id}: could not build a sample`); continue; }
  const lines: string[] = [];
  for (const [name, seq] of Object.entries(TURNS)) {
    const row: Row = { app: 0, proposed: 0, n: 0, handYes: 0 };
    for (const b of built) {
      if (!app(b, cands)) throw new Error(`${step.id}: built state not solved`);
      const physical = applyMoves(b, seq.split(' ') as Move3x3[]);
      const model = toModel(physical);
      const h = hand(physical, cands);
      row.n++; if (h) row.handYes++;
      if (app(model, cands) !== h) row.app++;
      if (proposed(model, cands) !== h) row.proposed++;
    }
    if (name.includes('control') && (row.app || row.proposed)) controlErrors++;
    if (row.app || row.proposed) {
      lines.push(`  ${name.padEnd(16)} in hand: ${row.handYes === row.n ? 'solved' : row.handYes === 0 ? 'broken' : `${row.handYes}/${row.n} solved`}`.padEnd(42) +
        `app wrong ${row.app}/${row.n}   proposed wrong ${row.proposed}/${row.n}`);
    }
  }
  console.log(`${step.id} (${step.label}, ${cands.length} candidate${cands.length > 1 ? 's' : ''}, centres ${centresOf(step.canonicalMask).length}${isEo(step.canonicalMask) ? ', EO' : ''})${lines.length ? '' : ': all agree'}`);
  for (const l of lines) console.log(l);
}
console.log(`\ncontrol disagreements: ${controlErrors} (must be 0)   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (controlErrors) process.exitCode = 1;
