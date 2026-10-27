// Judging targets the way a solver holds the cube, not the way the model does.
//
// A smart cube reports only outer-face turns, each named by the colour of the
// centre that moved: a physical M arrives as R L', r as L, u as D. The model
// keeps all six centres at home, so it is always the physical cube re-held with
// its centres home. For the cube STATE that is harmless — the two differ only by
// a whole-cube rotation — but every target used to be checked against the
// model's fixed centres. After one M a finished Roux first block sits a quarter
// turn off the U/F/D/B centres, and the app read it as broken: not solved, 0/5
// pieces placed, hints for a block that was already built.
//
// The rule: a target counts as solved if it is solved after some whole-cube
// rotation that leaves the target's OWN centres where they are. Rotating the
// model is free (it is just another way of holding it), and a target that
// carries centres can only match colour-for-colour when those centres are home:
//   - a 1×2×3 (one centre)            → the 4 rotations about its axis = any
//                                        M offset, or the L turn a Roux solver
//                                        would never bother with;
//   - a 2×2×2 / 2×2×3 (centres on two  → only the identity, so these targets
//     or three faces)                     are judged exactly as before;
//   - a pair (no centre)               → all 24, i.e. the pair is joined
//                                        anywhere (Ian, 2026-10-27: the extra
//                                        move to bring it back is the user's
//                                        inefficiency; the block is still right);
//   - EO targets also keep the F/B axis on F/B (EO is judged against the
//     green/blue centres — the Roux arrow M' U M already arrives as R' L F R L'
//     and flips four edges, so EO itself needs no help).
//
// Each allowed rotation is a FRAME. Frame 0 is the identity, so every caller
// that never leaves frame 0 behaves exactly as before. Frames are pure
// relabelings: moves, facelet indices and solver routes all translate between
// a frame and the model through the tables below, which are read off the
// engine itself rather than written by hand.
//
// Guarded by scripts/frame-check.ts (the tables agree with the engine; every
// target's verdict matches the cube in hand under slice and wide turns).

import {
  Cube3x3, MOVESETS, SOLVED_FACELET_CUBE, applyMoves, isMaskSolvedState, solveFromState,
  type Cube3x3Mask, type Move3x3, type StepSolverConfig,
} from './engine-api.ts';
import { NET_COORDS } from './blocks.ts';

/** The 24 whole-cube rotations as move lists; index 0 is the identity. */
export const FRAMES: readonly Move3x3[][] = (() => {
  const tops = [[], ['x'], ['x2'], ["x'"], ['z'], ["z'"]];
  const spins = [[], ['y'], ['y2'], ["y'"]];
  return tops.flatMap((t) => spins.map((s) => [...t, ...s] as Move3x3[]));
})();

const TURNS = ['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => ['', '2', "'"].map((x) => f + x)) as Move3x3[];

// A cube whose 54 stickers are all distinct: turning it shows where every
// facelet goes. Slot j of the turned cube holds what was at index perm[j].
const LABELS = Array.from({ length: 54 }, (_, i) => String.fromCharCode(0x100 + i));
function permOf(moves: readonly Move3x3[]): number[] {
  let c = new Cube3x3(MOVESETS.Full, LABELS as never, LABELS as never);
  for (const m of moves) c = c.clone().applyMove(m);
  return (c.stateData as unknown as string[]).map((x) => x.charCodeAt(0) - 0x100);
}

/** Facelet permutation per frame: slot j of the cube in frame f holds model[FRAME_PERM[f][j]]. */
const FRAME_PERM: readonly Int16Array[] = FRAMES.map((r) => Int16Array.from(permOf(r)));
export function framePerm(f: number): Int16Array {
  return FRAME_PERM[f];
}

/** A facelet index in frame f, as an index into the model. */
export function faceletToModel(j: number, f: number): number {
  return FRAME_PERM[f][j];
}

// Moves between frames: the turn X that does in frame f what m does in the
// model — turning then re-holding equals re-holding then turning.
const MOVE_TO_FRAME: readonly Map<Move3x3, Move3x3>[] = FRAMES.map((r) => {
  const out = new Map<Move3x3, Move3x3>();
  for (const m of TURNS) {
    const want = permOf([m, ...r]).join();
    const x = TURNS.find((t) => permOf([...r, t]).join() === want);
    if (!x) throw new Error(`frame ${r.join(' ')}: no turn matches ${m}`);
    out.set(m, x);
  }
  return out;
});
const MOVE_FROM_FRAME: readonly Map<Move3x3, Move3x3>[] = MOVE_TO_FRAME.map((t) => new Map([...t].map(([m, x]) => [x, m])));

/** Model moves renamed as frame f sees them. */
export function movesToFrame(moves: readonly Move3x3[], f: number): Move3x3[] {
  return f === 0 ? [...moves] : moves.map((m) => MOVE_TO_FRAME[f].get(m) ?? m);
}
/** Frame-f moves renamed as the model (and so the smart cube) sees them. */
export function movesFromFrame(moves: readonly Move3x3[], f: number): Move3x3[] {
  return f === 0 ? [...moves] : moves.map((m) => MOVE_FROM_FRAME[f].get(m) ?? m);
}

/** The cube re-held in frame f (a real engine cube, so EO comes along). */
export function inFrame(cube: Cube3x3, f: number): Cube3x3 {
  return f === 0 ? cube : applyMoves(cube, FRAMES[f]);
}

// Which centre each rotation leaves in place: a centre facelet is fixed when the
// rotated solved cube still shows that centre's own colour there.
const CENTRE_FACELETS = (() => {
  const by = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (by.get(k) ?? by.set(k, []).get(k)!).push(i);
  });
  return [...by.values()].filter((g) => g.length === 1).map((g) => g[0]);
})();
const SOLVED = SOLVED_FACELET_CUBE as readonly string[];
const fixes = (f: number, i: number) => SOLVED[FRAME_PERM[f][i]] === SOLVED[i];
const F_CENTRE = CENTRE_FACELETS.find((i) => SOLVED[i] === 'F')!;
const keepsFB = (f: number) => 'FB'.includes(SOLVED[FRAME_PERM[f][F_CENTRE]]);

