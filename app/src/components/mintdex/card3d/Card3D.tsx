/**
 * Card3D (spec 4.4): a physical card, ONE solid thin slab (owner 2026-10-17): the face is one flat plane (art,
 * frame, text and the holo all in it), the back is one flat plane, and a continuous cut edge (extrude.ts) joins
 * them, in the design's template (templates.ts). The server renders the whole scene (ground, entrance, idle, pose,
 * back and the staged face slots) at rest; after mount the scene controller adds the edge, the body, input and
 * moments. The face swap for any `front` change is a visibility flip of pre-rendered slots while the back faces you.
 */
import {
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { BackFace } from "./backface";
import { CellCtx, MotionCtx, recentlyGathered } from "./context";
import { FaceDepth } from "./faceContext";
import { GyroChip } from "./GyroChip";
import { floatPhase, hashSeed } from "./light";
import { deal, liftin, unbox, wave } from "./moments";
import { Engine, motionLevel, useFreshMount, useMotionLevel, type BodyKind } from "./motion3d";
import { SceneCtl, type SceneOpts } from "./scene";
import { registerTable } from "./tablelight";
import { designMaterialStyle } from "./design-material";
import { templateStyle } from "./templates";
import type { Card3DHandle, Card3DProps, CardEnter, CardSide, FaceSlot, TierLight } from "./types";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Internal options (CardCase, Inspect, CardBack, MintCard); not part of the public contract. */
export type Card3DInternal = {
  /** Float phase seed (MintCard passes the dex number). Default: a hash of the first front key. */
  seed?: number;
  kind?: BodyKind;
  /** Corner segments of the card's edge (hand/turntable 2, other table 1, inside a case 2). */
  seg?: number;
  /** The Ascend or mint-reveal burst showed this face (MintCard resolves whenRevealed with it). */
  onBurst?: (key: string) => void;
  /** CardCase: case plates and walls inside the pose, behind and in front of the card. */
  poseBack?: ReactNode;
  poseFront?: ReactNode;
  caseEdges?: SceneOpts["caseEdges"];
  sceneClassName?: string;
  extraKeys?: SceneOpts["extraKeys"];
  /** "none": the caller renders the live region and chip (CardCase). */
  outside?: "fragment" | "none";
  onAnnounce?: (text: string) => void;
  /** No printed back (CardBack hand shows the back as its face). */
  noBack?: boolean;
  backSizes?: string;
  ctlRef?: { current: SceneCtl | null };
  /** Called on every engine step of the body (the Inspect turntable). */
  frame?: SceneOpts["frame"];
};

/** The reveals chunk (Ascend, mint reveal, claim): fetched on first use, or when idle after a hand card mounts. */
let revealChunk: Promise<typeof import("./reveal")> | null = null;
function loadReveal() {
  return (revealChunk ??= import("./reveal"));
}
function prefetchReveal() {
  if (revealChunk || typeof window === "undefined") return;
  const go = () => void loadReveal();
  const idle = "requestIdleCallback" in window;
  if (idle) window.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 2000);
}

const ANNOUNCE: Record<CardSide, string> = { face: "Showing the front", back: "Showing the back" };

function poolColor(t: TierLight | undefined) {
  if (!t) return undefined;
  return t.sheen.length > 1 ? t.sheen[1] : t.ring;
}

export function Card3D(props: Card3DProps) {
  return <Card3DView {...props} />;
}

