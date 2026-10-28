/**
 * The 3D turntable viewer (owner 2026-10-17), a lazy chunk opened by view3d.tsx. Full screen, on Radix Dialog (focus
 * trapped, Esc closes, the page's cards sleep underneath because the engine sees the open dialog). The card stands
 * on a neon turntable and turns all the way round: face, cut edge, holo back. It is the same solid slab as
 * everywhere (MintCardFace, the printed back, the continuous edge in the design's template, the design's halo); the
 * light and foil follow the angle exactly as the engine derives them (light.ts lightFromPose).
 *
 * Its own small loop (not the shared engine, which stops under calm): auto-spin while playing; drag or swipe spins
 * with inertia; wheel or pinch zooms; arrow keys turn; Flip turns half round; Pause stops the spin. Transform-only
 * writes, the loop stops when nothing moves and while the tab is hidden. Calm (or reduced motion): no auto-spin and
 * no coasting; a drag still turns the card.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { tierForLevel } from "../../../lib/mintdex/tiers";
import { MintCardFace, cardLabel, cardDesign, cardBackTheme, designedCard } from "../MintCard";
import { getMemeIcon } from "../../../lib/mintdex/meme-icons";
import { getEdition } from "../../../lib/mintdex/editions";
import { Icon } from "../ui";
import { CardControlButton, CardControls } from "../../carddex/CardControls";
import { BackFace } from "./backface";
import { CARD_BOX, extrude, paintAcrylic, paintEdge } from "./extrude";
import { CasePlate, caseBox } from "./case-chrome";
import { FaceDepth } from "./faceContext";
import { clamp, lightFromPose } from "./light";
import { useMotionLevel } from "./motion3d";
import { designMaterialStyle } from "./design-material";
import { templateStyle } from "./templates";
import { editionMaterialStyle } from "./edition-material";
import { memeIconMaterialStyle } from "./meme-icon-material";
import { type View3DItem } from "./view3d";
import "../../../collector-case-viewer.css";

/** Auto-spin speed: one turn in 10 s. */
const AUTO = 36;
/** The resting lean of the card on the turntable (deg, top back). */
const TILT = 6;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const SIZES = "(max-width: 767px) 84vw, 560px";

type Sim = {
  angle: number;
  vel: number;
  tilt: number;
  tiltV: number;
  tiltT: number;
  zoom: number;
  zoomT: number;
  dragging: boolean;
  flipTo: number | null;
  lastInput: number;
  lastLight: number;
  lightKey: string;
};

