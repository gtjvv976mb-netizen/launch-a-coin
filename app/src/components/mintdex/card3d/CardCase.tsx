/**
 * CardCase (spec 4.10): the card in an acrylic collector case, one body. The scene box is the card box (the parent
 * sets the inner width); the surrounding case and its label reserve their full space in the wrapper.
 * Holder: 0.06W margins; labeled adds 0.28W above (auto shows it at >= 1280 x 860, always in Inspect).
 * Controls: Turn over and Inspect in a toolbar outside the protective case. Keys when focused: F, Enter or
 * Space turn, arrows turn, I opens Inspect.
 */
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { tierForLevel } from "../../../lib/mintdex/tiers";
import { cardDesign, useCardSlots, type CardData } from "../MintCard";
import { Card3DView } from "./Card3D";
import { paintAcrylic } from "./extrude";
import { CasePlate, caseBox } from "./case-chrome";
import { GyroChip } from "./GyroChip";
import { InspectDialog, prefetchInspect } from "./InspectDialog";
import { motionLevel, type Body } from "./motion3d";
import type { Card3DHandle, Card3DProps } from "./types";

export type CardCaseProps = {
  card: CardData;
  /** Rotate the cased collectible in place until the viewer touches it. */
  turntable?: boolean;
  /** "auto": CSS shows the label at >= 1280x860 (default). */
  variant?: "auto" | "holder" | "labeled";
  /** External Turn over / Inspect toolbar. Legacy "overlay" is retained as a prop value. */
  controls?: "overlay" | "row" | "none";
  /** A coin-specific action such as the full 3D viewer, placed outside the printed card. */
  extraControl?: ReactNode;
  /** Default true (CardCase opens the lazy InspectDialog). */
  inspect?: boolean;
  /** L10 rim pulse in the next design's ring color. */
  nearNext?: { ring: string } | null;
  /** Default true (only on client navigation, section 11.1). */
  unbox?: boolean;
  /** Default true. */
  gyroChip?: boolean;
  priority?: boolean;
  sizes?: string;
  onInteract?: Card3DProps["onInteract"];
  className?: string;
  ref?: Ref<Card3DHandle>;
};

const LABEL_MQ = "(min-width: 1280px) and (min-height: 860px)";
/** The external Inspect action keeps its accessible name when narrow cases display the icon alone. */
function inspectBtn(onInspect: () => void) {
  return (
    <button
      type="button"
      className="mdx-case__btn"
      aria-label="Inspect"
      onPointerEnter={prefetchInspect}
      onFocus={prefetchInspect}
      onTouchStart={prefetchInspect}
      onClick={onInspect}
    >
      <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4L14 14" />
      </svg>
      <span className="mdx-case__btn-label">Inspect</span>
    </button>
  );
}

type CaseSceneProps = Omit<CardCaseProps, "inspect" | "className"> & {
  kind: "case" | "inspect";
  onInspect?: () => void;
  turntable?: boolean;
};

