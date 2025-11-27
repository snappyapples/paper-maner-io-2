# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Paper.io-style territory capture game built with Next.js and HTML5 Canvas. Players control a hexagonal icon, draw tails outside their territory, and capture land by returning home. Features 3 difficulty levels, 19 AI bots, mobile swipe controls, and a tactical/terrain map visual theme.

## Commands

```bash
npm run dev     # Start dev server at http://localhost:3000
npm run build   # Build for production
npm run lint    # Run ESLint
```

## Architecture

Client-side only game. All source code in `src/`.

### Core Game Engine (`src/game/`)

- **Game.ts** - Main game loop (60 FPS fixed timestep), input handling (mouse/keyboard/touch), camera, territory capture via flood-fill, collision detection, HUD rendering, difficulty selection
- **Player.ts** - Entity class for human/bots. Position, direction, smooth turning, tail state, hexagonal rendering
- **TerritoryMap.ts** - Tile grid (`Uint8Array`), ownership tracking, cached ImageData rendering with border effects
- **BotAI.ts** - AI with states (expand/harass/retreat/flee/wander), difficulty-based behavior (easy/hard/impossible)
- **gameConfig.ts** - Centralized config: arena 500×500 tiles, 4px tiles, speeds, colors
- **Vec2.ts** - 2D vector utility class (position, direction math)

### React Integration (`src/components/`)

- **GameCanvas.tsx** - React wrapper that mounts the Game instance to a canvas element

### Controls

- **Desktop**: Mouse aims, WASD/Arrows for keyboard steering
- **Mobile**: Swipe to set direction (player continues moving that way)
- Player always moves forward continuously

### Key Mechanics

- 20 players (1 human + 19 bots)
- Kill by crossing enemy tail → inherit their territory
- Self-tail or wall collision = death
- Camping >3s in own territory causes border shrink
- Win at 99.5% map ownership
- Boosts: Every 3 kills grants 5s speed boost; yellow orbs spawn on map for pickup
- UI: Game over screen, How to Play popup, all mobile-responsive

### Difficulty Levels

- **Easy**: Slower bot reactions, lower aggression, basic avoidance
- **Hard**: Fast reactions, bots coordinate to hunt human, perfect tail avoidance
- **Impossible**: 2x bot speed, 2x territory shrink rate, no territory inheritance on kills, 3x boost pickups (75% player-only, cyan colored)

A difficulty badge (HARD/IMPOSSIBLE) displays in the top-left during gameplay.

### Mobile Touch Handling

Touch coordinates must be transformed using `getBoundingClientRect()` to handle canvas scaling:
```typescript
const rect = this.canvas.getBoundingClientRect();
const scaleX = this.canvas.width / rect.width;
const canvasX = (touch.clientX - rect.left) * scaleX;
```

## Deployment

Push to GitHub (`main` branch) triggers automatic Vercel deployment.

- **GitHub**: https://github.com/snappyapples/paper-maner-io-2
- **Live URL**: https://paper-maner-io-2.vercel.app/
