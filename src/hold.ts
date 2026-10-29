// How the cube is held while solving.
//
// The model and the scramble stay white-top / green-front (the cube reports
// turns by centre colour, whatever way up you hold it). What changes is only the
// frame the solve is DISPLAYED in: the picture, the highlights and the names of
// hint moves (orient.ts does the translating). Two sources decide that frame:
//
//   - Roux 1×2×3 trainers: the BLOCK decides. A Roux solver holds the first block
//     bottom-left, so the hold is the rotation that puts the block being coached
//     there — white-bottom / blue-left for Ian's fixed block, and whichever block
//     the scramble favoured once colour neutrality is switched on. main.ts adds
//     the slice offset on top (the hand frame, below), so after an M the hint
//     names still match the hands.
//   - Every other trainer: a fixed hold chosen in Settings (HOLDS below).
//
// Colour neutrality for the 1×2×3 trainers is a ladder (Ian, 2026-10-29): white
// bottom with blue left → blue or green left → any side colour left → yellow
// bottom as well. Each rung adds to the one before; the final "any" rung is the
// old accept-every-block behaviour. Guarded by scripts/hold-check.ts.

import { applyMove, applyMoves, faceletString, newSolved, type Cube3x3, type Cube3x3Mask, type Move3x3, type RotationMove } from './engine-api.ts';
import { MASK_123_LEFT, MASK_123_RIGHT, blockMaskFromRanges, side123Masks } from './blocks.ts';
import { FRAMES, framesFor } from './frame.ts';
import { FACE_COLOUR, rotateHighlight, rotatedFacelets, unrotateHighlight } from './orient.ts';

// Centre facelets in faceletString's layout (U, then the L F R B rows, then D).
const L_C = 22, D_C = 49;

// --- the fixed holds (non-1×2×3 trainers) ---------------------------------------
export type Hold = 'wg' | 'wr' | 'wb' | 'wo' | 'yb' | 'yr' | 'yg' | 'yo';
export const HOLDS: readonly Hold[] = ['wg', 'wr', 'wb', 'wo', 'yb', 'yr', 'yg', 'yo'];
/** Model → held rotation for each hold (top colour, front colour). */
export const HOLD_ROTATION: Readonly<Record<Hold, RotationMove[]>> = {
  wg: [], wr: ['y'], wb: ['y2'], wo: ["y'"],
  yb: ['x2'], yr: ['x2', 'y'], yg: ['x2', 'y2'], yo: ['x2', "y'"],
};

const SOLVED = newSolved();

// --- the colour-neutrality ladder (1×2×3 trainers) ------------------------------
export type CnRung = 'blue' | 'bluegreen' | 'white' | 'dual' | 'any';
export const CN_RUNGS: readonly CnRung[] = ['blue', 'bluegreen', 'white', 'dual', 'any'];
export const CN_LABEL: Readonly<Record<CnRung, string>> = {
  blue: 'Blue left', bluegreen: 'Blue or green', white: 'Any left', dual: '+ Yellow bottom', any: 'Any block',
};

// A side 1×2×3 on face `left`, lying on the white (model U) or yellow (D) layers.
const FULL = [0, 1, 2];
const ON_WHITE = [1, 2], ON_YELLOW = [0, 1];
function sideBlock(ys: number[], left: 'B' | 'F' | 'L' | 'R'): Cube3x3Mask {
  if (left === 'B') return blockMaskFromRanges(FULL, ys, [0]);
  if (left === 'F') return blockMaskFromRanges(FULL, ys, [2]);
  if (left === 'L') return blockMaskFromRanges([0], ys, FULL);
  return blockMaskFromRanges([2], ys, FULL);
}
const LEFTS = ['B', 'F', 'L', 'R'] as const; // blue, green, orange, red
const sameSet = (a: Cube3x3Mask, b: Cube3x3Mask) =>
  a.solvedFaceletIndices.length === b.solvedFaceletIndices.length &&
  a.solvedFaceletIndices.every((i) => b.solvedFaceletIndices.includes(i));

/** Every side 1×2×3, ladder order: white-bottom blue, green, orange, red; then the
 *  same on yellow; then the rest. A rung is a prefix of this list, so the first
 *  entry (white-bottom / blue-left) is always the canonical block. */
export const ALL_FB: readonly Cube3x3Mask[] = (() => {
  const ladder = [...LEFTS.map((l) => sideBlock(ON_WHITE, l)), ...LEFTS.map((l) => sideBlock(ON_YELLOW, l))];
  return [...ladder, ...side123Masks().filter((m) => !ladder.some((x) => sameSet(x, m)))];
})();
const RUNG_SIZE: Readonly<Record<CnRung, number>> = { blue: 1, bluegreen: 2, white: 4, dual: 8, any: ALL_FB.length };
const RUNG_LIST = new Map<CnRung, readonly Cube3x3Mask[]>(CN_RUNGS.map((r) => [r, ALL_FB.slice(0, RUNG_SIZE[r])]));
/** The first blocks a rung accepts (stable arrays — callers cache by identity). */
export function rungBlocks(r: CnRung): readonly Cube3x3Mask[] {
  return RUNG_LIST.get(r)!;
}

