// One vocabulary between routes and the cube.
//
// A route is what your hands do: positional turns, any layer — R, U, the slice M,
// the wide r. A smart cube reports something else: only OUTER faces, each named by
// the colour of the centre that moved. A physical M arrives as R L′ (the two outer
// faces turn the other way relative to the centres, and the whole cube is now held
// a quarter turn differently); r arrives as a lone L. The model keeps all six
// centres home, so after an M it is the physical cube re-held by a rotation — the
// hand frame (hold.ts, main.ts).
//
// Every translation between those two vocabularies goes through this file:
//   - rename()      — the same physical action named in a re-held frame (the
//                     picture's hold, a coaching frame). Read off the engine's own
//                     permutations, slices and wide turns included; the engine's
//                     translateMoves gets slice directions wrong under half-turn
//                     rotations (M under y2 should read M′), so it is not used.
//   - decompose()   — a positional turn as outer turns plus a whole-cube rotation
//                     (M = R L′ then x′, r = L then x).
//   - toReported()  — a whole route as the cube will report it, with the hold the
//                     hands end up in.
//   - rouxMoveSet() — the moves a Roux solver makes (outer turns, M, r), named for
//                     the model given which block is held bottom-left, so the
//                     solver can search them directly against the model's masks.
//
// Guarded by scripts/notation-check.ts.

import { Cube3x3, MOVESETS, type Move3x3, type RotationMove } from './engine-api.ts';

const SUF = ['', '2', "'"] as const;
const turnsOf = (layers: string) => [...layers].flatMap((l) => SUF.map((s) => (l + s) as Move3x3));
/** Outer-face turns: the only moves a smart cube reports. */
export const OUTER: readonly Move3x3[] = turnsOf('UDLRFB');
/** Every layer turn — outer, slice and wide. */
export const LAYER_MOVES: readonly Move3x3[] = turnsOf('UDLRFBMESudlrfb');
const ROTATIONS = turnsOf('xyz') as RotationMove[];

// --- permutations, read off the engine -------------------------------------------
// A cube whose 54 stickers are all distinct: turning it shows where every facelet
// goes. Slot j of the turned cube holds what was at index perm[j].
const LABELS = Array.from({ length: 54 }, (_, i) => String.fromCharCode(0x100 + i));
const permCache = new Map<string, string>();
/** The facelet permutation of a move sequence, as a comparable key. */
export function permKey(moves: readonly Move3x3[]): string {
  const k = moves.join(' ');
  let p = permCache.get(k);
  if (p === undefined) {
    let c = new Cube3x3(MOVESETS.Full, LABELS as never, LABELS as never);
    for (const m of moves) c = c.clone().applyMove(m);
    p = (c.stateData as unknown as string[]).join('');
    permCache.set(k, p);
  }
  return p;
}

// --- the 24 holds -----------------------------------------------------------------
/** The 24 whole-cube rotations as move lists; index 0 is the identity. */
export const FRAMES: readonly Move3x3[][] = (() => {
  const tops = [[], ['x'], ['x2'], ["x'"], ['z'], ["z'"]];
  const spins = [[], ['y'], ['y2'], ["y'"]];
  return tops.flatMap((t) => spins.map((s) => [...t, ...s] as Move3x3[]));
})();
const FRAME_BY_PERM = new Map(FRAMES.map((r, i) => [permKey(r), i]));
/** The frame index of a rotation sequence (throws if it is not a pure rotation). */
export function frameOf(rots: readonly Move3x3[]): number {
  const f = FRAME_BY_PERM.get(permKey(rots));
  if (f === undefined) throw new Error(`frameOf: ${rots.join(' ')} is not a rotation`);
  return f;
}

// --- renaming ---------------------------------------------------------------------
const MOVE_BY_PERM = new Map(LAYER_MOVES.map((m) => [permKey([m]), m]));
const renameCache = new Map<string, Move3x3>();
/** The move X that does, on the cube re-held by `rots`, what `m` does unrotated:
 *  turning then re-holding equals re-holding then turning (m · rots = rots · X).
 *  Rotations and unknown tokens pass through unchanged. */
