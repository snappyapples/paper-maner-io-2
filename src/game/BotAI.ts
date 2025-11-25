import { Player } from './Player';
import { TerritoryMap } from './TerritoryMap';
import { Vec2 } from './Vec2';
import { derivedConfig, gameConfig } from './gameConfig';

type BotState = 'expand' | 'harass' | 'retreat' | 'flee' | 'wander';

/**
 * BotAI - Controls a bot player with intelligent autonomous behavior
 *
 * States:
 * - expand: Moving outward to capture neutral/enemy territory
 * - harass: Actively hunting enemy tails (especially human)
 * - retreat: Heading back to own territory to complete capture
 * - flee: Running away from danger (enemy near our tail)
 * - wander: Moving around within own territory (brief rest)
 */
export class BotAI {
  player: Player;
  private territoryMap: TerritoryMap;
  private allPlayers: Player[] = [];
  private state: BotState = 'wander';

  // Target point for movement
  private targetX: number = 0;
  private targetY: number = 0;

  // Target player (for harass state)
  private targetPlayer: Player | null = null;

  // Decision timer
  private decisionTimer: number = 0;
  private decisionInterval: number = 0.3; // Faster decisions for smarter behavior

  // Personality traits (randomized per bot)
  private aggression: number; // 0-1, higher = more likely to harass
  private caution: number; // 0-1, higher = retreats earlier
  private maxTailLength: number;
  private expansionDistance: number;

  // Danger tracking
  private dangerLevel: number = 0;

  constructor(player: Player, territoryMap: TerritoryMap) {
    this.player = player;
    this.territoryMap = territoryMap;

    // Give each bot unique personality - MORE AGGRESSIVE overall
    this.aggression = 0.5 + Math.random() * 0.5; // 0.5 - 1.0 (much more aggressive)
    this.caution = 0.25 + Math.random() * 0.35; // 0.25 - 0.6 (less cautious)
    this.maxTailLength = 20 + Math.floor(Math.random() * 30); // 20-50 tail points (bolder)
    this.expansionDistance = 100 + Math.random() * 150; // 100-250 pixels (ventures further)

    this.pickNewTarget();
  }

  /**
   * Set reference to all players for awareness
   */
  setAllPlayers(players: Player[]): void {
    this.allPlayers = players;
  }

  /**
   * Update bot AI - call this every frame
   */
  update(dt: number): void {
    this.decisionTimer += dt;

    // Make decisions at regular intervals
    if (this.decisionTimer >= this.decisionInterval) {
      this.decisionTimer = 0;
      this.assessSituation();
      this.makeDecision();
    }

    // Always steer toward current target
    this.player.setTargetDirectionToward(this.targetX, this.targetY);
  }

  /**
   * Assess the current situation and update danger level
   */
  private assessSituation(): void {
    this.dangerLevel = 0;

    // Check for nearby enemies when we have a tail
    if (this.player.tail.length > 3) {
      for (const other of this.allPlayers) {
        if (!other.alive || other.id === this.player.id) continue;

        // Distance to our tail
        const distToTail = this.getDistanceToOurTail(other);
        if (distToTail < 100) {
          this.dangerLevel += (100 - distToTail) / 100;
        }
      }
    }

    // Check if we're near arena edge
    const margin = 80;
    const { pos } = this.player;
    if (pos.x < margin || pos.x > derivedConfig.arenaWidthPx - margin ||
        pos.y < margin || pos.y > derivedConfig.arenaHeightPx - margin) {
      this.dangerLevel += 0.3;
    }
  }

