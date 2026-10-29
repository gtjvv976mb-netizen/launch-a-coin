import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  abandonLiveLaunchIntent, confirmLiveCreatorNft, confirmLiveToken, createLiveWalletChallenge, getLiveLaunchIntent,
  getLiveLaunchReadiness, getLiveWallet, listLiveLaunchIntents, prepareLiveCreatorNft,
  prepareLiveLaunch, submitLiveTransaction, verifyLiveWallet,
  type LiveLaunchIntent, type LivePrepareInput, type LiveResult,
} from "../../../lib/carddex/live/api";
import { composeCreatorCard } from "../../../lib/carddex/live/compose-client";
import { getCardDesign } from "../../../lib/carddex/designs";
import { getPairAsset, getTradingPair } from "../../../lib/carddex/pairs";
import type { CardData } from "../../mintdex/MintCard";
import { Button, Modal } from "../../mintdex/ui";
import { LiveWalletButton } from "./LiveWalletButton";
import { formatLiveAmount } from "./amounts";
import { PagedMessage } from "./PagedMessage";
import { getLiveWalletSnapshot, signLiveMessage, signLiveTransaction, useLiveWallet } from "./wallet";
import {
  createEphemeralSigner, destroyEphemeralSigner, partiallySignPlan, toBase64, validateLivePlan,
  type EphemeralSigner, type ExpectedPlan, type TransactionPlan,
} from "./transaction";

export type LiveLaunchDraft = {
  name: string; symbol: string; description: string; website: string; xUrl: string;
  cardTemplate: string; quoteAssetKey: string; quoteMint: string;
  initialBuyQuoteBaseUnits: string; artwork: Blob;
};
export type LiveLaunchHandle = { submit(): void };
type Busy = "ownership" | "artwork" | "preparing" | "wallet" | "submitting" | "confirming" | "recovering" | null;
const BUSY_COPY: Record<NonNullable<Busy>, string> = {
  ownership: "Approve the ownership message in your wallet. This message spends no funds.",
  artwork: "Preparing your artwork and complete card…",
  preparing: "Creating your turning card image and checking exact launch costs…",
  wallet: "Review the transaction in your wallet. You can reject it there.",
  submitting: "Submitting the transaction you approved…",
  confirming: "Waiting for finalized on-chain verification…",
  recovering: "Checking your saved launch before any new transaction…",
};
const INTENT_KEY = "carddex.live.intent.v1";
function savedIntent(wallet: string): string | null {
  try { const all = JSON.parse(localStorage.getItem(INTENT_KEY) ?? "{}"); return typeof all[wallet] === "string" ? all[wallet] : null; } catch { return null; }
}
function rememberIntent(wallet: string, id: string | null) {
  try { const all = JSON.parse(localStorage.getItem(INTENT_KEY) ?? "{}"); if (id) all[wallet] = id; else delete all[wallet]; localStorage.setItem(INTENT_KEY, JSON.stringify(all)); } catch { /* Recovery remains available through the authenticated server list. */ }
}
function unwrap<T extends object>(result: LiveResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result;
}
const brief = (value: string) => `${value.slice(0, 5)}…${value.slice(-5)}`;

function TokenImagePreview({intent,large=false}:{intent:LiveLaunchIntent;large?:boolean}) {
  const image=intent.assets.tokenImage, poster=intent.assets.tokenPoster;
  if(!image)return null;
  return <figure className={`cdx-live-token-image${large ? " cdx-live-token-image--review" : ""}`}>
    <a href={image.url} target="_blank" rel="noreferrer" aria-label="Open your turning token image"><picture>
      {poster ? <source media="(prefers-reduced-motion: reduce)" srcSet={poster.url} /> : null}
      <img src={image.url} alt={`${intent.name} token image: the complete card turns through its front and back`} width="64" height="64" />
    </picture></a>
    <figcaption><strong>Token image</strong><span>360° card · front &amp; back</span>{poster ? <a href={poster.url} target="_blank" rel="noreferrer">Still image</a> : null}</figcaption>
  </figure>;
}

