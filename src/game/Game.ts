import { Player } from './Player';
import { TerritoryMap } from './TerritoryMap';
import { Vec2 } from './Vec2';
import { BotAI, Difficulty } from './BotAI';
import { gameConfig, derivedConfig } from './gameConfig';

/**
 * Main Game class - handles game loop, rendering, and input
 * Player ALWAYS moves forward; mouse/arrow keys/touch swipe steer direction
 * v1.1 - Mobile optimization with swipe controls
 */
export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: Player;
  private territoryMap: TerritoryMap;

  // Bots
  private bots: BotAI[] = [];
  private allPlayers: Player[] = [];

  // Track territory state per player (was in own territory last frame)
  private wasInOwnTerritory: Map<number, boolean> = new Map();

  // Async capture queue - process captures without blocking movement
  private captureQueue: { player: Player; tail: Vec2[] }[] = [];
  private isProcessingCapture: boolean = false;
  private maxCaptureTimePerFrame: number = 4; // ms budget per frame for captures

  // Viewport dimensions (updated on resize)
  private viewportWidth: number = 0;
  private viewportHeight: number = 0;

  // Camera position (top-left corner of viewport in world coords)
  private cameraX: number = 0;
  private cameraY: number = 0;

  // Mouse position in WORLD coordinates
  private mouseWorldX: number = 0;
  private mouseWorldY: number = 0;

  // Input state
  private keys: Set<string> = new Set();
  private useMouseSteering: boolean = true; // Toggle between mouse and keyboard
  private useTouchSteering: boolean = false; // Touch/swipe input mode

  // Touch state for swipe detection
  private touchStartX: number = 0;
  private touchStartY: number = 0;

  // Mobile detection and HUD scaling
  private isMobile: boolean = false;
  private hudScale: number = 1.0;

  // Game loop
  private lastTime: number = 0;
  private accumulator: number = 0;
  private running: boolean = false;
  private animationFrameId: number | null = null;

  // Bound handlers for cleanup
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundResize: () => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;

  // Camping mechanic state (per player)
  private campingTimers: Map<number, number> = new Map(); // playerId -> camping time
  private shrinkAccumulators: Map<number, number> = new Map(); // playerId -> shrink accumulator

  // Game state
  private gameOver: boolean = false;
  private isVictory: boolean = false;
  private gameStartTime: number = 0;
  private gameEndTime: number = 0;
  private maxTerritoryPercent: number = 0; // Track highest territory for defeat screen
  private difficulty: Difficulty = 'easy'; // Current difficulty level

  // Win condition threshold (99.5% to avoid tiny unreachable pockets)
  private readonly winThreshold: number = 99.5;

  // Power-up state (every 3rd kill) - per player
  private boostEndTimes: Map<number, number> = new Map(); // playerId -> boost end time
  private readonly boostDuration: number = 5000; // 5 seconds
  private readonly boostSpeedMultiplier: number = 1.5; // 50% faster

  // Boost pickup items on the map
  private boostPickups: { x: number; y: number; spawnTime: number; playerOnly: boolean }[] = [];
  private readonly boostPickupRadius: number = 15; // collision radius
  private readonly boostPickupSpawnInterval: number = 8000; // spawn new one every 8 seconds
  private readonly maxBoostPickups: number = 5; // max on map at once (3x in impossible mode)
  private lastBoostPickupSpawn: number = 0;

  // How to Play popup state
  private showHowToPlay: boolean = false;
  private howToPlayButton: { x: number; y: number; w: number; h: number } | null = null;
  private closeHowToPlayButton: { x: number; y: number; w: number; h: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    // Set canvas to fill the window
    this.resizeCanvas();

    // Create territory map
    this.territoryMap = new TerritoryMap();

    // Create player at center of arena
    this.player = new Player({
      id: 1,
      isBot: false,
      startX: derivedConfig.arenaWidthPx / 2,
      startY: derivedConfig.arenaHeightPx / 2,
      color: gameConfig.player.color,
    });

    // Generate starting territory for player
    this.territoryMap.generateStartingTerritory(
      this.player.pos.x,
      this.player.pos.y,
      1, // Player ID
      12 // Starting radius in tiles
    );

    // Initialize territory tracking for human player
    this.wasInOwnTerritory.set(1, true);
    this.allPlayers.push(this.player);

    // Create bots - use count from config (19 for full game)
    this.createBots(gameConfig.bot.count);

    // Give bots awareness of all players
    this.updateBotPlayerReferences();

    // Initialize camera centered on player
    this.updateCamera(1); // Snap immediately

    // Bind handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundResize = this.resizeCanvas.bind(this);
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    // Detect mobile and set HUD scale
    this.updateMobileState();

    this.setupInputHandlers();
  }

  /**
   * Create bot players with random placement for unpredictable spawns
   * Some may cluster near you, others may be far away
   */
  private createBots(count: number): void {
    const botColors = [
      '#22c55e', // green
      '#f59e0b', // orange
      '#ec4899', // pink
      '#8b5cf6', // purple
      '#14b8a6', // teal
      '#f43f5e', // rose
      '#06b6d4', // cyan
      '#84cc16', // lime
      '#eab308', // yellow
      '#ef4444', // red
      '#a855f7', // violet
      '#0ea5e9', // sky blue
      '#10b981', // emerald
      '#f97316', // orange-bright
      '#d946ef', // fuchsia
      '#6366f1', // indigo
      '#fb7185', // pink-light
      '#2dd4bf', // teal-light
      '#a3e635', // lime-bright
    ];

    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;
    const margin = 120;

    // Human player position (center)
    const humanX = arenaW / 2;
    const humanY = arenaH / 2;

    // Minimum distance between any two spawn points (prevents overlap)
    const minSpacing = 80;

    // Track all spawn positions
    const spawnPositions: { x: number; y: number }[] = [{ x: humanX, y: humanY }];

    for (let i = 0; i < count; i++) {
      const botId = i + 2;

      // Try to find a valid random position
      let startX: number = 0;
      let startY: number = 0;
      let validPosition = false;
      let attempts = 0;
      const maxAttempts = 50;

      while (!validPosition && attempts < maxAttempts) {
        // Fully random position within arena bounds
        startX = margin + Math.random() * (arenaW - margin * 2);
        startY = margin + Math.random() * (arenaH - margin * 2);

        // Check minimum spacing from all existing spawns
        validPosition = true;
        for (const pos of spawnPositions) {
          const dist = Math.sqrt(Math.pow(startX - pos.x, 2) + Math.pow(startY - pos.y, 2));
          if (dist < minSpacing) {
            validPosition = false;
            break;
          }
        }
        attempts++;
      }

      // If couldn't find valid position, just use the last attempted position
      spawnPositions.push({ x: startX, y: startY });

      const botPlayer = new Player({
        id: botId,
        isBot: true,
        startX,
        startY,
        color: botColors[i % botColors.length],
      });

      // Generate starting territory for bot (slightly smaller than player)
      this.territoryMap.generateStartingTerritory(startX, startY, botId, 8);

      // Create bot AI with current difficulty
      const botAI = new BotAI(botPlayer, this.territoryMap, this.difficulty);
      this.bots.push(botAI);
      this.allPlayers.push(botPlayer);
      this.wasInOwnTerritory.set(botId, true);
    }
  }

  /**
   * Update bot references to all players (for AI awareness)
   */
  private updateBotPlayerReferences(): void {
    for (const bot of this.bots) {
      bot.setAllPlayers(this.allPlayers);
    }
  }

  /**
   * Resize canvas to fill the window
   */
  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    this.updateMobileState();
  }

  /**
   * Detect mobile device and set HUD scale accordingly
   */
  private updateMobileState(): void {
    this.isMobile = this.viewportWidth < 768 || 'ontouchstart' in window;
    this.hudScale = this.isMobile ? 0.6 : 1.0;
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.key);

    // Handle game over restart
    if (this.gameOver && (e.key === ' ' || e.key === 'Enter')) {
      this.restartGame();
      return;
    }

    // Switch to keyboard steering when arrow keys pressed
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
      this.useMouseSteering = false;
    }

    // Prevent arrow keys from scrolling the page
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  }

  /**
   * Handle keyup events
   */
  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key);
  }

  /**
   * Handle touch start for swipe controls
   */
  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();

    const touch = e.touches[0];
    // Transform touch coordinates to canvas coordinates (handles scaling)
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const canvasX = (touch.clientX - rect.left) * scaleX;
    const canvasY = (touch.clientY - rect.top) * scaleY;

    // Handle game over restart with tap (check for button clicks)
    if (this.gameOver) {
      this.handleGameOverClick(canvasX, canvasY);
      return;
    }

    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.useTouchSteering = true;
    this.useMouseSteering = false;
  }

  /**
   * Handle click/tap on game over screen - check for difficulty button clicks
   */
  private handleGameOverClick(clickX: number, clickY: number): void {
    // Check if How to Play popup is open
    if (this.showHowToPlay) {
      // Check close button
      if (this.closeHowToPlayButton &&
          clickX >= this.closeHowToPlayButton.x && clickX <= this.closeHowToPlayButton.x + this.closeHowToPlayButton.w &&
          clickY >= this.closeHowToPlayButton.y && clickY <= this.closeHowToPlayButton.y + this.closeHowToPlayButton.h) {
        this.showHowToPlay = false;
        return;
      }
      // Click anywhere else closes popup too
      this.showHowToPlay = false;
      return;
    }

    // Check How to Play button
    if (this.howToPlayButton &&
        clickX >= this.howToPlayButton.x && clickX <= this.howToPlayButton.x + this.howToPlayButton.w &&
        clickY >= this.howToPlayButton.y && clickY <= this.howToPlayButton.y + this.howToPlayButton.h) {
      this.showHowToPlay = true;
      return;
    }

    // Check if an other games link was clicked
    for (const link of this.otherGamesLinks) {
      if (clickX >= link.x && clickX <= link.x + link.w &&
          clickY >= link.y && clickY <= link.y + link.h) {
        window.open(link.url, '_blank');
        return;
      }
    }

    // Check if a difficulty button was clicked
    console.log('[DEBUG] handleGameOverClick:', {
      clickX, clickY,
      viewportW: this.viewportWidth, viewportH: this.viewportHeight,
      canvasW: this.canvas.width, canvasH: this.canvas.height,
      isMobile: this.isMobile,
      buttons: this.difficultyButtons.map(b => ({ ...b }))
    });
    for (const btn of this.difficultyButtons) {
      if (clickX >= btn.x && clickX <= btn.x + btn.w &&
          clickY >= btn.y && clickY <= btn.y + btn.h) {
        console.log('[DEBUG] Difficulty button clicked:', btn.difficulty);
        this.difficulty = btn.difficulty;
        this.restartGame();
        return;
      }
    }

    // If no button was clicked, still restart with current difficulty
    console.log('[DEBUG] No button hit, restarting with current difficulty:', this.difficulty);
    this.restartGame();
  }

  /**
   * Handle touch move for swipe-to-set-direction
   */
  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (!this.useTouchSteering) return;

    const touch = e.touches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;

    // Minimum swipe distance threshold
    const minDistance = 20;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > minDistance) {
      // Set player direction based on swipe angle
      const angle = Math.atan2(dy, dx);
      this.player.targetAngle = angle;

      // Update start point for continuous swiping
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    }
  }

  /**
   * Handle touch end
   */
  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    // Player keeps moving in last set direction (no action needed)
  }

  /**
   * Set up mouse and keyboard event handlers
   */
  private setupInputHandlers(): void {
    // Mouse move - convert screen coords to world coords
    this.canvas.addEventListener('mousemove', (e) => {
      // Screen position is directly the mouse position (canvas fills window)
      const screenX = e.clientX;
      const screenY = e.clientY;

      // Convert to world position
      this.mouseWorldX = screenX + this.cameraX;
      this.mouseWorldY = screenY + this.cameraY;

      // Switch to mouse steering when mouse moves
      this.useMouseSteering = true;
    });

    // Click handler for game over restart (with difficulty selection)
    this.canvas.addEventListener('click', (e) => {
      if (this.gameOver) {
        const clickX = e.clientX;
        const clickY = e.clientY;
        this.handleGameOverClick(clickX, clickY);
      }
    });

    // Keyboard events
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);

    // Touch events for mobile swipe controls
    this.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });

    // Window resize
    window.addEventListener('resize', this.boundResize);
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.gameStartTime = performance.now();
    this.gameLoop(this.lastTime);
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Restart the game with a fresh state
   */
  restartGame(): void {
    // Reset game state
    this.gameOver = false;
    this.isVictory = false;
    this.gameStartTime = performance.now();
    this.gameEndTime = 0;

    // Reset camping state for all players
    this.campingTimers.clear();
    this.shrinkAccumulators.clear();

    // Clear territory map completely
    this.territoryMap = new TerritoryMap();

    // Reset human player
    this.player.pos.set(derivedConfig.arenaWidthPx / 2, derivedConfig.arenaHeightPx / 2);
    this.player.alive = true;
    this.player.tail = [];
    this.player.isDrawingTail = false;
    this.player.lastTailPoint = null;
    this.player.kills = 0;
    this.player.angle = 0;
    this.player.targetAngle = 0;
    this.player.dir.set(1, 0);

    // Generate player territory
    this.territoryMap.generateStartingTerritory(
      this.player.pos.x, this.player.pos.y, 1, 12
    );
    this.wasInOwnTerritory.set(1, true);

    // Reset and regenerate all bots
    this.bots = [];
    this.allPlayers = [this.player];
    console.log('[DEBUG] restartGame - creating bots with difficulty:', this.difficulty);
    this.createBots(gameConfig.bot.count);

    // Give bots awareness of all players
    this.updateBotPlayerReferences();

    // Clear effects
    this.killEffects = [];
    this.captureQueue = [];

    // Reset boost state
    this.boostEndTimes.clear();
    this.boostNotifications = [];
    this.boostPickups = [];
    this.lastBoostPickupSpawn = 0;
    this.maxTerritoryPercent = 0;

    // Reset camera
    this.updateCamera(1);

    console.log('[DEBUG] Game restarted with difficulty:', this.difficulty);
  }

  /**
   * Main game loop using fixed timestep
   */
  private gameLoop = (currentTime: number): void => {
    if (!this.running) return;

    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    const cappedDelta = Math.min(deltaTime, 0.1);
    this.accumulator += cappedDelta;

    const fixedDt = gameConfig.loop.fixedDeltaTime;

    while (this.accumulator >= fixedDt) {
      this.update(fixedDt);
      this.accumulator -= fixedDt;
    }

    this.render();

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Process input and determine target direction
   */
  private processInput(dt: number): void {
    if (this.useMouseSteering) {
      // Steer toward mouse position
      this.player.setTargetDirectionToward(this.mouseWorldX, this.mouseWorldY);
    } else {
      // Steer with arrow keys / WASD - smooth turning at controlled rate
      const turnSpeed = gameConfig.player.keyboardTurnSpeed; // radians per second
      const turnAmount = turnSpeed * dt;

      if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) {
        // Turn left (counter-clockwise)
        this.player.adjustTargetAngle(-turnAmount);
      }
      if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) {
        // Turn right (clockwise)
        this.player.adjustTargetAngle(turnAmount);
      }
      // Up/Down could be used for speed boost later, or ignored for now
    }
  }

  /**
   * Update camera to follow player
   */
  private updateCamera(lerpFactor?: number): void {
    const lerp = lerpFactor ?? gameConfig.camera.lerpSpeed;
    const arenaWidth = derivedConfig.arenaWidthPx;
    const arenaHeight = derivedConfig.arenaHeightPx;

    // Target camera position (centered on player)
    let targetX = this.player.pos.x - this.viewportWidth / 2;
    let targetY = this.player.pos.y - this.viewportHeight / 2;

    // If arena fits in viewport, center it instead of following player
    if (arenaWidth <= this.viewportWidth) {
      targetX = -(this.viewportWidth - arenaWidth) / 2;
    } else {
      // Clamp to arena bounds
      targetX = Math.max(0, Math.min(arenaWidth - this.viewportWidth, targetX));
    }

    if (arenaHeight <= this.viewportHeight) {
      targetY = -(this.viewportHeight - arenaHeight) / 2;
    } else {
      // Clamp to arena bounds
      targetY = Math.max(0, Math.min(arenaHeight - this.viewportHeight, targetY));
    }

    // Smoothly interpolate camera
    this.cameraX += (targetX - this.cameraX) * lerp;
    this.cameraY += (targetY - this.cameraY) * lerp;
  }

  /**
   * Update game state (called at fixed timestep)
   */
  private update(dt: number): void {
    // Track max territory for defeat screen
    const currentTerritory = this.territoryMap.getOwnershipPercentage(1);
    if (currentTerritory > this.maxTerritoryPercent) {
      this.maxTerritoryPercent = currentTerritory;
    }

    // Update boost state
    this.updateBoost();

    // Update human player FIRST (highest priority - never skip)
    this.processInput(dt);

    // Apply speed boost if active (human)
    const originalHumanSpeed = this.player.speed;
    if (this.isPlayerBoosted(1)) {
      this.player.speed = gameConfig.player.speed * this.boostSpeedMultiplier;
    }

    this.player.update(dt);

    // Restore original speed after update
    this.player.speed = originalHumanSpeed;

    // Update all bots
    for (const bot of this.bots) {
      if (bot.player.alive) {
        bot.update(dt);

        // Apply speed boost if bot has it, and 2x speed in impossible mode
        const originalBotSpeed = bot.player.speed;
        let baseSpeed = gameConfig.bot.baseSpeed;
        if (this.difficulty === 'impossible') {
          baseSpeed *= 2; // Bots are 2x faster in impossible mode
        }
        if (this.isPlayerBoosted(bot.player.id)) {
          bot.player.speed = baseSpeed * this.boostSpeedMultiplier;
        } else {
          bot.player.speed = baseSpeed;
        }

        bot.player.update(dt);

        // Restore original speed
        bot.player.speed = originalBotSpeed;
      }
    }

    // Check wall collisions for all players
    this.checkWallCollisions();

    // Handle tail mechanics for all players
    for (const player of this.allPlayers) {
      if (player.alive) {
        this.updateTailMechanicsForPlayer(player);
      }
    }

    // Check for collisions between players and other players' tails
    this.checkAllTailCollisions();

    // Update boost pickups (spawn new ones and check collisions)
    this.updateBoostPickups();

    // Process queued captures with time budget (async-style)
    this.processQueuedCaptures();

    // Auto-capture orphaned neutral tiles surrounded by player territory
    this.captureOrphanedTiles();

    // Update camping timer and territory shrink for human player
    this.updateCampingMechanic(dt);

    // Check win/loss conditions
    this.checkGameEndConditions();

    this.updateCamera();
  }

  /**
   * Update boost pickups - spawn new ones and check for player collisions
   */
  private updateBoostPickups(): void {
    const now = performance.now();

    // In impossible mode, 3x the max pickups
    const maxPickups = this.difficulty === 'impossible' ? this.maxBoostPickups * 3 : this.maxBoostPickups;

    // Spawn new boost pickup periodically
    if (this.boostPickups.length < maxPickups &&
        now - this.lastBoostPickupSpawn > this.boostPickupSpawnInterval) {
      this.spawnBoostPickup();
      this.lastBoostPickupSpawn = now;
    }

    // Check collisions with all players
    for (const player of this.allPlayers) {
      if (!player.alive) continue;

      for (let i = this.boostPickups.length - 1; i >= 0; i--) {
        const pickup = this.boostPickups[i];

        // Player-only pickups can only be collected by human player
        if (pickup.playerOnly && player.id !== 1) continue;

        const dx = player.pos.x - pickup.x;
        const dy = player.pos.y - pickup.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.boostPickupRadius + gameConfig.player.radius) {
          // Player collected the boost!
          this.boostPickups.splice(i, 1);
          this.activateBoost(player.id);
          if (player.id === 1) {
            console.log('You collected a boost pickup!');
          }
        }
      }
    }
  }

  /**
   * Spawn a new boost pickup at a random location
   */
  private spawnBoostPickup(): void {
    const margin = 100;
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;

    // In impossible mode, 75% of pickups are player-only
    const playerOnly = this.difficulty === 'impossible' && Math.random() < 0.75;

    // Find a random location not too close to existing pickups or players
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      const x = margin + Math.random() * (arenaW - margin * 2);
      const y = margin + Math.random() * (arenaH - margin * 2);

      // Check distance from players
      let tooClose = false;
      for (const player of this.allPlayers) {
        if (!player.alive) continue;
        const dx = player.pos.x - x;
        const dy = player.pos.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 150) {
          tooClose = true;
          break;
        }
      }

      // Check distance from other pickups
      if (!tooClose) {
        for (const pickup of this.boostPickups) {
          const dx = pickup.x - x;
          const dy = pickup.y - y;
          if (Math.sqrt(dx * dx + dy * dy) < 100) {
            tooClose = true;
            break;
          }
        }
      }

      if (!tooClose) {
        this.boostPickups.push({ x, y, spawnTime: performance.now(), playerOnly });
        return;
      }

      attempts++;
    }

    // Fallback - just spawn it anyway
    const x = margin + Math.random() * (arenaW - margin * 2);
    const y = margin + Math.random() * (arenaH - margin * 2);
    this.boostPickups.push({ x, y, spawnTime: performance.now(), playerOnly });
  }

  /**
   * Update boost power-up state for all players
   */
  private updateBoost(): void {
    const now = performance.now();
    for (const [playerId, endTime] of this.boostEndTimes) {
      if (now > endTime) {
        this.boostEndTimes.delete(playerId);
        if (playerId === 1) {
          console.log('Your boost ended!');
        }
      }
    }
  }

  /**
   * Check if a player has boost active
   */
  private isPlayerBoosted(playerId: number): boolean {
    const endTime = this.boostEndTimes.get(playerId);
    return endTime !== undefined && performance.now() < endTime;
  }

  /**
   * Get remaining boost time for a player (in ms)
   */
  private getBoostTimeRemaining(playerId: number): number {
    const endTime = this.boostEndTimes.get(playerId);
    if (!endTime) return 0;
    return Math.max(0, endTime - performance.now());
  }

  /**
   * Activate the boost power-up for a player (called on every 3rd kill)
   */
  private activateBoost(playerId: number): void {
    this.boostEndTimes.set(playerId, performance.now() + this.boostDuration);
    // Add visual notification
    this.boostNotifications.push({ playerId, time: performance.now() });
    if (playerId === 1) {
      console.log('BOOST ACTIVATED! 3 seconds of speed + immunity!');
    } else {
      console.log(`Bot ${playerId} activated boost!`);
    }
  }

  /**
   * Check if the game has ended (victory or defeat)
   */
  private checkGameEndConditions(): void {
    if (this.gameOver) return;

    // Check for defeat - human player died
    if (!this.player.alive) {
      this.gameOver = true;
      this.isVictory = false;
      this.gameEndTime = performance.now();
      console.log('GAME OVER - You were eliminated!');
      return;
    }

    // Check for victory - ALL enemies must be eliminated AND own significant territory
    const aliveBots = this.bots.filter(b => b.player.alive).length;
    const playerPercent = this.territoryMap.getOwnershipPercentage(1);

    if (aliveBots === 0) {
      // All enemies eliminated - victory!
      this.gameOver = true;
      this.isVictory = true;
      this.gameEndTime = performance.now();
      console.log(`VICTORY! All enemies eliminated! Territory: ${playerPercent.toFixed(1)}%`);
    }
  }

  /**
   * Track camping time and shrink territory if player stays inside too long
   * Applies to all players, timer gradually decreases when outside territory
   */
  private updateCampingMechanic(dt: number): void {
    for (const player of this.allPlayers) {
      if (!player.alive) {
        this.campingTimers.set(player.id, 0);
        this.shrinkAccumulators.set(player.id, 0);
        continue;
      }

      const playerId = player.id;
      let campingTime = this.campingTimers.get(playerId) || 0;
      let shrinkAccum = this.shrinkAccumulators.get(playerId) || 0;

      // Check if player is inside their own territory with no tail
      const currentTile = this.territoryMap.worldToTile(player.pos.x, player.pos.y);
      const isInOwnTerritory = this.territoryMap.getOwner(currentTile.x, currentTile.y) === playerId;
      const hasTail = player.tail.length > 0;

      if (isInOwnTerritory && !hasTail) {
        // Player is camping - increment timer
        campingTime += dt;

        // Start shrinking after threshold
        if (campingTime > gameConfig.shrink.campingThreshold) {
          shrinkAccum += dt;

          // Calculate tiles to remove this frame (2x faster in impossible mode)
          const shrinkRate = this.difficulty === 'impossible'
            ? gameConfig.shrink.rate * 2
            : gameConfig.shrink.rate;
          const tilesToRemove = Math.floor(shrinkAccum * shrinkRate);
          if (tilesToRemove > 0) {
            shrinkAccum -= tilesToRemove / shrinkRate;
            this.shrinkTerritory(playerId, tilesToRemove);
          }
        }
      } else {
        // Player left territory or is drawing tail - gradually decrease timer
        // Decrease at the same rate it increases
        campingTime = Math.max(0, campingTime - dt);

        // Reset shrink accumulator when not camping
        if (campingTime <= gameConfig.shrink.campingThreshold) {
          shrinkAccum = 0;
        }
      }

      this.campingTimers.set(playerId, campingTime);
      this.shrinkAccumulators.set(playerId, shrinkAccum);
    }
  }

  /**
   * Check if a player is currently shrinking (for HUD display)
   */
  private isPlayerShrinking(playerId: number): boolean {
    const campingTime = this.campingTimers.get(playerId) || 0;
    return campingTime > gameConfig.shrink.campingThreshold;
  }

  /**
   * Get camping time for a player (for HUD display)
   */
  private getPlayerCampingTime(playerId: number): number {
    return this.campingTimers.get(playerId) || 0;
  }

  /**
   * Remove border tiles from a player's territory
   */
  private shrinkTerritory(playerId: number, tilesToRemove: number): void {
    const borderTiles = this.territoryMap.getBorderTiles(playerId);
    if (borderTiles.length === 0) return;

    // Find the player to avoid removing tile under them
    const player = this.allPlayers.find(p => p.id === playerId);
    let playerTile = { x: -1, y: -1 };
    if (player) {
      playerTile = this.territoryMap.worldToTile(player.pos.x, player.pos.y);
    }

    // Shuffle border tiles for random shrinking
    for (let i = borderTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [borderTiles[i], borderTiles[j]] = [borderTiles[j], borderTiles[i]];
    }

    // Remove tiles (but not the one under the player)
    let removed = 0;
    for (const tile of borderTiles) {
      if (removed >= tilesToRemove) break;
      if (tile.x === playerTile.x && tile.y === playerTile.y) continue;
      this.territoryMap.setOwner(tile.x, tile.y, 0);
      removed++;
    }
  }

  /**
   * Queue a territory capture for async processing
   */
  private queueCapture(player: Player): void {
    // Clone the tail since it will be cleared
    const tailCopy = player.tail.map(p => p.clone());
    this.captureQueue.push({ player, tail: tailCopy });
  }

  /**
   * Process queued captures with a time budget to avoid frame drops
   */
  private processQueuedCaptures(): void {
    if (this.captureQueue.length === 0) return;

    const startTime = performance.now();

    // Process captures until time budget exhausted or queue empty
    while (this.captureQueue.length > 0) {
      const elapsed = performance.now() - startTime;
      if (elapsed > this.maxCaptureTimePerFrame) {
        // Time budget exhausted, continue next frame
        break;
      }

      const capture = this.captureQueue.shift()!;
      this.captureTerritoryFromTail(capture.player, capture.tail);
    }
  }

  // Counter to throttle orphaned tile check (expensive operation)
  private orphanCheckCounter: number = 0;

  /**
   * Capture any neutral tiles that are completely surrounded by player territory
   * This prevents small unreachable patches from blocking 100% completion
   */
  private captureOrphanedTiles(): void {
    // Only check periodically - this is expensive (less frequent on mobile)
    this.orphanCheckCounter++;
    const checkInterval = this.isMobile ? 360 : 180; // 6 seconds on mobile, 3 on desktop
    if (this.orphanCheckCounter < checkInterval) return;
    this.orphanCheckCounter = 0;

    // Only run if player has significant territory (optimization)
    const playerPercent = this.territoryMap.getOwnershipPercentage(1);
    if (playerPercent < 10) return; // Don't bother if player has little territory

    const playerOwnerId = 1;
    const width = this.territoryMap.widthTiles;
    const height = this.territoryMap.heightTiles;

    // Helper to check if a tile is player-owned or out of bounds (edges count as "owned" for enclosure)
    const isPlayerOrEdge = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return true; // Edge counts as enclosed
      return this.territoryMap.getOwner(x, y) === playerOwnerId;
    };

    // Find neutral tiles that are completely surrounded by player territory or arena edge
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.territoryMap.getOwner(x, y) === 0) {
          // Check all 4 neighbors (edges count as "player" for enclosure purposes)
          if (isPlayerOrEdge(x, y - 1) && isPlayerOrEdge(x, y + 1) &&
              isPlayerOrEdge(x - 1, y) && isPlayerOrEdge(x + 1, y)) {
            this.territoryMap.setOwner(x, y, playerOwnerId);
          }
        }
      }
    }
  }

  /**
   * Handle tail drawing and capture logic for a specific player
   */
  private updateTailMechanicsForPlayer(player: Player): void {
    const playerId = player.id;
    const currentTile = this.territoryMap.worldToTile(player.pos.x, player.pos.y);
    const isInOwnTerritory = this.territoryMap.getOwner(currentTile.x, currentTile.y) === playerId;
    const wasInOwn = this.wasInOwnTerritory.get(playerId) ?? true;

    if (isInOwnTerritory) {
      // Player is in their own territory
      if (!wasInOwn && player.tail.length > 0) {
        // Just re-entered own territory with a tail - queue capture (async)
        this.queueCapture(player);
      }
      // Clear the tail and stop drawing
      player.tail = [];
      player.isDrawingTail = false;
      player.lastTailPoint = null;
    } else {
      // Player is outside their territory
      if (!player.isDrawingTail) {
        // Just left territory - start drawing tail
        player.isDrawingTail = true;
        // Add the exit point as first tail point
        player.tail = [player.pos.clone()];
        player.lastTailPoint = player.pos.clone();
      } else {
        // Continue drawing tail - add point if far enough from last point
        const lastPoint = player.lastTailPoint!;
        const dist = Math.sqrt(
          Math.pow(player.pos.x - lastPoint.x, 2) +
          Math.pow(player.pos.y - lastPoint.y, 2)
        );

        if (dist >= player.tailPointDistance) {
          player.tail.push(player.pos.clone());
          player.lastTailPoint = player.pos.clone();

          // Check for self-collision
          if (this.checkSelfTailCollisionForPlayer(player)) {
            this.handlePlayerDeath(player);
          }
        }
      }
    }

    this.wasInOwnTerritory.set(playerId, isInOwnTerritory);
  }

  /**
   * Check if a player collides with their own tail
   */
  private checkSelfTailCollisionForPlayer(player: Player): boolean {
    if (player.tail.length < 10) return false; // Need enough tail to collide with

    const playerRadius = gameConfig.player.radius;
    const collisionDist = playerRadius * 0.8;

    // Check against all tail points except the last few (too close to player)
    for (let i = 0; i < player.tail.length - 5; i++) {
      const tailPoint = player.tail[i];
      const dist = Math.sqrt(
        Math.pow(player.pos.x - tailPoint.x, 2) +
        Math.pow(player.pos.y - tailPoint.y, 2)
      );

      if (dist < collisionDist) {
        return true;
      }
    }

    // Also check line segments for more accurate collision
    for (let i = 0; i < player.tail.length - 6; i++) {
      const p1 = player.tail[i];
      const p2 = player.tail[i + 1];

      if (this.pointToLineDistance(player.pos, p1, p2) < collisionDist) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check all players against other players' tails
   */
  private checkAllTailCollisions(): void {
    const playerRadius = gameConfig.player.radius;
    const collisionDist = playerRadius * 0.8;

    for (const attacker of this.allPlayers) {
      if (!attacker.alive) continue;

      for (const victim of this.allPlayers) {
        if (!victim.alive || attacker.id === victim.id) continue;
        if (victim.tail.length < 3) continue;

        // IMMUNITY: Skip attacks on any player's tail when they have boost active
        if (this.isPlayerBoosted(victim.id)) {
          continue;
        }

        // Check if attacker collides with victim's tail
        for (let i = 0; i < victim.tail.length - 2; i++) {
          const tailPoint = victim.tail[i];
          const dist = Math.sqrt(
            Math.pow(attacker.pos.x - tailPoint.x, 2) +
            Math.pow(attacker.pos.y - tailPoint.y, 2)
          );

          if (dist < collisionDist) {
            // Attacker hit victim's tail - victim dies, attacker gets their territory!
            this.handlePlayerDeath(victim, attacker);
            attacker.kills++;

            // Activate boost on every 3rd kill (for any player, any difficulty)
            if (attacker.kills % 3 === 0) {
              this.activateBoost(attacker.id);
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Check if any player has hit the arena walls
   */
  private checkWallCollisions(): void {
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;
    const margin = 2; // Small margin for wall detection

    for (const player of this.allPlayers) {
      if (!player.alive) continue;

      if (player.pos.x < margin || player.pos.x > arenaW - margin ||
          player.pos.y < margin || player.pos.y > arenaH - margin) {
        // Player hit wall - death with no killer (no territory transfer)
        this.handlePlayerDeath(player);
      }
    }
  }

  /**
   * Calculate distance from point to line segment
   */
  private pointToLineDistance(point: Vec2, lineStart: Vec2, lineEnd: Vec2): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      // Line segment is a point
      return Math.sqrt(
        Math.pow(point.x - lineStart.x, 2) +
        Math.pow(point.y - lineStart.y, 2)
      );
    }

    // Project point onto line, clamped to segment
    let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    return Math.sqrt(
      Math.pow(point.x - projX, 2) +
      Math.pow(point.y - projY, 2)
    );
  }

  /**
   * Capture territory enclosed by the tail using flood fill
   * Uses a "smaller side" heuristic - captures the smaller of the two regions created by the tail
   */
  private captureTerritoryFromTail(player: Player, tail: Vec2[]): void {
    if (tail.length < 3) return;

    const playerOwnerId = player.id;
    const mapWidth = this.territoryMap.widthTiles;
    const mapHeight = this.territoryMap.heightTiles;

    // Convert tail to tile coordinates
    const tailTiles: { x: number; y: number }[] = [];
    for (const point of tail) {
      const tile = this.territoryMap.worldToTile(point.x, point.y);
      tailTiles.push(tile);
    }
    // Add current position as the closing point
    const endTile = this.territoryMap.worldToTile(player.pos.x, player.pos.y);
    tailTiles.push(endTile);

    // Find bounding box that includes ALL player territory + tail
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    // First pass: find tail bounds
    for (const tile of tailTiles) {
      minX = Math.min(minX, tile.x);
      maxX = Math.max(maxX, tile.x);
      minY = Math.min(minY, tile.y);
      maxY = Math.max(maxY, tile.y);
    }

    // Expand to include all player territory (important for large captures)
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (this.territoryMap.getOwner(x, y) === playerOwnerId) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Add padding for flood fill boundary
    const padding = 2;
    minX = Math.max(0, minX - padding);
    maxX = Math.min(mapWidth - 1, maxX + padding);
    minY = Math.max(0, minY - padding);
    maxY = Math.min(mapHeight - 1, maxY + padding);

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;

    // Create temporary grid: 0 = unknown, 1 = barrier (tail/territory), 2 = outside
    const tempGrid = new Uint8Array(boxWidth * boxHeight);

    // Mark existing player territory as barrier
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.territoryMap.getOwner(x, y) === playerOwnerId) {
          tempGrid[(y - minY) * boxWidth + (x - minX)] = 1;
        }
      }
    }

    // Mark tail path as barrier (thick line to ensure no gaps)
    for (let i = 0; i < tailTiles.length - 1; i++) {
      this.markThickLine(tempGrid, boxWidth, boxHeight, minX, minY,
        tailTiles[i].x, tailTiles[i].y, tailTiles[i + 1].x, tailTiles[i + 1].y);
    }

    // Also mark each tail point with a small radius
    for (const tile of tailTiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = tile.x + dx - minX;
          const ty = tile.y + dy - minY;
          if (tx >= 0 && tx < boxWidth && ty >= 0 && ty < boxHeight) {
            tempGrid[ty * boxWidth + tx] = 1;
          }
        }
      }
    }

    // Flood fill from edges to mark "outside" regions
    const queue: number[] = [];

    // Seed from all edges of the bounding box
    for (let x = 0; x < boxWidth; x++) {
      if (tempGrid[x] === 0) { tempGrid[x] = 2; queue.push(x); }
      const bottomIdx = (boxHeight - 1) * boxWidth + x;
      if (tempGrid[bottomIdx] === 0) { tempGrid[bottomIdx] = 2; queue.push(bottomIdx); }
    }
    for (let y = 0; y < boxHeight; y++) {
      const leftIdx = y * boxWidth;
      if (tempGrid[leftIdx] === 0) { tempGrid[leftIdx] = 2; queue.push(leftIdx); }
      const rightIdx = y * boxWidth + boxWidth - 1;
      if (tempGrid[rightIdx] === 0) { tempGrid[rightIdx] = 2; queue.push(rightIdx); }
    }

    // BFS flood fill
    let queueStart = 0;
    while (queueStart < queue.length) {
      const idx = queue[queueStart++];
      const x = idx % boxWidth;
      const y = Math.floor(idx / boxWidth);

      // Check 4 neighbors
      if (x > 0 && tempGrid[idx - 1] === 0) { tempGrid[idx - 1] = 2; queue.push(idx - 1); }
      if (x < boxWidth - 1 && tempGrid[idx + 1] === 0) { tempGrid[idx + 1] = 2; queue.push(idx + 1); }
      if (y > 0 && tempGrid[idx - boxWidth] === 0) { tempGrid[idx - boxWidth] = 2; queue.push(idx - boxWidth); }
      if (y < boxHeight - 1 && tempGrid[idx + boxWidth] === 0) { tempGrid[idx + boxWidth] = 2; queue.push(idx + boxWidth); }
    }

    // Capture all tiles that are still 0 (inside the loop) or are tail tiles (1 but not already owned)
    for (let by = 0; by < boxHeight; by++) {
      for (let bx = 0; bx < boxWidth; bx++) {
        const idx = by * boxWidth + bx;
        const mapX = bx + minX;
        const mapY = by + minY;

        // Capture if: inside (0) OR tail barrier that isn't already ours
        if (tempGrid[idx] === 0 ||
            (tempGrid[idx] === 1 && this.territoryMap.getOwner(mapX, mapY) !== playerOwnerId)) {
          this.territoryMap.setOwner(mapX, mapY, playerOwnerId);
        }
      }
    }
  }

  /**
   * Mark a thick line on the grid using Bresenham's algorithm with thickness
   */
  private markThickLine(grid: Uint8Array, width: number, height: number,
    offsetX: number, offsetY: number, x0: number, y0: number, x1: number, y1: number): void {
    // Convert to local coordinates
    x0 -= offsetX; y0 -= offsetY;
    x1 -= offsetX; y1 -= offsetY;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      // Mark this tile and immediate neighbors (thickness of 3)
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = x0 + ox;
          const ty = y0 + oy;
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            grid[ty * width + tx] = 1;
          }
        }
      }

      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /**
   * Handle any player death (human or bot)
   * @param player - The player who died
   * @param killer - The player who killed them (optional, for territory transfer)
   */
  private handlePlayerDeath(player: Player, killer?: Player): void {
    // Mark as dead immediately
    player.alive = false;
    player.tail = [];
    player.isDrawingTail = false;
    player.lastTailPoint = null;

    const isHuman = player.id === 1;

    if (killer) {
      // Killed by another player - transfer territory (except human in impossible mode)
      // In impossible mode, human player doesn't inherit enemy territory
      if (this.difficulty === 'impossible' && killer.id === 1) {
        // Human killed someone in impossible mode - clear victim's territory instead
        this.territoryMap.clearOwnerTerritory(player.id);
        console.log(`Player ${killer.id} killed Player ${player.id} but gets no territory (Impossible mode)!`);
      } else {
        // Normal mode - transfer territory
        this.territoryMap.transferTerritory(player.id, killer.id);
        console.log(`Player ${killer.id} killed Player ${player.id} and took their territory!`);
      }

      // Add kill feedback effect
      this.addKillEffect(player.pos.x, player.pos.y);
      // No respawn - permanent death when killed by another player
      // (game over check happens in checkGameEndConditions for human)
    } else {
      // Self-death (tail collision) or wall collision
      if (isHuman) {
        // Human self-death - game over, no respawn
        this.territoryMap.clearOwnerTerritory(player.id);
        console.log('Human player died (self/wall collision) - Game Over!');
        // Player stays dead, game over will be detected in checkGameEndConditions
      } else {
        // Bot self-death - respawn with fresh territory
        this.territoryMap.clearOwnerTerritory(player.id);
        console.log(`Bot ${player.id} died (self/wall collision) - respawning`);
        this.respawnPlayerEntity(player);
      }
    }
  }

  // Kill effect tracking for visual feedback
  private killEffects: { x: number; y: number; time: number }[] = [];

  // Boost notification tracking
  private boostNotifications: { playerId: number; time: number }[] = [];

  /**
   * Add a visual kill effect at the specified position
   */
  private addKillEffect(x: number, y: number): void {
    this.killEffects.push({ x, y, time: performance.now() });
  }

  /**
   * Respawn a player with a fresh start - clear all territory and create new blob
   */
  private respawnPlayerEntity(player: Player): void {
    const playerId = player.id;

    // Clear all player territory
    this.territoryMap.clearOwnerTerritory(playerId);

    // Find a safe spawn location
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;
    const margin = 200;

    let spawnX: number, spawnY: number;
    if (player.id === 1) {
      // Human player spawns at center
      spawnX = arenaW / 2;
      spawnY = arenaH / 2;
    } else {
      // Bots spawn at random locations
      spawnX = margin + Math.random() * (arenaW - margin * 2);
      spawnY = margin + Math.random() * (arenaH - margin * 2);
    }

    player.pos.set(spawnX, spawnY);

    // Generate fresh starting territory
    const startRadius = player.id === 1 ? 12 : 10;
    this.territoryMap.generateStartingTerritory(player.pos.x, player.pos.y, playerId, startRadius);

    // Clear tail and reset state
    player.tail = [];
    player.isDrawingTail = false;
    player.lastTailPoint = null;
    this.wasInOwnTerritory.set(playerId, true);

    // Reset player direction
    player.angle = Math.random() * Math.PI * 2;
    player.targetAngle = player.angle;
    player.dir.set(Math.cos(player.angle), Math.sin(player.angle));
    player.alive = true;
  }

  /**
   * Render the game
   */
  private render(): void {
    const { ctx } = this;
    const { theme } = gameConfig;

    // Clear canvas with fog of war color (outside arena)
    ctx.fillStyle = theme.fog;
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Draw the arena background
    this.drawArenaBackground();

    // Draw topographic contour lines
    this.drawContourLines();

    // Draw territory
    this.territoryMap.render(ctx, this.cameraX, this.cameraY, this.viewportWidth, this.viewportHeight);

    // Draw grid (relative to camera)
    this.drawGrid();

    // Draw arena border (if visible)
    this.drawArenaBorder();

    // Draw boost pickups
    this.drawBoostPickups();

    // Draw all player tails
    for (const player of this.allPlayers) {
      if (player.alive) {
        this.drawTailForPlayer(player);
      }
    }

    // Draw all players
    for (const player of this.allPlayers) {
      if (player.alive) {
        player.render(ctx, this.cameraX, this.cameraY);
      }
    }

    // Draw kill effects
    this.drawKillEffects();

    // Draw boost notifications
    this.drawBoostNotifications();

    // Draw HUD
    this.drawHUD();

    // Draw game over overlay if game has ended
    if (this.gameOver) {
      this.drawGameOverOverlay();
    }
  }

  // Store button positions for click detection
  private difficultyButtons: { x: number; y: number; w: number; h: number; difficulty: Difficulty }[] = [];
  private otherGamesLinks: { x: number; y: number; w: number; h: number; url: string }[] = [];

  /**
   * Draw the victory or defeat overlay
   */
  private drawGameOverOverlay(): void {
    const { ctx } = this;
    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;

    // Semi-transparent backdrop with blur effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Calculate game stats
    // For defeats, show max territory achieved (since current is 0 after death)
    const territoryPercent = this.isVictory
      ? this.territoryMap.getOwnershipPercentage(1)
      : this.maxTerritoryPercent;
    const gameTimeMs = this.gameEndTime - this.gameStartTime;
    const minutes = Math.floor(gameTimeMs / 60000);
    const seconds = Math.floor((gameTimeMs % 60000) / 1000);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const killCount = this.player.kills;
    const botsEliminated = this.bots.filter(b => !b.player.alive).length;

    // Panel dimensions - responsive for mobile
    const panelWidth = this.isMobile ? Math.min(340, this.viewportWidth - 20) : 400;
    const panelHeight = this.isMobile ? 380 : 420;
    const panelX = centerX - panelWidth / 2;
    const panelY = centerY - panelHeight / 2;

    // Panel background
    ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
    ctx.strokeStyle = this.isVictory ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 12);
    ctx.fill();
    ctx.stroke();

    // Title - responsive for mobile
    ctx.fillStyle = this.isVictory ? '#22c55e' : '#ef4444';
    ctx.font = this.isMobile ? 'bold 36px monospace' : 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.isVictory ? 'VICTORY' : 'DEFEATED', centerX, panelY + (this.isMobile ? 45 : 60));

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = this.isMobile ? '14px monospace' : '18px monospace';
    ctx.fillText(
      this.isVictory ? 'The map is yours.' : 'Your campaign has ended.',
      centerX, panelY + (this.isMobile ? 70 : 90)
    );

    // Stats section - responsive for mobile
    const statsY = panelY + (this.isMobile ? 95 : 130);
    const rowHeight = this.isMobile ? 38 : 45;

    // Stats background rows - responsive labels for mobile
    const stats = this.isMobile ? [
      { label: 'Territory', value: `${territoryPercent.toFixed(1)}%` },
      { label: 'Eliminated', value: `${botsEliminated}` },
      { label: 'Your Kills', value: `${killCount}` },
      { label: 'Time', value: timeStr }
    ] : [
      { label: 'Territory Conquered', value: `${territoryPercent.toFixed(1)}%` },
      { label: 'Enemies Eliminated', value: `${botsEliminated}` },
      { label: 'Your Kills', value: `${killCount}` },
      { label: 'Mission Time', value: timeStr }
    ];

    const statsRowHeight = this.isMobile ? 30 : 36;
    const statsPadding = this.isMobile ? 12 : 20;
    const statsFont = this.isMobile ? '12px monospace' : '14px monospace';
    const statsFontBold = this.isMobile ? 'bold 12px monospace' : 'bold 14px monospace';

    stats.forEach((stat, i) => {
      const rowY = statsY + i * rowHeight;

      // Row background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.roundRect(panelX + statsPadding, rowY, panelWidth - statsPadding * 2, statsRowHeight, 6);
      ctx.fill();

      // Label
      ctx.fillStyle = '#94a3b8';
      ctx.font = statsFont;
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, panelX + statsPadding + 12, rowY + (this.isMobile ? 20 : 24));

      // Value
      ctx.fillStyle = '#ffffff';
      ctx.font = statsFontBold;
      ctx.textAlign = 'right';
      ctx.fillText(stat.value, panelX + panelWidth - statsPadding - 12, rowY + (this.isMobile ? 20 : 24));
    });

    // Difficulty buttons section - responsive for mobile
    const btnY = panelY + panelHeight - (this.isMobile ? 70 : 80);
    const btnWidth = this.isMobile ? Math.min(90, (panelWidth - 40) / 3 - 8) : 110;
    const btnHeight = this.isMobile ? 36 : 40;
    const btnSpacing = this.isMobile ? 8 : 15;
    const totalBtnWidth = btnWidth * 3 + btnSpacing * 2;
    const btnStartX = centerX - totalBtnWidth / 2;

    // Clear and rebuild button positions
    this.difficultyButtons = [];

    // Button font sizes - smaller on mobile
    const btnFont = this.isMobile ? 'bold 12px monospace' : 'bold 16px monospace';
    const btnFontSmall = this.isMobile ? 'bold 10px monospace' : 'bold 14px monospace';
    const btnTextY = btnY + (this.isMobile ? 23 : 26);

    // Easy button (green)
    const easyX = btnStartX;
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.roundRect(easyX, btnY, btnWidth, btnHeight, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = btnFont;
    ctx.textAlign = 'center';
    ctx.fillText('Easy', easyX + btnWidth / 2, btnTextY);
    this.difficultyButtons.push({ x: easyX, y: btnY, w: btnWidth, h: btnHeight, difficulty: 'easy' });

    // Hard button (red)
    const hardX = btnStartX + btnWidth + btnSpacing;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.roundRect(hardX, btnY, btnWidth, btnHeight, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = btnFont;
    ctx.fillText('Hard', hardX + btnWidth / 2, btnTextY);
    this.difficultyButtons.push({ x: hardX, y: btnY, w: btnWidth, h: btnHeight, difficulty: 'hard' });

    // Impossible button (purple)
    const impossibleX = btnStartX + (btnWidth + btnSpacing) * 2;
    ctx.fillStyle = '#9333ea';
    ctx.beginPath();
    ctx.roundRect(impossibleX, btnY, btnWidth, btnHeight, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = btnFontSmall;
    ctx.fillText(this.isMobile ? 'Imposs.' : 'Impossible', impossibleX + btnWidth / 2, btnTextY);
    this.difficultyButtons.push({ x: impossibleX, y: btnY, w: btnWidth, h: btnHeight, difficulty: 'impossible' });

    // Difficulty description
    ctx.fillStyle = '#64748b';
    ctx.font = this.isMobile ? '10px monospace' : '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Select difficulty to play again', centerX, panelY + panelHeight - (this.isMobile ? 15 : 20));

    // Other games links (below panel)
    this.otherGamesLinks = [];
    const linksY = panelY + panelHeight + (this.isMobile ? 20 : 30);
    const linkFont = this.isMobile ? '11px monospace' : '13px monospace';
    ctx.font = linkFont;
    ctx.fillStyle = '#64748b';
    const moreText = 'More: ';
    const moreWidth = ctx.measureText(moreText).width;
    const bankitText = 'BankIt';
    const bankitWidth = ctx.measureText(bankitText).width;
    const separator = ' | ';
    const sepWidth = ctx.measureText(separator).width;
    const cubeText = 'CubeBluff';
    const cubeWidth = ctx.measureText(cubeText).width;
    const totalWidth = moreWidth + bankitWidth + sepWidth + cubeWidth;
    const startX = centerX - totalWidth / 2;

    // Draw "More: " label
    ctx.fillText(moreText, startX, linksY);

    // Draw BankIt link
    const bankitX = startX + moreWidth;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(bankitText, bankitX, linksY);
    this.otherGamesLinks.push({ x: bankitX, y: linksY - 12, w: bankitWidth, h: 16, url: 'https://bankitgame.vercel.app/' });

    // Draw separator
    ctx.fillStyle = '#64748b';
    ctx.fillText(separator, bankitX + bankitWidth, linksY);

    // Draw CubeBluff link
    const cubeX = bankitX + bankitWidth + sepWidth;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(cubeText, cubeX, linksY);
    this.otherGamesLinks.push({ x: cubeX, y: linksY - 12, w: cubeWidth, h: 16, url: 'https://cubebluff.vercel.app/' });

    // How to Play button (small, top right of panel) - responsive for mobile
    const howToPlayBtnW = this.isMobile ? 26 : 30;
    const howToPlayBtnH = this.isMobile ? 26 : 30;
    const howToPlayBtnX = panelX + panelWidth - howToPlayBtnW - (this.isMobile ? 8 : 10);
    const howToPlayBtnY = panelY + (this.isMobile ? 8 : 10);
    this.howToPlayButton = { x: howToPlayBtnX, y: howToPlayBtnY, w: howToPlayBtnW, h: howToPlayBtnH };

    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.roundRect(howToPlayBtnX, howToPlayBtnY, howToPlayBtnW, howToPlayBtnH, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = this.isMobile ? 'bold 14px monospace' : 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('?', howToPlayBtnX + howToPlayBtnW / 2, howToPlayBtnY + (this.isMobile ? 18 : 22));

    // Draw How to Play popup if open
    if (this.showHowToPlay) {
      this.drawHowToPlayPopup();
    }

    // Reset text alignment
    ctx.textAlign = 'left';
  }

  /**
   * Draw the How to Play popup overlay - responsive for mobile
   */
  private drawHowToPlayPopup(): void {
    const { ctx } = this;
    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;

    // Popup dimensions - responsive for mobile
    const popupWidth = this.isMobile ? Math.min(320, this.viewportWidth - 20) : 500;
    const popupHeight = this.isMobile ? Math.min(450, this.viewportHeight - 40) : 520;
    const popupX = centerX - popupWidth / 2;
    const popupY = centerY - popupHeight / 2;

    // Font sizes - smaller on mobile
    const titleFont = this.isMobile ? 'bold 22px monospace' : 'bold 32px monospace';
    const sectionFont = this.isMobile ? 'bold 12px monospace' : 'bold 16px monospace';
    const bodyFont = this.isMobile ? '11px monospace' : '14px monospace';
    const lineHeight = this.isMobile ? 16 : 22;
    const sectionGap = this.isMobile ? 8 : 15;
    const padding = this.isMobile ? 15 : 25;

    // Darker backdrop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Popup background
    ctx.fillStyle = 'rgba(30, 41, 59, 0.98)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(popupX, popupY, popupWidth, popupHeight, 12);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.fillStyle = '#3b82f6';
    ctx.font = titleFont;
    ctx.textAlign = 'center';
    ctx.fillText('HOW TO PLAY', centerX, popupY + (this.isMobile ? 30 : 45));

    // Close button
    const closeBtnW = this.isMobile ? 26 : 30;
    const closeBtnH = this.isMobile ? 26 : 30;
    const closeBtnX = popupX + popupWidth - closeBtnW - 8;
    const closeBtnY = popupY + 8;
    this.closeHowToPlayButton = { x: closeBtnX, y: closeBtnY, w: closeBtnW, h: closeBtnH };

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.roundRect(closeBtnX, closeBtnY, closeBtnW, closeBtnH, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = this.isMobile ? 'bold 16px monospace' : 'bold 20px monospace';
    ctx.fillText('X', closeBtnX + closeBtnW / 2, closeBtnY + (this.isMobile ? 18 : 22));

    // Content sections
    let y = popupY + (this.isMobile ? 50 : 80);

    ctx.textAlign = 'left';

    // Controls section
    ctx.fillStyle = '#fbbf24';
    ctx.font = sectionFont;
    ctx.fillText('CONTROLS', popupX + padding, y);
    y += lineHeight;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    const controls = this.isMobile ? [
      'Swipe to set direction',
      'You move forward automatically'
    ] : [
      'Desktop: Mouse aims direction, WASD/Arrows to steer',
      'Mobile: Swipe to set direction',
      'You always move forward automatically'
    ];
    for (const line of controls) {
      ctx.fillText(line, popupX + padding, y);
      y += lineHeight;
    }

    y += sectionGap;

    // Gameplay section
    ctx.fillStyle = '#fbbf24';
    ctx.font = sectionFont;
    ctx.fillText('GAMEPLAY', popupX + padding, y);
    y += lineHeight;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    const gameplay = this.isMobile ? [
      'Leave territory to draw a tail',
      'Return home to capture area',
      'Cross enemy tails to eliminate them',
      'Avoid your own tail or walls!',
      'Camping shrinks your land'
    ] : [
      'Leave your territory to draw a tail',
      'Return home to capture the enclosed area',
      'Cross enemy tails to eliminate them and steal territory',
      'Avoid hitting your own tail or walls!',
      'Stay outside your base - camping shrinks your land'
    ];
    for (const line of gameplay) {
      ctx.fillText(line, popupX + padding, y);
      y += lineHeight;
    }

    y += sectionGap;

    // Power-ups section
    ctx.fillStyle = '#fbbf24';
    ctx.font = sectionFont;
    ctx.fillText('POWER-UPS', popupX + padding, y);
    y += lineHeight;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    const powerups = this.isMobile ? [
      'Yellow orbs = 5s speed boost',
      'Every 3 kills = speed boost'
    ] : [
      'Collect yellow lightning orbs for 5s speed boost',
      'Every 3 kills also grants a 5s speed boost'
    ];
    for (const line of powerups) {
      ctx.fillText(line, popupX + padding, y);
      y += lineHeight;
    }

    y += sectionGap;

    // Difficulty section
    ctx.fillStyle = '#fbbf24';
    ctx.font = sectionFont;
    ctx.fillText('DIFFICULTY MODES', popupX + padding, y);
    y += lineHeight;

    const diffLabelOffset = this.isMobile ? 50 : 85;
    const impLabelOffset = this.isMobile ? 70 : 130;

    ctx.fillStyle = '#22c55e';
    ctx.font = this.isMobile ? 'bold 11px monospace' : 'bold 14px monospace';
    ctx.fillText('Easy:', popupX + padding, y);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    ctx.fillText(this.isMobile ? 'Slower bots' : 'Slower bots, lower aggression', popupX + diffLabelOffset, y);
    y += lineHeight;

    ctx.fillStyle = '#ef4444';
    ctx.font = this.isMobile ? 'bold 11px monospace' : 'bold 14px monospace';
    ctx.fillText('Hard:', popupX + padding, y);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    ctx.fillText(this.isMobile ? 'Bots hunt you' : 'Fast reactions, bots hunt you', popupX + diffLabelOffset, y);
    y += lineHeight;

    ctx.fillStyle = '#9333ea';
    ctx.font = this.isMobile ? 'bold 11px monospace' : 'bold 14px monospace';
    ctx.fillText(this.isMobile ? 'Imposs:' : 'Impossible:', popupX + padding, y);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = bodyFont;
    ctx.fillText(this.isMobile ? '2x speed, no inheritance' : '2x bot speed, 2x shrink, no territory on kills', popupX + impLabelOffset, y);

    // Footer
    ctx.fillStyle = '#64748b';
    ctx.font = this.isMobile ? '10px monospace' : '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Tap anywhere to close', centerX, popupY + popupHeight - 15);
  }

  /**
   * Draw boost pickup items on the map
   */
  private drawBoostPickups(): void {
    const { ctx } = this;
    const now = performance.now();

    for (const pickup of this.boostPickups) {
      // Convert to screen coords
      const screenX = pickup.x - this.cameraX;
      const screenY = pickup.y - this.cameraY;

      // Skip if off-screen
      if (screenX < -30 || screenX > this.viewportWidth + 30 ||
          screenY < -30 || screenY > this.viewportHeight + 30) {
        continue;
      }

      // Animated pulsing effect
      const age = now - pickup.spawnTime;
      const pulse = 1 + Math.sin(age / 200) * 0.15;
      const radius = this.boostPickupRadius * pulse;

      // Colors based on pickup type
      const isPlayerOnly = pickup.playerOnly;

      // Outer glow
      const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radius * 2);
      if (isPlayerOnly) {
        // Cyan/blue for player-only
        gradient.addColorStop(0, 'rgba(0, 200, 255, 0.6)');
        gradient.addColorStop(0.5, 'rgba(0, 150, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 100, 200, 0)');
      } else {
        // Yellow/gold for everyone
        gradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
        gradient.addColorStop(0.5, 'rgba(255, 165, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Main circle
      ctx.fillStyle = isPlayerOnly ? '#22d3ee' : '#fbbf24';
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner highlight
      ctx.fillStyle = isPlayerOnly ? '#cffafe' : '#fef3c7';
      ctx.beginPath();
      ctx.arc(screenX - radius * 0.2, screenY - radius * 0.2, radius * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Lightning bolt icon
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = isPlayerOnly ? '#164e63' : '#7c2d12';
      ctx.beginPath();
      ctx.moveTo(-3, -8);
      ctx.lineTo(2, -2);
      ctx.lineTo(-1, -2);
      ctx.lineTo(3, 8);
      ctx.lineTo(-2, 2);
      ctx.lineTo(1, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Border
      ctx.strokeStyle = isPlayerOnly ? '#0891b2' : '#d97706';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Draw visual feedback for recent kills
   */
  private drawKillEffects(): void {
    const { ctx } = this;
    const now = performance.now();
    const effectDuration = 600; // ms

    // Filter out expired effects and draw active ones
    this.killEffects = this.killEffects.filter(effect => {
      const age = now - effect.time;
      if (age > effectDuration) return false;

      // Convert to screen coords
      const screenX = effect.x - this.cameraX;
      const screenY = effect.y - this.cameraY;

      // Skip if off-screen
      if (screenX < -50 || screenX > this.viewportWidth + 50 ||
          screenY < -50 || screenY > this.viewportHeight + 50) {
        return true; // Keep effect but don't draw
      }

      // Expanding ring effect
      const progress = age / effectDuration;
      const radius = 20 + progress * 80;
      const opacity = 1 - progress;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 100, 100, ${opacity})`;
      ctx.lineWidth = 4 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner flash
      if (progress < 0.3) {
        const flashOpacity = (0.3 - progress) / 0.3;
        ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity * 0.5})`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 30 * (1 - progress), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      return true; // Keep effect
    });
  }

  /**
   * Draw "BOOST!" popup notifications when players activate boost
   */
  private drawBoostNotifications(): void {
    const { ctx } = this;
    const now = performance.now();
    const notificationDuration = 1200; // ms

    this.boostNotifications = this.boostNotifications.filter(notification => {
      const age = now - notification.time;
      if (age > notificationDuration) return false;

      // Only show notification for human player prominently
      if (notification.playerId !== 1) return true; // Keep but don't draw for bots

      const progress = age / notificationDuration;

      // Animation: scale up then fade out
      const scale = progress < 0.2
        ? 0.5 + (progress / 0.2) * 0.5  // Scale up from 0.5 to 1.0
        : 1.0;
      const opacity = progress < 0.3
        ? 1.0
        : 1.0 - ((progress - 0.3) / 0.7); // Fade out after 30%

      // Position: center of screen, moving up slightly
      const centerX = this.viewportWidth / 2;
      const centerY = this.viewportHeight / 2 - 50 - (progress * 30);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);

      // Glowing text effect
      const pulse = 0.8 + 0.2 * Math.sin(now / 50);

      // Outer glow
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 30 * pulse;
      ctx.fillStyle = `rgba(0, 255, 136, ${opacity})`;
      ctx.font = 'bold 72px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BOOST!', 0, 0);

      // Inner bright text
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fillText('BOOST!', 0, 0);

      ctx.restore();

      return true; // Keep notification
    });
  }

  /**
   * Draw the arena background (tactical map style)
   */
  private drawArenaBackground(): void {
    const { ctx } = this;
    const { theme } = gameConfig;
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;

    // Convert arena bounds to screen coords
    const left = -this.cameraX;
    const top = -this.cameraY;

    // Draw arena as a slightly lighter area than fog
    ctx.fillStyle = theme.mapBg;
    ctx.fillRect(left, top, arenaW, arenaH);
  }

  /**
   * Draw topographic contour lines for tactical feel
   */
  private drawContourLines(): void {
    // Skip contour lines on mobile for better performance
    if (this.isMobile) return;

    const { ctx } = this;
    const { theme } = gameConfig;

    // Draw concentric circles emanating from center of arena
    const arenaCenterX = derivedConfig.arenaWidthPx / 2 - this.cameraX;
    const arenaCenterY = derivedConfig.arenaHeightPx / 2 - this.cameraY;

    ctx.strokeStyle = theme.contourColor;
    ctx.lineWidth = 1;

    const maxRadius = Math.max(derivedConfig.arenaWidthPx, derivedConfig.arenaHeightPx);
    const contourSpacing = 120; // Increased spacing = fewer circles = better performance

    // Only draw circles that are visible in viewport (with some margin)
    const margin = 200;
    const minVisibleRadius = Math.max(0,
      Math.sqrt(Math.pow(Math.max(0, -arenaCenterX - margin), 2) + Math.pow(Math.max(0, -arenaCenterY - margin), 2))
    );
    const maxVisibleRadius = Math.sqrt(
      Math.pow(Math.max(Math.abs(arenaCenterX), Math.abs(this.viewportWidth - arenaCenterX)) + margin, 2) +
      Math.pow(Math.max(Math.abs(arenaCenterY), Math.abs(this.viewportHeight - arenaCenterY)) + margin, 2)
    );

    // Batch all arcs in single path
    ctx.beginPath();
    const startR = Math.ceil(minVisibleRadius / contourSpacing) * contourSpacing;
    for (let r = Math.max(contourSpacing, startR); r < Math.min(maxRadius, maxVisibleRadius); r += contourSpacing) {
      ctx.moveTo(arenaCenterX + r, arenaCenterY);
      ctx.arc(arenaCenterX, arenaCenterY, r, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  /**
   * Draw a subtle grid for visual reference
   */
  private drawGrid(): void {
    // Skip grid on mobile for better performance
    if (this.isMobile) return;

    const { ctx } = this;
    const { tileSize, theme } = gameConfig;

    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth = 0.5;

    const gridStep = tileSize * 10;

    // Calculate grid offset based on camera
    const offsetX = -(this.cameraX % gridStep);
    const offsetY = -(this.cameraY % gridStep);

    // Only draw grid within arena bounds
    const arenaLeft = -this.cameraX;
    const arenaTop = -this.cameraY;
    const arenaRight = derivedConfig.arenaWidthPx - this.cameraX;
    const arenaBottom = derivedConfig.arenaHeightPx - this.cameraY;

    ctx.beginPath();
    for (let x = offsetX; x < this.viewportWidth; x += gridStep) {
      if (x >= arenaLeft && x <= arenaRight) {
        ctx.moveTo(x, Math.max(0, arenaTop));
        ctx.lineTo(x, Math.min(this.viewportHeight, arenaBottom));
      }
    }
    for (let y = offsetY; y < this.viewportHeight; y += gridStep) {
      if (y >= arenaTop && y <= arenaBottom) {
        ctx.moveTo(Math.max(0, arenaLeft), y);
        ctx.lineTo(Math.min(this.viewportWidth, arenaRight), y);
      }
    }
    ctx.stroke();
  }

  /**
   * Draw arena border (danger zone indicator)
   */
  private drawArenaBorder(): void {
    const { ctx } = this;
    const { theme } = gameConfig;
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;

    // Convert arena bounds to screen coords
    const left = -this.cameraX;
    const top = -this.cameraY;

    // Draw a glowing danger border
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = theme.borderColor;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.rect(left, top, arenaW, arenaH);
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;
  }

  /**
   * Draw a player's tail
   */
  private drawTailForPlayer(player: Player): void {
    if (player.tail.length < 2) return;

    const { ctx } = this;
    const isBoosted = this.isPlayerBoosted(player.id);

    ctx.save();

    // Enhanced glow when boosted
    if (isBoosted) {
      // Pulsing outer glow for boosted players
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 80);
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 30 * pulse;

      // Draw outer glow pass
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.3 * pulse})`;
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      const firstPointGlow = player.tail[0];
      ctx.moveTo(firstPointGlow.x - this.cameraX, firstPointGlow.y - this.cameraY);
      for (let i = 1; i < player.tail.length; i++) {
        const point = player.tail[i];
        ctx.lineTo(point.x - this.cameraX, point.y - this.cameraY);
      }
      ctx.lineTo(player.pos.x - this.cameraX, player.pos.y - this.cameraY);
      ctx.stroke();
    }

    // Draw tail line with glow effect
    ctx.strokeStyle = isBoosted ? '#00ff88' : player.color;
    ctx.lineWidth = isBoosted ? 12 : 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = isBoosted ? '#00ff88' : player.color;
    ctx.shadowBlur = isBoosted ? 20 : 12;

    ctx.beginPath();
    const firstPoint = player.tail[0];
    ctx.moveTo(firstPoint.x - this.cameraX, firstPoint.y - this.cameraY);

    for (let i = 1; i < player.tail.length; i++) {
      const point = player.tail[i];
      ctx.lineTo(point.x - this.cameraX, point.y - this.cameraY);
    }

    // Connect to current player position
    ctx.lineTo(player.pos.x - this.cameraX, player.pos.y - this.cameraY);

    ctx.stroke();

    // Draw a lighter inner line for depth
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isBoosted ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isBoosted ? 5 : 4;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Draw HUD elements (tactical style) - scaled 1.5x
   */
  private drawHUD(): void {
    const { ctx } = this;

    // Top bar - Territory control
    this.drawTerritoryBar();

    // Difficulty indicator (top-left, below territory bar) - DEBUG
    if (this.difficulty !== 'easy') {
      const diffColor = this.difficulty === 'impossible' ? '#ef4444' : '#f59e0b';
      const diffText = this.difficulty.toUpperCase();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.roundRect(10, 55, this.isMobile ? 80 : 100, this.isMobile ? 22 : 28, 6);
      ctx.fill();
      ctx.fillStyle = diffColor;
      ctx.font = this.isMobile ? 'bold 12px monospace' : 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(diffText, this.isMobile ? 50 : 60, this.isMobile ? 70 : 75);
      ctx.textAlign = 'left';
    }

    // Right side - Bot/enemy list
    this.drawBotList();

    // Bottom - Mini-map placeholder
    this.drawMiniMap();

    // Camping warning indicator (left side, above control mode)
    this.drawCampingIndicator();

    // Boost indicator (left side, above camping indicator)
    this.drawBoostIndicator();

    // Control mode indicator (bottom-left) - hide on mobile
    if (!this.isMobile) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(15, this.viewportHeight - 50, 225, 36, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '18px monospace';
      let mode = 'KEYBOARD';
      if (this.useTouchSteering) mode = 'TOUCH';
      else if (this.useMouseSteering) mode = 'MOUSE';
      ctx.fillText(`[${mode}]`, 24, this.viewportHeight - 24);
    }
  }

  /**
   * Draw camping warning indicator when player is inside their territory
   */
  private drawCampingIndicator(): void {
    const campingTime = this.getPlayerCampingTime(1); // Human player
    const isShrinking = this.isPlayerShrinking(1);

    // Only show if player has any camping time
    if (campingTime <= 0) return;

    const { ctx } = this;
    const scale = this.hudScale;
    const threshold = gameConfig.shrink.campingThreshold;
    const progress = Math.min(campingTime / threshold, 1);

    const x = 10;
    const barWidth = this.isMobile ? 110 : 180;
    const barHeight = Math.floor(24 * scale);
    // On mobile, position above mini-map (bottom-left)
    const y = this.isMobile ? this.viewportHeight - 55 : this.viewportHeight - 100;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = isShrinking ? 'rgba(255, 100, 100, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = isShrinking ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth + 20 * scale, barHeight + 16 * scale, 6 * scale);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = isShrinking ? '#ff6b6b' : '#94a3b8';
    ctx.font = `bold ${Math.floor(10 * scale)}px monospace`;
    ctx.fillText(isShrinking ? 'SHRINKING!' : 'CAMPING', x + 8 * scale, y + 12 * scale);

    // Progress bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x + 8 * scale, y + 18 * scale, barWidth, 10 * scale, 3 * scale);
    ctx.fill();

    // Progress bar fill - color changes from green to yellow to red
    let barColor: string;
    if (progress < 0.5) {
      barColor = '#22c55e'; // green
    } else if (progress < 0.8) {
      barColor = '#f59e0b'; // yellow
    } else {
      barColor = '#ef4444'; // red
    }

    if (isShrinking) {
      // Pulsing red when shrinking
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
      barColor = `rgba(239, 68, 68, ${0.7 + 0.3 * pulse})`;
    }

    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(x + 8 * scale, y + 18 * scale, barWidth * progress, 10 * scale, 3 * scale);
    ctx.fill();
  }

  /**
   * Draw boost indicator when player has boost active or shows kills until next boost
   */
  private drawBoostIndicator(): void {
    const { ctx } = this;
    const scale = this.hudScale;
    const hasBoost = this.isPlayerBoosted(1);
    const killsUntilBoost = 3 - (this.player.kills % 3);
    const boostTimeRemaining = this.getBoostTimeRemaining(1);

    // Position above camping indicator
    const x = 10;
    const barWidth = this.isMobile ? 110 : 180;
    const barHeight = Math.floor(24 * scale);
    // On mobile, position above camping indicator (stacked bottom-left)
    const y = this.isMobile ? this.viewportHeight - 100 : this.viewportHeight - 160;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = hasBoost ? 'rgba(100, 255, 100, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = hasBoost ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth + 20 * scale, barHeight + 16 * scale, 6 * scale);
    ctx.fill();
    ctx.stroke();

    if (hasBoost) {
      // BOOST ACTIVE - show countdown
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 100);
      ctx.fillStyle = `rgba(100, 255, 100, ${pulse})`;
      ctx.font = `bold ${Math.floor(10 * scale)}px monospace`;
      ctx.fillText(this.isMobile ? 'BOOST!' : 'BOOST ACTIVE!', x + 8 * scale, y + 12 * scale);

      // Progress bar background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.roundRect(x + 8 * scale, y + 18 * scale, barWidth, 10 * scale, 3 * scale);
      ctx.fill();

      // Progress bar fill (time remaining)
      const progress = boostTimeRemaining / this.boostDuration;
      const gradient = ctx.createLinearGradient(x + 8 * scale, 0, x + 8 * scale + barWidth, 0);
      gradient.addColorStop(0, '#22c55e');
      gradient.addColorStop(1, '#86efac');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x + 8 * scale, y + 18 * scale, barWidth * progress, 10 * scale, 3 * scale);
      ctx.fill();

      // Time text
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(9 * scale)}px monospace`;
      ctx.fillText(`${(boostTimeRemaining / 1000).toFixed(1)}s`, x + barWidth - 10 * scale, y + 27 * scale);
    } else {
      // Show kills until next boost
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${Math.floor(10 * scale)}px monospace`;
      ctx.fillText('NEXT BOOST', x + 8 * scale, y + 12 * scale);

      // Kills indicator (3 dots)
      const dotRadius = Math.floor(6 * scale);
      const dotSpacing = Math.floor(22 * scale);
      const startDotX = x + 20 * scale;
      const dotY = y + 28 * scale;

      for (let i = 0; i < 3; i++) {
        const dotX = startDotX + i * dotSpacing;
        const isFilled = i < (this.player.kills % 3);

        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);

        if (isFilled) {
          // Filled dot (kill earned)
          const gradient = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, dotRadius);
          gradient.addColorStop(0, '#86efac');
          gradient.addColorStop(1, '#22c55e');
          ctx.fillStyle = gradient;
          ctx.fill();
        } else {
          // Empty dot
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Kills text (only show on desktop - too cramped on mobile)
      if (!this.isMobile) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px monospace';
        ctx.fillText(`${killsUntilBoost} kill${killsUntilBoost !== 1 ? 's' : ''} to go`, x + 110, y + 36);
      }
    }
  }

  /**
   * Draw territory control bar at top (responsive)
   */
  private drawTerritoryBar(): void {
    const { ctx } = this;
    const scale = this.hudScale;
    const barWidth = this.isMobile ? Math.min(300, this.viewportWidth - 40) : 450;
    const barHeight = 36 * scale;
    const x = (this.viewportWidth - barWidth) / 2;
    const y = 10 * scale + 5;

    // Background (50% transparent so player visible behind)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight + 20 * scale, 9 * scale);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold ${Math.floor(13 * scale)}px monospace`;
    ctx.fillText('TERRITORY', x + 10 * scale, y + 16 * scale);

    // Progress bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x + 10 * scale, y + 26 * scale, barWidth - 20 * scale, 12 * scale, 4 * scale);
    ctx.fill();

    // Progress bar fill (actual territory percentage)
    const progress = this.territoryMap.getOwnershipPercentage(1) / 100; // Convert to 0-1
    if (progress > 0) {
      const gradient = ctx.createLinearGradient(x + 10 * scale, 0, x + 10 * scale + (barWidth - 20 * scale) * progress, 0);
      gradient.addColorStop(0, '#3b82f6');
      gradient.addColorStop(1, '#60a5fa');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x + 10 * scale, y + 26 * scale, (barWidth - 20 * scale) * progress, 12 * scale, 4 * scale);
      ctx.fill();
    }

    // Percentage text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.floor(13 * scale)}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${(progress * 100).toFixed(1)}%`, x + barWidth - 10 * scale, y + 16 * scale);
    ctx.textAlign = 'left';
  }

  /**
   * Draw leaderboard showing all players sorted by territory percentage
   */
  private drawBotList(): void {
    const { ctx } = this;

    // On mobile, show compact rank badge instead of full leaderboard
    if (this.isMobile) {
      this.drawMobileRankBadge();
      return;
    }

    const listWidth = 220;
    const x = this.viewportWidth - listWidth - 20;
    const y = 20;

    // Build leaderboard entries for all players (human + bots)
    const leaderboard: { player: Player; name: string; percent: number; isHuman: boolean }[] = [];

    // Add human player
    leaderboard.push({
      player: this.player,
      name: 'YOU',
      percent: this.territoryMap.getOwnershipPercentage(1),
      isHuman: true
    });

    // Add all bots
    const botNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
                      'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'Nov', 'Oscar', 'Papa',
                      'Quebec', 'Romeo', 'Sierra'];

    this.bots.forEach((bot, idx) => {
      leaderboard.push({
        player: bot.player,
        name: botNames[idx] || `Bot${idx + 1}`,
        percent: this.territoryMap.getOwnershipPercentage(bot.player.id),
        isHuman: false
      });
    });

    // Sort by territory percentage (descending), alive players first
    leaderboard.sort((a, b) => {
      if (a.player.alive !== b.player.alive) {
        return a.player.alive ? -1 : 1; // Alive first
      }
      return b.percent - a.percent; // Higher percent first
    });

    // Find human's rank
    const humanRank = leaderboard.findIndex(e => e.isHuman) + 1;

    // Count alive/dead
    const aliveCount = leaderboard.filter(e => e.player.alive).length;
    const deadCount = leaderboard.length - aliveCount;

    // Show top 6 entries
    const maxVisible = 6;
    const visibleEntries = leaderboard.slice(0, maxVisible);

    const listHeight = 70 + visibleEntries.length * 32;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, listWidth, listHeight, 9);
    ctx.fill();
    ctx.stroke();

    // Header
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('LEADERBOARD', x + 15, y + 24);

    // Alive count
    ctx.font = '12px monospace';
    ctx.fillStyle = '#22c55e';
    ctx.textAlign = 'right';
    ctx.fillText(`${aliveCount} alive`, x + listWidth - 15, y + 24);
    ctx.textAlign = 'left';

    // Your rank line
    ctx.fillStyle = '#60a5fa';
    ctx.font = '12px monospace';
    ctx.fillText(`Your rank: #${humanRank}`, x + 15, y + 42);
    ctx.fillStyle = '#64748b';
    ctx.fillText(` / ${leaderboard.length}`, x + 100, y + 42);

    // Draw leaderboard entries
    visibleEntries.forEach((entry, i) => {
      const entryY = y + 62 + i * 32;
      const isAlive = entry.player.alive;
      const rank = i + 1;

      // Highlight background for human
      if (entry.isHuman) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.beginPath();
        ctx.roundRect(x + 5, entryY - 12, listWidth - 10, 28, 4);
        ctx.fill();
      }

      // Rank number
      ctx.fillStyle = isAlive ? '#94a3b8' : '#4b5563';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${rank}.`, x + 12, entryY + 5);

      // Player icon
      ctx.beginPath();
      ctx.arc(x + 40, entryY, 8, 0, Math.PI * 2);
      ctx.fillStyle = isAlive ? entry.player.color : '#4b5563';
      ctx.fill();
      if (entry.isHuman) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Player name
      ctx.fillStyle = entry.isHuman ? '#60a5fa' : (isAlive ? '#e2e8f0' : '#6b7280');
      ctx.font = entry.isHuman ? 'bold 13px monospace' : '13px monospace';
      ctx.fillText(entry.name, x + 55, entryY + 5);

      // Territory percentage
      ctx.fillStyle = isAlive ? '#ffffff' : '#6b7280';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${entry.percent.toFixed(1)}%`, x + listWidth - 15, entryY + 5);
      ctx.textAlign = 'left';

      // Strike-through for dead players
      if (!isAlive) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 55, entryY);
        ctx.lineTo(x + 55 + ctx.measureText(entry.name).width, entryY);
        ctx.stroke();
      }
    });
  }

  /**
   * Draw compact rank badge for mobile
   */
  private drawMobileRankBadge(): void {
    const { ctx } = this;

    // Build leaderboard to calculate rank
    const leaderboard: { player: Player; percent: number; isHuman: boolean }[] = [];
    leaderboard.push({
      player: this.player,
      percent: this.territoryMap.getOwnershipPercentage(1),
      isHuman: true
    });
    this.bots.forEach((bot) => {
      leaderboard.push({
        player: bot.player,
        percent: this.territoryMap.getOwnershipPercentage(bot.player.id),
        isHuman: false
      });
    });

    // Sort by alive status then territory
    leaderboard.sort((a, b) => {
      if (a.player.alive !== b.player.alive) return a.player.alive ? -1 : 1;
      return b.percent - a.percent;
    });

    const humanRank = leaderboard.findIndex(e => e.isHuman) + 1;
    const aliveCount = leaderboard.filter(e => e.player.alive).length;

    // Draw small badge top-right
    const badgeW = 70;
    const badgeH = 50;
    const x = this.viewportWidth - badgeW - 10;
    const y = 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(x, y, badgeW, badgeH, 6);
    ctx.fill();

    // Rank number
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`#${humanRank}`, x + badgeW / 2, y + 22);

    // Alive count
    ctx.fillStyle = '#22c55e';
    ctx.font = '11px monospace';
    ctx.fillText(`${aliveCount} left`, x + badgeW / 2, y + 40);
    ctx.textAlign = 'left';
  }

  /**
   * Draw mini-map at bottom (responsive - smaller on mobile, bottom-right)
   */
  private drawMiniMap(): void {
    const { ctx } = this;
    const scale = this.hudScale;
    const mapWidth = this.isMobile ? 100 : 225;
    const mapHeight = this.isMobile ? 70 : 150;
    // On mobile, position bottom-right; on desktop, bottom-center
    const x = this.isMobile ? this.viewportWidth - mapWidth - 10 : (this.viewportWidth - mapWidth) / 2;
    const y = this.viewportHeight - mapHeight - 10;

    // Background (50% transparent so player visible behind)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, mapWidth, mapHeight, 9);
    ctx.fill();
    ctx.stroke();

    // Mini arena background (semi-transparent)
    const padding = 12;
    const innerWidth = mapWidth - padding * 2;
    const innerHeight = mapHeight - padding * 2;
    ctx.fillStyle = 'rgba(52, 73, 94, 0.6)'; // mapBg color with transparency
    ctx.fillRect(x + padding, y + padding, innerWidth, innerHeight);

    // Draw all player positions on mini-map
    for (const player of this.allPlayers) {
      if (!player.alive) continue;

      const mapX = x + padding + (player.pos.x / derivedConfig.arenaWidthPx) * innerWidth;
      const mapY = y + padding + (player.pos.y / derivedConfig.arenaHeightPx) * innerHeight;

      // Draw player dot
      ctx.beginPath();
      ctx.arc(mapX, mapY, player.id === 1 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();

      // Only add border for human player
      if (player.id === 1) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Draw viewport rectangle
    const viewRectX = x + padding + (this.cameraX / derivedConfig.arenaWidthPx) * innerWidth;
    const viewRectY = y + padding + (this.cameraY / derivedConfig.arenaHeightPx) * innerHeight;
    const viewRectW = (this.viewportWidth / derivedConfig.arenaWidthPx) * innerWidth;
    const viewRectH = (this.viewportHeight / derivedConfig.arenaHeightPx) * innerHeight;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(viewRectX, viewRectY, viewRectW, viewRectH);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    // Remove event listeners
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('resize', this.boundResize);
    this.canvas.removeEventListener('touchstart', this.boundTouchStart);
    this.canvas.removeEventListener('touchmove', this.boundTouchMove);
    this.canvas.removeEventListener('touchend', this.boundTouchEnd);
  }
}