export function Card3DView(p: Card3DProps & Card3DInternal) {
  const depth = p.depth ?? "table";
  const hand = depth === "hand";
  const group = useContext(MotionCtx);
  const cell = useContext(CellCtx);
  const enter: CardEnter = p.enter ?? group?.enter ?? "none";
  const flippable = p.flippable ?? hand;
  // A list card turns in place while it is in view (spin.ts): asked for with idle "turntable", or by its shelf.
  const turntable = !hand && (p.idle === "turntable" || (p.idle === undefined && !!group?.turntable));
  const level = useMotionLevel();
  // Read once at the first render: true only for fresh client mounts after hydration (client navigation, dialogs),
  // so server-painted cards never vanish and fly back in, even inside a route chunk that hydrates late.
  const afterHydration = useFreshMount();
  const [seed] = useState(() => p.seed ?? hashSeed(p.front));
  const sceneRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLElement>(null);
  const enterRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLDivElement>(null);
  const edgesRef = useRef<HTMLDivElement>(null);
  const facesRef = useRef<HTMLDivElement>(null);
  const ctl = useRef<SceneCtl | null>(null);
  // Table cards fly face down on a CSS back (card3d.css) and mount the real back on their first hold.
  const [backOn, setBackOn] = useState(!p.noBack && hand);
  const [said, setSaid] = useState("");
  // A staged cosmetic front commits while its back faces the viewer; update that reverse at the same moment.
  const [, setThemeFront] = useState(p.front);
  const hintId = useId();

  // Keep the shown face rendered even when the caller already dropped it (a fast double step mid-turn).
  const cache = useRef(new Map<string, FaceSlot>());
  for (const f of p.faces) cache.current.set(f.key, f);
  const shown = ctl.current?.shown ?? p.front;
  const missing = !p.faces.some((f) => f.key === shown) && cache.current.has(shown);
  const list = missing ? [...p.faces, cache.current.get(shown)!] : p.faces;
  if (cache.current.size > list.length + 3) {
    for (const k of [...cache.current.keys()]) if (!list.some((f) => f.key === k)) cache.current.delete(k);
  }
  const tierOf = (key: string) => list.find((f) => f.key === key)?.tier ?? cache.current.get(key)?.tier ?? null;
  const tierRef = useRef(tierOf);
  tierRef.current = tierOf;

  const latest = useRef(p);
  latest.current = p;
  const opts: SceneOpts = {
    depth,
    kind: p.kind ?? (hand ? "hand" : "table"),
    flippable,
    tapTurns: p.tapTurns ?? hand,
    tapAuto: p.tapTurns === undefined,
    drag: p.drag ?? "turn",
    idle: p.idle === "float" || p.idle === "turntable" ? "none" : (p.idle ?? (hand ? "breathe-peek" : "none")),
    ground: p.ground ?? "shadow",
    gyro: p.gyro ?? true,
    focusable: !!p.focusable,
    arrowsTurn: !!p.arrowsTurn,
    seg: p.seg ?? (hand || turntable ? 2 : 1),
    caseEdges: p.caseEdges ?? null,
    onInteract: (k) => latest.current.onInteract?.(k),
    onStep: (d) => latest.current.onStep?.(d),
    onSideChange: (s) => latest.current.onSideChange?.(s),
    onSwapped: (k) => {
      if (latest.current.backTheme || latest.current.faces.some((face) => face.backTheme)) setThemeFront(k);
      latest.current.onSwapped?.(k);
    },
    onSettled: (k) => latest.current.onSettled?.(k),
    announce: (s) => {
      if (latest.current.onAnnounce) latest.current.onAnnounce(ANNOUNCE[s]);
      else setSaid(ANNOUNCE[s]);
    },
    tierOf: (k) => tierRef.current(k),
    mountBack: () => {
      if (!latest.current.noBack) setBackOn(true);
    },
    extraKeys: (e) => latest.current.extraKeys?.(e) ?? false,
    frame: (b) => latest.current.frame?.(b),
    turntable,
    seed,
  };
  if (ctl.current) ctl.current.opts = opts;

  const playAscend = (key: string) => (short: boolean) => {
    const c = ctl.current;
    const tier = tierOf(key);
    if (!c || !tier) return Promise.resolve();
    return loadReveal()
      .then((m) => m.ascend(c, { key, tier, short, onBurst: () => latest.current.onBurst?.(key) }))
      .then(() => latest.current.onSettled?.(key));
  };

  // Mount: the controller, walls, entrances, the mint reveal's face-down start.
  useIsoLayoutEffect(() => {
    const scene = sceneRef.current!;
    const c = new SceneCtl(scene, poseRef.current!, facesRef.current!, edgesRef.current!, groundRef.current, opts, p.front);
    ctl.current = c;
    if (p.ctlRef) p.ctlRef.current = c;
    const unobserve = Engine.observe(scene);
    const lvl = motionLevel();
    if (hand && lvl !== "calm") prefetchReveal();
    if (p.reveal === "mint" && lvl !== "calm") {
      const b = c.ensureBody();
      if (b) {
        b.flip.snap(180);
        poseRef.current!.style.transform = "rotateY(180deg)";
        const tier = tierOf(p.front);
        if (tier) void loadReveal().then((m) => m.mintReveal(c, tier, () => latest.current.onBurst?.(p.front)));
      }
    }
    if (afterHydration && lvl !== "calm") {
      if (enter === "deal") {
        deal(scene, enterRef.current!, groundRef.current, {
          deck: group?.deck?.current ?? null,
          index: cell?.index ?? 0,
          quick: recentlyGathered(),
          onStart: () => group?.dealStart(),
          onEnd: () => group?.dealEnd(),
        });
      } else if (enter === "unbox") unbox(scene, enterRef.current!);
      else if (enter === "liftin") liftin(enterRef.current!);
    } else if (afterHydration && lvl === "calm" && (enter === "deal" || enter === "unbox")) {
      scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    } else if (!afterHydration && !hand && group?.wave && lvl === "full") {
      // A hard load: the server painted these cards at rest, so they never vanish and fly in; a wave of light
      // runs along the shelf instead, once the page has settled.
      wave(scene, enterRef.current!, cell?.index ?? 0);
    }
    // gather() asks for the printed back before it turns the cards face down.
    const needBack = () => setBackOn(true);
    scene.addEventListener("mdx:needback", needBack);
    // Resting table cards catch the light as the page scrolls and as the phone tilts (no body needed).
    const untable = hand ? null : registerTable(scene);
    return () => {
      scene.removeEventListener("mdx:needback", needBack);
      untable?.();
      unobserve();
      c.destroy();
      ctl.current = null;
      if (p.ctlRef) p.ctlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Table backs mount after the body has started. Register their lights as soon as React commits the plane.
  useIsoLayoutEffect(() => {
    if (backOn) ctl.current?.syncLights();
  }, [backOn]);

  // A new front plays its swap (the controller waits for the staged face to decode).
  useEffect(() => {
    ctl.current?.setFront(p.front, p.swap ?? (hand ? "turn" : "fade"), p.swapDir ?? 1, playAscend(p.front));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.front]);

  useEffect(() => {
    ctl.current?.syncSide(p.side);
  }, [p.side]);

  // Calm drops the body (poses go flat); leaving calm brings hand bodies back.
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    if (level === "calm") c.dropBody();
    else if (hand) c.ensureBody();
  }, [level, hand]);

  // A live idle change (Home's Pause stops the featured card breathing too).
  useEffect(() => {
    ctl.current?.setIdle(opts.idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.idle]);

  // The glint group (table cards inside a provider with glint).
  useEffect(() => {
    if (!group?.glint || hand || !sceneRef.current) return;
    const w = cell?.glintWeight ?? 1;
    return group.register(sceneRef.current, () => w);
  }, [group, hand, cell?.glintWeight]);

  useImperativeHandle(
    p.ref,
    () =>
      ({
        side: () => ctl.current?.getSide() ?? "face",
        turnOver: (dir: 1 | -1 = 1) => ctl.current?.turnOver(dir, true),
        claim: () => {
          const c = ctl.current;
          const tier = tierRef.current(c?.shown ?? latest.current.front);
          return c && tier ? loadReveal().then((m) => m.claim(c, tier)) : Promise.resolve();
        },
        jolt: () => ctl.current?.jolt(),
        peek: () => ctl.current?.peek(),
        settle: () => ctl.current?.settle(),
      }) as Card3DHandle & { settle(): void },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const backTheme = list.find((slot) => slot.key === shown)?.backTheme ?? p.backTheme;
  const ph = floatPhase(seed);
  const metal = tierOf(shown)?.key;
  const style = {
    // The design's template: edge material, back palette and motif, halo glow (templates.ts).
    ...(metal ? templateStyle(metal) : null),
    ...(backTheme?.cardTemplate ? designMaterialStyle(backTheme.cardTemplate) : null),
    ...p.style,
    "--float-dur": ph.dur,
    "--float-delay": ph.delay,
    "--pool": poolColor(tierOf(shown) ?? undefined),
  } as CSSProperties;
  const backSizes = p.backSizes ?? (hand ? "(max-width: 1023px) 260px, 360px" : "200px");

  // A card you can turn with the keys is a button to assistive tech (QA: announced as an image, so nobody knew it
  // could be operated); a screen reader's click turns it too (scene.ts).
  const operable = !!p.focusable && flippable;
  const scene = (
    <div
      ref={sceneRef}
      className={`mdx-card3d ${p.sceneClassName ?? ""} ${p.className ?? ""}`}
      data-depth={depth}
      data-metal={metal}
      data-still={!hand && p.idle === "none" ? "" : undefined}
      data-turntable={turntable ? "" : undefined}
      data-side={p.side ?? "face"}
      role={operable ? "button" : "img"}
      aria-label={p.label}
      aria-describedby={operable ? hintId : undefined}
      tabIndex={p.focusable ? 0 : undefined}
      style={style}
    >
      {operable ? (
        <span id={hintId} hidden>
          Press Enter to turn it over.
        </span>
      ) : null}
      {/* The neon halo (hype arcade): the design's glow behind the card, stronger for higher designs (card3d.css). */}
      <i className="mdx-card3d__halo" aria-hidden>
        <b />
      </i>
      {/* The list turntable's neon pedestal (card3d.css): static paint under the card, outside the 3D chain. */}
      {turntable ? <i className="mdx-card3d__pedestal" aria-hidden /> : null}
      <i ref={groundRef} className="mdx-card3d__ground" data-ground={p.ground ?? "shadow"} data-pool={hand ? undefined : ""} aria-hidden />
      <div ref={enterRef} className="mdx-card3d__enter">
        <div className="mdx-card3d__idle">
          <div ref={poseRef} className="mdx-card3d__pose">
            {p.poseBack}
            {/* The slab: its cut edge (walls built after mount), the printed back plane, the face plane. */}
            <div ref={edgesRef} className="mdx-card3d__edges" aria-hidden />
            {/* One shared 2KB SVG for every card, so loading it eagerly costs one cached request and keeps it off the LCP path.
                The design's own back (up to ~190KB) still waits until the card can be seen or is turned. */}
            {backOn ? <BackFace sizes={backSizes} eager eagerPlate={false} theme={backTheme} /> : null}
            <div ref={facesRef} className="mdx-card3d__faces">
              <FaceDepth.Provider value={depth}>
                {list.map((f) => (
                  <div key={f.key} className="mdx-card3d__slot" data-key={f.key} data-on={f.key === shown ? "" : undefined}>
                    {f.node}
                  </div>
                ))}
              </FaceDepth.Provider>
            </div>
            {p.poseFront}
          </div>
        </div>
      </div>
    </div>
  );
  if (p.outside === "none") return scene;
  return (
    <>
      {scene}
      {flippable ? (
        <span className="sr-only" aria-live="polite">
          {said}
        </span>
      ) : null}
      {p.gyroChip && hand ? <GyroChip /> : null}
    </>
  );
}
