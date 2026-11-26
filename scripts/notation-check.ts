// Oracle harness for src/notation.ts — positional turns vs the turns a cube reports.
//
// The hands turn any layer (outer, slice M E S, wide u d l r f b) and name it by
// position. A smart cube reports only OUTER faces, named by centre, and the app's
// model keeps its centres home: a physical M arrives as R L' and leaves the cube
// in hand as the model re-held by x'. notation.ts does that translation. It exists
// because the engine's own translateMoves is believed to get slice directions
// wrong, so nothing here trusts the engine's naming — or notation.ts's.
//
// The oracle is geometry only: 54 stickers as a cubie position in {-1,0,1}^3 plus
// an outward normal, and a turn = a quarter-turn of space applied to the stickers
// whose coordinate along the axis is in the layer (R: x=1; M: x=0, turning like L;
// r: x in {0,1}; x: every layer). No permutation table, no engine move, no line of
// notation.ts goes into it. NET_COORDS (blocks.ts) only says which sticker the
// engine's facelet index i is, so states can be compared.
//
// 0. The oracle itself: its outer turns agree with the engine AND with cube.ts
//    (Kociemba cubie model); its slices, wides and rotations agree with the
//    engine's permutations (a disagreement there would be a serious finding and is
//    reported loudly). FRAMES are the 24 distinct rotations, frameOf finds them.
// 1. renameMove / rename / unrename: turning then re-holding equals re-holding
//    then turning the renamed move — all 45 layer turns × all 24 frames, plus
//    random multi-rotation sequences.
// 2. decompose: m equals its outer turns then its rotation; the turns are one or
//    two outer turns on m's own axis.
// 3. toReported, on random routes mixing outer, slice and wide turns, from random
//    scrambles and random starting hands. The oracle works out, from the cube in
//    hand alone, which outer turns the cube must report for each turn and how it
//    is then held; notation.ts must name the same turns and the same hold. And
//    the invariant, after every turn: the cube in hand equals (S, turns reported
//    so far) re-held by the hand frame it returns. The route is in the MODEL's
//    names at its start (as the solver gives it); the hands, holding the cube
//    re-held by FRAMES[hand], make those same physical turns and never re-hold —
//    so the cube in hand is (S, route so far, FRAMES[hand]).
// 4. Outer-only routes come back unchanged, hand unmoved.
// 5. heldMoveSet: for every first block, the Roux move set named for the model
//    renames back to exactly ROUX_HELD in that block's hold; the held M and r
//    leave every facelet of the block where it is; and the second-block set
//    (R r U M) never touches the first block.
// 6. Mutation tests: deliberately broken variants of each function are run
//    through the same checks, and the harness fails if any goes uncaught.
//
// Usage: npx tsx scripts/notation-check.ts

import {
  applyMove, applyMoves, faceletString, newSolved,
  type Cube3x3Mask, type Move3x3, type RotationMove,
} from '../src/engine-api.ts';
import { translateMove } from '../src/engine/puzzles/cube3x3/index.ts';
import { NET_COORDS } from '../src/blocks.ts';
import { KOCIEMBA_FACELET_COORDS, applyMoveList, cubeToFaceletString, solvedCube } from '../src/cube.ts';
import { ALL_FB, bothBlocks, holdFor } from '../src/hold.ts';
import {
  FRAMES, LAYER_MOVES, OUTER, ROUX_HELD, ROUX_SB_HELD,
  decompose, frameOf, heldMoveSet, rename, renameMove, reportedTurns, toReported, unrename,
} from '../src/notation.ts';

const t0 = Date.now();
let mismatches = 0, checks = 0, quiet = false;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok && mismatches++ < 20 && !quiet) console.log('  MISMATCH', msg);
};

let seed = 20261126;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: readonly T[]): T => a[(rand() * a.length) | 0];

