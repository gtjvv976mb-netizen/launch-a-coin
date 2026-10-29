/**
 * Launch on chain (refs/chain/m3-contract.md §2.2 Launch, §3.5; devnet and mainnet builds): the test-mode Launch
 * layout (the form on a plinth, the live preview card on the wall), with the chain rules: name up to 32 bytes, ticker
 * 2 to 10 capital letters or digits, description up to 400 characters, https links, a dev buy of 0 to 1 SOL (default 0).
 * "Mint and launch" runs the client's launch flow: sign in with the wallet, upload the art, prepare, check the
 * transaction before the wallet opens, sign, finalize, wait for the chain, then open the coin page with
 * ?minted=1 ("Your card is live"). Mainnet: the cost disclosure names the 0.02 SOL launch fee and Metaplex's measured
 * NFT fee (ApiConfig.launchCost), and the launch gate of launch-plan §1.6 shows above the button.
 *
 * UX pass 2026-10-11: a short guided form (the optional website, X link and dev buy sit in "More options"), one
 * "Total: up to" line by the button with every cost item one tap away ("What is included"), chips that show the
 * preview card in a rarer design, and on phones a small preview that opens in 3D (the Inspect stage).
 *
 * Owner: app:pages. The art stays in the browser until the flow uploads it; nothing is signed here.
 */
import { API_LIMITS } from "@mintdex/chain-sdk/api";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";

import { num, tierUsdOf, usdPerLamportOf, utf8Bytes } from "../../../lib/chain/adapt";
import { launchGateOf, launchNotice } from "../../../lib/chain/launch-caps";
import { useDisplayQuoteSource } from "../../../lib/chain/quote-data";
import { devBuyPlan, estimateLaunchPreview } from "../../../lib/chain/estimate";
import { getWallet, launchCoin, type TxStep } from "../../../lib/chain/client";
import { useChainConfig, useChainWallet } from "../../../lib/chain/data";
import { CHAIN_COPY, LAUNCH_COPY, MODE_COPY, SWITCH_COPY, WORDS, pct } from "../../../lib/mintdex/copy";
import { parseSol, sol, tokens, usdCompact } from "../../../lib/mintdex/format";
import { TIERS, levelOf } from "../../../lib/mintdex/tiers";
import { InspectDialog, prefetchInspect, type CardSide } from "../../mintdex/card3d";
import { MintCard, type CardData } from "../../mintdex/MintCard";
import { Button, CARD_ASPECT, Field, FrameMini, Input, Ledge, PageFrame, PageHeader, TextLink, useToast } from "../../mintdex/ui";
import { FaucetLinks, StepLine, openWallet, signBlocker, useSiteTransactionHold, useTx, useViewer, SITE_TRANSACTION_HOLD_NOTICE } from "./tx";
import { APP_CLUSTER, SOL_WORD } from "../../../lib/chain/env";

/** The launch flow's steps in order (lib/chain/client.ts TxStep), for "3 of 8" progress. */
const LAUNCH_STEPS: TxStep[] = ["signing-in", "uploading", "building", "verifying", "signing", "submitting", "confirming", "confirmed"];

const MAX_DEV_BUY = num(API_LIMITS.devBuyMaxLamports);
const SLIPPAGE_BPS = API_LIMITS.slippageDefaultBps;
/**
 * What a launch costs on top of the dev buy and Config.launch_fee, display only (m3-contract §3.5 step 13): the rents
 * of the accounts it creates (coin mint, curve and its token account, the Card, the card NFT mint and token account,
 * and since card-program-v2 §18.17 the card's Metaplex metadata and master edition), Metaplex's NFT creation fee (a
 * flat 0.01 SOL on both clusters, measured 2026-10-06, not refundable) and the network fee: about 0.0256 SOL on devnet,
 * about 0.0255 on mainnet (whose curves are smaller), plus the 0.02 SOL mainnet launch fee. A dev buy adds the coin
 * token account, pump's volume tracker and the creator vault. Since O5 the Worker serves the same estimate it checks
 * (`ApiConfig.launchCost`, per cluster, with the measured Metaplex fee); these constants are the fallback for an older
 * Worker that omits it.
 */
