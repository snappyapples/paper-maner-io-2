/**
 * Simple 2D Vector class for game math
 */
export class Vec2 {
  constructor(
    public x: number = 0,
    public y: number = 0
  ) {}

  /** Create a copy of this vector */
  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  /** Set both components */
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /** Copy values from another vector */
  copy(v: Vec2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  /** Add another vector (mutates this) */
  add(v: Vec2): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /** Subtract another vector (mutates this) */
  sub(v: Vec2): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /** Multiply by scalar (mutates this) */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /** Get the length (magnitude) of this vector */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /** Get the squared length (avoids sqrt, useful for comparisons) */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Normalize this vector to length 1 (mutates this) */
  normalize(): this {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  /** Distance to another vector */
  distanceTo(v: Vec2): number {
    const dx = v.x - this.x;
    const dy = v.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Static: create from subtraction (a - b) */
  static sub(a: Vec2, b: Vec2): Vec2 {
    return new Vec2(a.x - b.x, a.y - b.y);
  }

  /** Static: create normalized direction from a to b */
  static direction(from: Vec2, to: Vec2): Vec2 {
    return Vec2.sub(to, from).normalize();
  }
}
