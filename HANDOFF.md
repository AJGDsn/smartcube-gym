# HANDOFF.md — status + remaining work

The repository audit (`AUDIT.md`) has been worked through on a real machine.
**Read `CLAUDE.md` first** for durable architecture, build/verify commands, and
guardrails. Run `npm run build` + `npm run check` (expect 0 mismatches) after each
change.

---

## Done (2026-06)

- **Step 1** — deleted dead `src/solver.ts`; removed the `(e as any)` casts in
  `bluetooth.ts`; added `src/storage.ts` (centralised, validated, prefixed,
  per-device MAC) + `scripts/storage-check.ts` (13/13).
- **M2** — test oracles moved to `scripts/oracles.ts`; dead facade exports removed
  (`maskProgressState`, `statesEqual`, `maskProgressFromHistory`, `nearestMask`);
  `cube.ts` annotated (it's both an app dep via `KOCIEMBA_FACELET_COORDS` and a
  harness oracle — not dead).
- **M4** — `tsconfig.scripts.json` + `npm run check`; the validation harnesses
  carry CI exit codes and run in `.github/workflows/deploy.yml` before build/deploy.
- **M5** — the engine-boundary casts collapsed into one `cubeFromFaceletArray`
  helper (and the spurious `homePermutation` casts removed).
- **H2 (steps 1–4)** — `main.ts` carved into `theme.ts`, `dom.ts`, `stats.ts`,
  `eo-axis.ts` (~2,110 → ~1,720 lines). Pure moves, build-verified after each.
- **Multi-cube Bluetooth** — swapped `gan-web-bluetooth` for
  `smartcube-web-bluetooth` (GAN/MoYu/QiYi/Giiker/GoCube); per-device MAC cache +
  MoYu32 address search. MoYu Super Weilong v2 (`WCU_MY32`) verified on hardware.
- **EO axis modes** simplified to `detect`/`gb`/`ro` (dropped `ask` + `auto` and
  their gesture/prompt machinery; fixed a stray prompt that showed in detect mode).
- **CI / deps hygiene** — runner bumped to Node 22 with current action versions
  (the Node-20 deprecation warning is cleared); `smartcube-web-bluetooth` pinned to
  a commit (`44f1f09`) for reproducible builds.
- **EO review hands-free retry** — a 4× side-face spin (F/B/R/L) retries the case,
  mirroring the U/D advance gesture; the review loop is now hands-off bar Discard.

---

## Done (2026-07) — the block-building arc

Five commits (`2632a10..`): placement-aware coaching, 3D view, planning,
pattern vocabulary, curated course, lookahead drill. Eleven harnesses in
`npm run check`. Highlights:

- **Placement-aware core** (`src/placement.ts` + main wiring): coaching follows
  the placement the user is building; completion acceptance unchanged. (The
  original whole-piece hysteresis pick was replaced by reach + a step-start
  anchor on 2026-10-27 — see "Placement pick by reach" under Done.)
- **Solver finding:** the vendored IDDFS caps at 1e6 visited nodes; pd-4 tables
  made deep 2×2×3 searches return NULL on 11% of real scrambles (and burn up to
  5s). 223 configs now pd5. `idealLen` memoized; null optimal renders '?' and
  skips Stats/course.
- **3D cube view** (`renderCube3D`, CSS-3D, zero deps): CrystalCube-style hint
  panels (4u, flat ≥34u perspective — stronger perspective occludes the back
  panel), highlight rings mirrored to hints, camera survives re-renders.
  Settings › Cube view (3D default / flat net), all categories.
- **Planning:** review ranks placements ("cheapest was X (4) — you built Y (6)";
  222/123; 223 needs a worker), tap-a-corner pins the coaching (222), inspection
  time recorded (HistRec.insp) + per-move gaps (HistRec.gaps) since P0.
- **Pattern vocabulary** (`src/patterns.ts`): the 8 Lars Petrus block patterns as
  route-event classification; all 21 cases from the source page classify as
  themselves and only themselves (`scripts/patterns-check.ts`). Hints name the
  pattern; review tags ideal + yours.
- **Curated course** (course222): lessons keyed to patterns with seeded examples
  (`src/cases.ts`, excluded from grading) + generated same-technique practice.
  Named shapes are near-completion situations → lessons use SHORT scrambles
  (len 5–10). `humanSolveFromState` gained `rankCount` (generation passes 16:
  22ms/attempt vs ~600ms at the teaching default 96).
- **Lookahead drill:** mid-solve "Lookahead" on block steps — plan the join,
  predict the next-but-one piece, view blanks, execute, tap where it ended up;
  verified against tracked state; accuracy tally in Stats.

### Follow-ups from the arc
- 2×2×3 placement ranking + ranked human-solve in a Web Worker (its 12 pd5
  tables are ~1.6s each); 1×2×3 tap-to-aim needs a two-tap picker.
- Lookahead ladder: longer sequences, multi-piece, whole-block reconstruction;
  hesitation map from the accrued `gaps` data.
