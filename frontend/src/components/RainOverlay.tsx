"use client";

import React, { useEffect, useRef } from "react";

interface RainOverlayProps {
  precipitation?: number; // mm of precipitation
  intensity?: "light" | "moderate" | "heavy";
}

interface Drop {
  x: number;
  y: number;
  length: number;
  speed: number;
  thickness: number;
  opacity: number;
  layer: "near" | "mid" | "far";
}

interface Splash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

export default function RainOverlay({ precipitation = 10, intensity }: RainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Support Retina / HiDPI screens
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    window.addEventListener("resize", handleResize);

    // Determine drop count based on precipitation rate
    let dropCount = 180;
    if (intensity === "heavy" || precipitation > 10) {
      dropCount = 320;
    } else if (intensity === "light" || precipitation < 2.5) {
      dropCount = 100;
    }

    // Slanted angle: ~14 degrees (wind blowing south-east across Bay of Bengal)
    const angleRad = (14 * Math.PI) / 180;
    const sinAngle = Math.sin(angleRad);
    const cosAngle = Math.cos(angleRad);

    // Initialize drops across 3 parallax layers (far, mid, near)
    const drops: Drop[] = [];
    for (let i = 0; i < dropCount; i++) {
      const rand = Math.random();
      let layer: "near" | "mid" | "far" = "mid";
      let speed = 18 + Math.random() * 8;
      let length = 24 + Math.random() * 16;
      let thickness = 1.2;
      let opacity = 0.4 + Math.random() * 0.3;

      if (rand < 0.35) {
        // Far misty layer: faint, thin, slower
        layer = "far";
        speed = 12 + Math.random() * 6;
        length = 14 + Math.random() * 12;
        thickness = 0.8;
        opacity = 0.2 + Math.random() * 0.2;
      } else if (rand > 0.8) {
        // Near foreground layer: fast, thick, bright
        layer = "near";
        speed = 26 + Math.random() * 10;
        length = 36 + Math.random() * 24;
        thickness = 1.8;
        opacity = 0.65 + Math.random() * 0.3;
      }

      drops.push({
        x: Math.random() * (width + 300) - 150,
        y: Math.random() * height,
        length,
        speed,
        thickness,
        opacity,
        layer
      });
    }

    // Splashes array for ground / water impact ripples
    const splashes: Splash[] = [];

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Render rain drops
      ctx.lineCap = "round";

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];

        // Gradient streak: transparent tail to crisp silver/white tip
        const tailX = d.x;
        const tailY = d.y;
        const headX = d.x + d.length * sinAngle;
        const headY = d.y + d.length * cosAngle;

        const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
        grad.addColorStop(0, "rgba(224, 242, 254, 0)");
        grad.addColorStop(0.6, `rgba(224, 242, 254, ${d.opacity * 0.5})`);
        grad.addColorStop(1, `rgba(255, 255, 255, ${d.opacity})`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = d.thickness;

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(headX, headY);
        ctx.stroke();

        // Advance position
        d.x += d.speed * sinAngle;
        d.y += d.speed * cosAngle;

        // Ground collision & splash generation
        if (d.y >= height - 20 && Math.random() < 0.25) {
          if (splashes.length < 30) {
            splashes.push({
              x: d.x,
              y: height - 10 + Math.random() * 8,
              radius: 1,
              maxRadius: 6 + Math.random() * 6,
              opacity: 0.55
            });
          }
        }

        // Loop drop when out of screen bounds
        if (d.y > height + 50 || d.x > width + 200) {
          d.y = -d.length - Math.random() * 50;
          d.x = Math.random() * (width + 300) - 150;
        }
      }

      // Render splashes (ripples)
      for (let s = splashes.length - 1; s >= 0; s--) {
        const sp = splashes[s];
        ctx.strokeStyle = `rgba(224, 242, 254, ${sp.opacity})`;
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, sp.radius * 2, sp.radius * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();

        sp.radius += 0.6;
        sp.opacity -= 0.035;

        if (sp.opacity <= 0 || sp.radius >= sp.maxRadius) {
          splashes.splice(s, 1);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [precipitation, intensity]);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 h-screen w-full pointer-events-none z-[999] overflow-hidden select-none transition-opacity duration-700 ease-in-out"
    >
      {/* Apple Weather-style atmospheric mist overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-700/10 via-sky-700/5 to-slate-700/15 pointer-events-none" />

      {/* 60fps High-Performance Rain Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none block"
      />
    </div>
  );
}
