// Full-screen cover shown while a shared device is handed to the next person.

export function Curtain({ name, color, reason, onReveal }: { name: string; color: string; reason: string; onReveal(): void }) {
  return (
    <div className="curtain" style={{ '--pc': color } as React.CSSProperties}>
      <div className="curtain-card">
        <span className="curtain-dot" />
        <p className="muted">Pass the device to</p>
        <h2>{name}</h2>
        <p>{reason}</p>
        <button type="button" className="btn primary big" onClick={onReveal}>I'm {name}, show my cards</button>
      </div>
    </div>
  );
}