- ~~Course L3 seeds are all Broken corner; category+trainer navigation
  double-resets and can burn two lesson examples.~~ BOTH FIXED 2026-07-23:
  course examples now consume on scramble-APPLY (`courseSeedPending`, same rule
  as Foundations — navigation/retry can't burn them), and the L3 seeds span
  Roundabout / Broken corner / Pillar. `scripts/lessons-check.ts` now guards
  COURSE_SEEDS tags against the TEACHING-default route — which caught and
  fixed a mislabelled L2 seed (its rank-96 route had no named event; the old
  harvest had verified the rank-16 route).

---

## Done (2026-07-23) — Blockbuilding Foundations (the beginner course)

The taught bottom-up curriculum from the Foundations roadmap (its phases 1+2,
reordered to teach the whole ladder in one release):

- **`found223` trainer** (Course category, listed first): four lessons at the
  canonical DLF corner — pair (1×1×2) → 2×2×1 square (1×2×2) → 2×2×2 → 2×2×3
  extension. Every rung is a plain box mask (`blocks.ts` `MASK_PAIR_*` /
  `MASK_221_*`); `humanSolveFromState` teaches them via the single-stage ranked
  branch (family `'112'` added).
- **Lesson/phase engine** (`src/lessons.ts` — pure data + gate math; persisted
  by stats.ts under the NEW `foundations` storage key, so graded `course`
  records are untouched): observe → guided → coached → independent; gates
  2 / 3 / 3-of-latest-4; success = target completed with helpUsed < 3
  (ideal/walkthrough is 3); the phase is DERIVED from counts, never stored.
- **Serving**: observe examples (`cases.ts` `LESSON_SEEDS`, tags verified by the
  harness) are consumed when the scramble is APPLIED, not issued — immune to
  the double-reset example burn that bites course222. Other phases generate
  through the existing prereq path plus per-lesson difficulty caps
  (`gen.maxOptimal`, attempt-capped so serving never stalls).
- **Coaching**: L1 tap-identification (`answerIdentify`; `gym.identifyTarget`
  e2e hook), per-move guided narration from cheap geometry ONLY — piece placed
  (named), pair made/split (`patterns.isPairJoined`), prereq block
  broken/recovered (`scorePlacement`) — coached opening line, and a dashed
  `keep` outline on the prereq block (dom.ts renderers grew a 4th param;
  `.sticker.keep`).
- **Beginner review** (`buildLessonReview`): the roadmap's four answers;
  planning-verdict/inspection lines hidden on lesson reps. Discard pops the
  lesson rep and steps `current` back if it un-completes the lesson.
- **Harness**: `scripts/lessons-check.ts` (gates, mask geometry + nesting,
  seed servability + tag classification, '112' route sweep) in `npm run check`;
  `scripts/harvest-lessons.ts` is the offline seed harvester (run by hand,
  not in the chain).
- **e2e-verified in the browser** (`gym.apply` + new `gym.identifyTarget` /
  `gym.ideal` hooks): the full L1 ladder including a non-counting
  ideal-assisted rep, L2–L4 serving, retry not re-burning examples, Discard
  un-counting, and regression on course222 seeds / b223ext / Stats.

### Annotated walkthrough (2026-07-23)
The pattern vocabulary is now TAUGHT, not just named: block-step walkthroughs
group the taught route's moves by classified technique (`state.learn.seg` from
`classifyRoute` — the segments partition the route, guarded in lessons-check)
with the live group highlighted and the pattern's PATTERN_HOW line shown
mid-execution; each move carries a mechanical role from `patterns.routeRoles`
(setup / join / carry / place) spoken in the next-move caption. EO walkthroughs
keep the flat list. Roles are per-move geometric truth — the technique story
lives in the segment label (e.g. a Pillar's twist-out move reads "carry" when
another pair is already riding; correct, if occasionally deadpan).

### Foundations follow-ups (roadmap phases 3–5)
- ~~Recovery lesson~~ SHIPPED 2026-07-23 as L5 "Fix a broken corner"
  (`STEP_222_RECOVERY`, fixed-corner 2×2×2, no prereq). Every served case is a
  corner rescue: `LessonDef.gen` gained `patterns?: PatternName[]`, and
  makeScramble's lesson path keeps only scrambles whose taught route classifies
  as one (Broken corner / Pillar), rankCount 16 like course222. Guarded by a
  starvation sweep in lessons-check (≥8/80 at len 7) + the generic seed/tag/
  annotation checks. e2e-verified: gate progression and every generated case
  classifying as a rescue in hint/review/walkthrough.
- ~~Build-from-scratch capstone~~ SHIPPED 2026-07-23 as L6 "Build a 2×2×3 from
  scratch" (`STEP_223_BUILD`, fixed bottom-left 2×2×3, no prereq, gen len 14 /
  maxOptimal 11). The finale: a full build with no head start; the annotated
  walkthrough splits it into the 2×2×2 milestone + extension (classifier
  segments). Graduation message fires on completion. lessons-check relaxes the
  observe watchable-cap to 13 for this lesson only; now 271 checks.
- Placement-choice lesson (roadmap L5 remnant): data-only, once free-placement
  coaching is wanted in the course.
- Capstone walkthrough segments show the classifier's names (or "build" when
  unnamed); a milestone-aware label ("2×2×2" / "extension") would read cleaner
  than a bare "build" for the two staged halves — small buildLearnPane tweak.
- Track 3: 1×2×3 Foundations (Roux/LEOR) via the same LessonDef registry.
- Phase 3 renames: position `course223` as the post-Foundations practice
  ladder; graduation cross-links.
