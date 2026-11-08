# 🎙️ Podcast Tycoon

A SimCity-style tycoon game where you build a podcast empire. It runs in any browser and is designed for the iPhone screen.

## How to play
- **🎙️ Studios** produce shows that attract listeners. Each studio has a genre.
- **🏢 Apartments** house staff. Buildings without enough staff run slower.
- **🖥️ Servers** raise your listener capacity. When you hit the cap, growth stops.
- **🎚️ Editing, ☕ Cafés and 🌳 Parks** boost the quality of studios *next to them*, so layout matters.
- **💼 Ad Sales** raise revenue per listener. **📣 Billboards** raise growth everywhere.
- **🔥 Trends:** shows in the trending genre grow 2× faster. The trend changes every 30 days, and you can rebrand a studio to chase it.
- Tap any building to **upgrade** (up to ★★★), **rebrand** or **demolish** it.
- Hit listener milestones for cash bonuses. Reach **1,000,000 listeners** to become a Podcast Mogul.
- Don't let your cash drop below −$1,000, or you go bankrupt.

Progress saves automatically in the browser.

## Run it
No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

**On iPhone:** open the hosted page in Safari, then tap Share → **Add to Home Screen** to get a full-screen, app-like icon.

## Code layout
- `index.html`: page structure (HUD, map, toolbar, bottom sheet)
- `style.css`: mobile-first styling
- `game.js`: all game logic. Balance numbers live in `CONFIG`, `BUILDINGS`, `MILESTONES` and `EVENTS` at the top of the file.
