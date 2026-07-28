'use client';

import { useRef, useState, useCallback } from 'react';

interface SwipeableItemProps {
  children: React.ReactNode;
  onSwipe: () => void;
  className?: string;
}

/**
 * SwipeableItem wraps any child in a touch-swipe container.
 * Swipe left > 80px threshold triggers onSwipe (dismiss).
 * Shows a red background behind as the user drags.
 */
export function SwipeableItem({ children, onSwipe, className = '' }: SwipeableItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = 0;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startXRef.current;
    // Only allow left swipes (negative values)
    const clamped = Math.min(0, diff);
    currentXRef.current = clamped;
    setOffsetX(clamped);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (currentXRef.current < -80) {
      onSwipe();
    }
    setOffsetX(0);
  }, [onSwipe]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {/* Red delete background */}
      <div className="absolute inset-0 bg-red-500 rounded-xl flex items-center justify-end pr-5 z-0">
        <span className="text-white text-sm font-medium">Dismiss</span>
      </div>
      {/* Foreground content */}
      <div
        className={`relative z-10 transition-transform ${swiping ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