const LAUNCH_RENT = 25_600_000;
const DEV_BUY_RENT = 3_510_000;
const METAPLEX_FEE = 10_000_000;
const DEFAULT_MAINNET_LAUNCH_FEE = 20_000_000;

/** The root loader's `devnetSite`: the devnet test site's banner is on every page, so the form need not repeat it. */
const rootApi = getRouteApi("__root__");
function useDevnetBanner(): boolean {
  const data = rootApi.useLoaderData() as { devnetSite?: boolean } | undefined;
  return data?.devnetSite ?? false;
}

/** Under the ledge (desktop): 16 space, the design chips, the status line (may wrap once) and the USD note. */
const CAPTION_H = 128;
const LEDGE_H = 5;
const STAGE_VARS = {
  "--cap": `${CAPTION_H}px`,
  "--cw-lg": `min(calc(100cqw - 48px), calc((100cqh - ${CAPTION_H + LEDGE_H}px) * ${CARD_ASPECT.toFixed(6)}), 480px)`,
} as CSSProperties;

/** Center-crop to a square and re-encode at up to 900px, so every card window gets clean art and stays small. */
async function prepareArt(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(900, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.88));
  if (blob && blob.type === "image/webp") return blob;
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!png) throw new Error("encode failed");
  return png;
}

/** The link rules the chain API applies (https, at most 200 characters), as a message under the field. */
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
  if (t.length > API_LIMITS.linkMaxChars) return "That link is too long.";
  return null;
}

type FieldKey = "name" | "ticker" | "website" | "x";

function Gap() {
  return <div aria-hidden className="hidden flex-[1_1_0px] lg:block lg:max-h-14 lg:min-h-3 fit:min-h-3.5" />;
}

// ---------------------------------------------------------------- shared with the test-mode twin (routes/launch.tsx)

/** The designs the preview can wear: the one every card starts in and two rare ones from the top of the ladder. */
export const PREVIEW_LEVELS = [1, levelOf("frost"), levelOf("legend")];

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" className={`flex-none ${className}`}>
      <path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Add image" in the empty art box; "or drop it here" only where a mouse can drop a file. */
export function ArtPrompt() {
  return (
    <span className="pointer-events-none flex flex-col items-center gap-1 px-2">
      <span className="text-[13px] font-semibold leading-[1.3] text-ink">{LAUNCH_COPY.artAdd}</span>
      <span className="text-[12px] leading-[1.3] text-slate pointer-coarse:hidden">{LAUNCH_COPY.artDrop}</span>
    </span>
  );
}

/**
 * One row of design chips under the preview: Spark (every card starts there), Frost and Legend. Picking one dresses the
 * preview in that design at its unlock; the line under the chips says where it unlocks, then the USD note once.
 */
