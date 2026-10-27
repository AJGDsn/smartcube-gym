// Placement-aware candidate selection for block steps.
//
// Block completion accepts a block built in ANY of a step's candidate
// placements (main.ts solvedStepMask), but coaching used to aim at the
// canonical placement only — so a solver building anywhere else saw a progress
// meter stuck at zero and hints telling them to abandon a perfectly good
// block. This module decides WHICH placement the user is actually going for,
// so progress, the ideal count, hints and Learn can follow the user.
//
// The signal is REACH, not just pieces placed: for each candidate, the most of
// its pieces that sit solved within one turn, then within two, then now. A
// corner-edge pair waiting to be inserted, or a finished block offset by one
// layer, is invisible to a placed count but is exactly what a blockbuilder's
// work in progress looks like. Placed counts alone tie on ~70–80% of the states
// where the user's block is identifiable, so the old pick was a guess most of
// the time (68% right late in a 2×2×2 solve; 93% with reach).
//
// Stability comes from an ANCHOR, not from memory: the pick made on the step's
// start state keeps the job unless a challenger strictly out-reaches it. That
// is a pure function of (start state, live state), so a no-op sequence — U U U U,
// a wrong turn undone — always lands back on the same pick. The previous design
// threaded the last pick through every move (hysteresis), which made the pick a
// fold over the move path: about one no-op excursion in five handed the job to
// a different block for good and moved the displayed ideal under the user.
//
// Candidates can also be FRAMED (frame.ts): the same mask judged with the cube
// re-held, so a Roux block left a slice turn off the centres is still the block
// being built. A frame is a fixed relabeling of the facelets, so reach in a frame
// is reach on the permuted state; frame-0 entries come first, and ties go to the
// lowest index, so the pick only re-holds the cube when that strictly out-reaches.
//
// Pure geometry over the live cube state — no app state, no solver calls.
// Guarded by scripts/placement-check.ts (reach agrees with turning the engine's
// own cube; the pick is the anchor unless strictly out-reached; no-op sequences
// never move it; a finished block is always picked).

import { Cube3x3, MOVESETS, SOLVED_FACELET_CUBE, type Cube3x3Mask, type Move3x3 } from './engine-api.ts';
import { NET_COORDS } from './blocks.ts';
import { frame0Candidates, framePerm, type Framed } from './frame.ts';

// Facelets grouped into movable cubies (pieces): coordinate groups with more
// than one facelet. Centres are fixed and carry no placement signal.
const PIECES: number[][] = (() => {
  const by = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (by.get(k) ?? by.set(k, []).get(k)!).push(i);
  });
  return [...by.values()].filter((g) => g.length > 1);
})();

// The pieces a mask covers, cached by mask identity — candidate masks are
// module-level constants (steps.ts), so identity is stable for the app's life.
const piecesCache = new WeakMap<Cube3x3Mask, number[][]>();
function piecesFor(mask: Cube3x3Mask): number[][] {
  let p = piecesCache.get(mask);
  if (!p) {
    const set = new Set(mask.solvedFaceletIndices);
    p = PIECES.filter((g) => g.some((i) => set.has(i)));
    piecesCache.set(mask, p);
  }
  return p;
}

export interface PlacementScore {
  placed: number; // whole pieces of the mask sitting solved
  total: number; // pieces the mask covers
  matched: number; // mask facelets currently showing their solved colour
}

export function scorePlacement(cube: Cube3x3, mask: Cube3x3Mask): PlacementScore {
  const f = cube.stateData;
  const pieces = piecesFor(mask);
  let placed = 0;
  for (const g of pieces) if (g.every((i) => f[i] === SOLVED_FACELET_CUBE[i])) placed++;
  let matched = 0;
  for (const i of mask.solvedFaceletIndices) if (f[i] === SOLVED_FACELET_CUBE[i]) matched++;
  return { placed, total: pieces.length, matched };
}

