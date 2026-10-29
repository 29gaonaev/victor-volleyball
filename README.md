# Victor Volleyball

A browser-based, three-dimensional volleyball prototype built with Three.js and Vite. The court, ball, uniforms, and arena are generated in code, so the game does not depend on remote image or audio assets.

## Play online

Visit [Victor Volleyball on GitHub Pages](https://29gaonaev.github.io/victor-volleyball/).

## Run locally

Install Node.js 18 or newer, then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To create and preview a production build:

```sh
npm run build
npm run preview
```

## Controls

| Key | Action |
| --- | --- |
| W / A / S / D or arrow keys | Move |
| Shift | Sprint |
| Space | Serve, jump, or spike |
| E | Set or hit |
| Q | Dive for a defensive save |
| C | Toggle the elevated camera |
| Double-click | Toggle fullscreen |

Matches are first to 15 points, win by two. Choose Rookie, Pro, or Ace opponent difficulty before starting; the setting adjusts the AI's movement, reactions, defensive reach, shot placement, and serving and attacking speed. Rally time, touches, score, and the next serve are shown in the HUD. Sound effects and a softly synthesized arena ambience start after the first user interaction.

## Implementation notes

- Three-player teams use generated mesh characters, smoothed movement, jumping, and basic rally animations.
- AI defenders reposition to cover the ball's projected landing area; the opposing side can serve, receive, set, attack, and block.
- Ball motion applies gravity, drag, spin, net deflection, player contact, and a short physical ground bounce before each point is called.
- Sand grain and ball seams use procedural canvas textures; no private APIs or credentials are required.
- A public Three.js import map also supports directly serving the project files. The recommended Vite workflow resolves Three.js from the local npm dependency.