export function DesignPicker({
  level,
  usd,
  onPick,
  className = "",
}: {
  level: number;
  /** The unlock market cap of each design in USD (index level - 1). */
  usd: number[];
  onPick: (level: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div role="group" aria-label={LAUNCH_COPY.pickerLabel} className="flex flex-wrap gap-2">
        {PREVIEW_LEVELS.map((l) => {
          const t = TIERS[l - 1];
          const active = l === level;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              aria-label={`${t.name} design, ${l <= 1 ? "at launch" : `unlocks at ${usdCompact(usd[l - 1] ?? t.minUsd)}`}`}
              onClick={() => onPick(l)}
              className={`inline-flex h-9 items-center gap-2 rounded-pill pl-3 pr-3.5 text-[14px] text-ink transition-[background-color,box-shadow] duration-(--t-fast) ease-room pointer-coarse:h-11 ${
                active ? "font-semibold" : "font-medium shadow-ring hover:bg-tint"
              }`}
              style={active ? { background: t.tint, boxShadow: "0 0 0 1.5px var(--color-ink)" } : undefined}
            >
              <FrameMini level={l} />
              {t.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-pretty text-[13px] leading-[1.45] text-slate">
        {level <= 1 ? LAUNCH_COPY.startsAs(TIERS[0].name) : LAUNCH_COPY.unlocksAt(usdCompact(usd[level - 1] ?? TIERS[level - 1].minUsd))}{" "}
        <TextLink to="/levels">{LAUNCH_COPY.allDesigns(TIERS.length)}</TextLink>
      </p>
      {MODE_COPY.usdNote ? <p className="text-[13px] leading-[1.45] text-slate">{MODE_COPY.usdNote}.</p> : null}
    </div>
  );
}

/**
 * Phones: the small live preview is a button ("Preview in 3D") that opens the Inspect stage with the card as it is now
 * (drag, Turn over, Tilt to shine). Focus returns to the button when the stage closes.
 */
export function PhonePreview({ card, className = "" }: { card: CardData; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = btn.current;
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={prefetchInspect}
        onFocus={prefetchInspect}
        onTouchStart={prefetchInspect}
        className={`flex w-full flex-col items-center gap-1.5 rounded-[10px] ${className}`}
      >
        <span aria-hidden className="pointer-events-none block w-full">
          <MintCard card={card} compact depth="hand" idle="breathe" />
        </span>
        <span className="inline-flex h-6 items-center rounded-pill px-2.5 text-[12px] font-medium leading-4 text-ink shadow-ring">
          {LAUNCH_COPY.preview3d}
        </span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <InspectDialog card={card} open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * "More options": the optional fields in one native disclosure, closed until opened or until one of them has a value
 * or an error (the page opens it itself before focusing a field inside).
 */
export function MoreOptions({
  open,
  onOpenChange,
  ref,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ref?: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  return (
    <details ref={ref} open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)} className="group min-w-0">
      <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-1 [&::-webkit-details-marker]:hidden">
        <Chevron className="-rotate-90 text-slate transition-transform duration-(--t-fast) group-open:rotate-0" />
        <span className="flex-none text-[14px] font-medium text-ink">{LAUNCH_COPY.more}</span>
        <span className="min-w-0 truncate text-[13px] text-slate">{LAUNCH_COPY.moreHint}</span>
      </summary>
      <div className="flex flex-col gap-4 pb-1 pt-2">{children}</div>
    </details>
  );
}

/**
 * The cost by the button: "Total: up to 0.026 SOL" (live), with every item one tap away in "What is included". `note`
 * sits outside the disclosure, always visible (the real-money or no-value line where no banner says it).
 */
export function CostTotal({
  total,
  items,
  note,
  className = "",
}: {
  total: number;
  items: Array<{ label: string; lamports: number }>;
  note?: ReactNode;
  className?: string;
}) {
  // "Up to": rounded up to the shown precision, so the line never reads lower than the sum of its items.
  const shown = Math.ceil(total / 1_000_000) * 1_000_000;
  return (
    <div className={className}>
      <details className="group">
        <summary className="-mx-1 flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-[10px] px-1 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <span aria-live="polite" className="text-[15px] leading-[1.3] text-ink">
            {LAUNCH_COPY.total} <span className="num font-semibold">{sol(shown, 3)}</span> SOL
          </span>
          <span className="flex flex-none items-center gap-1 text-[13px] text-slate">
            {LAUNCH_COPY.included}
            <Chevron className="transition-transform duration-(--t-fast) group-open:rotate-180" />
          </span>
        </summary>
        <dl className="mb-2 mt-1 flex flex-col gap-1 text-[13px] leading-[1.45]">
          {items.map((it) => (
            <div key={it.label} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-slate">{it.label}</dt>
              <dd className="num flex-none text-ink">{sol(it.lamports, 4)} SOL</dd>
            </div>
          ))}
        </dl>
      </details>
      {note ? <p className="text-[13px] leading-[1.45] text-slate">{note}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the page

const TICKER_RE = new RegExp(API_LIMITS.symbolPattern);

export function ChainLaunch() {
  const viewer = useViewer();
  const { wallet } = useChainWallet(viewer.address);
  const cfg = useChainConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const tx = useTx();
  const banner = useDevnetBanner();
  const siteHold = useSiteTransactionHold();

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [lore, setLore] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [art, setArt] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // The design the preview wears (a chip) and the side it shows: any edit brings back Spark, face up.
  const [peek, setPeek] = useState(1);
  const [side, setSide] = useState<CardSide>("face");

  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tickerRef = useRef<HTMLInputElement>(null);
  const artRef = useRef<HTMLButtonElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const xRef = useRef<HTMLInputElement>(null);
  const devRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(() => {
    setPeek(1);
    setSide("face");
  }, [name, ticker, lore, art, devBuy]);

  // Dev buy estimate on a fresh curve of this cluster, and what the launch costs at most.
  const devLamports = devBuy ? parseSol(devBuy) : 0;
  const devNaN = !!devBuy && !Number.isFinite(devLamports);
  const devOver = Number.isFinite(devLamports) && devLamports > MAX_DEV_BUY;
  const devPlan = devBuyPlan(devLamports, MAX_DEV_BUY, SLIPPAGE_BPS);
  const hasDevBuy = devPlan.amountLamports > 0n;
  const quoteSource = useDisplayQuoteSource("launch");
  const previewQuote = estimateLaunchPreview(quoteSource?.venue === "launch" ? quoteSource : null, Number(devPlan.amountLamports));
  const devEst = previewQuote.devBuy;
  // Until GET /config answers: the mainnet default launch fee (0.02 SOL, user decision D5), so the estimate never starts low.
  const launchFee = cfg ? num(cfg.launchFee) : APP_CLUSTER === "mainnet" ? DEFAULT_MAINNET_LAUNCH_FEE : 0;
  const devMax = devPlan.maxSolLamports;
  const launchRent = cfg?.launchCost ? num(cfg.launchCost.baseLamports) : LAUNCH_RENT;
  const devBuyRent = cfg?.launchCost ? num(cfg.launchCost.devBuyExtraLamports) : DEV_BUY_RENT;
  const metaplexFee = cfg?.launchCost ? num(cfg.launchCost.metaplexFeeLamports) || METAPLEX_FEE : METAPLEX_FEE;
  const gate = launchGateOf(cfg);
  // Allowlist phase (launch-plan D1 to H): the Worker says per wallet whether it may launch (GET /wallets/:address
  // launchAllowed); read only then, so the normal page costs no extra request.
  const eligibility = useQuery({
    queryKey: ["launch-allowed", viewer.address ?? ""],
    queryFn: async () => {
      const r = (await getWallet(viewer.address!)) as { launchAllowed?: unknown };
      return typeof r.launchAllowed === "boolean" ? r.launchAllowed : null;
    },
    enabled: gate === "allowlist" && !!viewer.address,
    staleTime: 30_000,
    retry: 1,
  });
  const notice = launchNotice(gate, viewer.address ? (eligibility.data ?? null) : null);
  const total = launchFee + launchRent + (hasDevBuy ? devMax + devBuyRent : 0);
  // Every item of the total (launchRent already holds Metaplex's fee and the network fee).
  const costItems = [
    ...(hasDevBuy ? [{ label: LAUNCH_COPY.costDevBuy(pct(SLIPPAGE_BPS)), lamports: devMax }] : []),
    { label: LAUNCH_COPY.costRent, lamports: Math.max(0, launchRent - metaplexFee) + (hasDevBuy ? devBuyRent : 0) },
    { label: LAUNCH_COPY.costMetaplex, lamports: metaplexFee },
    ...(launchFee > 0 ? [{ label: LAUNCH_COPY.costLaunchFee, lamports: launchFee }] : []),
  ];
  const balance = wallet ? num(wallet.lamports) : viewer.balance;
  const devError = devNaN ? "Enter an amount like 0.1." : devOver ? `Dev buy is capped at ${sol(MAX_DEV_BUY, 0)} SOL${APP_CLUSTER === "mainnet" ? "" : " on devnet"}.` : null;
  const short = viewer.connected && balance != null && !devError && balance < total;

  // Field checks (the chain API repeats every one of them).
  const nameBytes = utf8Bytes(name.trim());
  const nameOk = nameBytes >= 1 && nameBytes <= API_LIMITS.nameMaxBytes;
  const tickerOk = TICKER_RE.test(ticker);
  const websiteError = linkError(website, "web");
  const xError = linkError(xUrl, "x");
  const network = signBlocker(viewer);
  const ready = nameOk && tickerOk && !!art && !websiteError && !xError && !devError && !short && !preparing && !network;

  const shown = (key: FieldKey, value: string) => showErrors || (!!touched[key] && value.trim() !== "");
  const nameMsg = !nameOk && (showErrors || (!!touched.name && name !== ""))
    ? nameBytes > API_LIMITS.nameMaxBytes
      ? "That name is too long. Keep it to 32 characters (emoji count as more)."
      : "Name your coin."
    : null;
  const tickerMsg = !tickerOk && shown("ticker", ticker) ? "Use 2 to 10 capital letters or digits." : null;
  const artMsg = showErrors && !art && !preparing ? "Add card art." : null;
  const websiteMsg = websiteError && shown("website", website) ? websiteError : null;
  const xMsg = xError && shown("x", xUrl) ? xError : null;
  const touch = (key: FieldKey) => () => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  // "More options" opens itself while one of its fields has a value or an error.
  const moreNeeded = !!(website || xUrl || devBuy || websiteMsg || xMsg || devError);
  useEffect(() => {
    if (moreNeeded) setMoreOpen(true);
  }, [moreNeeded]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      toast("err", "Use a PNG, JPG, WEBP or GIF image.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast("err", "That image is over 12 MB. Try a smaller one.");
      return;
    }
    setPreparing(true);
    try {
      const blob = await prepareArt(file);
      if (blob.size > API_LIMITS.imageMaxBytes) throw new Error("That image is still over 2 MB after resizing. Try a simpler one.");
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setArt(blob);
    } catch (e) {
      setPreview(null);
      setArt(null);
      toast("err", e instanceof Error && e.message !== "no canvas" && e.message !== "encode failed" ? e.message : "That image could not be read. Try another.");
    } finally {
      setPreparing(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  }

  function focusFirstProblem() {
    const first = !nameOk
      ? nameRef
      : !tickerOk
        ? tickerRef
        : !art
          ? artRef
          : websiteError
            ? websiteRef
            : xError
              ? xRef
              : devError || (short && hasDevBuy)
                ? devRef
                : null;
    // A field inside a closed "More options" cannot take focus: open it first (the DOM at once, the state follows).
    if ((first === websiteRef || first === xRef || first === devRef) && moreRef.current && !moreRef.current.open) {
      moreRef.current.open = true;
      setMoreOpen(true);
    }
    first?.current?.focus();
  }

  async function attempt() {
    if (siteHold || tx.busy || preparing) return;
    if (!ready || !art) {
      setShowErrors(true);
      focusFirstProblem();
      return;
    }
    const res = await tx.run(
      "launch",
      (onStep) =>
        launchCoin(
          {
            name: name.trim(),
            symbol: ticker,
            description: lore.trim(),
            image: art,
            website: website.trim() || undefined,
            twitter: xUrl.trim() || undefined,
            devBuyLamports: devPlan.amountLamports,
            slippageBps: SLIPPAGE_BPS,
          },
          onStep,
        ),
      { keys: [["home"], ["coins"], ["market"]] },
    );
    if (res) void navigate({ to: "/coin/$id", params: { id: res.mint }, search: { minted: 1 } });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (siteHold) return;
    if (!viewer.connected) {
      openWallet();
      return;
    }
    void attempt();
  }

  const tickerText = ticker ? `$${ticker}` : "coins";
  const launchError = tx.error("launch");
  useEffect(() => {
    tx.reset("launch");
    // Any edit after a failed launch clears its reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ticker, lore, website, xUrl, devBuy, art]);
  const launching = tx.pending("launch");
  const step = tx.step("launch");

  const startMcapLamports = previewQuote.mcapLamports ?? 0;
  const tierUsd = tierUsdOf(cfg);
  const previewCard: CardData = {
    name: name.trim() || "Your coin",
    ticker: ticker || "TICKER",
    image: preview ?? "",
    level: peek,
    // A rare design shows the market cap it unlocks at, so the card's own figure matches the chip.
    mcapLabel: peek === 1 && (previewQuote.mcapLamports === null || usdPerLamportOf(cfg) <= 0) ? "Pending quote" : undefined,
    mcapUsd: peek > 1 ? (tierUsd[peek - 1] ?? TIERS[peek - 1].minUsd) : startMcapLamports * usdPerLamportOf(cfg),
    holders: hasDevBuy ? 1 : 0,
    dexNo: 0,
    dexLabel: "New",
    ownerHandle: viewer.handle ?? "you",
    lore: lore.trim() || undefined,
  };
  const pick = (level: number) => {
    setPeek(level);
    setSide("face");
  };

  const buttonLabel = siteHold
    ? "Launch paused"
    : !viewer.connected
      ? CHAIN_COPY.connectToLaunch
      : preparing
        ? "Preparing art..."
        : "Mint and launch";

  return (
    <PageFrame className="mdx-page">
      <PageHeader title="Launch a coin" context={MODE_COPY.launchContext} />

      <div className="grid grid-cols-1 gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:grid-rows-[minmax(0,1fr)]">
        <form
          onSubmit={submit}
          noValidate
          aria-label="New coin"
          className="mdx-plinth mdx-scroll flex min-w-0 flex-col gap-4 lg:min-h-0 lg:gap-0 lg:overflow-y-auto"
        >
          {/* Phones: Name over Ticker beside the live preview (a tap opens it in 3D). Desktop: Name | Ticker in one
              row (the column wrapper dissolves) and the big stage on the right. */}
          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-x-4 gap-y-4 lg:grid-cols-[minmax(0,1fr)_180px]">
            <div className="flex min-w-0 flex-col gap-4 lg:contents">
              <Field label="Name" htmlFor="name" error={nameMsg} className="min-w-0">
                <Input
                  ref={nameRef}
                  id="name"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={touch("name")}
                  placeholder="Glorb"
                  autoComplete="off"
                  aria-invalid={nameMsg ? true : undefined}
                  aria-describedby={nameMsg ? "name-help" : undefined}
                />
              </Field>
              <Field label="Ticker" htmlFor="ticker" error={tickerMsg} className="min-w-0">
                <Input
                  ref={tickerRef}
                  id="ticker"
                  prefix="$"
                  value={ticker}
                  maxLength={API_LIMITS.symbolMaxChars}
                  onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  onBlur={touch("ticker")}
                  placeholder="GLORB"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={tickerMsg ? true : undefined}
                  aria-describedby={tickerMsg ? "ticker-help" : undefined}
                />
              </Field>
            </div>
            <div className="self-start pt-1 lg:hidden">
              <PhonePreview card={previewCard} />
            </div>
          </div>

          <DesignPicker level={peek} usd={tierUsd} onPick={pick} className="lg:hidden" />

          <Gap />

          <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 sm:grid-cols-[136px_minmax(0,1fr)] short:sm:grid-cols-[112px_minmax(0,1fr)] [@media(min-width:1024px)_and_(min-height:960px)]:grid-cols-[176px_minmax(0,1fr)]">
            <Field label="Card art" htmlFor="art" error={artMsg} className="min-w-0">
              <button
                ref={artRef}
                id="art"
                type="button"
                data-over={dragging ? "true" : undefined}
                aria-label={preview ? "Card art. Click to replace the image" : "Card art. Drop an image or click to choose one"}
                aria-describedby={artMsg ? "art-help" : undefined}
                aria-busy={preparing || undefined}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragging) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`mdx-drop aspect-square w-full ${artMsg ? "border-down" : ""}`}
              >
                {preview ? (
                  <img src={preview} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <ArtPrompt />
                )}
                {preparing && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center bg-plinth/80 text-[13px] text-slate">
                    Preparing...
                  </span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </Field>
            <Field
              label="Description"
              htmlFor="lore"
              className="min-w-0"
              help={
                <span className="flex items-baseline justify-between gap-3">
                  <span>{LAUNCH_COPY.loreHelp}</span>
                  <span className="num flex-none text-[12px]">
                    {lore.length}/{API_LIMITS.descriptionMaxChars}
                  </span>
                </span>
              }
            >
              <textarea
                id="lore"
                maxLength={API_LIMITS.descriptionMaxChars}
                value={lore}
                onChange={(e) => setLore(e.target.value)}
                placeholder="King of the swamp. Jiggles under pressure, never breaks."
                aria-describedby="lore-help"
                className="mdx-input h-[112px] sm:h-[136px] short:sm:h-[112px] [@media(min-width:1024px)_and_(min-height:960px)]:h-[176px]"
              />
            </Field>
          </div>

          <Gap />

          <MoreOptions ref={moreRef} open={moreOpen} onOpenChange={setMoreOpen}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Website" htmlFor="website" error={websiteMsg} className="min-w-0">
                <Input
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
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
              <Field label="Dev buy" htmlFor="dev">
                <Input
                  ref={devRef}
                  id="dev"
                  numeric
                  suffix="SOL"
                  inputMode="decimal"
                  autoComplete="off"
                  value={devBuy}
                  onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
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
                ) : hasDevBuy && !devEst ? (
                  <span className="block">Coin estimate unavailable. Your dev buy is included in the total and checked before signing.</span>
                ) : !devEst ? (
                  <span className="block">{LAUNCH_COPY.devEmpty(`${sol(MAX_DEV_BUY, 0)} ${SOL_WORD}`)}</span>
                ) : null}
                <span aria-live="polite" className="block empty:hidden">
                  {devEst && !devError ? (
                    <>
                      You get about{" "}
                      <span className="text-ink">
                        <span className="num">{tokens(devEst.tokens)}</span> {tickerText}
                      </span>{" "}
                      first.
                    </>
                  ) : null}
                </span>
              </p>
            </div>
          </MoreOptions>

          <Gap />

          <div className="mt-auto">
            <p className="mb-1 text-[13px] leading-[1.45] text-slate">
              <TextLink to="/legal" hash="terms">
                Content rules
              </TextLink>
              : {WORDS.contentRule}
            </p>
            {/* The no-value or real-money line stays by the total wherever no banner says it (mintdex.fun, mainnet). */}
            <CostTotal total={total} items={costItems} note={banner ? null : CHAIN_COPY.noValue} className="mb-2" />
            {short ? (
              <p role="alert" className="mb-2 text-[13px] leading-[1.45] text-down">
                Not enough {SOL_WORD} (wallet <span className="num">{sol(balance ?? 0, 3)}</span>). <FaucetLinks lead={false} />
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              block
              pending={launching}
              pendingLabel={tx.label("launch", "Launching...")}
              disabled={siteHold || notice.blocked || (viewer.connected && (preparing || !!network))}
              aria-describedby={siteHold ? "launch-funding-hold" : undefined}
              feedback={tx.feedback("launch")}
              successLabel="Minted"
            >
              {buttonLabel}
            </Button>
            {siteHold ? (
              <p id="launch-funding-hold" role="status" className="mt-2 text-[13px] leading-[1.45] text-slate">
                {SITE_TRANSACTION_HOLD_NOTICE} You can still preview your coin and card.
              </p>
            ) : launching && step ? (
              <StepLine steps={LAUNCH_STEPS} step={step} className="mt-2" />
            ) : launchError ? (
              <p role="alert" className="mt-2 text-[13px] leading-[1.45] text-down">
                {launchError}
              </p>
            ) : network ? (
              <p role="alert" className="mt-2 text-[13px] leading-[1.45] text-down">
                {network}
              </p>
            ) : notice.kind !== "none" ? (
              <p role="status" className="mt-2 text-[13px] leading-[1.45] text-slate">
                <span className="font-semibold text-ink">{notice.kind === "paused" ? SWITCH_COPY.launchesPaused : SWITCH_COPY.launchesSoon}.</span>{" "}
                {notice.kind === "paused" ? SWITCH_COPY.launchesPausedHelp : SWITCH_COPY.launchesSoonHelp}
              </p>
            ) : (
              <p className="mt-2 text-[13px] leading-[1.45] text-slate">{WORDS.launcherLine}</p>
            )}
          </div>
        </form>

        <section
          aria-label="Live preview"
          style={STAGE_VARS}
          className="flex min-w-0 flex-col overflow-clip pt-6 [--cw:240px] max-lg:hidden short:pt-4 lg:min-h-0 lg:[container-type:size] lg:[--cw:var(--cw-lg)]"
        >
          <div className="flex justify-center lg:min-h-0 lg:flex-1 lg:items-end">
            <div className="flex-none" style={{ width: "var(--cw)" }}>
              {/* In your hand: it breathes and peeks at its back, a tap (or F) turns it over, a new picture
                  prints onto it and typing settles it (refs/alive-3d-spec.md 7, Launch). Any edit turns it face up. */}
              <MintCard card={previewCard} depth="hand" idle="breathe-peek" focusable side={side} onSideChange={setSide} />
            </div>
          </div>
          <Ledge className="w-full flex-none" />
          <div className="flex-none pb-6 lg:h-[var(--cap)] lg:pb-0">
            <div className="pr-4 pt-4" style={{ marginLeft: "calc((100% - var(--cw)) / 2)" }}>
              <DesignPicker level={peek} usd={tierUsd} onPick={pick} />
            </div>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
