import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as flow from "../../src/components/carddex/live/launch-flow";
import {
  cardNext, proveOwnership, signForLaunch, signLaunchPair, CARD_APPROVAL_EXPIRED,
} from "../../src/components/carddex/live/launch-flow";
import {
  fromBase58, fromBase64, hexHash, parseLiveTransaction, signsBothFor, WalletChangedTransaction, type TransactionPlan,
} from "../../src/components/carddex/live/transaction";
import {
  connectLiveWallet, disconnectLiveWallet, getLiveWalletSnapshot, mountRegistry, signInLiveWallet, signLiveMessage, signLiveTransaction,
  signLiveTransactions, walletSupportsSignIn,
} from "../../src/components/carddex/live/wallet";
import { SignInWrongSite } from "../../src/components/carddex/live/wallet-errors";
import { PAIR_REVIEW_COPY, WALLET_NOTICE_COPY, WALLET_OPEN_PAIR_COPY, walletNoticeItems } from "../../src/components/carddex/live/wallet-notice";
import { liveSignInInput, liveSignInMessage, liveSignInText, type LiveSignInInput } from "../../src/lib/carddex/live/sign-in";
import { assetSeed, creator, creatorSeed, fixture, mint, nft, nftFixture, nftSeed } from "./live-plan-fixtures";
import { mockWallet, type MockWalletOptions } from "./mock-wallets";

// Mock Wallet Standard wallets in the real registry, the real wallet.ts calls and synthetic unfunded keys. The site's
// server is a stand-in here (the real one is covered in live-launch.test.ts). Nothing is sent anywhere.
const ORIGIN = "https://launchacard.fun";
let release: () => void;
const registered: Array<() => void> = [];
beforeAll(() => { release = mountRegistry(); });
afterAll(() => release());
afterEach(async () => { await disconnectLiveWallet(); while (registered.length) registered.pop()!(); });
function wallet(options: Partial<MockWalletOptions> & { name: string }) {
  const made = mockWallet({ seed: creatorSeed, ...options });
  registered.push(made.unregister);
  return made;
}
/** The site's two ownership routes, held in memory: what was asked and what it accepted. */
function site() {
  const challenges = new Map<string, LiveSignInInput>(), accepted: { route: string; wallet: string }[] = [];
  let counter = 0;
  return { accepted,
    signInChallenge: async () => { const challengeId = `c${++counter}`; const input = liveSignInInput({ origin: ORIGIN, nonce: `nonce${counter}abcdef`, issuedAt: new Date(1_800_000_000_000), expiresAt: new Date(1_800_000_300_000) }); challenges.set(challengeId, input); return { challengeId, input }; },
    verifySignIn: async (proof: { challengeId: string; wallet: string; signedMessageBase64: string; signatureBase64: string }) => {
      const input = challenges.get(proof.challengeId)!, signed = fromBase64(proof.signedMessageBase64);
      expect(new TextDecoder().decode(signed)).toBe(liveSignInText(input, proof.wallet));
      expect(ed25519.verify(fromBase64(proof.signatureBase64), signed, fromBase58(proof.wallet))).toBe(true);
      accepted.push({ route: "sign-in", wallet: proof.wallet });
    },
    messageChallenge: async (address: string) => ({ challengeId: `m${++counter}`, message: liveSignInMessage({ origin: ORIGIN, wallet: address, nonce: `nonce${counter}abcdef`, issuedAt: new Date(1_800_000_000_000), expiresAt: new Date(1_800_000_300_000) }) }),
    verifyMessage: async (proof: { wallet: string }) => { accepted.push({ route: "message", wallet: proof.wallet }); },
  };
}
const ownership = (name: string, address: string | null, server = site(), origin = ORIGIN) => ({ server, run: () => proveOwnership({
  address, canSignIn: walletSupportsSignIn(name), origin, ...server,
  signIn: input => signInLiveWallet(name, input), connect: () => connectLiveWallet(name), signMessage: (message, wallet) => signLiveMessage(message, wallet),
}) });

