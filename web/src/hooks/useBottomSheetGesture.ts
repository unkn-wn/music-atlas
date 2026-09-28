import React, { useState, useRef, useEffect, useCallback } from 'react';

export type BottomSheetSnapState = 'peek' | 'expanded';

interface UseBottomSheetGestureOptions {
  onClose: () => void;
  onDragStateChange?: (offsetY: number, isDragging: boolean) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function useBottomSheetGesture({
  onClose,
  onDragStateChange,
  contentRef
}: UseBottomSheetGestureOptions) {
  const [snapState, setSnapState] = useState<BottomSheetSnapState>('peek');
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const dragStartRef = useRef<{
    startY: number;
    startTime: number;
    initialSnap: BottomSheetSnapState;
    isContentScroll: boolean;
  } | null>(null);

  const handleDragUpdate = useCallback(
    (offset: number, dragging: boolean) => {
      setDragOffsetY(offset);
      setIsDragging(dragging);
      if (onDragStateChange) {
        onDragStateChange(offset, dragging);
      }
    },
    [onDragStateChange]
  );

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('textarea')
    ) {
      return;
    }

    const touch = e.touches[0];
    const isInsideContent = contentRef.current && contentRef.current.contains(target);
    const scrollTop = contentRef.current?.scrollTop || 0;

    dragStartRef.current = {
      startY: touch.clientY,
      startTime: Date.now(),
      initialSnap: snapState,
      isContentScroll: Boolean(isInsideContent && scrollTop > 0)
    };
    handleDragUpdate(0, true);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - dragStartRef.current.startY;
    const scrollTop = contentRef.current?.scrollTop || 0;

    if (dragStartRef.current.isContentScroll) {
      if (scrollTop <= 0 && deltaY > 0) {
        dragStartRef.current.isContentScroll = false;
        dragStartRef.current.startY = touch.clientY;
      } else {
        return;
      }
    }

    if (dragStartRef.current.initialSnap === 'expanded') {
      if (deltaY < 0) {
        // Rubber-band resistance when pulling up past expanded
        handleDragUpdate(deltaY * 0.2, true);
      } else {
        // Dragging downward towards peek
        handleDragUpdate(deltaY, true);
      }
    } else {
      // In peek mode
      if (deltaY < 0) {
        // Dragging upward towards expanded
        handleDragUpdate(deltaY, true);
      } else {
        // Dragging downward below peek with gentle damping
        handleDragUpdate(deltaY * 0.8, true);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaY = touch.clientY - dragStartRef.current.startY;
    const deltaTime = Math.max(1, Date.now() - dragStartRef.current.startTime);
    const velocityY = deltaY / deltaTime; // px/ms

    const initial = dragStartRef.current.initialSnap;
    dragStartRef.current = null;
    handleDragUpdate(0, false);

    if (initial === 'peek') {
      // From PEEK:
      // Dragging UP -> Snap to EXPANDED
      if (deltaY < -40 || velocityY < -0.3) {
        setSnapState('expanded');
      }
      // Dragging DOWN -> Dismiss ONLY if deliberately pulled down past 90px or fast downward swipe
      else if (deltaY > 90 || velocityY > 0.6) {
        onClose();
      }
      // Otherwise spring back to peek
    } else {
      // From EXPANDED:
      // Dragging DOWN -> ALWAYS snap to PEEK (never dismiss directly from expanded)
      if (deltaY > 60 || velocityY > 0.35) {
        setSnapState('peek');
      }
      // Otherwise spring back to expanded
    }
  };

  // Reset inner scroll when collapsing to peek
  useEffect(() => {
    if (snapState === 'peek' && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [snapState, contentRef]);

  return {
    snapState,
    setSnapState,
    dragOffsetY,
    isDragging,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  };
}
