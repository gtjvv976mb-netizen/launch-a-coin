import { useEffect, useRef, useState, type ReactNode } from "react";
import { cardLabel, useCardSlots, type CardData } from "../mintdex/MintCard";
import { Card3DView } from "../mintdex/card3d/Card3D";
import { Engine, motionLevel, type Body } from "../mintdex/card3d/motion3d";
import type { Card3DHandle } from "../mintdex/card3d/types";

/** A full revolution in the shared engine, with the same rounded slab, both-face lighting and touch input. */
export function HeroTurntable({ card, className = "", playing: controlled, onPlayingChange, followEdits = false, viewportFit = false, controls }: {
  card: CardData; className?: string; playing?: boolean; onPlayingChange?: (playing: boolean) => void; followEdits?: boolean; viewportFit?: boolean;
  /** More buttons for the end of the control row (Launch's Inspect), so the row keeps one even gap. */
  controls?: ReactNode;
}) {
  const [localPlaying, setLocalPlaying] = useState(true);
  const playing = controlled ?? localPlaying;
  const slots = useCardSlots(card, { ascend: "ascend", art: "fade", priority: true, sizes: "(max-width: 767px) 72vw, 400px", hand: true });
  useEffect(() => {
    const body = slots.ctl.current?.body;
    if (!body || !viewportFit) return;
    body.turnArcScale = .2;
    Engine.kick();
    return () => { body.turnArcScale = 1; };
  }, [viewportFit]);
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
    // Pause settles the card on its nearest front face (F7), never frozen edge-on or showing its back; calm snaps.
    if (!playing && body && !slots.ctl.current?.busy) {
      const front = Math.round(body.flip.x / 360) * 360;
      if (motionLevel() === "calm") body.flip.snap(front);
      else body.flip.t = front;
    }
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
  }, [followEdits, card.name, card.ticker, card.image, card.lore, card.cardTemplate, card.quoteAssetKey, card.mcapQuote, card.mcapUsd]);
  const toggle = () => {
    const value = !playing;
    setLocalPlaying(value);
    onPlayingChange?.(value);
  };
  const setRef = (handle: Card3DHandle | null) => { slots.handle.current = handle; };
  return <div className={`cdx-hero-turntable ${viewportFit ? "cdx-hero-turntable--viewport" : ""} ${className}`}>
    <Card3DView depth="hand" label={cardLabel(card)} faces={slots.faces} front={slots.front} swap={slots.swap} flippable tapTurns drag="turn" idle={playing ? "breathe" : "none"} ground="shadow" gyro focusable arrowsTurn seed={card.dexNo} backSizes="(max-width: 767px) 72vw, 400px" ctlRef={slots.ctl} ref={setRef} frame={frame} onInteract={() => { lastInput.current = performance.now(); }} onSwapped={slots.onSwapped} onSettled={slots.onSettled} />
    <div className="cdx-hero-turntable__controls">
      <button type="button" onClick={() => { lastInput.current = performance.now(); slots.handle.current?.turnOver(); }} aria-label="Turn card over">Turn over</button>
      <button type="button" onClick={toggle} aria-pressed={!playing}>{playing ? "Pause rotation" : "Resume rotation"}</button>
      {controls}
    </div>
  </div>;
}