describe("connect and ownership in one wallet prompt (solana:signIn)", () => {
  test("a wallet with sign-in connects and proves its owner in one prompt, and the site accepts the canonical text", async () => {
    const phantom = wallet({ name: "Phantom", signIn: true });
    expect(walletSupportsSignIn("Phantom")).toBe(true);
    const { server, run } = ownership("Phantom", null);
    expect(await run()).toEqual({ address: creator, method: "sign-in", prompts: 1 });
    expect(phantom.prompts).toEqual(["signIn"]);
    expect(server.accepted).toEqual([{ route: "sign-in", wallet: creator }]);
    // The request carried every field, so the wallet added only the account.
    expect(phantom.signInInputs[0]).toMatchObject({ domain: "launchacard.fun", uri: ORIGIN, version: "1", chainId: "mainnet" });
    expect(phantom.signInInputs[0].address).toBeUndefined();
    expect(getLiveWalletSnapshot().address).toBe(creator);
  });
  test("an already connected wallet with sign-in is asked once, for its own account", async () => {
    const phantom = wallet({ name: "Phantom", signIn: true });
    await connectLiveWallet("Phantom");
    expect(await ownership("Phantom", creator).run()).toMatchObject({ method: "sign-in", prompts: 1 });
    expect(phantom.prompts).toEqual(["connect", "signIn"]);
    expect(phantom.signInInputs[0].address).toBe(creator);
  });
  test("a wallet without sign-in connects, then signs the ownership message, as before", async () => {
    const solflare = wallet({ name: "Solflare" });
    expect(walletSupportsSignIn("Solflare")).toBe(false);
    const { server, run } = ownership("Solflare", null);
    expect(await run()).toEqual({ address: creator, method: "message", prompts: 2 });
    expect(solflare.prompts).toEqual(["connect", "signMessage"]);
    expect(server.accepted).toEqual([{ route: "message", wallet: creator }]);
  });
  test("a wallet that signs other sign-in text is not accepted from it; the plain message proves ownership instead", async () => {
    for (const change of [(text: string) => `Phantom wallet\n${text}`, (text: string) => text.replace("launchacard.fun wants", "www.launchacard.fun wants"), (text: string) => text.replace("Chain ID: mainnet", "Chain ID: solana:mainnet")]) {
      const odd = wallet({ name: "Odd", signIn: true, signInText: change });
      const { server, run } = ownership("Odd", null);
      expect(await run()).toMatchObject({ address: creator, method: "message", prompts: 2 });
      expect(odd.prompts).toEqual(["signIn", "signMessage"]);
      expect(server.accepted.map(entry => entry.route)).toEqual(["message"]);
      await disconnectLiveWallet(); registered.pop()!();
    }
  });
  test("a refusal in the wallet stops there, with no further prompt", async () => {
    for (const reject of [["signIn"], ["signMessage"], ["connect"]] as const) {
      const made = wallet({ name: "Refuser", signIn: reject[0] === "signIn", reject: [...reject] });
      const { server, run } = ownership("Refuser", null);
      await expect(run()).rejects.toThrow("User rejected");
      expect(made.prompts).toEqual(reject[0] === "signMessage" ? ["connect", "signMessage"] : [reject[0]]);
      expect(server.accepted).toEqual([]);
      await disconnectLiveWallet(); registered.pop()!();
    }
  });
  test("a sign-in for another site never opens the wallet, and Phantom's -32000 says which site to open", async () => {
    const phantom = wallet({ name: "Phantom", signIn: true });
    await expect(ownership("Phantom", null, site(), "https://www.launchacard.fun").run()).rejects.toThrow("Open launchacard.fun to sign in");
    expect(phantom.prompts).toEqual([]);
    await disconnectLiveWallet(); registered.pop()!();
    const blocked = wallet({ name: "Phantom", signIn: true, signInError: Object.assign(new Error("Invalid input"), { code: -32000 }) });
    const refused = await ownership("Phantom", null).run().then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(SignInWrongSite);
    expect((refused as Error).message).toContain("Open launchacard.fun");
    expect(blocked.prompts).toEqual(["signIn"]);
  });
  test("a sign-in that fails for another reason falls back to connect and the message", async () => {
    const broken = wallet({ name: "Broken", signIn: true, signInError: new Error("Method not implemented") });
    expect(await ownership("Broken", null).run()).toMatchObject({ method: "message", prompts: 3 });
    expect(broken.prompts).toEqual(["signIn", "connect", "signMessage"]);
  });
});