export default function TurntableStage({
  items,
  index,
  onStep,
  onClose,
  onCloseFocus,
}: {
  items: View3DItem[];
  index: number;
  onStep: (i: number) => void;
  onClose: () => void;
  onCloseFocus: () => void;
}) {
  const item = items[index] ?? items[0];
  const card = designedCard(item.card);
  const tier = tierForLevel(card.level);
  const level = useMotionLevel();
  const calm = level === "calm";
  const [paused, setPaused] = useState(false);
  const [said, setSaid] = useState("");
  const hintId = useId();
  const pathname = useRouterState({ select: (st) => st.location.pathname });

  const stageRef = useRef<HTMLDivElement | null>(null);
  // The dialog's portal mounts its content after the first render: effects that need the stage wait for it.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const setStage = (el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  };
  const zoomRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLDivElement>(null);
  const edgesRef = useRef<HTMLDivElement>(null);
  const caseEdgesRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLElement>(null);
  const sim = useRef<Sim>({
    angle: -24,
    vel: 0,
    tilt: TILT,
    tiltV: 0,
    tiltT: TILT,
    zoom: 1,
    zoomT: 1,
    dragging: false,
    flipTo: null,
    lastInput: 0,
    lastLight: 0,
    lightKey: "",
  });
  const raf = useRef(0);
  const last = useRef(0);
  const auto = useRef(false);
  auto.current = !paused && !calm;
  const calmRef = useRef(calm);
  calmRef.current = calm;

  /* ------------------------------------------------------------------ the loop */

  const write = () => {
    const s = sim.current;
    const pose = poseRef.current;
    if (pose)
      pose.style.transform = `rotateX(${s.tilt.toFixed(2)}deg) rotateY(${s.angle.toFixed(2)}deg)`;
    if (zoomRef.current) zoomRef.current.style.transform = `scale(${s.zoom.toFixed(4)})`;
    if (ringRef.current) ringRef.current.style.transform = `rotate(${s.angle.toFixed(1)}deg)`;
    // The edge's shine follows the pose (card3d.css .mdx-card3d__edges > b::after).
    const edges = edgesRef.current;
    if (edges) {
      edges.style.setProperty("--ex", `${s.tilt.toFixed(1)}deg`);
      edges.style.setProperty("--ey", `${s.angle.toFixed(1)}deg`);
    }
    if (caseEdgesRef.current) {
      caseEdgesRef.current.style.setProperty("--ex", `${s.tilt.toFixed(1)}deg`);
      caseEdgesRef.current.style.setProperty("--ey", `${s.angle.toFixed(1)}deg`);
    }
    const now = performance.now();
    if (now - s.lastLight < 33 && s.lightKey) return;
    const l = lightFromPose(s.tilt, 0, s.angle, 0);
    const key = `${l.px.toFixed(3)}|${l.py.toFixed(3)}|${Math.max(0.3, l.lit).toFixed(3)}`;
    if (key === s.lightKey) return;
    s.lightKey = key;
    s.lastLight = now;
    const [px, py, lit] = key.split("|");
    const scene = sceneRef.current;
    if (!scene) return;
    for (const el of scene.querySelectorAll<HTMLElement>(
      ".mdx-card__lights, .mdx-card3d__back-lights, .mdx-case__gloss, .mdx-case__holo",
    )) {
      el.style.setProperty("--px", px);
      el.style.setProperty("--py", py);
      el.style.setProperty("--lit", lit);
    }
  };

  const tick = (now: number) => {
    raf.current = 0;
    if (document.hidden) return;
    const dt = Math.min(0.034, last.current ? (now - last.current) / 1000 : 0.016);
    last.current = now;
    const s = sim.current;
    let busy = false;
    if (s.dragging) {
      busy = true;
    } else if (s.flipTo != null) {
      // A half turn on a spring (Flip, the F key, arrow keys).
      const a = 70 * (s.flipTo - s.angle) - 15 * s.vel;
      s.vel += a * dt;
      s.angle += s.vel * dt;
      if (Math.abs(s.flipTo - s.angle) < 0.2 && Math.abs(s.vel) < 3) {
        s.angle = s.flipTo;
        s.vel = 0;
        s.flipTo = null;
        s.lastInput = now;
      }
      busy = true;
    } else {
      const wantAuto = auto.current && now - s.lastInput > 1200;
      const target = wantAuto ? AUTO : 0;
      // Inertia: a fling coasts and slows to the auto speed (or to a stop); calm never coasts.
      if (calmRef.current) s.vel = 0;
      else
        s.vel +=
          (target - s.vel) * (1 - Math.exp(-dt * (Math.abs(s.vel) > Math.abs(target) ? 1.5 : 1.1)));
      if (!wantAuto && Math.abs(s.vel) < 1) s.vel = 0;
      s.angle += s.vel * dt;
      busy = wantAuto || s.vel !== 0 || (auto.current && now - s.lastInput <= 1200);
    }
    if (!s.dragging) {
      const a = 120 * (s.tiltT - s.tilt) - 18 * s.tiltV;
      s.tiltV += a * dt;
      s.tilt += s.tiltV * dt;
      if (Math.abs(s.tiltT - s.tilt) > 0.02 || Math.abs(s.tiltV) > 0.05) busy = true;
      else {
        s.tilt = s.tiltT;
        s.tiltV = 0;
      }
    }
    const dz = s.zoomT - s.zoom;
    if (Math.abs(dz) > 0.001) {
      s.zoom += dz * (1 - Math.exp(-dt * 14));
      busy = true;
    } else s.zoom = s.zoomT;
    if (Math.abs(s.angle) > 36000) s.angle %= 360;
    write();
    if (busy) raf.current = requestAnimationFrame(tick);
  };

  const kick = () => {
    if (raf.current || document.hidden) return;
    last.current = 0;
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const vis = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Pause stops the ambient spin and settles the card on its nearest front face (F7: never frozen edge-on or
    // showing its back). Later deliberate drags can still coast, and an in-progress manual flip keeps its spring.
    const s = sim.current;
    if ((paused || calm) && !s.dragging && s.flipTo == null) {
      s.vel = 0;
      if (paused && !calm) s.flipTo = Math.round(s.angle / 360) * 360;
    }
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, calm]);

  // A new card (opened or stepped to): its edge, a fresh pose a little turned so its edge shows at once.
  useLayoutEffect(() => {
    const host = edgesRef.current;
    if (!stageEl) return;
    if (host) {
      host.replaceChildren();
      extrude(host, CARD_BOX, 3, "var(--t)", paintEdge);
    }
    if (caseEdgesRef.current) {
      caseEdgesRef.current.replaceChildren();
      if (item.cased) extrude(caseEdgesRef.current, caseBox(true), 4, "var(--T)", paintAcrylic);
    }
    const s = sim.current;
    // A selected card respects Pause too: its entrance must not restart automatic rotation.
    const still = !auto.current;
    s.angle = still ? -24 : -60;
    s.vel = still ? 0 : 140;
    s.flipTo = null;
    s.lightKey = "";
    write();
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.cased, stageEl]);

  /* ------------------------------------------------------------------ input */

  const touched = () => {
    sim.current.lastInput = performance.now();
  };
  const flip = (dir: 1 | -1 = 1) => {
    const s = sim.current;
    touched();
    const base = Math.round((s.flipTo ?? s.angle) / 180) * 180;
    s.flipTo = base + 180 * dir;
    setSaid(Math.round(s.flipTo / 180) % 2 === 0 ? "Showing the front" : "Showing the back");
    kick();
  };
  const turnBy = (deg: number) => {
    const s = sim.current;
    touched();
    s.flipTo = (s.flipTo ?? s.angle) + deg;
    kick();
  };
  const zoomBy = (k: number) => {
    const s = sim.current;
    s.zoomT = clamp(s.zoomT * k, ZOOM_MIN, ZOOM_MAX);
    kick();
  };

  // Pointers on the stage: one drags the turn, two pinch the zoom. A press that never moved on the empty stage
  // (not the card, the turntable or a control) closes, like a click on a backdrop.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    x0: number;
    y0: number;
    a0: number;
    t0: number;
    lx: number;
    lt: number;
    moved: boolean;
    pinch0: number;
    z0: number;
    bg: boolean;
  } | null>(null);
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const dist = () => {
      const [a, b] = [...pointers.current.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest("button, a")) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = sim.current;
      const bg = !(e.target as Element).closest(".mdx-v3d__card, .mdx-v3d__pedestal");
      if (pointers.current.size === 1) {
        drag.current = {
          x0: e.clientX,
          y0: e.clientY,
          a0: s.angle,
          t0: s.tilt,
          lx: e.clientX,
          lt: performance.now(),
          moved: false,
          pinch0: 0,
          z0: s.zoomT,
          bg,
        };
      } else if (drag.current) {
        drag.current.pinch0 = dist();
        drag.current.z0 = s.zoomT;
        drag.current.moved = true;
        drag.current.bg = false;
        s.dragging = true;
        s.flipTo = null;
        el.setAttribute("data-dragging", "");
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = drag.current;
      if (!d) return;
      const s = sim.current;
      if (pointers.current.size >= 2 && d.pinch0 > 0) {
        s.zoomT = clamp((d.z0 * dist()) / d.pinch0, ZOOM_MIN, ZOOM_MAX);
        kick();
        return;
      }
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) > 5) {
        d.moved = true;
        s.dragging = true;
        s.flipTo = null;
        el.setAttribute("data-dragging", "");
      }
      if (!d.moved) return;
      const now = performance.now();
      const dtt = Math.max(1, now - d.lt);
      const prev = s.angle;
      s.angle = d.a0 + dx * 0.55;
      const v = ((s.angle - prev) * 1000) / dtt;
      s.vel = s.vel * 0.5 + v * 0.5;
      s.tilt = clamp(d.t0 - dy * 0.08, -16, 22);
      d.lx = e.clientX;
      d.lt = now;
      touched();
      write();
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      const d = drag.current;
      if (pointers.current.size > 0) {
        // Continue from the remaining finger's current position instead of jumping back to the first press.
        const next = pointers.current.values().next().value;
        if (d && next) {
          d.x0 = d.lx = next.x;
          d.y0 = next.y;
          d.a0 = sim.current.angle;
          d.t0 = sim.current.tilt;
          d.lt = performance.now();
          d.pinch0 = pointers.current.size >= 2 ? dist() : 0;
          d.z0 = sim.current.zoomT;
          d.moved = true;
          d.bg = false;
        }
        return;
      }
      drag.current = null;
      const s = sim.current;
      el.removeAttribute("data-dragging");
      if (d?.moved) {
        s.dragging = false;
        // A held finger that stopped does not fling.
        if (e.type !== "pointerup" || performance.now() - d.lt > 80) s.vel = 0;
        s.vel = clamp(s.vel, -1400, 1400);
        touched();
        kick();
      } else if (d?.bg && e.type === "pointerup") {
        onClose();
      }
    };
    const lost = (e: PointerEvent) => {
      // Taking capture from the card's artwork can bubble a descendant's loss through the stage.
      if (e.target === el) up(e);
    };
    const interrupt = () => {
      pointers.current.clear();
      drag.current = null;
      el.removeAttribute("data-dragging");
      sim.current.dragging = false;
      sim.current.vel = 0;
      touched();
      kick();
    };
    const hidden = () => {
      if (document.hidden) interrupt();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    const dbl = (e: MouseEvent) => {
      if ((e.target as Element).closest(".mdx-v3d__card")) flip(1);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", lost);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("dblclick", dbl);
    window.addEventListener("blur", interrupt);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", lost);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("dblclick", dbl);
      window.removeEventListener("blur", interrupt);
      document.removeEventListener("visibilitychange", hidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageEl]);

  const many = items.length > 1;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const onControl = t.closest("button, a") !== null;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        turnBy(-30);
        break;
      case "ArrowRight":
        e.preventDefault();
        turnBy(30);
        break;
      case "ArrowUp":
        e.preventDefault();
        zoomBy(1.15);
        break;
      case "ArrowDown":
        e.preventDefault();
        zoomBy(1 / 1.15);
        break;
      case "+":
      case "=":
        zoomBy(1.15);
        break;
      case "-":
        zoomBy(1 / 1.15);
        break;
      case "f":
      case "F":
        flip(1);
        break;
      case "p":
      case "P":
        if (!calm) setPaused((v) => !v);
        break;
      case " ":
        if (onControl) return;
        e.preventDefault();
        if (!calm) setPaused((v) => !v);
        break;
      case "PageDown":
      case "n":
      case "N":
        if (many) {
          e.preventDefault();
          onStep(index + 1);
        }
        break;
      case "PageUp":
        if (many) {
          e.preventDefault();
          onStep(index - 1);
        }
        break;
    }
  };

  const coinId = item.coinId === undefined ? item.id : item.coinId;
  const onCoinPage = !!coinId && pathname === `/coin/${encodeURIComponent(coinId)}`;
  const icon = getMemeIcon(card.memeIcon);
  const edition = getEdition(card.edition);
  const style = { ...templateStyle(tier.key), ...editionMaterialStyle(card.edition), ...memeIconMaterialStyle(card.memeIcon), ...designMaterialStyle(card.cardTemplate), "--rest-k": 0, ...(item.cased ? { "--T": "6.5cqw", "--case-top": "-28cqw", "--accent": tier.accent } : {}) } as CSSProperties;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-modal="true"
          className="mdx-v3d"
          aria-describedby={hintId}
          data-calm={calm ? "" : undefined}
          onKeyDown={onKey}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            stageRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onCloseFocus();
          }}
        >
          <Dialog.Title className="sr-only">{card.name} card in 3D</Dialog.Title>
          <p id={hintId} className="sr-only">
            Drag to spin the card, scroll or pinch to zoom. Left and Right arrow keys turn it, Up
            and Down zoom, F turns it over{calm ? "" : ", P pauses the spin"}
            {many ? ", Page Up and Page Down step to the other cards" : ""}. Escape closes.
          </p>
          {/* The viewer shell (styles/screens/viewer.css): the card's name on the left, Close on the right, the card
              as large as the window allows on the flat ground, then its controls in one centred row. Same words as
              every card row: Turn over, Pause spin or Resume spin, Close. */}
          <div className="mdx-v3d__bar">
            <div className="mdx-v3d__title">
              <h2 className="mdx-v3d__name">{card.name}</h2>
              <p className="mdx-v3d__meta">
                <span className="mdx-v3d__ticker">${card.ticker}</span>
                <span>{cardDesign(card).name}</span>
                {many ? (
                  <span className="mdx-v3d__count num">
                    {index + 1} of {items.length}
                  </span>
                ) : null}
              </p>
            </div>
            <Dialog.Close className="mdx-v3d__btn mdx-v3d__close">
              <Icon name="close" strokeWidth={2} />
              Close
            </Dialog.Close>
          </div>

          <div
            ref={setStage}
            className="mdx-v3d__stage"
            tabIndex={-1}
            style={{ "--glow-c": icon?.palette[1] ?? tier.ring } as CSSProperties}
          >
            <div ref={zoomRef} className="mdx-v3d__zoom" data-cased={item.cased ? "" : undefined}>
              <div className="mdx-v3d__pedestal" aria-hidden>
                <i className="mdx-v3d__ped-glow" />
                <i className="mdx-v3d__ped-side" />
                <i className="mdx-v3d__ped-top">
                  <b ref={ringRef} />
                </i>
              </div>
              <div
                key={item.id}
                ref={sceneRef}
                className="mdx-card3d mdx-v3d__card"
                data-depth="hand"
                data-edge=""
                data-metal={tier.key}
                data-state="awake moving"
                data-cased={item.cased ? "" : undefined}
                role="img"
                aria-label={`${cardLabel(card)}${item.cased ? ", in its collector case" : ""}`}
                style={style}
              >
                <i className="mdx-card3d__halo" aria-hidden>
                  <b />
                </i>
                <div className="mdx-card3d__enter">
                  <div className="mdx-card3d__idle">
                    <div ref={poseRef} className="mdx-card3d__pose">
                      {item.cased ? <><div ref={caseEdgesRef} className="mdx-case__edges" aria-hidden /><CasePlate card={card} side="back" /></> : null}
                      <div ref={edgesRef} className="mdx-card3d__edges" aria-hidden />
                      <BackFace sizes={SIZES} eager theme={card} />
                      <div className="mdx-card3d__faces">
                        <FaceDepth.Provider value="hand">
                          <div className="mdx-card3d__slot" data-on="">
                            <MintCardFace card={card} sizes={SIZES} priority />
                          </div>
                        </FaceDepth.Provider>
                      </div>
                      {item.cased ? <CasePlate card={card} side="front" /> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mdx-v3d__cap">
            {/* The compact card-controls row (CardControls, shared with HeroTurntable): icon pills named by their
                tooltips, Previous and Next card at its ends when the viewer has neighbours; View coin keeps its words
                (it leaves the viewer). */}
            <CardControls className="mdx-v3d__controls">
              {many ? <CardControlButton icon="chevron-left" label="Previous card" onClick={() => onStep(index - 1)} data-v3d="prev" /> : null}
              <CardControlButton icon="turn-over" label="Turn over" onClick={() => flip(1)} data-v3d="flip" />
              {calm ? null : (
                <CardControlButton icon={paused ? "play" : "pause"} label={paused ? "Resume spin" : "Pause spin"} onClick={() => setPaused((v) => !v)} data-v3d="play" />
              )}
              {many ? <CardControlButton icon="chevron-right" label="Next card" onClick={() => onStep(index + 1)} data-v3d="next" /> : null}
              {/* Hidden when the viewer shows the coin of the page underneath: it would lead back to itself. */}
              {coinId && !onCoinPage ? (
                <Link
                  to="/coin/$id"
                  params={{ id: coinId }}
                  className="mdx-v3d__btn mdx-v3d__go"
                  onClick={onClose}
                >
                  View coin
                </Link>
              ) : null}
            </CardControls>
            <p className="mdx-v3d__hint" aria-hidden>
              <span className="mdx-v3d__hint-fine">Drag to spin, scroll to zoom</span>
              <span className="mdx-v3d__hint-touch">Swipe to spin, pinch to zoom</span>
            </p>
          </div>
          <span className="sr-only" aria-live="polite">
            {said}
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