  /**
   * Main decision-making logic
   */
  private makeDecision(): void {
    const isInOwnTerritory = this.isInOwnTerritory();
    const tailLength = this.player.tail.length;
    const tailThreshold = this.maxTailLength * this.caution;

    // Priority 1: FLEE if in danger with a tail
    if (this.dangerLevel > 0.5 && tailLength > 5) {
      this.state = 'flee';
      this.pickFleeTarget();
      return;
    }

    // Priority 2: RETREAT if tail is getting long
    if (tailLength > tailThreshold) {
      this.state = 'retreat';
      this.pickReturnTarget();
      return;
    }

    // Priority 3: Check for harassment opportunity - VERY aggressive when targets have tails
    const harassTarget = this.findHarassTarget();
    if (harassTarget) {
      // Much more likely to harass if target has a long tail
      let harassChance = this.aggression;
      if (harassTarget.tail.length > 10) {
        harassChance = Math.min(1.0, this.aggression + 0.4); // Very likely to attack long tails
      } else if (harassTarget.tail.length > 5) {
        harassChance = Math.min(1.0, this.aggression + 0.2);
      }
      // Human player with ANY tail is always tempting
      if (harassTarget.id === 1 && harassTarget.tail.length > 0) {
        harassChance = Math.min(1.0, harassChance + 0.3);
      }

      if (Math.random() < harassChance) {
        this.state = 'harass';
        this.targetPlayer = harassTarget;
        this.pickHarassTarget();
        return;
      }
    }

    // State-specific behavior
    switch (this.state) {
      case 'wander':
        if (isInOwnTerritory && tailLength === 0) {
          // In safe territory, decide next action
          if (Math.random() < 0.6) {
            this.state = 'expand';
            this.pickExpansionTarget();
          } else {
            this.pickWanderTarget();
          }
        } else if (!isInOwnTerritory) {
          this.state = 'retreat';
          this.pickReturnTarget();
        }
        break;

      case 'expand':
        if (isInOwnTerritory && tailLength === 0) {
          // Completed a capture, decide next action
          if (Math.random() < 0.7) {
            this.pickExpansionTarget();
          } else {
            this.state = 'wander';
            this.pickWanderTarget();
          }
        } else if (this.isNearTarget()) {
          // Reached expansion point
          if (Math.random() < 0.5 && tailLength < tailThreshold * 0.7) {
            this.pickExpansionTarget();
          } else {
            this.state = 'retreat';
            this.pickReturnTarget();
          }
        }
        break;

      case 'harass':
        if (isInOwnTerritory && tailLength === 0) {
          // Back safe, re-evaluate
          const newTarget = this.findHarassTarget();
          if (newTarget && Math.random() < this.aggression * 1.5) {
            this.targetPlayer = newTarget;
            this.pickHarassTarget();
          } else {
            this.state = 'expand';
            this.pickExpansionTarget();
          }
        } else if (this.targetPlayer && !this.targetPlayer.alive) {
          // Target died, retreat
          this.state = 'retreat';
          this.pickReturnTarget();
        } else if (this.isNearTarget() || tailLength > tailThreshold * 0.8) {
          this.state = 'retreat';
          this.pickReturnTarget();
        }
        break;

      case 'retreat':
        if (isInOwnTerritory && tailLength === 0) {
          this.state = 'wander';
          this.pickWanderTarget();
        } else if (!isInOwnTerritory) {
          this.pickReturnTarget();
        }
        break;

      case 'flee':
        if (isInOwnTerritory && tailLength === 0) {
          this.state = 'wander';
          this.pickWanderTarget();
        } else if (this.dangerLevel < 0.3) {
          this.state = 'retreat';
          this.pickReturnTarget();
        } else {
          this.pickFleeTarget();
        }
        break;
    }

    // Safety checks
    this.avoidBoundaries();
    this.avoidOwnTail();
  }

