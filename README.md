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

## Controls

- `Space`: hop forward one lane
- Type answers into the maths panel and press `Enter` or `OK`

Yellow safe lanes show three maths problems. Solve all three to turn the lane green, then hop across the next set of road lanes. The maths difficulty maps to the road run ahead: one road lane is Year 1, two lanes is Year 2, three lanes is Year 3, and four lanes is Year 4.

Avoid the sideways-moving cars. A collision resets the player to the start, and the score tracks the furthest lane reached.
