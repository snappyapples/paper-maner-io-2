import { gameConfig, derivedConfig } from './gameConfig';

interface Point {
  x: number;
  y: number;
}

/**
 * TerritoryMap - Manages tile ownership for the game arena
 * OPTIMIZED: Caches rendering with smooth contours
 */
export class TerritoryMap {
  private ownerMap: Uint8Array;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: number;

  // Cached tile counts per owner
  private tileCounts: Map<number, number> = new Map();

  // Cached territory canvas
  private cachedCanvas: HTMLCanvasElement | null = null;
  private cachedCtx: CanvasRenderingContext2D | null = null;
  private isDirty: boolean = true;

  // Throttle cache rebuilds for performance
  private lastRebuildTime: number = 0;
  private minRebuildInterval: number = 200; // ms between rebuilds (increased for performance)

  constructor() {
    this.widthTiles = gameConfig.arena.widthTiles;
    this.heightTiles = gameConfig.arena.heightTiles;
    this.tileSize = gameConfig.tileSize;

    this.ownerMap = new Uint8Array(this.widthTiles * this.heightTiles);
    this.initCachedCanvas();
  }

  private initCachedCanvas(): void {
    this.cachedCanvas = document.createElement('canvas');
    this.cachedCanvas.width = derivedConfig.arenaWidthPx;
    this.cachedCanvas.height = derivedConfig.arenaHeightPx;
    this.cachedCtx = this.cachedCanvas.getContext('2d')!;
  }

