// The pieces of a Roux first block, and what a solver builds it from.
//
// teoidus, "Finding an Efficient First Block in Inspection"
// (https://youtu.be/0Cq3YDud1dA), names the structures a first block is built
// from and a flowchart for spotting them in inspection. Held with the block at
// the bottom-left, the block is six pieces: the left centre (C), the bottom edge
// (DL), the two bottom corners (DLF, DLB) and the two middle-layer edges (FL, BL).
//
//   - Pairs (doubles): an edge + centre pair (DL+C, FL+C, BL+C); an "F2L pair",
//     corner + middle edge (DLF+FL, DLB+BL); a "line block", corner + bottom edge
//     (DLF+DL, DLB+DL).
//   - Lines (triples): the 3×1 bottom line (DLB-DL-DLF) and the 3×1 middle "E
//     line" (BL-C-FL).
//   - Squares: the front or back half of the block (C, DL, a corner, its middle
//     edge).
//
// A square is two doubles joined, in one of two ways, and which double came
// first is teoidus's approach:
//
//     square = DL+C  + F2L pair  →  DL+C first: F2L-style;  pair first: pair-first
//     square = FL+C  + line block →  line block first: line-block;  FL+C first: E-line
//
// The fifth approach joins the two lines (line + line). Under the fixed-colour
// rule the E-line approach is exactly the line-block one built the other way
// round — teoidus's "treat the E line as DL and pretend you're colour neutral"
// builds a different block; for one fixed block the E-line square is the middle
// edge + centre joined to a line block.
//
// Every structure is a mask on the block's own pieces, judged with frame.ts: one
// that carries the centre counts around it in any of 4 orientations; one without
// (a pair, the bottom line) counts joined anywhere, in any of 24. So "a free F2L
// pair" is simply that pair's mask solved in some frame. Structures are defined
// once on the display's bottom-left block and carried to any first block through
// hold.ts. Guarded by scripts/fb-structures-check.ts against an independent
// sticker-geometry oracle.

import {
  applyMove, applyMoves, isMaskSolvedState, solveFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3, type RotationMove, type StepSolverConfig,
} from './engine-api.ts';
import { MASK_123_LEFT, blockMaskFromRanges } from './blocks.ts';
import { cfgInFrame, framesFor, inFrame, movesFromFrame, solveInFrames } from './frame.ts';
import { holdFor } from './hold.ts';
import { unrotateHighlight } from './orient.ts';

export type StructureId =
  | 'ecD' | 'ecF' | 'ecB' // edge + centre
  | 'pairF' | 'pairB' // F2L pair: corner + middle edge
  | 'lineBlockF' | 'lineBlockB' // line block: corner + bottom edge
  | 'lineD' | 'lineE' // 3×1 lines
  | 'squareF' | 'squareB'
  | 'block';

// On the display's bottom-left block: x 0 = left, y 0 = bottom, z 0 = back.
const DISPLAY: Readonly<Record<StructureId, Cube3x3Mask>> = {
  ecD: blockMaskFromRanges([0], [0, 1], [1]),
  ecF: blockMaskFromRanges([0], [1], [1, 2]),
  ecB: blockMaskFromRanges([0], [1], [0, 1]),
  pairF: blockMaskFromRanges([0], [0, 1], [2]),
  pairB: blockMaskFromRanges([0], [0, 1], [0]),
  lineBlockF: blockMaskFromRanges([0], [0], [1, 2]),
  lineBlockB: blockMaskFromRanges([0], [0], [0, 1]),
  lineD: blockMaskFromRanges([0], [0], [0, 1, 2]),
  lineE: blockMaskFromRanges([0], [1], [0, 1, 2]),
  squareF: blockMaskFromRanges([0], [0, 1], [1, 2]),
  squareB: blockMaskFromRanges([0], [0, 1], [0, 1]),
  block: MASK_123_LEFT,
};
export const STRUCTURES = Object.keys(DISPLAY) as StructureId[];
export const PAIR_IDS: readonly StructureId[] = ['pairF', 'pairB', 'lineBlockF', 'lineBlockB'];
export const EDGE_CENTRE_IDS: readonly StructureId[] = ['ecD', 'ecF', 'ecB'];

const masksCache = new WeakMap<Cube3x3Mask, Record<StructureId, Cube3x3Mask>>();
/** Every structure of first block `fb` (any side 1×2×3 from hold.ts), as model masks. */
export function structureMasks(fb: Cube3x3Mask): Readonly<Record<StructureId, Cube3x3Mask>> {
  let m = masksCache.get(fb);
  if (!m) {
    const hold = holdFor(fb);
    m = Object.fromEntries(STRUCTURES.map((id) => [id, {
      solvedFaceletIndices: unrotateHighlight(new Set(DISPLAY[id].solvedFaceletIndices), hold as RotationMove[]),
    }])) as unknown as Record<StructureId, Cube3x3Mask>;
    masksCache.set(fb, m);
  }
  return m;
}