const signer = (address: string, seed: Uint8Array) => ({ address, seed: seed.slice() });
function pair() {
  const coin = fixture(), card = nftFixture();
  return { coin, card, plans: { coin: coin.plan, card: card.plan }, expected: { coin: coin.expected, card: card.expected }, signers: { coin: signer(mint, assetSeed), card: signer(nft, nftSeed) } };
}
const feeChange = (unsigned: Uint8Array) => { const out = unsigned.slice(), at = out.findIndex((_, i) => out[i] === 9 && out[i + 1] === 3 && out[i + 2] === 232 && out[i + 3] === 3); out[at + 2] = 233; return out; };
const noRefresh = async () => { throw new Error("not stale"); };
const verifies = (bytes: Uint8Array, plan: TransactionPlan) => {
  const wire = parseLiveTransaction(bytes);
  return hexHash(wire.message) === plan.messageSha256 && wire.signatures.every((signature, i) => ed25519.verify(signature, wire.message, fromBase58(wire.signers[i])));
};

describe("one wallet prompt for the coin and its card", () => {
  test("a batch wallet signs both in one approval; both come back fully signed and unchanged", async () => {
    const backpack = wallet({ name: "Backpack", batch: "one" });
    await connectLiveWallet("Backpack");
    const { plans, expected, signers } = pair();
    const step = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "page-first", refresh: noRefresh,
      walletSignAll: transactions => signLiveTransactions(transactions, creator) });
    expect(backpack.prompts).toEqual(["connect", "signTransaction"]);
    if (step.status !== "signed") throw new Error(`Expected signed, got ${step.status}`);
    expect(verifies(step.coinSigned, plans.coin)).toBe(true);
    expect(verifies(step.cardSigned, plans.card)).toBe(true);
    // Page-first: the wallet saw both already carrying this page's signatures, in the order coin then card.
    expect(backpack.shown[0]).toHaveLength(2);
    expect(backpack.shown[0].map(bytes => parseLiveTransaction(bytes).signatures[1].some(Boolean))).toEqual([true, true]);
    expect(backpack.shown[0].map(bytes => hexHash(parseLiveTransaction(bytes).message))).toEqual([plans.coin.messageSha256, plans.card.messageSha256]);
  });
  test("a wallet-first batch: the wallet signs both unsigned, then the page co-signs each", async () => {
    wallet({ name: "Batcher", batch: "one" }); await connectLiveWallet("Batcher");
    const { plans, expected, signers } = pair();
    const step = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "wallet-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) });
    if (step.status !== "signed") throw new Error("Expected signed");
    expect(verifies(step.coinSigned, plans.coin) && verifies(step.cardSigned, plans.card)).toBe(true);
  });
  test("a wallet that confirms each transaction separately still returns both (two approvals, nothing lost)", async () => {
    const metamask = wallet({ name: "MetaMask", batch: "each" }); await connectLiveWallet("MetaMask");
    const { plans, expected, signers } = pair();
    const step = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "page-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) });
    expect(step.status).toBe("signed");
    expect(metamask.prompts).toEqual(["connect", "signTransaction", "signTransaction"]);
  });
  test("a wallet that returns one transaction for two falls back to the coin alone; the card asks after the coin", async () => {
    const one = wallet({ name: "OneAtATime", batch: "first-only" }); await connectLiveWallet("OneAtATime");
    const { plans, expected, signers } = pair();
    const step = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "page-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) });
    expect(step).toMatchObject({ status: "single", prompted: true });
    if (step.status !== "single") throw new Error("Expected single");
    // The coin alone, in its own prompt, exactly as without the pair.
    const coin = await signForLaunch({ plan: step.coin, receivedAt: step.receivedAt, now: () => 2_000, expected: expected.coin, signer: signers.coin, order: "page-first", refresh: noRefresh,
      walletSign: transaction => signLiveTransaction(transaction, creator) });
    expect(coin.status).toBe("signed");
    expect(one.prompts).toEqual(["connect", "signTransaction", "signTransaction"]);
  });
  test("a refusal of the one approval stops everything: nothing is co-signed or returned", async () => {
    const backpack = wallet({ name: "Backpack", batch: "one", reject: ["signTransaction"] }); await connectLiveWallet("Backpack");
    const { plans, expected, signers } = pair();
    await expect(signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "page-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) })).rejects.toThrow("User rejected");
    expect(backpack.prompts).toEqual(["connect", "signTransaction"]);
  });
  test("a wallet-first batch that changes the card is logged per transaction, then asked once more page-first", async () => {
    let calls = 0;
    wallet({ name: "Rewriter", batch: "one", change: (bytes, index) => index === 1 && calls++ === 0 ? feeChange(bytes) : bytes }); await connectLiveWallet("Rewriter");
    const { plans, expected, signers } = pair(), changed: string[] = [], opened: boolean[] = [];
    const step = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 2_000, expected, signers, order: "wallet-first", refresh: noRefresh,
      onWalletChanged: plan => changed.push(plan.kind), onWalletOpen: retry => opened.push(retry), walletSignAll: transactions => signLiveTransactions(transactions, creator) });
    expect(changed).toEqual(["nft"]); expect(opened).toEqual([false, true]);
    expect(step).toMatchObject({ status: "signed", order: "page-first", fellBack: true });
    // A page-first batch that changes a message is refused, never retried.
    wallet({ name: "Rewriter2", batch: "one", change: (bytes, index) => index === 1 ? feeChange(bytes) : bytes }); await connectLiveWallet("Rewriter2");
    const refused = await signLaunchPair({ ...pair(), receivedAt: 1_000, now: () => 2_000, order: "page-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
    expect((refused as WalletChangedTransaction).changes.map(change => change.index)).toEqual([1]);
  });
  test("a stale pair is prepared again first; a moved cost returns to the review, and a refresh without the card goes single", async () => {
    const { plans, expected, signers } = pair();
    let refreshes = 0;
    const costlier = { ...plans.card, review: { ...plans.card.review, totalDebitLamports: "9999999" } };
    const moved = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 20_000, expected, signers, order: "page-first",
      refresh: async () => { refreshes++; return { coin: plans.coin, card: costlier }; }, walletSignAll: async () => { throw new Error("must not open"); } });
    expect(moved).toMatchObject({ status: "changed" }); expect(refreshes).toBe(1);
    const single = await signLaunchPair({ plans, receivedAt: 1_000, now: () => 20_000, expected, signers, order: "page-first",
      refresh: async () => ({ coin: plans.coin, card: null }), walletSignAll: async () => { throw new Error("must not open"); } });
    expect(single).toMatchObject({ status: "single", prompted: false });
    expect(await signLaunchPair({ plans, receivedAt: 1_000, now: () => 20_000, expected, signers, order: "page-first", refresh: async () => null, walletSignAll: async () => [] })).toEqual({ status: "gone" });
    // Within 15 seconds the pair goes as prepared.
    wallet({ name: "Backpack", batch: "one" }); await connectLiveWallet("Backpack");
    expect((await signLaunchPair({ plans, receivedAt: 1_000, now: () => 14_000, expected, signers, order: "page-first", refresh: noRefresh, walletSignAll: transactions => signLiveTransactions(transactions, creator) })).status).toBe("signed");
  });
});

