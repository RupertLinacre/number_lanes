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
- `Left` / `Right`: move between the three question columns
- Number keys: type into the live answer display
- `Enter`: submit the current answer
- `Backspace` / `Escape`: edit or clear the live answer

Yellow safe lanes show three maths problems. From your current safe lane, use the arrow keys to target one of the questions on the next safe lane; the highlighted target is the one you need to answer. A correct answer turns that next lane green and lets you cross. The maths difficulty maps to the road run before that safe lane: one road lane is Year 1, two lanes is Year 2, three lanes is Year 3, and four lanes is Year 4.

Avoid the sideways-moving cars. A collision or a wrong answer resets the round, including all unlocked lanes, and the score tracks the furthest lane reached.