/** Index of `canonical` within `candidates` (by facelet signature), or 0. */
export function canonicalIndexIn(candidates: Cube3x3Mask[], canonical: Cube3x3Mask): number {
  const sig = (m: Cube3x3Mask) => [...m.solvedFaceletIndices].sort((a, b) => a - b).join(',');
  const want = sig(canonical);
  const at = candidates.findIndex((m) => sig(m) === want);
  return at >= 0 ? at : 0;
}

// --- reach ------------------------------------------------------------------
// Each outer turn as a facelet permutation, read off the engine itself by turning
// a cube whose 54 stickers are all distinct: after the turn, slot j holds what
// was at PERM[j]. Deriving rather than hand-writing them means the tables can't
// disagree with the cube the rest of the app tracks.
const TURNS = ['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => ['', '2', "'"].map((x) => f + x)) as Move3x3[];
const PERM: number[][] = (() => {
  const labels = Array.from({ length: 54 }, (_, i) => String.fromCharCode(0x100 + i));
  const c = new Cube3x3(MOVESETS.Full, labels as never, labels as never);
  return TURNS.map((m) => (c.clone().applyMove(m).stateData as unknown as string[]).map((x) => x.charCodeAt(0) - 0x100));
})();
// Probes: the state itself, every state one turn away, then every two-turn
// sequence on two different faces (a repeated face is already a single turn) —
// 1 + 18 + 270, flattened into one table. Probe q reads slot j from PROBES[q*54+j].
const N_ONE = 1 + PERM.length;
const PROBES: Int16Array = (() => {
  const all: number[][] = [Array.from({ length: 54 }, (_, i) => i), ...PERM];
  TURNS.forEach((a, i) => TURNS.forEach((b, j) => {
    if (a[0] !== b[0]) all.push(PERM[j].map((k) => PERM[i][k]));
  }));
  return Int16Array.from(all.flat());
})();
const N_PROBES = PROBES.length / 54;

// Pieces as flat facelet runs with their solved colours, so the hot loop touches
// only typed arrays. Piece p spans PIECE_F[PIECE_AT[p] .. PIECE_AT[p+1]).
const PIECE_AT = Int16Array.from(PIECES.reduce((acc, g) => [...acc, acc[acc.length - 1] + g.length], [0]));
const PIECE_F = Int16Array.from(PIECES.flat());
const SOLVED_CODE = Uint16Array.from(SOLVED_FACELET_CUBE as readonly string[], (x) => x.charCodeAt(0));

// Indices into PIECES of the pieces each mask covers.
const pieceIdxCache = new WeakMap<Cube3x3Mask, number[]>();
function pieceIdxFor(mask: Cube3x3Mask): number[] {
  let p = pieceIdxCache.get(mask);
  if (!p) {
    const set = new Set(mask.solvedFaceletIndices);
    p = PIECES.flatMap((g, i) => (g.some((f) => set.has(f)) ? [i] : []));
    pieceIdxCache.set(mask, p);
  }
  return p;
}

export interface PlacementReach {
  now: number[]; // per candidate: whole pieces placed in this state
  one: number[]; // most placed in any state within one turn (≥ now)
  two: number[]; // most placed in any state within two turns (≥ one)
}

/** Per-candidate reach: ~0.2ms for 24 candidates, cheap enough for every move. */
export function placementReach(cube: Cube3x3, candidates: Cube3x3Mask[]): PlacementReach {
  return reachOf(codesOf(cube), candidates.map(pieceIdxFor));
}

/** Reach per framed candidate: each frame's candidates on the re-held state. */
export function framedReach(cube: Cube3x3, framed: readonly Framed[]): PlacementReach {
  const base = codesOf(cube);
  const out: PlacementReach = { now: framed.map(() => 0), one: framed.map(() => 0), two: framed.map(() => 0) };
  for (const frame of new Set(framed.map((c) => c.frame))) {
    const at = framed.flatMap((c, i) => (c.frame === frame ? [i] : []));
    const perm = framePerm(frame);
    const codes = frame === 0 ? base : Uint16Array.from(perm, (j) => base[j]);
    const r = reachOf(codes, at.map((i) => pieceIdxFor(framed[i].mask)));
    at.forEach((i, k) => { out.now[i] = r.now[k]; out.one[i] = r.one[k]; out.two[i] = r.two[k]; });
  }
  return out;
}

function codesOf(cube: Cube3x3): Uint16Array {
  return Uint16Array.from(cube.stateData as readonly string[], (x) => x.charCodeAt(0));
}

function reachOf(f: Uint16Array, lists: number[][]): PlacementReach {
  const placed = new Uint8Array(PIECES.length);
  const best = (from: number, to: number, out: number[]) => {
    for (let q = from; q < to; q++) {
      const base = q * 54;
      for (let p = 0; p < PIECES.length; p++) {
        let ok = 1;
        for (let k = PIECE_AT[p]; k < PIECE_AT[p + 1]; k++) {
          const j = PIECE_F[k];
          if (f[PROBES[base + j]] !== SOLVED_CODE[j]) { ok = 0; break; }
        }
        placed[p] = ok;
      }
      for (let c = 0; c < lists.length; c++) {
        const l = lists[c];
        let n = 0;
        for (let i = 0; i < l.length; i++) n += placed[l[i]];
        if (n > out[c]) out[c] = n;
      }
    }
    return out;
  };
  const now = best(0, 1, lists.map(() => 0));
  const one = best(1, N_ONE, now.slice());
  const two = best(N_ONE, N_PROBES, one.slice());
  return { now, one, two };
}

// Lexicographic: within one turn, then within two, then placed now. `now` last
// is what makes a finished block win: every rival can at best tie it on reach.
function reachKey(r: PlacementReach, i: number): [number, number, number] {
  return [r.one[i], r.two[i], r.now[i]];
}
function outreaches(a: readonly number[], b: readonly number[]): boolean {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] > b[j];
  return false;
}
function bestReach(r: PlacementReach, preferred: number): number {
  let best = preferred; // ties go to the preferred placement, then the lowest index
  for (let i = 0; i < r.now.length; i++) if (outreaches(reachKey(r, i), reachKey(r, best))) best = i;
  return best;
}