// =================================================================================
// The oracle: a cube made of geometry
// =================================================================================
type V = readonly [number, number, number];
const NORMAL: Record<string, V> = { U: [0, 1, 0], D: [0, -1, 0], L: [-1, 0, 0], R: [1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
/** The face the engine's facelet i is on (net order: U, three L F R B band rows, D). */
const faceOfIndex = (i: number) => (i < 9 ? 'U' : i >= 45 ? 'D' : 'LFRB'[(((i - 9) % 12) / 3) | 0]);
const POS: V[] = NET_COORDS.map(([x, y, z]) => [x - 1, y - 1, z - 1] as const);
const NRM: V[] = NET_COORDS.map((_, i) => NORMAL[faceOfIndex(i)]);
const vkey = (p: V, n: V) => `${p.join()}|${n.join()}`;
const INDEX_AT = new Map(POS.map((p, i) => [vkey(p, NRM[i]), i]));
if (INDEX_AT.size !== 54) throw new Error('oracle: the 54 stickers are not distinct');
POS.forEach((p, i) => {
  // a sticker faces out of the layer its cubie is in
  if (p[0] * NRM[i][0] + p[1] * NRM[i][1] + p[2] * NRM[i][2] !== 1) throw new Error(`oracle: facelet ${i} is not on its face`);
});

/** A quarter turn of space, clockwise seen from the + end of the axis
 *  (x: as R turns, y: as U turns, z: as F turns). */
const QUARTER: ((v: V) => V)[] = [
  ([x, y, z]) => [x, z, -y],  // R: front goes up
  ([x, y, z]) => [-z, y, x],  // U: front goes left
  ([x, y, z]) => [y, -x, z],  // F: up goes right
];
/** Each turn letter: axis, the layers that move, and whether an unprimed turn is
 *  clockwise seen from the + end of the axis (WCA: M follows L, E follows D, S follows F). */
const LAYER: Record<string, { axis: 0 | 1 | 2; layers: number[]; plus: boolean }> = {
  R: { axis: 0, layers: [1], plus: true }, L: { axis: 0, layers: [-1], plus: false },
  M: { axis: 0, layers: [0], plus: false },
  r: { axis: 0, layers: [0, 1], plus: true }, l: { axis: 0, layers: [-1, 0], plus: false },
  x: { axis: 0, layers: [-1, 0, 1], plus: true },
  U: { axis: 1, layers: [1], plus: true }, D: { axis: 1, layers: [-1], plus: false },
  E: { axis: 1, layers: [0], plus: false },
  u: { axis: 1, layers: [0, 1], plus: true }, d: { axis: 1, layers: [-1, 0], plus: false },
  y: { axis: 1, layers: [-1, 0, 1], plus: true },
  F: { axis: 2, layers: [1], plus: true }, B: { axis: 2, layers: [-1], plus: false },
  S: { axis: 2, layers: [0], plus: true },
  f: { axis: 2, layers: [0, 1], plus: true }, b: { axis: 2, layers: [-1, 0], plus: false },
  z: { axis: 2, layers: [-1, 0, 1], plus: true },
};
const axisOf = (m: string) => LAYER[m[0]]?.axis ?? -1;
const quarters = (m: string) => (m.endsWith('2') ? 2 : m.endsWith("'") ? 3 : 1);

/** A permutation as "the sticker at place i goes to place p[i]". */
type Perm = number[];
const ID: Perm = [...Array(54).keys()];
const permCache = new Map<string, Perm>();
function movePerm(m: string): Perm {
  let p = permCache.get(m);
  if (!p) {
    const def = LAYER[m[0]];
    if (!def || !['', '2', "'"].includes(m.slice(1))) throw new Error(`oracle: unknown move ${m}`);
    const n = def.plus ? quarters(m) : 4 - quarters(m);
    p = ID.map((i) => {
      if (!def.layers.includes(POS[i][def.axis])) return i;
      let pos = POS[i], nrm = NRM[i];
      for (let k = 0; k < n; k++) { pos = QUARTER[def.axis](pos); nrm = QUARTER[def.axis](nrm); }
      return INDEX_AT.get(vkey(pos, nrm))!;
    });
    permCache.set(m, p);
  }
  return p;
}
/** a then b */
const then = (a: Perm, b: Perm): Perm => a.map((i) => b[i]);
const inverse = (a: Perm): Perm => { const r = new Array<number>(54); a.forEach((to, i) => { r[to] = i; }); return r; };
const seqPerm = (moves: readonly string[]): Perm => moves.reduce((p, m) => then(p, movePerm(m)), ID);
const pkey = (p: Perm) => p.join();
const same = (a: Perm, b: Perm) => a.every((v, i) => v === b[i]);
/** A state: at[place] = the home index of the sticker there. */
const stateAfter = (p: Perm): number[] => { const at = new Array<number>(54); p.forEach((to, i) => { at[to] = i; }); return at; };
/** The oracle's state in the engine's facelet-string form (a sticker's colour = its home face). */
const colours = (p: Perm) => stateAfter(p).map(faceOfIndex).join('');

// --- vocabularies, written out here rather than taken from the module --------------
const SUF = ['', '2', "'"];
const turnsOf = (letters: string) => [...letters].flatMap((l) => SUF.map((s) => l + s));
const O_OUTER = turnsOf('UDLRFB'), O_SLICE = turnsOf('MES'), O_WIDE = turnsOf('udlrfb');
const O_LAYER = [...O_OUTER, ...O_SLICE, ...O_WIDE];
const O_ROT = turnsOf('xyz');
const O_ALL = [...O_LAYER, ...O_ROT];
const isOuterName = (m: string) => O_OUTER.includes(m);
const invName = (m: string) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`);
const invSeq = (ms: readonly string[]) => [...ms].reverse().map(invName);
const M3 = (ms: readonly string[]) => ms as Move3x3[];
const sortedKey = (ms: readonly string[]) => [...ms].sort().join(' ');
const scramble = (n: number): string[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const m = pick(O_OUTER); if (m[0] === l) continue; l = m[0]; o.push(m); }
  return o;
};
const randomRoute = (pool: readonly string[], maxLen = 12) =>
  Array.from({ length: 1 + ((rand() * maxLen) | 0) }, () => pick(pool));

// The oracle's own 24 rotations (closure of x, y, z), and every way one physical
// turn can be reported: one outer turn, or two on opposite faces of one axis.
const O_FRAMES: Perm[] = (() => {
  const seen = new Map<string, Perm>([[pkey(ID), ID]]);
  const queue = [ID];
  for (const p of queue) for (const r of ['x', 'y', 'z']) {
    const q = then(p, movePerm(r));
    if (!seen.has(pkey(q))) { seen.set(pkey(q), q); queue.push(q); }
  }
  return [...seen.values()];
})();
if (O_FRAMES.length !== 24) throw new Error(`oracle: ${O_FRAMES.length} rotations, want 24`);
const REPORTABLE = new Map<string, string[]>();
for (const [a, b] of [['R', 'L'], ['U', 'D'], ['F', 'B']]) {
  for (const sa of ['', ...SUF.map((s) => a + s)]) for (const sb of ['', ...SUF.map((s) => b + s)]) {
    const turns = [sa, sb].filter(Boolean);
    if (turns.length) REPORTABLE.set(pkey(seqPerm(turns)), turns);
  }
}
if (REPORTABLE.size !== 45) throw new Error('oracle: reportable turn sets are not distinct');

/** What the cube must report for one positional turn `m`, when the cube in hand
 *  is the model re-held by `hand` — and the hold afterwards. Read off the cube
 *  alone: the new model is the cube in hand turned back so its centres are home,
 *  and the report is whatever outer turns take the old model to the new one. */
function oracleReport(hand: Perm, turn: Perm, m: string): { turns: string[]; hand: Perm } {
  const moved = then(hand, turn);
  let found: { turns: string[]; hand: Perm } | null = null;
  for (const next of O_FRAMES) {
    const turns = REPORTABLE.get(pkey(then(moved, inverse(next))));
    if (!turns) continue;
    if (found) throw new Error(`oracle: ${m} can be reported two ways`);
    found = { turns, hand: next };
  }
  if (!found) throw new Error(`oracle: ${m} cannot be reported as outer turns`);
  return found;
}

// =================================================================================
// 0. The oracle against the engine and cube.ts; FRAMES and frameOf
// =================================================================================
const engineStr = (moves: readonly string[]) => faceletString(applyMoves(newSolved(), M3(moves)));
// cube.ts speaks Kociemba order (U R F D L B faces); place each of its facelets by geometry.
const KOCIEMBA_AT: number[] = KOCIEMBA_FACELET_COORDS.map(([x, y, z], k) =>
  INDEX_AT.get(vkey([x - 1, y - 1, z - 1], NORMAL['URFDLB'[(k / 9) | 0]]))!);
function kociembaStr(moves: readonly string[]): string {
  const k = cubeToFaceletString(applyMoveList(solvedCube(), [...moves]));
  const out = new Array<string>(54);
  KOCIEMBA_AT.forEach((i, j) => { out[i] = k[j]; });
  return out.join('');
}

let engineSliceDisagreements = 0;
function checkOracle() {
  check(colours(ID) === faceletString(newSolved()), 'oracle solved cube is not the engine solved cube');
  check(new Set(O_LAYER.map((m) => pkey(movePerm(m)))).size === 45, 'oracle: the 45 layer turns are not distinct');
  // Outer turns first: a wrong sticker mapping shows here before anything else is trusted.
  for (let t = 0; t < 200; t++) {
    const seq = scramble(25);
    for (let n = 1; n <= seq.length; n++) {
      const pre = seq.slice(0, n), mine = colours(seqPerm(pre));
      check(mine === engineStr(pre), `outer turns: oracle != engine after ${pre.join(' ')}`);
      check(mine === kociembaStr(pre), `outer turns: oracle != cube.ts after ${pre.join(' ')}`);
    }
  }
  // Then the engine's slices, wides and rotations, one turn at a time from scrambled states.
  for (let t = 0; t < 40; t++) {
    const pre = scramble(20);
    for (const m of O_ALL) {
      const ok = colours(seqPerm([...pre, m])) === engineStr([...pre, m]);
      if (!ok && !isOuterName(m)) engineSliceDisagreements++;
      check(ok, `ENGINE PERMUTATION for ${m} disagrees with geometry (after ${pre.join(' ')})`);
    }
  }
  for (let t = 0; t < 200; t++) {
    const seq = Array.from({ length: 30 }, () => pick(O_ALL));
    check(colours(seqPerm(seq)) === engineStr(seq), `mixed sequence: oracle != engine for ${seq.join(' ')}`);
  }
  // The module's vocabularies and frames.
  check(sortedKey(OUTER) === sortedKey(O_OUTER) && OUTER.length === 18, 'OUTER is not the 18 outer turns');
  check(sortedKey(LAYER_MOVES) === sortedKey(O_LAYER) && LAYER_MOVES.length === 45, 'LAYER_MOVES is not the 45 layer turns');
  check(FRAMES.length === 24 && FRAMES[0].length === 0, 'FRAMES: want 24 with [] first');
  check(FRAMES.every((f) => f.every((m) => O_ROT.includes(m))), 'FRAMES: a frame holds a non-rotation');
  const mine = new Set(O_FRAMES.map(pkey));
  const theirs = new Set(FRAMES.map((f) => pkey(seqPerm(f))));
  check(theirs.size === 24 && [...theirs].every((k) => mine.has(k)), 'FRAMES are not the 24 distinct rotations');
  FRAMES.forEach((f, k) => check(frameOf(f) === k, `frameOf(FRAMES[${k}]) = ${frameOf(f)}`));
  for (let t = 0; t < 300; t++) {
    const rots = randomRoute(O_ROT, 6);
    const k = frameOf(M3(rots));
    check(k >= 0 && k < 24 && same(seqPerm(FRAMES[k]), seqPerm(rots)), `frameOf(${rots.join(' ')}) = ${k} is a different rotation`);
  }
}

// =================================================================================
// 1. renameMove / rename / unrename
// =================================================================================
type RenameMove = (m: Move3x3, rots: readonly Move3x3[]) => Move3x3;
const RANDOM_ROTS: string[][] = Array.from({ length: 200 }, () => randomRoute(O_ROT, 5));
function checkRename(rn: RenameMove) {
  const one = (m: string, rots: readonly string[]) => {
    const x = rn(m as Move3x3, M3(rots));
    check(O_LAYER.includes(x), `renameMove(${m}, [${rots.join(' ')}]) = ${x} is not a layer turn`);
    check(O_LAYER.includes(x) && same(seqPerm([m, ...rots]), seqPerm([...rots, x])),
      `renameMove(${m}, [${rots.join(' ')}]) = ${x}: turn-then-rehold != rehold-then-${x}`);
  };
  for (const f of FRAMES) for (const m of O_LAYER) one(m, f);
  for (const rots of RANDOM_ROTS) for (const m of O_LAYER) one(m, rots);
}
function checkRenameLists() {
  for (let t = 0; t < 500; t++) {
    const rots = rand() < 0.5 ? pick(FRAMES) : pick(RANDOM_ROTS);
    const route = randomRoute(O_LAYER);
    const held = rename(M3(route), M3(rots));
    check(held.join() === route.map((m) => renameMove(m as Move3x3, M3(rots))).join(), `rename is not renameMove mapped: ${route.join(' ')}`);
    check(same(seqPerm([...route, ...rots]), seqPerm([...rots, ...held])), `rename([${route.join(' ')}], [${rots.join(' ')}]) does not commute`);
    const back = unrename(M3(route), M3(rots));
    check(same(seqPerm([...rots, ...route]), seqPerm([...back, ...rots])), `unrename([${route.join(' ')}], [${rots.join(' ')}]) does not commute`);
    check(unrename(held, M3(rots)).join() === route.join(), `unrename(rename) != identity for ${route.join(' ')} under [${rots.join(' ')}]`);
    check(rename(back, M3(rots)).join() === route.join(), `rename(unrename) != identity for ${route.join(' ')} under [${rots.join(' ')}]`);
  }
}

// =================================================================================
// 2. decompose
// =================================================================================
type Decompose = (m: Move3x3) => { turns: Move3x3[]; rot: Move3x3[] };
function checkDecompose(dc: Decompose) {
  for (const m of O_LAYER) {
    const { turns, rot } = dc(m as Move3x3);
    const tag = `decompose(${m}) = [${turns.join(' ')}] · [${rot.join(' ')}]`;
    check(turns.length === 1 || turns.length === 2, `${tag}: want 1 or 2 turns`);
    check(turns.every(isOuterName), `${tag}: a turn is not outer`);
    check(turns.every((t) => axisOf(t) === axisOf(m)), `${tag}: a turn is off ${m}'s axis`);
    check(turns.length < 2 || turns[0][0] !== turns[1][0], `${tag}: both turns on one face`);
    check(rot.every((r) => O_ROT.includes(r)), `${tag}: rot holds a non-rotation`);
    check(turns.every((t) => O_LAYER.includes(t)) && rot.every((r) => O_ROT.includes(r))
      && same(movePerm(m), seqPerm([...turns, ...rot])), `${tag}: not the same turn`);
    if (isOuterName(m)) check(turns.join() === m && same(seqPerm(rot), ID), `${tag}: an outer turn should be itself`);
  }
  // The two the module's own comment promises: M = R L' · x', r = L · x.
  const M = dc('M'), r = dc('r');
  check(sortedKey(M.turns) === "L' R" && same(seqPerm(M.rot), movePerm("x'")), `decompose(M) = [${M.turns.join(' ')}] · [${M.rot.join(' ')}], want R L' · x'`);
  check(sortedKey(r.turns) === 'L' && same(seqPerm(r.rot), movePerm('x')), `decompose(r) = [${r.turns.join(' ')}] · [${r.rot.join(' ')}], want L · x`);
}