- ~~Observe examples need a solved cube mid-session~~ FIXED 2026-07-23
  (external review flagged the invitation nuance): **Watch an example** in the
  Foundations panel (any phase, while unwatched examples remain) and **Next
  example** in an example's review hand back ONE tracked setup = undo the
  history back to solved, then the seed's scramble — the app's own
  never-teleport idiom, so a learner who cannot yet solve the cube can always
  reach a demonstration. Setups are bounded by `historyResetTo`: a setup that
  provably runs through solved lets `afterChange` replace the accumulated
  history with the seed (its exact from-solved equivalent) at the
  scramble→solve flip, so unwinds stop growing across a session (measured:
  2nd example 39 moves, 3rd 18 instead of ~55). Over `MAX_EXAMPLE_SETUP` (40)
  it declines and advises a reset rather than handing over a silly sequence.
  Examples remain OPTIONAL by design — banking guided successes still moves
  you on (`derivePhase` puts met gates above unwatched examples).
- Guided "pair made" narration only fires when the pair forms BEFORE the
  placing move (often simultaneous); narrating off the taught route's segments
  would catch more moments.
- First L4 generation pays the one-off ~2s pd5 table build on the main thread —
  covered by the existing Web Worker follow-up above.

---

## Done (2026-07-26) — the UI/UX overhaul

**Shipped in 8 commits on `ui-overhaul`, fast-forwarded to `main` and deployed:**
themes 4→2 · setup-phase meter fix · `repPhase()` · Now bar · verb tiers (one
escalating Help) · brief out of the console · Review/Stats layout modes · the
inspection gate (its own section below). The agreed direction below is kept as the
design record; the IA bullet (pillars on the skill axis) is the one part still
outstanding — see "Remaining".

A review found the shell to be a *document* layout being asked to behave like an
*instrument*: every phase of a rep is expressed by rewriting the contents of one
520px right pane and editing captions. Inspection, lookahead and piece tracking
are all new phases, so that shape has to change first. Agreed direction:

- **Three zones — Stage / Now / Log.** Stage holds only what is spatially tied to
  the cube (no prose). A **Now bar** under it holds the current instruction plus
  this phase's one or two verbs, replacing the fading toast, the hold caption, the
  scramble caption and the standing find-prompt. The console becomes a Log.
- **`repPhase()` is the keystone** (since shipped): `setup → inspect → solve →
  review`, with `walkthrough` / `lookahead` / `identify` / `track` as solve
  sub-phases. One function owns the phase; the Now bar, the allowed verbs, the
  stage decorations and the meter all read from it instead of re-deriving from
  raw state. `buildCubePanel` currently interleaves six such conditionals.
- **Verb tiers:** phase verbs in the Now bar · ONE escalating Help control with
  the grading cost on the button (mirroring `helpUsed` 0–3, where 3 voids a
  Foundations rep) · device utilities (Reset, Sync) up beside the cube pill.
- **Brief out of the console** into its own card; retires the `scrollTop` pin.
- **Review + Stats become full-width takeovers**, not tenants of the right pane.
- **IA:** pillars on the SKILL axis only (Build / Orient / Preserve & connect),
  taught-vs-graded-vs-free as a badge, and **lookahead/tracking/inspection as
  per-session drill LAYERS, not pillars** — you always track a piece *while*
  building something, which is how it is already implemented.
- **Inspection:** untimed "Ready" gate by default (`solveReadyMs` /
  `HistRec.insp` already record the measurement); a timed option is a later switch.

### Done so far
- **Themes cut 4 → 2.** Matrix deleted entirely (the rAF rain canvas, its CSS
  block, the `#app::before` reactor, the `.panel::after` brackets, the
  `buildCoachBody` cursor branch, and the Share Tech Mono webfont); `future`
  renamed **Holo** in Settings. Modern Dark demoted to the **base token layer** —
  a bare `:root` with no `data-theme='dark'` anywhere, so `THEMES` holds only the
  two real skins and a stored `dark`/`matrix` validates back to Borland rather
  than leaving the picker with nothing selected. `@keyframes meter-flow` was
  declared inside the Matrix block but is used by Holo — it survived as a shared
  animation. The three orphan `future` media one-liners are consolidated into the
  responsive section, which must name each skin explicitly (a skin's token block
  sets `--s` at specificity 0,1,1 and would silently beat a bare `:root`).
  **Theme budget rule** now in the stylesheet header: a skin may override tokens
  and add a short flourish list, never restructure layout.
- **Dead CSS swept:** `.tab` / `.tab.active` and the `--tabs-pad` /
  `--tab-active-*` tokens (the pane's tab controls went when it became one slot
  with four tenants — zero `.tab` elements rendered), `.menu / .mi / .hot`,
  `.top-meta`, `.statusbar / .sb / .key / .sep`, `.pill / .pill.ok`.
- **The setup-phase meter no longer lies.** It read `width: 100%` / "4/4 pieces
  placed" while the scramble was still being applied, because `progressInfo`
  measures the step target against a cube that hasn't been scrambled yet.
  `buildStepMeter` now delegates to `buildScrambleMeter` while `mode ===
  'scramble'`: applied/total, a real fill, and an off-track caption that agrees
  with the strip.

- **`repPhase()`** (step 3) — one definition of where a rep is:
  `setup | solve | identify | lookahead | walkthrough | review`, plus
  `isSolvingPhase()` for the three phases where you're working the target
  yourself. Replaced five re-derivations, including a review test written out
  verbatim in both gesture handlers. Two corrections fell out: `enterLearn` now
  abandons a lookahead rep in flight (Show ideal → Walk it through used to start a
  walkthrough with all 54 stickers still blanked), and tap-to-aim is disarmed in
  review. The frame helpers (`solveRotation`/`solveFrame`/`notationFrame`)
  deliberately still read `state.mode` and say why — they answer which frame the
  cube is DRAWN in, which must hold across the whole post-scramble half of a rep,
  so `isSolvingPhase` (which excludes walkthrough and review) is the wrong test.