// The anchor depends only on the step's start state, which every move and
// render of a step shares — one slot is enough.
let anchorMemo: { framed: readonly Framed[]; key: string; pick: number } | null = null;

/** The step-start pick: what activePlacement returns until a candidate out-reaches it. */
export function anchorPlacement(start: Cube3x3, candidates: Cube3x3Mask[], preferred: number): number {
  return anchorFramed(start, frame0Candidates(candidates), preferred);
}
/** anchorPlacement over framed candidates; returns an index into `framed`. */
export function anchorFramed(start: Cube3x3, framed: readonly Framed[], preferred: number): number {
  if (framed.length <= 1) return 0;
  return anchorFor(start, framed, Math.min(Math.max(preferred, 0), framed.length - 1));
}
function anchorFor(start: Cube3x3, framed: readonly Framed[], pref: number): number {
  const key = `${pref}:${start.encode()}`;
  if (anchorMemo?.framed !== framed || anchorMemo.key !== key) {
    anchorMemo = { framed, key, pick: bestReach(framedReach(start, framed), pref) };
  }
  return anchorMemo.pick;
}

/**
 * The placement the user is currently building. `start` is the cube at the
 * start of the step: its best-reaching candidate is the anchor, which keeps the
 * job unless another candidate strictly out-reaches it now. `preferred` breaks
 * ties (the canonical placement today; a user-committed pick once inspection
 * training exists). Returns an index into `candidates`.
 */
export function activePlacement(
  cube: Cube3x3,
  candidates: Cube3x3Mask[],
  start: Cube3x3,
  preferred: number,
): number {
  return activeFramed(cube, frame0Candidates(candidates), start, preferred);
}
/** activePlacement over framed candidates; returns an index into `framed`. */
export function activeFramed(cube: Cube3x3, framed: readonly Framed[], start: Cube3x3, preferred: number): number {
  if (framed.length <= 1) return 0;
  const pref = Math.min(Math.max(preferred, 0), framed.length - 1);
  const anchor = anchorFor(start, framed, pref);
  const r = framedReach(cube, framed);
  const top = bestReach(r, pref);
  return outreaches(reachKey(r, top), reachKey(r, anchor)) ? top : anchor;
}
