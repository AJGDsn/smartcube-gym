// Measurement (not a gate): teoidus's first-block flowchart, by the numbers.
//
// For random scrambles (20 random outer turns), with the first blocks the
// colour-neutrality ladder allows (hold.ts):
//   1. How often each feature is free — the video counted 88% edge+centre pair,
//      66% corner+edge pair, 96% either, over 50 of his own solves.
//   2. Which flowchart branch fires, for the fixed white-bottom / blue-left block.
//   3. Move counts (HTM, outer turns): the block's optimum, the best staged route
//      for each approach, and what following the flowchart's pick costs against
//      the best approach available.
//
// Usage: npx tsx scripts/fb-flowchart-measure.ts [scrambles=300] [lengthScrambles=120]

import { applyMoves, newSolved, type Move3x3 } from '../src/engine-api.ts';
import { solveInFrames } from '../src/frame.ts';
import { blockHoldLabel, rungBlocks, type CnRung } from '../src/hold.ts';
import {
  APPROACHES, APPROACH_LABEL, EDGE_CENTRE_IDS, PAIR_IDS, bestForApproach, flowchart, presentStructures,
  structureMasks, type Approach, type Branch,
} from '../src/fb-structures.ts';

const N = Number(process.argv[2] ?? 300);
const NL = Number(process.argv[3] ?? 120);
let seed = 7_2026_11_09;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const TURNS = FACES.flatMap((f) => SUF.map((x) => f + x)) as Move3x3[];
const scramble = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(rand() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(rand() * 3) | 0]); }
  return o as Move3x3[];
};
const CFG = { moveSet: TURNS, pruningDepth: 4, depthLimit: 12 };
const pct = (k: number, n: number) => `${((100 * k) / n).toFixed(0)}%`;
const scrambles = Array.from({ length: N }, () => applyMoves(newSolved(), scramble(20)));

// --- 1. feature frequencies, by rung ----------------------------------------------------
console.log(`# teoidus's first-block flowchart, measured\n\n${N} random scrambles (lengths: first ${NL}).\n`);
console.log('## 1. How often a feature is free\n');
console.log('Video (50 of his solves): edge+centre 88%, corner+edge 66%, either 96%.\n');
console.log('| first blocks | edge+centre pair | corner+edge pair | either | 3×1 bottom line | 3×1 E line |');
console.log('|---|---|---|---|---|---|');
const RUNGS: CnRung[] = ['blue', 'bluegreen', 'white', 'dual'];
for (const r of RUNGS) {
  const fbs = rungBlocks(r);
  let ec = 0, cp = 0, either = 0, ld = 0, le = 0;
  for (const c of scrambles) {
    const sets = fbs.map((fb) => presentStructures(c, fb));
    const hasEc = sets.some((s) => EDGE_CENTRE_IDS.some((id) => s.has(id)));
    const hasCp = sets.some((s) => PAIR_IDS.some((id) => s.has(id)));
    ec += +hasEc; cp += +hasCp; either += +(hasEc || hasCp);
    ld += +sets.some((s) => s.has('lineD')); le += +sets.some((s) => s.has('lineE'));
  }
  console.log(`| ${r} (${fbs.length}: ${fbs.length === 1 ? blockHoldLabel(fbs[0]) : 'any of'}) | ${pct(ec, N)} | ${pct(cp, N)} | ${pct(either, N)} | ${pct(ld, N)} | ${pct(le, N)} |`);
}

// --- 2. flowchart branches, fixed block -------------------------------------------------------
const FB = rungBlocks('blue')[0];
console.log(`\n## 2. Which flowchart branch fires (fixed ${blockHoldLabel(FB)})\n`);
const branches = new Map<Branch, number>();
const picks: Approach[][] = [];
for (const c of scrambles) {
  const f = flowchart(c, FB);
  branches.set(f.branch, (branches.get(f.branch) ?? 0) + 1);
  picks.push(f.approaches);
}
console.log('| branch | share |\n|---|---|');
for (const b of ['lineD', 'lineE', 'cornerEdge', 'edgeCentre', 'disjointed', 'fallback'] as Branch[]) {
  console.log(`| ${b} | ${pct(branches.get(b) ?? 0, N)} |`);
}

// --- 3. move counts, fixed block ---------------------------------------------------------------
console.log(`\n## 3. Move counts (fixed ${blockHoldLabel(FB)}, HTM, outer turns, ${NL} scrambles)\n`);
const t0 = Date.now();
const opt: number[] = [];
const per: Record<Approach, number[]> = Object.fromEntries(APPROACHES.map((a) => [a, []])) as unknown as Record<Approach, number[]>;
const bestOf: number[] = [], flow: number[] = [], winner = new Map<Approach, number>();
let missing = 0;
for (let i = 0; i < NL; i++) {
  const c = scrambles[i];
  const o = solveInFrames(c, structureMasks(FB).block, CFG)?.moves.length;
  if (o == null) { missing++; continue; }
  opt.push(o);
  const lens = {} as Record<Approach, number>;
  for (const a of APPROACHES) {
    const r = bestForApproach(c, FB, a, CFG);
    lens[a] = r ? r.moves.length : 99;
    if (r) per[a].push(r.moves.length);
  }
  const b = Math.min(...APPROACHES.map((a) => lens[a]));
  bestOf.push(b);
  for (const a of APPROACHES) if (lens[a] === b) winner.set(a, (winner.get(a) ?? 0) + 1); // ties count for each
  flow.push(Math.min(...picks[i].map((a) => lens[a])));
}
const mean = (xs: number[]) => (xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length)).toFixed(2);
const n = opt.length;
console.log(`Block optimum (any route): mean ${mean(opt)}${missing ? ` (${missing} beyond depth 12, left out)` : ''}.\n`);
console.log('| approach | mean best staged route | among the best (ties count for each) |\n|---|---|---|');
for (const a of APPROACHES) console.log(`| ${APPROACH_LABEL[a]} | ${mean(per[a])} | ${pct(winner.get(a) ?? 0, n)} |`);
const gapOpt = bestOf.map((b, i) => b - opt[i]);
const gapFlow = flow.map((f, i) => f - bestOf[i]);
console.log(`\nBest approach vs the optimum: mean +${mean(gapOpt)}; equal in ${pct(gapOpt.filter((g) => g === 0).length, n)}.`);
console.log(`Following the flowchart's pick vs the best approach: mean +${mean(gapFlow)}; as good in ${pct(gapFlow.filter((g) => g === 0).length, n)}, within 1 in ${pct(gapFlow.filter((g) => g <= 1).length, n)}, within 2 in ${pct(gapFlow.filter((g) => g <= 2).length, n)}.`);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s for the move counts.)`);
