import { useEffect, useImperativeHandle, useRef, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  abandonLiveLaunchIntent, confirmLiveCreatorNft, confirmLiveToken, getLiveLaunchIntent,
  getLiveWallet, holdLiveCard, listLiveLaunchIntents, prepareLiveCreatorNft,
  prepareLiveLaunch, reportLiveWalletChange, submitLiveTransaction,
  type LiveApprovedCard, type LiveLaunchIntent, type LivePrepareInput, type LiveResult,
} from "../../../lib/carddex/live/api";
import { composeCreatorCard } from "../../../lib/carddex/live/compose-client";
import { getCardDesign } from "../../../lib/carddex/designs";
import { getPairAsset, getTradingPair } from "../../../lib/carddex/pairs";
import type { CardData } from "../../mintdex/MintCard";
import { Button, Icon, Modal, TextLink } from "../../mintdex/ui";
import { EmptyState } from "../../mintdex/empty-state";
import { WalletConnectDialog } from "../../mintdex/wallet-connect";
import { BUY_DOES_NOT_FIT, checkLiveBuyFit, LIVE_BUY_FIT, liveBuyFitKey, STOCK_BUY_WARNS } from "./buy-fit";
import { formatLiveAmount } from "./amounts";
import { LiveTokenImage } from "./LiveTokenImage";
import { LiveWalletNotice } from "./LiveWalletNotice";
import { PagedMessage } from "./PagedMessage";
import { useLiveReadiness } from "./readiness";
import { connectLiveWallet, getLiveWalletSnapshot, signLiveTransaction, signLiveTransactions, useLiveWallet, walletSupportsSignIn } from "./wallet";
import {
  createEphemeralSigner, destroyEphemeralSigner, signingOrderFor, signsBothFor, toBase64, unsentStageNext,
  validateLivePlan, type EphemeralSigner, type ExpectedPlan, type SigningOrder, type TransactionPlan,
} from "./transaction";
import {
  CARD_APPROVAL_EXPIRED, CARD_APPROVED_READY, CARD_APPROVED_WAITING, cardNext, coinRetryable, confirmUntilSettled, dropLaunchSession, keepLaunchSession,
  keptLaunchSession, launchSettled, PAIR_SINGLE_NOTICE, PREPARED_WITHOUT_KEY, signForLaunch, signLaunchPair, SIGN_IN_COPY, STILL_CONFIRMING,
  WALLET_RETRY_NOTICE, type PairPlans,
} from "./launch-flow";
import { connectForLaunch, signInCreator } from "./ownership";
import { ONE_APPROVAL_NEXT, PAIR_REVIEW_COPY, SEPARATE_APPROVALS_NEXT, WALLET_NOTICE_COPY, WALLET_OPEN_COPY, WALLET_OPEN_PAIR_COPY, walletNoticePreview } from "./wallet-notice";

export type LiveLaunchDraft = {
  name: string; symbol: string; description: string; website: string; xUrl: string;
  cardTemplate: string; quoteAssetKey: string; quoteMint: string;
  initialBuyQuoteBaseUnits: string; artwork: Blob;
};
export type LiveLaunchHandle = { submit(): void; startAnother(): void; /** The terms checkbox, while it shows. */ terms(): HTMLInputElement | null };
/**
 * The ticket's one primary, as the page's phone action bar shows it: "submit" submits the form (the page checks the
 * fields, then calls submit() above, which picks the stage's action); "startAnother" clears a finished launch.
 * `status` is what the launch waits on, or why it stopped, for one line beside the bar's button.
 */
export type LivePrimary = { kind: "submit" | "startAnother"; label: string; pendingLabel?: string; pending: boolean; disabled: boolean; blockedByPair: boolean; status?: { text: string; alert: boolean } | null };
// coinImage: a new launch's first prepare, where the server also makes the coin's turning image. Every other prepare
// (a saved launch prepared again, the buy-fit check, the card) is "preparing" and makes no image.
type Busy = "ownership" | "artwork" | "coinImage" | "preparing" | "refreshing" | "wallet" | "submitting" | "confirming" | "recovering" | null;
const BUSY_COPY: Record<NonNullable<Busy>, string> = {
  ownership: SIGN_IN_COPY,
  artwork: "Preparing your artwork and complete card image…",
  coinImage: "Making your turning coin image and checking the quote asset, balances and exact transaction costs…",
  preparing: "Checking the current quote asset, balances and exact transaction costs…",
  refreshing: "Getting a fresh transaction so your wallet sees current costs…",
  wallet: WALLET_OPEN_COPY,
  submitting: "Submitting the transaction you approved…",
  confirming: "Waiting for finalized on-chain verification…",
  recovering: "Checking your saved launch before any new transaction…",
};
// Shown in the review, above Continue to wallet review, after the page prepared the transaction again.
const REVIEW_COSTS_UPDATED = "Costs changed since you opened this review. Check the new total, then continue to your wallet.";
const REVIEW_EXPIRED = "Your wallet approval ran out of time before it was sent, so nothing was sent or charged. This is a fresh transaction: continue to approve it once more.";
const TERMS_NEEDED = "Confirm the mainnet launch terms before continuing.";
const RECOVERY_ONLY = "New mainnet launches are not open right now. Connect the creator wallet to check a saved launch and issue its card.";
const INTENT_KEY = "carddex.live.intent.v1";
function savedIntent(wallet: string): string | null {
  try { const all = JSON.parse(localStorage.getItem(INTENT_KEY) ?? "{}"); return typeof all[wallet] === "string" ? all[wallet] : null; } catch { return null; }
}
function rememberIntent(wallet: string, id: string | null) {
  try { const all = JSON.parse(localStorage.getItem(INTENT_KEY) ?? "{}"); if (id) all[wallet] = id; else delete all[wallet]; localStorage.setItem(INTENT_KEY, JSON.stringify(all)); } catch { /* Recovery remains available through the authenticated server list. */ }
}
const NO_SAVED_LAUNCHES = "No unfinished launches for this wallet.";
function unwrap<T extends object>(result: LiveResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result;
}
const brief = (value: string) => `${value.slice(0, 5)}…${value.slice(-5)}`;