// =================================================================================
// 3 + 4. toReported
// =================================================================================
type ToReported = (route: readonly Move3x3[], hand?: number) => { turns: Move3x3[][]; hands: number[] };
// What the route's names mean when the starting hand is not 0 — the two readings
// agree at hand 0 and differ otherwise:
//   'model' — the route is named for the MODEL as it stands at the route's start
//             (what the solver hands main.ts): the hands, holding the cube re-held
//             by FRAMES[h], make the same physical turns under their own names and
//             never re-hold. Cube in hand = S, route, then FRAMES[h]. This is the
//             module's doc comment, how main.ts calls it, and the gate.
//   'hand'  — the route is already in the HANDS' names: cube in hand = S, FRAMES[h],
//             then route. Reported for information only (see the summary).
type Reading = 'model' | 'hand';
/** One route, from scramble S (a permutation from solved) and starting hand h. */
function checkRoute(tr: ToReported, route: readonly string[], h: number, S: Perm, engineToo: boolean, reading: Reading = 'model') {
  const tag = `toReported([${route.join(' ')}], ${h})`;
  const got = tr(M3(route), h);
  if (got.turns.length !== route.length || got.hands.length !== route.length) { check(false, `${tag}: wrong lengths`); return; }
  const H0 = seqPerm(FRAMES[h]);
  // The physical turn the hands make for a route move: by geometry, the model-named
  // turn carried into the hands' frame (undo the hold, turn, hold again).
  const physical = (m: string) => (reading === 'hand' ? movePerm(m) : then(then(inverse(H0), movePerm(m)), H0));
  let hand = H0;                       // the oracle's hold
  let inHand = then(S, H0);            // the physical cube
  let model = S;                       // the model, fed the module's reported turns
  for (let i = 0; i < route.length; i++) {
    const m = route[i], turns = got.turns[i], k = got.hands[i];
    const at = `${tag} at #${i} ${m}`;
    const want = oracleReport(hand, physical(m), m);
    hand = want.hand;
    inHand = then(inHand, physical(m));
    const legal = turns.every(isOuterName) && Number.isInteger(k) && k >= 0 && k < 24;
    check(turns.every(isOuterName), `${at}: reports [${turns.join(' ')}], not all outer`);
    check(sortedKey(turns) === sortedKey(want.turns), `${at}: reports [${turns.join(' ')}], the cube sends [${want.turns.join(' ')}]`);
    check(legal && same(seqPerm(FRAMES[k]), want.hand), `${at}: hand frame ${k} [${legal ? FRAMES[k].join(' ') : '?'}] is not how the cube is held`);
    if (!legal) return;
    model = then(model, seqPerm(turns));
    // the invariant: (S, re-held, route so far) == (S, reported so far), re-held by hands[i]
    check(same(inHand, then(model, seqPerm(FRAMES[k]))), `${at}: the model re-held by frame ${k} is not the cube in hand`);
    // a model fed outer turns keeps its centres home
    check([4, 22, 25, 28, 31, 49].every((c) => stateAfter(model)[c] === c), `${at}: model centres moved`);
  }
  if (engineToo) {
    // The same invariant on the engine's cube, and the model on cube.ts's (outer turns only).
    const pre = scramble(18), flat = got.turns.flat(), last = got.hands[route.length - 1];
    const cubeInHand = faceletString(applyMoves(newSolved(), M3(reading === 'hand' ? [...pre, ...FRAMES[h], ...route] : [...pre, ...route, ...FRAMES[h]])));
    const viaModel = faceletString(applyMoves(newSolved(), M3([...pre, ...flat, ...FRAMES[last]])));
    check(cubeInHand === viaModel, `${tag}: engine cube in hand != engine model re-held by frame ${last}`);
    check(kociembaStr([...pre, ...flat]) === colours(seqPerm([...pre, ...flat])), `${tag}: cube.ts model != oracle model`);
  }
}
const ROUTE_CASES = Array.from({ length: 3000 }, (_, t) => ({
  // a third each: anything, Roux-flavoured (M/r heavy), slice/wide only
  route: randomRoute(t % 3 === 0 ? O_LAYER : t % 3 === 1 ? turnsOf('URMr') : [...O_SLICE, ...O_WIDE]),
  hand: (rand() * 24) | 0,
  S: seqPerm(scramble(20)),
}));
function checkReported(tr: ToReported, reading: Reading = 'model', hand0Only = false) {
  // every single turn from every hold, then the random routes
  for (let h = 0; h < (hand0Only ? 1 : 24); h++) for (const m of O_LAYER) checkRoute(tr, [m], h, ID, false, reading);
  ROUTE_CASES.forEach((c, t) => checkRoute(tr, c.route, hand0Only ? 0 : c.hand, c.S, !quiet && t % 5 === 0, reading));
}
function checkReportedExtras() {
  for (const c of ROUTE_CASES.slice(0, 300)) {
    const got = toReported(M3(c.route), c.hand);
    check(reportedTurns(M3(c.route), c.hand).join() === got.turns.flat().join(), `reportedTurns != toReported.turns.flat() for ${c.route.join(' ')}`);
    const d = toReported(M3(c.route)), z = toReported(M3(c.route), 0);
    check(JSON.stringify(d) === JSON.stringify(z), `toReported default hand is not 0 for ${c.route.join(' ')}`);
    check(reportedTurns(M3(c.route)).join() === z.turns.flat().join(), `reportedTurns default hand is not 0 for ${c.route.join(' ')}`);
  }
  const empty = toReported([], 5);
  check(empty.turns.length === 0 && empty.hands.length === 0, 'toReported([]) is not empty');
}
const OUTER_ROUTES = Array.from({ length: 500 }, () => randomRoute(O_OUTER));
function checkOuterRoutes(tr: ToReported) {
  for (const route of OUTER_ROUTES) {
    const got = tr(M3(route), 0);
    check(got.turns.length === route.length && got.turns.every((t, i) => t.length === 1 && t[0] === route[i]),
      `outer route ${route.join(' ')} came back as ${got.turns.map((t) => t.join('+')).join(' ')}`);
    check(got.hands.length === route.length && got.hands.every((k) => k === 0), `outer route ${route.join(' ')} moved the hand: ${got.hands.join()}`);
    // from any other hold too: the route is in the model's names, which is what the cube reports
    const h = (rand() * 24) | 0;
    const off = tr(M3(route), h);
    check(off.turns.length === route.length && off.turns.every((t, i) => t.length === 1 && t[0] === route[i]),
      `outer route ${route.join(' ')} from hand ${h} came back as ${off.turns.map((t) => t.join('+')).join(' ')}`);
    check(off.hands.every((k) => k === h), `outer route ${route.join(' ')} from hand ${h} moved the hand`);
  }
}

