import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';

export default function MotionBackground() {
  // Smooth mouse parallax physics via motion.dev springs
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 30, stiffness: 60 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const handleMouseMove = (e) => {
      const { innerWidth, innerHeight } = window;
      // Calculate normalized offset from center (-1 to 1)
      const x = (e.clientX - innerWidth / 2) / (innerWidth / 2);
      const y = (e.clientY - innerHeight / 2) / (innerHeight / 2);
      mouseX.set(x * 35);
      mouseY.set(y * 35);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        background: '#0f1419'
      }}
      aria-hidden="true"
    >
      {/* Dynamic Base Gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 15%, #16222f 0%, #0f1419 80%)'
        }}
      />

      {/* Parallax Layer for Ambient Glowing Orbs */}
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          x: smoothX,
          y: smoothY
        }}
      >
        {/* Primary Electric Cyan Glowing Orb */}
        <motion.div
          animate={{
            scale: [1, 1.25, 0.9, 1],
            x: [-40, 50, -20, -40],
            y: [-30, 40, -50, -30],
            opacity: [0.15, 0.26, 0.18, 0.15]
          }}
          transition={{
            duration: 16,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          style={{
            position: 'absolute',
            top: '8%',
            left: '25%',
            width: '480px',
            height: '480px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #06b6d4 0%, rgba(6, 182, 212, 0) 70%)',
            filter: 'blur(70px)',
            willChange: 'transform, opacity'
          }}
        />

        {/* Deep Ocean Teal Pulse Orb */}
        <motion.div
          animate={{
            scale: [1.1, 0.85, 1.2, 1.1],
            x: [40, -50, 30, 40],
            y: [50, -40, 20, 50],
            opacity: [0.14, 0.22, 0.16, 0.14]
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          style={{
            position: 'absolute',
            bottom: '15%',
            right: '20%',
            width: '540px',
            height: '540px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #0891b2 0%, rgba(8, 145, 178, 0) 70%)',
            filter: 'blur(80px)',
            willChange: 'transform, opacity'
          }}
        />

        {/* Midnight Indigo Subtle Deep Core */}
        <motion.div
          animate={{
            scale: [0.9, 1.15, 1, 0.9],
            opacity: [0.2, 0.35, 0.25, 0.2]
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #1e3048 0%, rgba(30, 48, 72, 0) 70%)',
            filter: 'blur(90px)',
            willChange: 'transform, opacity'
          }}
        />
      </motion.div>

      {/* Harmonic Acoustic Soundwave Rings (Resonance Visualizer) */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '600px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {[0, 2.8, 5.6].map((delay, index) => (
          <motion.div
            key={index}
            animate={{
              scale: [0.35, 1.5],
              opacity: [0.25, 0]
            }}
            transition={{
              duration: 8.4,
              repeat: Infinity,
              delay: delay,
              ease: [0.22, 1, 0.36, 1] // Exponential decay wave
            }}
            style={{
              position: 'absolute',
              width: '420px',
              height: '420px',
              borderRadius: '50%',
              border: '1px solid rgba(34, 211, 238, 0.25)',
              boxShadow: '0 0 24px rgba(6, 182, 212, 0.08), inset 0 0 16px rgba(6, 182, 212, 0.05)',
              willChange: 'transform, opacity'
            }}
          />
        ))}
      </div>

      {/* Floating Micro Acoustic Particles */}
      {[
        { x: '18%', y: '25%', duration: 14, delay: 0 },
        { x: '78%', y: '20%', duration: 18, delay: 2 },
        { x: '35%', y: '75%', duration: 16, delay: 1 },
        { x: '82%', y: '65%', duration: 15, delay: 3 },
        { x: '50%', y: '85%', duration: 17, delay: 0.5 },
        { x: '12%', y: '60%', duration: 19, delay: 2.5 }
      ].map((pt, i) => (
        <motion.div
          key={i}
          animate={{
            y: ['0px', '-40px', '0px'],
            opacity: [0.15, 0.45, 0.15],
            scale: [0.8, 1.2, 0.8]
          }}
          transition={{
            duration: pt.duration,
            repeat: Infinity,
            delay: pt.delay,
            ease: 'easeInOut'
          }}
          style={{
            position: 'absolute',
            left: pt.x,
            top: pt.y,
            width: '3px',
            height: '3px',
            borderRadius: '50%',
            background: '#22d3ee',
            boxShadow: '0 0 8px #06b6d4',
            willChange: 'transform, opacity'
          }}
        />
      ))}

      {/* Subtle Analog Soundboard Grid Texture Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            radial-gradient(rgba(34, 211, 238, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
          opacity: 0.8
        }}
      />
    </div>
  );
}
