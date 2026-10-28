import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { ConfirmDialog } from "../components/mintdex/confirm";
import { useAction } from "../components/mintdex/hooks";
import { type CardData } from "../components/mintdex/MintCard";
import { useMe, useRequireMe } from "../components/mintdex/session";
import { SimTag } from "../components/mintdex/trust";
import {
  ActionBar,
  Button,
  Field,
  Icon,
  Input,
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
import { LaunchCardPreview, LaunchCardRow } from "../components/carddex/live/LaunchCardPreview";
import { CardDesignPicker } from "../components/carddex/CardDesignPicker";
import { DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../lib/carddex/designs";
import { allowedQuotesForDesign, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, isPairAssetKey, type PairAssetKey } from "../lib/carddex/pairs";
import { formatQuoteAmount, initialQuoteReserves, maxInitialBuyQuoteAtoms, parseQuoteAmount, quoteMetrics } from "../lib/carddex/quote-simulation";
import { QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";
import type { LiveLaunchHandle, LivePrimary } from "../components/carddex/live/LiveLaunchPanel";
import { firstProblem, enterTarget, quickBuyAmounts, sameAmount, type FormCheck } from "../components/carddex/launch-form";
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
/** Under the art field while signed out in the demo: the upload waits, the other fields do not. */
const ART_GATED = "Start the demo to upload. You can fill in everything else first.";
/** Mainnet mode while new launches are off: a creator can still finish a saved launch. */
const MAINNET_RECOVERY = "New mainnet launches are not open right now. You can still finish a saved launch.";
const TICKER_HELP = "2 to 8 letters or numbers (A to Z, 0 to 9).";

// ---------------------------------------------------------------- draft

/** The unfinished launch, kept in this browser so a refresh or a detour does not lose it. */
const DRAFT_KEY = "carddex.launch.draft.v1";
type LaunchDraft = {
  name: string; ticker: string; lore: string; website: string; xUrl: string; devBuy: string;
  designKey: string; quoteKey: string; imageUrl: string | null;
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
/** The form's checks, in DOM order: the first one that fails takes focus (Launch pressed, or Enter in a field). */
type ProblemKey = "name" | "ticker" | "art" | "pair" | "buy" | "website" | "x";

/** A value that settles: it follows `value` once it has held still for `ms`. */
function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// ---------------------------------------------------------------- view

/**
 * One page, one Launch button (density R5): the form with every field on it, the live card, and the ticket (every
 * cost line, the total and the primary). No steps and no separate review; Enter never submits (it moves on to the
 * next field that needs something, or to the primary). Below 1024px the page's action bar carries the primary.
 */
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
  const [tickerNote, setTickerNote] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // Mainnet only: the initial buy's slippage, chosen beside the buy (the panel sends it with the prepared launch).
  const [slippageBps, setSlippageBps] = useState(100);
  // The live ticket's primary, mirrored into the phone action bar (LiveLaunchPanel reports it when it changes).
  const [livePrimary, setLivePrimary] = useState<LivePrimary | null>(null);
  const viewId = useId();
  const formId = `${viewId}-form`;
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
  // page's real mode, not a test-mode placeholder. A step saved by the old step-by-step form is ignored.
  useEffect(() => {
    const d = readDraft();
    if (d) {
      setName(str(d.name).slice(0, 24)); setTicker(str(d.ticker).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      setLore(str(d.lore).slice(0, 280)); setWebsite(str(d.website)); setXUrl(str(d.xUrl));
      const savedDesign = str(d.designKey), savedQuote = str(d.quoteKey);
      if (!search.design && !search.quote && isCardDesignKey(savedDesign) && isPairAssetKey(savedQuote) && allowedQuotesForDesign(savedDesign).some(a => a.key === savedQuote)) {
        setDesignKey(savedDesign); setQuoteKey(savedQuote); setDevBuy(str(d.devBuy));
      }
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
  const loreRef = useRef<HTMLTextAreaElement>(null);
  const pairConfirmationRef = useRef<HTMLDivElement>(null);

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
  // Checked as soon as the name and ticker settle (exact bytes, server side): a buy that cannot fit one transaction
  // for this pair and name is turned off here, and the panel checks again before any artwork is uploaded.
  const fitName = useSettledValue(name.trim(), 500);
  const fitTicker = useSettledValue(ticker, 500);
  const buyFits = useLiveBuyFit(live && liveOpen && !liveLocked && fitName.length >= 2 && TICKER_RE.test(fitTicker), fitName, fitTicker, quoteKey);
  const buyBlocked = live && buyFits === false;
  // A buy cleared here is also named beside the Launch button: the answer can arrive after the creator has moved on.
  const [buyDropped, setBuyDropped] = useState(false);
  useEffect(() => {
    if (!buyBlocked) setBuyDropped(false);
    else if (devBuy) { if (/[1-9]/.test(devBuy)) setBuyDropped(true); setDevBuy(""); }
  }, [buyBlocked, devBuy]);
  const websiteError = linkError(website, "web");
  const xError = linkError(xUrl, "x");
  const hasArt = !!(live ? preparedArt : imageUrl);
  const ready =
    nameOk &&
    tickerOk &&
    hasArt &&
    !websiteError &&
    !xError &&
    !devError &&
    !balanceError &&
    !pairPending &&
    !uploading;

  // An error shows once the field is left with something in it, or after Launch is pressed.
  const shown = (key: FieldKey, value: string) =>
    showErrors || (!!touched[key] && value.trim() !== "");
  const nameMsg = !nameOk && shown("name", name) ? (name.trim() ? "Use 2 to 24 characters." : "Enter a name, 2 to 24 characters.") : null;
  const tickerMsg = !tickerOk && shown("ticker", ticker) ? (ticker ? "Use 2 to 8 letters or numbers." : "Enter a ticker, 2 to 8 letters or numbers.") : null;
  const artMsg = showErrors && !hasArt && !uploading ? "Add card art." : null;
  const websiteMsg = websiteError && shown("website", website) ? websiteError : null;
  const xMsg = xError && shown("x", xUrl) ? xError : null;
  const touch = (key: FieldKey) => () => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  const dirty = !!(name || ticker || lore || website || xUrl || devBuy || imageUrl);
  useEffect(() => {
    if (!draftReady || (live && liveLocked) || recoveryOnly) return;
    writeDraft(dirty ? { name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, imageUrl: live ? null : imageUrl } : null);
  }, [draftReady, dirty, name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, imageUrl, live, liveLocked, recoveryOnly]);

  // The description grows with its text (field-sizing in launch.css); browsers without it are sized here, so the
  // box never scrolls on its own.
  useEffect(() => {
    const el = loreRef.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content"))) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [lore]);

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

  /** Remove the art: the dropzone comes back empty and takes focus (the blob preview is released by the effect above). */
  function removeArt() {
    setPreview(null); setImageUrl(null); setPreparedArt(null);
    requestAnimationFrame(() => artRef.current?.focus({ preventScroll: true }));
  }

  // Signed out in test mode, art cannot be uploaded yet: every other field still works, and the art field and the
  // Launch button ask them to try the demo.
  const artGated = !live && !me;

  // ------------------------------------------------ where focus goes when something is missing
  const checks = (): FormCheck<ProblemKey>[] => [
    { key: "name", ok: nameOk },
    { key: "ticker", ok: tickerOk },
    { key: "art", ok: hasArt && !uploading },
    { key: "pair", ok: !pairPending },
    { key: "buy", ok: !devError && !(balanceError && devQuote?.ok) },
    { key: "website", ok: !websiteError },
    { key: "x", ok: !xError },
  ];
  const problemRefs: Record<ProblemKey, RefObject<HTMLElement | null>> = {
    name: nameRef, ticker: tickerRef, art: artRef, pair: pairConfirmationRef, buy: devRef, website: websiteRef, x: xRef,
  };
  /** Focus, then bring it into view at once (no smooth scroll); scroll-margin keeps it clear of the action bar. */
  const land = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };
  /** The primary on screen: the ticket's button from 1024px, the action bar's below. */
  const visiblePrimary = () =>
    [...(document.querySelectorAll<HTMLElement>("[data-launch-primary]"))].find((el) => el.getClientRects().length > 0);
  function focusFirstProblem() {
    const key = firstProblem(checks());
    if (key) requestAnimationFrame(() => land(problemRefs[key].current));
  }
  /** Enter in a text field never submits: it moves to the next field that needs something, or to the primary. */
  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const field = e.target;
    if (!(field instanceof HTMLInputElement) || !["text", "url", "number", "search"].includes(field.type)) return;
    e.preventDefault();
    const target = enterTarget(checks());
    if (target === "primary") land(visiblePrimary());
    else {
      if (target !== "pair") setTouched((t) => ({ ...t, [target]: true }));
      land(problemRefs[target].current);
    }
  }

  // ------------------------------------------------ Start over (a confirm dialog; the safe answer has focus)
  const clearedRef = useRef(false);
  function startOver() {
    clearedRef.current = true;
    setResetOpen(false);
    writeDraft(null);
    setName(""); setTicker(""); setLore(""); setWebsite(""); setXUrl(""); setDevBuy("");
    setPreview(null); setImageUrl(null); setPreparedArt(null); setTickerNote("");
    setTouched({}); setShowErrors(false);
    reset("launch");
  }
  // After Clear draft, Name takes focus once the dialog has handed focus back (Start over itself has left the page).
  useEffect(() => {
    if (resetOpen || !clearedRef.current) return;
    clearedRef.current = false;
    const toName = () => nameRef.current?.focus({ preventScroll: true });
    let timer = 0;
    const onFocus = () => { done(); timer = window.setTimeout(toName, 0); };
    function done() { document.removeEventListener("focusin", onFocus); window.clearTimeout(timer); }
    document.addEventListener("focusin", onFocus);
    timer = window.setTimeout(() => { done(); toName(); }, 600);
    return done;
  }, [resetOpen]);

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

  /** Only a press of the primary gets here (Enter in a field is caught above). */
  function submit(e: FormEvent) {
    e.preventDefault();
    if (pairPending) {
      focusFirstProblem();
      return;
    }
    if (live) {
      if (!ready && !liveLocked && !recoveryOnly) { setShowErrors(true); focusFirstProblem(); return; }
      liveRef.current?.submit();
      return;
    }
    // Signed out: a missing name or ticker is pointed at first; then the Enter dialog names the launch and finishes
    // it (P1-11). Without art yet, that means pointing at the art field, the one thing left to do.
    if (!me && (!nameOk || !tickerOk)) { setShowErrors(true); focusFirstProblem(); return; }
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

  // The live preview's data: the stage on tablet and desktop, the compact row on phones.
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

  // Recovery-only mainnet mode: the fields wait for a saved launch to fill them, and stay locked once it does.
  const locked = live && (liveLocked || recoveryOnly);
  const buyOff = locked || buyBlocked;
  const quickAmounts = quickBuyAmounts(quoteKey, live ? undefined : maxDev);

  // The draft the mainnet panel prepares, kept as one object while its fields hold still (the panel's effects
  // read it), and a string of those fields for change checks.
  const liveDraft = useMemo(
    () => ready && preparedArt && liveDev !== null ? { name: name.trim(), symbol: ticker, description: lore.trim(), website: website.trim(), xUrl: xUrl.trim(), cardTemplate: designKey, quoteAssetKey: quoteKey, quoteMint: quoteAsset.mint, initialBuyQuoteBaseUnits: liveDev, artwork: preparedArt } : null,
    [ready, preparedArt, liveDev, name, ticker, lore, website, xUrl, designKey, quoteKey, quoteAsset.mint],
  );
  const draftKey = [name.trim(), ticker, lore.trim(), website.trim(), xUrl.trim(), designKey, quoteKey, liveDev ?? "", preparedArt?.size ?? 0].join("|");
  const liveBuyText = live && liveDev && liveDev !== "0" ? `${devBuy.trim()} ${quoteAsset.symbol}` : null;
  useEffect(() => { if (!live) setLivePrimary(null); }, [live]);

  // ------------------------------------------------ the header's one line
  const draftLine = dirty && !locked && !recoveryOnly;
  const context = recoveryOnly ? MAINNET_RECOVERY : draftLine ? (
    <span className="cdx-launch-draft">
      <span>Draft saved in this browser</span>
      <span aria-hidden> · </span>
      <button type="button" className="mdx-link mdx-hit" aria-haspopup="dialog" onClick={() => setResetOpen(true)}>Start over</button>
    </span>
  ) : CONTEXT;

  // ------------------------------------------------ the ticket's pieces
  const required = [
    { label: "Name", ok: nameOk },
    { label: "Ticker", ok: tickerOk },
    { label: "Artwork", ok: hasArt },
  ];
  const stillNeeded = required.filter((r) => !r.ok).map((r) => r.label.toLowerCase());
  const readyList = (
    <div className="cdx-launch-ready">
      <ul aria-label="Required to launch">
        {required.map((r) => (
          <li key={r.label} data-state={r.ok ? "done" : showErrors ? "missing" : "todo"}>
            <span className="cdx-launch-ready__mark" aria-hidden>
              {r.ok ? <Icon name="check" size={12} strokeWidth={2} /> : showErrors ? <Icon name="warning" size={12} /> : null}
            </span>
            {r.label}
            <span className="sr-only">{r.ok ? ", added" : ", still needed"}</span>
          </li>
        ))}
      </ul>
      <p role="status" className="cdx-launch-ready__status">{showErrors && stillNeeded.length ? `Still needed: ${stillNeeded.join(", ")}.` : ""}</p>
    </div>
  );
  const demoPending = pending === "launch";
  // ≤380px the visible words shorten to "Create demo coin"; the name stays whole (it contains the visible words).
  const demoLabel = !me ? "Try the demo to launch" : uploading ? "Uploading art…" : (
    <><span className="cdx-launch-go__long">Create demo coin and card</span><span className="cdx-launch-go__short" aria-hidden>Create demo coin</span></>
  );
  const demoButton = (inBar: boolean) => (
    <Button
      type="submit"
      form={inBar ? formId : undefined}
      size="lg"
      block={!inBar}
      data-launch-primary=""
      aria-label={me && !uploading && !demoPending ? "Create demo coin and card" : undefined}
      pending={demoPending}
      pendingLabel="Creating your coin…"
      disabled={pairPending || (!!me && uploading)}
      onBlocked={pairPending ? focusFirstProblem : undefined}
      feedback={feedback("launch")}
      successLabel="Created"
    >
      {demoLabel}
    </Button>
  );
  const totalValue = (
    <>
      <span className="num">{sol(nativeCost, 3)}</span> <span className="mdx-unit">test SOL</span>
      {quoteKey !== "sol" && devQuote?.ok ? <span className="cdx-launch-cost__plus"> + <span className="num">{formatQuoteAmount(devQuote.solIn, quoteKey)}</span> test {quoteAsset.symbol}</span> : null}
    </>
  );
  const demoTicket = (
    <section className="cdx-launch-demo" aria-labelledby={`${viewId}-cost`}>
      <div className="cdx-launch-ticket__head">
        <h2 id={`${viewId}-cost`} className="cdx-launch-section">Cost</h2>
        <SimTag />
      </div>
      <dl className="cdx-launch-cost">
        <div><dt>Launch cost</dt><dd><span className="num">{sol(LAUNCH_FEE, 3)}</span> <span className="mdx-unit">test SOL</span></dd></div>
        <div><dt>Initial buy</dt><dd>{devQuote?.ok ? <><span className="num">{quoteKey === "sol" ? sol(devQuote.solIn, 3) : formatQuoteAmount(devQuote.solIn, quoteKey)}</span> <span className="mdx-unit">test {quoteAsset.symbol}</span></> : "None"}</dd></div>
        <div data-total><dt>Total</dt><dd>{totalValue}</dd></div>
      </dl>
      <p className="cdx-launch-ticket__note">Launch a Card charges no platform fee. The launch cost stands in for the network fees and account rent a mainnet launch pays. {liveOpen ? "" : "Mainnet launches are not open yet. "}This demo uses test SOL{quoteKey === "sol" ? "" : ` and test ${quoteAsset.symbol}`}: no real coin or card is created.</p>
      {readyList}
      {/* What stops the launch, said beside the button: the balance check, a pending pair change, the server's reason. */}
      {balanceError ? <PagedMessage text={balanceError} alert /> : null}
      {pairPending ? <p className="cdx-pair-notice" role="status">Confirm or cancel the pair change under Pair before creating this demo coin.</p> : null}
      {launchError ? <PagedMessage text={launchError} alert /> : null}
      <div className="cdx-launch-go">{demoButton(false)}</div>
      <p className="cdx-launch-rules">By creating this coin you agree to the <TextLink to="/legal" hash="terms">content rules</TextLink>.</p>
    </section>
  );
  const liveBarButton = livePrimary ? (
    livePrimary.kind === "startAnother"
      ? <Button variant="outline" size="lg" data-launch-primary="" onClick={() => liveRef.current?.startAnother()}>{livePrimary.label}</Button>
      : <Button type="submit" form={formId} size="lg" data-launch-primary="" pending={livePrimary.pending} pendingLabel={livePrimary.pendingLabel} disabled={livePrimary.disabled} onBlocked={livePrimary.blockedByPair ? focusFirstProblem : undefined}>{livePrimary.label}</Button>
  ) : <Button size="lg" disabled>Loading…</Button>;

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

      <form id={formId} onSubmit={submit} onKeyDown={onFormKeyDown} noValidate aria-label="New coin" className="cdx-launch-grid">
        {/* Phones and landscape phones: the live card as one row (tap: 3D); tablets and desktop show the stage. */}
        <LaunchCardRow card={previewCard} />

        {/* ------------------------------------------------ the fields: required first, then everything optional */}
        <div className="cdx-launch-fields mdx-plinth">
          {recoveryOnly && !liveLocked ? <p className="cdx-launch-fields__note">These fields fill in from your saved launch.</p> : null}
          <div className="cdx-launch-required">
            <Field label="Name" htmlFor="name" error={nameMsg} help={<span className="sr-only">2 to 24 characters.</span>} right={<span className="num" aria-hidden>{name.length}/24</span>} className="cdx-launch-f cdx-launch-f--name">
              <Input
                disabled={locked}
                ref={nameRef}
                id="name"
                value={name}
                maxLength={24}
                required
                aria-required="true"
                enterKeyHint="next"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { setName(n => n.trim()); touch("name")(); }}
                placeholder="e.g. Glorb"
                autoComplete="off"
                aria-invalid={nameMsg ? true : undefined}
                aria-describedby="name-help"
              />
            </Field>
            <Field label="Ticker" htmlFor="ticker" error={tickerMsg ? `${tickerMsg}${tickerNote ? ` ${tickerNote}` : ""}` : null} help={<span aria-live="polite">{tickerNote || TICKER_HELP}</span>} className="cdx-launch-f cdx-launch-f--ticker">
              <Input
                disabled={locked}
                ref={tickerRef}
                id="ticker"
                prefix="$"
                value={ticker}
                required
                aria-required="true"
                enterKeyHint="next"
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
            <Field label="Artwork" htmlFor="art" error={artMsg} help={artGated && !preview ? ART_GATED : undefined} className="cdx-launch-f cdx-launch-f--art">
              <button
                ref={artRef}
                disabled={locked}
                id="art"
                type="button"
                data-over={dragging ? "true" : undefined}
                data-filled={preview ? "true" : undefined}
                aria-label={preview ? "Artwork. Choose another image to replace it" : "Artwork. Drop an image or choose one to upload"}
                aria-describedby={artMsg || (artGated && !preview) ? "art-spec art-help" : "art-spec"}
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
                  <span>{preview ? "Drop or choose another image" : "Drop an image or choose one"}</span>
                </span>
              </button>
              <p id="art-spec" className="cdx-launch-art__spec">
                <span>PNG, JPG, WEBP or GIF up to 12 MB. Square works best.</span>
                {preview && !locked && !uploading ? <button type="button" className="mdx-link mdx-hit cdx-launch-art__remove" aria-label="Remove artwork" onClick={removeArt}>Remove</button> : null}
              </p>
              <input disabled={locked} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            </Field>
          </div>

          <fieldset className="cdx-launch-more">
            <legend className="cdx-launch-more__legend">Optional</legend>
            <div className="cdx-launch-more__grid">
              <div className="cdx-launch-f cdx-launch-f--design">
                <CardDesignPicker variant="inline" seedReady={draftReady} value={designKey} onChange={pick} onPairChange={changePair} quoteAssetKey={quoteKey} ticker={ticker} previewCard={previewCard} disabled={locked} />
              </div>

              <div className="cdx-launch-f cdx-launch-f--pair">
                <QuoteAssetPicker variant="inline" value={quoteKey} designKey={designKey} ticker={ticker || "YOUR COIN"} onChange={changePair} onPendingChange={setPairPending} confirmationRef={pairConfirmationRef} live={live} disabled={locked} balance={!live && me ? formatQuoteAmount(quoteBalance, quoteKey) : undefined} />
                {pairNotice && !pairPending ? <p className="cdx-pair-notice" role="status">{pairNotice}</p> : null}
              </div>

              <div className="cdx-launch-f cdx-launch-f--buy">
                <Field label="Initial buy" htmlFor="dev">
                  <Input
                    disabled={locked}
                    // A buy that cannot fit is read-only, not disabled, so a creator typing in it keeps their place.
                    readOnly={buyBlocked}
                    aria-disabled={buyBlocked || undefined}
                    ref={devRef}
                    id="dev"
                    numeric
                    suffix={quoteAsset.symbol}
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    value={devBuy}
                    onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    aria-invalid={devError ? true : undefined}
                    aria-describedby="dev-note"
                  />
                </Field>
                <div className="cdx-launch-quick" role="group" aria-label="Quick amounts">
                  <Button variant="chip" size="sm" aria-pressed={sameAmount(devBuy, "")} aria-label="No initial buy" disabled={buyOff} onClick={() => setDevBuy("")}>None</Button>
                  {quickAmounts.map((amount) => (
                    <Button key={amount} variant="chip" size="sm" className="num" aria-pressed={sameAmount(devBuy, amount)} aria-label={`${amount} ${quoteAsset.symbol}`} disabled={buyOff} onClick={() => setDevBuy(amount)}>{amount}</Button>
                  ))}
                </div>
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
                {/* Mainnet, with a buy: its slippage, under the buy so the quick amounts above never move. */}
                {liveBuyText ? (
                  <label className="cdx-live-slippage cdx-launch-slippage">
                    <span>Slippage</span>
                    <select className="mdx-select mdx-select--field" value={slippageBps} disabled={locked} onChange={(e) => setSlippageBps(Number(e.target.value))}>
                      <option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option>
                    </select>
                  </label>
                ) : null}
              </div>

              <Field label="Description" htmlFor="lore" className="cdx-launch-f cdx-launch-f--lore" right={<span className="num" aria-hidden>{lore.length}/280</span>} help={live ? "Permanent once your coin is created." : "Printed on your card."}>
                <textarea ref={loreRef} disabled={locked} id="lore" rows={3} maxLength={280} value={lore} onChange={e => setLore(e.target.value)} placeholder="e.g. The first frog to reach the moon." aria-describedby="lore-help" className="mdx-input cdx-launch-description" />
              </Field>

              <Field label="Website" htmlFor="website" error={websiteMsg} className="cdx-launch-f cdx-launch-f--website">
                <Input
                  disabled={locked}
                  ref={websiteRef}
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  onBlur={touch("website")}
                  placeholder="https://"
                  inputMode="url"
                  enterKeyHint="next"
                  autoComplete="url"
                  spellCheck={false}
                  aria-invalid={websiteMsg ? true : undefined}
                  aria-describedby={websiteMsg ? "website-help" : undefined}
                />
              </Field>
              <Field label="X link" htmlFor="x" error={xMsg} className="cdx-launch-f cdx-launch-f--x">
                <Input
                  disabled={locked}
                  ref={xRef}
                  id="x"
                  value={xUrl}
                  onChange={(e) => setXUrl(e.target.value)}
                  onBlur={touch("x")}
                  placeholder="https://x.com/yourcoin"
                  inputMode="url"
                  enterKeyHint="next"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={xMsg ? true : undefined}
                  aria-describedby={xMsg ? "x-help" : undefined}
                />
              </Field>
            </div>
          </fieldset>
        </div>

        {/* ------------------------------------------------ the card, then the ticket (two sticky columns from 1024px) */}
        <div className="cdx-launch-side">
          <section id={`${viewId}-card`} aria-label="Your card preview" className="cdx-create-preview">
            <LaunchCardPreview card={previewCard} />
            <p className="cdx-create-preview__note">Live preview. It changes as you edit.</p>
          </section>

          <aside className="cdx-launch-ticket" aria-label="Cost and launch" data-live={live || undefined}>
            <div className="cdx-launch-ticket__panel mdx-plinth">
              {live ? <Suspense fallback={<div className="mdx-skeleton cdx-launch-live-skeleton" aria-hidden />}><LiveLaunchPanel ref={liveRef} launchesOpen={liveOpen} notice={buyDropped ? BUY_DOES_NOT_FIT : null} card={previewCard} draft={liveDraft} draftKey={draftKey} initialBuy={liveBuyText} slippageBps={slippageBps} ready={readyList} pairPending={pairPending} onLockedChange={setLiveLocked} onIntentLoaded={restoreLiveIntent} onPrimary={setLivePrimary} onInvalid={() => { setShowErrors(true); focusFirstProblem(); }} /></Suspense> : demoTicket}
            </div>
          </aside>
        </div>
      </form>

      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title="Clear this draft?" tone="danger" cancelLabel="Keep editing" confirmLabel="Clear draft" onConfirm={startOver}>
        <p>Every field and the uploaded art are cleared. Your draft lives only in this browser, so this cannot be undone.</p>
      </ConfirmDialog>

      {/* Below 1024px the primary stays on screen above the tab bar; from 1024px it sits in the ticket. */}
      <ActionBar phoneOnly label="Launch" className={live ? "cdx-launch-bar cdx-launch-bar--live" : "cdx-launch-bar"}>
        {live ? liveBarButton : (
          <>
            <p className="cdx-launch-bar__total"><span>Total</span><span>{totalValue}</span></p>
            {demoButton(true)}
          </>
        )}
      </ActionBar>
    </PageFrame>
  );
}