- **`gym.move()`** — `gym.apply` goes straight to `step()`, the one path the
  hands-free review gestures don't run on (they hang off `handleMove`, the live BLE
  callback), so they had no e2e reach at all. Now verified from the browser.
- **Now bar** (step 4) — `buildNowBar`, directly under the stage. The instruction
  was previously spread across the strip's caption, the cube caption, a `[find]`
  console line and a 3.5s toast; all four now converge here. Rendered for the four
  phases that share the generic session pane — walkthrough and review are excluded
  because their dedicated panes already own their instruction and verbs, and a
  second copy would need filler text. Verbs appear only for a phase you can back
  OUT of (Cancel lookahead moved here out of the actions row). Styled from tokens
  only: both skins picked it up with zero per-skin CSS, which is the budget rule
  paying off. The setup line distinguishes the two errands that share the phase —
  applying a scramble vs `enterLearn`'s rewind — as does the meter's label.

  The hold note deliberately STAYED on the stage, against the original sketch: it
  describes the view, not the phase, and shouldn't turn over with the instruction.

  Note `scrambleRemaining()` is not used for the "N to go" count. `simplifyMoves`
  is a single pass over consecutive same-face runs, so a cancellation that only
  becomes adjacent after an inner pair vanishes survives and the count comes out
  inflated (the old strip caption had this too). On-track the Now bar reads
  `scrambleMoves.length - done` and the token the strip is highlighting, so the two
  always agree; off-track it quotes the self-healing head move and no count.

