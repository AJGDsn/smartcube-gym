// Oracle harness for src/fb-structures.ts — the pieces a first block is built from.
//
// 0. Each structure covers exactly the pieces its name means (written out here
//    by piece name, independently of the module's ranges), for every block.
// 1. Detection against geometry. The module finds a structure (a pair, a line, a
//    square) with frame.ts: its mask solved after some whole-cube rotation the
//    structure allows. The oracle here never touches the engine's moves, masks or
//    frames: it takes the structure's home stickers as points with a facing
//    direction in 3D, and calls the structure formed when some proper rotation of
//    space carries every one of them onto a sticker that now shows that colour.
//    A centre can't move in the model, so a structure holding one is only matched
//    by rotations that keep it in place — no special case needed. Checked on
//    random scrambles and on states with each structure planted in a random
//    placement, for every first block on the colour-neutrality ladder's first
//    eight; disjointed pairs (formed after one outer or slice turn) and the
//    flowchart branch are checked the same way.
// 2. Reading the approach. Solves built stage by stage for each approach, kept
//    only where the order is unambiguous (the first half stood alone, untouched,
//    until the second joined it), must read back as that approach.
// 3. Best route per approach: it reaches the block, its stages add up, and it is
//    never shorter than the block's true optimum.
//
// Usage: npx tsx scripts/fb-structures-check.ts

import {
  applyMove, applyMoves, faceletString, newSolved, solveFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import { NET_COORDS } from '../src/blocks.ts';
import { framesFor, inFrame, movesFromFrame, solveInFrames } from '../src/frame.ts';
import { ALL_FB, blockHoldLabel, holdFor } from '../src/hold.ts';
import { rotateHighlight } from '../src/orient.ts';
import {
  APPROACHES, PAIR_IDS, STRUCTURES, bestForApproach, disjointedPairs, flowchart, presentStructures,
  readApproach, structureMasks, type Approach, type StructureId,
} from '../src/fb-structures.ts';

let mismatches = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok && mismatches++ < 20) console.log('  MISMATCH', msg); };

let seed = 20261109;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const TURNS = FACES.flatMap((f) => SUF.map((x) => f + x)) as Move3x3[];
const scramble = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};
const CFG = { moveSet: TURNS, pruningDepth: 4, depthLimit: 12 };

// --- the geometric oracle ---------------------------------------------------------
type V = [number, number, number];
/** Facing direction of facelet i, from the net layout (U 0-8, the L F R B rows, D 45-53). */
function dirOf(i: number): V {
  if (i < 9) return [0, 1, 0];
  if (i >= 45) return [0, -1, 0];
  return ([[-1, 0, 0], [0, 0, 1], [1, 0, 0], [0, 0, -1]] as V[])[Math.floor(((i - 9) % 12) / 3)];
}
const POS: V[] = NET_COORDS.map(([x, y, z]) => [x - 1, y - 1, z - 1]);
const key = (p: V, d: V) => `${p}|${d}`;
const AT = new Map(POS.map((p, i) => [key(p, dirOf(i)), i]));
// The 24 proper rotations: signed permutation matrices with determinant +1.
const ROTATIONS: number[][][] = (() => {
  const out: number[][][] = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (c === p[r] ? ((s >> r) & 1 ? -1 : 1) : 0)));
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (det === 1) out.push(m);
  }
  return out;
})();
const mul = (m: number[][], v: V): V => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as V;
const SOLVED = faceletString(newSolved());
/** Formed iff some rotation lands every home sticker on a sticker of its colour now. */
function oracleFormed(f: string, mask: Cube3x3Mask): boolean {
  return ROTATIONS.some((R) => mask.solvedFaceletIndices.every((i) => {
    const j = AT.get(key(mul(R, POS[i]), mul(R, dirOf(i))));
    return j !== undefined && f[j] === SOLVED[i];
  }));
}
const ONE = ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S'].flatMap((x) => SUF.map((s) => x + s)) as Move3x3[];

check(ROTATIONS.length === 24, `${ROTATIONS.length} rotations`);