/** The case scene itself (CardCase on the coin page, the labeled case on the Inspect stage). */
export function CaseScene({
  card,
  variant = "auto",
  controls = "overlay",
  extraControl,
  nearNext = null,
  unbox = true,
  gyroChip = true,
  priority,
  sizes,
  onInteract,
  ref,
  kind,
  onInspect,
  turntable = true,
}: CaseSceneProps) {
  const slots = useCardSlots(card, { ascend: "ascend", art: "print", priority, sizes, hand: true });
  const tier = tierForLevel(slots.level);
  const [said, setSaid] = useState("");
  const [paused, setPaused] = useState(false);
  const [labeled, setLabeled] = useState(variant === "labeled");
  const edgesHost = useRef<HTMLDivElement>(null);
  const lastInput = useRef(0);
  const lastFrame = useRef(0);

  useEffect(() => {
    if (variant !== "auto") {
      setLabeled(variant === "labeled");
      return;
    }
    const mq = window.matchMedia(LABEL_MQ);
    const sync = () => setLabeled(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [variant]);

  // The acrylic walls follow the outline (holder or labeled): rebuild them when it changes.
  useEffect(() => {
    edgesHost.current?.replaceChildren();
    if (motionLevel() !== "calm") slots.ctl.current?.buildEdges();
  }, [labeled, slots.ctl]);

  const touched = (k?: "hover" | "drag" | "tap" | "key") => {
    lastInput.current = performance.now();
    if (k) onInteract?.(k);
  };
  // The page's handle: a turn from a button counts as input too (the Inspect turntable waits 3 s after it).
  const setRef = (h: Card3DHandle | null) => {
    slots.handle.current = h;
    const out: Card3DHandle | null = h && {
      ...h,
      turnOver: (dir?: 1 | -1) => {
        touched();
        h.turnOver(dir);
      },
    };
    if (typeof ref === "function") ref(out);
    else if (ref) (ref as { current: Card3DHandle | null }).current = out;
  };
  // L6 the Inspect turntable: 25 deg/s while nobody holds it, paused for 3 s after any input.
  const frame = (b: Body) => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (lastFrame.current || now)) / 1000);
    lastFrame.current = now;
    if (!turntable || paused || b.dragging || b.held || slots.ctl.current?.busy || now - lastInput.current < 3000) return;
    if (motionLevel() !== "full") return;
    b.flip.t += 25 * dt;
  };

  // The sensor permission gesture belongs in the toolbar, clear of the printed card and its acrylic label.
  const chipBtn = gyroChip ? <GyroChip /> : null;

  const name = card.name;
  const style = { "--accent": tier.accent, ...(nearNext ? { "--next-ring": nearNext.ring } : null) } as CSSProperties;
  const label = `${name} card in its case, ${cardDesign(card).name} design`;

  return (
    <div
      className="mdx-case"
      data-variant={variant}
      data-controls={controls}
      data-kind={kind}
      data-near={nearNext ? "" : undefined}
      data-paused={turntable && paused ? "" : undefined}
      style={style}
    >
      <Card3DView
        depth="hand"
        kind={kind}
        seg={2}
        label={label}
        faces={slots.faces}
        front={slots.front}
        swap={slots.swap}
        flippable
        tapTurns
        drag="turn"
        idle={kind === "inspect" ? "breathe" : "breathe-peek"}
        ground="shadow"
        enter={unbox ? "unbox" : "none"}
        focusable
        arrowsTurn
        seed={card.dexNo}
        sceneClassName="mdx-case__scene"
        backSizes={sizes}
        onBurst={slots.onBurst}
        onSwapped={slots.onSwapped}
        onSettled={slots.onSettled}
        onInteract={touched}
        onAnnounce={setSaid}
        outside="none"
        ctlRef={slots.ctl}
        ref={setRef}
        frame={frame}
        caseEdges={{ host: () => edgesHost.current, box: caseBox(labeled), paint: paintAcrylic }}
        extraKeys={(e) => {
          if ((e.key === "i" || e.key === "I") && onInspect) {
            e.preventDefault();
            onInspect();
            return true;
          }
          touched();
          return false;
        }}
        poseBack={
          <>
            <div ref={edgesHost} className="mdx-case__edges" aria-hidden />
            <CasePlate card={card} side="back" />
          </>
        }
        poseFront={<CasePlate card={card} side="front" />}
      />
      {controls !== "none" || extraControl ? (
        <div className="mdx-case__controls">
          {controls !== "none" ? (
            <>
              <button
                type="button"
                className="mdx-case__btn"
                aria-label="Turn over"
                onClick={() => {
                  touched();
                  slots.ctl.current?.turnOver(1, true);
                }}
              >
                <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.8 5.1a5.2 5.2 0 1 0 .2 5.6M12.8 1.9v3.6H9.2" />
                </svg>
                <span className="mdx-case__btn-label">Turn over</span>
              </button>
              {/* One pattern: a fixed "Pause" name whose pressed state says it is held (calm hides it: nothing turns). */}
              {turntable ? <button type="button" className="mdx-case__btn mdx-case__btn--pause" aria-pressed={paused} onClick={() => {
                const body = slots.ctl.current?.body;
                if (!paused && body) body.flip.snap(body.flip.x);
                setPaused((value) => !value);
              }}>Pause</button> : null}
              {onInspect ? inspectBtn(onInspect) : null}
            </>
          ) : null}
          {extraControl}
          {controls !== "none" ? chipBtn : null}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      {controls === "none" && !extraControl ? chipBtn : null}
    </div>
  );
}

export function CardCase({ inspect = true, className = "", ...p }: CardCaseProps) {
  const [open, setOpen] = useState(false);
  // Inspect opens without a Radix Trigger: remember the opener and hand focus back to it on close.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, [open]);
  const openInspect = () => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
    setOpen(true);
  };
  return (
    <div className={className}>
      <CaseScene {...p} kind="case" onInspect={inspect ? openInspect : undefined} />
      {inspect && open ? (
        <Suspense fallback={null}>
          <InspectDialog card={p.card} open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
