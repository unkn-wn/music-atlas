import React, { useRef, useEffect } from 'react';
import { Compass } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

interface MinimapProps {
  nodes: AtlasNode[];
  onPanTo?: (x: number, y: number) => void;
}

export const Minimap: React.FC<MinimapProps> = ({ nodes }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Map coordinates: [-1000, 1000] -> [10, width - 10]
    nodes.forEach((node) => {
      const cx = ((node.x + 1000) / 2000) * (width - 20) + 10;
      const cy = ((node.y + 1000) / 2000) * (height - 20) + 10;

      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();
    });
  }, [nodes]);

  return (
    <div className="glass-panel p-2 shadow-2xl flex flex-col gap-1 pointer-events-auto">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 px-1">
        <Compass className="w-3 h-3 text-cyan-400" />
        <span>World Radar</span>
      </div>
      <div className="w-32 h-32 rounded-lg bg-black/40 overflow-hidden border border-white/10 flex items-center justify-center relative">
        <canvas
          ref={canvasRef}
          width={128}
          height={128}
          className="w-full h-full block"
        />
      </div>
    </div>
  );
};
