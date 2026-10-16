import React, { useRef } from 'react';
import { useBottomSheetGesture } from '../../hooks/useBottomSheetGesture';

export interface SheetControls {
  /** Toggles the mobile sheet between peek and expanded */
  toggleSnap: () => void;
  /** Attach to the scrollable body so drags inside it scroll instead of moving the sheet */
  contentRef: React.RefObject<HTMLDivElement | null>;
}

interface SheetPanelProps {
  onClose: () => void;
  onDragStateChange?: (offsetY: number, isDragging: boolean) => void;
  children: (sheet: SheetControls) => React.ReactNode;
}

/** Right-hand inspector on desktop, draggable bottom sheet (peek / expanded) on mobile. */
export const SheetPanel: React.FC<SheetPanelProps> = ({ onClose, onDragStateChange, children }) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const {
    snapState,
    setSnapState,
    dragOffsetY,
    isDragging,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  } = useBottomSheetGesture({
    onClose,
    onDragStateChange,
    contentRef
  });

  const toggleSnap = () => setSnapState((prev) => (prev === 'peek' ? 'expanded' : 'peek'));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        height:
          snapState === 'expanded' ? '82dvh' : 'calc(185px + env(safe-area-inset-bottom, 0px))',
        transform: onDragStateChange
          ? undefined
          : isDragging && dragOffsetY !== 0
          ? `translateY(${dragOffsetY}px)`
          : 'translateY(0px)',
        transition: isDragging
          ? 'none'
          : 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1), transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      }}
      className="glass-panel w-full md:w-72 lg:w-96 shadow-2xl flex flex-col md:!h-[calc(100vh-10.5rem)] md:!transform-none overflow-hidden pointer-events-auto rounded-t-2xl md:rounded-2xl border-t md:border-l border-white/15 relative"
    >
      {/* Mobile iOS Sheet Grab Handle */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          toggleSnap();
        }}
        className="md:hidden absolute top-1.5 inset-x-0 flex justify-center py-1 cursor-pointer select-none z-20 pointer-events-auto"
      >
        <div className="w-10 h-1 bg-white/25 rounded-full hover:bg-white/40 transition-colors" />
      </div>

      {children({ toggleSnap, contentRef })}
    </div>
  );
};