const framesCache = new WeakMap<Cube3x3Mask, number[]>();
/** The frames in which this target may be judged solved — identity first. */
export function framesFor(mask: Cube3x3Mask): readonly number[] {
  let fs = framesCache.get(mask);
  if (!fs) {
    const own = CENTRE_FACELETS.filter((i) => mask.solvedFaceletIndices.includes(i));
    fs = FRAMES.flatMap((_, f) =>
      own.every((i) => fixes(f, i)) && (!mask.eoFaceletIndices || keepsFB(f)) ? [f] : []);
    framesCache.set(mask, fs);
  }
  return fs;
}

/** The frames coaching may follow. A target with no centre of its own (a pair)
 *  is complete wherever it forms, but its progress and hints stay in the model's
 *  frame — following every frame would hand the coaching to whichever rotation
 *  happens to line pieces up. */
export function coachFramesFor(mask: Cube3x3Mask): readonly number[] {
  return CENTRE_FACELETS.some((i) => mask.solvedFaceletIndices.includes(i)) ? framesFor(mask) : [0];
}

/** The first frame in which the target is solved, or -1. */
export function solvedFrame(cube: Cube3x3, mask: Cube3x3Mask): number {
  for (const f of framesFor(mask)) if (isMaskSolvedState(inFrame(cube, f), mask)) return f;
  return -1;
}
export function isTargetSolved(cube: Cube3x3, mask: Cube3x3Mask): boolean {
  return solvedFrame(cube, mask) >= 0;
}

/** Shortest solve to the target in any of its frames (ties go to the earlier
 *  frame, so the identity wins). Moves are in that frame's naming. */
export function solveInFrames(
  start: Cube3x3, mask: Cube3x3Mask, cfg: StepSolverConfig,
): { moves: Move3x3[]; frame: number } | null {
  let best: { moves: Move3x3[]; frame: number } | null = null;
  for (const f of framesFor(mask)) {
    const moves = solveFromState(inFrame(start, f), mask, cfg);
    if (moves && (!best || moves.length < best.moves.length)) best = { moves, frame: f };
  }
  return best;
}

/** A coaching target: candidate `idx`'s mask, judged in frame `frame`. */
export interface Framed {
  mask: Cube3x3Mask;
  idx: number;
  frame: number;
}

const framedCache = new WeakMap<readonly Cube3x3Mask[], Framed[]>();
const frame0Cache = new WeakMap<readonly Cube3x3Mask[], Framed[]>();
/** Every candidate in every coaching frame. All frame-0 entries come first, in
 *  candidate order, so entry i is candidate i whenever the frame is the identity
 *  — and ties, which go to the lowest index, prefer not re-holding the cube. */
export function framedCandidates(candidates: readonly Cube3x3Mask[]): Framed[] {
  let out = framedCache.get(candidates);
  if (!out) {
    out = candidates.map((mask, idx) => ({ mask, idx, frame: 0 }));
    candidates.forEach((mask, idx) => {
      for (const frame of coachFramesFor(mask)) if (frame !== 0) out!.push({ mask, idx, frame });
    });
    framedCache.set(candidates, out);
  }
  return out;
}
/** The candidates in the identity frame only (the pre-frames behaviour). */
export function frame0Candidates(candidates: readonly Cube3x3Mask[]): Framed[] {
  let out = frame0Cache.get(candidates);
  if (!out) {
    out = candidates.map((mask, idx) => ({ mask, idx, frame: 0 }));
    frame0Cache.set(candidates, out);
  }
  return out;
}
