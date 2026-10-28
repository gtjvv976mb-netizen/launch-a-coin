import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";

import { useAction } from "../components/mintdex/hooks";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { useMe, useRequireMe } from "../components/mintdex/session";
import {
  Button,
  CARD_ASPECT,
  Field,
  Input,
  PageFrame,
  PageHeader,
  TextLink,
  useToast,
} from "../components/mintdex/ui";
import {
  ArtPrompt,
  ChainLaunch,
  CostTotal,
  MoreOptions,
  PhonePreview,
} from "../components/chain/pages/ChainLaunch";
import { launch } from "../lib/mintdex/api";
import { LAMPORTS, LAUNCH_FEE, MAX_DEV_BUY, TICKER_RE } from "../lib/mintdex/constants";
import { FLOW, IS_SIM, LAUNCH_COPY, MODE_COPY, WORDS } from "../lib/mintdex/copy";
import { INITIAL_RESERVES, mcapUsd, quoteBuy } from "../lib/mintdex/curve";
import { parseSol, sol, tokens } from "../lib/mintdex/format";
import { pageHead, sentences } from "../lib/mintdex/seo";
import { z } from "zod";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { CardDesignPicker } from "../components/carddex/CardDesignPicker";
import { DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../lib/carddex/designs";

export const Route = createFileRoute("/launch")({
  validateSearch: z.object({ design: z.string().optional().catch(undefined) }),
  head: () =>
    pageHead({
      path: "/launch",
      title: "Launch a coin | CardDex",
      description: sentences(
        "Choose a permanent card design, add your token details and preview its one-of-one card",
        MODE_COPY.metaSuffix,
      ),
    }),
  // Devnet: a real launch through the wallet (components/chain/pages/ChainLaunch.tsx).
  component: Launch,
});

// ---------------------------------------------------------------- copy

/** What really happens to the coin, per mode (P0-5): in test mode, a simulated curve. */
const CONTEXT = MODE_COPY.launchContext;
const MAX_DEV_SOL = (MAX_DEV_BUY / LAMPORTS).toLocaleString("en-US");
const ENTER_TO_UPLOAD = "Enter CardDex to upload card art and launch.";

// ---------------------------------------------------------------- stage geometry

/** Space below the complete card for the selected finish and its stock reference, if any. */
const CAPTION_H = 184;
const PREVIEW_CONTROLS_H = 48;
/**
 * Desktop card width, read by the stage's descendants through --cw: the widest 63/88 card that fits the
 * stage height above its controls and design selector, with 16px of wall either side, never wider than 480px.
 * The stage is a size container, so cqw and cqh measure it.
 */
const STAGE_VARS = {
  "--cap": `${CAPTION_H}px`,
  "--cw-lg": `min(calc(100cqw - 32px), max(180px, calc((100cqh - ${CAPTION_H + PREVIEW_CONTROLS_H}px) * ${CARD_ASPECT.toFixed(6)})), 480px)`,
} as CSSProperties;

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

/**
 * Desktop row spacer. The spacers share the form's free height evenly (12px minimum, 14px at 1280x720 and
 * up, 56px maximum), so the rows spread like the board instead of leaving one hole above the button; any
 * height left after that goes above the button (mt-auto). At 1280x720 they sit near 20px; the 14px floor
 * only bites when every field shows an error at once, so even then the form does not scroll.
 * Phones use the form's plain 16px gap.
 */
function Gap() {
  return (
    <div
      aria-hidden
      className="hidden flex-[1_1_0px] lg:block lg:max-h-14 lg:min-h-3 fit:min-h-3.5"
    />
  );
}

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
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // A creator's permanent design choice is independent of the token's market data.
  const search = Route.useSearch();
  const [designKey, setDesignKey] = useState(() =>
    isCardDesignKey(search.design) ? search.design : DEFAULT_CARD_DESIGN,
  );
  const design = getCardDesign(designKey);
  useEffect(() => {
    if (isCardDesignKey(search.design)) setDesignKey(search.design);
  }, [search.design]);

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

  // Dev buy quote on the fresh curve, and what the launch costs in total.
  const devLamports = devBuy ? parseSol(devBuy) : 0;
  const devNaN = !!devBuy && !Number.isFinite(devLamports);
  const devOver = Number.isFinite(devLamports) && devLamports > MAX_DEV_BUY;
  const devQuote =
    devLamports > 0 && !devNaN && !devOver ? quoteBuy(INITIAL_RESERVES, devLamports) : null;
  const after = devQuote?.ok ? devQuote.after : INITIAL_RESERVES;
  const total = LAUNCH_FEE + (devQuote?.ok ? devQuote.solIn : 0);
  const devError = devNaN
    ? "Enter an amount like 0.5."
    : devOver
      ? `Dev buy is capped at ${MAX_DEV_SOL} SOL.`
      : devQuote && !devQuote.ok
        ? `${devQuote.reason}.`
        : null;
  const balanceError =
    me && !devError && me.balance < total
      ? `Not enough SOL. You have ${sol(me.balance)} SOL.`
      : null;

  // Field checks (the server repeats every one of them).
  const nameOk = name.trim().length >= 2;
  const tickerOk = TICKER_RE.test(ticker);
  const websiteError = linkError(website, "web");
  const xError = linkError(xUrl, "x");
  const ready =
    nameOk &&
    tickerOk &&
    !!imageUrl &&
    !websiteError &&
    !xError &&
    !devError &&
    !balanceError &&
    !uploading;

  // An error shows once the field is left with something in it, or after a submit attempt.
  const shown = (key: FieldKey, value: string) =>
    showErrors || (!!touched[key] && value.trim() !== "");
  const nameMsg = !nameOk && shown("name", name) ? "Use 2 to 24 characters." : null;
  const tickerMsg = !tickerOk && shown("ticker", ticker) ? "Use 2 to 8 characters." : null;
  const artMsg = showErrors && !imageUrl && !uploading ? "Add card art." : null;
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
    if (!me) {
      // After Enter, focus comes back to the dropzone (a file picker cannot reopen without a click).
      require(() => artRef.current?.focus(), ENTER_TO_UPLOAD, "Enter CardDex");
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
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
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

  function focusFirstProblem() {
    const first = !nameOk
      ? nameRef
      : !tickerOk
        ? tickerRef
        : !imageUrl
          ? artRef
          : websiteError
            ? websiteRef
            : xError
              ? xRef
              : devError || (balanceError && devQuote?.ok)
                ? devRef
                : null;
    // A field inside a closed "More options" cannot take focus: open it first (the DOM at once, the state follows).
    if (
      (first === websiteRef || first === xRef || first === devRef) &&
      moreRef.current &&
      !moreRef.current.open
    ) {
      moreRef.current.open = true;
      setMoreOpen(true);
    }
    first?.current?.focus();
  }

  async function attempt() {
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
            ticker,
            image: imageUrl,
            lore,
            website: website.trim() || undefined,
            xUrl: xUrl.trim() || undefined,
            devBuy: devQuote?.ok ? devLamports : 0,
          },
        }),
      undefined,
      { keys: [["home"], ["coins"], ["market"], ["portfolio"]] },
    );
    // The coin page opens "Your card is live" (P1-12) for ?minted=1, then drops the flag from the URL.
    if (res) navigate({ to: "/coin/$id", params: { id: res.id }, search: { minted: 1 } });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    // Signed out: the Enter dialog names the launch, then finishes it (P1-11). Without art yet, that means
    // pointing at the art field, the one thing left to do.
    require(() => void attempt(), "Enter CardDex to launch your coin.", ticker && imageUrl
      ? `Enter and launch $${ticker}`
      : "Enter CardDex");
  }

  const tickerText = ticker ? `$${ticker}` : "coins";
  const launchError = errorOf("launch");
  // Any edit after a failed launch clears its reason.
  useEffect(() => {
    reset("launch");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ticker, lore, website, xUrl, devBuy, imageUrl]);

  // The live preview's data: the big stage on desktop, the small card beside Name and Ticker on phones.
  const previewCard: CardData = {
    name: name.trim() || "Your coin",
    ticker: ticker || "TICKER",
    image: preview ?? "",
    level: design.materialLevel,
    cardTemplate: designKey,
    // The same live quote and identity fields occupy the same card slots in every finish.
    mcapUsd: mcapUsd(after),
    holders: devQuote?.ok ? 1 : 0,
    dexNo: 0,
    dexLabel: "New",
    ownerHandle: me?.handle ?? "you",
    lore: lore.trim() || undefined,
  };
  const pick = (key: string) => {
    if (isCardDesignKey(key)) setDesignKey(key);
  };
  const costItems = [
    ...(devQuote?.ok ? [{ label: "Dev buy", lamports: devQuote.solIn }] : []),
    { label: LAUNCH_COPY.costLaunchFee, lamports: LAUNCH_FEE },
  ];

  return (
    <PageFrame className="mdx-page">
      <PageHeader title="Launch a coin" context={CONTEXT} wrapContext />

      <div className="cdx-create-layout">
        {/* ------------------------------------------------ the form (plinth) */}
        <form
          onSubmit={submit}
          noValidate
          aria-label="New coin"
          className="cdx-create-form mdx-plinth mdx-scroll flex min-w-0 flex-col gap-4 lg:gap-0"
        >
          {/* Phones (P1-22): Name over Ticker beside a 112px live preview that opens in 3D, so the card answers
              every keystroke on the same screen. Desktop: Name | Ticker in one row and the big stage on the right. */}
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-4 gap-y-4 sm:grid-cols-[minmax(0,1fr)_112px] lg:grid-cols-[minmax(0,1fr)_180px]">
            <div className="flex min-w-0 flex-col gap-4 lg:contents">
              <Field label="Name" htmlFor="name" error={nameMsg} className="min-w-0">
                <Input
                  ref={nameRef}
                  id="name"
                  value={name}
                  maxLength={24}
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
                  maxLength={8}
                  onChange={(e) =>
                    setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  }
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

          <div className="lg:hidden">
            <CardDesignPicker value={designKey} onChange={pick} />
          </div>

          <Gap />

          <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 sm:grid-cols-[136px_minmax(0,1fr)] short:sm:grid-cols-[112px_minmax(0,1fr)] [@media(min-width:1024px)_and_(min-height:960px)]:grid-cols-[176px_minmax(0,1fr)]">
            <Field label="Card art" htmlFor="art" error={artMsg} className="min-w-0">
              <button
                ref={artRef}
                id="art"
                type="button"
                data-over={dragging ? "true" : undefined}
                aria-label={
                  preview
                    ? "Card art. Click to replace the image"
                    : "Card art. Drop an image or click to upload"
                }
                aria-describedby={artMsg ? "art-help" : undefined}
                aria-busy={uploading || undefined}
                onClick={() =>
                  me
                    ? fileRef.current?.click()
                    : require(() => artRef.current?.focus(), ENTER_TO_UPLOAD, "Enter CardDex")
                }
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragging) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`mdx-drop aspect-square w-full ${artMsg ? "border-down" : ""}`}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <ArtPrompt />
                )}
                {uploading && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center bg-plinth/80 text-[13px] text-slate">
                    Uploading...
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
                  handleFile(e.target.files?.[0]);
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
                  <span>Shown on the card. The owner can edit it later.</span>
                  <span className="num flex-none text-[12px]">{lore.length}/280</span>
                </span>
              }
            >
              <textarea
                id="lore"
                maxLength={280}
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
                  <span className="block">{LAUNCH_COPY.devEmpty(`${MAX_DEV_SOL} SOL`)}</span>
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
          </MoreOptions>

          <Gap />

          <div className="mt-auto">
            {/* The content rule (P1-28), right where people commit. */}
            <p className="mb-1 text-[13px] leading-[1.45] text-slate">
              <TextLink to="/legal" search={{ tab: "terms" }}>
                Content rules
              </TextLink>
              : {WORDS.contentRule}
            </p>
            <CostTotal total={total} items={costItems} className="mb-2" />
            {balanceError ? (
              <p role="alert" className="mb-2 text-[13px] leading-[1.45] text-down">
                {balanceError}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              block
              pending={pending === "launch"}
              pendingLabel="Minting your card..."
              disabled={!!me && uploading}
              feedback={feedback("launch")}
              successLabel="Minted"
            >
              {!me ? FLOW.enterToLaunch : uploading ? "Uploading art..." : "Mint and launch"}
            </Button>
            {/* The server's reason for a failed launch takes the launcher line's place (no new row, P1-8). */}
            {launchError ? (
              <p role="alert" className="mt-2 text-[13px] leading-[1.45] text-down">
                {launchError}
              </p>
            ) : (
              <p className="mt-2 text-[13px] leading-[1.45] text-slate">{WORDS.launcherLine}</p>
            )}
          </div>
        </form>

        {/* The original MintDex arrangement: a full, open card stage to the right of the details. */}
        <section aria-label="Your card preview" style={STAGE_VARS} className="cdx-create-preview">
          {/* The one unsleeved card: no pocket, because this card is not minted yet. */}
          <div className="cdx-create-preview__card">
            <div className="flex-none" style={{ width: "var(--cw, 300px)" }}>
              {/* In your hand: it breathes and peeks at its back, a tap (or F) turns it over, a new picture
                  prints onto it and typing settles it (refs/alive-3d-spec.md 7, Launch). Any edit turns it face up. */}
              <HeroTurntable card={previewCard} followEdits />
            </div>
          </div>

          <div className="cdx-create-preview__picker">
            {/* Flush with the card's left edge; free to run to the stage's right edge. */}
            <div className="w-full">
              <CardDesignPicker value={designKey} onChange={pick} />
            </div>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
