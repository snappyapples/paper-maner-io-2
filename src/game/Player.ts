import { Vec2 } from './Vec2';
import { gameConfig, derivedConfig } from './gameConfig';

export interface PlayerOptions {
  id: number;
  isBot: boolean;
  startX: number;
  startY: number;
  color: string;
  speed?: number;
}

/**
 * Player entity - represents both human and bot players
 * Player ALWAYS moves forward; input only changes direction
 */
export class Player {
  readonly id: number;
  readonly isBot: boolean;
  readonly color: string;

  pos: Vec2;
  dir: Vec2;
  speed: number;
  alive: boolean;

  // Current angle in radians (for smooth turning)
  angle: number;

  // Target angle (where we want to turn toward)
  targetAngle: number;

  // Tail for territory capture
  tail: Vec2[] = [];
  isDrawingTail: boolean = false;
  lastTailPoint: Vec2 | null = null;
  readonly tailPointDistance: number = 4; // Minimum distance between tail points

  // Camping timer (future phases)
  insideTerritoryTime: number = 0;

  // Stats (future phases)
  kills: number = 0;
  maxTerritoryPct: number = 0;
  timeAlive: number = 0;

  constructor(options: PlayerOptions) {
    this.id = options.id;
    this.isBot = options.isBot;
    this.color = options.color;
    this.pos = new Vec2(options.startX, options.startY);

    // Start moving to the right
    this.angle = 0;
    this.targetAngle = 0;
    this.dir = new Vec2(1, 0);

    this.speed = options.speed ?? gameConfig.player.speed;
    this.alive = true;
  }

  /**
   * Update player position - ALWAYS moves forward
   * @param dt Delta time in seconds
   */
  update(dt: number): void {
    if (!this.alive) return;

    // Smoothly interpolate angle toward target angle
    const turnSpeed = gameConfig.player.turnSpeed;
    let angleDiff = this.targetAngle - this.angle;

    // Normalize angle difference to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Apply turn speed limit
    const maxTurn = turnSpeed * dt;
    if (Math.abs(angleDiff) > maxTurn) {
      this.angle += Math.sign(angleDiff) * maxTurn;
    } else {
      this.angle = this.targetAngle;
    }

    // Update direction from angle
    this.dir.set(Math.cos(this.angle), Math.sin(this.angle));

    // ALWAYS move forward
    const moveX = this.dir.x * this.speed * dt;
    const moveY = this.dir.y * this.speed * dt;

    // Calculate new position
    let newX = this.pos.x + moveX;
    let newY = this.pos.y + moveY;

    // Clamp to arena bounds (allow player to reach edges for full map capture)
    // Player can overlap edge slightly so tail reaches edge tiles
    const edgeMargin = 2; // Small margin so player doesn't visually clip too much
    const minX = edgeMargin;
    const minY = edgeMargin;
    const maxX = derivedConfig.arenaWidthPx - edgeMargin;
    const maxY = derivedConfig.arenaHeightPx - edgeMargin;

    newX = Math.max(minX, Math.min(maxX, newX));
    newY = Math.max(minY, Math.min(maxY, newY));

    this.pos.set(newX, newY);

    // Track time alive
    this.timeAlive += dt;
  }

  /**
   * Set target direction toward a point (for mouse steering)
   * Player will smoothly turn toward this direction
   */
  setTargetDirectionToward(targetX: number, targetY: number): void {
    const dx = targetX - this.pos.x;
    const dy = targetY - this.pos.y;
    this.targetAngle = Math.atan2(dy, dx);
  }

  /**
   * Set target direction directly (for arrow key steering)
   * @param angle Angle in radians
   */
  setTargetAngle(angle: number): void {
    this.targetAngle = angle;
  }

  /**
   * Adjust target angle by a delta (for incremental turning with arrow keys)
   * @param delta Angle change in radians (positive = clockwise, negative = counter-clockwise)
   */
  adjustTargetAngle(delta: number): void {
    this.targetAngle += delta;
    // Normalize to [-PI, PI]
    while (this.targetAngle > Math.PI) this.targetAngle -= Math.PI * 2;
    while (this.targetAngle < -Math.PI) this.targetAngle += Math.PI * 2;
  }

  /**
   * Render the player on canvas (with camera offset) - Hexagonal tactical style
   */
  render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
    if (!this.alive) return;

    const { radius, borderColor } = gameConfig.player;

    // Screen position (relative to camera)
    const screenX = this.pos.x - cameraX;
    const screenY = this.pos.y - cameraY;

    // Draw hexagonal player icon
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(this.angle);

    // Hexagon path
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();

    // Fill with player color
    ctx.fillStyle = this.color;
    ctx.fill();

    // Border with glow effect
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw direction arrow inside hexagon
    ctx.beginPath();
    ctx.moveTo(radius * 0.6, 0); // Arrow tip pointing right (will be rotated)
    ctx.lineTo(-radius * 0.3, -radius * 0.35);
    ctx.lineTo(-radius * 0.1, 0);
    ctx.lineTo(-radius * 0.3, radius * 0.35);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();

    ctx.restore();
  }
}
