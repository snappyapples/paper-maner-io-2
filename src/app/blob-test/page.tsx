'use client';

import { useEffect, useRef } from 'react';

export default function BlobTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = 1200;
    canvas.height = 800;

    // Dark background with subtle texture
    ctx.fillStyle = '#3d4f5f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add very subtle noise texture
    addSubtleTexture(ctx, canvas.width, canvas.height);

    // Define blobs with bright saturated colors
    const blobs = [
      { cx: 300, cy: 280, color: '#4A90E2', size: 130 },   // Blue
      { cx: 780, cy: 200, color: '#F5A623', size: 110 },   // Orange
      { cx: 1000, cy: 520, color: '#E84393', size: 150 },  // Pink
      { cx: 480, cy: 620, color: '#2ECC71', size: 120 },   // Green
    ];

    // Draw each claymorphic blob
    blobs.forEach(blob => {
      drawClaymorphicBlob(ctx, blob.cx, blob.cy, blob.color, blob.size);
    });

  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#2c3e50',
      padding: 20
    }}>
      <canvas ref={canvasRef} style={{ borderRadius: 8 }} />
    </div>
  );
}

/**
 * Add micro-dot grain texture to background
 */
function addSubtleTexture(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Add grain noise
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 12;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
  ctx.putImageData(imageData, 0, 0);

  // Add scattered micro-dots
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.2 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw a claymorphic blob with soft 3D depth
 */
function drawClaymorphicBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseColor: string,
  size: number
) {
  // Parse color to RGB
  const rgb = hexToRgb(baseColor);

  // Generate smooth organic shape with MORE curve variation
  const points = generateBlobPoints(cx, cy, size, 8); // Fewer points = more dramatic curves
  const smoothed = smoothPoints(points, 4); // More smoothing iterations

  // 1. Draw stronger soft drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 8;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  drawSmoothShape(ctx, smoothed);
  ctx.fill();
  ctx.restore();

  // 2. Draw base shape with solid color first
  ctx.fillStyle = rgbToString(rgb);
  ctx.beginPath();
  drawSmoothShape(ctx, smoothed);
  ctx.fill();

  // 3. Draw INSET shadows (the key 3D effect from mockup!)
  drawInsetShadows(ctx, smoothed, cx, cy, size);

  // 4. Draw gentle contour rings
  drawGentleContours(ctx, smoothed, cx, cy, rgb);

  // 5. Add subtle highlight on top-left
  drawHighlight(ctx, smoothed, cx, cy, size);
}

/**
 * Draw INSET shadows to simulate CSS box-shadow: inset
 * This creates the raised 3D pillow effect
 */
function drawInsetShadows(
  ctx: CanvasRenderingContext2D,
  outline: { x: number; y: number }[],
  cx: number,
  cy: number,
  size: number
) {
  // Find bounding box for gradient positioning
  let minY = Infinity, maxY = -Infinity;
  for (const p of outline) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  // TOP INSET LIGHT - simulates light hitting top edge
  // Gradient from top edge going down
  const topGradient = ctx.createLinearGradient(cx, minY, cx, minY + size * 0.5);
  topGradient.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
  topGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
  topGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = topGradient;
  ctx.beginPath();
  drawSmoothShape(ctx, outline);
  ctx.fill();

  // BOTTOM INSET SHADOW - simulates shadow on bottom edge
  // Gradient from bottom edge going up
  const bottomGradient = ctx.createLinearGradient(cx, maxY, cx, maxY - size * 0.5);
  bottomGradient.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
  bottomGradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.12)');
  bottomGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = bottomGradient;
  ctx.beginPath();
  drawSmoothShape(ctx, outline);
  ctx.fill();

  // Add subtle dark border around edge (like CSS border: 2px solid rgba(0,0,0,0.2))
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  drawSmoothShape(ctx, outline);
  ctx.stroke();
}

/**
 * Draw sharp, defined contour rings
 */
function drawGentleContours(
  ctx: CanvasRenderingContext2D,
  outline: { x: number; y: number }[],
  cx: number,
  cy: number,
  baseColor: { r: number; g: number; b: number }
) {
  const scales = [0.82, 0.64, 0.46, 0.28];

  for (let i = 0; i < scales.length; i++) {
    const scale = scales[i];
    const opacity = 0.18 - i * 0.03; // More visible, defined rings

    const scaled = outline.map(p => ({
      x: cx + (p.x - cx) * scale,
      y: cy + (p.y - cy) * scale,
    }));

    // Sharp defined stroke
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    drawSmoothShape(ctx, scaled);
    ctx.stroke();
  }
}

/**
 * Draw highlight and inner glow for lighting effect
 */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  outline: { x: number; y: number }[],
  cx: number,
  cy: number,
  size: number
) {
  // Inner glow - lit from within effect
  const innerGlow = ctx.createRadialGradient(
    cx, cy, 0,
    cx, cy, size * 0.5
  );
  innerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
  innerGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
  innerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = innerGlow;
  ctx.beginPath();
  drawSmoothShape(ctx, outline);
  ctx.fill();

  // Top-left highlight
  const highlightGradient = ctx.createRadialGradient(
    cx - size * 0.35, cy - size * 0.35, 0,
    cx - size * 0.35, cy - size * 0.35, size * 0.5
  );
  highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = highlightGradient;
  ctx.beginPath();
  drawSmoothShape(ctx, outline);
  ctx.fill();
}

/**
 * Color utilities
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToString(color: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

function lightenColor(color: { r: number; g: number; b: number }, amount: number) {
  return {
    r: Math.min(255, color.r + amount),
    g: Math.min(255, color.g + amount),
    b: Math.min(255, color.b + amount),
  };
}

function darkenColor(color: { r: number; g: number; b: number }, amount: number) {
  return {
    r: Math.max(0, color.r - amount),
    g: Math.max(0, color.g - amount),
    b: Math.max(0, color.b - amount),
  };
}

/**
 * Generate organic blob points with dramatic curves like the mockup
 * Mimics CSS border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%
 */
function generateBlobPoints(
  cx: number,
  cy: number,
  baseSize: number,
  numPoints: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];

  // Create more dramatic, asymmetric variation like the CSS blob shapes
  // Use lower frequency harmonics for bigger, smoother curves
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;

    // Dramatic asymmetric variation (like border-radius: 30% 70% 70% 30%)
    const variation = 0.85 +
      Math.sin(angle * 1 + 0.5) * 0.18 +  // Large slow wave
      Math.cos(angle * 2 + 1.2) * 0.12 +  // Medium wave
      Math.sin(angle * 3 + 2.0) * 0.05;   // Small detail

    const radius = baseSize * variation;

    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  return points;
}

/**
 * Smooth points using Chaikin's algorithm
 */
function smoothPoints(
  points: { x: number; y: number }[],
  iterations: number
): { x: number; y: number }[] {
  let result = points;

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: { x: number; y: number }[] = [];
    const n = result.length;

    for (let i = 0; i < n; i++) {
      const p0 = result[i];
      const p1 = result[(i + 1) % n];

      newPoints.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
      });
      newPoints.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
      });
    }

    result = newPoints;
  }

  return result;
}

/**
 * Draw smooth closed shape using quadratic curves
 */
function drawSmoothShape(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[]
) {
  if (points.length < 3) return;

  const n = points.length;
  const startX = (points[n - 1].x + points[0].x) / 2;
  const startY = (points[n - 1].y + points[0].y) / 2;
  ctx.moveTo(startX, startY);

  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }

  ctx.closePath();
}
