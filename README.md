# 🎙️ Podcast Studio Tycoon

A tycoon game where you run a **podcast studio business**. You start with one booth in a garage, rent rooms to podcasters by the session, and grow into a studio empire with locations around the world. It runs in any browser and is designed for the iPhone screen.

## How to play
- **🎙️ Audio Booths** and **🎥 Video Studios** (unlocks at ⭐2) are rented to podcasters by the session.
- **🎛️ Control Rooms** raise the session price of rooms *next to them*, so layout matters.
- **🛋️ Green Rooms** and **☕ Coffee Bars** make clients happier, which builds your ⭐ rating faster.
- **🛎️ Reception** brings in more booking requests. **🎞️ Editing Suites** add post-production money to every session.
- **⭐ Rating:** a higher rating brings more clients and higher prices. Turning clients away (not enough rooms) hurts it. Each star is harder to earn than the last.
- **🧱 Expand:** tap a **＋** tile to lease more floor space.
- **🌍 Grow the empire:** open new studios from the tabs above the map: Downtown Loft → Brooklyn → Hollywood → London → Tokyo. Each needs cash and a minimum rating. Bigger cities pay more, but rent and building costs are higher too.
- Own all 6 studios to win. Don't let cash drop below −$1,000, or you go bankrupt.

Progress saves automatically in the browser. Tap a room to upgrade (up to ★★★) or demolish it.

## Run it
No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

**On iPhone:** open the hosted page in Safari, then tap Share → **Add to Home Screen** to get a full-screen, app-like icon.

## Code layout
- `index.html`: page structure (HUD, city tabs, floor plan, toolbar, bottom sheet)
- `style.css`: mobile-first styling
- `game.js`: all game logic. Balance numbers live in `CONFIG`, `ROOMS`, `LOCATIONS` and `EVENTS` at the top of the file.