// =================================================================================
// 5. heldMoveSet for every first block
// =================================================================================
type HeldMoveSet = (held: readonly Move3x3[], rots: readonly Move3x3[]) => Move3x3[];
const CENTRES = [4, 22, 25, 28, 31, 49];
const BOTTOM_LEFT = ID.filter((i) => POS[i][0] === -1 && POS[i][1] <= 0);
const BOTTOM_RIGHT = ID.filter((i) => POS[i][0] === 1 && POS[i][1] <= 0);
const sameIndexSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((i) => b.includes(i));
function checkHeld(hms: HeldMoveSet) {
  check(sortedKey(ROUX_HELD) === sortedKey(turnsOf('UDLRFBMr')) && ROUX_HELD.length === 24, 'ROUX_HELD is not U D L R F B M r');
  check(sortedKey(ROUX_SB_HELD) === sortedKey(turnsOf('RrUM')) && ROUX_SB_HELD.length === 12, 'ROUX_SB_HELD is not R r U M');
  check(ALL_FB.length === 24, `ALL_FB has ${ALL_FB.length} blocks`);
  ALL_FB.forEach((fb: Cube3x3Mask, n) => {
    const H = holdFor(fb) as RotationMove[];
    const Hp = seqPerm(H);
    const own = [...fb.solvedFaceletIndices];
    const centre = CENTRES.filter((c) => own.includes(c));
    const tag = `block ${n} [${H.join(' ') || '-'}]`;
    // The hold, by geometry: the block shows bottom-left, the second block bottom-right.
    check(sameIndexSet(own.map((i) => Hp[i]), BOTTOM_LEFT), `${tag}: holdFor does not show the block bottom-left`);
    const sb = bothBlocks(fb).solvedFaceletIndices.filter((i) => !own.includes(i));
    check(sameIndexSet(sb.map((i) => Hp[i]), BOTTOM_RIGHT), `${tag}: the second block is not bottom-right`);
    check(centre.length === 1, `${tag}: block has ${centre.length} centres`);

    for (const [name, held, wholeBlock] of [['ROUX_HELD', ROUX_HELD, false], ['ROUX_SB_HELD', ROUX_SB_HELD, true]] as const) {
      const set = hms(held, H);
      check(set.length === held.length && new Set(set).size === held.length, `${tag} ${name}: ${set.length} moves, want ${held.length} distinct`);
      check(set.every((m) => O_LAYER.includes(m)), `${tag} ${name}: a move is not a layer turn`);
      check(sortedKey(rename(set, H)) === sortedKey(held), `${tag} ${name}: renames back to ${sortedKey(rename(set, H))}`);
      // The same by geometry alone: each model move is exactly one held move, each held move once.
      const heldSeen = new Set<string>();
      for (const y of set) {
        if (!O_LAYER.includes(y)) continue;
        const lhs = seqPerm([y, ...H]);
        const as = held.filter((hm) => same(lhs, seqPerm([...H, hm])));
        check(as.length === 1, `${tag} ${name}: model ${y} is ${as.length ? as.join('/') : 'no'} held move`);
        if (as.length !== 1) continue;
        heldSeen.add(as[0]);
        const p = movePerm(y);
        check(centre.every((c) => p[c] === c), `${tag} ${name}: ${y} (held ${as[0]}) moves the block's centre`);
        if (wholeBlock || as[0][0] === 'M' || as[0][0] === 'r')
          check(own.every((i) => p[i] === i), `${tag} ${name}: ${y} (held ${as[0]}) moves the first block`);
      }
      check(heldSeen.size === held.length, `${tag} ${name}: covers ${heldSeen.size} of ${held.length} held moves`);
    }
  });
}

