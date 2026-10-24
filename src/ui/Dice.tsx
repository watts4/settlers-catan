// Two 3D dice made of CSS cubes. When `rollKey` changes they tumble in from
// the side and land showing the new faces.

import { useEffect, useRef } from 'react';

const FACE_ROT: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
};
const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACES: [number, string][] = [[1, 'front'], [6, 'back'], [3, 'right'], [4, 'left'], [2, 'top'], [5, 'bottom']];

function Die({ value, rollKey, delay }: { value: number; rollKey: number; delay: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!rollKey || !node || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const end = FACE_ROT[value];
    const anim = node.animate([
      { transform: `translate(-70px, -80px) rotateX(${300 + delay}deg) rotateY(200deg) rotateZ(90deg)` },
      { transform: 'translate(-12px, -18px) rotateX(560deg) rotateY(380deg) rotateZ(200deg)', offset: 0.45 },
      { transform: `translate(3px, 3px) ${end} rotateZ(20deg)`, offset: 0.8 },
      { transform: `translate(0, 0) ${end} rotateZ(0deg)` },
    ], { duration: 760, delay, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'backwards' });
    return () => anim.cancel();
  }, [rollKey, value, delay]);
  return (
    <div className="die-wrap">
      <div ref={el} className="die" style={{ transform: FACE_ROT[value] }}>
        {FACES.map(([n, side]) => (
          <div key={side} className={`face ${side}`}>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={PIPS[n].includes(i + 1) ? 'pip' : ''} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dice({ a, b, rollKey, red }: { a: number; b: number; rollKey: number; red?: boolean }) {
  return (
    <div className={`dice ${red ? 'seven' : ''}`} aria-label={`Dice: ${a} and ${b}`}>
      <Die value={a} rollKey={rollKey} delay={0} />
      <Die value={b} rollKey={rollKey} delay={70} />
    </div>
  );
}
