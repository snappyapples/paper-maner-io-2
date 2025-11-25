'use client';

import { useEffect, useRef } from 'react';
import { Game } from '@/game/Game';

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create and start game
    const game = new Game(canvas);
    gameRef.current = game;
    game.start();

    // Cleanup on unmount
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
      }}
    />
  );
}