export function LiveLaunchPanel({ draft, draftKey, card, launchesOpen, notice, initialBuy = null, slippageBps = 100, ready, onInvalid, onLockedChange, onBusyChange, onTermsNeeded, onIntentLoaded, onStartAnother, onPrimary, ref }: {
  draft: LiveLaunchDraft | null; card: CardData; launchesOpen: boolean; notice?: string | null; onInvalid(): void;
  /** Changes whenever a draft field does (the page's string of them): a connect that was waiting to launch stops. */
  draftKey: string;
  /** The initial buy as typed, with its unit ("0.5 SOL"), or null for none. */
  initialBuy?: string | null;
  /** The initial buy's slippage in basis points (chosen beside the buy on the page; 1% unless changed). */
  slippageBps?: number;
  /** The page's list of what a launch still needs (name, ticker, artwork), shown above the terms. */
  ready?: ReactNode;
  onLockedChange(locked: boolean): void;
  /** True while a wallet or server step runs: the page holds its fields still (the press already captured them). */
  onBusyChange?(busy: boolean): void;
  /** True while the terms checkbox shows unchecked, so the page's Enter order stops on it before the primary. */
  onTermsNeeded?(needed: boolean): void;
  onIntentLoaded(intent: LiveLaunchIntent | null): void;
  /** After "Start another launch": the page clears the finished coin's fields. */
  onStartAnother?(): void;
  /** The page's state setter for its phone action bar; called only when the primary changes. */
  onPrimary?: Dispatch<SetStateAction<LivePrimary | null>>;
  ref?: Ref<LiveLaunchHandle>;
}) {
  const wallet = useLiveWallet();
  const readiness = useLiveReadiness();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Busy>(null), [error, setError] = useState("");
  const [terms, setTerms] = useState(false);
  // Set once a wallet action has started on this page: from then on an error is shown on the progress rows.
  const [attempted, setAttempted] = useState(false);
  const [intent, setIntent] = useState<LiveLaunchIntent | null>(null);
  const [plan, setPlan] = useState<TransactionPlan | null>(null), [reviewOpen, setReviewOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<LiveLaunchIntent[]>([]);
  const [uncertain, setUncertain] = useState(false);
  // A stage whose signed transaction the server definitely did not send: it can be prepared again with the same keys.
  const [notSent, setNotSent] = useState<"token" | "nft" | null>(null);
  // A stage whose signed transaction the server did not send for another reason (a check that could not finish):
  // the same signed bytes, held below, can be sent again without a new wallet approval.
  const [resend, setResend] = useState<"token" | "nft" | null>(null);
  const held = useRef<{ intentId: string; kind: "token" | "nft"; messageSha256: string; transactionBase64: string; walletName?: string; signingOrder?: SigningOrder } | null>(null);
  // When this page received the current plan: an older one is prepared again before the wallet opens.
  const planAt = useRef(0);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  // The review is one page that scrolls inside its dialog: back to its top, with focus, whenever it opens or its plan
  // changes (a fresh plan after the costs moved).
  const reviewBody = useRef<HTMLDivElement>(null);
  const reviewTop = () => requestAnimationFrame(() => { const body = reviewBody.current; if (!body) return; body.scrollTop = 0; body.focus({ preventScroll: true }); });
  useEffect(() => { if (reviewOpen) reviewTop(); }, [reviewOpen, plan]);
  const acceptPlan = (next: TransactionPlan) => { planAt.current = Date.now(); setPlan(next); };
  const showPlan = (next: TransactionPlan) => { acceptPlan(next); held.current = null; setNotSent(null); setResend(null); setUncertain(false); setReviewNotice(null); setReviewOpen(true); };
  // Wiring: an unfinished launch from an earlier visit to /launch in this tab (launch-flow keepLaunchSession, REL-4).
  const [kept] = useState(() => keptLaunchSession<LiveLaunchDraft>());
  const tokenKey = useRef<EphemeralSigner | null>(kept?.tokenKey ?? null), nftKey = useRef<EphemeralSigner | null>(kept?.nftKey ?? null);
  const idempotencyKey = useRef<string | null>(kept?.idempotencyKey ?? null), creator = useRef<string | null>(kept?.creator ?? null);
  const running = useRef(false), generation = useRef(0), mounted = useRef(true);
  const termsRef = useRef<HTMLInputElement>(null);
  // The wallet chooser opens from the ticket's own primary.
  const [connectOpen, setConnectOpen] = useState(false);
  const pendingIntent = useRef<LiveLaunchIntent | null>(null);
  // One approval for the coin and its card (launch-flow signLaunchPair): the card plan prepared with the coin, for a
  // wallet on the server's list (signsBothFor), then the card it approved, sent once the coin is verified. `approved`
  // holds this page's signed bytes, or the server's copy after a closed tab (getLiveLaunchIntent).
  const [pairCard, setPairCard] = useState<TransactionPlan | null>(null);
  const approved = useRef<LiveApprovedCard | null>(null), [cardApproved, setCardApproved] = useState(false);
  const keepApproved = (next: LiveApprovedCard | null) => { approved.current = next; setCardApproved(!!next); };
  const pairMode = () => signsBothFor(getLiveWalletSnapshot().name, readiness.data?.walletBatch) && !!nftKey.current;
  // Launch (or Find saved launch) pressed with no wallet connected: the wallet list opens, the chosen wallet connects
  // (and signs in within the same prompt where it has solana:signIn, ownership.ts), and the press then continues on its
  // own (connectInPanel below).
  const launchPending = useRef<"launch" | "recover" | null>(null), [continueLaunch, setContinueLaunch] = useState<"launch" | "recover" | null>(null);
  const draftAtPrepare = useRef<LiveLaunchDraft | null>(kept?.draftAtPrepare ?? null);
  const preparedInput = useRef<LivePrepareInput | null>(kept?.preparedInput ?? null);
  // New launches and recovery are separate switches: a saved launch stays reachable while new ones are off.
  const canLaunch = launchesOpen && readiness.data?.ready === true;
  const canRecover = canLaunch || readiness.data?.recoveryReady === true;
  useEffect(() => { onLockedChange(!!intent); }, [intent, onLockedChange]);
  useEffect(() => { onBusyChange?.(!!busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => { onIntentLoaded(intent); }, [intent, onIntentLoaded]);
  // D1 spark burst: once, over the visible preview card, when this visit's launch lands (a launch that was already
  // complete when it loaded never plays it: that is a page load, not a success).
  const lastStatus = useRef(intent?.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = intent?.status;
    if (intent?.status !== "complete" || !was || was === "complete") return;
    const stage = [...document.querySelectorAll(".cdx-launch-stage")].find((el) => el.getBoundingClientRect().width > 0);
    void import("../../mintdex/arcade").then((m) => m.sparkBurst(stage));
  }, [intent?.status]);
  useEffect(() => () => onLockedChange(false), [onLockedChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++;
      // Wiring: kept for the next mount instead of destroyed (a route change mid-launch); launch-flow wipes the keys
      // once the launch no longer needs them.
      keepLaunchSession({ creator: creator.current, tokenKey: tokenKey.current, nftKey: nftKey.current, idempotencyKey: idempotencyKey.current,
        preparedInput: preparedInput.current, draftAtPrepare: draftAtPrepare.current });
    };
  }, []);
  const assertCurrent = (version: number, address: string) => {
    if (!mounted.current || generation.current !== version) throw new Error("The launch view changed. Resume your saved launch to check its status.");
    const current = getLiveWalletSnapshot();
    if (current.address !== address || !current.mainnet) throw new Error("The connected wallet changed. Reconnect the creator wallet to resume safely.");
  };
  const retain = (next: LiveLaunchIntent) => {
    // The server's saved approval is adopted; one held only here (its save failed) stays until the card no longer needs it.
    if (next.approvedCard) keepApproved(next.approvedCard);
    if (approved.current && (next.nftSignature || next.status === "complete" || next.status === "abandoned" || approved.current.nftMint !== next.nftMint)) keepApproved(null);
    if (next.status === "abandoned") {
      setPairCard(null);
      rememberIntent(next.creatorWallet, null); pendingIntent.current = null;
      destroyEphemeralSigner(tokenKey.current); destroyEphemeralSigner(nftKey.current);
      tokenKey.current = null; nftKey.current = null; preparedInput.current = null; dropLaunchSession();
      idempotencyKey.current = null; creator.current = null; draftAtPrepare.current = null; held.current = null;
      if (mounted.current) { setIntent(null); setPlan(null); setUncertain(false); setNotSent(null); setResend(null); setTerms(false); }
      return;
    }
    pendingIntent.current = next;
    creator.current = next.creatorWallet;
    // A finished launch stays on this page until Start another launch, but a later visit starts from a new draft.
    rememberIntent(next.creatorWallet, next.status === "complete" ? null : next.id);
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
    // Wiring: ownership.ts signs in with one solana:signIn prompt where the wallet has it (the same SIWS text and
    // checks), else with the ownership message as before.
    await signInCreator(getLiveWalletSnapshot().name ?? "", address);
    assertCurrent(version, address);
    // The initial-buy size check answers only a signed-in creator: ask it again now.
    void queryClient.invalidateQueries({ queryKey: [LIVE_BUY_FIT] });
    assertCurrent(version, address);
  }
  async function operate(action: (address: string, version: number) => Promise<void>) {
    if (running.current) return;
    // The store, not this render's copy: a launch that continues after connecting runs before the next render.
    const current = getLiveWalletSnapshot(), address = current.address;
    if (!address) { setConnectOpen(true); return; }
    if (!current.mainnet) { setError("Switch this wallet account to Solana mainnet, then try again."); return; }
    running.current = true; setError(""); setAttempted(true);
    const version = generation.current;
    try { await action(address, version); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The launch paused. Check the saved launch before trying again."); }
    finally { running.current = false; if (mounted.current) setBusy(null); }
  }
  // Find saved launch's answer when nothing is left to resume (an alert would read as a failure).
  const [recoverNote, setRecoverNote] = useState("");
  async function recover(id?: string) {
    setRecoverNote("");
    await operate(async (address, version) => {
      setBusy("recovering"); await authenticate(address, version);
      let restored = false;
      if (id) {
        const found = unwrap(await getLiveLaunchIntent({ data: { intentId: id } })).intent;
        assertCurrent(version, address);
        if (launchSettled(found)) rememberIntent(address, null);
        else { retain(found); setPlan(null); setUncertain(false); restored = true; }
      }
      const found = unwrap(await listLiveLaunchIntents()); assertCurrent(version, address);
      setRecoverable(found.intents);
      if (!restored && !found.intents.some(i => !launchSettled(i))) setRecoverNote(NO_SAVED_LAUNCHES);
    });
  }
  // A connected wallet may already have a valid ownership session. These reads never open a signing prompt.
  useEffect(() => {
    setRecoverable([]); setRecoverNote("");
    if (!wallet.address || !canRecover) return;
    let canceled = false;
    void getLiveWallet().then(async session => {
      if (canceled || session?.wallet !== wallet.address) return;
      const response = await listLiveLaunchIntents();
      if (canceled || !response.ok) return;
      setRecoverable(response.intents);
      const saved = savedIntent(wallet.address!);
      if (saved) {
        const response = await getLiveLaunchIntent({ data: { intentId: saved } });
        if (canceled || !response.ok) return;
        // A finished or discarded launch is forgotten; the creator's new draft stays as typed.
        if (launchSettled(response.intent)) rememberIntent(wallet.address!, null);
        else { retain(response.intent); if (response.intent.chainCheck) setError(response.intent.chainCheck.reason); }
      }
    }).catch(() => undefined);
    return () => { canceled = true; };
  }, [wallet.address, canRecover]);

  async function prepareDraft() {
    // Wiring: a saved launch this tab still holds (prepared, or a coin that can be prepared again: launch-flow
    // coinRetryable) continues from its prepared input; its details and terms were accepted when it was saved.
    const continuing = () => !!(preparedInput.current && tokenKey.current && (pendingIntent.current?.status === "prepared" || coinRetryable(pendingIntent.current, true)));
    if (!continuing() && !draft) { onInvalid(); return; }
    if (!canLaunch) { setError(canRecover ? RECOVERY_ONLY : "Mainnet launch setup must be ready before a transaction can be prepared."); return; }
    if (!continuing() && !terms) { setError(TERMS_NEEDED); termsRef.current?.focus(); return; }
    if (!getLiveWalletSnapshot().address) { launchPending.current = "launch"; setConnectOpen(true); return; }
    await operate(async (address, version) => {
      if (continuing() && preparedInput.current && tokenKey.current) {
        await authenticate(address, version); setBusy("preparing");
        const response = unwrap(await prepareLiveLaunch({ data: { ...preparedInput.current, withCard: pairMode() } }));
        assertCurrent(version, address); retain(response.intent);
        const prepared = acceptPrepared(response);
        if (prepared) { showPlan(prepared.coin); setPairCard(prepared.card); }
        return;
      }
      const saved = savedIntent(address);
      if (saved && saved !== intent?.id) {
        setBusy("recovering"); await authenticate(address, version);
        const previous = unwrap(await getLiveLaunchIntent({ data: { intentId: saved } })).intent;
        assertCurrent(version, address);
        // Only an unfinished launch is restored; a finished or discarded one is forgotten and this draft goes on.
        if (launchSettled(previous)) rememberIntent(address, null);
        else {
          retain(previous);
          setError("Your saved launch was restored. Finish or verify it before starting another coin.");
          return;
        }
      }
      if (pendingIntent.current && pendingIntent.current.status !== "complete" && !tokenKey.current) {
        setError("This saved launch needs recovery. Check its existing coin before preparing anything new."); return;
      }
      if (creator.current && creator.current !== address) throw new Error("Reconnect the wallet that owns this prepared launch.");
      if (!draft) { onInvalid(); return; }
      await authenticate(address, version);
      if (draft.initialBuyQuoteBaseUnits !== "0") {
        // Nothing is uploaded for a buy that cannot fit the one coin transaction.
        setBusy("preparing");
        const size = unwrap(await checkLiveBuyFit(draft.name, draft.symbol, draft.quoteAssetKey, draft.initialBuyQuoteBaseUnits));
        assertCurrent(version, address);
        queryClient.setQueryData(liveBuyFitKey(draft.name, draft.symbol, draft.quoteAssetKey), size);
        // buyBlocked: a tokenized-stock quote, whose first buy the server refuses (wallets warn on issuer-controlled tokens).
        if (!size.fits) throw new Error(size.buyBlocked ? STOCK_BUY_WARNS : size.createFits ? BUY_DOES_NOT_FIT : "This coin's name and symbol don't fit in one transaction. Use a shorter name or symbol.");
      }
      if (!tokenKey.current) tokenKey.current = createEphemeralSigner();
      if (!nftKey.current) nftKey.current = createEphemeralSigner();
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      creator.current = address; draftAtPrepare.current = draft;
      setBusy("artwork");
      const assets = await composeCreatorCard({ card, tokenMint: tokenKey.current.address, artwork: draft.artwork, website: draft.website, xUrl: draft.xUrl });
      assertCurrent(version, address); setBusy("coinImage");
      const input: LivePrepareInput = {
        idempotencyKey: idempotencyKey.current, tokenMint: tokenKey.current.address, nftMint: nftKey.current.address,
        name: draft.name, symbol: draft.symbol, description: draft.description, website: draft.website, xUrl: draft.xUrl, cardTemplate: draft.cardTemplate,
        quoteAssetKey: draft.quoteAssetKey, quoteMint: draft.quoteMint, initialBuyQuoteBaseUnits: draft.initialBuyQuoteBaseUnits,
        slippageBps, assets, termsAcknowledged: true,
      };
      preparedInput.current = input;
      // withCard: a wallet that approves the coin and its card in one prompt gets the card plan now too.
      const response = unwrap(await prepareLiveLaunch({ data: { ...input, withCard: pairMode() } }));
      assertCurrent(version, address); retain(response.intent);
      const prepared = acceptPrepared(response);
      if (prepared) { showPlan(prepared.coin); setPairCard(prepared.card); }
    });
  }
  /** The prepared coin plan, and the card plan prepared with it (withCard), each validated before any wallet prompt. */
  function acceptPrepared(response: { intent: LiveLaunchIntent; transaction: unknown; card?: unknown }): PairPlans | null {
    if (!response.transaction) return null;
    const coin = response.transaction as TransactionPlan, card = response.card ? response.card as TransactionPlan : null;
    validateLivePlan(coin, expectedFor(response.intent, "token"));
    if (card) validateLivePlan(card, expectedFor(response.intent, "nft"));
    return { coin, card };
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
      await authenticate(address, version); await prepareCard(address, version);
    });
  }
  /** Prepares the card's own transaction and opens its review; the plan shown, or null when the card needs none. */
  async function prepareCard(address: string, version: number): Promise<TransactionPlan | null> {
    const current = pendingIntent.current;
    if (!current || current.status !== "nft_pending") return null;
    setBusy("preparing");
    if (!nftKey.current) nftKey.current = createEphemeralSigner();
    const response = unwrap(await prepareLiveCreatorNft({ data: { intentId: current.id, nftMint: nftKey.current.address } }));
    assertCurrent(version, address); retain(response.intent);
    if (!response.transaction) return null;
    const next = response.transaction as TransactionPlan;
    validateLivePlan(next, expectedFor(response.intent, "nft"));
    showPlan(next);
    return next;
  }
  /**
   * After the coin is verified in this session (or on resume): the card the wallet approved with it is sent with no
   * prompt, else the card's own review is prepared and opened (its wallet prompt follows the creator's Continue).
   * Wiring for launch-flow cardNext.
   */
  async function continueWithCard(address: string, version: number) {
    const stage = pendingIntent.current, card = approved.current;
    if (!stage) return;
    const next = cardNext(stage, card);
    if (next === "send-approved" && card) {
      held.current = { intentId: stage.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: card.transactionBase64, walletName: getLiveWalletSnapshot().name?.slice(0, 64) };
      await submitHeld(stage, address, version, CARD_APPROVAL_EXPIRED);
    } else if (next === "prepare") await prepareCard(address, version);
  }
  async function confirmCurrent(kind: "token" | "nft", signature: string, address: string, version: number, messageSha256?: string) {
    const current = pendingIntent.current;
    if (!current) return;
    setBusy("confirming");
    // Wiring: launch-flow.ts confirmUntilSettled polls for about 90 seconds; each check also sends the saved bytes
    // again on the server while they can still land.
    // Expired unlanded or failed on Solana: the saved launch, read once more, says why and offers Prepare again or Discard.
    const reread = async (fallback: string) => {
      const found = await getLiveLaunchIntent({ data: { intentId: current.id } }).catch(() => null);
      assertCurrent(version, address); setUncertain(false);
      if (found?.ok) retain(found.intent);
      return new Error(found?.ok && found.intent.chainCheck ? found.intent.chainCheck.reason : fallback);
    };
    let settled: Awaited<ReturnType<typeof confirmUntilSettled>>;
    try {
      settled = await confirmUntilSettled({ check: async () => {
        assertCurrent(version, address);
        const data = { intentId: current.id, signature, messageSha256 };
        const response = unwrap(await (kind === "token" ? confirmLiveToken({ data }) : confirmLiveCreatorNft({ data })));
        assertCurrent(version, address); retain(response.intent);
        const done = kind === "token" ? response.intent.status === "nft_pending" || response.intent.status === "complete" : response.intent.status === "complete";
        if (done) { held.current = null; setUncertain(false); setPlan(null); }
        return { done, delivery: "delivery" in response ? response.delivery : undefined };
      } });
    } catch (error) { throw await reread(error instanceof Error ? error.message : "The launch paused. Check this saved launch again."); }
    if (settled === "expired") throw await reread("Your transaction expired before it landed, so nothing was charged. Check this saved launch again.");
    if (settled === "pending") setError(STILL_CONFIRMING);
  }
  /**
   * The same stage prepared again with the same keys and saved draft: a new plan row and blockhash, nothing else.
   * Null when the stage no longer needs this transaction (the server already has its result).
   */
  async function refreshPlan(current: LiveLaunchIntent, kind: "token" | "nft", address: string, version: number): Promise<TransactionPlan | null> {
    const input = preparedInput.current, cardKey = nftKey.current;
    if (kind === "token" ? !input : !cardKey) throw new Error("This page no longer holds this launch's details. Resume the saved launch to recover safely.");
    setBusy("refreshing");
    const response = unwrap(await (kind === "token" ? prepareLiveLaunch({ data: input! }) : prepareLiveCreatorNft({ data: { intentId: current.id, nftMint: cardKey!.address } })));
    assertCurrent(version, address); retain(response.intent);
    if (!response.transaction) return null;
    const next = response.transaction as TransactionPlan;
    validateLivePlan(next, expectedFor(response.intent, kind));
    return next;
  }
  /** The coin and its card prepared again together (same keys); null when the coin stage no longer needs a transaction. */
  async function refreshPair(address: string, version: number): Promise<PairPlans | null> {
    const input = preparedInput.current;
    if (!input) throw new Error("This page no longer holds this launch's details. Resume the saved launch to recover safely.");
    setBusy("refreshing");
    const response = unwrap(await prepareLiveLaunch({ data: { ...input, withCard: true } }));
    assertCurrent(version, address); retain(response.intent);
    return acceptPrepared(response);
  }
  async function approveInWallet() {
    const current = pendingIntent.current, reviewed = plan;
    if (!current || !reviewed) return;
    await operate(async (address, version) => {
      if (current.creatorWallet !== address) throw new Error("Reconnect the creator wallet before signing.");
      await authenticate(address, version);
      const key = reviewed.kind === "token" ? tokenKey.current : nftKey.current;
      if (!key) throw new Error("This page no longer holds the new asset key. Resume the saved launch to recover safely.");
      const walletName = getLiveWalletSnapshot().name ?? undefined;
      const order = signingOrderFor(walletName, readiness.data?.walletFirst);
      setReviewNotice(null);
      const report = (changed: TransactionPlan, returned: Uint8Array) => void reportLiveWalletChange({ data: { intentId: current.id, kind: changed.kind, messageSha256: changed.messageSha256, walletName: (walletName ?? "unknown").slice(0, 64), transactionBase64: toBase64(returned) } }).catch(() => undefined);
      let coinPlan = reviewed, coinAt = planAt.current;
      // Wiring only; the step is launch-flow.ts signLaunchPair. One prompt signs the coin and its card; the card's signed
      // bytes are saved on the server before the coin is sent and relayed once the coin is verified. "single" (the
      // wallet did not sign both at once) continues with the coin alone below, and the card follows with its own prompt.
      if (reviewed.kind === "token" && pairCard && nftKey.current && signsBothFor(walletName, readiness.data?.walletBatch)) {
        const pair = await signLaunchPair({ plans: { coin: reviewed, card: pairCard }, receivedAt: planAt.current, order,
          expected: { coin: expectedFor(current, "token"), card: expectedFor(current, "nft") }, signers: { coin: key, card: nftKey.current },
          refresh: () => refreshPair(address, version),
          onPlans: next => { acceptPlan(next.coin); setPairCard(next.card); },
          onWalletOpen: retry => { if (retry) setReviewNotice(WALLET_RETRY_NOTICE); setBusy("wallet"); },
          onWalletChanged: report,
          walletSignAll: async transactions => { const out = await signLiveTransactions(transactions, address); assertCurrent(version, address); return out; } });
        assertCurrent(version, address);
        if (pair.status === "gone") { setReviewOpen(false); setPlan(null); setPairCard(null); return; }
        if (pair.status === "changed") { setReviewNotice(REVIEW_COSTS_UPDATED); reviewTop(); return; }
        if (pair.status === "signed") {
          const stage = pendingIntent.current ?? current;
          setReviewOpen(false); setPairCard(null);
          const card: LiveApprovedCard = { messageSha256: pair.card.messageSha256, transactionBase64: toBase64(pair.cardSigned), nftMint: stage.nftMint };
          keepApproved(card);
          // Saved before the coin is sent, so a closed tab can still send this card once the coin is verified. A save
          // that fails keeps it in this page only.
          await holdLiveCard({ data: { intentId: stage.id, messageSha256: card.messageSha256, transactionBase64: card.transactionBase64,
            ...(walletName ? { walletName: walletName.slice(0, 64) } : {}), signingOrder: pair.order } }).catch(() => undefined);
          assertCurrent(version, address);
          held.current = { intentId: stage.id, kind: "token", messageSha256: pair.coin.messageSha256, transactionBase64: toBase64(pair.coinSigned), walletName: walletName?.slice(0, 64), signingOrder: pair.order };
          await submitHeld(stage, address, version);
          await continueWithCard(address, version);
          return;
        }
        setPairCard(null); coinPlan = pair.coin; coinAt = pair.receivedAt;
        if (pair.prompted) setReviewNotice(PAIR_SINGLE_NOTICE);
      } else if (pairCard) setPairCard(null);
      // Wiring only; the step itself is launch-flow.ts signForLaunch. A plan older than about 30 seconds is prepared
      // again first (the review shows again only when a reviewed cost moved beyond the priority fee). Wallet first
      // (Phantom's order): the wallet signs, then this page co-signs what it returned, within the shared wallet rule.
      // A message outside that rule is never co-signed; its summary goes to the server log, and the wallet opens once
      // more in the page-first order.
      const step = await signForLaunch({ plan: coinPlan, receivedAt: coinAt, expected: expectedFor(current, reviewed.kind), signer: key, order,
        refresh: () => refreshPlan(current, reviewed.kind, address, version),
        onPlan: next => acceptPlan(next),
        onWalletOpen: retry => { if (retry) setReviewNotice(WALLET_RETRY_NOTICE); setBusy("wallet"); },
        onWalletChanged: report,
        walletSign: async transaction => { const out = await signLiveTransaction(transaction, address); assertCurrent(version, address); return out; } });
      assertCurrent(version, address);
      if (step.status === "gone") { setReviewOpen(false); setPlan(null); return; }
      if (step.status === "changed") { setReviewNotice(REVIEW_COSTS_UPDATED); reviewTop(); return; }
      const active = step.plan, stage = pendingIntent.current ?? current;
      setReviewOpen(false);
      held.current = { intentId: stage.id, kind: active.kind, messageSha256: active.messageSha256, transactionBase64: toBase64(step.signed), walletName: walletName?.slice(0, 64), signingOrder: step.order };
      await submitHeld(stage, address, version);
      // A verified coin moves straight on to its card (an approved card is sent; otherwise its review opens).
      if (active.kind === "token") await continueWithCard(address, version);
    });
  }
  /** `expiredNotice`: the review's line when these bytes ran out of time and their stage is prepared again. */
  async function submitHeld(current: LiveLaunchIntent, address: string, version: number, expiredNotice = REVIEW_EXPIRED) {
    const signed = held.current;
    if (!signed || signed.intentId !== current.id) return;
    // From this point the outcome may be uncertain after a network interruption. Recover before rebuilding.
    setBusy("submitting"); setResend(null); setUncertain(true);
    const result = await submitLiveTransaction({ data: { intentId: signed.intentId, kind: signed.kind, messageSha256: signed.messageSha256, transactionBase64: signed.transactionBase64,
      ...(signed.walletName ? { walletName: signed.walletName } : {}), ...(signed.signingOrder ? { signingOrder: signed.signingOrder } : {}) } });
    if (!result.ok) {
      // The server did not broadcast it. Read the stage back: prepare an unsendable stage again, keep the same signed
      // bytes for another send after any other refusal, and recover a saved signature instead of polling this one.
      const found = await getLiveLaunchIntent({ data: { intentId: signed.intentId } }).catch(() => null);
      assertCurrent(version, address);
      if (found?.ok) {
        retain(found.intent);
        const next = unsentStageNext(found.intent, signed.kind, result.unsendable === true);
        if (next) setUncertain(false);
        if (next === "prepare") {
          held.current = null; setPlan(null); setNotSent(signed.kind);
          // These card bytes will never be sent: the card is prepared again on its own.
          if (signed.kind === "nft") keepApproved(null);
          // An approval that only ran out of time: prepare the same stage again and ask once more, not an error. A
          // wallet that signs the coin and its card together is asked for both again.
          if (result.expired) {
            const shown = signed.kind === "nft" ? await prepareCard(address, version).catch(() => null)
              : pairMode() ? await refreshPair(address, version).then(pair => { if (pair) { showPlan(pair.coin); setPairCard(pair.card); } return pair; }).catch(() => null)
                : await refreshPlan(found.intent, signed.kind, address, version).then(fresh => { if (fresh) showPlan(fresh); return fresh; }).catch(() => null);
            if (shown) { setReviewNotice(expiredNotice); return; }
          }
        }
        else if (next === "resend") setResend(signed.kind);
      }
      throw new Error(result.error);
    }
    held.current = null;
    assertCurrent(version, address); retain(result.intent);
    await confirmCurrent(signed.kind, result.signature, address, version, signed.messageSha256);
  }
  async function sendAgain() {
    const current = pendingIntent.current;
    if (!current || held.current?.intentId !== current.id) return;
    await operate(async (address, version) => {
      if (current.creatorWallet !== address) throw new Error("Reconnect the creator wallet before sending.");
      await authenticate(address, version);
      await submitHeld(current, address, version);
    });
  }
  async function checkConfirmation() {
    const current = pendingIntent.current;
    if (!current) return;
    await operate(async (address, version) => {
      await authenticate(address, version); setBusy("recovering");
      const found = unwrap(await getLiveLaunchIntent({ data: { intentId: current.id } })).intent;
      assertCurrent(version, address); retain(found);
      // Wiring: a check that found a failed, expired or unreachable transaction says so (the saved launch's chain check).
      if (found.chainCheck) { setUncertain(false); setError(found.chainCheck.reason); return; }
      const kind = found.status === "token_pending" ? "token" : found.status === "nft_pending" && found.nftSignature ? "nft" : null;
      const signature = kind === "token" ? found.tokenSignature : kind === "nft" ? found.nftSignature : null;
      if (kind && signature) {
        await confirmCurrent(kind, signature, address, version);
        if (kind === "token") await continueWithCard(address, version);
      } else {
        // Nothing is saved for this stage, so the server never sent it: signed bytes this page holds can go again.
        setUncertain(false);
        const signed = held.current;
        if (signed?.intentId === found.id && unsentStageNext(found, signed.kind, false) === "resend") setResend(signed.kind);
        else if (found.status === "prepared" && !tokenKey.current) setError(PREPARED_WITHOUT_KEY);
      }
    });
  }
  /** Resume: sends the card the wallet approved with its coin (saved on the server), with no wallet prompt. */
  async function sendApprovedCard() {
    const current = pendingIntent.current;
    if (!current || cardNext(current, approved.current) !== "send-approved") return;
    await operate(async (address, version) => {
      if (current.creatorWallet !== address) throw new Error("Connect the creator wallet to send this card.");
      await authenticate(address, version);
      await continueWithCard(address, version);
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
  const startAnother = () => { if (intent?.status !== "complete") return; rememberIntent(intent.creatorWallet, null); pendingIntent.current = null; setIntent(null); setPlan(null); setPairCard(null); keepApproved(null); preparedInput.current = null; draftAtPrepare.current = null; idempotencyKey.current = null; creator.current = null; setTerms(false); setError(""); setAttempted(false); onStartAnother?.(); };
  // Find saved launch without a wallet opens the chooser and carries on after the connect, as a launch press does.
  const findSaved = () => { if (!wallet.address) { launchPending.current = "recover"; setConnectOpen(true); return; } void recover(savedIntent(wallet.address) ?? undefined); };
  // A prepared launch whose new coin key this browser no longer holds (PREPARED_WITHOUT_KEY): it can never be signed
  // here, so its one way on is to discard it once it expires; that is the primary.
  const unsignable = intent?.status === "prepared" && !tokenKey.current && !uncertain && !resend;
  useImperativeHandle(ref, () => ({ startAnother, terms: () => termsRef.current, submit: () => { if (resend) void sendAgain(); else if (intent?.status === "nft_pending" && cardApproved && !intent.nftSignature) void sendApprovedCard(); else if (intent?.status === "nft_pending") void prepareNft(); else if (coinRetryable(intent, !!tokenKey.current && !!preparedInput.current)) void prepareDraft(); else if (unsignable) void discardExpiredDraft(); else if (intent?.status === "token_pending" || uncertain || intent?.status === "prepared" && !tokenKey.current) void checkConfirmation(); else if (!intent && !canLaunch && canRecover) findSaved(); else if (intent?.status !== "complete") void prepareDraft(); } }));
  const selected = intent ? getPairAsset(intent.quoteAssetKey) : getPairAsset(card.quoteAssetKey);
  const currentTitle = intent?.status === "complete" ? "Your coin and card are on mainnet" : intent?.status === "nft_pending" ? "Coin verified. Your card is next." : intent?.status === "token_pending" ? "Coin transaction submitted" : "Create through your wallet";
  const reviewIntent = intent;
  const recoveryItems = recoverable.filter(i => !launchSettled(i));
  const savedListShown = canRecover && !intent && (canLaunch || recoveryItems.length > 0);
  const siteHost = readiness.data?.publicOrigin ? new URL(readiness.data.publicOrigin).host : undefined;
  // The connected wallet signs the coin and its card in one prompt (pairMode once the keys exist): the ticket says so.
  const oneApproval = !!wallet.address && signsBothFor(wallet.name, readiness.data?.walletBatch);

  // ------------------------------------------------ the progress view: two transactions, each one stage
  const status = intent?.status;
  const coinDone = status === "nft_pending" || status === "complete";
  const coinStage: Stage = coinDone ? { state: "done", text: "Confirmed on Solana" }
    : busy ? { state: "active", text: PHASE[busy] }
      : error && status ? { state: "stopped", text: "Stopped. Nothing more is sent until you choose what to do." }
        : status === "token_pending" ? { state: "active", text: "Sent. Check its confirmation." }
          : status === "prepared" ? { state: "active", text: reviewOpen ? "Waiting for your review" : "Prepared, not sent" }
            : error ? { state: "stopped", text: "Stopped before anything was sent." }
              : { state: "todo", text: "Not started" };
  const cardStage: Stage = status === "complete" ? { state: "done", text: "Confirmed on Solana" }
    : status !== "nft_pending" ? { state: "todo", text: cardApproved ? CARD_APPROVED_WAITING : "Starts after the coin is confirmed" }
      : busy ? { state: "active", text: PHASE[busy] }
        : error ? { state: "stopped", text: "Stopped. Nothing more is sent until you choose what to do." }
          : intent?.nftSignature ? { state: "active", text: "Sent. Check its confirmation." }
            : { state: "active", text: cardApproved ? CARD_APPROVED_READY : "Ready to issue" };
  const showFresh = !intent && canLaunch;
  useEffect(() => { onTermsNeeded?.(showFresh && !terms); }, [showFresh, terms, onTermsNeeded]);
  useEffect(() => () => onTermsNeeded?.(false), [onTermsNeeded]);
  // The progress rows show from the first press on: sign-in, the artwork upload and the preparing all run before a
  // saved launch exists.
  const showProgress = !!(busy || intent || error && attempted);

  // ------------------------------------------------ the one primary (inline from 1024px, in the page's action bar below)
  const primary: LivePrimary = intent?.status === "complete" ? { kind: "startAnother", label: "Start another launch", pending: false, disabled: false, blockedByPair: false }
    : resend ? { kind: "submit", label: "Send again", pending: !!busy, disabled: !canRecover, blockedByPair: false }
      : intent?.status === "nft_pending" && cardApproved && !intent.nftSignature ? { kind: "submit", label: "Send your approved card", pending: !!busy, disabled: !canRecover, blockedByPair: false }
        : intent?.status === "nft_pending" ? { kind: "submit", label: notSent === "nft" ? "Prepare again" : "Review card issuance", pending: !!busy, disabled: !canRecover, blockedByPair: false }
          : coinRetryable(intent, !!tokenKey.current && !!preparedInput.current) ? { kind: "submit", label: "Prepare again", pending: !!busy, disabled: !canLaunch, blockedByPair: false }
            : unsignable ? { kind: "submit", label: "Discard unused draft", pending: !!busy, disabled: !canRecover, blockedByPair: false }
            : intent?.status === "token_pending" || uncertain || intent?.status === "prepared" && !tokenKey.current ? { kind: "submit", label: "Check confirmation", pending: !!busy, disabled: !canRecover, blockedByPair: false }
              : !intent && !canLaunch && canRecover ? { kind: "submit", label: "Find saved launch", pending: !!busy, disabled: false, blockedByPair: false }
                : { kind: "submit", label: !wallet.address ? "Connect wallet to launch" : notSent === "token" ? "Prepare again" : "Review mainnet launch", pendingLabel: "Preparing…", pending: !!busy, disabled: !canLaunch, blockedByPair: false };
  // What the bar says beside its button: the step it waits on, or why the launch stopped (the panel's alert below
  // the primary announces it; the bar's line is for the eye).
  const statusText = busy ? PHASE[busy] : error || "";
  const statusAlert = !busy && !!error;
  primary.status = statusText ? { text: statusText, alert: statusAlert } : null;
  // Reported by value, so the page's bar re-renders only when the primary itself changes.
  useEffect(() => {
    onPrimary?.(prev => prev && prev.kind === primary.kind && prev.label === primary.label && prev.pendingLabel === primary.pendingLabel && prev.pending === primary.pending && prev.disabled === primary.disabled && prev.blockedByPair === primary.blockedByPair && (prev.status?.text ?? "") === statusText && !!prev.status?.alert === statusAlert ? prev : primary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPrimary, primary.kind, primary.label, primary.pendingLabel, primary.pending, primary.disabled, primary.blockedByPair, statusText, statusAlert]);
  useEffect(() => () => onPrimary?.(null), [onPrimary]);

  // ------------------------------------------------ connect, then carry on with the press that asked for it
  // Wiring: the wallet list's connect while a press is pending is ownership.ts connectForLaunch (connect and sign-in in
  // one prompt where the wallet has solana:signIn). The press continues only once that sign-in is verified, so its own
  // authenticate() finds the session and opens no second prompt. A refused sign-in leaves the press pending, so another
  // wallet in the same list still continues it; closing the list clears it.
  const connectInPanel = async (walletName: string) => {
    const pending = launchPending.current;
    if (!signsInOnConnect()) return connectLiveWallet(walletName);
    await connectForLaunch(walletName);
    launchPending.current = null; setContinueLaunch(pending);
  };
  const signsInOnConnect = () => { const pending = launchPending.current; return pending === "launch" ? canLaunch : pending === "recover" && canRecover; };
  // The wallet list's words while that connect is also the sign-in prompt (one solana:signIn prompt, ownership.ts).
  const connectCopy = (walletName: string) => signsInOnConnect() && walletSupportsSignIn(walletName) ? SIGN_IN_COPY : null;
  const connectChange = (open: boolean) => { setConnectOpen(open); if (!open) launchPending.current = null; };
  // The press goes on through operate(), which reads the wallet store and stops on another network with its own line.
  useEffect(() => {
    if (!continueLaunch || !wallet.address) return;
    const next = continueLaunch; setContinueLaunch(null);
    if (next === "recover") void recover(savedIntent(wallet.address) ?? undefined);
    else void prepareDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueLaunch, wallet.address]);
  // A draft edited while the chooser was open is a new decision: it waits for another press.
  useEffect(() => { launchPending.current = null; }, [draftKey]);

  // What the launch waits on, or why it stopped, lands under the inline primary; near the screen's bottom edge it comes
  // fully into view (nearest: no move when it already shows). Phones show it in the action bar instead, where the
  // inline primary is hidden.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!(error || busy) || reviewOpen) return;
    const panel = panelRef.current;
    const inline = panel?.querySelector<HTMLElement>(".cdx-live-primary");
    const line = panel?.querySelector<HTMLElement>(":scope > .cdx-paged-message");
    if (inline?.getClientRects().length && line) requestAnimationFrame(() => line.scrollIntoView({ block: "nearest" }));
  }, [error, busy, reviewOpen]);

  return <section ref={panelRef} className="cdx-live-panel" aria-label="Mainnet wallet launch">
    {/* Setup first: while mainnet is not ready, nothing below can be asked for. */}
    {!canRecover ? <div className="cdx-live-callout">
      {readiness.isPending ? <p role="status">Checking mainnet readiness…</p> : readiness.isError ? <p>Launch readiness could not be checked. Check again in a moment.</p> : <PagedMessage text={[...(readiness.data?.blockers ?? []), "No transaction or charge is requested while setup is incomplete."].join(" ")} />}
      <Button variant="outline" size="sm" onClick={() => void readiness.refetch()}>Check readiness</Button>
    </div> : null}
    {!intent && !canLaunch && canRecover ? <p className="cdx-live-callout" role="status">{RECOVERY_ONLY}</p> : null}

    {showFresh ? <section className="cdx-live-block" aria-labelledby="cdx-live-cost">
      <div className="cdx-launch-ticket__head">
        <h2 id="cdx-live-cost" className="cdx-launch-section">Cost</h2>
        <span className="cdx-live-net">Solana mainnet</span>
      </div>
      {/* The network costs are exact only once the transaction is built; the review shows them before the wallet. */}
      <dl className="cdx-launch-cost">
        <div><dt>Network fees and rent for new accounts</dt><dd className="cdx-live-later">Exact amounts before your wallet opens</dd></div>
        <div><dt>Initial buy</dt><dd>{initialBuy ? <span className="num">{initialBuy}</span> : "None"}</dd></div>
        <div data-total><dt>Total</dt><dd className="cdx-live-later">Shown before your wallet opens</dd></div>
      </dl>
      <p className="cdx-launch-fee-note">Launch a Card charges no platform fee. You pay Solana network and priority fees, account rent for the new accounts, the Metaplex NFT fee for the card, and pump.fun's protocol and creator fees inside any initial buy.</p>
    </section> : null}

    {showFresh ? <section className="cdx-live-block cdx-live-terms" aria-label="Terms">
      {ready}
      <p>Coin creation and card issuance are two paid mainnet transactions. Exact costs appear before your wallet asks for approval. Your selected quote funds only the optional initial buy.</p>
      <label className="cdx-live-check"><input ref={termsRef} type="checkbox" checked={terms} onChange={e => { setTerms(e.target.checked); if (e.target.checked && error === TERMS_NEEDED) setError(""); }} /><span>I have the rights to this artwork and accept paid mainnet transactions.</span></label>
    </section> : null}

    {intent ? <h2 className="cdx-launch-section cdx-live-title">{currentTitle}</h2> : null}

    {/* The one primary: inline from 1024px; below that the page's action bar carries it (launch.css hides this one). */}
    <div className="cdx-live-actions">
      {primary.kind === "startAnother"
        ? <Button variant="outline" block className="cdx-live-primary" data-launch-primary="" onClick={startAnother}>{primary.label}</Button>
        : <Button type="submit" block className="cdx-live-primary" data-launch-primary="" pending={primary.pending} pendingLabel={primary.pendingLabel} disabled={primary.disabled} onBlocked={primary.blockedByPair ? onInvalid : undefined}>{primary.label}</Button>}
      {intent?.status === "nft_pending" && (intent.nftSignature || uncertain) ? <Button variant="outline" block pending={!!busy} disabled={!canRecover} onClick={() => void checkConfirmation()}>Check card confirmation</Button> : null}
    </div>
    {/* What the launch waits on, or why it stopped, right under the primary (the stage rows below say which step). */}
    {busy ? <PagedMessage text={busy === "wallet" && pairCard ? WALLET_OPEN_PAIR_COPY : BUSY_COPY[busy]} /> : null}
    {error ? <PagedMessage text={error} alert /> : null}
    {recoverNote && !savedListShown ? <p className="cdx-live-meta" role="status">{recoverNote}</p> : null}
    {wallet.address ? <p className="cdx-live-wallet-line">Creator wallet · <span className="cdx-live-address">{brief(wallet.address)}</span>{!wallet.mainnet ? " · Switch to mainnet" : ""}</p> : null}

    {showProgress ? <section className="cdx-live-block" aria-labelledby="cdx-live-progress">
      <h3 id="cdx-live-progress" className={intent ? "sr-only" : "cdx-live-subhead"}>Progress</h3>
      <ol className="cdx-live-stages">
        <StageRow n={1} title="Coin on pump.fun" stage={coinStage}>
          {coinDone && intent ? <TextLink href={`https://pump.fun/coin/${intent.tokenMint}`} target="_blank">pump.fun<Icon name="external" size={12} /></TextLink> : null}
          {intent?.tokenSignature ? <TextLink href={`https://solscan.io/tx/${intent.tokenSignature}`} target="_blank">Coin transaction<Icon name="external" size={12} /></TextLink> : null}
        </StageRow>
        <StageRow n={2} title="Your card NFT" stage={cardStage}>
          {status === "complete" && intent ? <><TextLink href={`https://solscan.io/account/${intent.nftMint}`} target="_blank">Card on Solscan<Icon name="external" size={12} /></TextLink><TextLink href={intent.nftMetadataUri} target="_blank">Metadata<Icon name="external" size={12} /></TextLink></> : null}
          {intent?.nftSignature ? <TextLink href={`https://solscan.io/tx/${intent.nftSignature}`} target="_blank">Card transaction<Icon name="external" size={12} /></TextLink> : null}
        </StageRow>
      </ol>
      {intent?.status === "nft_pending" && !busy && !error ? <p>The coin is verified. Issue its separate one-of-one card to the same creator wallet.</p> : null}
    </section> : showFresh ? <p className="cdx-live-next">{oneApproval ? ONE_APPROVAL_NEXT : SEPARATE_APPROVALS_NEXT}</p> : null}
    {/* The page's initial-buy notice, unless the alert above already says the same words. */}
    {notice && !intent && notice !== error ? <p role="status">{notice}</p> : null}

    {/* What the coin's wallet prompt will carry, before anything is prepared (the review shows the exact list). */}
    {showFresh ? <section className="cdx-live-wallet-notice" aria-labelledby="cdx-live-notice">
      <h3 id="cdx-live-notice" className="cdx-live-wallet-notice-title">{oneApproval ? "What your wallet will show for your coin and card" : "What your wallet will show for your coin"}</h3>
      <ul className="cdx-live-wallet-notice-list">{walletNoticePreview({ hasBuy: !!initialBuy, siteHost, oneApproval }).map(item => <li key={item.key} data-notice={item.key}>{item.text}</li>)}</ul>
      <p className="cdx-live-wallet-notice-safety">{WALLET_NOTICE_COPY.safety} <TextLink to="/how" hash="wallet">Details</TextLink></p>
    </section> : null}

    {intent ? <section className="cdx-live-block" aria-labelledby="cdx-live-saved">
      <h3 id="cdx-live-saved" className="cdx-live-subhead">Saved launch</h3>
      <LiveTokenImage intent={intent} compact />
      <dl className="cdx-launch-cost cdx-live-review">
        <div><dt>Coin mint</dt><dd><TextLink href={`https://solscan.io/token/${intent.tokenMint}`} target="_blank"><span className="cdx-live-address">{brief(intent.tokenMint)}</span><Icon name="external" size={12} /></TextLink></dd></div>
        <div><dt>Quote asset</dt><dd>{selected.symbol}</dd></div>
        <div><dt>Initial buy</dt><dd>{intent.initialBuyQuoteBaseUnits === "0" ? "None" : <><span className="num">{formatLiveAmount(intent.initialBuyQuoteBaseUnits, selected.decimals)}</span> <span className="mdx-unit">{selected.symbol}</span></>}</dd></div>
        <div><dt>Card design</dt><dd>{getCardDesign(intent.cardTemplate).name}</dd></div>
      </dl>
      <p className="cdx-live-meta">These launch details are locked to this saved request. Reference {intent.id.slice(0, 8)}.</p>
      {/* A launch this browser cannot sign any more says why; its primary is the discard, so no second control. */}
      {intent.status === "prepared" || intent.status === "token_pending" ? <div className="cdx-live-discard">
        {unsignable ? <p>{PREPARED_WITHOUT_KEY}</p> : <>
          <p>An unused launch can be discarded only after every prepared transaction expires and the server verifies no coin exists.</p>
          <button type="button" className="mdx-link mdx-hit" disabled={!!busy} onClick={() => void discardExpiredDraft()}>Discard expired unused draft</button>
        </>}
      </div> : null}
    </section> : null}

    {/* Saved launches, in the page (no disclosure): find or resume one for the connected wallet. While new launches
        are off, the primary (Find saved launch) and the callout above already ask for this, so only a found list shows. */}
    {savedListShown ? <section className="cdx-live-block cdx-live-saved" aria-labelledby="cdx-live-saved-list">
      <h3 id="cdx-live-saved-list" className="cdx-live-subhead">Saved launches</h3>
      {wallet.address ? <>
        {/* While new launches are off the primary is Find saved launch, so this second control would repeat it. */}
        {canLaunch ? <button type="button" className="mdx-link mdx-hit cdx-live-find" disabled={!!busy} onClick={() => void recover(savedIntent(wallet.address!) ?? undefined)}>Find or resume a saved launch</button> : null}
        {recoverNote ? <p className="cdx-live-meta" role="status">{recoverNote}</p> : null}
        {recoveryItems.length ? <ul className="cdx-live-saved__list" aria-label="Saved launches for this wallet">{recoveryItems.map(i => <li key={i.id}><Button variant="outline" block disabled={!!busy} onClick={() => void recover(i.id)}><span className="cdx-live-address">{brief(i.tokenMint)}</span>{i.status === "nft_pending" ? "Card pending" : "Check launch"}</Button></li>)}</ul> : null}
      </> : <EmptyState compact title="Connect the creator wallet to find a saved launch." action={<button type="button" className="mdx-link mdx-hit" onClick={() => { launchPending.current = "recover"; setConnectOpen(true); }}>Connect wallet</button>} />}
    </section> : null}

    <WalletConnectDialog open={connectOpen} onOpenChange={connectChange} connect={connectInPanel} busyCopy={connectCopy} />

    <Modal open={reviewOpen} onOpenChange={value => { if (!busy) setReviewOpen(value); }} width={520} title={plan?.kind === "nft" ? "Review your card NFT" : "Review your coin launch"} description="Check the total, then approve in your wallet. Nothing is sent until you approve there.">
      {plan && reviewIntent ? <div className="cdx-live-review-modal">
        {/* One page: the costs, what the wallet will show, then the addresses. It scrolls inside the dialog when the
            screen is short, and Continue stays under it. */}
        <div ref={reviewBody} tabIndex={-1} role="region" aria-label="Transaction review" className="cdx-live-review-page">
          {reviewNotice ? <p className="cdx-live-callout" role="status">{reviewNotice}</p> : null}
          <p className="cdx-live-network"><strong>Solana mainnet · real funds</strong><span>{plan.kind === "token" ? getTradingPair(draftAtPrepare.current?.symbol ?? card.ticker, reviewIntent.quoteAssetKey) : "One-of-one creator card · no NFT royalties"}</span></p>
          {/* The coin's permanent image, before the wallet opens (the server made it from this card; nothing to choose). */}
          {plan.kind === "token" ? <LiveTokenImage intent={reviewIntent} /> : null}
          <dl className="cdx-launch-cost cdx-live-review">
            <div><dt>Network fee</dt><dd><span className="num">{formatLiveAmount(plan.review.networkFeeLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div>
            <div><dt>Priority fee</dt><dd><span className="num">{formatLiveAmount(plan.review.priorityFeeLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div>
            <div><dt>Rent for new accounts and program costs</dt><dd><span className="num">{formatLiveAmount(plan.review.rentAndProgramCostLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div>
            {plan.kind === "token" && plan.review.initialBuyQuoteBaseUnits !== "0" ? <>
              <div><dt>Initial buy</dt><dd><span className="num">{formatLiveAmount(plan.review.initialBuyQuoteBaseUnits, selected.decimals)}</span> <span className="mdx-unit">{selected.symbol}</span></dd></div>
              <div><dt>Minimum coins received</dt><dd><span className="num">{formatLiveAmount(plan.review.minimumTokensOut, typeof plan.review.tokenDecimals === "number" ? plan.review.tokenDecimals : 6)}</span></dd></div>
            </> : plan.kind === "token" ? <div><dt>Initial buy</dt><dd>None</dd></div> : null}
            <div><dt>Platform fee</dt><dd>None</dd></div>
            <div data-total><dt>Total SOL debit</dt><dd><span className="num">{formatLiveAmount(plan.review.totalDebitLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div>
            {plan.kind === "token" && pairCard ? <div><dt>Card NFT, in the same approval</dt><dd><span className="num">{formatLiveAmount(pairCard.review.totalDebitLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div> : null}
            {typeof plan.review.walletBalanceLamports === "string" ? <div><dt>Wallet SOL available</dt><dd><span className="num">{formatLiveAmount(plan.review.walletBalanceLamports, 9)}</span> <span className="mdx-unit">SOL</span></dd></div> : null}
          </dl>
          {plan.kind === "token" ? <p>{selected.key === "sol" ? "Any SOL initial buy is included in the SOL total. " : `Any ${selected.symbol} initial buy is separate from the SOL total. `}{pairCard ? PAIR_REVIEW_COPY : "Card NFT issuance is a separate paid transaction after coin verification."}</p> : <p>This issues the card for your existing coin. It does not launch or buy another coin.</p>}
          <LiveWalletNotice plan={plan} card={plan.kind === "token" ? pairCard : null} quote={selected} siteHost={siteHost} />
          <h3 className="cdx-live-subhead">Addresses</h3>
          <dl className="cdx-launch-cost cdx-live-review" data-stack><div><dt>Creator / fee payer</dt><dd className="cdx-live-address">{reviewIntent.creatorWallet}</dd></div><div><dt>{plan.kind === "token" ? "New coin mint" : "New NFT asset"}</dt><dd className="cdx-live-address">{plan.kind === "token" ? reviewIntent.tokenMint : reviewIntent.nftMint}</dd></div><div><dt>Quote mint</dt><dd className="cdx-live-address">{reviewIntent.quoteMint}</dd></div></dl>
          <p>Verified at slot <span className="num">{plan.verifiedSlot.toLocaleString()}</span>. If this review stays open longer than 30 seconds, continuing prepares a fresh transaction first.</p>
        </div>
        {/* While the wallet prompt is open, the dialog says what it shows (the panel's line is behind the overlay). */}
        {busy === "wallet" ? <PagedMessage text={pairCard ? WALLET_OPEN_PAIR_COPY : WALLET_OPEN_COPY} /> : null}
        {error ? <PagedMessage text={error} alert /> : null}
        <p className="cdx-live-meta">Opening your wallet does not approve payment. Approve there, or reject. Closing this review submits nothing.</p>
        <div className="cdx-live-review-actions">
          <Button block pending={!!busy} pendingLabel={busy === "wallet" ? "Waiting for wallet…" : busy === "submitting" ? "Submitting…" : busy === "refreshing" ? "Refreshing…" : "Checking…"} onClick={() => void approveInWallet()}>Continue to wallet review</Button>
          <Button variant="ghost" block disabled={!!busy} onClick={() => setReviewOpen(false)}>Back without signing</Button>
        </div>
      </div> : null}
    </Modal>
  </section>;
}

// ---------------------------------------------------------------- the progress view's rows

type Stage = { state: "todo" | "active" | "done" | "stopped"; text: string };
/** Short words for each busy state, shown on the row that is moving (the longer BUSY_COPY sentence follows). */
const PHASE: Record<NonNullable<Busy>, string> = {
  ownership: "Waiting for your wallet to sign in",
  artwork: "Preparing your artwork",
  coinImage: "Making your coin image",
  preparing: "Preparing the transaction",
  refreshing: "Refreshing the transaction",
  wallet: "Waiting for your wallet",
  submitting: "Sending",
  confirming: "Confirming on Solana",
  recovering: "Checking your saved launch",
};
function StageRow({ n, title, stage, children }: { n: number; title: string; stage: Stage; children?: ReactNode }) {
  const links = Array.isArray(children) ? children.some(Boolean) : !!children;
  return <li className="cdx-live-stage" data-state={stage.state}>
    <span className="cdx-live-stage__mark" aria-hidden>{stage.state === "done" ? <Icon name="check" size={14} strokeWidth={2} /> : stage.state === "stopped" ? <Icon name="warning" size={14} /> : <span className="num">{n}</span>}</span>
    <div className="cdx-live-stage__body">
      <p className="cdx-live-stage__title">{title}</p>
      <p className="cdx-live-stage__status" aria-live="polite">{stage.text}</p>
      {links ? <div className="cdx-live-stage__links">{children}</div> : null}
    </div>
  </li>;
}
