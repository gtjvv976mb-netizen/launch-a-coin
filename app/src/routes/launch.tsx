import { createFileRoute } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { ConfirmDialog } from "../components/mintdex/confirm";
import { type CardData } from "../components/mintdex/MintCard";
import { Field, Icon, Input, TextLink, useToast } from "../components/mintdex/ui";
import { TICKER_RE } from "../lib/mintdex/constants";
import { pageHead, sentences } from "../lib/mintdex/seo";
import { key, oneOf, searchSchema, text } from "../lib/mintdex/search";
import { LaunchCardPreview } from "../components/carddex/live/LaunchCardPreview";
import { PairHud } from "../components/carddex/PairHud";
import { getCardDesign } from "../lib/carddex/designs";
import { designsForPair, getPairAsset, isPairAssetKey, type PairAssetKey } from "../lib/carddex/pairs";
import { CREATION_MCAP_LABEL } from "../lib/carddex/card-template";
import type { LiveLaunchHandle, LivePrimary } from "../components/carddex/live/LiveLaunchPanel";
import { draftDesign, draftPair, firstProblem, enterTarget, formDesign, pairFromSearch, pickDesign as nextDesign, pickPair as nextPick, type FormCheck } from "../components/carddex/launch-form";
import { DesignChooser } from "../components/carddex/DesignChooser";
import { liveReadinessQuery, useLiveLaunchOpen, useLiveReadiness, useLiveRecoveryOpen } from "../components/carddex/live/readiness";
import { decimalText, FeeSplitFields, firstFeeSplitField } from "../components/carddex/live/FeeSplitFields";
import { checkFeeSplit, EMPTY_FEE_SPLIT, formatShare, readFeeSplitDraft, type FeeSplitDraft } from "../components/carddex/live/fee-split";
import { XAnnounceField } from "../components/carddex/live/XAnnounceField";
import { formatLiveAmount, parseLiveAmount } from "../components/carddex/live/amounts";
import { BUY_FIT_AFTER_SIGN_IN, liveBuyOff, useLiveBuyFit, useLiveBuyRefusal } from "../components/carddex/live/buy-fit";
import { PagedMessage } from "../components/carddex/live/PagedMessage";
import type { LiveLaunchIntent } from "../lib/carddex/live/types";

// The mainnet launch panel (wallet signing, ed25519) loads on its own, after the form.
const LiveLaunchPanel = lazy(() => import("../components/carddex/live/LiveLaunchPanel").then((m) => ({ default: m.LiveLaunchPanel })));

export const Route = createFileRoute("/launch")({
  // ?mode= is accepted from older links and ignored: every launch is a mainnet launch.
  validateSearch: searchSchema({ design: text(), quote: key(), mode: oneOf(["live", "demo"]) }),
  // Readiness is read on the server, so the HTML is drawn in the state the page will keep (open, recovery only, or
  // paused) with no swap after hydration. It is shared with every readiness reader through the query cache.
  loaderDeps: () => ({}),
  staleTime: 30_000,
  loader: async ({ context }) => ({ readiness: await context.queryClient.ensureQueryData(liveReadinessQuery).catch(() => null) }),
  head: () =>
    pageHead({
      path: "/launch",
      title: "Launch a coin | Launch a Card",
      description: sentences(
        `Pick your coin's pair and its card design comes with it, or one of SOL's ${designsForPair("sol").length} designs. Add your coin details and preview its one-of-one card`,
        "Launch it on pump.fun from your Solana wallet",
      ),
    }),
  component: Launch,
});

// ---------------------------------------------------------------- copy

// The screen carries the fewest words that let someone act; every explanation lives at /how#launch (and its
// #fees, #pairs, #wallet and #recovery sections), one short link away.
/** While new launches are off: a creator can still finish a saved launch. */
const MAINNET_RECOVERY = "Finish a saved launch.";
/** While the owner has new launches and recovery both off. */
const LAUNCHES_PAUSED = "Launches are paused right now. Your draft stays in this browser.";
/** Screen-reader text only: the field's rule (the error repeats it when it fails). */
const TICKER_HELP = "2 to 8 letters or numbers (A to Z, 0 to 9).";

// ---------------------------------------------------------------- draft

