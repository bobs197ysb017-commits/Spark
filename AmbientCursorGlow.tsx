import React, { useEffect, useRef } from 'react';
import type { AccentColor } from '../types/spark';

interface AmbientCursorGlowProps {
  accentColor: AccentColor;
}

const ACCENT_RGB: Record<AccentColor, string> = {
  violet: '139, 92, 246',
  blue: '59, 130, 246',
  cyan: '6, 182, 212',
  emerald: '16, 185, 129',
};

/**
 * Subtle pointer-reactive ambient glow that follows pointer direction and velocity
 * using smooth interpolation and fades out progressively when idle.
 * Automatically disabled on touch devices and prefers-reduced-motion.
 */
export const AmbientCursorGlow: React.FC<AmbientCursorGlowProps> = ({ accentColor }) => {
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (prefersReducedMotion || isCoarsePointer) {
      return;
    }

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let currentX = targetX;
    let currentY = targetY;
    let lastX = targetX;
    let lastY = targetY;
    let intensity = 0;
    let targetIntensity = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const onPointerMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      const dx = targetX - lastX;
      const dy = targetY - lastY;
      const speed = Math.min(45, Math.hypot(dx, dy));
      lastX = targetX;
      lastY = targetY;

      // Faster movement produces a slightly more noticeable response (capped gently)
      targetIntensity = Math.min(0.22, 0.08 + (speed / 45) * 0.14);

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        targetIntensity = 0;
      }, 280);
    };

    const tick = () => {
      currentX += (targetX - currentX) * 0.14;
      currentY += (targetY - currentY) * 0.14;
      intensity += (targetIntensity - intensity) * 0.09;

      if (glowRef.current) {
        const clampedOpacity = intensity < 0.004 ? 0 : Number(intensity.toFixed(3));
        glowRef.current.style.transform = `translate3d(${currentX - 260}px, ${currentY - 260}px, 0)`;
        glowRef.current.style.opacity = String(clampedOpacity);
      }
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (idleTimer) clearTimeout(idleTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const rgb = ACCENT_RGB[accentColor] || ACCENT_RGB.violet;

  return (
    <div
      ref={glowRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-0 w-[520px] h-[520px] rounded-full opacity-0 transition-none"
      style={{
        background: `radial-gradient(circle, rgba(${rgb}, 0.85) 0%, rgba(56, 189, 248, 0.35) 42%, rgba(0, 0, 0, 0) 72%)`,
        filter: 'blur(48px)',
        willChange: 'transform, opacity',
      }}
    />
  );
};