export function renameMove(m: Move3x3, rots: readonly Move3x3[]): Move3x3 {
  if (!rots.length || !MOVE_BY_PERM.has(permKey([m]))) return m;
  const key = `${m}|${rots.join(' ')}`;
  let x = renameCache.get(key);
  if (!x) {
    // rots⁻¹ · m · rots, as a single layer turn (conjugating a layer turn by a
    // rotation is always another layer turn).
    const inv = [...rots].reverse().map((r) => (r.endsWith('2') ? r : r.endsWith("'") ? r[0] : `${r}'`) as Move3x3);
    x = MOVE_BY_PERM.get(permKey([...inv, m, ...rots]));
    if (!x) throw new Error(`renameMove: ${m} under ${rots.join(' ')}`);
    renameCache.set(key, x);
  }
  return x;
}
/** A route renamed for the cube re-held by `rots` (model → held frame). */
export function rename(moves: readonly Move3x3[], rots: readonly Move3x3[]): Move3x3[] {
  return moves.map((m) => renameMove(m, rots));
}
const invRots = (rots: readonly Move3x3[]) =>
  [...rots].reverse().map((r) => (r.endsWith('2') ? r : r.endsWith("'") ? r[0] : `${r}'`) as Move3x3);
/** The inverse of rename: held-frame moves back to the unrotated names. */
export function unrename(moves: readonly Move3x3[], rots: readonly Move3x3[]): Move3x3[] {
  return rename(moves, invRots(rots));
}

// --- what the cube reports ----------------------------------------------------------
export const isOuter = (m: string) => 'UDLRFB'.includes(m[0]) && m.length <= 2;
export const isSlice = (m: string) => 'MES'.includes(m[0]);
export const isWide = (m: string) => 'udlrfb'.includes(m[0]);

// Outer-turn sets that can stand for one layer turn: a single face, or the two
// faces of one axis turned together (a slice, or a slice plus a face).
const AXIS_PAIRS = [['R', 'L'], ['U', 'D'], ['F', 'B']] as const;
const OUTER_COMBOS: Move3x3[][] = [
  ...OUTER.map((m) => [m]),
  ...AXIS_PAIRS.flatMap(([a, b]) => SUF.flatMap((x) => SUF.map((y) => [`${a}${x}`, `${b}${y}`] as Move3x3[]))),
];
const decomposeCache = new Map<Move3x3, { turns: Move3x3[]; rot: Move3x3[] }>();
/** A layer turn as the outer turns the cube reports, then the whole-cube rotation
 *  that is left over: M = R L′ · x′, r = L · x, R = R · (none). */
export function decompose(m: Move3x3): { turns: Move3x3[]; rot: Move3x3[] } {
  let d = decomposeCache.get(m);
  if (!d) {
    const want = permKey([m]);
    for (const turns of OUTER_COMBOS) {
      const f = FRAMES.findIndex((r) => permKey([...turns, ...r]) === want);
      if (f >= 0) { d = { turns, rot: FRAMES[f] }; break; }
    }
    if (!d) throw new Error(`decompose: ${m} is not a layer turn`);
    decomposeCache.set(m, d);
  }
  return d;
}

/** A route of positional turns as the cube will report it. The route is named for
 *  the model as held at its start (centres home); `hand` is the frame the hands
 *  hold it in on top of that. Returns, per route move, the outer turns the cube
 *  sends (model names, in any order — the faces of one axis commute), and the hand
 *  frame after it. A route of outer turns comes back unchanged, hand unmoved. */
export function toReported(
  route: readonly Move3x3[], hand = 0,
): { turns: Move3x3[][]; hands: number[] } {
  // G: the rotation built up by the slices so far. After them the hands still name
  // turns positionally, so the next turn is the route's move seen through G.
  let G: Move3x3[] = [];
  const turns: Move3x3[][] = [], hands: number[] = [];
  for (const m of route) {
    const x = renameMove(m, invRots(G)); // G · m = x · G
    const d = decompose(x);
    turns.push(d.turns);
    G = FRAMES[frameOf([...d.rot, ...G])];
    hands.push(frameOf([...G, ...FRAMES[hand]]));
  }
  return { turns, hands };
}
/** The reported turns of a route, flattened. */
export function reportedTurns(route: readonly Move3x3[], hand = 0): Move3x3[] {
  return toReported(route, hand).turns.flat();
}

// --- the Roux move set ------------------------------------------------------------
/** What a Roux solver turns, held with the first block bottom-left: outer faces,
 *  the M slice and the wide r. */
