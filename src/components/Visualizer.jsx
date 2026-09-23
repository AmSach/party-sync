import React, { useEffect, useRef } from 'react';

export default function Visualizer({ analyser, active = true, height = 70 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 32);

    const render = () => {
      animationId = requestAnimationFrame(render);

      const width = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, width, h);

      if (analyser && active) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Subtle ambient idle breathing
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = active ? Math.sin(Date.now() / 250 + i * 0.4) * 16 + 22 : 0;
        }
      }

      // Segmented VU meter bars
      const barCount = 28;
      const barWidth = (width / barCount) * 0.72;
      const gap = (width / barCount) * 0.28;
      const segmentHeight = 4;
      const segmentGap = 2;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i % dataArray.length];
        const barHeight = Math.max(segmentHeight, (val / 255) * h * 0.92);
        const segments = Math.floor(barHeight / (segmentHeight + segmentGap));

        const x = i * (barWidth + gap);

        for (let s = 0; s < segments; s++) {
          const y = h - (s + 1) * (segmentHeight + segmentGap);
          const ratio = s / (h / (segmentHeight + segmentGap));

          // Teal/Cyan color gradient: deep cyan rising into bright teal, danger red at peak
          if (ratio > 0.8) {
            ctx.fillStyle = '#ef4444'; // Red Peak (clipping warning)
          } else if (ratio > 0.5) {
            ctx.fillStyle = '#22d3ee'; // Bright Cyan
          } else {
            ctx.fillStyle = '#0891b2'; // Deep Teal
          }

          ctx.fillRect(x, y, barWidth, segmentHeight);
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, active]);

  return (
    <div style={{ 
      width: '100%', 
      height: `${height}px`, 
      overflow: 'hidden', 
      borderRadius: '10px',
      background: '#080e14',
      border: '1px solid #1a2838',
      padding: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4) inset'
    }}>
      <canvas
        ref={canvasRef}
        width={560}
        height={height - 8}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