  /**
   * Find a good target to harass (prioritize human, then bots with tails)
   * Much more aggressive - longer tails = higher priority target
   */
  private findHarassTarget(): Player | null {
    let bestTarget: Player | null = null;
    let bestScore = 0;

    for (const other of this.allPlayers) {
      if (!other.alive || other.id === this.player.id) continue;

      const dist = this.getDistanceTo(other);
      if (dist > 600) continue; // Increased range - more aggressive pursuit

      let score = 0;

      // HEAVILY prioritize players with tails - longer tail = much more vulnerable
      if (other.tail.length > 3) {
        // Exponential scoring for tail length - long tails are prime targets
        score += 40 + other.tail.length * 3;

        // Check distance to their tail BASE (most vulnerable point)
        if (other.tail.length > 0) {
          const tailBase = other.tail[0]; // First point is near their territory
          const distToBase = Math.sqrt(
            Math.pow(this.player.pos.x - tailBase.x, 2) +
            Math.pow(this.player.pos.y - tailBase.y, 2)
          );
          // Big bonus if we're close to the undefended tail base
          if (distToBase < 300) {
            score += (300 - distToBase) / 2;
          }
        }
      }

      // Prioritize human player significantly
      if (other.id === 1) {
        score += 50;
        // Extra bonus if human has any tail at all
        if (other.tail.length > 0) {
          score += 30;
        }
      }

      // Prefer closer targets
      score += Math.max(0, (600 - dist) / 5);

      // Prefer players with more territory (bigger reward)
      const theirTerritory = this.territoryMap.getOwnershipPercentage(other.id);
      score += theirTerritory * 3;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = other;
      }
    }

