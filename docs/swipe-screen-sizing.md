# Swipe Screen Sizing Reference

This captures the current sizing values used by the swipe card UI in `public/style.css` and `public/js/CardView.js`.

## Requested values

### 1) Poster size

- **Default/mobile card container width:** `325px` (`.card` in mobile override).
- **Default/mobile poster image width:** `80%` of card width (`.card .poster`), so at `325px` card width this renders at **`260px` wide**.
- **Poster aspect ratio:** `2 / 3`, so the image height is **`390px`** when width is `260px`.
- **Desktop expanded details mode:** `.poster-wrapper` is `height: 85vh` with `aspect-ratio: 2 / 3`, and `.card .poster` fills that wrapper (`width: 100%`, `height: 100%`).

### 2) Title and year font size

- On-card overlay title (`.poster-title`): **`2rem`**.
  - The year is part of the same title string (`titleLine` in `CardView.js`), so it uses the same size.
- Expanded details title (`.card-title`):
  - Base/mobile: **`1rem`**.
  - Desktop (`min-width: 769px`): **`2rem`**.

### 3) IMDb/TMDb icon sizes

- Rating logo images (`.rating-logo`, used for IMDb/TMDb icons):
  - Base: **`15px`** height.
  - Mobile override (`max-width: 600px`): **`16px`** height.
  - Desktop override (`min-width: 769px`): **`24px`** height.

### 4) IMDb/TMDb rating font sizes

- Ratings container text (`.card-ratings`, which includes IMDb/TMDb numeric rating text):
  - Base: **`0.95rem`**.
  - Mobile override (`max-width: 600px`): **`1.05rem`**.
  - Desktop override (`min-width: 769px`): **`1.25rem`**.

### 5) Genre font size

- Overlay genres (`.poster-genres`): **`0.95rem`**.

### 6) Spacing below the ratings section

Interpretation depends on where you mean “ratings section”:

- Overlay ratings block (`.card-ratings.compact`) has `margin: 0.25rem 0 0.45rem`.
  - So spacing below ratings to next overlay element is effectively **`0.45rem`** bottom margin.
- Expanded/meta ratings block (`.card-ratings`) on desktop sets `margin-bottom: 0`.
  - So spacing below that block is **`0`** unless inherited from surrounding layout.

### 7) Spacing below plot to visible portion of the movie poster

Two common interpretations:

- **Collapsed card (default swipe state):** plot preview (`.card-plot-preview`) is inside `.poster-overlay` on top of the poster itself, with `margin: 0`.
  - Therefore “below plot to visible poster” spacing is effectively **`0`** (the poster continues directly under the text overlay).
- **Expanded details mode:** poster and plot are in separate columns; there is no vertical “plot-to-poster” spacing.
  - Plot spacing in the metadata column is controlled by `.card-plot` margins (desktop: `margin-top: 1.5rem`, `margin-bottom: 2rem`).

## Source pointers

- `public/style.css`
  - Card/poster sizing, overlay typography, genre, compact ratings spacing, and plot preview.
  - Ratings typography and icon sizes (base/mobile/desktop).
  - Desktop layout and expanded-mode spacing rules.
- `public/js/CardView.js`
  - Year inclusion in title (`titleLine`) and placement of overlay/meta rating and plot elements.