// =================================================================================
// Run
// =================================================================================
const section = (name: string, run: () => void) => {
  const c0 = checks, m0 = mismatches, s0 = Date.now();
  run();
  console.log(`  ${name}: ${checks - c0} checks, ${mismatches - m0} mismatches (${Date.now() - s0} ms)`);
};
console.log('notation check');
section('0. oracle vs engine + cube.ts, FRAMES, frameOf', checkOracle);
if (engineSliceDisagreements)
  console.log(`  *** SERIOUS: the ENGINE's slice/wide/rotation permutations disagree with geometry in ${engineSliceDisagreements} cases ***`);
section('1. renameMove (45 turns × 24 frames + 200 random rotation sequences)', () => checkRename(renameMove));
section('1. rename / unrename on routes', checkRenameLists);
section('2. decompose (45 turns)', () => checkDecompose(decompose));
section(`3. toReported (45 turns × 24 hands + ${ROUTE_CASES.length} random routes)`, () => checkReported(toReported));
section('3. reportedTurns, default hand, empty route', checkReportedExtras);
section(`4. outer-only routes (${OUTER_ROUTES.length})`, () => checkOuterRoutes(toReported));
section(`5. heldMoveSet (${ALL_FB.length} blocks × ROUX_HELD, ROUX_SB_HELD)`, () => checkHeld(heldMoveSet));