// --- 0. each structure is the pieces teoidus means ----------------------------------
// Held with the block bottom-left (x 0 = left, y 0 = bottom, z 0 = back), by name.
const PIECE: Record<string, V> = { C: [0, 1, 1], DL: [0, 0, 1], DLF: [0, 0, 2], DLB: [0, 0, 0], FL: [0, 1, 2], BL: [0, 1, 0] };
const MEANS: Record<StructureId, string[]> = {
  ecD: ['DL', 'C'], ecF: ['FL', 'C'], ecB: ['BL', 'C'],
  pairF: ['DLF', 'FL'], pairB: ['DLB', 'BL'],
  lineBlockF: ['DLF', 'DL'], lineBlockB: ['DLB', 'DL'],
  lineD: ['DLB', 'DL', 'DLF'], lineE: ['BL', 'C', 'FL'],
  squareF: ['C', 'DL', 'DLF', 'FL'], squareB: ['C', 'DL', 'DLB', 'BL'],
  block: ['C', 'DL', 'DLF', 'DLB', 'FL', 'BL'],
};
for (const fb of ALL_FB.slice(0, 8)) {
  const masks = structureMasks(fb);
  for (const id of STRUCTURES) {
    // The module's mask, seen held with this block bottom-left, as whole cubies.
    const shown = rotateHighlight(new Set(masks[id].solvedFaceletIndices), holdFor(fb));
    const cubies = new Set([...shown].map((i) => NET_COORDS[i].join()));
    const want = new Set(MEANS[id].map((p) => PIECE[p].join()));
    const allStickers = NET_COORDS.every(([x, y, z], i) => !want.has(`${x},${y},${z}`) || shown.has(i));
    check(cubies.size === want.size && [...cubies].every((c) => want.has(c)) && allStickers,
      `${blockHoldLabel(fb)}: ${id} covers ${[...cubies].join(' ')}, want ${MEANS[id].join(' ')}`);
  }
}

// --- 1. detection --------------------------------------------------------------------
const FBS = ALL_FB.slice(0, 8);
let states = 0, planted = 0;
const seen = new Map<StructureId, number>();
function compare(c: Cube3x3, fb: Cube3x3Mask, where: string) {
  states++;
  const f = faceletString(c);
  const masks = structureMasks(fb);
  const got = presentStructures(c, fb);
  for (const id of STRUCTURES) {
    const want = oracleFormed(f, masks[id]);
    if (want) seen.set(id, (seen.get(id) ?? 0) + 1);
    check(got.has(id) === want, `${blockHoldLabel(fb)} ${where}: ${id} module ${got.has(id)} oracle ${want}`);
  }
  const dj = new Set(disjointedPairs(c, fb));
  for (const id of PAIR_IDS) {
    const want = !oracleFormed(f, masks[id]) && ONE.some((m) => oracleFormed(faceletString(applyMove(c, m)), masks[id]));
    check(dj.has(id) === want, `${blockHoldLabel(fb)} ${where}: disjointed ${id} module ${dj.has(id)} oracle ${want}`);
  }
  // The flowchart's branch, recomputed from the oracle's view.
  const has = (id: StructureId) => oracleFormed(f, masks[id]);
  const want = has('lineD') ? 'lineD' : has('lineE') ? 'lineE'
    : ['pairF', 'pairB', 'lineBlockF', 'lineBlockB'].some((x) => has(x as StructureId)) ? 'cornerEdge'
    : ['ecD', 'ecF', 'ecB'].some((x) => has(x as StructureId)) ? 'edgeCentre'
    : dj.size ? 'disjointed' : 'fallback';
  check(flowchart(c, fb).branch === want, `${blockHoldLabel(fb)} ${where}: branch ${flowchart(c, fb).branch}, oracle ${want}`);
}
for (let t = 0; t < 120; t++) compare(applyMoves(newSolved(), scramble(20)), FBS[t % 8], 'random');
for (const fb of FBS) {
  const masks = structureMasks(fb);
  for (const id of STRUCTURES) {
    for (let k = 0; k < 3; k++) {
      const start = applyMoves(newSolved(), scramble(20));
      const fs = framesFor(masks[id]);
      const fr = fs[(rand() * fs.length) | 0];
      const sol = solveFromState(inFrame(start, fr), masks[id], CFG);
      if (!sol) continue;
      const c = applyMoves(start, movesFromFrame(sol, fr));
      planted++;
      compare(c, fb, `${id} planted`);
      compare(applyMove(c, TURNS[(rand() * TURNS.length) | 0]), fb, `${id} planted + 1`);
    }
  }
}