/** The unfinished launch, kept in this browser so a refresh or a detour does not lose it. */
const DRAFT_KEY = "carddex.launch.draft.v1";
type LaunchDraft = {
  name: string; ticker: string; lore: string; website: string; xUrl: string; devBuy: string;
  designKey: string; quoteKey: string;
  /** True when the creator picked the design (SOL's chooser or a ?design= link). Drafts written before SOL had a
   * chooser always hold SOL's old card (one-piece) without this, so they reopen on SOL's main card instead. */
  designChosen?: boolean;
  /** "Share creator fees" as typed (on or off, and its rows); drafts written before it have none (off). */
  feeSplit?: FeeSplitDraft;
  /** "Announce my coin on @launchacard", when ticked; drafts written before it have none (off). */
  announceOnX?: boolean;
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
type ProblemKey = "name" | "ticker" | "art" | "buy" | "website" | "x" | "fees" | "terms";

/**
 * Below 1024px (MintDex's lg; launch.css uses the same query): the live card sits in the form beside Name and
 * Ticker, with the pair HUD under them; from 1024px the card has the preview column. One turntable is mounted, in
 * whichever place shows. The server HTML draws both places (null here), so a phone paints its card before hydration
 * (it is the screen's LCP); the place that does not show drops out once the page has hydrated.
 */
const PHONE_CARD_MQ = "(max-width: 1023.98px)";
function subscribePhoneCard(cb: () => void) {
  const mq = window.matchMedia(PHONE_CARD_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function usePhoneCard(): boolean | null {
  return useSyncExternalStore(subscribePhoneCard, () => window.matchMedia(PHONE_CARD_MQ).matches, () => null);
}

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
 * mintdex.fun's one-page Launch: the form panel (Name | Ticker, the pair HUD, SOL's design chooser, Card art |
 * Description, More options, then the ticket with the one primary at its foot) beside the live card. The pair picks
 * the card: choosing a pair shows its design on the live card. SOL alone offers a choice (its own card first, the
 * main one), in the chooser right under the pair HUD. No steps and no separate review; Enter
 * never submits (it moves on to the next field that needs something, or to the primary).
 */
function Launch() {
  const toast = useToast();

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [lore, setLore] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  // The prepared art lives in memory until the panel uploads it with the launch.
  const [preparedArt, setPreparedArt] = useState<Blob | null>(null);
  const [liveLocked, setLiveLocked] = useState(false);
  // A mainnet step is running (sign-in, the artwork upload, preparing): the press already captured the fields.
  const [liveBusy, setLiveBusy] = useState(false);
  // The mainnet terms checkbox shows unchecked: Enter stops on it before the primary.
  const [termsNeeded, setTermsNeeded] = useState(false);
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
  // "More options" (Website, X link, the initial buy): MintDex's disclosure. It opens itself when a field inside it
  // holds something (a restored draft or saved launch) or is where focus has to go.
  const [moreOpen, setMoreOpen] = useState(false);
  // The live ticket's primary as LiveLaunchPanel reports it (kept for a future mirror; MintDex has no action bar).
  const [livePrimary, setLivePrimary] = useState<LivePrimary | null>(null);
  // "Share creator fees" (More options), and the connected wallet the panel reports for its first row.
  const [feeSplit, setFeeSplit] = useState<FeeSplitDraft>(EMPTY_FEE_SPLIT);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  // "Announce my coin on @launchacard" (More options): off by default.
  const [announce, setAnnounce] = useState(false);
  const viewId = useId();
  const formId = `${viewId}-form`;
  const phoneCard = usePhoneCard();
  // A creator's permanent design choice is independent of the token's market data.
  const search = Route.useSearch();
  // Every launch is a mainnet launch, open while the owner's switch is on (CARDDEX_LIVE_LAUNCH_ENABLED). With new
  // launches off, saved-launch recovery (CARDDEX_LIVE_RECOVERY_ENABLED) still lets a creator finish one; with both
  // off the form stays (its draft is kept) and the ticket says launches are paused.
  const liveOpen = useLiveLaunchOpen();
  const recoveryOpen = useLiveRecoveryOpen();
  const live = liveOpen || recoveryOpen;
  const recoveryOnly = live && !liveOpen;
  // The creator fee split is offered only while its own switch is on (CARDDEX_LIVE_FEE_SHARING); off, the group is hidden
  // and a launch keeps pump.fun's default.
  const feesOpen = useLiveReadiness(live).data?.feeSharing === true && liveOpen;
  // The @launchacard announcement is offered only while its own switch is on (CARDDEX_X_AUTOPOST, with its secrets).
  const xOpen = useLiveReadiness(live).data?.xAnnounce === true && liveOpen;
  const liveRef = useRef<LiveLaunchHandle>(null);
  // The pair picks the card (launch-form.ts): ?quote= opens on that pair, an older ?design= link on that design's pair,
  // anything else on SOL. The card's design follows the pair: its main design, or for SOL the design picked in the
  // chooser under the pair HUD (?quote=sol&design= opens on one). A saved launch keeps the design it was saved with
  // (one prepared before this rule may carry another); any pair or design tap ends that, the checked pair's included.
  const [quoteKey, setQuoteKey] = useState<PairAssetKey>(() => pairFromSearch(search).pair);
  const [chosenDesign, setChosenDesign] = useState<string | null>(() => pairFromSearch(search).design);
  const [savedDesign, setSavedDesign] = useState<string | null>(null);
  // The pinned art version the saved launch recorded, when a redesign has since replaced it (design-versions.ts).
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const designKey = formDesign(quoteKey, savedDesign, live, chosenDesign);
  const [pairNotice, setPairNotice] = useState("");
  const design = getCardDesign(designKey);
  const quoteAsset = getPairAsset(quoteKey);
  const restoreLiveIntent = useCallback((intent: LiveLaunchIntent | null) => {
    setLiveMint(intent?.tokenMint ?? null); setLiveCreator(intent?.creatorWallet ?? null);
    setSavedDesign(intent ? getCardDesign(intent.cardTemplate).key : null);
    setSavedVersion(intent?.designVersion ?? null);
    if (!intent) return;
    // A finished launch leaves no draft behind: the next visit starts empty, not with this coin's name and ticker.
    if (intent.status === "complete") writeDraft(null);
    setName(intent.name); setTicker(intent.symbol); setLore(intent.description);
    setWebsite(intent.website ?? ""); setXUrl(intent.xUrl ?? "");
    if (isPairAssetKey(intent.quoteAssetKey)) setQuoteKey(intent.quoteAssetKey);
    // The saved launch's own initial buy, as a plain decimal in its quote ("" for none).
    const buy = intent.initialBuyQuoteBaseUnits;
    setDevBuy(buy === "0" ? "" : formatLiveAmount(buy, getPairAsset(intent.quoteAssetKey).decimals).replace(/,/g, ""));
    // The saved launch's own split (locked with it), or none.
    setFeeSplit(intent.feeShare ? { on: true, rows: intent.feeShare.recipients.map(entry => ({ wallet: entry.address, percent: formatShare(entry.bps).replace("%", "") })) } : EMPTY_FEE_SPLIT);
    setAnnounce(!!intent.xAnnounce);
    setPreview(intent.assets.artwork.url);
  }, []);
  useEffect(() => {
    const next = pairFromSearch(search);
    setQuoteKey(next.pair);
    setChosenDesign(next.design);
    setSavedDesign(null);
    setDevBuy("");
    setPairNotice(next.notice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.design, search.quote]);

  // Restore the saved draft once, after the URL's pair is applied. A pair (or design) in the URL wins.
  // Readiness is known from the first render (the loader read it on the server). A step saved by the old
  // step-by-step form is ignored. Recovery only waits: its locked fields fill from a saved launch, and a draft there
  // would read as one. Art never comes back: prepared art lives in memory.
  const draftRestored = useRef(false);
  // The save below skips the commit that restores (it would see the fields before the restore lands).
  const justRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current) return;
    if (recoveryOnly) { setDraftReady(true); return; }
    draftRestored.current = true;
    justRestored.current = true;
    const d = readDraft();
    if (d) {
      setName(str(d.name).slice(0, 24)); setTicker(str(d.ticker).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      setLore(str(d.lore).slice(0, 280)); setWebsite(str(d.website)); setXUrl(str(d.xUrl));
      // The draft's pair comes back (its card follows), and for SOL the design picked in its chooser.
      const savedPair = draftPair(d);
      if (!search.design && !search.quote && savedPair) { setQuoteKey(savedPair); setChosenDesign(draftDesign(d)); setDevBuy(str(d.devBuy)); }
      setFeeSplit(readFeeSplitDraft(d.feeSplit));
      setAnnounce(d.announceOnX === true);
    }
    setDraftReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryOnly]);

  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tickerRef = useRef<HTMLInputElement>(null);
  const artRef = useRef<HTMLButtonElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const xRef = useRef<HTMLInputElement>(null);
  const devRef = useRef<HTMLInputElement>(null);
  const loreRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () => () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // The initial buy, in the selected quote's atomic units (null: not a valid amount).
  const liveDev = parseLiveAmount(devBuy, quoteAsset.decimals);
  const devError = liveDev === null ? `Enter a valid ${quoteAsset.symbol} amount with up to ${quoteAsset.decimals} decimals.` : null;

  // Field checks (the server repeats every one of them).
  const nameOk = name.trim().length >= 2;
  const tickerOk = TICKER_RE.test(ticker);
  // Checked as soon as the name and ticker settle (exact bytes, server side): a buy that cannot fit one transaction
  // for this pair and name is turned off here, and the panel checks again before any artwork is uploaded.
  const fitName = useSettledValue(name.trim(), 500);
  const fitTicker = useSettledValue(ticker, 500);
  const fitActive = live && liveOpen && !liveLocked && fitName.length >= 2 && TICKER_RE.test(fitTicker);
  const buyFits = useLiveBuyFit(fitActive, fitName, fitTicker, quoteKey);
  // Why the buy is off, in the server's words (one shared query), and off from the start for a tokenized-stock quote.
  const buyRefusal = useLiveBuyRefusal(fitActive, fitName, fitTicker, quoteKey);
  const buyOffText = live && liveOpen && !liveLocked ? liveBuyOff(quoteAsset.kind, buyRefusal) : null;
  const buyBlocked = !!buyOffText;
  // A buy cleared here is also named beside the Launch button: the answer can arrive after the creator has moved on.
  const [buyDropped, setBuyDropped] = useState(false);
  useEffect(() => {
    if (!buyBlocked) setBuyDropped(false);
    else if (devBuy) { if (/[1-9]/.test(devBuy)) setBuyDropped(true); setDevBuy(""); }
  }, [buyBlocked, devBuy]);
  useEffect(() => {
    if (devBuy || website || xUrl || feeSplit.on && feesOpen || announce && xOpen) setMoreOpen(true);
  }, [devBuy, website, xUrl, feeSplit.on, feesOpen, announce, xOpen]);
  // The split counts only while it is offered and switched on; then it must pass every check the form can make.
  const feeCheck = checkFeeSplit(feeSplit.rows);
  const feesActive = feesOpen && feeSplit.on;
  const feesOk = !feesActive || !!feeCheck.shares;
  const websiteError = linkError(website, "web");
  const xError = linkError(xUrl, "x");
  const hasArt = !!preparedArt;
  const ready =
    nameOk &&
    tickerOk &&
    hasArt &&
    !websiteError &&
    !xError &&
    !devError &&
    feesOk &&
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

  const dirty = !!(name || ticker || lore || website || xUrl || devBuy || preparedArt || feeSplit.on);
  useEffect(() => {
    if (justRestored.current) { justRestored.current = false; return; }
    if (!draftReady || liveLocked || recoveryOnly) return;
    writeDraft(dirty ? { name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, designChosen: chosenDesign !== null, ...(feeSplit.on || feeSplit.rows.length ? { feeSplit } : {}), ...(announce ? { announceOnX: true } : {}) } : null);
  }, [draftReady, dirty, name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, chosenDesign, feeSplit, announce, liveLocked, recoveryOnly]);

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
    if (liveLocked) return;
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
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setPreparedArt(blob);
    } catch (e) {
      // Nothing half-prepared stays on screen: the dropzone comes back with the reason in a toast.
      setPreview(null);
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
    setPreview(null); setPreparedArt(null);
    requestAnimationFrame(() => artRef.current?.focus({ preventScroll: true }));
  }

  // ------------------------------------------------ where focus goes when something is missing
  const checks = (): FormCheck<ProblemKey>[] => [
    { key: "name", ok: nameOk },
    { key: "ticker", ok: tickerOk },
    { key: "art", ok: hasArt && !uploading },
    { key: "buy", ok: !devError },
    { key: "website", ok: !websiteError },
    { key: "x", ok: !xError },
    { key: "fees", ok: feesOk },
    // The terms checkbox sits in the ticket, after every field and before the primary.
    { key: "terms", ok: !(live && termsNeeded) },
  ];
  const problemRefs: Record<Exclude<ProblemKey, "terms" | "fees">, RefObject<HTMLElement | null>> = {
    name: nameRef, ticker: tickerRef, art: artRef, buy: devRef, website: websiteRef, x: xRef,
  };
  const problemEl = (key: ProblemKey) => key === "terms" ? liveRef.current?.terms() : key === "fees" ? document.getElementById(firstFeeSplitField(feeCheck) ?? "fee-split-on") : problemRefs[key].current;
  /** A problem inside More options opens it first (a closed disclosure's fields cannot take focus). */
  const inMore = (key: ProblemKey) => key === "buy" || key === "website" || key === "x" || key === "fees";
  /** Focus, then bring it into view at once (no smooth scroll); scroll-margin keeps it clear of the screen edges. */
  const land = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };
  /** The primary on screen: the ticket's button (or the live panel's). */
  const visiblePrimary = () =>
    [...(document.querySelectorAll<HTMLElement>("[data-launch-primary]"))].find((el) => el.getClientRects().length > 0);
  function focusFirstProblem() {
    const key = firstProblem(checks());
    if (!key) return;
    if (inMore(key)) setMoreOpen(true);
    requestAnimationFrame(() => land(problemEl(key)));
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
      if (target !== "terms" && target !== "fees") setTouched((t) => ({ ...t, [target]: true }));
      if (inMore(target) && !moreOpen) {
        setMoreOpen(true);
        requestAnimationFrame(() => land(problemEl(target)));
      } else land(problemEl(target));
    }
  }

  // ------------------------------------------------ Start over (a confirm dialog; the safe answer has focus)
  const clearedRef = useRef(false);
  function clearFields() {
    writeDraft(null);
    setName(""); setTicker(""); setLore(""); setWebsite(""); setXUrl(""); setDevBuy(""); setFeeSplit(EMPTY_FEE_SPLIT); setAnnounce(false);
    setPreview(null); setPreparedArt(null); setTickerNote("");
    setTouched({}); setShowErrors(false);
  }
  function startOver() {
    clearedRef.current = true;
    setResetOpen(false);
    clearFields();
  }
  // "Start another launch" after a finished mainnet launch: the finished coin's fields go, so nothing invites a
  // second coin with the same name and ticker (no confirm: the finished launch is saved on chain).
  const startAnotherLive = useCallback(() => {
    clearFields();
    requestAnimationFrame(() => nameRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  /** Only a press of the primary gets here (Enter in a field is caught above). */
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!live) return;
    if (!ready && !liveLocked && !recoveryOnly) { setShowErrors(true); focusFirstProblem(); return; }
    liveRef.current?.submit();
  }

  // The live preview's data: the stage on tablet and desktop, beside Name and Ticker on phones.
  const previewCard: CardData = {
    name: name.trim() || "Your coin",
    ticker: ticker || "TICKER",
    image: preview ?? "",
    level: design.materialLevel,
    cardTemplate: designKey,
    // A saved launch shows the exact art it recorded, while its own design is the one shown.
    ...(savedVersion && savedDesign === designKey ? { designVersion: savedVersion } : {}),
    // The same live quote and identity fields occupy the same card slots in every finish.
    quoteAssetKey: quoteKey,
    quoteMint: quoteAsset.mint,
    mcapUsd: null,
    mcapLabel: CREATION_MCAP_LABEL,
    holders: 0,
    dexNo: 0,
    dexLabel: "New",
    ownerHandle: liveCreator ? `${liveCreator.slice(0, 4)}…${liveCreator.slice(-4)}` : "Creator",
    mintAddress: liveMint,
    lore: lore.trim() || undefined,
  };
  /** A pair pick is a card pick: the preview shows the pair's design at once. An initial buy is in the old pair's
   * unit, so it is cleared (and the line under the HUD says so). */
  const pickPair = (next: PairAssetKey) => {
    if (liveLocked) return;
    const pick = nextPick({ pair: quoteKey, savedDesign }, next);
    if (!pick) return;
    setSavedDesign(pick.savedDesign);
    setQuoteKey(pick.pair);
    if (pick.changed && devBuy) { setDevBuy(""); setPairNotice("Initial buy cleared."); }
    else setPairNotice("");
  };
  /** A design pick in SOL's chooser: the preview shows it at once. It ends a saved launch's own design, as a pair tap does. */
  const pickDesign = (next: string) => {
    if (liveLocked) return;
    const pick = nextDesign({ pair: quoteKey, chosen: chosenDesign, savedDesign }, next);
    if (!pick) return;
    setSavedDesign(pick.savedDesign);
    setChosenDesign(pick.chosen);
  };

  // Recovery only: the fields wait for a saved launch to fill them, and stay locked once it does. They also hold
  // still while a launch step runs, since the press already captured them.
  const locked = liveLocked || recoveryOnly || liveBusy;
  // Art lives in memory: with none prepared (a finished launch cleared, a saved one discarded), no old image stays in
  // the field or on the card while the field is open. A saved launch's own artwork (liveLocked) stays.
  useEffect(() => {
    if (!liveLocked && !preparedArt && preview) setPreview(null);
  }, [liveLocked, preparedArt, preview]);
  // The draft the mainnet panel prepares, kept as one object while its fields hold still (the panel's effects
  // read it), and a string of those fields for change checks.
  const liveDraft = useMemo(
    () => ready && preparedArt && liveDev !== null ? { name: name.trim(), symbol: ticker, description: lore.trim(), website: website.trim(), xUrl: xUrl.trim(), cardTemplate: designKey, quoteAssetKey: quoteKey, quoteMint: quoteAsset.mint, initialBuyQuoteBaseUnits: liveDev, artwork: preparedArt,
      feeShares: feesActive ? feeCheck.shares : null, announceOnX: xOpen && announce } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, preparedArt, liveDev, name, ticker, lore, website, xUrl, designKey, quoteKey, quoteAsset.mint, feesActive, JSON.stringify(feeCheck.shares), xOpen, announce],
  );
  const draftKey = [name.trim(), ticker, lore.trim(), website.trim(), xUrl.trim(), designKey, quoteKey, liveDev ?? "", preparedArt?.size ?? 0, feesActive ? JSON.stringify(feeCheck.shares) : "", xOpen && announce ? "x" : ""].join("|");
  const liveBuyText = live && liveDev && liveDev !== "0" ? `${devBuy.trim()} ${quoteAsset.symbol}` : null;

  // ------------------------------------------------ the header's one line: the draft, or a saved launch to finish
  const draftLine = dirty && !locked && !recoveryOnly;
  const context = (
    <>
      {recoveryOnly ? <>{MAINNET_RECOVERY} </> : !live ? <>{LAUNCHES_PAUSED.split(".")[0]}. </> : draftLine ? (
        <span className="cdx-launch-draft">
          <span>Draft saved</span>
          <span aria-hidden> · </span>
          <button type="button" className="mdx-link mdx-hit" aria-haspopup="dialog" onClick={() => setResetOpen(true)}>Start over</button>
          <span aria-hidden> · </span>
        </span>
      ) : null}
      <TextLink to="/how" hash={recoveryOnly ? "recovery" : "launch"}>How it works</TextLink>
    </>
  );

  // ------------------------------------------------ the ticket's pieces
  const required = [
    { label: "Name", ok: nameOk },
    { label: "Ticker", ok: tickerOk },
    { label: "Artwork", ok: hasArt },
  ];
  const stillNeeded = required.filter((r) => !r.ok).map((r) => r.label.toLowerCase());
  // The mainnet panel lists what is still needed beside its primary (its `ready` slot).
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
  // Both of the owner's switches off: no panel, the reason in the ticket's place (the draft is kept).
  const pausedTicket = (
    <section className="cdx-launch-ticket" aria-label="Launch">
      <p role="status" className="cdx-launch-fee-note">{LAUNCHES_PAUSED}</p>
    </section>
  );

  const spacer = <div aria-hidden className="cdx-launch-spacer" />;

  return (
    <div className="cdx-launch mdx-page flex min-h-0 flex-col gap-6 short:gap-4 lg:h-full">
      <header className="cdx-launch-head flex flex-none flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:h-14 lg:flex-nowrap">
        <div className="min-w-0">
          <h1 className="mdx-h1 -mb-1 pb-1 lg:truncate max-lg:[text-wrap:balance]">Launch a coin</h1>
          <p className="mt-1 text-[13px] leading-[1.45] text-slate lg:truncate">{context}</p>
        </div>
      </header>
      {/* Announced once, when the draft first starts saving (the visible words sit in the header line). */}
      <p className="sr-only" aria-live="polite">{draftLine ? "Draft saved in this browser." : ""}</p>

      <div className="cdx-launch-grid grid grid-cols-1 gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:grid-rows-[minmax(0,1fr)]">
        <form id={formId} onSubmit={submit} onKeyDown={onFormKeyDown} noValidate aria-label="New coin" className="cdx-launch-form mdx-plinth mdx-scroll flex min-w-0 flex-col gap-4 lg:min-h-0 lg:gap-0 lg:overflow-y-auto">
          {recoveryOnly && !liveLocked ? <p className="cdx-launch-fields__note">Fields fill from your saved launch.</p> : null}
          {/* Name and Ticker (one row from 1024px); below that, stacked beside the live card. */}
          <div className="cdx-launch-ident">
            <div className="cdx-launch-ident__fields">
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
                  placeholder="Glorb"
                  autoComplete="off"
                  aria-invalid={nameMsg ? true : undefined}
                  aria-describedby="name-help"
                />
              </Field>
              <Field label="Ticker" htmlFor="ticker" error={tickerMsg ? `${tickerMsg}${tickerNote ? ` ${tickerNote}` : ""}` : null} help={<><span aria-live="polite">{tickerNote}</span>{tickerNote ? null : <span className="sr-only">{TICKER_HELP}</span>}</>} className="cdx-launch-f cdx-launch-f--ticker">
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
                      ? "Only A to Z and 0 to 9."
                      : clean.length > 8 ? "Up to 8 characters." : "");
                  }}
                  onBlur={touch("ticker")}
                  placeholder="GLORB"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={tickerMsg ? true : undefined}
                  aria-describedby="ticker-help"
                />
              </Field>
            </div>
            {/* Below 1024px: the live card, turnable, beside Name and Ticker. The slot keeps its size when a client
                render has not placed the card yet. */}
            <div className="cdx-launch-phonecard lg:hidden">
              {phoneCard !== false ? <section aria-label="Your card preview" className="cdx-launch-stage cdx-launch-stage--phone"><LaunchCardPreview card={previewCard} /></section> : null}
            </div>
          </div>
          {spacer}

          {/* The pair HUD: picking a pair picks the card (the live card shows its design). Under Name and Ticker, so
              on phones it sits right under the card it changes. */}
          <div className="cdx-launch-f cdx-launch-f--pair">
            <PairHud value={quoteKey} onChange={pickPair} ticker={ticker} live disabled={locked} notice={pairNotice} />
          </div>
          {/* SOL alone offers more than one design: its chooser sits right under the pair HUD (DesignChooser). */}
          {designsForPair(quoteKey).length > 1 ? (
            <>
              {spacer}
              <div className="cdx-launch-f cdx-launch-f--design">
                <DesignChooser pair={quoteKey} value={designKey} onChange={pickDesign} disabled={locked} />
              </div>
            </>
          ) : null}
          {spacer}

          {/* Card art and Description side by side, as on MintDex. */}
          <div className="cdx-launch-artrow">
            <Field label="Card art" htmlFor="art" error={artMsg} className="cdx-launch-f cdx-launch-f--art">
              <button
                ref={artRef}
                disabled={locked}
                id="art"
                type="button"
                data-over={dragging ? "true" : undefined}
                data-filled={preview ? "true" : undefined}
                // The name is the visible words (WCAG 2.5.3), so "click Add image" works by voice.
                aria-labelledby="art-cta art-sub"
                // The error (Field's art-help) first, then the spec (A11Y-4).
                aria-describedby={artMsg ? "art-help art-spec" : "art-spec"}
                aria-invalid={artMsg ? true : undefined}
                aria-busy={uploading || undefined}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className="mdx-drop cdx-launch-art"
              >
                {preview && !uploading ? <img src={preview} alt="" draggable={false} className="cdx-launch-art__image" /> : null}
                <span className="cdx-launch-art__copy" data-over-image={preview && !uploading ? "" : undefined}>
                  <strong id="art-cta">{uploading ? "Preparing…" : preview ? "Replace image" : "Add image"}</strong>
                  {/* Part of the button's name only: the drop hint is on /how#launch. */}
                  <span id="art-sub" className="sr-only">{preview ? "or drop another" : "or drop it here"}</span>
                </span>
              </button>
              <p id="art-spec" className="sr-only">Required. PNG, JPG, WEBP or GIF up to 12 MB. Square works best.</p>
              {preview && !locked && !uploading ? <button type="button" className="mdx-link mdx-hit cdx-launch-art__remove" aria-label="Remove artwork" onClick={removeArt}>Remove</button> : null}
              <input disabled={locked} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            </Field>
            <Field label="Description" htmlFor="lore" className="cdx-launch-f cdx-launch-f--lore" right={<span className="num" aria-hidden>{lore.length}/280</span>} help="Permanent once your coin is created.">
              <textarea ref={loreRef} disabled={locked} id="lore" rows={3} maxLength={280} value={lore} onChange={e => setLore(e.target.value)} placeholder="King of the swamp. Jiggles under pressure, never breaks." aria-describedby="lore-help" className="mdx-input cdx-launch-description" />
            </Field>
          </div>
          {spacer}

          <details className="cdx-launch-more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
            <summary>
              <Icon name="chevron-right" size={16} className="cdx-launch-more__chev" />
              <span className="cdx-launch-more__title">More options</span>
              <span className="cdx-launch-more__sub">{["Links, initial buy", feesOpen ? "creator fees" : "", xOpen ? "announcement" : ""].filter(Boolean).join(", ")}</span>
            </summary>
            <div className="cdx-launch-more__body">
              <div className="cdx-launch-links">
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
              <div className="cdx-launch-buy">
                <Field label="Initial buy" htmlFor="dev" className="cdx-launch-f cdx-launch-f--buy">
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
                    onChange={(e) => setDevBuy(decimalText(e.target.value))}
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
                    <p role="status">{buyOffText}</p>
                  ) : (
                    <p>{`Paid in real ${quoteAsset.symbol} with your coin's creation.${buyFits === null ? ` ${BUY_FIT_AFTER_SIGN_IN}` : ""}`}</p>
                  )}
                </div>
              </div>
              {/* With a buy: its slippage. A saved launch keeps the slippage it was prepared with, which the
                  page does not hold: hidden there. */}
              {liveBuyText && !liveLocked ? (
                <label className="cdx-live-slippage cdx-launch-slippage">
                  <span>Slippage</span>
                  <select className="mdx-select mdx-select--field" value={slippageBps} disabled={locked} onChange={(e) => setSlippageBps(Number(e.target.value))}>
                    <option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option>
                  </select>
                </label>
              ) : null}
              {/* Share creator fees: off by default; set after the card by its own approval (CARDDEX_LIVE_FEE_SHARING). A
                  saved launch shows the split it was saved with, locked. */}
              {feesOpen || liveLocked && feeSplit.on ? <FeeSplitFields value={feeSplit} onChange={setFeeSplit} connected={connectedWallet} disabled={locked} showErrors={showErrors} /> : null}
              {/* Announce on @launchacard: off by default; one post after the card (CARDDEX_X_AUTOPOST). A saved launch
                  shows its choice, locked. */}
              {xOpen || liveLocked && announce ? <XAnnounceField checked={announce} onChange={setAnnounce} disabled={locked} /> : null}
            </div>
          </details>
          {spacer}

          {/* The ticket: the costs, the total and the one primary, at the panel's foot (MintDex). */}
          <div className="cdx-launch-foot" data-live={live || undefined}>
            {live ? <Suspense fallback={<div className="mdx-skeleton cdx-launch-live-skeleton" aria-hidden />}><LiveLaunchPanel ref={liveRef} launchesOpen={liveOpen} notice={buyDropped ? buyOffText : null} card={previewCard} draft={liveDraft} draftKey={draftKey} initialBuy={liveBuyText} slippageBps={slippageBps} ready={readyList} onLockedChange={setLiveLocked} onBusyChange={setLiveBusy} onTermsNeeded={setTermsNeeded} onIntentLoaded={restoreLiveIntent} onStartAnother={startAnotherLive} onPrimary={setLivePrimary} onWalletChange={setConnectedWallet} onInvalid={() => { setShowErrors(true); focusFirstProblem(); }} /></Suspense> : pausedTicket}
          </div>
        </form>

        {/* From 1024px: the live card on its ledge (MintDex's preview column). It is the pair's design. */}
        <section aria-label="Live preview" className="cdx-launch-preview flex min-w-0 flex-col max-lg:hidden">
          {phoneCard !== true ? (
            <div className="cdx-launch-stage cdx-launch-stage--column">
              <LaunchCardPreview card={previewCard} />
            </div>
          ) : null}
        </section>
      </div>

      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title="Clear this draft?" tone="danger" cancelLabel="Keep editing" confirmLabel="Clear draft" onConfirm={startOver}>
        <p>Every field and the art. This can't be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
