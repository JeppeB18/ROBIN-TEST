# Labradoodle Golf

A top-down web game: guide a black labradoodle around a grassy course to collect golf balls and deliver them to the basket. Complete 10 levels, each with a timer and more obstacles—including annoying enemies that chase you and make you drop balls!

## How to Run Locally

1. **Option A – Simple server (recommended)**  
   From the project folder run:
   ```bash
   npx serve .
   ```
   Then open the URL shown (e.g. `http://localhost:3000`) in your browser.

2. **Option B – Open file**  
   Open `index.html` (landing page) or `game.html` (game) directly. Some features (e.g. manifest) may work better over HTTP, so Option A is preferred.

## How to Play

- **Tap or click** where you want the dog to go. The dog runs toward that point.
- Run over **golf balls** to pick them up and take them to the **basket in the center** to drop them off.
- **10 levels**: each level requires more balls and has less time. Finish all 10 to win.
- **Red enemies** chase the dog; if they catch you, you drop up to 3 balls and are briefly stunned. Avoid them!
- **Trees** (cone-shaped conifers) block movement; go around them.
- If the **timer** hits zero, the level ends—tap to retry.

## Play on Your iPhone

1. Deploy the game to a host (see below) or run `npx serve .` and use your computer’s local IP (e.g. `http://192.168.1.x:3000`) on the same Wi‑Fi.
2. Open the game URL in **Safari** on your iPhone.
3. Tap the **Share** button (square with arrow).
4. Choose **Add to Home Screen**.
5. Name it (e.g. “Labradoodle Golf”) and tap **Add**.

The game will appear on your home screen and open full-screen like an app.

## Deployment

- **GitHub Pages**: Push this folder to a repo, go to Settings → Pages → Source: main branch, save. Your site will be at `https://<username>.github.io/<repo>/`.
- **Netlify**: Drag the project folder into [Netlify Drop](https://app.netlify.com/drop) or connect the repo.
- **Vercel**: Import the repo in [Vercel](https://vercel.com) and deploy.

Use the deployed URL in Safari on your iPhone and then **Add to Home Screen** as above.

## Tech

- HTML5 Canvas, vanilla JavaScript, CSS.
- Touch and mouse input.
- PWA manifest and icon for “Add to Home Screen”.

No build step required.