export function LiveLaunchPanel({ draft, card, pairPending, onInvalid, onLockedChange, onIntentLoaded, ref }: {
  draft: LiveLaunchDraft | null; card: CardData; pairPending: boolean; onInvalid(): void;
  onLockedChange(locked: boolean): void;
  onIntentLoaded(intent: LiveLaunchIntent | null): void;
  ref?: Ref<LiveLaunchHandle>;
}) {
  const wallet = useLiveWallet();
  const readiness = useQuery({ queryKey: ["live-launch-readiness"], queryFn: () => getLiveLaunchReadiness(), staleTime: 30_000, retry: 1 });
  const [busy, setBusy] = useState<Busy>(null), [error, setError] = useState("");
  const [terms, setTerms] = useState(false), [slippageBps, setSlippageBps] = useState(100);
  const [intent, setIntent] = useState<LiveLaunchIntent | null>(null);
  const [plan, setPlan] = useState<TransactionPlan | null>(null), [reviewOpen, setReviewOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<LiveLaunchIntent[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const [pane, setPane] = useState("launch"), [termsSeen, setTermsSeen] = useState(false);
  const [reviewPage, setReviewPage] = useState(0), [reviewSeen, setReviewSeen] = useState(0);
  const [recoveryPage, setRecoveryPage] = useState(0);
  const reviewBody = useRef<HTMLDivElement>(null), recoveryBody = useRef<HTMLDivElement>(null);
  const goRecovery = (next: number) => { setRecoveryPage(next); requestAnimationFrame(() => recoveryBody.current?.focus({ preventScroll: true })); };
  const goReview = (next: number) => { setReviewPage(next); setReviewSeen(n => Math.max(n,next)); requestAnimationFrame(() => reviewBody.current?.focus({ preventScroll: true })); };
  useEffect(() => { if (pane === "terms") setTermsSeen(true); }, [pane]);
  useEffect(() => { if (error && !reviewOpen) setPane("status"); }, [error, reviewOpen]);
  useEffect(() => { if (reviewOpen) { setReviewPage(0); setReviewSeen(0); } }, [reviewOpen, plan]);
  const tokenKey = useRef<EphemeralSigner | null>(null), nftKey = useRef<EphemeralSigner | null>(null);
  const idempotencyKey = useRef<string | null>(null), creator = useRef<string | null>(null);
  const running = useRef(false), generation = useRef(0), mounted = useRef(true);
  const connectButton = useRef<HTMLButtonElement>(null), termsRef = useRef<HTMLInputElement>(null);
  const pendingIntent = useRef<LiveLaunchIntent | null>(null);
  const draftAtPrepare = useRef<LiveLaunchDraft | null>(null);
  const preparedInput = useRef<LivePrepareInput | null>(null);
  const available = readiness.data?.ready === true;
  useEffect(() => { onLockedChange(!!intent); }, [intent, onLockedChange]);
  useEffect(() => { onIntentLoaded(intent); }, [intent, onIntentLoaded]);
  useEffect(() => () => onLockedChange(false), [onLockedChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++;
      destroyEphemeralSigner(tokenKey.current); destroyEphemeralSigner(nftKey.current);
      tokenKey.current = null; nftKey.current = null;
    };
  }, []);
  const assertCurrent = (version: number, address: string) => {
    if (!mounted.current || generation.current !== version) throw new Error("The launch view changed. Resume your saved launch to check its status.");
    const current = getLiveWalletSnapshot();
    if (current.address !== address || !current.mainnet) throw new Error("The connected wallet changed. Reconnect the creator wallet to resume safely.");
  };
  const retain = (next: LiveLaunchIntent) => {
    if (next.status === "abandoned") {
      rememberIntent(next.creatorWallet, null); pendingIntent.current = null;
      destroyEphemeralSigner(tokenKey.current); destroyEphemeralSigner(nftKey.current);
      tokenKey.current = null; nftKey.current = null; preparedInput.current = null;
      idempotencyKey.current = null; creator.current = null; draftAtPrepare.current = null;
      if (mounted.current) { setIntent(null); setPlan(null); setUncertain(false); setTerms(false); }
      return;
    }
    pendingIntent.current = next;
    creator.current = next.creatorWallet;
    rememberIntent(next.creatorWallet, next.id);
    if (mounted.current) setIntent(next);
    if (next.status === "nft_pending" || next.status === "complete") {
      destroyEphemeralSigner(tokenKey.current); tokenKey.current = null;
    }
    if (next.status === "complete") { destroyEphemeralSigner(nftKey.current); nftKey.current = null; }
  };
  async function authenticate(address: string, version: number) {
    const existing = await getLiveWallet(); assertCurrent(version, address);
    if (existing?.wallet === address && existing.expiresAt > Date.now()) return;
    setBusy("ownership");
    const challenge = unwrap(await createLiveWalletChallenge({ data: { wallet: address } }));
    assertCurrent(version, address);
    const signature = await signLiveMessage(new TextEncoder().encode(challenge.message), address);
    assertCurrent(version, address);
    unwrap(await verifyLiveWallet({ data: { challengeId: challenge.challengeId, wallet: address, signatureBase64: toBase64(signature) } }));
    assertCurrent(version, address);
  }
  async function operate(action: (address: string, version: number) => Promise<void>) {
    if (running.current) return;
    const address = wallet.address;
    if (!address) { connectButton.current?.click(); return; }
    if (!wallet.mainnet) { setError("Switch this wallet account to Solana mainnet, then try again."); return; }
    running.current = true; setError("");
    const version = generation.current;
    try { await action(address, version); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The launch paused. Check the saved launch before trying again."); }
    finally { running.current = false; if (mounted.current) setBusy(null); }
  }
  async function recover(id?: string) {
    await operate(async (address, version) => {
      setBusy("recovering"); await authenticate(address, version);
      if (id) {
        const found = unwrap(await getLiveLaunchIntent({ data: { intentId: id } })).intent;
        assertCurrent(version, address); retain(found); setPlan(null); setUncertain(false);
      }
      const found = unwrap(await listLiveLaunchIntents()); assertCurrent(version, address);
      setRecoverable(found.intents);
    });
  }
  // A connected wallet may already have a valid ownership session. These reads never open a signing prompt.
  useEffect(() => {
    setRecoverable([]);
    if (!wallet.address || !available) return;
    let canceled = false;
    void getLiveWallet().then(async session => {
      if (canceled || session?.wallet !== wallet.address) return;
      const response = await listLiveLaunchIntents();
      if (canceled || !response.ok) return;
      setRecoverable(response.intents);
      const saved = savedIntent(wallet.address!);
      if (saved) {
        const response = await getLiveLaunchIntent({ data: { intentId: saved } });
        if (!canceled && response.ok) retain(response.intent);
      }
    }).catch(() => undefined);
    return () => { canceled = true; };
  }, [wallet.address, available]);

  async function prepareDraft() {
    if (pairPending || !draft) { onInvalid(); return; }
    if (!available) { setError("Mainnet launch setup must be ready before a transaction can be prepared."); return; }
    if (!terms) { setError("Confirm the mainnet launch terms before continuing."); termsRef.current?.focus(); return; }
    await operate(async (address, version) => {
      if (pendingIntent.current?.status === "prepared" && preparedInput.current && tokenKey.current) {
        await authenticate(address, version); setBusy("preparing");
        const response = unwrap(await prepareLiveLaunch({ data: preparedInput.current }));
        assertCurrent(version, address); retain(response.intent);
        if (response.transaction) {
          const next = response.transaction as TransactionPlan;
          validateLivePlan(next, expectedFor(response.intent, "token")); setPlan(next); setReviewOpen(true);
        }
        return;
      }
      const saved = savedIntent(address);
      if (saved && saved !== intent?.id) {
        setBusy("recovering"); await authenticate(address, version);
        const previous = unwrap(await getLiveLaunchIntent({ data: { intentId: saved } })).intent;
        assertCurrent(version, address); retain(previous);
        setError("Your saved launch was restored. Finish or verify it before starting another token.");
        return;
      }
      if (pendingIntent.current && pendingIntent.current.status !== "complete" && !tokenKey.current) {
        setError("This saved launch needs recovery. Check its existing token before preparing anything new."); return;
      }
      if (creator.current && creator.current !== address) throw new Error("Reconnect the wallet that owns this prepared launch.");
      await authenticate(address, version);
      if (!tokenKey.current) tokenKey.current = createEphemeralSigner();
      if (!nftKey.current) nftKey.current = createEphemeralSigner();
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      creator.current = address; draftAtPrepare.current = draft;
      setBusy("artwork");
      const assets = await composeCreatorCard({ card, tokenMint: tokenKey.current.address, artwork: draft.artwork, website: draft.website, xUrl: draft.xUrl });
      assertCurrent(version, address); setBusy("preparing");
      const input: LivePrepareInput = {
        idempotencyKey: idempotencyKey.current, tokenMint: tokenKey.current.address, nftMint: nftKey.current.address,
        name: draft.name, symbol: draft.symbol, description: draft.description, website: draft.website, xUrl: draft.xUrl, cardTemplate: draft.cardTemplate,
        quoteAssetKey: draft.quoteAssetKey, quoteMint: draft.quoteMint, initialBuyQuoteBaseUnits: draft.initialBuyQuoteBaseUnits,
        slippageBps, assets, termsAcknowledged: true,
      };
      preparedInput.current = input;
      const response = unwrap(await prepareLiveLaunch({ data: input }));
      assertCurrent(version, address); retain(response.intent);
      if (response.transaction) {
        const next = response.transaction as TransactionPlan;
        validateLivePlan(next, expectedFor(response.intent, next.kind));
        setPlan(next); setReviewOpen(true);
      }
    });
  }
  function expectedFor(current: LiveLaunchIntent, kind: "token" | "nft"): ExpectedPlan {
    const quote = getPairAsset(current.quoteAssetKey);
    return { kind, creator: current.creatorWallet, mint: kind === "token" ? current.tokenMint : current.nftMint,
      tokenMint: current.tokenMint, name: current.name, symbol: current.symbol, tokenMetadataUri: current.tokenMetadataUri,
      nftMetadataUri: current.nftMetadataUri, cardTemplate: current.cardTemplate, cardImageSha256: current.assets.cardImage.sha256,
      nftMetadataSha256: current.nftMetadataSha256, bindingSha256: current.bindingSha256, quoteKey: current.quoteAssetKey,
      quoteMint: current.quoteMint, quoteTokenProgram: quote.tokenProgram, quoteDecimals: quote.decimals,
      initialBuyQuoteBaseUnits: kind === "token" ? current.initialBuyQuoteBaseUnits : "0", launchInitialBuyQuoteBaseUnits: current.initialBuyQuoteBaseUnits };
  }
  async function prepareNft() {
    const current = pendingIntent.current;
    if (!current || current.status !== "nft_pending") return;
    await operate(async (address, version) => {
      if (current.creatorWallet !== address) throw new Error("Connect the creator wallet to issue this card.");
      await authenticate(address, version); setBusy("preparing");
      if (!nftKey.current) nftKey.current = createEphemeralSigner();
      const response = unwrap(await prepareLiveCreatorNft({ data: { intentId: current.id, nftMint: nftKey.current.address } }));
      assertCurrent(version, address); retain(response.intent);
      if (response.transaction) {
        const next = response.transaction as TransactionPlan;
        validateLivePlan(next, expectedFor(response.intent, "nft"));
        setUncertain(false); setPlan(next); setReviewOpen(true);
      }
    });
  }
  async function confirmCurrent(kind: "token" | "nft", signature: string, address: string, version: number, messageSha256?: string) {
    const current = pendingIntent.current;
    if (!current) return;
    setBusy("confirming");
    for (let count = 0; count < 12; count++) {
      assertCurrent(version, address);
      const data = { intentId: current.id, signature, messageSha256 };
      const response = unwrap(await (kind === "token" ? confirmLiveToken({ data }) : confirmLiveCreatorNft({ data })));
      assertCurrent(version, address); retain(response.intent);
      if (kind === "token" ? response.intent.status === "nft_pending" || response.intent.status === "complete" : response.intent.status === "complete") { setUncertain(false); setPlan(null); return; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    setError("The transaction is still being verified. Your saved launch can be checked again without creating another token.");
  }
  async function approveInWallet() {
    const current = pendingIntent.current, currentPlan = plan;
    if (!current || !currentPlan) return;
    await operate(async (address, version) => {
      if (current.creatorWallet !== address) throw new Error("Reconnect the creator wallet before signing.");
      await authenticate(address, version);
      const key = currentPlan.kind === "token" ? tokenKey.current : nftKey.current;
      if (!key) throw new Error("This page no longer holds the new asset key. Resume the saved launch to recover safely.");
      const partial = partiallySignPlan(currentPlan, expectedFor(current, currentPlan.kind), key);
      assertCurrent(version, address); setBusy("wallet");
      const signed = await signLiveTransaction(partial, address);
      assertCurrent(version, address); setReviewOpen(false); setBusy("submitting");
      // From this point the outcome may be uncertain after a network interruption. Recover before rebuilding.
      setUncertain(true);
      const response = unwrap(await submitLiveTransaction({ data: { intentId: current.id, kind: currentPlan.kind, messageSha256: currentPlan.messageSha256, transactionBase64: toBase64(signed) } }));
      assertCurrent(version, address); retain(response.intent);
      await confirmCurrent(currentPlan.kind, response.signature, address, version, currentPlan.messageSha256);
    });
  }
  async function checkConfirmation() {
    const current = pendingIntent.current;
    if (!current) return;
    await operate(async (address, version) => {
      await authenticate(address, version); setBusy("recovering");
      const found = unwrap(await getLiveLaunchIntent({ data: { intentId: current.id } })).intent;
      assertCurrent(version, address); retain(found);
      const kind = found.status === "token_pending" ? "token" : found.status === "nft_pending" && found.nftSignature ? "nft" : null;
      const signature = kind === "token" ? found.tokenSignature : kind === "nft" ? found.nftSignature : null;
      if (kind && signature) await confirmCurrent(kind, signature, address, version);
      else setUncertain(false);
    });
  }
  async function discardExpiredDraft() {
    const current = pendingIntent.current;
    if (!current) return;
    await operate(async (address, version) => {
      await authenticate(address, version); setBusy("recovering");
      const response = unwrap(await abandonLiveLaunchIntent({ data: { intentId: current.id } }));
      assertCurrent(version, address); retain(response.intent);
    });
  }
  useImperativeHandle(ref, () => ({ submit: () => { if (intent?.status === "nft_pending") void prepareNft(); else if (intent?.status === "token_pending" || uncertain || intent?.status === "prepared" && !tokenKey.current) void checkConfirmation(); else if (intent?.status !== "complete") void prepareDraft(); } }));
  const selected = intent ? getPairAsset(intent.quoteAssetKey) : getPairAsset(card.quoteAssetKey);
  const currentTitle = intent?.status === "complete" ? "Your token and card are on mainnet" : intent?.status === "nft_pending" ? "Token verified. Your card is next." : intent?.status === "token_pending" ? "Token transaction submitted" : "Create through your wallet";
  const reviewIntent = intent;
  const recoveryItems = recoverable.filter(i => i.status !== "complete" && i.status !== "abandoned");
  const hasTokenImageReview = plan?.kind === "token" && !!reviewIntent?.assets.tokenImage;
  const reviewPages = [...(hasTokenImageReview ? ["Token image"] : []), "Identity", "Network costs", "Total & initial buy", "Quote & issuance", "Wallet approval"];
  const reviewStep = reviewPage - (hasTokenImageReview ? 1 : 0);
  const lastReviewPage = reviewPages.length - 1;
  return <section className="cdx-live-panel" aria-label="Mainnet wallet launch">
    <label className="cdx-live-pane-label">Wallet &amp; launch<select className="mdx-input" aria-label="Wallet launch section" value={pane} onChange={e => setPane(e.target.value)}><option value="launch">Launch</option><option value="terms">Transaction terms</option><option value="recovery">Recover launch</option><option value="saved">Saved launch details</option><option value="status">Status &amp; messages</option></select></label>
    <div className="cdx-live-pane" data-launch-pane="launch" hidden={pane !== "launch"}>
      {intent ? <h2>{currentTitle}</h2> : null}
      {!wallet.address ? <LiveWalletButton buttonRef={connectButton} quiet /> : <p className="cdx-live-address">Creator · {brief(wallet.address)}{!wallet.mainnet ? " · Switch to mainnet" : ""}</p>}
      {!available ? <button type="button" className="mdx-link cdx-live-readiness-link" onClick={() => setPane("status")}>{readiness.isPending ? "Checking mainnet readiness…" : "Mainnet setup required · view status"}</button> : null}
      {!intent ? <><button type="button" className="mdx-link" onClick={() => setPane("terms")}>Read transaction terms</button><label className="cdx-live-check"><input ref={termsRef} type="checkbox" disabled={!termsSeen} checked={terms} onChange={e => setTerms(e.target.checked)} /><span>I have artwork rights and accept paid mainnet transactions.{!termsSeen ? " Read the terms first." : ""}</span></label></> : null}
      {intent?.status === "nft_pending" ? <p>The token is verified. Issue its separate one-of-one card to the same creator wallet.</p> : null}
      {pairPending ? <p role="status">Confirm or cancel the quote change before preparing a transaction.</p> : null}
      {busy ? <PagedMessage text={BUSY_COPY[busy]} /> : null}
      <div className="cdx-live-actions">
        {intent?.status === "complete" ? <Button variant="outline" block onClick={() => { rememberIntent(intent.creatorWallet, null); pendingIntent.current = null; setIntent(null); setPlan(null); preparedInput.current = null; draftAtPrepare.current = null; idempotencyKey.current = null; creator.current = null; setTerms(false); }}>Start another launch</Button> : intent?.status === "nft_pending" ? <Button block pending={!!busy} disabled={!available} onClick={() => void prepareNft()}>Review card NFT issuance</Button> : intent?.status === "token_pending" || uncertain || intent?.status === "prepared" && !tokenKey.current ? <Button block pending={!!busy} disabled={!available} onClick={() => void checkConfirmation()}>Check confirmation</Button> : <Button type="submit" block size="lg" pending={!!busy} disabled={!available || pairPending} onBlocked={pairPending ? onInvalid : undefined}>Review mainnet launch</Button>}
        {intent?.status === "nft_pending" && (intent.nftSignature || uncertain) ? <Button variant="outline" block pending={!!busy} disabled={!available} onClick={() => void checkConfirmation()}>Check card confirmation</Button> : null}
      </div>
    </div>
    <div className="cdx-live-pane" data-launch-pane="terms" hidden={pane !== "terms"}>
      <p>Token creation and card issuance are separate paid mainnet transactions. Exact costs appear before each wallet approval. Your selected quote funds only the optional initial buy.</p>
      {selected.kind === "stock" ? <p>A tokenized-stock quote does not make your creator token company shares.</p> : null}
      <label className="cdx-live-check cdx-live-slippage"><span>Initial-buy slippage</span><select className="mdx-input" value={slippageBps} disabled={!!intent} onChange={e => setSlippageBps(Number(e.target.value))}><option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option></select></label>
      <button type="button" className="mdx-link cdx-live-back" onClick={() => setPane("launch")}>Back to launch</button>
    </div>
    <div ref={recoveryBody} tabIndex={-1} role="region" aria-label="Saved launch recovery" className="cdx-live-pane" data-launch-pane="recovery" hidden={pane !== "recovery"}>
      {intent && (intent.status === "prepared" || intent.status === "token_pending") ? <><p>An unused launch can be discarded only after every prepared transaction expires and the server verifies no token exists.</p><button type="button" className="mdx-link" disabled={!!busy} onClick={() => void discardExpiredDraft()}>Discard expired unused draft</button></> : null}
      {wallet.address && available && !intent ? <><button type="button" className="mdx-link" disabled={!!busy} onClick={() => void recover(savedIntent(wallet.address!) ?? undefined)}>Find / resume saved launch</button>{recoveryItems.slice(recoveryPage * 2, recoveryPage * 2 + 2).map(i => <button key={i.id} type="button" className="mdx-btn mdx-btn--outline" disabled={!!busy} onClick={() => void recover(i.id)}>{brief(i.tokenMint)} · {i.status === "nft_pending" ? "Card pending" : "Check launch"}</button>)}{recoveryItems.length > 2 ? <nav className="cdx-launch-subtabs" aria-label="Saved launch pages"><button type="button" disabled={recoveryPage === 0} onClick={() => goRecovery(recoveryPage - 1)}>Previous</button><span>{recoveryPage + 1} / {Math.ceil(recoveryItems.length / 2)}</span><button type="button" disabled={(recoveryPage + 1) * 2 >= recoveryItems.length} onClick={() => goRecovery(recoveryPage + 1)}>Next</button></nav> : null}</> : !intent ? <p>Connect the creator wallet after mainnet setup is ready to find a saved launch.</p> : <p>This launch is saved. Use Launch to check its current stage.</p>}
    </div>
    <div className="cdx-live-pane" data-launch-pane="saved" hidden={pane !== "saved"}>
      {intent ? <><TokenImagePreview intent={intent} /><dl className="cdx-live-review"><div><dt>Token mint</dt><dd><a href={`https://solscan.io/token/${intent.tokenMint}`} target="_blank" rel="noreferrer">{brief(intent.tokenMint)}</a></dd></div><div><dt>Quote asset</dt><dd>{selected.symbol}</dd></div><div><dt>Permanent finish</dt><dd>{getCardDesign(intent.cardTemplate).name}</dd></div></dl><p>These launch details are locked to this saved request.</p><div className="cdx-live-links">{intent.status === "complete" ? <><a href={`https://pump.fun/coin/${intent.tokenMint}`} target="_blank" rel="noreferrer">Token on pump.fun</a><a href={`https://solscan.io/account/${intent.nftMint}`} target="_blank" rel="noreferrer">Card NFT</a><a href={intent.nftMetadataUri} target="_blank" rel="noreferrer">Metadata</a></> : null}{intent.tokenSignature ? <a href={`https://solscan.io/tx/${intent.tokenSignature}`} target="_blank" rel="noreferrer">Token transaction</a> : null}{intent.nftSignature ? <a href={`https://solscan.io/tx/${intent.nftSignature}`} target="_blank" rel="noreferrer">Card transaction</a> : null}</div></> : <p>No saved launch is loaded. Complete your token details or use Recover launch.</p>}
    </div>
    <div className="cdx-live-pane" data-launch-pane="status" hidden={pane !== "status"}>
      {error ? <PagedMessage text={error} alert /> : busy ? <PagedMessage text={BUSY_COPY[busy]} /> : readiness.isPending ? <p role="status">Checking mainnet readiness…</p> : readiness.isError ? <p>Launch readiness could not be checked.</p> : !available ? <PagedMessage text={[...(readiness.data?.blockers ?? []), "No transaction or charge is requested while setup is incomplete."].join(" ")} /> : <p>Mainnet setup is ready. Each transaction still needs your wallet approval.</p>}
      <div className="cdx-live-actions"><button type="button" className="mdx-btn mdx-btn--outline" onClick={() => void readiness.refetch()}>Check readiness</button><button type="button" className="mdx-btn mdx-btn--ghost" onClick={() => setPane("launch")}>Back to launch</button></div>
    </div>
    <Modal open={reviewOpen} onOpenChange={value => { if (!busy) setReviewOpen(value); }} title={plan?.kind === "nft" ? "Review your card NFT" : "Review your token launch"} description="Review exact mainnet costs and asset identities before opening your wallet.">
      {plan && reviewIntent ? <div className="cdx-live-review-modal">
        <p className="cdx-live-review-progress">{reviewPage + 1} / {reviewPages.length} · {reviewPages[reviewPage]}</p>
        <div ref={reviewBody} tabIndex={-1} role="region" aria-label={reviewPages[reviewPage]} className="cdx-live-review-page">
        {reviewStep === -1 ? <><TokenImagePreview intent={reviewIntent} large /><p>Your complete card becomes your token image. Some wallets display a still frame.</p></> : reviewStep === 0 ? <><p><strong>Solana mainnet · real funds</strong><br />{plan.kind === "token" ? getTradingPair(draftAtPrepare.current?.symbol ?? card.ticker, reviewIntent.quoteAssetKey) : "One-of-one creator card · no NFT royalties"}</p><dl className="cdx-live-review"><div><dt>Creator / fee payer</dt><dd className="cdx-live-address">{reviewIntent.creatorWallet}</dd></div><div><dt>{plan.kind === "token" ? "New token mint" : "New NFT asset"}</dt><dd className="cdx-live-address">{plan.kind === "token" ? reviewIntent.tokenMint : reviewIntent.nftMint}</dd></div></dl></> : reviewStep === 1 ? <dl className="cdx-live-review"><div><dt>Network fee</dt><dd>{formatLiveAmount(plan.review.networkFeeLamports, 9)} SOL</dd></div><div><dt>Priority fee</dt><dd>{formatLiveAmount(plan.review.priorityFeeLamports, 9)} SOL</dd></div><div><dt>Rent / program costs</dt><dd>{formatLiveAmount(plan.review.rentAndProgramCostLamports, 9)} SOL</dd></div></dl> : reviewStep === 2 ? <dl className="cdx-live-review"><div><dt>Total SOL debit</dt><dd><strong>{formatLiveAmount(plan.review.totalDebitLamports, 9)} SOL</strong></dd></div>{typeof plan.review.walletBalanceLamports === "string" ? <div><dt>Wallet SOL available</dt><dd>{formatLiveAmount(plan.review.walletBalanceLamports, 9)} SOL</dd></div> : null}{plan.kind === "token" && plan.review.initialBuyQuoteBaseUnits !== "0" ? <><div><dt>Initial buy</dt><dd>{formatLiveAmount(plan.review.initialBuyQuoteBaseUnits, selected.decimals)} {selected.symbol}</dd></div><div><dt>Minimum tokens received</dt><dd>{formatLiveAmount(plan.review.minimumTokensOut, typeof plan.review.tokenDecimals === "number" ? plan.review.tokenDecimals : 6)}</dd></div></> : <p>No initial buy.</p>}</dl> : reviewStep === 3 ? <><p className="cdx-live-address">Quote mint · {reviewIntent.quoteMint}</p>{plan.kind === "token" ? <p>{selected.key === "sol" ? "Any SOL initial buy is included in the SOL total. " : `Any ${selected.symbol} initial buy is separate from the SOL total. `}Card NFT issuance is a separate paid transaction after token verification.</p> : <p>This issues the card for your existing token. It does not launch or buy another token.</p>}</> : <><p>Verified at slot {plan.verifiedSlot.toLocaleString()}. If preparation expires, review a fresh transaction before signing.</p><p>Opening your wallet does not approve payment. Review and approve there, or reject. Closing this review submits nothing.</p>{error ? <PagedMessage text={error} alert /> : null}<Button block disabled={reviewSeen < lastReviewPage} pending={!!busy} pendingLabel={busy === "wallet" ? "Waiting for wallet…" : busy === "submitting" ? "Submitting…" : "Checking…"} onClick={() => void approveInWallet()}>Continue to wallet review</Button></>}
        </div>
        <nav className="cdx-live-review-nav" aria-label="Transaction review pages"><button type="button" className="mdx-btn mdx-btn--outline" disabled={reviewPage === 0 || !!busy} onClick={() => goReview(reviewPage - 1)}>Previous</button><button type="button" className="mdx-btn mdx-btn--primary" disabled={reviewPage === lastReviewPage || !!busy} onClick={() => goReview(reviewPage + 1)}>Next</button></nav>
        <Button variant="ghost" block disabled={!!busy} onClick={() => setReviewOpen(false)}>Back without signing</Button>
      </div> : null}
    </Modal>
  </section>;
}