// --- 2. reading the approach --------------------------------------------------------
const PLAN: Record<Approach, Array<[StructureId, StructureId, StructureId]>> = {
  // [first half, second half, what they form]
  f2l: [['ecD', 'pairF', 'squareF'], ['ecD', 'pairB', 'squareB']],
  pairFirst: [['pairF', 'ecD', 'squareF'], ['pairB', 'ecD', 'squareB']],
  lineBlock: [['lineBlockF', 'ecF', 'squareF'], ['lineBlockB', 'ecB', 'squareB']],
  eLine: [['ecF', 'lineBlockF', 'squareF'], ['ecB', 'lineBlockB', 'squareB']],
  lines: [['lineD', 'lineE', 'block'], ['lineE', 'lineD', 'block']],
};
const OTHER_SPLIT: Record<StructureId, Array<[StructureId, StructureId]>> = {
  squareF: [['ecD', 'pairF'], ['lineBlockF', 'ecF']],
  squareB: [['ecD', 'pairB'], ['lineBlockB', 'ecB']],
  block: [['lineD', 'lineE']],
} as Record<StructureId, Array<[StructureId, StructureId]>>;
const read = new Map<Approach, number>();
/** Solve to a structure in its best frame, in model names. */
function toStructure(c: Cube3x3, mask: Cube3x3Mask): Move3x3[] | null {
  const s = solveInFrames(c, mask, CFG);
  return s ? movesFromFrame(s.moves, s.frame) : null;
}
for (const approach of APPROACHES) {
  for (let t = 0; t < 60 && (read.get(approach) ?? 0) < 12; t++) {
    const fb = FBS[t % 8];
    const masks = structureMasks(fb);
    const [a, b, joined] = PLAN[approach][t % 2];
    const start = applyMoves(newSolved(), scramble(20));
    const m1 = toStructure(start, masks[a]);
    if (!m1 || !m1.length) continue;
    const c1 = applyMoves(start, m1);
    // Build the second half on its own without disturbing the first, then join:
    // solve to the second half, then on to what they form.
    const m2 = toStructure(c1, masks[b]);
    if (!m2) continue;
    const c2 = applyMoves(c1, m2);
    const m3 = toStructure(c2, masks[joined]);
    if (!m3 || !m3.length) continue;
    const route = [...m1, ...m2, ...m3];
    const st = [start];
    for (const m of route) st.push(applyMove(st[st.length - 1], m));
    const sets = st.map((c) => presentStructures(c, fb));
    const tJoin = sets.findIndex((s) => s.has('squareF') || s.has('squareB') || s.has('block'));
    // Unambiguous by construction only: nothing joined before the end of the route,
    // the first half absent at the start and standing from its formation to the
    // join, the second half formed strictly later, and no other split standing.
    const iA = m1.length, iB = m1.length + m2.length;
    if (tJoin !== route.length || !sets[tJoin].has(joined)) continue;
    if (sets[0].has(a) || sets[0].has(b)) continue;
    if (!sets.slice(iA, tJoin).every((s) => s.has(a))) continue;
    if (sets.slice(0, iA + 1).some((s) => s.has(b))) continue;
    if (!sets.slice(iB, tJoin).every((s) => s.has(b))) continue;
    if (OTHER_SPLIT[joined].some(([x, y]) => !(x === a || x === b) && sets[tJoin - 1].has(x) && sets[tJoin - 1].has(y))) continue;
    if (joined === 'block' && (sets[tJoin - 1].has('squareF') || sets[tJoin - 1].has('squareB'))) continue;
    const r = readApproach(st, fb);
    read.set(approach, (read.get(approach) ?? 0) + 1);
    check(r?.approach === approach && r.first === a, `${blockHoldLabel(fb)}: built ${approach} (${a} first) read as ${r?.approach} (${r?.first})`);
  }
}

// --- 3. best route per approach --------------------------------------------------------
let routes = 0;
for (let t = 0; t < 10; t++) {
  const fb = FBS[t % 8];
  const masks = structureMasks(fb);
  const start = applyMoves(newSolved(), scramble(20));
  const opt = solveInFrames(start, masks.block, CFG)?.moves.length ?? 99;
  for (const approach of APPROACHES) {
    const r = bestForApproach(start, fb, approach, CFG);
    if (!r) continue;
    routes++;
    const end = applyMoves(start, r.moves);
    check(oracleFormed(faceletString(end), masks.block), `${approach}: best route doesn't build the block`);
    check(r.stages.reduce((x, y) => x + y, 0) === r.moves.length, `${approach}: stages don't add up`);
    check(r.moves.length >= opt, `${approach}: ${r.moves.length} beats the optimum ${opt}`);
    // The route's first stage really does form its first structure.
    const after1 = applyMoves(start, r.moves.slice(0, r.stages[0]));
    check(oracleFormed(faceletString(after1), masks[r.first]), `${approach}: stage 1 doesn't form ${r.first}`);
  }
}

const seenStr = STRUCTURES.map((id) => `${id} ${seen.get(id) ?? 0}`).join(', ');
const readStr = APPROACHES.map((a) => `${a} ${read.get(a) ?? 0}`).join(', ');
console.log(`fb-structures check — ${states} states (${planted} planted), formed seen: ${seenStr}; approaches read: ${readStr}; ${routes} best routes; ${checks} checks`);
console.log(`mismatches ${mismatches}`);
if (mismatches) process.exitCode = 1;
