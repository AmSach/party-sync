import React, { useEffect, useRef } from 'react';

export default function Visualizer({ analyser, active = true, height = 90 }) {
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
        // Idle animation
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = active ? Math.sin(Date.now() / 200 + i) * 20 + 25 : 0;
        }
      }

      const barCount = 36;
      const barWidth = (width / barCount) * 0.75;
      const gap = (width / barCount) * 0.25;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i % dataArray.length];
        const barHeight = Math.max(4, (val / 255) * h * 0.9);

        const x = i * (barWidth + gap);
        const y = h - barHeight;

        // Gradient coloring: Cyan to Magenta
        const gradient = ctx.createLinearGradient(0, h, 0, y);
        gradient.addColorStop(0, '#00f5ff');
        gradient.addColorStop(0.6, '#9d4edd');
        gradient.addColorStop(1, '#ff007a');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
        ctx.fill();

        // Top glow dot
        if (barHeight > 10) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, y + 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, active]);

  return (
    <div style={{ width: '100%', height: `${height}px`, overflow: 'hidden', borderRadius: '12px' }}>
      <canvas
        ref={canvasRef}
        width={600}
        height={height}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
