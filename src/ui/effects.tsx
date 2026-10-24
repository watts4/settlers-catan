// Screen-level effects: cards flying across the table and victory confetti.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Flight { id: number; from: { x: number; y: number }; to: { x: number; y: number }; node: ReactNode; delay: number; dur: number }

export interface FlyApi {
  fly(from: { x: number; y: number }, to: { x: number; y: number }, node: ReactNode, delay?: number, dur?: number): void;
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function FlyItem({ f, done }: { f: Flight; done(id: number): void }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y;
    // Arc upward a little on the way.
    const lift = -Math.min(120, Math.hypot(dx, dy) * 0.25);
    const anim = node.animate([
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.15}px), calc(-50% + ${dy * 0.15 + lift * 0.6}px)) scale(1.15)`, opacity: 1, offset: 0.2 },
      { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6 + lift}px)) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6)`, opacity: 0.2 },
    ], { duration: f.dur, delay: f.delay, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'both' });
    anim.onfinish = () => done(f.id);
    return () => anim.cancel();
  }, [f, done]);
  return <div ref={el} className="fly" style={{ left: f.from.x, top: f.from.y }}>{f.node}</div>;
}

export const FlyLayer = forwardRef<FlyApi>(function FlyLayer(_, ref) {
  const [items, setItems] = useState<Flight[]>([]);
  const next = useRef(1);
  useImperativeHandle(ref, () => ({
    fly(from, to, node, delay = 0, dur = 900) {
      if (reduced()) return;
      const id = next.current++;
      setItems((xs) => [...xs.slice(-40), { id, from, to, node, delay, dur }]);
    },
  }), []);
  const done = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  return <div className="fly-layer" aria-hidden="true">{items.map((f) => <FlyItem key={f.id} f={f} done={done} />)}</div>;
});

export function Confetti({ run }: { run: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!run || reduced()) return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = window.innerWidth * dpr;
    c.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#d23c2f', '#2f6fd2', '#f2efe6', '#e8892b', '#e2b543', '#5a9b4e'];
    const parts = Array.from({ length: 180 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 16 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(frame * 0.1 + p.r)));
        ctx.restore();
      }
      if (frame < 260) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, c.width, c.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