// --- 6. mutation tests ---------------------------------------------------------------
// Each mutant is a broken variant run through the very same check; it must be caught.
const upper = (m: string) => m[0].toUpperCase() + m.slice(1);
const frozen = (tr: ToReported): ToReported => (route, hand = 0) => ({ turns: tr(route, hand).turns, hands: route.map(() => hand) });
const MUTANTS: [string, () => void][] = [
  ['rename: slice keeps its suffix (direction dropped)', () => checkRename((m, r) => {
    const x = renameMove(m, r);
    return ('MES'.includes(m[0]) ? x[0] + m.slice(1) : x) as Move3x3;
  })],
  ['rename: rotation applied backwards', () => checkRename((m, r) => renameMove(m, M3(invSeq(r))))],
  ['rename: wide turns named as their outer face', () => checkRename((m, r) => upper(renameMove(m, r)) as Move3x3)],
  ['decompose: rotation the wrong way', () => checkDecompose((m) => { const d = decompose(m); return { turns: d.turns, rot: M3(invSeq(d.rot)) }; })],
  ['decompose: outer turns the wrong way', () => checkDecompose((m) => {
    const d = decompose(m);
    return isOuterName(m) ? d : { turns: M3(d.turns.map(invName)), rot: d.rot };
  })],
  ['decompose: rotation dropped', () => checkDecompose((m) => ({ turns: decompose(m).turns, rot: [] }))],
  ['toReported: rotation never carried (each turn decomposed alone)', () => checkReported((route, hand = 0) => ({
    turns: route.map((m) => decompose(m).turns), hands: route.map(() => hand),
  }))],
  ['toReported: right turns, hand never moves', () => checkReported(frozen(toReported))],
  ['toReported: starting hand ignored', () => checkReported((route) => toReported(route, 0))],
  ['toReported: reported turns the wrong way round for slices', () => checkReported((route, hand = 0) => {
    const g = toReported(route, hand);
    return { turns: g.turns.map((t) => (t.length === 2 ? M3(t.map(invName)) : t)), hands: g.hands };
  })],
  ['toReported: every outer turn taken for a wide one', () => checkOuterRoutes((route, hand = 0) =>
    toReported(M3(route.map((m) => m[0].toLowerCase() + m.slice(1))), hand))],
  ['toReported: outer route re-held anyway', () => checkOuterRoutes((route, hand = 0) => {
    const g = toReported(route, hand);
    return { turns: g.turns, hands: g.hands.map((k, i) => (k + i) % 24) };
  })],
  ['heldMoveSet: hold rotation applied backwards', () => checkHeld((held, r) => heldMoveSet(held, M3(invSeq(r))))],
  ['heldMoveSet: hold ignored', () => checkHeld((held) => [...held])],
  // (a slice named the wrong way round cannot show here: the set holds M, M' and M2
  // alike. Direction is checks 1 and 3's business.)
  ['heldMoveSet: the wide turn on the wrong side (r for l)', () => checkHeld((held, r) =>
    heldMoveSet(held, r).map((m) => ('udlrfb'.includes(m[0]) ? 'durlbf'['udlrfb'.indexOf(m[0])] + m.slice(1) : m) as Move3x3))],
  ['heldMoveSet: the slice on the wrong axis', () => checkHeld((held, r) =>
    heldMoveSet(held, r).map((m) => ('MES'.includes(m[0]) ? 'ESM'['MES'.indexOf(m[0])] + m.slice(1) : m) as Move3x3))],
];
console.log('  6. mutation tests (each must be caught):');
const real = { mismatches, checks };
let uncaught = 0;
quiet = true;
for (const [name, run] of MUTANTS) {
  mismatches = 0;
  run();
  if (!mismatches) uncaught++;
  console.log(`     ${mismatches ? 'caught  ' : 'UNCAUGHT'} ${String(mismatches).padStart(6)} mismatches — ${name}`);
}
// For the record, not a gate: the engine's own translateMove, the reason notation.ts
// exists. Tried with the rotation both ways round; the better of the two is shown.
const engineWrong = [false, true].map((flip) => {
  mismatches = 0;
  checkRename((m, r) => translateMove(m, (flip ? invSeq(r) : r) as RotationMove[]));
  return mismatches;
});
// Also for the record: toReported read the other way (route already in the hands'
// names). Same at hand 0; from any other hand the module does not mean this.
const handReading = [true, false].map((hand0Only) => {
  mismatches = 0;
  checkReported(toReported, 'hand', hand0Only);
  return mismatches;
});
quiet = false;
({ mismatches, checks } = real);
console.log(`     (engine translateMove through check 1: ${Math.min(...engineWrong)} mismatches — ${Math.min(...engineWrong) ? 'it does misname turns' : 'it agrees with geometry'})`);
console.log(`     (toReported with the route read as HAND names, S·FRAMES[h]·route: ${handReading[0]} mismatches at hand 0, ${handReading[1]} over random hands — the gate reads the route as MODEL names, S·route·FRAMES[h])`);

console.log(`notation check — ${checks} checks, ${MUTANTS.length} mutants (${uncaught} uncaught), ${Date.now() - t0} ms`);
console.log(`mismatches ${mismatches}`);
if (mismatches || uncaught) process.exitCode = 1;