- **Verb tiers** (step 5) — three tiers, three homes. Help collapsed from three
  peer buttons (Hint / Next move / Show ideal) to ONE escalating control driven by
  `state.helpUsed`, the monotonic ratchet the lesson grading already reads: rung 0
  "Hint" → rung 1 "More help" → rung 2 (primary gone). Read off the ratchet, not
  the last request, because `assist()` degrades a nudge to a next-move when there's
  no focus piece — so the rung you land on isn't always the one you asked for.
  A `.help-rung` note reports what's been taken; it was previously visible nowhere.

  **"Show the route" stays separately reachable** rather than being the third
  press: escalation exists to make the cost legible, not to add friction, so a user
  who knows they're stuck still gets the answer in one click — with the cost on the
  button that charges it (`· won't count`, on Foundations lessons only, since
  `helpUsed` doesn't affect graded-course scoring). Observe examples are special-
  cased: `startLessonSolve` reveals the route FOR you, arriving at rung 3 unasked,
  so the note reads "a demonstration — nothing here is graded" instead of a cost.

  Reset and Sync moved from the step bar to a `.cube-group` cluster beside the cube
  pill in the top bar — they act on the physical device, and "Sync to Cube state"
  was spending 152px of prime width on a BLE-drift button. The step bar now holds
  only session verbs (Next scramble, Change). Labels shortened to Reset / Sync with
  explanatory titles; MANUAL.md updated to match.

- **Brief out of the console** (step 6) — `buildBriefCard` replaces `buildBriefing`.
  The standing brief (title, explanation, goal, why, phase ladder, grading rule —
  measured 335px on a fresh Foundations lesson) used to share the console's scroll
  box with the help output, which is why `render()` pinned the console to the bottom
  whenever help was asked for. **That pin is gone**: the help output is now the first
  line of its own box (verified `scrollTop` 0, `scrollHeight === clientHeight`, so
  the log doesn't even overflow). The console gained a `Coaching` header and reads as
  what it is — a log of what you asked for.

  The disclosure default is DERIVED, not stored: open while `briefIsNew()` (no reps
  banked at this level/lesson), collapsed once you have any. `state.briefOpen` holds
  an explicit override from clicking the header. Collapsed is 45px against 335px
  expanded. Free Blocks/EO drills get no card at all — their step blurb is in the
  Now bar.

  **Trap, and a warning for future components:** the log header first used
  `.panel-hd`, which Borland re-purposes STRUCTURALLY — absolutely positioned into
  the enclosing `.panel`'s top border as a DOS dialog legend. Inside a panel that
  put "Coaching" 12px above the right pane, 269px from the log it labelled. It now
  uses `.log-hd`, which duplicates the same typography tokens with no repositioning.
  Reusing a class whose skin override is structural rather than cosmetic is the one
  way to break the theme budget rule by accident — check both skins when reusing.

  The console-collapse half of the agreed "keep it, demoted" was NOT done, on
  purpose: the right pane is a fixed-height flex column, so collapsing the log only
  moves whitespace around. It becomes worth doing in step 7, when Review and Stats
  stop being tenants of that pane and its contents actually change.

- **Review and Stats stop being sidebar tenants** (step 7) — three layouts on one
  grid, set by a modifier in `render()`:
  - default `1fr 520px` — stage-led;
  - `.wide-right` (review) `minmax(260px, 32%) 1fr` — the cube STAYS but yields;
    measured 520px → 838px for the review at a 1280 viewport;
  - `.takeover` (Stats) `1fr` with the left column not built at all — 490px → 1226px,
    and Stats now fits without scrolling.

  Stats is a MODE (enter, read, leave; the cube is irrelevant) so it takes
  everything. Review is part of the rep, so the cube stays: you have just built
  something, and Try again / Learn the ideal hand the cube back a sequence.

  The comparison is now laid out for the width it has. `buildRouteComparison` is
  shared by both reviews — your route beside the ideal, counts in tabular numerals —
  replacing the pre-wrapped two-line `.coach` block each had, which wrapped
  mid-sequence in a 490px column. The "how well did you read it" lines became a
  `.facts` label/value grid, and the EO axis verdict became two marked rows instead
  of a two-line text blob. No `.coach` pre-wrap blocks remain in either review.

  **Trap:** the layout modifiers must be reset BY NAME in the narrow-screen media
  query. `.main.wide-right` is specificity (0,2,0) and beats a bare `.main` (0,1,0)
  whatever the source order, so the review kept a two-column grid on a phone —
  measured 260px + 162px at 375px, scrolling sideways. Same shape of bug as the
  `.panel-hd` reuse in step 6: the failure is invisible until you check the case
  where the other rule was supposed to win.

  `.col` also gained `min-width: 0`, so a grid item can never again be inflated past
  its track by its contents' min-content width. That incidentally fixes the
  page-level horizontal scroll in the chips bug below — the chips still don't wrap
  (their own row overflows), which is the part the separate task owns.

### Correction to step 6's note
Step 6 claimed the console's collapse would "earn its keep in step 7". It does not.
Review and Stats no longer share the session pane, but the pane is still a
fixed-height flex column with the log absorbing the remainder — folding it there
still just moves whitespace. The honest options are (a) drop the collapse idea and
let the log fill the pane, or (b) make the log yield its height to an open brief
instead of a manual toggle. **Ian's call** — it is a UX preference, not a defect.

## Done (2026-07-26) — Inspection: the first feature to land ON the new shell

The payoff for step 3. An `inspect` case in `repPhase()`, a branch in the Now bar,
a Settings switch, and one state field — no new conditionals threaded through the
builders, which was the whole argument for doing the refactor first.

- **Settings › Inspection** — `off` (default, "Straight in") / `gate` ("Plan
  first"). Default off so an existing session is unchanged until Ian opts in.
- **Phase** — `inspect` sits between `setup` and `solve`, and is DERIVED:
  `inspectMode === 'gate' && !state.inspectCommitted && movesThisStep.length === 0`.
  Nothing can get stuck, and flipping the setting mid-rep takes effect immediately
  (verified). `inspectCommitted` resets when a scramble lands.
- **Precedence** — `identify` OUTRANKS `inspect`. Both are pre-solve work, but the
  find prompt is the more specific task and answering it *is* inspecting, so the
  gate appears once it's answered rather than the two competing for the Now bar.
  Verified end to end: prompt → both stages → gate. `walkthrough` also outranks it,
  so `enterLearn`'s rewind is never followed by a gate.
- **Help is disabled during inspection** (`isSolvingPhase` excludes it, by
  omission). Asking for a hint IS committing, so you press Ready first. Retry and
  Lookahead are likewise off — there's nothing to retry and nothing turned yet.
- **Tap-to-aim is armed during inspection** as well as solve. Choosing where the
  block goes is the main thing inspection is for, and it's what the roadmap's
  inspection drill asks for before the first turn.

### The constraint that shaped it — read before "fixing" the gate
The original sketch said "turns rejected". **They cannot be.** The model mirrors the
physical cube and is driven only by reported moves; ignoring one desyncs the two,
which is the single thing this app must never do. So the gate is a *commitment
button, not a lock*: a turn ends inspection exactly as Ready does. Verified — the
turn is counted, the model follows it, and the phase advances with no desync.

`insp` (HistRec) is deliberately still measured scramble → first MOVE, not scramble
→ Ready, so the field keeps one meaning across all accrued history whether or not
the gate is on. Pressing Ready then pausing therefore counts the pause; that is
accepted, and it's what the Settings hint promises.

**No clock on screen, deliberately.** A counter would turn planning into a speed
test, which the roadmap explicitly rules out. The time reports afterwards in the
review, where it informs without pressuring.

### Next
Piece tracking (a `track` sub-phase alongside `lookahead`), then the pillar IA with
lookahead/tracking/inspection as per-session drill layers rather than trainers.
Everything from here is behaviour-visible — verify in the browser as well as through
`npm run check`.

### Known, not yet addressed
- `simplifyMoves` doesn't iterate to a fixed point (above). It also feeds
  `undoToScramble`, `enterLearn`'s rewind and the review's "your moves" display, so
  fixing it would shorten real rewind sequences — but it touches a graded-adjacent
  display, so it wants its own change rather than riding along with UI work.
- ~~On free-placement block trainers the displayed `ideal` can change mid-solve
  without the cube state changing~~ — **fixed 2026-10-27 (`b487388`).** See
  "Placement pick by reach" below.
  Correction for the record: this bullet used to say the "no-signal half" was
  addressed in a separate session. It never landed — it sat uncommitted in a
  worktree — so `main` still had the full drift until this branch.
- The chip row overflows narrow viewports: at 375px the six Foundations lesson
  chips exceed their row. `.chips` is a non-wrapping flex row (`src/style.css`
  line ~686 — no `flex-wrap`). Isolated by hiding each child of `.col` in turn;
  trainers with no chips panel are clean. CSS-only, unrelated to the overhaul.
  **Half-fixed:** the knock-on effect — `.col` was a grid item with the default
  `min-width: auto`, so the track expanded to the chips' min-content width (527px)
  and the *whole page* scrolled sideways — went away with `.col { min-width: 0 }`
  added during overhaul step 7. So the page no longer scrolls; the chips still
  overflow their own row, which is all that remains.

---

## Done (2026-08-22) — the cube-sync repair that was merged and then reverted

An externally-produced repair (PR #2, `repair/cube-sync-reliability`) for
smart-cube seeding and idle resynchronisation. Five files, +226/−44, green on every
harness and on CI. **Merged (`796b4cd`), deployed, and reverted the same afternoon
(`d387d4b`) — the tree is byte-identical to `ae34bd3` again.** Read this before
re-landing any part of it.

What it contained, and the verdict on each half:

- **Connect seeding** (`MoveSeedGate` in a new `src/cube-sync.ts`). Bounds the wait
  for the first `FACELETS` at 1.8s and replays buffered moves exactly once, so a
  cube whose state request goes unanswered can't leave the scramble stuck at 0/16.
  Sound in itself — but its premise needs checking on hardware, see below.
- **Idle reconciliation.** Accept a passive `FACELETS` once the cube has been still
  for 700ms, bridge up to six moves. **This is the half that broke, and it was
  already known to break.** Essentially line-for-line the policy shipped in
  `3d91503` and reverted hours later in `69409b0` (June): same 700ms, same
  `explicit = awaitingSync` split, same `findBridge(…, 6)`, same explicit-only
  big-divergence reset. The PR described it as behaviour an older commit
  "introduced but which was subsequently lost" — it was not lost, it was
  deliberately removed for corrupting move tracking on the real cube.
- **Bounded manual Sync**, and the `bluetooth.ts` reordering (FACELETS before
  battery/hardware, each optional command isolated, `requestFacelets()` returning
  `Promise<boolean>`). Uncontroversial in themselves, but the reordering is a real
  behavioural change for GAN that went out untested on hardware.

**What hardware said.** MoYu worked; every GAN cube "connected, but no moves
registered" — verbatim the symptom the pre-June comment predicted: *"Acting on them
would 'correct' the model backwards by a move (undoing a turn you just made, so
progress never advances)."* The moves did register; the idle snapshot 700ms later
computed the inverse of the turn just made and undid it.

**The finding that matters most — the library already does this, properly.** In
`node_modules/smartcube-web-bluetooth/src/gan-cube-protocol.ts` every GAN move
carries a serial (0–255, incremented per state change). `evictMoveBuffer` detects a
gap (`diff > 1`) and calls `requestMoveHistory` to fetch **the real missed moves out
of the cube's own buffer**, holding the FIFO back until the gap is filled. So
app-level bridging from a lagging facelet snapshot is a strictly worse mechanism
layered on top of a correct one. **Don't duplicate it.**

Two corollaries:

- **Why MoYu was fine.** That serial/move-history recovery lives only in the GAN
  core protocol — the MoYu/QiYi/GoCube wrappers have no equivalent — and MoYu
  reports true absolute state, so snapshot reconciliation is both useful and safe
  there. The exact split observed falls straight out of that asymmetry, so any
  future reconciliation should be **per-protocol, not global**.
- **Check the seeding premise before rebuilding it.** The same file accepts MOVE
  events only after the first FACELETS (`if (this.lastSerial != -1)`), so on GAN the
  library emits nothing until state arrives — meaning the "every move swallowed
  during seeding" bug may not exist on GAN at all, and a 1.8s replay timeout would
  have nothing queued to replay.

**Why CI could not catch any of it.** `scripts/cube-sync-check.ts` (11/11) exercised
only the pure `cubeIsAtRest` predicate and the `MoveSeedGate` class. The
reconciliation *policy* is observable only with a cube in hand. A green harness on a
BLE change means the units are sound, not that the behaviour is.

`de01962` and `origin/repair/cube-sync-reliability` still exist if a narrower version
is wanted. PR #2 reads as merged-then-reverted, which is the honest record.

## Done (2026-08-22/26) — two coaching fixes on the new shell

### A hint outlives the turn it prompted (`470dbab`)
`step()` cleared `state.assist` on **every** move, and both the cube-card note and
the coaching box read from it — so one turn wiped the highlight, the pattern name and
the technique together, usually before they had been read. Recovery was impossible
rather than merely awkward: the escalating Help button reads the `helpUsed` ratchet,
so once a hint had been taken the button was already "More help", and pressing it
spends a rung and hands over a move. **A regression introduced by the overhaul
itself** — the old three-button version let you press Nudge again for free
(`helpUsed` is a `Math.max`).

`survivingAssist()` now keeps a **nudge** across turns, refreshing `focus.current`
through `locatePieceNow` so the highlight follows the piece, and retiring it once
that piece is home. Next-move and route still clear: they are move lists, wrong one
turn later, and refreshing them would be autopilot that quietly makes every rep a
rung-3 rep. Deliberately does **not** re-derive the route per turn —
`locatePieceNow` is a table lookup, but `idealRoute` is a search (~130ms on a deep
2×2×3, which is why `idealLen` is memoized), and that lag would land on every move.

**Design lesson worth keeping:** collapsing several controls into one escalating
control can strand the rungs below it. When doing that, check that every state the
old controls could reach is still reachable.

### EO stops printing its own answer, and a daily practice tally (`1fd01e5`)
**EO concealment.** The step meter read `8/12 edges oriented · ideal 4` from the
moment the scramble landed — the bad-edge count (the recognition skill the five EO
trainers exist to build) plus the optimal length (the shape of the solution). The
inspection gate made it worse by putting both on screen during the one phase meant
to be planning. It was also inconsistent with the app's own grading: **Hint** says
"4 bad edges", spends a rung and prints "used: a hint" on the review — for the same
number the meter gave away one line below. `concealsProgress(s)` (`s.kind === 'eo'`)
holds back the fill, the caption and both copies of the ideal (the header tag in
`buildSessionPane`, the `· ideal N` in `buildStepMeter`), and the count lands in the
review as a `bad edges · N at the start` fact. The empty meter track still renders so
the pane keeps its shape. **Blocks are deliberately untouched:** their pieces are
visible on the cube, so a placed-count reports what you can already see.

**Practice tally** (`stats.ts`: `DailyTally`, `dayKey`, `loadDaily`, `bumpDaily`,
`discardDaily`, `dailyRows`; `buildPracticeTally()` in `main.ts`; new `'daily'`
storage key). Reps per day per step, under course progress, with a
14-**calendar**-day chart so the gaps show. Stored rather than derived from
`history`, because history is capped at 500 solves and the early days would age out
of their own chart; the first read seeds itself from whatever history still holds,
and `discardLastSolve` rolls a count back.

`scripts/daily-check.ts` (16 checks, wired into `npm run check` — **now 14
harnesses**: `cube-sync-check` left with the revert, so this took the suite 13 → 14)
covers exactly the hazard that two records of one fact create, and
earned its keep on the first run: `recordSolve` appended to `history` *before*
bumping, so the lazy seed inside `bumpDaily` found the new rep already in history and
counted it twice. Every first solve would have logged as two. Fixed by settling the
seed first.

### Deploy note (2026-08-26)
The push for `1fd01e5` produced no workflow run: Actions was in a major outage and
had throttled inbound traffic. The run arrived later as a `push` event once the
backlog drained — pushes in that window were **delayed, not dropped**. Don't read a
slow build as a broken one; `workflow_dispatch` on `main` is the clean re-trigger if
one is ever genuinely lost.

---

## Done (2026-10-27) — Placement pick by reach (merged to `main` as `b487388`, deployed)

**The problem.** Which block the coaching follows (progress, ideal, hints) was
picked by *whole pieces placed*, with hysteresis threading the last pick through
every move. Two faults, measured against simulated human solves whose target is
known (`scripts/placement-accuracy.ts`):
- **It was mostly guessing.** Placed counts tie on 70–80% of the states where the
  user's block is identifiable at all, so late in a solve the pick named the
  right block only 68% (2×2×2), 56% (1×2×3) and 64% (2×2×3) of the time.
- **It drifted.** Threading made the pick a fold over the move path: ~19% of no-op
  excursions (U U U U, a wrong turn undone) handed the job to another block for
  good and moved the displayed ideal while the cube was unchanged.

**The fix.** Rank candidates by **reach** — most pieces solved within one turn,
then within two, then now — and keep the step-start pick unless strictly
out-reached. A pair waiting to be inserted or a block offset by one layer shows
up in reach while a placed count sees nothing, so ties mostly disappear and
memory stops being necessary. The pick is a pure function of (start state, live
state): **no-op drift 0**, by construction and asserted.

| late-solve accuracy | before | after |
|---|---|---|
| 2×2×2 (random target / easiest target) | 68% / 74% | 93% / 98% |
| 1×2×3 (random / easiest) | 56% / 76% | 83% / 91% |
| 2×2×3 (random) | 64% | 73% |

Visible switches per solve are about the same on 2×2×2 and 1×2×3; on 2×2×3 they
rise 4.1 → 5.9. **That is the open cost of this design.** I expected the extra
switches to be churn between "sibling" 2×2×3s sharing an already-built 2×2×2
(harmless — the coaching barely changes), but only ~0.3 of the extra 1.9 are;
the rest are real re-aims. A threaded variant cuts them to 5.0 but brings back
~7% no-op drift, i.e. the old fault. If 2×2×3 feels jumpy in hand, that's where
to look.

(Table figures come from the exploratory comparison; `placement-accuracy.ts`
with its own seed reproduces them within a few points: 93.5 / 78.3 / 71.8.)

**Things tried and rejected:** three-turn reach (+1–3 points for ~13× the cost);
placed-count first with reach as tiebreak (same accuracy, more switches);
threaded hysteresis on the reach key (fewer switches but 5–8% drift — the old
fault back); the stranded worktree fix (see Stranded work).

**Cost.** Reach uses facelet permutations read off the engine's own cube at load
(1 + 18 + 270 probes in one flat table): 0.35–0.75ms per move; measured 2–5ms per
move including the full re-render on a 1×2×3 step in the dev app. The step-start
anchor is memoized, and `idealLen`'s memo now keys on the mask in use so the first
move doesn't redo the 130ms 2×2×3 search.

**Harness.** `placement-check.ts` rewritten for the new contract: reach agrees
with brute-force engine turning; the pick is the anchor unless strictly
out-reached; no-ops never move it (asserted at every sampled state, placed pieces
or not); a finished block is always the pick. Mutation-tested: dropping the
anchor, the two-turn probes, or reintroducing threaded memory each fail it (129 /
105 / 795 mismatches). Runtime 58s vs 53s before.

**Behaviour change to know about.** Before the first move, the ideal now refers
to the step-start pick (the best-reaching block on the scrambled cube), not
always the canonical placement. Ties still go to the canonical, so on most
scrambles nothing visible changes. Tap-to-aim pins are unaffected. Grading never
depended on the pick — it scores the block you actually finished.

**Not verified:** feel on a real cube. The harnesses prove the pick follows the
simulated solver; whether it follows *Ian's* blockbuilding better needs hands.

## Remaining — TODO

### H2 step 5 — `view/` extraction (deferred; NOT a pure move)
The ~18 `buildXxx()` panel builders in `main.ts` are bound to module-scope
`state`, `render()`, `cube` and dozens of handlers. Extracting them needs a
**state-context refactor first** — lift `state`/`render`/`cube`/the handler set
into a shared module that both `main` and `view/` import. Behaviour-risky (not a
pure move), so left as a deliberate follow-up.

### Low priority (from the audit)
- Match build targets: vite `es2020` vs tsconfig `ES2022` (`vite.config.ts`).
- Enable `noUnusedLocals` / `noUnusedParameters` (auto-catches orphaned imports;
  exclude `src/engine/`).
- Gate the `window.gym` debug hook behind `import.meta.env.DEV`.
- A `noUncheckedIndexedAccess` pass (~84 fixes; worthwhile for index-heavy code).
- `npm audit`: esbuild/vite **dev-server-only** advisory; fix is a Vite major — defer.

### Stranded work — resolved 2026-10-27
The uncommitted placement fix in `.claude/worktrees/hungry-shaw-506939` was
reviewed, measured (drift only ~19% → 10–15%, accuracy slightly worse), superseded
by the reach pick, and the worktree and its branch removed with Ian's OK.

A second worktree, `.claude/worktrees/practical-morse-7ea324`, is clean and on a
detached HEAD at `a7202de`; nothing to rescue there.

### Method / feature roadmap (Ian's, longer-term)
- Roux LSE-EO needs a separate **M/U engine EO axis** (engine EO is F/B only) — the
  main blocker for a real Roux path.
- EOLine / EOCross: the cross/line completion targets the WHITE (model-U) face —
  built on the bottom of the yellow-top solve view (a standard white cross, yellow on
  top). Previously it required the cross on the yellow (D) face, so a white cross with
  EO done was never recognised. Detection (eo-axis.ts), optimal, ideal-target highlight
  (steps.ts canonical masks) and the hold text were all moved to the white face. The
  side AXIS is free: solve R/O or G/B, whichever is easier, and the program reads which
  off the finished cube (detectSolvedEoAxis) — but the cross/line pole is fixed to white
  (Ian's confirmed convention; we do NOT also accept a yellow cross). Guarded by
  `scripts/eo-cross-axis-check.ts` in `npm run check`.
- 2×2×3 + EO (unified APB/Petrus): one EO trainer (`eo223`) replaces the old
  `eo223L`/`eo223B`. Geometry in `src/block-eo.ts`: ONE canonical model target — a
  2×2×3 on WHITE (yellow-top / white-bottom) + the F/B orbit — and a **Method** setting
  (Settings › "2×2×3 + EO · method", default Petrus) that only picks the DISPLAY: APB
  (`x2` view) shows the block bottom-left / F-B moves; Petrus (`x2 y`) shows it
  bottom-back / R-L moves — same solve, notation transposed through the existing
  `disp()`/`toDisplayMoves` path. Each scramble rolls one of 4 whole-cube-`y`
  orientations (a random long-side colour); the app KNOWS the roll, so detection is one
  determined mask (`isBlockEoSolved`, colour-identified) — not "accept any". State:
  `state.blockEoOrient`; module `block-eo.ts` (`blockEoTarget`/`blockEoDisplayRots`/
  `blockEoAxis`); main.ts branches gated by `isBlockEo`. Guarded by
  `scripts/block-eo-check.ts` in `npm run check`.
- **Journey category REMOVED (2026-07-12).** A complete method journey needs
  the algorithmic last layer (CMLL/ZBLL/OCLL+PLL/…), which is explicitly out of
  this app's mission (see CLAUDE.md — not an algorithm trainer) and already
  well served elsewhere. The one distinguishing value it had — practising the
  transition between steps without resetting — is real but better delivered
  later as a feature ON Blocks/EO (chain into the next step without a reset)
  than as a separate, permanently-incomplete category. Cut: the `petrus`
  Journey trainer, the `Journey` category, `STEP_PETRUS_EO`/`MASK_223_EO`,
  `buildJourneyPanel`, and the orphaned `scripts/petrus-eo-check.ts` probe
  (a pre-registry exploration script, never wired into `npm run check`/CI).

---

## Guardrails (also in CLAUDE.md)
- **Don't edit `src/engine/`** (vendored, MPL-2.0) beyond import paths.
- **Grep `scripts/` before deleting any "unused" symbol** — it may be an oracle.
- **Keep every harness at 0 mismatches**; add one when adding a non-trivial algorithm.
- **Don't pipe `tsc` through `head`** (SIGPIPE undercounts errors) — redirect to a file.
- **BLE can't be tested without hardware** — verify cube changes live with the
  in-app event log; don't ship blind BLE changes. A green harness proves the units,
  not the behaviour (see the 2026-08-22 revert). Two specifics learned there:
  **the library already recovers missed GAN moves** from the cube's own history via
  the move serial, so never bridge from a facelet snapshot to do the same job; and
  reconciliation differs per protocol, so it must never be applied globally.
- All `localStorage` access goes through `src/storage.ts`.
