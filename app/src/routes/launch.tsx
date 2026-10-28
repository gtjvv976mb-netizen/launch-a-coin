import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type RefObject,
} from "react";

import { useAction } from "../components/mintdex/hooks";
import { type CardData } from "../components/mintdex/MintCard";
import { useMe, useRequireMe } from "../components/mintdex/session";
import {
  Button,
  Field,
  Input,
  PageFrame,
  PageHeader,
  TextLink,
  useToast,
} from "../components/mintdex/ui";
import { launch } from "../lib/mintdex/api";
import { LAUNCH_FEE, TICKER_RE } from "../lib/mintdex/constants";
import { WORDS } from "../lib/mintdex/copy";
import { quoteBuy } from "../lib/mintdex/curve";
import { sol, tokens } from "../lib/mintdex/format";
import { pageHead, sentences } from "../lib/mintdex/seo";
import { z } from "zod";
import { LaunchCardPreview } from "../components/carddex/live/LaunchCardPreview";
import { CardDesignPicker } from "../components/carddex/CardDesignPicker";
import { DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../lib/carddex/designs";
import { allowedQuotesForDesign, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, isPairAssetKey, type PairAssetKey } from "../lib/carddex/pairs";
import { formatQuoteAmount, initialQuoteReserves, maxInitialBuyQuoteAtoms, parseQuoteAmount, quoteMetrics } from "../lib/carddex/quote-simulation";
import { QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";
import { LiveLaunchPanel, type LiveLaunchHandle } from "../components/carddex/live/LiveLaunchPanel";
import { liveReadinessQuery, useLiveLaunchOpen } from "../components/carddex/live/readiness";
import { parseLiveAmount } from "../components/carddex/live/amounts";
import { PagedMessage } from "../components/carddex/live/PagedMessage";
import type { LiveLaunchIntent } from "../lib/carddex/live/types";
import "../carddex-live.css";
import { ViewTabs } from "../components/carddex/ViewTabs";
import "../carddex-launch.css";

export const Route = createFileRoute("/launch")({
  validateSearch: z.object({ design: z.string().optional().catch(undefined), quote: z.string().optional().catch(undefined), mode: z.enum(["live", "demo"]).optional().catch(undefined) }),
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
        "Try the full launch in test mode with test SOL",
      ),
    }),
  component: Launch,
});

// ---------------------------------------------------------------- copy

