# Hop Lane

A small Vite + TypeScript + Three.js road-crossing prototype with blocky toy-like graphics.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run preview
```

This `next` branch builds for `/number_lanes/next/`. Run `npm run dev` and
open the URL printed by Vite to play locally. `npm run deploy` publishes this
build to the `next` directory of the `gh-pages` branch. The main branch's
deployment command replaces the contents of that branch, so a production
deployment may remove the preview until it is deployed again.

## Controls

- `Space`, `Enter` or `Up`: hop forward one lane
- `Down`: hop back one lane
- Number keys: enter an answer; a correct answer is accepted immediately
- `Backspace` / `Escape`: edit or clear the answer
- Optionally enable question swaps in settings to replace a question with another at the same difficulty. Each game starts with one swap and earns another for every four correct answers.

Each safe zone has one question to answer before crossing. The correct-answer total lasts for the browser-tab session, including across game restarts and reloads. Watch for flashing red signs at railway tracks: they warn of a fast approaching train. Collisions cost a life. Wrong answers can be edited and tried again without losing a life.

On canal crossings, hop across stationary lily pads followed by a lane of moving canal boats. Landing in the water or riding off the edge costs a life.

You can answer the next unanswered visible question in advance, including while crossing. Questions can be answered in order for as long as they remain visible.

Sound effects can be turned on or off in settings. Browsers enable audio after the first keyboard or pointer interaction.
