// Oracle harness for src/frame.ts — targets judged the way a solver holds the cube.
//
// 1. Tables: frames are pure relabelings, so for random states, every frame and
//    every outer turn, turning-then-re-holding must equal re-holding-then-turning
//    the renamed move; renaming there and back is the identity; and faceletToModel
//    must say where every facelet of the re-held cube came from.
// 2. Verdicts against the cube in hand: build every target in the app on a
//    scrambled cube, apply a PHYSICAL slice / wide / arrow turn with the engine's
//    real slice moves, re-hold with centres home (what the smart cube reports),
//    and require isTargetSolved to agree with the oracle — the target is solved
//    however you hold the physical cube (any of the 24 rotations), with EO judged
//    against the green/blue centres wherever they now sit. Single outer turns are
//    controls.
// 3. The framed pick: whenever some framed candidate is solved, the pick
//    (placement.ts activeFramed) is a solved one.
//
// Usage: npx tsx scripts/frame-check.ts

import {
  applyMove, applyMoves, faceletString, isMaskSolvedState, newSolved, solveFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import {
  FRAMES, faceletToModel, framedCandidates, inFrame, isTargetSolved, movesFromFrame, movesToFrame,
} from '../src/frame.ts';
import { activeFramed } from '../src/placement.ts';
import {
  TRAINERS, STEP_PAIR, STEP_221, STEP_222_FROM_221, STEP_222_RECOVERY, STEP_223_BUILD, STEP_223_EXT,
  type StepDef,
} from '../src/steps.ts';

let mismatches = 0;
const fail = (msg: string) => { if (mismatches++ < 20) console.log('  MISMATCH', msg); };

let seed = 20261028;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const TURNS = FACES.flatMap((f) => SUF.map((x) => f + x)) as Move3x3[];
const scramble = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};

// --- 1. tables ---------------------------------------------------------------
let tableChecks = 0;
for (let t = 0; t < 12; t++) {
  const c = applyMoves(newSolved(), scramble(20));
  FRAMES.forEach((_, f) => {
    const held = inFrame(c, f);
    const hs = faceletString(held), cs = faceletString(c);
    for (let j = 0; j < 54; j++) if (hs[j] !== cs[faceletToModel(j, f)]) { fail(`faceletToModel frame ${f} slot ${j}`); break; }
    for (const m of TURNS) {
      tableChecks++;
      const x = movesToFrame([m], f)[0];
      if (faceletString(inFrame(applyMove(c, m), f)) !== faceletString(applyMove(held, x))) fail(`frame ${f}: ${m} -> ${x}`);
      if (movesFromFrame([x], f)[0] !== m) fail(`frame ${f}: ${x} does not rename back to ${m}`);
    }
  });
}

// --- 2. verdicts vs the cube in hand ----------------------------------------
const SOLVED = faceletString(newSolved());
const CENTRES = [4, 22, 25, 28, 31, 49]; // engine layout: U, then the L F R B middle row, then D
const F_CENTRE = 25;
const isEo = (m: Cube3x3Mask) => !!m.eoFaceletIndices;

/** What the smart cube reports: the physical cube re-held with every centre home. */
function toModel(physical: Cube3x3): Cube3x3 {
  for (const r of FRAMES) {
    const c = applyMoves(physical, r);
    const f = faceletString(c);
    if (CENTRES.every((i) => f[i] === SOLVED[i])) return c;
  }
  throw new Error('no rotation brings the centres home');
}
/** The oracle: solved however you hold the physical cube. */
function inHand(physical: Cube3x3, cands: Cube3x3Mask[]): boolean {
  return FRAMES.some((r) => {
    const c = applyMoves(physical, r);
    const f = faceletString(c);
    return cands.some((m) => (!isEo(m) || 'FB'.includes(f[F_CENTRE])) && isMaskSolvedState(c, m));
  });
}

const PHYSICAL: string[] = [
  'U', 'R', 'F2', // controls: outer turns, physical == model
  "R L'", 'M', "M'", 'M2', 'E', "E'", 'E2', 'S', "S'", 'S2',
  'r', "r'", 'r2', 'l', "l'", 'u', "u'", 'u2', 'd', "d'", 'f', "f'", 'b',
  "M' U M", "M U2 M'", "r U r'", "M' U", "M U M' U2", "E R E'",
];

const steps = new Map<string, StepDef>();
for (const s of [...TRAINERS.flatMap((t) => t.steps), STEP_PAIR, STEP_221, STEP_222_FROM_221, STEP_222_RECOVERY, STEP_223_BUILD, STEP_223_EXT]) steps.set(s.id, s);

let verdicts = 0, picks = 0;
const SAMPLES = 2;
for (const step of steps.values()) {
  const cands = step.candidateMasks;
  const built: Cube3x3[] = [];
  for (let k = 0; built.length < SAMPLES && k < SAMPLES * 3; k++) {
    const start = applyMoves(newSolved(), scramble(20));
    const sol = solveFromState(start, step.canonicalMask, step.solver);
    if (sol) built.push(applyMoves(start, sol));
  }
  // Targets out of the solver's reach from a full scramble (the Roux second
  // block, built on the first): scramble only the U layer, which they leave free.
  for (let k = 0; built.length < SAMPLES && k < SAMPLES; k++) {
    built.push(applyMoves(newSolved(), scramble(12).map((m) => `U${m.slice(1)}` as Move3x3)));
  }
  const framed = framedCandidates(cands);
  for (const b of built) {
    for (const seq of PHYSICAL) {
      const physical = applyMoves(b, seq.split(' ') as Move3x3[]);
      const model = toModel(physical);
      verdicts++;
      const app = cands.some((m) => isTargetSolved(model, m));
      if (app !== inHand(physical, cands)) fail(`${step.id} after ${seq}: app says ${app ? 'solved' : 'not solved'}`);
      // 3. the framed pick lands on a solved framed candidate when there is one.
      if (framed.length > 1 && framed.some((c) => isMaskSolvedState(inFrame(model, c.frame), c.mask))) {
        picks++;
        const p = framed[activeFramed(model, framed, b, 0)];
        if (!isMaskSolvedState(inFrame(model, p.frame), p.mask)) fail(`${step.id} after ${seq}: pick not solved`);
      }
    }
  }
}

console.log(`frame check — ${tableChecks} turn renamings × 24 frames' facelet maps, ${verdicts} target verdicts vs the cube in hand (${steps.size} targets, ${PHYSICAL.length} turns), ${picks} framed picks`);
console.log(`mismatches ${mismatches}`);
if (mismatches) process.exitCode = 1;
