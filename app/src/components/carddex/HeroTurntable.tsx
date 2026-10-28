import { useEffect, useRef, useState } from "react";
import { cardLabel, useCardSlots, type CardData } from "../mintdex/MintCard";
import { Card3DView } from "../mintdex/card3d/Card3D";
import { Engine, motionLevel, type Body } from "../mintdex/card3d/motion3d";
import type { Card3DHandle } from "../mintdex/card3d/types";

/** A full revolution in the shared engine, with the same rounded slab, both-face lighting and touch input. */
export function HeroTurntable({ card, className = "", playing: controlled, onPlayingChange, followEdits = false }: {
  card: CardData; className?: string; playing?: boolean; onPlayingChange?: (playing: boolean) => void; followEdits?: boolean;
}) {
  const [localPlaying, setLocalPlaying] = useState(true);
  const playing = controlled ?? localPlaying;
  const slots = useCardSlots(card, { ascend: "ascend", art: "fade", priority: true, sizes: "(max-width: 767px) 72vw, 400px", hand: true });
  const latestPlaying = useRef(playing);
  latestPlaying.current = playing;
  const lastFrame = useRef(0);
  const lastInput = useRef(0);
  const frame = (body: Body) => {
    const now = performance.now();
    const dt = Math.min(.05, (now - (lastFrame.current || now)) / 1000);
    lastFrame.current = now;
    if (!latestPlaying.current || motionLevel() !== "full" || body.held || body.dragging || body.focusHold || slots.ctl.current?.busy || now - lastInput.current < 2200) return;
    body.flip.t += 28 * dt;
  };
  useEffect(() => {
    const body = slots.ctl.current?.body;
    if (!playing && body) body.flip.snap(body.flip.x);
    lastFrame.current = 0;
    Engine.kick();
  }, [playing]);
  useEffect(() => {
    if (!followEdits) return;
    const ctl = slots.ctl.current;
    if (!ctl || ctl.busy) return;
    lastInput.current = performance.now();
    ctl.syncSide("face");
    const body = ctl.body;
    if (body) body.flip.t = Math.round(body.flip.x / 360) * 360;
    Engine.kick();
  }, [followEdits, card.name, card.ticker, card.image, card.lore, card.cardTemplate, card.mcapUsd]);
  const toggle = () => {
    const value = !playing;
    setLocalPlaying(value);
    onPlayingChange?.(value);
  };
  const setRef = (handle: Card3DHandle | null) => { slots.handle.current = handle; };
  return <div className={`cdx-hero-turntable ${className}`}>
    <Card3DView depth="hand" label={cardLabel(card)} faces={slots.faces} front={slots.front} swap={slots.swap} flippable tapTurns drag="turn" idle={playing ? "breathe" : "none"} ground="shadow" gyro focusable arrowsTurn seed={card.dexNo} backSizes="(max-width: 767px) 72vw, 400px" ctlRef={slots.ctl} ref={setRef} frame={frame} onInteract={() => { lastInput.current = performance.now(); }} onSwapped={slots.onSwapped} onSettled={slots.onSettled} />
    <div className="cdx-hero-turntable__controls">
      <button type="button" onClick={() => { lastInput.current = performance.now(); slots.handle.current?.turnOver(); }} aria-label="Turn card over">Turn over</button>
      <button type="button" onClick={toggle} aria-pressed={!playing}>{playing ? "Pause rotation" : "Resume rotation"}</button>
    </div>
  </div>;
}
