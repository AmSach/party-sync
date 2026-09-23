import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function ThreeBackground({ isAudioActive = false }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0c0b0a, 0.035);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 3.5, 6);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c0b0a, 1);
    container.appendChild(renderer.domElement);

    // 1. Undulating Lofi Audio Wireframe / Wave Plane
    const planeGeo = new THREE.PlaneGeometry(16, 16, 48, 48);
    planeGeo.rotateX(-Math.PI / 2);

    const pos = planeGeo.attributes.position;
    const initialY = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      initialY[i] = pos.getY(i);
    }

    // Material: Warm amber/bronze wireframe with soft points
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x92400e, // Warm deep amber
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    });
    const waveMesh = new THREE.Mesh(planeGeo, wireMat);
    waveMesh.position.y = -0.5;
    scene.add(waveMesh);

    // 2. Floating Lofi Dust Motes / Vinyl Particles
    const particleCount = 280;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 14;
      particlePositions[i * 3 + 1] = Math.random() * 5 - 0.5;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 14;
      particleVelocities[i] = 0.002 + Math.random() * 0.004;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    // Particle Material: Warm glowing ember dots
    const particleMat = new THREE.PointsMaterial({
      color: 0xf59e0b, // Golden amber glow
      size: 0.06,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });

    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // 3. Subtle Warm Ambient Studio Spotlight
    const amberLight = new THREE.PointLight(0xf59e0b, 2.5, 20);
    amberLight.position.set(0, 4, 2);
    scene.add(amberLight);

    const terracottaLight = new THREE.PointLight(0xe05a38, 1.8, 15);
    terracottaLight.position.set(-4, 2, -2);
    scene.add(terracottaLight);

    // Mouse Interaction
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const onMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMouseMove);

    // Window Resize
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // Animation Loop
    let clock = new THREE.Clock();
    let animId;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();
      const waveSpeed = isAudioActive ? 1.8 : 0.8;
      const waveAmp = isAudioActive ? 0.35 : 0.14;

      // Deform wave plane smoothly
      const positionAttr = planeGeo.attributes.position;
      for (let i = 0; i < positionAttr.count; i++) {
        const u = positionAttr.getX(i);
        const v = positionAttr.getZ(i);
        const dist = Math.sqrt(u * u + v * v);
        const y = Math.sin(dist * 1.5 - elapsedTime * waveSpeed) * waveAmp * Math.exp(-dist * 0.15)
                + Math.cos(u * 0.8 + elapsedTime * 0.5) * (waveAmp * 0.5);
        positionAttr.setY(i, y);
      }
      positionAttr.needsUpdate = true;

      // Drift particles upward like warm dust motes
      const pPositions = particleGeo.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        pPositions[i * 3 + 1] += particleVelocities[i];
        if (pPositions[i * 3 + 1] > 5) {
          pPositions[i * 3 + 1] = -0.5;
        }
      }
      particleGeo.attributes.position.needsUpdate = true;

      // Gentle camera parallax
      targetX += (mouseX * 0.4 - targetX) * 0.04;
      targetY += (-mouseY * 0.2 - targetY) * 0.04;
      camera.position.x = targetX;
      camera.position.y = 3.5 + targetY;
      camera.lookAt(0, 0.4, 0);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      planeGeo.dispose();
      wireMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, [isAudioActive]);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden'
      }}
    />
  );
}