/** What really happens to the coin, per mode (P0-5): in test mode, a simulated curve. */
const CONTEXT = "A pump.fun coin and your one-of-one card.";
const ENTER_TO_UPLOAD = "Try the demo to upload card art and launch.";
/** Shown in place of the Mainnet switch while the owner keeps real launches off. */
const MAINNET_CLOSED = "Test mode · Real mainnet launches are not open yet.";
const TICKER_HELP = "2 to 8 letters or numbers (A to Z, 0 to 9).";

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
  const [mobileView, setMobileView] = useState<"card" | "details">("card");
  const viewId = useId();
  const steps = ["Coin", "Artwork", "Design", "Pair", "Story", "Links", "Initial buy", "Launch"];
  // A creator's permanent design choice is independent of the token's market data.
  const search = Route.useSearch();
  // Test mode is the default. Mainnet needs both an explicit choice and the owner's switch (CARDDEX_LIVE_LAUNCH_ENABLED).
  const liveOpen = useLiveLaunchOpen();
  const live = search.mode === "live" && liveOpen;
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
    setPairNotice(search.quote && !isPairAssetKey(search.quote) ? `That quote asset is unavailable. ${getPairAsset(nextQuote).symbol} is selected; review the quote before creating the coin.` : bound && requested && requested !== bound.key ? `${getCardDesign(nextDesign).name} is paired with ${bound.symbol}; the quote has been matched to this finish.` : "");
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
    if (!draftReady || (live && liveLocked)) return;
    writeDraft(dirty ? { name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, step, imageUrl: live ? null : imageUrl } : null);
  }, [draftReady, dirty, name, ticker, lore, website, xUrl, devBuy, designKey, quoteKey, step, imageUrl, live, liveLocked]);


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
        setMobileView("details");
        requestAnimationFrame(() => problem.current?.focus({ preventScroll: true }));
        return;
      }
    }
    setStep(target);
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

  function startOver() {
    writeDraft(null);
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setName(""); setTicker(""); setLore(""); setWebsite(""); setXUrl(""); setDevBuy("");
    setPreview(null); setImageUrl(null); setPreparedArt(null); setTickerNote("");
    setTouched({}); setChecked([]); setShowErrors(false); setStep(0); setMobileView("details");
    reset("launch");
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  }

  function focusFirstProblem() {
    setMobileView("details");
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
      if (!ready && !liveLocked) { setShowErrors(true); focusFirstProblem(); return; }
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

  return (
    <PageFrame className={`mdx-page cdx-launch cdx-launch--${mobileView}`}>
      <PageHeader title="Launch a coin" context={live ? CONTEXT : liveOpen ? "Demo only · no real coin or NFT." : MAINNET_CLOSED} wrapContext right={liveOpen ? (
        <nav className="cdx-launch-mode" aria-label="Launch environment">
          <Link to="/launch" search={{ design: designKey, quote: quoteKey, mode: "live" }} aria-label="Mainnet wallet launch" aria-current={live ? "page" : undefined}>Mainnet</Link>
          <Link to="/launch" search={{ design: designKey, quote: quoteKey, mode: "demo" }} aria-current={!live ? "page" : undefined}>Demo</Link>
        </nav>
      ) : undefined} />

      <ViewTabs className="cdx-launch-mobile-tabs" label="Create view" idBase={viewId} tabs={[{ id: "card", label: "Your card", selected: mobileView === "card", onSelect: () => setMobileView("card"), panel: `${viewId}-card` }, { id: "details", label: "Coin details", selected: mobileView === "details", onSelect: () => setMobileView("details"), panel: `${viewId}-details` }]} />
      <div className="cdx-create-layout">
        {/* ------------------------------------------------ the form (plinth) */}
        <form
          id={`${viewId}-details`}
          onSubmit={submit}
          noValidate
          aria-label="New coin"
          className="cdx-create-form mdx-plinth"
        >
          <div className="cdx-launch-step-head">
            <label htmlFor="launch-step">{step + 1} / {steps.length}</label>
            <select id="launch-step" aria-label="Launch step" value={step} onChange={e => goTo(Number(e.target.value))}>{steps.map((title, i) => <option key={title} value={i}>{title}</option>)}</select>
            {dirty && !(live && liveLocked) ? <button type="button" className="mdx-link cdx-launch-start-over" onClick={startOver}>Start over</button> : null}
            <p className="sr-only" aria-live="polite">{`Step ${step + 1} of ${steps.length}: ${steps[step]}`}</p>
          </div>
          <div className="cdx-launch-content">
          <div className="cdx-launch-fields" hidden={step === 7}>
          <div className="cdx-launch-identity" hidden={step !== 0}>
              <Field label="Name (required)" htmlFor="name" error={nameMsg} help="2 to 24 characters." className="min-w-0">
                <Input
                  disabled={live && liveLocked}
                  ref={nameRef}
                  id="name"
                  value={name}
                  maxLength={24}
                  required
                  aria-required="true"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => { setName(n => n.trim()); touch("name")(); }}
                  placeholder="Glorb"
                  autoComplete="off"
                  aria-invalid={nameMsg ? true : undefined}
                  aria-describedby="name-help"
                />
              </Field>
              <Field label="Ticker (required)" htmlFor="ticker" error={tickerMsg ? `${tickerMsg}${tickerNote ? ` ${tickerNote}` : ""}` : null} help={<span aria-live="polite">{tickerNote || TICKER_HELP}</span>} className="min-w-0">
                <Input
                  disabled={live && liveLocked}
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
                  placeholder="GLORB"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={tickerMsg ? true : undefined}
                  aria-describedby="ticker-help"
                />
              </Field>
          </div>

          <div className="cdx-launch-step" hidden={step !== 1}>
          <Field label="Card art (required)" htmlFor="art" error={artMsg} className="min-w-0">
            <button
              ref={artRef}
              disabled={live && liveLocked}
              id="art"
              type="button"
              data-over={dragging ? "true" : undefined}
              aria-label={preview ? "Card art. Click to replace the image" : "Card art. Drop an image or click to upload"}
              aria-describedby={artMsg ? "art-help" : undefined}
              aria-invalid={artMsg ? true : undefined}
              aria-busy={uploading || undefined}
              onClick={() => live || me ? fileRef.current?.click() : require(() => artRef.current?.focus(), ENTER_TO_UPLOAD, "Start the demo")}
              onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`mdx-drop cdx-launch-art ${artMsg ? "border-down" : ""}`}
            >
              {preview ? <img src={preview} alt="" draggable={false} className="cdx-launch-art__image" /> : <span className="cdx-launch-art__add" aria-hidden>+</span>}
              <span className="cdx-launch-art__copy"><strong>{uploading ? "Preparing artwork…" : preview ? "Replace artwork" : "Upload artwork"}</strong><span>Square image · drop or browse</span></span>
            </button>
            <input disabled={live && liveLocked} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          </Field>

          </div>
          <div className="cdx-launch-step" hidden={step !== 2}>
          <CardDesignPicker value={designKey} onChange={pick} quoteAssetKey={quoteKey} ticker={ticker} disabled={live && liveLocked} compact />
          <p className="cdx-launch-step-copy">One permanent finish. Every design uses the same card layout.</p>
          </div>
          <div className="cdx-launch-step" hidden={step !== 3}>
          <QuoteAssetPicker viewport value={quoteKey} designKey={designKey} ticker={ticker || "YOUR COIN"} onChange={changePair} onPendingChange={setPairPending} confirmationRef={pairConfirmationRef} live={live} disabled={live && liveLocked} balance={!live && me ? formatQuoteAmount(quoteBalance, quoteKey) : undefined} compact />
          {pairNotice && !pairPending ? <p className="cdx-pair-notice" role="status">{pairNotice}</p> : null}

          </div>
          <div className="cdx-launch-step" hidden={step !== 4}>
              <Field label="Description" htmlFor="lore" className="min-w-0" help={<span className="flex items-baseline justify-between gap-3"><span>{live ? "Permanent once issued." : "Printed on the card."}</span><span className="num flex-none">{lore.length}/280</span></span>}>
                <textarea disabled={live && liveLocked} id="lore" maxLength={280} value={lore} onChange={e => setLore(e.target.value)} placeholder="Tell your card’s story." aria-describedby="lore-help" className="mdx-input cdx-launch-description" />
              </Field>
          </div>
          <div className="cdx-launch-step cdx-launch-links" hidden={step !== 5}>
              <Field label="Website" htmlFor="website" error={websiteMsg} className="min-w-0">
                <Input
                  disabled={live && liveLocked}
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
              <Field label="X link" htmlFor="x" error={xMsg} className="min-w-0">
                <Input
                  disabled={live && liveLocked}
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
            <div className="cdx-launch-initial cdx-launch-step" hidden={step !== 6}>
              <Field label="Initial buy (optional)" htmlFor="dev">
                <Input
                  disabled={live && liveLocked}
                  ref={devRef}
                  id="dev"
                  numeric
                  suffix={quoteAsset.symbol}
                  inputMode="decimal"
                  autoComplete="off"
                  value={devBuy}
                  onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0.0"
                  aria-invalid={devError ? true : undefined}
                  aria-describedby="dev-note"
                />
              </Field>
              {/* Only the estimate is announced as it changes (the total by the button is the other live line). */}
              <p id="dev-note" className="min-w-0 text-[13px] leading-[1.45] text-slate sm:pb-1">
                {devError ? (
                  <span role="alert" className="block text-down">
                    {devError}
                  </span>
                ) : !devQuote?.ok ? (
                  <span className="block">{live ? `Optional real ${quoteAsset.symbol} buy with coin creation. Exact amounts and slippage appear before wallet review.` : `Optional test-asset buy. Maximum ${formatQuoteAmount(maxDev, quoteKey)} ${quoteAsset.symbol}.`}</span>
                ) : null}
                <span aria-live="polite" className="block empty:hidden">
                  {devQuote?.ok && !devError ? (
                    <>
                      You get{" "}
                      <span className="text-ink">
                        <span className="num">{tokens(devQuote.tokensOut)}</span> {tickerText}
                      </span>{" "}
                      first.
                    </>
                  ) : null}
                </span>
              </p>
            </div>


          </div>
          <div className="cdx-launch-commit" hidden={step !== 7}>
            {/* The content rule (P1-28), right where people commit. */}
            <p className="cdx-launch-rules">
              <TextLink to="/legal" search={{ tab: "terms" }}>
                Content rules
              </TextLink>
            </p>
            {live ? <LiveLaunchPanel ref={liveRef} card={previewCard} draft={ready && preparedArt && liveDev !== null ? { name: name.trim(), symbol: ticker, description: lore.trim(), website: website.trim(), xUrl: xUrl.trim(), cardTemplate: designKey, quoteAssetKey: quoteKey, quoteMint: quoteAsset.mint, initialBuyQuoteBaseUnits: liveDev, artwork: preparedArt } : null} pairPending={pairPending} onLockedChange={setLiveLocked} onIntentLoaded={restoreLiveIntent} onInvalid={() => { setShowErrors(true); focusFirstProblem(); }} /> : <>
            <dl className="cdx-launch-cost" aria-label="Demo launch cost" aria-live="polite">
              <div><dt>Demo launch fee</dt><dd>{sol(LAUNCH_FEE, 3)} test SOL</dd></div>
              {devQuote?.ok ? <div><dt>Initial buy</dt><dd>{formatQuoteAmount(devQuote.solIn, quoteKey)} test {quoteAsset.symbol}</dd></div> : null}
              {quoteKey === "sol" && devQuote?.ok ? <div><dt>Total</dt><dd>{sol(nativeCost, 3)} test SOL</dd></div> : null}
              <small>{liveOpen ? "" : "Real mainnet launches are not open yet. "}{quoteKey === "sol" ? "Demo amounts only; no real coin or NFT is minted." : `The native SOL fee and ${quoteAsset.symbol} initial buy are separate test assets. No real coin or NFT is minted.`}</small>
            </dl>
            {balanceError ? (
              <PagedMessage text={balanceError} alert />
            ) : null}
            {pairPending ? <p className="cdx-pair-notice mb-2" role="status">Confirm or cancel the quote change before creating this demo coin.</p> : null}
            <Button
              type="submit"
              size="lg"
              block
              pending={pending === "launch"}
              pendingLabel="Minting your card..."
              disabled={pairPending || (!!me && uploading)}
              onBlocked={pairPending ? focusFirstProblem : undefined}
              feedback={feedback("launch")}
              successLabel="Minted"
            >
              {!me ? "Try the demo to launch" : uploading ? "Uploading art..." : "Create demo coin and card"}
            </Button>
            {/* The server's reason for a failed launch takes the launcher line's place (no new row, P1-8). */}
            {launchError ? (
              <PagedMessage text={launchError} alert />
            ) : (
              <p className="mt-2 text-[13px] leading-[1.45] text-slate">{WORDS.launcherLine}</p>
            )}
            </>}
          </div>
          </div>
          <nav className="cdx-launch-step-footer" aria-label="Launch steps">
            <button type="button" className="mdx-btn mdx-btn--outline" disabled={step === 0} onClick={() => goTo(Math.max(0, step - 1))}>Back</button>
            {step < 7 ? <button type="button" className="mdx-btn mdx-btn--primary" onClick={() => goTo(Math.min(7, step + 1))}>Next: {steps[step + 1]}</button> : <button type="button" className="mdx-btn mdx-btn--ghost cdx-launch-show-card" onClick={() => setMobileView("card")}>View card</button>}
          </nav>
        </form>

        <section id={`${viewId}-card`} aria-label="Your card preview" className="cdx-create-preview">
          <LaunchCardPreview card={previewCard} />
        </section>
      </div>
    </PageFrame>
  );
}
