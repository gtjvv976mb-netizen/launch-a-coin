import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useAction } from "../components/mintdex/hooks";
import { type CardData } from "../components/mintdex/MintCard";
import { useMe, useRequireMe } from "../components/mintdex/session";
import { SimTag } from "../components/mintdex/trust";
import {
  Button,
  Field,
  Icon,
  Input,
  Modal,
  PageFrame,
  PageHeader,
  TextLink,
  useToast,
} from "../components/mintdex/ui";
import { launch } from "../lib/mintdex/api";
import { LAUNCH_FEE, TICKER_RE } from "../lib/mintdex/constants";
import { quoteBuy } from "../lib/mintdex/curve";
import { sol, tokens } from "../lib/mintdex/format";
import { pageHead, sentences } from "../lib/mintdex/seo";
import { oneOf, searchSchema, text } from "../lib/mintdex/search";
import { LaunchCardPreview, LaunchCardThumb } from "../components/carddex/live/LaunchCardPreview";
import { CardDesignPicker } from "../components/carddex/CardDesignPicker";
import { DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../lib/carddex/designs";
import { allowedQuotesForDesign, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, getTradingPair, isPairAssetKey, type PairAssetKey } from "../lib/carddex/pairs";
import { formatQuoteAmount, initialQuoteReserves, maxInitialBuyQuoteAtoms, parseQuoteAmount, quoteMetrics } from "../lib/carddex/quote-simulation";
import { QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";
import type { LiveLaunchHandle } from "../components/carddex/live/LiveLaunchPanel";
import { liveReadinessQuery, useLiveLaunchOpen, useLiveRecoveryOpen } from "../components/carddex/live/readiness";
import { parseLiveAmount } from "../components/carddex/live/amounts";
import { BUY_DOES_NOT_FIT, BUY_FIT_AFTER_SIGN_IN, useLiveBuyFit } from "../components/carddex/live/buy-fit";
import { PagedMessage } from "../components/carddex/live/PagedMessage";
import type { LiveLaunchIntent } from "../lib/carddex/live/types";

// The mainnet launch panel (wallet signing, ed25519) loads only in live mode, so the test-mode studio skips it.
const LiveLaunchPanel = lazy(() => import("../components/carddex/live/LiveLaunchPanel").then((m) => ({ default: m.LiveLaunchPanel })));

export const Route = createFileRoute("/launch")({
  validateSearch: searchSchema({ design: text(), quote: text(), mode: oneOf(["live", "demo"]) }),
  // Readiness is read on the server, so the HTML is drawn in the mode the page will keep (no test-then-mainnet
  // swap after hydration). It is shared with every readiness reader through the query cache, and switching
  // between Mainnet and Demo (a search change) reuses it instead of asking again.
  loaderDeps: () => ({}),
  staleTime: 30_000,
  loader: async ({ context }) => ({ readiness: await context.queryClient.ensureQueryData(liveReadinessQuery).catch(() => null) }),
  head: () =>
    pageHead({
      path: "/launch",
      title: "Launch a coin | Launch a Card",
      description: sentences(
        "Choose a permanent card design, add your coin details and preview its one-of-one card",
        "Try the full launch as a demo with test SOL",
      ),
    }),
  component: Launch,
});

// ---------------------------------------------------------------- copy

/** The header's one line before anything is typed: what the visitor needs, and that the rest has defaults. */
const CONTEXT = "Name, ticker and artwork are all you need. Everything else has a default.";
const ENTER_TO_UPLOAD = "Try the demo to upload card art and launch.";
/** Under the art field while signed out in the demo: the upload waits, the other steps do not. */
const ART_GATED = "Start the demo to upload. You can fill in the other steps first.";
/** Mainnet mode while new launches are off: a creator can still finish a saved launch. */
const MAINNET_RECOVERY = "New mainnet launches are not open right now. You can still finish a saved launch.";
const TICKER_HELP = "2 to 8 letters or numbers (A to Z, 0 to 9).";

/** The eight steps. Only Coin and Artwork have no default; the review step is where the coin is created. */
const STEPS = ["Coin", "Artwork", "Card design", "Pair", "Description", "Links", "Initial buy", "Review"];
const OPTIONAL_STEPS = new Set([4, 5, 6]);
/** One plain line under each step's title: what the step is for. */
const STEP_INTRO = [
  "Name your coin and choose its ticker.",
  "One square image for your coin and your card's art window.",
  "The frame your card is printed in. You can change it until you launch.",
  "The asset people trade your coin against. SOL suits most coins.",
  "A line or two, printed on your card.",
  "Where people can find your coin. Both are optional.",
  "Buy some of your own coin as it launches. Leave it empty to skip.",
  "Check your coin and card, then launch.",
];

type StepState = "done" | "todo" | "problem";
type StepInfo = { title: string; sub: ReactNode; state: StepState; optional: boolean };

/**
 * The step list: a numbered list of buttons (desktop rail, and the phone's step sheet). The current step is
 * aria-current="step"; each row names its value or what is missing, so the list doubles as progress.
 */
function StepList({ steps, current, onPick }: { steps: StepInfo[]; current: number; onPick: (n: number) => void }) {
  return (
    <ol className="cdx-launch-steps__list">
      {steps.map((s, i) => (
        <li key={s.title}>
          <button
            type="button"
            className="cdx-launch-steps__item"
            data-state={i === current ? "current" : s.state}
            aria-current={i === current ? "step" : undefined}
            onClick={() => onPick(i)}
          >
            <span className="cdx-launch-steps__mark" aria-hidden>
              {i !== current && s.state === "done" ? <Icon name="check" size={14} strokeWidth={2} /> : i !== current && s.state === "problem" ? <Icon name="warning" size={14} /> : <span className="num">{i + 1}</span>}
            </span>
            <span className="cdx-launch-steps__text">
              <span className="cdx-launch-steps__title">{s.title}</span>
              <span className="cdx-launch-steps__sub">{s.sub}</span>
            </span>
            <span className="sr-only">{i === current ? ", current step" : s.state === "done" ? ", done" : s.state === "problem" ? ", needs attention" : ""}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** "Step 3 of 8" over a segmented bar: the segments up to the current step are filled (decorative). */
function StepProgress({ current, total, className = "" }: { current: number; total: number; className?: string }) {
  return (
    <div className={`cdx-launch-progress ${className}`} aria-hidden>
      {Array.from({ length: total }, (_, i) => <i key={i} data-on={i <= current || undefined} />)}
    </div>
  );
}

// ---------------------------------------------------------------- draft

/** The unfinished launch, kept in this browser so a refresh or a detour does not lose it. */
const DRAFT_KEY = "carddex.launch.draft.v1";
type LaunchDraft = {
  name: string; ticker: string; lore: string; website: string; xUrl: string; devBuy: string;
  designKey: string; quoteKey: string; step: number; imageUrl: string | null;
};
function readDraft(): Partial<LaunchDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" ? (value as Partial<LaunchDraft>) : null;
  } catch { return null; }
}
function writeDraft(draft: LaunchDraft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* Storage can be blocked; the form still works, it just is not kept. */ }
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------- helpers

/** Center-crop to a square and re-encode, so every card window gets clean art. */
async function prepareArt(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(900, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.88));
  if (blob) return blob;
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!png) throw new Error("encode failed");
  return png;
}

/** The sized copies the upload carries (backlog P1-4; art.server.ts ART_WIDTHS): thumbnails and grid cards. */
const ART_COPY_WIDTHS = [96, 320, 800] as const;

/**
 * Smaller WebP copies of the prepared (square) art, drawn from the same pixels, for the widths under its own
 * size. The server keeps each one only if it has the original's shape at that width.
 */
async function artCopies(art: Blob): Promise<Array<{ width: number; blob: Blob }>> {
  const bitmap = await createImageBitmap(art);
  try {
    const out: Array<{ width: number; blob: Blob }> = [];
    for (const width of ART_COPY_WIDTHS) {
      if (width >= bitmap.width) continue;
      const height = Math.round((bitmap.height * width) / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.85));
      // A browser without WebP encoding hands back PNG: the copy would not be a saving, so it is left out.
      if (blob && blob.type === "image/webp") out.push({ width, blob });
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/** Mirrors the server's link rules so the error shows under the field instead of as a toast. */
function linkError(value: string, kind: "web" | "x"): string | null {
  const t = value.trim();
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return "Use a full address that starts with https://";
  }
  if (url.protocol !== "https:") return "Links must start with https://";
  if (kind === "x" && !/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return "Use an x.com link.";
  if (t.length > 200) return "That link is too long.";
  return null;
}

type FieldKey = "name" | "ticker" | "website" | "x";

// ---------------------------------------------------------------- view

function Launch() {
  const me = useMe();
  const require = useRequireMe();
  const toast = useToast();
  const navigate = useNavigate();
  const { run, pending, feedback, errorOf, reset } = useAction();

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [lore, setLore] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preparedArt, setPreparedArt] = useState<Blob | null>(null);
  const [liveLocked, setLiveLocked] = useState(false);
  const [liveMint, setLiveMint] = useState<string | null>(null);
  const [liveCreator, setLiveCreator] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [step, setStep] = useState(0);
  // Steps whose Next was pressed with a problem: their fields show errors without waiting for blur.
  const [checked, setChecked] = useState<number[]>([]);
  const [tickerNote, setTickerNote] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Phones and tablets open the step list in a sheet; desktop shows it as the left rail.
  const [stepsOpen, setStepsOpen] = useState(false);
  // A jump past a step with a problem stops there and says so (the field's own error says what to fix).
  const [blockedJump, setBlockedJump] = useState<string | null>(null);
  const viewId = useId();
  const steps = STEPS;
  // A creator's permanent design choice is independent of the token's market data.
  const search = Route.useSearch();
  // Test mode is the default. Mainnet needs both an explicit choice and the owner's switch (CARDDEX_LIVE_LAUNCH_ENABLED).
  // With new launches off, saved-launch recovery (CARDDEX_LIVE_RECOVERY_ENABLED) keeps mainnet mode for finishing one.
  const liveOpen = useLiveLaunchOpen();
  const recoveryOpen = useLiveRecoveryOpen();
  const live = search.mode === "live" && (liveOpen || recoveryOpen);
  const recoveryOnly = live && !liveOpen;
  const liveRef = useRef<LiveLaunchHandle>(null);
  const modeRef = useRef(live);
  modeRef.current = live;
  const previousMode = useRef(live);
  useEffect(() => {
    if (previousMode.current === live) return;
    previousMode.current = live;
    setPreview(null); setImageUrl(null); setPreparedArt(null); setShowErrors(false);
  }, [live]);
  const [designKey, setDesignKey] = useState(() =>
    isCardDesignKey(search.design) ? search.design : DEFAULT_CARD_DESIGN,
  );
  const [quoteKey, setQuoteKey] = useState<PairAssetKey>(() => {
    const bound = boundQuoteForDesign(designKey);
    return bound?.key ?? (isPairAssetKey(search.quote) ? search.quote : defaultQuoteForDesign(designKey).key);
  });
  const [pairNotice, setPairNotice] = useState("");
  const [pairPending, setPairPending] = useState(false);
  const design = getCardDesign(designKey);
  const quoteAsset = getPairAsset(quoteKey);
  const restoreLiveIntent = useCallback((intent: LiveLaunchIntent | null) => {
    setLiveMint(intent?.tokenMint ?? null); setLiveCreator(intent?.creatorWallet ?? null);
    if (!intent) return;
    setName(intent.name); setTicker(intent.symbol); setLore(intent.description);
    setWebsite(intent.website ?? ""); setXUrl(intent.xUrl ?? "");
    setDesignKey(getCardDesign(intent.cardTemplate).key);
    if (isPairAssetKey(intent.quoteAssetKey)) setQuoteKey(intent.quoteAssetKey);
    setPreview(intent.assets.artwork.url);
  }, []);
  useEffect(() => {
    const nextDesign = isCardDesignKey(search.design) ? search.design : DEFAULT_CARD_DESIGN;
    const bound = boundQuoteForDesign(nextDesign);
    const requested = isPairAssetKey(search.quote) ? search.quote : undefined;
    const nextQuote = bound?.key ?? requested ?? defaultQuoteForDesign(nextDesign).key;
    setDesignKey(nextDesign);
    setQuoteKey(nextQuote);
    setDevBuy("");
    setPairNotice(search.quote && !isPairAssetKey(search.quote) ? `That quote asset is unavailable. ${getPairAsset(nextQuote).symbol} is selected; review the quote before creating the coin.` : bound && requested && requested !== bound.key ? `${getCardDesign(nextDesign).name} is paired with ${bound.symbol}; the quote has been matched to this design.` : "");
  }, [search.design, search.quote]);

  // Restore the saved draft once, after the URL's design and quote are applied. A design in the URL wins.
  // The mode is known from the first render (the loader read readiness on the server), so `live` here is the
  // page's real mode, not a test-mode placeholder.
  const restoreStep = useRef<number | null>(null);
  useEffect(() => {
    const d = readDraft();
    if (d) {
      setName(str(d.name).slice(0, 24)); setTicker(str(d.ticker).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      setLore(str(d.lore).slice(0, 280)); setWebsite(str(d.website)); setXUrl(str(d.xUrl));
      const savedDesign = str(d.designKey), savedQuote = str(d.quoteKey);
      if (!search.design && !search.quote && isCardDesignKey(savedDesign) && isPairAssetKey(savedQuote) && allowedQuotesForDesign(savedDesign).some(a => a.key === savedQuote)) {
        setDesignKey(savedDesign); setQuoteKey(savedQuote); setDevBuy(str(d.devBuy));
      }
      // The saved step is a target, not a jump: the effect below re-checks the earlier steps first.
      if (typeof d.step === "number" && Number.isInteger(d.step)) restoreStep.current = Math.max(0, Math.min(7, d.step));
      // Only an uploaded demo image can come back; prepared mainnet art lives in memory.
      if (!live && typeof d.imageUrl === "string" && d.imageUrl.startsWith("/")) { setImageUrl(d.imageUrl); setPreview(d.imageUrl); }
    }
    setDraftReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tickerRef = useRef<HTMLInputElement>(null);
  const artRef = useRef<HTMLButtonElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const xRef = useRef<HTMLInputElement>(null);
  const devRef = useRef<HTMLInputElement>(null);

  const pairConfirmationRef = useRef<HTMLDivElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  const keepDraftRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // Initial buys use the selected quote's atomic units; the demo launch fee remains native test SOL.
  const initialReserves = initialQuoteReserves(quoteKey);
  const parsedDev = devBuy ? parseQuoteAmount(devBuy, quoteKey) : 0;
  const liveDev = parseLiveAmount(devBuy, quoteAsset.decimals);
  const devAtoms = parsedDev ?? 0;
  const maxDev = maxInitialBuyQuoteAtoms(quoteKey);
  const devNaN = live ? liveDev === null : !!devBuy && parsedDev === null;
  const devOver = !live && devAtoms > maxDev;
  const devQuote = !live && devAtoms > 0 && !devNaN && !devOver ? quoteBuy(initialReserves, devAtoms) : null;
  const after = devQuote?.ok ? devQuote.after : initialReserves;
  const metrics = quoteMetrics(after, quoteKey);
  const nativeCost = LAUNCH_FEE + (quoteKey === "sol" && devQuote?.ok ? devQuote.solIn : 0);
  const quoteBalance = me ? quoteKey === "sol" ? me.balance : me.quoteBalances[quoteKey] ?? 0 : 0;
  const devError = devNaN
    ? `Enter a valid ${quoteAsset.symbol} amount with up to ${quoteAsset.decimals} decimals.`
    : devOver
      ? `Initial buy is capped at ${formatQuoteAmount(maxDev, quoteKey)} ${quoteAsset.symbol} in this demo.`
      : devQuote && !devQuote.ok ? `${devQuote.reason}.` : null;
  const balanceError = !live && me && !devError
    ? me.balance < nativeCost
      ? `Not enough test SOL for the launch fee${quoteKey === "sol" ? " and initial buy" : ""}. You have ${sol(me.balance)} SOL.`
      : quoteKey !== "sol" && devQuote?.ok && devQuote.solIn > quoteBalance
        ? `Not enough test ${quoteAsset.symbol}. You have ${formatQuoteAmount(quoteBalance, quoteKey)} ${quoteAsset.symbol}.`
        : null
    : null;

  // Field checks (the server repeats every one of them).
  const nameOk = name.trim().length >= 2;
  const tickerOk = TICKER_RE.test(ticker);
  // Checked where the creator decides on a buy (exact bytes, server side): a buy that cannot fit one transaction for
  // this pair and name is turned off here, and the panel checks again before any artwork is uploaded.
  const buyFits = useLiveBuyFit(live && liveOpen && !liveLocked && step >= 6 && nameOk && tickerOk, name, ticker, quoteKey);
  const buyBlocked = live && buyFits === false;
  // A buy cleared here is also named on the Launch step: the answer can arrive after the creator has moved on.
  const [buyDropped, setBuyDropped] = useState(false);
  useEffect(() => {
    if (!buyBlocked) setBuyDropped(false);
    else if (devBuy) { if (/[1-9]/.test(devBuy)) setBuyDropped(true); setDevBuy(""); }
  }, [buyBlocked, devBuy]);
  const websiteError = linkError(website, "web");
  const xError = linkError(xUrl, "x");
  const ready =
    nameOk &&
    tickerOk &&
    !!(live ? preparedArt : imageUrl) &&
    !websiteError &&
    !xError &&
    !devError &&
    !balanceError &&
    !pairPending &&
    !uploading;

  // An error shows once the field is left with something in it, or after a submit attempt.
  const shown = (key: FieldKey, value: string) =>
    showErrors || (!!touched[key] && value.trim() !== "");
  const stepChecked = (n: number) => showErrors || checked.includes(n);
  const hasArt = !!(live ? preparedArt : imageUrl);
  const nameMsg = !nameOk && (shown("name", name) || stepChecked(0)) ? (name.trim() ? "Use 2 to 24 characters." : "Enter a name, 2 to 24 characters.") : null;
  const tickerMsg = !tickerOk && (shown("ticker", ticker) || stepChecked(0)) ? (ticker ? "Use 2 to 8 letters or numbers." : "Enter a ticker, 2 to 8 letters or numbers.") : null;
  const artMsg = stepChecked(1) && !hasArt && !uploading ? "Add card art." : null;
  const websiteMsg = websiteError && (shown("website", website) || stepChecked(5)) ? websiteError : null;
  const xMsg = xError && (shown("x", xUrl) || stepChecked(5)) ? xError : null;
  const touch = (key: FieldKey) => () => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  const dirty = !!(name || ticker || lore || website || xUrl || devBuy || imageUrl || step);
  useEffect(() => {
    if (!draftReady || (live && liveLocked) || recoveryOnly) return;
    writeDraft(dirty ? { name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, step, imageUrl: live ? null : imageUrl } : null);
  }, [draftReady, dirty, name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, step, imageUrl, live, liveLocked, recoveryOnly]);


  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (live && liveLocked) return;
    const selectedMode = modeRef.current;
    if (!live && !me) {
      // After Enter, focus comes back to the dropzone (a file picker cannot reopen without a click).
      require(() => artRef.current?.focus(), ENTER_TO_UPLOAD, "Start the demo");
      return;
    }
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      toast("err", "Use a PNG, JPG, WEBP or GIF image.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast("err", "That image is over 12 MB. Try a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const blob = await prepareArt(file);
      if (selectedMode !== modeRef.current) return;
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      if (live) {
        setPreparedArt(blob);
        setImageUrl(null);
        return;
      }
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "art.webp" : "art.png");
      // The sized copies ride along; if making them fails, the original alone still uploads.
      for (const c of await artCopies(blob).catch(() => []))
        form.append(`w${c.width}`, c.blob, `art-w${c.width}.webp`);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        ok: boolean;
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok || !body.url)
        throw new Error(body?.error ?? "Upload failed. Try again.");
      setImageUrl(body.url);
    } catch (e) {
      // Nothing half-uploaded stays on screen: the dropzone comes back with the reason in a toast.
      setPreview(null);
      setImageUrl(null);
      setPreparedArt(null);
      toast("err", e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  // Signed out in test mode, art cannot be uploaded yet: the visitor may still browse every step (the Design
  // picker included), and the art field and the final submit ask them to try the demo.
  const artGated = !live && !me;
  /** Each step's own fields, checked as the visitor leaves it (the server repeats every check at launch). */
  const stepProblem = (n: number): RefObject<HTMLElement | null> | null =>
    n === 0 ? (!nameOk ? nameRef : !tickerOk ? tickerRef : null)
      : n === 1 ? (!artGated && (!hasArt || uploading) ? artRef : null)
        : n === 5 ? (websiteError ? websiteRef : xError ? xRef : null)
          : n === 6 ? (devError ? devRef : null)
            : null;
  /** Move to a step. Going forward stops at the first earlier step with a problem and focuses that field. */
  function goTo(target: number, focusStep = false) {
    if (target > step) {
      for (let n = step; n < target; n++) {
        const problem = stepProblem(n);
        if (!problem) continue;
        setChecked(c => (c.includes(n) ? c : [...c, n]));
        setStep(n);
        setBlockedJump(target > n + 1 ? `Finish ${steps[n]} first, then go on to ${steps[target]}.` : null);
        requestAnimationFrame(() => problem.current?.focus({ preventScroll: true }));
        return;
      }
    }
    setBlockedJump(null);
    setStep(target);
    // The step's title takes focus, so a screen reader hears where it is and Tab reaches the first field.
    if (focusStep) requestAnimationFrame(() => document.getElementById("launch-step")?.focus({ preventScroll: true }));
  }
  // A restored draft opens on its saved step only when every step before it still passes; otherwise it opens on
  // the first step with a problem, with that step's errors shown.
  useEffect(() => {
    const target = restoreStep.current;
    if (!draftReady || target === null) return;
    restoreStep.current = null;
    let n = 0;
    while (n < target && !stepProblem(n)) n++;
    if (n < target) setChecked(c => (c.includes(n) ? c : [...c, n]));
    setStep(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady]);
  // Recovery-only mainnet mode opens on the wallet panel, where a saved launch is found and finished.
  useEffect(() => { if (recoveryOnly && draftReady) setStep(7); }, [recoveryOnly, draftReady]);

  /** Start over asks first, in the page: the safe answer is focused, and Escape or Keep editing returns to the trigger. */
  function askStartOver() {
    setConfirmReset(true);
    requestAnimationFrame(() => keepDraftRef.current?.focus({ preventScroll: true }));
  }
  function keepDraft() {
    setConfirmReset(false);
    requestAnimationFrame(() => startOverRef.current?.focus({ preventScroll: true }));
  }

  function startOver() {
    setConfirmReset(false);
    writeDraft(null);
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setName(""); setTicker(""); setLore(""); setWebsite(""); setXUrl(""); setDevBuy("");
    setPreview(null); setImageUrl(null); setPreparedArt(null); setTickerNote("");
    setTouched({}); setChecked([]); setShowErrors(false); setStep(0); setBlockedJump(null);
    reset("launch");
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  }

  function focusFirstProblem() {
    setBlockedJump(null);
    if (pairPending) {
      setStep(3);
      requestAnimationFrame(() => pairConfirmationRef.current?.focus({ preventScroll: true }));
      return;
    }
    const first = !nameOk ? nameRef : !tickerOk ? tickerRef : !(live ? preparedArt : imageUrl) ? artRef : websiteError ? websiteRef : xError ? xRef : devError || (balanceError && devQuote?.ok) ? devRef : null;
    setStep(first === artRef ? 1 : first === websiteRef || first === xRef ? 5 : first === devRef ? 6 : 0);
    requestAnimationFrame(() => first?.current?.focus({ preventScroll: true }));
  }

  async function attempt() {
    if (modeRef.current) return;
    if (pending === "launch" || uploading) return;
    if (!ready || !imageUrl) {
      setShowErrors(true);
      focusFirstProblem();
      return;
    }
    const res = await run(
      "launch",
      () =>
        launch({
          data: {
            name,
            cardTemplate: designKey,
            quoteAssetKey: quoteKey,
            quoteMint: quoteAsset.mint,
            ticker,
            image: imageUrl,
            lore,
            website: website.trim() || undefined,
            xUrl: xUrl.trim() || undefined,
            devBuy: devQuote?.ok ? devAtoms : 0,
          },
        }),
      undefined,
      { keys: [["home"], ["coins"], ["market"], ["portfolio"]] },
    );
    // The coin page opens "Your card is live" (P1-12) for ?minted=1, then drops the flag from the URL.
    if (res) writeDraft(null);
    if (res) navigate({ to: "/coin/$id", params: { id: res.id }, search: { minted: 1 } });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (step !== 7) { goTo(Math.min(7, step + 1), true); return; }
    if (pairPending) {
      focusFirstProblem();
      return;
    }
    if (live) {
      if (!ready && !liveLocked && !recoveryOnly) { setShowErrors(true); focusFirstProblem(); return; }
      liveRef.current?.submit();
      return;
    }
    // Signed out: the Enter dialog names the launch, then finishes it (P1-11). Without art yet, that means
    // pointing at the art field, the one thing left to do.
    require(() => void attempt(), imageUrl ? "Try the demo to launch a coin." : ENTER_TO_UPLOAD, ticker && imageUrl
      ? `Start the demo and launch $${ticker}`
      : "Start the demo");
  }

  const tickerText = ticker ? `$${ticker}` : "coins";
  const launchError = errorOf("launch");
  // Any edit after a failed launch clears its reason.
  useEffect(() => {
    reset("launch");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ticker, lore, website, xUrl, devBuy, imageUrl, quoteKey, designKey]);

  // The live preview's data: the big stage on desktop, the small card beside Name and Ticker on phones.
  const previewCard: CardData = {
    name: name.trim() || "Your coin",
    ticker: ticker || "TICKER",
    image: preview ?? "",
    level: design.materialLevel,
    cardTemplate: designKey,
    // The same live quote and identity fields occupy the same card slots in every finish.
    quoteAssetKey: quoteKey,
    quoteMint: quoteAsset.mint,
    mcapUsd: live ? null : metrics.mcapUsd,
    mcapQuote: live ? undefined : metrics.mcapQuote,
    mcapLabel: live ? "At launch" : undefined,
    holders: devQuote?.ok ? 1 : 0,
    dexNo: 0,
    dexLabel: "New",
    ownerHandle: live ? liveCreator ? `${liveCreator.slice(0, 4)}…${liveCreator.slice(-4)}` : "Creator" : me?.handle ?? "you",
    mintAddress: live ? liveMint : undefined,
    lore: lore.trim() || undefined,
  };
  const changePair = (nextQuote: PairAssetKey, nextDesign: string) => {
    if (live && liveLocked) return;
    if (!isCardDesignKey(nextDesign) || !allowedQuotesForDesign(nextDesign).some(a => a.key === nextQuote)) return;
    const changed = nextQuote !== quoteKey;
    setDesignKey(nextDesign);
    setQuoteKey(nextQuote);
    if (changed) setDevBuy("");
    setPairNotice(changed ? `Pair changed to ${getPairAsset(nextQuote).symbol}.${devBuy ? " The initial buy was cleared so its amount is not reused in another asset." : ""}` : "");
  };
  const pick = (key: string) => {
    if (!isCardDesignKey(key)) return;
    changePair(boundQuoteForDesign(key)?.key ?? quoteKey, key);
  };

  // ------------------------------------------------ the step list's rows (value, or what is missing)
  const locked = live && liveLocked;
  const linkCount = (website.trim() ? 1 : 0) + (xUrl.trim() ? 1 : 0);
  const buyText = live
    ? liveDev && liveDev !== "0" ? `${devBuy} ${quoteAsset.symbol}` : null
    : devQuote?.ok ? `${formatQuoteAmount(devQuote.solIn, quoteKey)} ${quoteAsset.symbol}` : null;
  const shownProblem = (n: number) => stepChecked(n) && !!stepProblem(n);
  const stepInfo: StepInfo[] = steps.map((title, n) => {
    const optional = OPTIONAL_STEPS.has(n);
    const problem = shownProblem(n);
    const state: StepState = problem ? "problem"
      : n === 0 ? nameOk && tickerOk ? "done" : "todo"
        : n === 1 ? hasArt ? "done" : "todo"
          : n === 2 ? "done"
            : n === 3 ? pairPending ? "problem" : "done"
              : n === 4 ? lore.trim() ? "done" : "todo"
                : n === 5 ? linkCount && !websiteError && !xError ? "done" : websiteError || xError ? "problem" : "todo"
                  : n === 6 ? devError ? "problem" : buyText ? "done" : "todo"
                    : "todo";
    const sub = n === 0 ? nameOk && tickerOk ? `${name.trim()} · $${ticker}` : "Name and ticker"
      : n === 1 ? uploading ? "Uploading…" : hasArt ? "Added" : "Required"
        : n === 2 ? design.name
          : n === 3 ? pairPending ? "Confirm the change" : ticker ? getTradingPair(ticker, quoteKey) : `${quoteAsset.symbol} pair`
            : n === 4 ? lore.trim() ? "Added" : "Optional"
              : n === 5 ? websiteError || xError ? "Check the link" : linkCount ? `${linkCount} ${linkCount === 1 ? "link" : "links"}` : "Optional"
                : n === 6 ? devError ? "Check the amount" : buyText ?? "Optional"
                  : "Check and launch";
    return { title, sub, state, optional };
  });
  const pickStep = (n: number) => { setStepsOpen(false); goTo(n); };

  // ------------------------------------------------ the review summary
  const missing = (text: string) => <span className="cdx-launch-summary__missing">{text}</span>;
  const none = <span className="cdx-launch-summary__none">None</span>;
  const firstLine = lore.trim().split(/\n/)[0];
  const summary: Array<{ label: string; step: number; value: ReactNode; required?: boolean; ok: boolean }> = [
    { label: "Name", step: 0, value: nameOk ? name.trim() : missing(name.trim() ? "Too short" : "Missing"), required: true, ok: nameOk },
    { label: "Ticker", step: 0, value: tickerOk ? `$${ticker}` : missing(ticker ? "Too short" : "Missing"), required: true, ok: tickerOk },
    { label: "Artwork", step: 1, value: preview ? <img className="cdx-launch-summary__thumb" src={preview} alt="Your artwork" width={40} height={40} /> : missing("Missing"), required: true, ok: hasArt },
    { label: "Card design", step: 2, value: design.name, ok: true },
    { label: "Pair", step: 3, value: ticker ? getTradingPair(ticker, quoteKey) : `${quoteAsset.symbol} pair`, ok: !pairPending },
    { label: "Description", step: 4, value: firstLine ? <span className="cdx-launch-summary__clip">{firstLine}</span> : none, ok: true },
    { label: "Links", step: 5, value: websiteError || xError ? missing("Check the link") : linkCount ? <span className="cdx-launch-summary__clip">{[website.trim(), xUrl.trim()].filter(Boolean).map(u => u.replace(/^https:\/\//, "")).join(" · ")}</span> : none, ok: !websiteError && !xError },
    { label: "Initial buy", step: 6, value: devError ? missing("Check the amount") : buyText ? <span className="num">{buyText}</span> : none, ok: !devError },
  ];
  const showSummary = !recoveryOnly || liveLocked;

  // ------------------------------------------------ the header's one line
  const draftLine = dirty && !locked && !recoveryOnly;
  const context = recoveryOnly ? MAINNET_RECOVERY : draftLine ? (
    <span className="cdx-launch-draft">
      <span>Draft saved in this browser</span>
      <span aria-hidden> · </span>
      <button ref={startOverRef} type="button" className="mdx-link mdx-hit" aria-expanded={confirmReset} aria-controls={confirmReset ? `${viewId}-reset` : undefined} onClick={() => (confirmReset ? keepDraft() : askStartOver())}>Start over</button>
    </span>
  ) : CONTEXT;
  const stepCount = `Step ${step + 1} of ${steps.length}`;
  const optionalNow = OPTIONAL_STEPS.has(step);

  return (
    <PageFrame className="mdx-page cdx-launch">
      <PageHeader title="Launch a coin" context={context} wrapContext right={liveOpen || recoveryOpen ? (
        <nav className="cdx-launch-mode" aria-label="Launch mode">
          <Link to="/launch" search={{ design: designKey, quote: quoteKey, mode: "live" }} aria-label={liveOpen ? "Mainnet wallet launch" : "Finish a saved mainnet launch"} aria-current={live ? "page" : undefined}>{liveOpen ? "Mainnet" : "Saved launch"}</Link>
          <Link to="/launch" search={{ design: designKey, quote: quoteKey, mode: "demo" }} aria-current={!live ? "page" : undefined}>Demo</Link>
        </nav>
      ) : undefined} />
      {/* Announced once, when the draft first starts saving (the visible words sit in the header line). */}
      <p className="sr-only" aria-live="polite">{draftLine ? "Draft saved in this browser." : ""}</p>

      <div className="cdx-launch-grid">
        {/* ------------------------------------------------ the step rail (desktop) */}
        <nav className="cdx-launch-steps" aria-label="Launch steps">
          <p className="cdx-launch-steps__count">{stepCount}</p>
          <StepProgress current={step} total={steps.length} />
          <StepList steps={stepInfo} current={step} onPick={goTo} />
        </nav>

        {/* ------------------------------------------------ the form (the one panel) */}
        <form
          id={`${viewId}-details`}
          onSubmit={submit}
          noValidate
          aria-label="New coin"
          className="cdx-create-form mdx-plinth"
          data-step={step}
        >
          <div className="cdx-launch-step-head">
            <div className="cdx-launch-step-head__text">
              <button type="button" className="cdx-launch-step-head__count" aria-haspopup="dialog" onClick={() => setStepsOpen(true)}>
                <span>{stepCount}{optionalNow ? " · Optional" : ""}</span>
                <Icon name="chevron-down" size={14} />
                <span className="sr-only">: all steps</span>
              </button>
              <h2 id="launch-step" tabIndex={-1} className="cdx-launch-step-head__title">{steps[step]}</h2>
              <p className="cdx-launch-step-head__intro">{STEP_INTRO[step]}</p>
            </div>
            <LaunchCardThumb card={previewCard} />
          </div>
          <StepProgress current={step} total={steps.length} className="cdx-launch-progress--form" />
          <p className="sr-only" aria-live="polite">{`${stepCount}: ${steps[step]}`}</p>
          {blockedJump ? <p className="cdx-launch-blocked" role="status">{blockedJump}</p> : null}

          {confirmReset && dirty && !locked ? (
            <div id={`${viewId}-reset`} role="group" aria-labelledby={`${viewId}-reset-q`} className="cdx-launch-reset" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); keepDraft(); } }}>
              <p id={`${viewId}-reset-q`} className="cdx-launch-reset__q">Clear every field and the uploaded art?</p>
              <p className="cdx-launch-reset__note">Your draft lives only in this browser, so this cannot be undone.</p>
              <div className="cdx-launch-reset__actions">
                <Button ref={keepDraftRef} onClick={keepDraft}>Keep editing</Button>
                <Button variant="danger" onClick={startOver}>Clear draft</Button>
              </div>
            </div>
          ) : null}

          <div className="cdx-launch-content" hidden={confirmReset && dirty && !locked}>
            <div className="cdx-launch-step cdx-launch-identity" hidden={step !== 0}>
              <Field label="Name" htmlFor="name" error={nameMsg} help="2 to 24 characters." className="min-w-0">
                <Input
                  disabled={locked}
                  ref={nameRef}
                  id="name"
                  value={name}
                  maxLength={24}
                  required
                  aria-required="true"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => { setName(n => n.trim()); touch("name")(); }}
                  placeholder="e.g. Glorb"
                  autoComplete="off"
                  aria-invalid={nameMsg ? true : undefined}
                  aria-describedby="name-help"
                />
              </Field>
              <Field label="Ticker" htmlFor="ticker" error={tickerMsg ? `${tickerMsg}${tickerNote ? ` ${tickerNote}` : ""}` : null} help={<span aria-live="polite">{tickerNote || TICKER_HELP}</span>} className="min-w-0">
                <Input
                  disabled={locked}
                  ref={tickerRef}
                  id="ticker"
                  prefix="$"
                  value={ticker}
                  required
                  aria-required="true"
                  onChange={(e) => {
                    // The 8-character limit counts the cleaned ticker, and anything removed is explained.
                    const typed = e.target.value.toUpperCase();
                    const clean = typed.replace(/[^A-Z0-9]/g, "");
                    setTicker(clean.slice(0, 8));
                    setTickerNote(clean.length < typed.length
                      ? "Only letters A to Z and numbers 0 to 9 are allowed, so other characters were removed."
                      : clean.length > 8 ? "Tickers are up to 8 characters, so the rest was left out." : "");
                  }}
                  onBlur={touch("ticker")}
                  placeholder="e.g. GLORB"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={tickerMsg ? true : undefined}
                  aria-describedby="ticker-help"
                />
              </Field>
            </div>

            <div className="cdx-launch-step" hidden={step !== 1}>
              <Field label="Artwork" htmlFor="art" error={artMsg} help={artGated && !preview ? ART_GATED : undefined} className="min-w-0">
                <button
                  ref={artRef}
                  disabled={locked}
                  id="art"
                  type="button"
                  data-over={dragging ? "true" : undefined}
                  data-filled={preview ? "true" : undefined}
                  aria-label={preview ? "Artwork. Choose another image to replace it" : "Artwork. Drop an image or choose one to upload"}
                  aria-describedby={artMsg || (artGated && !preview) ? "art-help" : "art-spec"}
                  aria-invalid={artMsg ? true : undefined}
                  aria-busy={uploading || undefined}
                  onClick={() => live || me ? fileRef.current?.click() : require(() => artRef.current?.focus(), ENTER_TO_UPLOAD, "Start the demo")}
                  onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`mdx-drop cdx-launch-art ${artMsg ? "border-down" : ""}`}
                >
                  <span className="cdx-launch-art__frame" aria-hidden data-busy={uploading || undefined}>
                    {preview && !uploading ? <img src={preview} alt="" draggable={false} className="cdx-launch-art__image" /> : uploading ? null : <Icon name="plus" size={20} />}
                  </span>
                  <span className="cdx-launch-art__copy">
                    <strong>{uploading ? "Preparing artwork…" : preview ? "Replace artwork" : "Upload artwork"}</strong>
                    <span id="art-spec">PNG, JPG, WEBP or GIF up to 12 MB. Square works best; other shapes are cropped to the centre.</span>
                  </span>
                </button>
                <input disabled={locked} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
              </Field>
            </div>

            <div className="cdx-launch-step" hidden={step !== 2}>
              <CardDesignPicker value={designKey} onChange={pick} onPairChange={changePair} quoteAssetKey={quoteKey} ticker={ticker} previewCard={previewCard} disabled={locked} compact />
            </div>

            <div className="cdx-launch-step" hidden={step !== 3}>
              <QuoteAssetPicker viewport value={quoteKey} designKey={designKey} ticker={ticker || "YOUR COIN"} onChange={changePair} onPendingChange={setPairPending} confirmationRef={pairConfirmationRef} live={live} disabled={locked} balance={!live && me ? formatQuoteAmount(quoteBalance, quoteKey) : undefined} compact />
              {pairNotice && !pairPending ? <p className="cdx-pair-notice" role="status">{pairNotice}</p> : null}
            </div>

            <div className="cdx-launch-step" hidden={step !== 4}>
              <Field label="Description (optional)" htmlFor="lore" className="min-w-0" right={<span className="num">{lore.length}/280</span>} help={live ? "Permanent once your coin is created." : "Printed on your card."}>
                <textarea disabled={locked} id="lore" maxLength={280} value={lore} onChange={e => setLore(e.target.value)} placeholder="e.g. The first frog to reach the moon." aria-describedby="lore-help" className="mdx-input cdx-launch-description" />
              </Field>
            </div>

            <div className="cdx-launch-step" hidden={step !== 5}>
              <Field label="Website (optional)" htmlFor="website" error={websiteMsg} className="min-w-0">
                <Input
                  disabled={locked}
                  ref={websiteRef}
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  onBlur={touch("website")}
                  placeholder="https://"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  aria-invalid={websiteMsg ? true : undefined}
                  aria-describedby={websiteMsg ? "website-help" : undefined}
                />
              </Field>
              <Field label="X link (optional)" htmlFor="x" error={xMsg} className="min-w-0">
                <Input
                  disabled={locked}
                  ref={xRef}
                  id="x"
                  value={xUrl}
                  onChange={(e) => setXUrl(e.target.value)}
                  onBlur={touch("x")}
                  placeholder="https://x.com/yourcoin"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={xMsg ? true : undefined}
                  aria-describedby={xMsg ? "x-help" : undefined}
                />
              </Field>
            </div>

            <div className="cdx-launch-step" hidden={step !== 6}>
              <Field label="Initial buy (optional)" htmlFor="dev">
                <Input
                  disabled={locked || buyBlocked}
                  ref={devRef}
                  id="dev"
                  numeric
                  suffix={quoteAsset.symbol}
                  inputMode="decimal"
                  autoComplete="off"
                  value={devBuy}
                  onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  aria-invalid={devError ? true : undefined}
                  aria-describedby="dev-note"
                />
              </Field>
              {/* Only the estimate is announced as it changes. */}
              <div id="dev-note" className="cdx-launch-note">
                {devError ? (
                  <p role="alert" className="cdx-launch-note__error">{devError}</p>
                ) : buyBlocked ? (
                  <p role="status">{BUY_DOES_NOT_FIT}</p>
                ) : !devQuote?.ok ? (
                  <p>{live ? `Paid in real ${quoteAsset.symbol} with your coin's creation.${buyFits === null ? ` ${BUY_FIT_AFTER_SIGN_IN}` : ""} The exact amount and slippage show before your wallet opens.` : `Paid in test ${quoteAsset.symbol}. Up to ${formatQuoteAmount(maxDev, quoteKey)} ${quoteAsset.symbol} in this demo.`}</p>
                ) : null}
                <p aria-live="polite" className="empty:hidden">
                  {devQuote?.ok && !devError ? (
                    <>
                      You get{" "}
                      <span className="text-ink">
                        <span className="num">{tokens(devQuote.tokensOut)}</span> {tickerText}
                      </span>{" "}
                      first.
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            {/* ------------------------------------------------ review: everything you chose, then the cost */}
            <div className="cdx-launch-step cdx-launch-commit" hidden={step !== 7}>
              {showSummary ? (
                <section className="cdx-launch-review" aria-labelledby={`${viewId}-summary`}>
                  <h3 id={`${viewId}-summary`} className="sr-only">Your coin and card</h3>
                  <dl className="cdx-launch-summary">
                    {summary.map(row => (
                      <div key={row.label} data-missing={!row.ok || undefined}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                        {!locked ? (
                          <dd className="cdx-launch-summary__edit">
                            <button type="button" className="mdx-link mdx-hit" onClick={() => goTo(row.step, true)} aria-label={`${row.ok || !row.required ? "Edit" : "Add"} ${row.label.toLowerCase()}`}>{row.ok || !row.required ? "Edit" : "Add"}</button>
                          </dd>
                        ) : null}
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              {live ? <Suspense fallback={<div className="mdx-skeleton cdx-launch-live-skeleton" aria-hidden />}><LiveLaunchPanel ref={liveRef} launchesOpen={liveOpen} notice={buyDropped ? BUY_DOES_NOT_FIT : null} card={previewCard} draft={ready && preparedArt && liveDev !== null ? { name: name.trim(), symbol: ticker, description: lore.trim(), website: website.trim(), xUrl: xUrl.trim(), cardTemplate: designKey, quoteAssetKey: quoteKey, quoteMint: quoteAsset.mint, initialBuyQuoteBaseUnits: liveDev, artwork: preparedArt } : null} pairPending={pairPending} onLockedChange={setLiveLocked} onIntentLoaded={restoreLiveIntent} onInvalid={() => { setShowErrors(true); focusFirstProblem(); }} /></Suspense> : (
                <section className="cdx-launch-review" aria-labelledby={`${viewId}-cost`}>
                  <div className="cdx-launch-section-row">
                    <h3 id={`${viewId}-cost`} className="cdx-launch-section">Cost</h3>
                    <SimTag />
                  </div>
                  {/* The line items; their total sits on the footer beside the button that pays it. */}
                  <dl className="cdx-launch-cost">
                    <div><dt>Launch cost</dt><dd><span className="num">{sol(LAUNCH_FEE, 3)}</span> <span className="mdx-unit">test SOL</span></dd></div>
                    <div><dt>Initial buy</dt><dd>{devQuote?.ok ? <><span className="num">{quoteKey === "sol" ? sol(devQuote.solIn, 3) : formatQuoteAmount(devQuote.solIn, quoteKey)}</span> <span className="mdx-unit">test {quoteAsset.symbol}</span></> : none}</dd></div>
                    <div><dt>Platform fee</dt><dd>None</dd></div>
                  </dl>
                  <p className="cdx-launch-fee-note">Launch a Card charges no platform fee. The launch cost stands in for the network fees and account rent a mainnet launch pays.</p>
                  <p className="cdx-launch-demo-note">{liveOpen ? "" : "Mainnet launches are not open yet. "}This demo uses test SOL{quoteKey === "sol" ? "" : ` and test ${quoteAsset.symbol}`}: no real coin or card is created.</p>
                  <p className="cdx-launch-rules">By creating this coin you agree to the <TextLink to="/legal" hash="terms">content rules</TextLink>.</p>
                </section>
              )}
            </div>
          </div>

          {/* ------------------------------------------------ one primary per step, always at the right */}
          <div className="cdx-launch-step-footer" hidden={confirmReset && dirty && !locked}>
            {/* What stops the launch, said beside the button: the balance check, a pending pair change, the server's reason. */}
            {step === 7 && !live && balanceError ? <PagedMessage text={balanceError} alert /> : null}
            {step === 7 && !live && pairPending ? <p className="cdx-pair-notice" role="status">Confirm or cancel the pair change on the Pair step before creating this demo coin.</p> : null}
            {step === 7 && !live && launchError ? <PagedMessage text={launchError} alert /> : null}
            {step === 7 && !live ? (
              <p className="cdx-launch-total">
                <span>Total</span>
                <span><span className="num">{sol(nativeCost, 3)}</span> <span className="mdx-unit">test SOL</span>{quoteKey !== "sol" && devQuote?.ok ? <span className="cdx-launch-cost__plus"> + <span className="num">{formatQuoteAmount(devQuote.solIn, quoteKey)}</span> test {quoteAsset.symbol}</span> : null}</span>
              </p>
            ) : null}
            <div className="cdx-launch-step-footer__row">
            {step > 0 ? <Button variant="outline" onClick={() => goTo(Math.max(0, step - 1), true)}>Back</Button> : <span aria-hidden />}
            <div className="cdx-launch-step-footer__end">
              {optionalNow && step < 6 ? <button type="button" className="mdx-link mdx-hit cdx-launch-skip" onClick={() => goTo(7, true)}>Skip to review</button> : null}
              {step < 7 ? (
                <Button type="submit">Next: {steps[step + 1]}</Button>
              ) : !live ? (
                <Button
                  type="submit"
                  pending={pending === "launch"}
                  pendingLabel="Creating your coin…"
                  disabled={pairPending || (!!me && uploading)}
                  onBlocked={pairPending ? focusFirstProblem : undefined}
                  feedback={feedback("launch")}
                  successLabel="Created"
                >
                  {!me ? "Try the demo to launch" : uploading ? "Uploading art…" : "Create demo coin and card"}
                </Button>
              ) : null}
            </div>
            </div>
          </div>
        </form>

        {/* ------------------------------------------------ the live card on its stage */}
        <section id={`${viewId}-card`} aria-label="Your card preview" className="cdx-create-preview">
          <LaunchCardPreview card={previewCard} />
          <p className="cdx-create-preview__note">Live preview. It changes as you edit.</p>
        </section>
      </div>

      <Modal open={stepsOpen} onOpenChange={setStepsOpen} title="Launch steps" description={`${stepCount}. Choose a step to go to it.`}>
        <nav className="cdx-launch-steps cdx-launch-steps--sheet" aria-label="Launch steps">
          <StepList steps={stepInfo} current={step} onPick={pickStep} />
        </nav>
      </Modal>
    </PageFrame>
  );
}
