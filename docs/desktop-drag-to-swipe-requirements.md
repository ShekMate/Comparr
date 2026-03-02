# Desktop Drag-to-Swipe Requirements Checklist

This checklist captures what is needed to implement desktop drag-to-swipe for movie posters.

## What already makes sense

The proposed split is solid and maps cleanly to responsibilities:

1. `FrameTinderCard.tsx`
   - Owns drag physics, swipe thresholds, throw animation, and card-leaves-screen timing.
2. `SwipeCard.tsx`
   - Owns poster-level interactivity (`cursor-grab`, click-vs-drag guard, `draggable={false}`).
3. `CardDeck.tsx`
   - Owns stack orchestration and ref-driven programmatic swipes.

## Additional details required before implementation

To avoid edge-case regressions, confirm the following:

- Threshold values:
  - Horizontal distance threshold in pixels.
  - Velocity threshold.
  - Whether either threshold can trigger swipe (`OR`) or both are required (`AND`).
- Axis policy:
  - Lock to horizontal drag or allow slight vertical movement.
- Desktop-only behavior:
  - Should drag-to-swipe be enabled only above a breakpoint?
  - If yes, what breakpoint should be used?
- Click handling:
  - Exact movement threshold that converts click to drag.
  - Whether keyboard activation should still open details on focused poster.
- Programmatic swipe parity:
  - Should ref-triggered swipes use the exact same thresholds/animation durations?
- Animation tuning:
  - Throw spring/tween config and off-screen distance.
- Accessibility expectations:
  - Keyboard alternatives for left/right swipe actions.
  - ARIA/state announcements when a card is accepted/rejected.
- QA matrix:
  - Browsers to support (Chrome/Safari/Firefox/Edge).
  - Whether touch behavior must remain unchanged.

## Suggested acceptance criteria

- Dragging a front poster left/right with mouse triggers swipe reliably.
- Fast flick swipes work even with shorter distance.
- Clicking (without meaningful movement) still opens poster details.
- Native image ghost-drag never appears.
- Programmatic left/right swipes behave the same as gesture swipes.
- Existing mobile/touch swipe behavior remains intact.