  worldToTile(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: Math.floor(worldX / this.tileSize),
      y: Math.floor(worldY / this.tileSize),
    };
  }

  tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
    return {
      x: tileX * this.tileSize + this.tileSize / 2,
      y: tileY * this.tileSize + this.tileSize / 2,
    };
  }

  getOwner(tileX: number, tileY: number): number {
    if (!this.isValidTile(tileX, tileY)) return -1;
    return this.ownerMap[tileY * this.widthTiles + tileX];
  }

  setOwner(tileX: number, tileY: number, ownerId: number): void {
    if (!this.isValidTile(tileX, tileY)) return;

    const idx = tileY * this.widthTiles + tileX;
    const oldOwner = this.ownerMap[idx];

    if (oldOwner === ownerId) return;

    if (oldOwner > 0) {
      this.tileCounts.set(oldOwner, (this.tileCounts.get(oldOwner) || 1) - 1);
    }
    if (ownerId > 0) {
      this.tileCounts.set(ownerId, (this.tileCounts.get(ownerId) || 0) + 1);
    }

    this.ownerMap[idx] = ownerId;
    this.isDirty = true;
  }

  isValidTile(tileX: number, tileY: number): boolean {
    return tileX >= 0 && tileX < this.widthTiles && tileY >= 0 && tileY < this.heightTiles;
  }

  getOwnerAtWorld(worldX: number, worldY: number): number {
    const tile = this.worldToTile(worldX, worldY);
    return this.getOwner(tile.x, tile.y);
  }

  generateStartingTerritory(centerX: number, centerY: number, ownerId: number, radius: number = 8): void {
    const centerTile = this.worldToTile(centerX, centerY);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tileX = centerTile.x + dx;
        const tileY = centerTile.y + dy;

        const distance = Math.sqrt(dx * dx + dy * dy);
        const noise = Math.sin(dx * 0.5) * Math.cos(dy * 0.7) * 2;
        const threshold = radius + noise;

        if (distance <= threshold) {
          this.setOwner(tileX, tileY, ownerId);
        }
      }
    }
  }

  countOwnedTiles(ownerId: number): number {
    return this.tileCounts.get(ownerId) || 0;
  }

  getTotalTiles(): number {
    return this.widthTiles * this.heightTiles;
  }

  getOwnershipPercentage(ownerId: number): number {
    return (this.countOwnedTiles(ownerId) / this.getTotalTiles()) * 100;
  }

  clearOwnerTerritory(ownerId: number): void {
    for (let i = 0; i < this.ownerMap.length; i++) {
      if (this.ownerMap[i] === ownerId) {
        this.ownerMap[i] = 0;
      }
    }
    this.tileCounts.set(ownerId, 0);
    this.isDirty = true;
  }

  /**
   * Transfer all territory from one owner to another (used when killing a player)
   */
  transferTerritory(fromOwnerId: number, toOwnerId: number): void {
    for (let i = 0; i < this.ownerMap.length; i++) {
      if (this.ownerMap[i] === fromOwnerId) {
        this.ownerMap[i] = toOwnerId;
      }
    }
    // Update tile counts
    const fromCount = this.tileCounts.get(fromOwnerId) || 0;
    this.tileCounts.set(toOwnerId, (this.tileCounts.get(toOwnerId) || 0) + fromCount);
    this.tileCounts.set(fromOwnerId, 0);
    this.isDirty = true;
  }

  /**
   * Get all border tiles for an owner (tiles with at least one non-owned neighbor)
   */
  getBorderTiles(ownerId: number): { x: number; y: number }[] {
    const borderTiles: { x: number; y: number }[] = [];

    for (let y = 0; y < this.heightTiles; y++) {
      for (let x = 0; x < this.widthTiles; x++) {
        if (this.ownerMap[y * this.widthTiles + x] !== ownerId) continue;

        // Check if any neighbor is not owned by this player
        const hasNonOwnedNeighbor =
          this.getOwner(x - 1, y) !== ownerId ||
          this.getOwner(x + 1, y) !== ownerId ||
          this.getOwner(x, y - 1) !== ownerId ||
          this.getOwner(x, y + 1) !== ownerId;

        if (hasNonOwnedNeighbor) {
          borderTiles.push({ x, y });
        }
      }
    }

    return borderTiles;
  }

  render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewportWidth: number, viewportHeight: number): void {
    // Throttle cache rebuilds to avoid lag spikes
    const now = performance.now();
    if (this.isDirty && (now - this.lastRebuildTime) > this.minRebuildInterval) {
      this.rebuildCache();
      this.isDirty = false;
      this.lastRebuildTime = now;
    }

    if (this.cachedCanvas) {
      const sx = Math.max(0, cameraX);
      const sy = Math.max(0, cameraY);
      const sw = Math.min(viewportWidth, derivedConfig.arenaWidthPx - sx);
      const sh = Math.min(viewportHeight, derivedConfig.arenaHeightPx - sy);
      const dx = Math.max(0, -cameraX);
      const dy = Math.max(0, -cameraY);

      if (sw > 0 && sh > 0) {
        ctx.drawImage(this.cachedCanvas, sx, sy, sw, sh, dx, dy, sw, sh);
      }
    }
  }

  private rebuildCache(): void {
    if (!this.cachedCtx || !this.cachedCanvas) return;

    const ctx = this.cachedCtx;
    const { tileSize } = this;
    const canvasWidth = this.cachedCanvas.width;
    const canvasHeight = this.cachedCanvas.height;

    // Use ImageData for fast pixel-level rendering
    const imageData = ctx.createImageData(canvasWidth, canvasHeight);
    const data = imageData.data;

    // Pre-parse colors for all owners
    const ownerColors: Map<number, { r: number; g: number; b: number }> = new Map();

    // Single pass through tiles - much faster than per-owner iteration
    for (let tileY = 0; tileY < this.heightTiles; tileY++) {
      for (let tileX = 0; tileX < this.widthTiles; tileX++) {
        const ownerId = this.ownerMap[tileY * this.widthTiles + tileX];
        if (ownerId === 0) continue;

        // Get or parse color
        let color = ownerColors.get(ownerId);
        if (!color) {
          color = this.hexToRgb(this.getOwnerColor(ownerId));
          ownerColors.set(ownerId, color);
        }

        // Fill the tile pixels directly in ImageData
        const startPx = tileX * tileSize;
        const startPy = tileY * tileSize;
        const endPx = Math.min(startPx + tileSize, canvasWidth);
        const endPy = Math.min(startPy + tileSize, canvasHeight);

        for (let py = startPy; py < endPy; py++) {
          for (let px = startPx; px < endPx; px++) {
            const idx = (py * canvasWidth + px) * 4;
            data[idx] = color.r;
            data[idx + 1] = color.g;
            data[idx + 2] = color.b;
            data[idx + 3] = 255;
          }
        }
      }
    }

    // Put the image data
    ctx.putImageData(imageData, 0, 0);

    // Add simple border effects per owner (much simpler than before)
    const owners = new Set<number>();
    for (let i = 0; i < this.ownerMap.length; i++) {
      if (this.ownerMap[i] > 0) owners.add(this.ownerMap[i]);
    }

    // Draw simple borders for each owner
    ctx.lineWidth = 2;
    for (const ownerId of owners) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      this.drawSimpleBorder(ctx, ownerId);
    }
  }

  /**
   * Draw a simple border around owner territory (fast version)
   */
  private drawSimpleBorder(ctx: CanvasRenderingContext2D, ownerId: number): void {
    const { tileSize } = this;

    ctx.beginPath();

    // Only draw border segments where there's an edge
    for (let tileY = 0; tileY < this.heightTiles; tileY++) {
      for (let tileX = 0; tileX < this.widthTiles; tileX++) {
        if (this.ownerMap[tileY * this.widthTiles + tileX] !== ownerId) continue;

        const px = tileX * tileSize;
        const py = tileY * tileSize;

        // Check each edge
        if (this.getOwner(tileX, tileY - 1) !== ownerId) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + tileSize, py);
        }
        if (this.getOwner(tileX, tileY + 1) !== ownerId) {
          ctx.moveTo(px, py + tileSize);
          ctx.lineTo(px + tileSize, py + tileSize);
        }
        if (this.getOwner(tileX - 1, tileY) !== ownerId) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + tileSize);
        }
        if (this.getOwner(tileX + 1, tileY) !== ownerId) {
          ctx.moveTo(px + tileSize, py);
          ctx.lineTo(px + tileSize, py + tileSize);
        }
      }
    }

    ctx.stroke();
  }

  private getOwnerColor(ownerId: number): string {
    const colors: { [key: number]: string } = {
      1: '#3b82f6',  // Human - blue
      2: '#22c55e',  // Bot 1 - green
      3: '#f59e0b',  // Bot 2 - orange
      4: '#ec4899',  // Bot 3 - pink
      5: '#8b5cf6',  // Bot 4 - purple
      6: '#14b8a6',  // Bot 5 - teal
      7: '#f43f5e',  // Bot 6 - rose
      8: '#06b6d4',  // Bot 7 - cyan
      9: '#84cc16',  // Bot 8 - lime
      10: '#eab308', // Bot 9 - yellow
      11: '#ef4444', // Bot 10 - red
      12: '#a855f7', // Bot 11 - violet
      13: '#0ea5e9', // Bot 12 - sky blue
      14: '#10b981', // Bot 13 - emerald
      15: '#f97316', // Bot 14 - orange-bright
      16: '#d946ef', // Bot 15 - fuchsia
      17: '#6366f1', // Bot 16 - indigo
      18: '#fb7185', // Bot 17 - pink-light
      19: '#2dd4bf', // Bot 18 - teal-light
      20: '#a3e635', // Bot 19 - lime-bright
    };
    return colors[ownerId] || '#9ca3af';
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 156, g: 163, b: 175 };
  }
}
