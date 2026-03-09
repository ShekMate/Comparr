# Desktop Drag-to-Swipe: Exact Code Needed from `comparr_alt`

If desktop swipe is “not even close,” we likely need **the actual implementation blocks**, not high-level notes.

Use this checklist to pull the right code from `comparr_alt`.

## 1) `FrameTinderCard.tsx` (full component)

Please retrieve the **entire file**:

- `comparr_alt/src/components/deck/FrameTinderCard.tsx`

Why full file: swipe behavior usually depends on tightly coupled motion values, drag constraints, thresholds, and animation callbacks.

### Minimum required sections (if you can’t share full file)

- Imports (especially `framer-motion` APIs used).
- Constants for swipe thresholds (`distance`, `velocity`) and off-screen throw distance.
- `motion.div` props:
  - `drag`
  - `dragConstraints`
  - `dragElastic`
  - any `whileDrag` styling
- `onDragEnd` handler including:
  - how direction is determined
  - exact threshold logic (`OR` vs `AND`)
  - accepted velocity units/sign conventions
- Throw animation configuration:
  - spring/tween config
  - final `x` target when swiped left/right
- `onSwipe` and `onCardLeftScreen` callback timings.
- Any imperative API exposed via refs (`swipeLeft/swipeRight`).

---

## 2) `SwipeCard.tsx` (front-card interaction layer)

Please retrieve the **entire file**:

- `comparr_alt/src/components/deck/SwipeCard.tsx`

### Minimum required sections

- The conditional that decides when to render `FrameTinderCard` (front card only vs all cards).
- `cursor-grab` / `cursor-grabbing` handling.
- Pointer/mouse down-up logic used to distinguish click from drag.
- Movement threshold in pixels for click suppression.
- Poster image props including `draggable={false}`.
- Callback wiring from card-level swipe to deck handlers.

---

## 3) `CardDeck.tsx` (stack orchestration + callback contract)

Please retrieve the **entire file**:

- `comparr_alt/src/components/deck/CardDeck.tsx`

### Minimum required sections

- Stack render loop and z-index/scale transforms.
- The exact `onSwipe` / `onCardLeftScreen` handlers and state updates.
- Ref plumbing for programmatic swipes.
- Any guards against duplicate swipe events.

---

## 4) Shared types/contracts used by those files

Please also retrieve any types/interfaces imported by the three files above.

Common examples:

- `SwipeDirection` type (`'left' | 'right'` etc.)
- Card/deck prop interfaces
- Any utility helpers for thresholding, direction, or animation

If imported from other files, include those files too.

---

## 5) Styling dependencies that affect drag UX

Please retrieve any style layers those components rely on:

- Tailwind classes are already in file (usually enough), or
- CSS modules / global CSS selectors tied to drag cursors, `touch-action`, `pointer-events`, etc.

Important: if `touch-action` is set (or missing), it can completely change drag behavior.

---

## 6) Runtime/library versions (critical)

Please share these from `comparr_alt`:

- `framer-motion` version
- `react` version
- `typescript` version (if TS)

Behavior of `onDragEnd` / velocity can differ across major versions.

---

## 7) Optional but very helpful: known-good constants

If you have them, send these values exactly:

- `SWIPE_DISTANCE_THRESHOLD`
- `SWIPE_VELOCITY_THRESHOLD`
- click-vs-drag movement threshold
- off-screen throw distance
- animation duration/spring values

This lets us match desktop feel quickly.

---

## Fastest way to send it

1. Copy the 3 component files in full.
2. Include any imported local type/helper files they require to compile.
3. Include `package.json` dependency versions for React + Framer Motion.

With those, we can reproduce behavior closely instead of guessing.
