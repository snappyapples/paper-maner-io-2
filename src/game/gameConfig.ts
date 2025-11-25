/**
 * Game Configuration
 * All game parameters are centralized here for easy experimentation.
 */

export const gameConfig = {
  // Arena dimensions (in tiles) - much larger, goes off screen
  arena: {
    widthTiles: 500,
    heightTiles: 500,
  },

  // Tile size in pixels
  tileSize: 4,

  // Viewport (what the player sees)
  viewport: {
    width: 800,
    height: 600,
  },

  // Camera settings
  camera: {
    lerpSpeed: 0.1, // smooth follow (0-1, higher = snappier)
  },

  // Theme colors (tactical terrain map style)
  theme: {
    fog: '#2c3e50', // fog of war color
    mapBg: '#34495e', // map background
    gridColor: 'rgba(44, 62, 80, 0.5)', // subtle grid lines
    borderColor: '#e74c3c', // arena border (danger zone)
    contourColor: 'rgba(255, 255, 255, 0.12)', // topographic contour lines (more visible)
  },

  // Player settings
  player: {
    speed: 150, // pixels per second
    radius: 10, // visual radius in pixels
    color: '#3b82f6', // blue
    borderColor: '#93c5fd', // light blue border
    turnSpeed: 7.2, // radians per second for smooth turning (mouse mode) - 44% faster than original
    keyboardTurnSpeed: Math.PI * 1.44, // ~260 degrees per second when holding arrow keys - 44% faster than original
  },

  // Bot settings (for future phases)
  bot: {
    count: 19,
    baseSpeed: 140,
  },

  // Territory shrink settings (for future phases)
  shrink: {
    campingThreshold: 3, // seconds before shrink starts
    rate: 150, // tiles per second (15x original)
  },

  // Game loop settings
  loop: {
    targetFPS: 60,
    fixedDeltaTime: 1 / 60, // fixed timestep in seconds
  },
} as const;

// Derived values (computed from config)
export const derivedConfig = {
  get arenaWidthPx() {
    return gameConfig.arena.widthTiles * gameConfig.tileSize;
  },
  get arenaHeightPx() {
    return gameConfig.arena.heightTiles * gameConfig.tileSize;
  },
} as const;

// Type exports for use in other modules
export type GameConfig = typeof gameConfig;