describe("separate prompts for the coin and the card", () => {
  test("a refusal at the coin's or the card's own prompt stops there, and nothing is co-signed", async () => {
    for (const [make, seed, address] of [[fixture, assetSeed, mint], [nftFixture, nftSeed, nft]] as const) {
      const solflare = wallet({ name: "Solflare", reject: ["signTransaction"] }); await connectLiveWallet("Solflare");
      const { plan, expected } = make();
      await expect(signForLaunch({ plan, receivedAt: 1_000, now: () => 2_000, expected, signer: signer(address, seed), order: "page-first", refresh: noRefresh,
        walletSign: transaction => signLiveTransaction(transaction, creator) })).rejects.toThrow("User rejected");
      expect(solflare.prompts).toEqual(["connect", "signTransaction"]);
      await disconnectLiveWallet(); registered.pop()!();
    }
  });
});

describe("the card after its coin", () => {
  const stage = (status: string, nftSignature: string | null = null) => ({ status, nftMint: nft, nftSignature });
  test("an approved card is sent once the coin is verified; otherwise the card's own review is prepared", () => {
    const approved = { nftMint: nft };
    expect(cardNext(stage("prepared"), approved)).toBe("none");
    expect(cardNext(stage("token_pending"), approved)).toBe("none");
    expect(cardNext(stage("nft_pending"), approved)).toBe("send-approved");
    expect(cardNext(stage("nft_pending"), null)).toBe("prepare");
    // After a card key change the old approval is not used.
    expect(cardNext(stage("nft_pending"), { nftMint: mint })).toBe("prepare");
    expect(cardNext(stage("nft_pending", "s".repeat(88)), approved)).toBe("confirm");
    expect(cardNext(stage("complete"), approved)).toBe("none");
    expect(CARD_APPROVAL_EXPIRED).toContain("nothing was charged for the card");
  });
  test("only listed wallets get one prompt, and Phantom never does", () => {
    expect(signsBothFor("Backpack", ["Backpack"])).toBe(true);
    expect(signsBothFor("backpack ", ["Backpack"])).toBe(true);
    expect(signsBothFor("Solflare", ["Backpack"])).toBe(false);
    expect(signsBothFor("Solflare", ["*"])).toBe(true);
    expect(signsBothFor("Phantom", ["*"])).toBe(false);
    expect(signsBothFor("Phantom", ["Phantom"])).toBe(false);
    expect(signsBothFor(null, ["*"])).toBe(false);
    expect(signsBothFor("Backpack", undefined)).toBe(false);
  });
  test("the wallet notice says one approval covers both, with both signers and the combined fee", () => {
    const { plan } = fixture(), card = nftFixture().plan, sol = { symbol: "SOL", decimals: 9, kind: "native" };
    const items = walletNoticeItems(plan, sol, "launchacard.fun", card);
    expect(items.map(item => item.key)).toEqual(["approvalsPair", "networkFee", "coinSigner", "cardSigner", "cardLock", "newSite"]);
    expect(items[0].text).toBe("One wallet approval creates your coin and its card. The card is sent as soon as the coin is confirmed.");
    expect(items[1].text).toBe("A network fee of about 0.000021 SOL.");
    expect(walletNoticeItems(plan, sol)[0].text).toBe(WALLET_NOTICE_COPY.approvalsCoin);
    // A card plan never becomes a pair with another card.
    expect(walletNoticeItems(card, sol, undefined, card).map(item => item.key)[0]).toBe("approvalsCard");
  });
  test("the new prompt copy is calm and plain", () => {
    const copy = [WALLET_OPEN_PAIR_COPY, PAIR_REVIEW_COPY, ...Object.values(flow).filter((value): value is string => typeof value === "string")];
    expect(copy.length).toBeGreaterThan(7);
    for (const text of copy) { expect(text).not.toMatch(/[\u2013\u2014]/); expect(text).not.toMatch(/ignore|anyway|click through|safe to proceed/i); }
  });
});

describe("sign-in text", () => {
  test("the site's SIWS text is the wallet standard's canonical text for the same fields, and the message route signs the same", () => {
    const input = liveSignInInput({ origin: ORIGIN, nonce: "abcdef123456", issuedAt: new Date(1_800_000_000_000), expiresAt: new Date(1_800_000_300_000) });
    expect(liveSignInText(input, creator)).toBe(liveSignInMessage({ origin: ORIGIN, wallet: creator, nonce: "abcdef123456", issuedAt: new Date(1_800_000_000_000), expiresAt: new Date(1_800_000_300_000) }));
    expect(liveSignInText(input, creator)).toBe(`launchacard.fun wants you to sign in with your Solana account:\n${creator}\n\n${input.statement}\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: mainnet\nNonce: abcdef123456\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`);
  });
});