/** The frame a structure is formed in on this cube, or -1. */
export function structureFrame(cube: Cube3x3, fb: Cube3x3Mask, id: StructureId): number {
  const mask = structureMasks(fb)[id];
  for (const f of framesFor(mask)) if (isMaskSolvedState(inFrame(cube, f), mask)) return f;
  return -1;
}
/** Which structures are formed (each anywhere it is allowed to be). */
export function presentStructures(cube: Cube3x3, fb: Cube3x3Mask): Set<StructureId> {
  return new Set(STRUCTURES.filter((id) => structureFrame(cube, fb, id) >= 0));
}

// "A pair like this but one move away" — any outer or slice turn joins it.
const ONE_MOVES = ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S']
  .flatMap((f) => ['', '2', "'"].map((s) => f + s)) as Move3x3[];
/** Corner–edge pairs that are not formed but one move would form. */
export function disjointedPairs(cube: Cube3x3, fb: Cube3x3Mask): StructureId[] {
  return PAIR_IDS.filter((id) => structureFrame(cube, fb, id) < 0 &&
    ONE_MOVES.some((m) => structureFrame(applyMove(cube, m), fb, id) >= 0));
}

// --- the flowchart -----------------------------------------------------------
export type Approach = 'f2l' | 'pairFirst' | 'lineBlock' | 'eLine' | 'lines';
export const APPROACHES: readonly Approach[] = ['f2l', 'pairFirst', 'lineBlock', 'eLine', 'lines'];
export const APPROACH_LABEL: Readonly<Record<Approach, string>> = {
  f2l: 'F2L-style', pairFirst: 'F2L pair first', lineBlock: 'Line-block square', eLine: 'E-line square', lines: 'Line + line',
};
export type Branch = 'lineD' | 'lineE' | 'cornerEdge' | 'edgeCentre' | 'disjointed' | 'fallback';
/** teoidus's flowchart: the first feature found, top to bottom, and the
 *  approaches it points to. */
export function flowchart(cube: Cube3x3, fb: Cube3x3Mask): { branch: Branch; approaches: Approach[] } {
  const has = presentStructures(cube, fb);
  if (has.has('lineD')) return { branch: 'lineD', approaches: ['lines'] };
  if (has.has('lineE')) return { branch: 'lineE', approaches: ['lines'] };
  const ce: Approach[] = [];
  if (has.has('pairF') || has.has('pairB')) ce.push('pairFirst');
  if (has.has('lineBlockF') || has.has('lineBlockB')) ce.push('lineBlock');
  if (ce.length) return { branch: 'cornerEdge', approaches: ce };
  const ec: Approach[] = [];
  if (has.has('ecD')) ec.push('f2l');
  if (has.has('ecF') || has.has('ecB')) ec.push('eLine');
  if (ec.length) return { branch: 'edgeCentre', approaches: ec };
  const dj = disjointedPairs(cube, fb);
  if (dj.length) {
    const a: Approach[] = [];
    if (dj.some((id) => id.startsWith('pair'))) a.push('pairFirst');
    if (dj.some((id) => id.startsWith('lineBlock'))) a.push('lineBlock');
    return { branch: 'disjointed', approaches: a };
  }
  return { branch: 'fallback', approaches: ['f2l'] };
}

// --- which approach a solve used ------------------------------------------------
// The two ways each square splits into doubles, and the approach each order means.
const SPLITS: ReadonlyArray<{ square: StructureId; a: StructureId; b: StructureId; aFirst: Approach; bFirst: Approach }> = [
  { square: 'squareF', a: 'ecD', b: 'pairF', aFirst: 'f2l', bFirst: 'pairFirst' },
  { square: 'squareF', a: 'lineBlockF', b: 'ecF', aFirst: 'lineBlock', bFirst: 'eLine' },
  { square: 'squareB', a: 'ecD', b: 'pairB', aFirst: 'f2l', bFirst: 'pairFirst' },
  { square: 'squareB', a: 'lineBlockB', b: 'ecB', aFirst: 'lineBlock', bFirst: 'eLine' },
];
export interface ApproachRead {
  approach: Approach;
  /** The double (or line) built first, and the state index it formed at. */
  first: StructureId;
  formedAt: number;
  /** State index at which the square (or, for line + line, the block) formed. */
  joinedAt: number;
}
/**
 * Read the approach off a solve: `states[0]` is the start, each next state one
 * turn on. At the turn that first forms a square (or the block from two lines),
 * look at what stood just before: the two halves it joined, and which of them
 * formed first and stayed formed. Null when nothing was joined (the square was
 * there from the start, or appeared piece by piece with no double standing).
 * Two halves formed on the same turn read as the bottom-edge-first order
 * (F2L-style, line-block). Line + line wins when both lines stood.
 */