// --- block → hold ---------------------------------------------------------------
const LEFT_HOME = new Set(MASK_123_LEFT.solvedFaceletIndices); // the display's bottom-left 1×2×3
const holdCache = new WeakMap<Cube3x3Mask, RotationMove[]>();
/** The rotation that shows this side 1×2×3 at the bottom-left. */
export function holdFor(fb: Cube3x3Mask): RotationMove[] {
  let r = holdCache.get(fb);
  if (!r) {
    const src = new Set(fb.solvedFaceletIndices);
    const found = FRAMES.find((f) => {
      const d = rotateHighlight(src, f as RotationMove[]);
      return d.size === LEFT_HOME.size && [...d].every((i) => LEFT_HOME.has(i));
    });
    if (!found) throw new Error('holdFor: not a side 1×2×3');
    r = found as RotationMove[];
    holdCache.set(fb, r);
  }
  return r;
}
/** "white-bottom / blue-left": the block's own colours, wherever the centres are. */
export function blockHoldLabel(fb: Cube3x3Mask): string {
  const f = rotatedFacelets(SOLVED, holdFor(fb));
  return `${FACE_COLOUR[f[D_C]]}-bottom / ${FACE_COLOUR[f[L_C]]}-left`;
}

// --- the hand frame ---------------------------------------------------------------
// After an M the cube in your hands is the model re-held by a quarter turn about
// the block's axis, but the cube reports only outer faces: M arrives as R L', the
// same two events as an outer R and L'. Reading it off the pieces doesn't work
// either: the app's own routes are outer-turn only (they imitate M with the
// block's face, L), so a hint-follower's L looks exactly like an r. Measured: a
// piece-count rule re-held 37 of 60 hint-following first-block builds and 20 of 25
// second blocks wrongly. What does tell a slice apart is TIMING — the two halves
// of a physical M land milliseconds apart, while someone turning R then L' takes
// far longer (cubedex pairs on the same signal, at 100 ms). So the hold changes
// only on a timed pair through the block's axis, and the new frame is then read
// exactly: the one in which the cube is the previous view turned by M, M' or M2.
// A wide turn (r arrives as a lone L) is not detected yet; that needs routes that
// use r, so the app knows when an L it sees is the r it suggested (HANDOFF,
// prerequisite 3).
const SOLVED_STR = faceletString(SOLVED);
/** The model face the block's own centre sits on (B for white-bottom / blue-left). */
export function blockFace(fb: Cube3x3Mask): string {
  const c = [4, 22, 25, 28, 31, 49].find((i) => fb.solvedFaceletIndices.includes(i));
  if (c === undefined) throw new Error('blockFace: block has no centre');
  return SOLVED_STR[c];
}
/** The two halves of one physical slice must land within this many ms. */
export const SLICE_PAIR_MS = 150;
const OPPOSITE: Readonly<Record<string, string>> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };
const quarter = (m: string) => (m.endsWith('2') ? 2 : m.endsWith("'") ? 3 : 1);
/** Could reported turns a, b be one slice through the block's axis? Opposite faces
 *  on that axis, turned in opposite senses (M = R L', M' = R' L, M2 = R2 L2). */
export function isSlicePair(a: Move3x3, b: Move3x3, fb: Cube3x3Mask): boolean {
  const own = blockFace(fb);
  const faces = a[0] + b[0];
  return (faces === own + OPPOSITE[own] || faces === OPPOSITE[own] + own) && (quarter(a) + quarter(b)) % 4 === 0;
}
const SLICES = ['M', "M'", 'M2'] as Move3x3[];
/** The hand frame after a slice pair: `before` is the cube ahead of the pair,
 *  `after` the cube now. Held with the block bottom-left, a slice through its axis
 *  is an M in the hand's own names. Unchanged if no frame fits. */
export function reholdAfterSlice(before: Cube3x3, after: Cube3x3, fb: Cube3x3Mask, prev: number): number {
  const H = holdFor(fb);
  const shown = applyMoves(before, [...FRAMES[prev], ...H] as Move3x3[]);
  const turned = SLICES.map((s) => faceletString(applyMove(shown, s)));
  for (const g of framesFor(fb)) {
    const view = rotatedFacelets(after, [...(FRAMES[g] as RotationMove[]), ...H]);
    if (turned.includes(view)) return g;
  }
  return prev;
}

// --- the Roux second block --------------------------------------------------------
const sbCache = new WeakMap<Cube3x3Mask, Cube3x3Mask>();
/** First block + the second block opposite it, on the same layers. */
export function bothBlocks(fb: Cube3x3Mask): Cube3x3Mask {
  let m = sbCache.get(fb);
  if (!m) {
    const sb = unrotateHighlight(new Set(MASK_123_RIGHT.solvedFaceletIndices), holdFor(fb));
    m = { solvedFaceletIndices: [...fb.solvedFaceletIndices, ...sb] };
    sbCache.set(fb, m);
  }
  return m;
}