export const ROUX_HELD: readonly Move3x3[] = turnsOf('UDLRFBMr');
/** The Roux second block's own moves: R, r, U, M — they never disturb the first block. */
export const ROUX_SB_HELD: readonly Move3x3[] = turnsOf('RrUM');
/** A held-frame move set named for the model, given the rotation that shows the
 *  model in the held frame (hold.ts holdFor). Sorted for a stable table key. */
export function heldMoveSet(held: readonly Move3x3[], rots: readonly Move3x3[]): Move3x3[] {
  return unrename(held, rots).sort();
}

// --- part-way through one route move ---------------------------------------------
const amountOf = (m: string) => (m.endsWith('2') ? 2 : m.endsWith("'") ? 3 : 1);
const withAmount = (face: string, k: number) => (face + ['', '', '2', "'"][k]) as Move3x3;
/** The reports that leave one route move part-done, on the way rather than off it:
 *  one half of a slice (R before the L′ of an M), one quarter of a half turn (the
 *  cube reports R2 as two quarters, either way round). Excludes nothing-yet and
 *  all-done. `turns` is one entry of toReported's `turns`. */
export function partialReports(turns: readonly Move3x3[]): Move3x3[][] {
  const options = turns.map((t) => {
    const a = amountOf(t);
    return a === 2 ? [0, 1, 3, 2] : [0, a];
  });
  const out: Move3x3[][] = [];
  const walk = (i: number, acc: Move3x3[], full: boolean, none: boolean) => {
    if (i === turns.length) {
      if (!full && !none) out.push(acc);
      return;
    }
    for (const k of options[i]) {
      walk(i + 1, k ? [...acc, withAmount(turns[i][0], k)] : acc, full && k === amountOf(turns[i]), none && k === 0);
    }
  };
  walk(0, [], true, true);
  return out;
}

// --- following a route the app showed ------------------------------------------
/** Where the cube sits on a route, walking it as the cube REPORTS it (`turns`, from
 *  toReported): the live cube matching the state after k route moves means k are
 *  done. Matching none is off the route — EXCEPT part-way through one move, still
 *  on the way rather than off it (partialReports: a quarter of a half turn, one
 *  half of a slice), which counts as the moves before it. */
export function walkReported(base: Cube3x3, turns: readonly Move3x3[][], cur: Cube3x3): { done: number; deviated: boolean } {
  const target = cur.encode();
  let c = base;
  if (c.encode() === target) return { done: 0, deviated: false };
  for (let k = 0; k < turns.length; k++) {
    for (const p of partialReports(turns[k])) {
      if (c.clone().applyMoves(p).encode() === target) return { done: k, deviated: false };
    }
    c = c.clone().applyMoves(turns[k]);
    if (c.encode() === target) return { done: k + 1, deviated: false };
  }
  return { done: 0, deviated: true };
}

/** A route on screen, being followed turn by turn (main.ts state.follow). */
export interface Follow {
  base: Cube3x3;
  /** Positional, named for the model at `base` (as the solver gives it). */
  moves: Move3x3[];
  /** The hand frame when it was shown, and toReported's view of it from there. */
  hand: number;
  turns: Move3x3[][];
  hands: number[];
  /** Route moves completed so far, and where the turns of the next one start in the
   *  caller's list of turns made. */
  done: number;
  since: number;
}
export function startFollow(base: Cube3x3, moves: readonly Move3x3[], hand: number, since: number): Follow {
  const r = toReported(moves, hand);
  return { base, moves: [...moves], hand, turns: r.turns, hands: r.hands, done: 0, since };
}
/** One reported turn has landed the cube on `cur`. Off the route → null (stop
 *  following). On it → the hand frame to hold now, and, when this turn finished
 *  route move k, that move: the turns since `since` were that one move (an r that
 *  reported as L, the two halves of a slow M, R R for an R2). Mutates `f`. */
export function followTurn(f: Follow, cur: Cube3x3): { hand: number; finished: Move3x3 | null } | null {
  const w = walkReported(f.base, f.turns, cur);
  if (w.deviated) return null;
  const finished = w.done === f.done + 1 ? f.moves[w.done - 1] : null;
  f.done = w.done;
  return { hand: w.done ? f.hands[w.done - 1] : f.hand, finished };
}