    // Lower threshold to trigger harassment more often
    return bestScore > 25 ? bestTarget : null;
  }

  /**
   * Get distance from enemy to our tail (closest point)
   */
  private getDistanceToOurTail(enemy: Player): number {
    if (this.player.tail.length === 0) return Infinity;

    let minDist = Infinity;
    for (const point of this.player.tail) {
      const dx = enemy.pos.x - point.x;
      const dy = enemy.pos.y - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  /**
   * Get distance to another player
   */
  private getDistanceTo(other: Player): number {
    const dx = other.pos.x - this.player.pos.x;
    const dy = other.pos.y - this.player.pos.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if bot is in its own territory
   */
  private isInOwnTerritory(): boolean {
    const tile = this.territoryMap.worldToTile(this.player.pos.x, this.player.pos.y);
    return this.territoryMap.getOwner(tile.x, tile.y) === this.player.id;
  }

  /**
   * Check if near current target
   */
  private isNearTarget(): boolean {
    const dx = this.targetX - this.player.pos.x;
    const dy = this.targetY - this.player.pos.y;
    return Math.sqrt(dx * dx + dy * dy) < 30;
  }

  /**
   * Pick a target to harass an enemy's tail
   * Prioritizes the BASE of the tail (near their territory) - it's undefended!
   */
  private pickHarassTarget(): void {
    if (!this.targetPlayer || this.targetPlayer.tail.length === 0) {
      // No tail to target, go to their position to intercept
      if (this.targetPlayer) {
        // Predict where they might be going
        this.targetX = this.targetPlayer.pos.x + this.targetPlayer.dir.x * 50;
        this.targetY = this.targetPlayer.pos.y + this.targetPlayer.dir.y * 50;
      }
      return;
    }

    const tail = this.targetPlayer.tail;

    // TARGET THE BASE OF THE TAIL - it's far from their head and undefended!
    // The longer their tail, the more we target the very beginning
    let targetIdx: number;
    if (tail.length > 20) {
      // Long tail - go for the very base (first 20%)
      targetIdx = Math.floor(tail.length * 0.15);
    } else if (tail.length > 10) {
      // Medium tail - target first 30%
      targetIdx = Math.floor(tail.length * 0.25);
    } else {
      // Short tail - target first 40%
      targetIdx = Math.floor(tail.length * 0.35);
    }

    const tailPoint = tail[Math.min(targetIdx, tail.length - 1)];
    this.targetX = tailPoint.x;
    this.targetY = tailPoint.y;
  }

  /**
   * Pick a target to flee from danger
   */
  private pickFleeTarget(): void {
    // Find the nearest threat
    let nearestThreat: Player | null = null;
    let nearestDist = Infinity;

    for (const other of this.allPlayers) {
      if (!other.alive || other.id === this.player.id) continue;

      const distToTail = this.getDistanceToOurTail(other);
      if (distToTail < nearestDist) {
        nearestDist = distToTail;
        nearestThreat = other;
      }
    }

    if (nearestThreat) {
      // Run away from threat, toward own territory
      const awayAngle = Math.atan2(
        this.player.pos.y - nearestThreat.pos.y,
        this.player.pos.x - nearestThreat.pos.x
      );

      // Blend with return direction
      const returnTarget = this.getClosestOwnedTile();
      if (returnTarget) {
        const returnAngle = Math.atan2(
          returnTarget.y - this.player.pos.y,
          returnTarget.x - this.player.pos.x
        );

        // 60% away from threat, 40% toward home
        const blendAngle = awayAngle * 0.6 + returnAngle * 0.4;
        this.targetX = this.player.pos.x + Math.cos(blendAngle) * 150;
        this.targetY = this.player.pos.y + Math.sin(blendAngle) * 150;
      } else {
        this.targetX = this.player.pos.x + Math.cos(awayAngle) * 150;
        this.targetY = this.player.pos.y + Math.sin(awayAngle) * 150;
      }
    } else {
      this.pickReturnTarget();
    }

    this.clampTargetToArena();
  }

  /**
   * Pick a random point within own territory to wander to
   */
  private pickWanderTarget(): void {
    const ownedTiles = this.getOwnedTiles();

    if (ownedTiles.length > 0) {
      const randomTile = ownedTiles[Math.floor(Math.random() * ownedTiles.length)];
      const worldPos = this.territoryMap.tileToWorld(randomTile.x, randomTile.y);
      this.targetX = worldPos.x;
      this.targetY = worldPos.y;
    } else {
      this.targetX = this.player.pos.x + (Math.random() - 0.5) * 200;
      this.targetY = this.player.pos.y + (Math.random() - 0.5) * 200;
    }
  }

  /**
   * Pick a target outside own territory for expansion
   * Prefers neutral territory, then enemy territory
   */
  private pickExpansionTarget(): void {
    // Try to find neutral or enemy territory nearby
    const bestTarget = this.findBestExpansionDirection();

    if (bestTarget) {
      this.targetX = bestTarget.x;
      this.targetY = bestTarget.y;
    } else {
      // Fallback: random direction
      const angle = Math.random() * Math.PI * 2;
      const distance = this.expansionDistance * (0.5 + Math.random() * 0.5);
      this.targetX = this.player.pos.x + Math.cos(angle) * distance;
      this.targetY = this.player.pos.y + Math.sin(angle) * distance;
    }

    this.clampTargetToArena();
  }

  /**
   * Find the best direction to expand (toward neutral/enemy territory)
   */
  private findBestExpansionDirection(): { x: number; y: number } | null {
    const sampleDirections = 8;
    let bestScore = -Infinity;
    let bestTarget: { x: number; y: number } | null = null;

    for (let i = 0; i < sampleDirections; i++) {
      const angle = (i / sampleDirections) * Math.PI * 2;
      const distance = this.expansionDistance;
      const testX = this.player.pos.x + Math.cos(angle) * distance;
      const testY = this.player.pos.y + Math.sin(angle) * distance;

      // Score this direction
      let score = 0;
      const tile = this.territoryMap.worldToTile(testX, testY);

      if (this.territoryMap.isValidTile(tile.x, tile.y)) {
        const owner = this.territoryMap.getOwner(tile.x, tile.y);

        if (owner === 0) {
          score += 10; // Neutral territory is good
        } else if (owner !== this.player.id) {
          score += 15; // Enemy territory is better
        } else {
          score -= 20; // Own territory is bad (no expansion)
        }

        // Bonus for being away from edges
        const edgeDist = Math.min(
          testX, testY,
          derivedConfig.arenaWidthPx - testX,
          derivedConfig.arenaHeightPx - testY
        );
        score += edgeDist / 50;
      } else {
        score -= 100; // Invalid tile
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { x: testX, y: testY };
      }
    }

    return bestTarget;
  }

  /**
   * Pick a target back in own territory
   */
  private pickReturnTarget(): void {
    const closestTile = this.getClosestOwnedTile();

    if (closestTile) {
      this.targetX = closestTile.x;
      this.targetY = closestTile.y;
    } else {
      // No territory, head to center
      this.targetX = derivedConfig.arenaWidthPx / 2;
      this.targetY = derivedConfig.arenaHeightPx / 2;
    }
  }

  /**
   * Get closest owned tile position
   */
  private getClosestOwnedTile(): { x: number; y: number } | null {
    const ownedTiles = this.getOwnedTiles();

    if (ownedTiles.length === 0) return null;

    let closestDist = Infinity;
    let closestPos = { x: 0, y: 0 };

    for (const tile of ownedTiles) {
      const worldPos = this.territoryMap.tileToWorld(tile.x, tile.y);
      const dx = worldPos.x - this.player.pos.x;
      const dy = worldPos.y - this.player.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestPos = worldPos;
      }
    }

    return closestPos;
  }

  /**
   * Get list of tiles owned by this bot
   */
  private getOwnedTiles(): { x: number; y: number }[] {
    const tiles: { x: number; y: number }[] = [];
    const step = 4; // Sample every 4th tile for performance

    for (let y = 0; y < this.territoryMap.heightTiles; y += step) {
      for (let x = 0; x < this.territoryMap.widthTiles; x += step) {
        if (this.territoryMap.getOwner(x, y) === this.player.id) {
          tiles.push({ x, y });
        }
      }
    }

    return tiles;
  }

  /**
   * Avoid arena boundaries by adjusting target
   */
  private avoidBoundaries(): void {
    const margin = 60;
    const arenaW = derivedConfig.arenaWidthPx;
    const arenaH = derivedConfig.arenaHeightPx;
    const { pos } = this.player;

    if (pos.x < margin && this.targetX < pos.x) {
      this.targetX = pos.x + 120;
    }
    if (pos.x > arenaW - margin && this.targetX > pos.x) {
      this.targetX = pos.x - 120;
    }
    if (pos.y < margin && this.targetY < pos.y) {
      this.targetY = pos.y + 120;
    }
    if (pos.y > arenaH - margin && this.targetY > pos.y) {
      this.targetY = pos.y - 120;
    }
  }

  /**
   * Avoid own tail by adjusting target if on collision course
   */
  private avoidOwnTail(): void {
    if (this.player.tail.length < 5) return;

    const lookAhead = 60;
    const futureX = this.player.pos.x + this.player.dir.x * lookAhead;
    const futureY = this.player.pos.y + this.player.dir.y * lookAhead;

    for (let i = 0; i < this.player.tail.length - 4; i++) {
      const tailPoint = this.player.tail[i];
      const dx = futureX - tailPoint.x;
      const dy = futureY - tailPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 35) {
        // Turn away from tail
        const awayAngle = Math.atan2(
          this.player.pos.y - tailPoint.y,
          this.player.pos.x - tailPoint.x
        );
        this.targetX = this.player.pos.x + Math.cos(awayAngle) * 100;
        this.targetY = this.player.pos.y + Math.sin(awayAngle) * 100;
        this.clampTargetToArena();
        return;
      }
    }
  }

  /**
   * Pick a new random target (fallback)
   */
  private pickNewTarget(): void {
    this.targetX = this.player.pos.x + (Math.random() - 0.5) * 200;
    this.targetY = this.player.pos.y + (Math.random() - 0.5) * 200;
    this.clampTargetToArena();
  }

  /**
   * Clamp target to arena bounds
   */
  private clampTargetToArena(): void {
    const margin = 40;
    this.targetX = Math.max(margin, Math.min(derivedConfig.arenaWidthPx - margin, this.targetX));
    this.targetY = Math.max(margin, Math.min(derivedConfig.arenaHeightPx - margin, this.targetY));
  }
}