export function readApproach(states: readonly Cube3x3[], fb: Cube3x3Mask): ApproachRead | null {
  const sets = states.map((c) => presentStructures(c, fb));
  const t = sets.findIndex((s) => s.has('squareF') || s.has('squareB') || s.has('block'));
  if (t <= 0) return null;
  const before = sets[t - 1];
  /** The turn a structure standing at t-1 formed at (it stood ever since). */
  const formedAt = (id: StructureId) => {
    let k = t - 1;
    while (k > 0 && sets[k - 1].has(id)) k--;
    return k;
  };
  if (before.has('lineD') && before.has('lineE') && sets[t].has('block')) {
    const d = formedAt('lineD'), e = formedAt('lineE');
    return d <= e ? { approach: 'lines', first: 'lineD', formedAt: d, joinedAt: t }
      : { approach: 'lines', first: 'lineE', formedAt: e, joinedAt: t };
  }
  let best: (ApproachRead & { score: number }) | null = null;
  for (const sp of SPLITS) {
    if (!sets[t].has(sp.square)) continue;
    const ha = before.has(sp.a), hb = before.has(sp.b);
    if (!ha && !hb) continue;
    let read: ApproachRead;
    if (ha && hb) {
      const fa = formedAt(sp.a), fbAt = formedAt(sp.b);
      read = fa <= fbAt ? { approach: sp.aFirst, first: sp.a, formedAt: fa, joinedAt: t }
        : { approach: sp.bFirst, first: sp.b, formedAt: fbAt, joinedAt: t };
    } else {
      // Only one half stood: the other went in piece by piece onto it.
      const id = ha ? sp.a : sp.b;
      read = { approach: ha ? sp.aFirst : sp.bFirst, first: id, formedAt: formedAt(id), joinedAt: t };
    }
    // Both halves standing beats one; then the longer-standing first half.
    const score = (ha && hb ? 1000 : 0) - read.formedAt;
    if (!best || score > best.score) best = { ...read, score };
  }
  if (!best) return null;
  const { score: _score, ...read } = best;
  return read;
}

// --- the best route each approach allows -------------------------------------------
/** What an approach builds first, and what it joins that into. */
const PLAN: Readonly<Record<Approach, ReadonlyArray<{ first: StructureId; then: StructureId }>>> = {
  f2l: [{ first: 'ecD', then: 'squareF' }, { first: 'ecD', then: 'squareB' }],
  pairFirst: [{ first: 'pairF', then: 'squareF' }, { first: 'pairB', then: 'squareB' }],
  lineBlock: [{ first: 'lineBlockF', then: 'squareF' }, { first: 'lineBlockB', then: 'squareB' }],
  eLine: [{ first: 'ecF', then: 'squareF' }, { first: 'ecB', then: 'squareB' }],
  lines: [{ first: 'lineD', then: 'block' }, { first: 'lineE', then: 'block' }],
};
export interface ApproachRoute {
  /** Model move names, as the smart cube reports them. */
  moves: Move3x3[];
  /** Moves to the first structure, then to the square (or block), then to the block. */
  stages: number[];
  first: StructureId;
}
/**
 * The shortest staged route for an approach: optimal to its first structure (in
 * any placement within one move of the shortest), then optimal on to its square,
 * then to the block. Each stage is optimal for its target, not constrained to keep
 * what came before, so it is the approach's best route as a solver plans it — the
 * route a solve following the approach would have to beat. Null if a stage has no
 * solution within the solver's depth. With a Roux config (hold.ts resolveSolver)
 * the stages may use M and r; the moves are then positional — the route as the
 * hands make it — and toReported (notation.ts) says what the cube would send.
 */
export function bestForApproach(start: Cube3x3, fb: Cube3x3Mask, approach: Approach, cfg: StepSolverConfig): ApproachRoute | null {
  const masks = structureMasks(fb);
  let best: ApproachRoute | null = null;
  for (const { first, then } of PLAN[approach]) {
    const mask = masks[first];
    // cfgInFrame: a Roux move set (M, r) is renamed for each frame searched.
    const firsts = framesFor(mask).map((f) => ({ f, moves: solveFromState(inFrame(start, f), mask, cfgInFrame(cfg, f)) }))
      .filter((x): x is { f: number; moves: Move3x3[] } => !!x.moves);
    if (!firsts.length) continue;
    const shortest = Math.min(...firsts.map((x) => x.moves.length));
    for (const { f, moves: inF } of firsts) {
      if (inF.length > shortest + 1) continue;
      if (best && inF.length >= best.moves.length) continue;
      // Every stage is named back in the model before the next one starts: a
      // centre-less first structure may be solved in any of 24 frames, and the
      // square after it must still be judged against the real centres.
      const m1 = movesFromFrame(inF, f);
      const c1 = applyMoves(start, m1);
      let m2: Move3x3[] = [];
      if (then !== 'block') {
        const s2 = solveInFrames(c1, masks[then], cfg);
        if (!s2) continue;
        m2 = movesFromFrame(s2.moves, s2.frame);
      }
      const s3 = solveInFrames(applyMoves(c1, m2), masks.block, cfg);
      if (!s3) continue;
      const m3 = movesFromFrame(s3.moves, s3.frame);
      const len = m1.length + m2.length + m3.length;
      if (best && len >= best.moves.length) continue;
      best = { moves: [...m1, ...m2, ...m3], stages: then === 'block' ? [m1.length, m3.length] : [m1.length, m2.length, m3.length], first };
    }
  }
  return best;
}
