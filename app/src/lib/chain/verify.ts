// Verification before every signTransaction (refs/chain/m3-contract.md §7.3, R21, acceptance C8). Lazy chunk.
// Owner: app:wallet.
//
// For each build the client constructs the verifier intent from what the user typed and from its own trust reads
// (trust.ts: genesis, Config, pump Global, pAMM GlobalConfig, curve or pool, fee legs), never from the Worker's
// summary, then runs sdk.verifyTransaction on the exact bytes the wallet will sign:
//   - allowedLookupTables = ALT A and B (and the spare C), lookupTables = the SDK's fixed cluster layout for each (the 38
//     plus the 5 collection entries the fix pack appends; tables are append-only, so an unextended table never resolves an
//     index past 38 on chain);
//   - program allowlist, fee payer and signer set, compute budget within limits (CU price ≤ 100,000 µlamports,
//     priority fee ≤ 0.005 SOL), every payload instruction rebuilt from the intent and compared byte for byte;
//   - then the summary match: fee payer = the wallet; the verifier's spend bound ≤ the summary's maxSolOut; the build's
//     params agree with what the user typed (amounts, prices, flags, floors).
// Values the program enforces (PDAs, launcher, seller) may come from the Worker's params: a wrong one only fails the
// tx. Values that protect the user (amounts, prices, slippage bounds, fee caps, floors, expiry, flags) come from the
// user or the client's own reads. Every constant comes from env.ts TRUST_ANCHORS, never from the Worker's ApiConfig.

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
  acceptBidIx,
  associatedTokenAddress,
  buyNowIx,
  cancelBidIx,
  canonicalPoolPda,
  cardTokenAccount,
  cardVaultPda,
  coinUri,
  collectFeesIx,
  configCoinUriBase,
  decodeTransaction,
  delistCardIx,
  effectiveFeeBps,
  listCardIx,
  listingEscrowPda,
  clusterAltAddresses,
  clusterProfile,
  passesVanityCheck,
  placeBidIx,
  pumpFeeConfigPda,
  verifyTransaction,
  withdrawFeesIx,
  type DecodedTransaction,
  type Instruction,
  type TxIntent,
  type VerifyOptions,
} from "@mintdex/chain-sdk";
import {
  curveFeeMarketCap,
  decodeFeeConfig,
  feesForMarketCap,
  quoteCurveBuyExactSol,
  quoteCurveBuyTokens,
  quoteCurveSell,
  quotePoolBuyExactQuote,
  quotePoolSell,
  slippageCeil,
  slippageFloor,
  type CurveReserves,
} from "@mintdex/chain-sdk/quote";
import {
  API_LIMITS,
  type ApiLaunchPrepareResponse,
  type ApiTxBuildResponse,
  type ApiTxKind,
  type ApiTxParamsMap,
  type ApiTxRequestMap,
} from "@mintdex/chain-sdk/api";

import type { VerifyOutcome } from "./client";
import { APP_CLUSTER, TRUST_ANCHORS } from "./env";
import { getAccounts, loadAnchors, readCurveContext, readListingAndCard, readPoolContext, type Anchors } from "./trust";

/** Hard limits of §7.3 (the Worker itself uses 10,000 µlamports per CU). */
export const VERIFY_LIMITS = {
  maxComputeUnitLimit: 1_400_000,
  maxComputeUnitPriceMicroLamports: 100_000n,
  maxPriorityFeeLamports: 5_000_000n,
} as const;

/**
 * Wallet guard programs accepted after the payload in a wallet-rewritten tx (read-only, non-signer accounts only).
 * Recorded from the C1 wallet matrix; empty until then, so only compute-budget rewrites pass.
 */
export const GUARD_PROGRAMS: readonly string[] = [];

/** "Complete the curve" when the curve cannot be read: never pay more than this for the last tokens. */
const COMPLETE_FALLBACK_CAP = 50_000_000n;

let altList: string[] | null = null;
/**
 * The cluster layout the MintDex ALTs hold (created with the ALT treasury): the 38 entries, then the 4 collection PDAs
 * and the Metaplex program the fix pack appends (43, admin B6). Computed once.
 */
export function mintdexAltList(): string[] {
  if (!altList) {
    const list = clusterAltAddresses(clusterProfile(APP_CLUSTER), TRUST_ANCHORS.altTreasury);
    if (list.length !== 43) throw new Error(`expected 43 ALT entries, got ${list.length}`);
    altList = list;
  }
  return altList;
}

/** The lookup tables a verified tx may use: A, B and (when the build has one) the spare C. */
export function allowedTables(): string[] {
  return [TRUST_ANCHORS.altA, TRUST_ANCHORS.altB, ...(TRUST_ANCHORS.altC ? [TRUST_ANCHORS.altC] : [])];
}

/**
 * Review round 2: the contents the verifier resolves each table through. A table is trusted only for the prefix the
 * client read on chain (`Anchors.altStatus`): all 43 entries when full, the first 38 when base, not at all when it is
 * missing or holds other addresses. Without a read (older callers, tests) A and B keep the built-in 43-entry list and C
 * is left out.
 */
export function verifiedTables(altStatus?: Record<string, "full" | "base" | null>): Record<string, string[]> {
  const alt = mintdexAltList();
  const out: Record<string, string[]> = {};
  for (const t of allowedTables()) {
    if (!altStatus) {
      if (t !== TRUST_ANCHORS.altC) out[t] = alt;
      continue;
    }
    const st = altStatus[t];
    if (st === "full") out[t] = alt;
    else if (st === "base") out[t] = alt.slice(0, 38);
  }
  return out;
}

/** The verifier options every call uses (only trust anchors and the client's own reads). */
export function baseOptions(
  a: Pick<Anchors, "pumpGlobal" | "ammGlobal"> & { config?: { register_flags?: number } | null; altStatus?: Anchors["altStatus"] },
): VerifyOptions {
  const profile = clusterProfile(APP_CLUSTER);
  const lookupTables = verifiedTables(a.altStatus);
  return {
    lookupTables,
    allowedLookupTables: Object.keys(lookupTables),
    maxComputeUnitLimit: VERIFY_LIMITS.maxComputeUnitLimit,
    maxComputeUnitPriceMicroLamports: VERIFY_LIMITS.maxComputeUnitPriceMicroLamports,
    maxPriorityFeeLamports: VERIFY_LIMITS.maxPriorityFeeLamports,
    // the live Global read by the client; its own cluster's constants when the read failed (never devnet's on mainnet)
    pumpFeeRecipients: a.pumpGlobal?.allFeeRecipients ?? profile.pumpFeeRecipients,
    pumpBuybackFeeRecipients: a.pumpGlobal?.buybackFeeRecipients ?? profile.pumpBuybackFeeRecipients,
    pammProtocolFeeRecipients: a.ammGlobal?.protocolFeeRecipients,
    pammBuybackFeeRecipients: a.ammGlobal?.buybackFeeRecipients,
    // F9: a launch whose card standard the live Config disables is refused before the wallet opens
    ...(a.config && typeof a.config.register_flags === "number" ? { registerFlags: a.config.register_flags } : {}),
  };
}

/** Everything needed to check a build's bytes, and later the bytes the wallet returns. */
export interface Prepared {
  kind: ApiTxKind | "launch";
  wallet: string;
  intent: TxIntent;
  options: VerifyOptions;
  /** Params or summary values that disagree with what the user typed or the client read. */
  mismatches: string[];
  /** The summary's upper bound of lamports leaving the wallet. */
  maxSolOutLamports: bigint;
  /** server_first launch: signers whose valid signature must already be in the Worker's bytes. */
  presigned: string[];
}

/** A quote that may be unavailable (no FeeConfig, an old SDK, a migrated curve): null instead of a throw. */
function tryQuote(f: () => bigint): bigint | null {
  try {
    return f();
  } catch {
    return null;
  }
}

const big = (v: string | number | bigint) => BigInt(v);

/** Builds the verifier intent for a Worker build of `kind`, from the user's request and the client's own reads. */
export async function prepareVerification<K extends ApiTxKind>(
  kind: K,
  request: ApiTxRequestMap[K],
  build: ApiTxBuildResponse<K>,
): Promise<Prepared> {
  const anchors = await loadAnchors();
  const wallet = request.wallet;
  const mint = request.mint;
  const cfg = anchors.config;
  const mismatches: string[] = [];
  if (build.kind !== kind) mismatches.push(`asked for ${kind}, the build is ${build.kind}`);
  if (build.summary.feePayer !== wallet) mismatches.push("the summary names another fee payer");
  const exact = (expected: Instruction[]): TxIntent => ({ kind: "exact", payer: wallet, expected });
  let intent: TxIntent;

  switch (kind) {
    case "buy": {
      const r = request as ApiTxRequestMap["buy"];
      const q = (build.params as ApiTxParamsMap["buy"]).quote;
      const sol = big(r.solLamports);
      const maxCost = slippageCeil(sol, r.slippageBps);
      if (q.venue === "curve") {
        if (q.args.ix !== "pump_buy") mismatches.push(`a curve buy built as ${q.args.ix}`);
        const live = await readCurveContext(mint);
        const fees = live?.fees;
        const tokens = live && fees ? tryQuote(() => quoteCurveBuyExactSol(live.reserves, fees, sol).tokens) : null;
        // Without a client quote, fall back to the Worker's for the token minimum; the SOL ceiling stays the user's.
        const fallback = q.args.ix === "pump_buy" ? big(q.args.amount) : 0n;
        intent = {
          kind: "pump_buy",
          user: wallet,
          mint,
          creator: cardVaultPda(mint),
          minTokens: slippageFloor(tokens ?? fallback, r.slippageBps),
          maxSolCost: maxCost,
          tokenProgram: live?.tokenProgram ?? TOKEN_2022_PROGRAM_ID,
        };
      } else {
        if (q.args.ix !== "pamm_buy") mismatches.push(`a pool buy built as ${q.args.ix}`);
        const live = await readPoolContext(mint);
        const fees = live?.fees;
        const tokens = live && fees ? tryQuote(() => quotePoolBuyExactQuote(live.reserves, fees, sol).tokens) : null;
        const fallback = q.args.ix === "pamm_buy" ? big(q.args.baseAmountOut) : 0n;
        const accounts = poolAccounts(mint, live?.pool);
        intent = {
          kind: "pamm_buy",
          user: wallet,
          mint,
          ...accounts,
          coinCreator: cardVaultPda(mint),
          minBaseOut: slippageFloor(tokens ?? fallback, r.slippageBps),
          maxQuoteIn: maxCost,
        };
      }
      break;
    }
    case "sell": {
      const r = request as ApiTxRequestMap["sell"];
      const q = (build.params as ApiTxParamsMap["sell"]).quote;
      const amount = big(r.tokenAmount);
      if (q.venue === "curve") {
        if (q.args.ix !== "pump_sell") mismatches.push(`a curve sell built as ${q.args.ix}`);
        const live = await readCurveContext(mint);
        const fees = live?.fees;
        const sol = live && fees ? tryQuote(() => quoteCurveSell(live.reserves, fees, amount).sol) : null;
        intent = {
          kind: "pump_sell",
          user: wallet,
          mint,
          creator: cardVaultPda(mint),
          amount,
          minSolOutput: slippageFloor(sol ?? big(q.expectedSol), r.slippageBps),
          tokenProgram: live?.tokenProgram ?? TOKEN_2022_PROGRAM_ID,
        };
      } else {
        if (q.args.ix !== "pamm_sell") mismatches.push(`a pool sell built as ${q.args.ix}`);
        const live = await readPoolContext(mint);
        const fees = live?.fees;
        const sol = live && fees ? tryQuote(() => quotePoolSell(live.reserves, fees, amount).sol) : null;
        intent = {
          kind: "pamm_sell",
          user: wallet,
          mint,
          ...poolAccounts(mint, live?.pool),
          coinCreator: cardVaultPda(mint),
          baseAmountIn: amount,
          minQuoteOut: slippageFloor(sol ?? big(q.expectedSol), r.slippageBps),
        };
      }
      break;
    }
    case "complete-curve": {
      const r = request as ApiTxRequestMap["complete-curve"];
      const q = (build.params as ApiTxParamsMap["complete-curve"]).quote;
      if (q.args.ix !== "pump_buy") {
        mismatches.push(`completing the curve built as ${q.args.ix}`);
        intent = exact([]);
        break;
      }
      const live = await readCurveContext(mint);
      let minTokens = big(q.args.amount);
      let maxSolCost = big(q.args.maxSolCost) < COMPLETE_FALLBACK_CAP ? big(q.args.maxSolCost) : COMPLETE_FALLBACK_CAP;
      if (live) {
        minTokens = live.curve.realTokenReserves;
        if (minTokens >= big(API_LIMITS.dustTokenThreshold)) mismatches.push("the curve is not near completion");
        const fees = live.fees;
        const cost = fees ? tryQuote(() => quoteCurveBuyTokens(live.reserves, fees, minTokens).sol) : null;
        if (cost !== null) maxSolCost = slippageCeil(cost, r.slippageBps);
      }
      intent = {
        kind: "pump_buy",
        user: wallet,
        mint,
        creator: cardVaultPda(mint),
        minTokens,
        maxSolCost,
        tokenProgram: live?.tokenProgram ?? TOKEN_2022_PROGRAM_ID,
      };
      break;
    }
    case "withdraw": {
      const p = build.params as ApiTxParamsMap["withdraw"];
      checkExtras(p.extraWsolAccounts, mismatches);
      const own = cardTokenAccount(wallet, mint);
      if (p.holderCardAccount !== own) {
        // The listing escrow (the wallet is the seller) or a §4.5 sink (the wallet is the launcher), read ourselves.
        const { listing, card } = await readListingAndCard(mint);
        const escrowOk = p.holderCardAccount === listingEscrowPda(mint) && listing?.seller === wallet;
        const fallbackOk = p.holderMode === "launcher_fallback" && card?.launcher === wallet;
        if (!escrowOk && !fallbackOk) mismatches.push("the card account in the withdrawal is not this wallet's");
      }
      intent = exact([
        withdrawFeesIx({ holder: wallet, mint, holderCardAccount: p.holderCardAccount, extraWsolAccounts: p.extraWsolAccounts }),
      ]);
      break;
    }
    case "collect": {
      const p = build.params as ApiTxParamsMap["collect"];
      checkExtras(p.extraWsolAccounts, mismatches);
      intent = exact([collectFeesIx({ payer: wallet, mint, extraWsolAccounts: p.extraWsolAccounts })]);
      break;
    }
    case "bid": {
      const r = request as ApiTxRequestMap["bid"];
      const p = build.params as ApiTxParamsMap["bid"];
      const amount = big(r.amountLamports);
      if (big(p.amountLamports) !== amount) mismatches.push("the bid amount differs from the one you typed");
      intent = exact([placeBidIx({ bidder: wallet, mint, amount })]);
      break;
    }
    case "cancel-bid": {
      intent = exact([cancelBidIx({ bidder: wallet, mint })]);
      break;
    }
    case "accept": {
      const r = request as ApiTxRequestMap["accept"];
      const p = build.params as ApiTxParamsMap["accept"];
      if (big(p.minAmountLamports) !== big(r.minAmountLamports)) mismatches.push("the accepted amount differs from the bid you saw");
      if (r.bidder === wallet) mismatches.push("you cannot accept your own bid");
      checkFloor(r, p.minFeesToSeller, p.extraWsolAccounts, mismatches);
      checkExtras(p.extraWsolAccounts, mismatches);
      intent = exact([
        acceptBidIx({
          seller: wallet,
          bidder: r.bidder,
          mint,
          launcher: p.launcher,
          treasury: cfg.treasury,
          minAmount: big(r.minAmountLamports),
          maxTotalFeeBps: effectiveFeeBps(cfg.protocol_fee_bps, cfg.creator_royalty_bps, wallet === p.launcher),
          minFeesToSeller: big(p.minFeesToSeller),
          extraWsolAccounts: p.extraWsolAccounts,
        }),
      ]);
      break;
    }
    case "list": {
      const r = request as ApiTxRequestMap["list"];
      const p = build.params as ApiTxParamsMap["list"];
      const flags = r.voidOnEvolve ? 1 : 0;
      if (p.flags !== flags) mismatches.push("the listing flags differ from your choice");
      checkFloor(r, p.minFeesToSeller, [], mismatches);
      intent = exact([
        listCardIx({
          seller: wallet,
          mint,
          price: big(r.priceLamports),
          expiresAt: BigInt(r.expiresAt),
          flags,
          minFeesToSeller: big(p.minFeesToSeller),
        }),
      ]);
      break;
    }
    case "delist": {
      intent = exact([delistCardIx({ seller: wallet, mint })]);
      break;
    }
    case "buy-now": {
      const r = request as ApiTxRequestMap["buy-now"];
      const p = build.params as ApiTxParamsMap["buy-now"];
      if (p.cancelOwnBid !== r.cancelOwnBid) mismatches.push("the build changed whether your own bid is cancelled");
      if (p.seller === wallet) mismatches.push("you cannot buy your own listing");
      checkExtras(p.extraWsolAccounts, mismatches);
      intent = exact([
        ...(r.cancelOwnBid ? [cancelBidIx({ bidder: wallet, mint })] : []),
        buyNowIx({
          buyer: wallet,
          seller: p.seller,
          mint,
          launcher: p.launcher,
          treasury: cfg.treasury,
          expectedPrice: big(r.expectedPriceLamports),
          maxTotalFeeBps: effectiveFeeBps(cfg.protocol_fee_bps, cfg.creator_royalty_bps, p.seller === p.launcher),
          extraWsolAccounts: p.extraWsolAccounts,
        }),
      ]);
      break;
    }
    default: {
      mismatches.push(`unknown transaction kind ${String(kind)}`);
      intent = exact([]);
    }
  }
  return {
    kind,
    wallet,
    intent,
    options: baseOptions(anchors),
    mismatches,
    maxSolOutLamports: big(build.summary.maxSolOutLamports),
    presigned: [],
  };
}

/** The pool token accounts from the pool account we read, else the canonical ATAs (pAMM enforces them anyway). */
function poolAccounts(mint: string, pool?: { poolBaseTokenAccount: string; poolQuoteTokenAccount: string } | null) {
  const p = canonicalPoolPda(mint);
  return {
    poolBaseTokenAccount: pool?.poolBaseTokenAccount ?? associatedTokenAddress(p, mint, TOKEN_2022_PROGRAM_ID),
    poolQuoteTokenAccount: pool?.poolQuoteTokenAccount ?? associatedTokenAddress(p, WSOL_MINT, TOKEN_PROGRAM_ID),
  };
}

function checkExtras(extras: readonly string[], mismatches: string[]) {
  if (extras.length > API_LIMITS.maxExtraWsolAccounts) mismatches.push("too many extra fee accounts in one transaction");
  if (new Set(extras).size !== extras.length) mismatches.push("an extra fee account appears twice");
}

/** The seller's floor (sent in the request from the client's own reads) can only be raised by the Worker. */
function checkFloor(
  r: { minFeesToSellerLamports?: string; extraWsolAccounts?: string[] },
  built: string,
  builtExtras: readonly string[],
  mismatches: string[],
) {
  if (big(built) < big(r.minFeesToSellerLamports ?? "0")) mismatches.push("the fee floor is lower than the one your wallet read");
  const missing = (r.extraWsolAccounts ?? []).filter((a) => !builtExtras.includes(a));
  if (missing.length) mismatches.push("the build left out fee accounts your wallet found");
}

/** Launch (server_first or wallet_first): the intent from the typed form and the client's Config and pump reads. */
export async function prepareLaunchVerification(
  input: { name: string; symbol: string; devBuyLamports: bigint; slippageBps: number },
  prep: ApiLaunchPrepareResponse,
  wallet: string,
): Promise<Prepared> {
  const anchors = await loadAnchors();
  const cfg = anchors.config;
  const mismatches: string[] = [];
  const mint = prep.mint;
  if (!mint.endsWith("mint")) mismatches.push("the coin address does not end in mint");
  if (!passesVanityCheck(mint, cfg.vanity_modulus, cfg.vanity_residue)) mismatches.push("the coin address has no MintDex ticket");
  const uri = coinUri(mint, configCoinUriBase(cfg) || undefined);
  if (prep.coinUri !== uri) mismatches.push("the metadata address differs from the one MintDex binds");
  if (prep.summary.feePayer !== wallet) mismatches.push("the summary names another fee payer");
  let devBuy: { minTokens: bigint; maxSolCost: bigint } | null = null;
  // admin B6: a collection launch through an unextended table leaves the dev buy for a second step (a normal buy)
  const split = !!prep.devBuySplit && big(prep.devBuySplit.lamports) === input.devBuyLamports;
  if (prep.devBuySplit && !split) mismatches.push("the dev buy split does not match what you asked for");
  if (input.devBuyLamports > 0n && !split) {
    if (!prep.devBuy) mismatches.push("the dev buy is missing");
    const maxSolCost = slippageCeil(input.devBuyLamports, input.slippageBps);
    const g = anchors.pumpGlobal;
    let tokens: bigint | null = null;
    if (g) {
      // A fresh curve: pump Global's initial reserves, nothing sold yet.
      const fresh: CurveReserves = {
        virtualTokenReserves: g.initialVirtualTokenReserves,
        virtualSolReserves: g.initialVirtualSolReserves,
        realTokenReserves: g.initialRealTokenReserves,
        realSolReserves: 0n,
        tokenTotalSupply: g.tokenTotalSupply,
        complete: false,
      };
      const fees = await freshCurveFees(fresh);
      tokens = fees ? tryQuote(() => quoteCurveBuyExactSol(fresh, fees, input.devBuyLamports).tokens) : null;
    }
    const fallback = prep.devBuy ? big(prep.devBuy.tokens) : 0n;
    devBuy = { minTokens: slippageFloor(tokens ?? fallback, input.slippageBps), maxSolCost };
  } else if (prep.devBuy) {
    mismatches.push("a dev buy you did not ask for");
  }
  // §18.17: either register instruction is a genuine MintDex registration of this coin; the template checks the one the
  // Worker says it built, byte for byte (an absent field = a Worker from before §18.17 = token2022)
  const cardStandard = prep.cardStandard ?? "token2022";
  if (cardStandard !== "metaplex-collection" && cardStandard !== "metaplex" && cardStandard !== "token2022") {
    mismatches.push("an unknown card NFT type");
  }
  const intent: TxIntent = {
    kind: "launch",
    payer: wallet,
    mint,
    name: input.name.trim(),
    symbol: input.symbol.trim(),
    uri,
    treasury: cfg.treasury,
    devBuy,
    cardStandard: cardStandard === "metaplex-collection" || cardStandard === "metaplex" ? cardStandard : "token2022",
  };
  return {
    kind: "launch",
    wallet,
    intent,
    options: baseOptions(anchors),
    mismatches,
    maxSolOutLamports: big(prep.summary.maxSolOutLamports),
    presigned: prep.mode === "server_first" ? [mint] : [],
  };
}

/** pump's fees for a curve that does not exist yet (the launch's dev buy), from the pump FeeConfig. */
async function freshCurveFees(fresh: CurveReserves) {
  try {
    const [acc] = await getAccounts([pumpFeeConfigPda()]);
    return acc ? feesForMarketCap(decodeFeeConfig(acc.data), curveFeeMarketCap(fresh)) : null;
  } catch {
    return null;
  }
}

/**
 * Runs the verifier on `bytes`. Without `rewrittenFrom` these are the Worker's bytes (server_first presignatures
 * required). With it, these are bytes the wallet changed after signing: verified guard-tolerantly (compute budget
 * within limits, GUARD_PROGRAMS instructions after the payload) for the same intent, the same blockhash and the same
 * fee payer as the message verified before the wallet opened. `guardPrograms` defaults to GUARD_PROGRAMS (tests pass
 * their own list).
 */
export function checkPrepared(
  bytes: Uint8Array,
  p: Prepared,
  rewrittenFrom?: DecodedTransaction,
  guardPrograms: readonly string[] = GUARD_PROGRAMS,
): VerifyOutcome {
  const options: VerifyOptions = rewrittenFrom
    ? { ...p.options, guardPrograms }
    : { ...p.options, requirePresignedBy: p.presigned.length ? p.presigned : undefined };
  const r = verifyTransaction(bytes, p.intent, options);
  const mismatches = [...p.mismatches];
  if (r.ok && r.summary.feePayer !== p.wallet) mismatches.push("the fee payer is not the connected wallet");
  if (r.ok && r.summary.maxPayerSpendLamports > p.maxSolOutLamports) {
    mismatches.push(
      `the transaction can spend ${r.summary.maxPayerSpendLamports} lamports, more than the ${p.maxSolOutLamports} shown`,
    );
  }
  if (rewrittenFrom) {
    try {
      const d = decodeTransaction(bytes);
      if (d.message.recentBlockhash !== rewrittenFrom.message.recentBlockhash) mismatches.push("the wallet changed the blockhash");
      if (d.message.staticAccountKeys[0] !== rewrittenFrom.message.staticAccountKeys[0]) mismatches.push("the wallet changed the fee payer");
    } catch {
      mismatches.push("the wallet returned an unreadable transaction");
    }
  }
  return {
    ok: r.ok && mismatches.length === 0,
    errors: r.errors,
    maxPayerSpendLamports: r.summary.maxPayerSpendLamports,
    mismatches,
  };
}

/** client.verifyTxBuild: the SDK verifier and the §7.3 checks on a build, for `request` as the user typed it. */
export async function verifyTxBuild<K extends ApiTxKind>(
  kind: K,
  request: ApiTxRequestMap[K],
  build: ApiTxBuildResponse<K>,
): Promise<VerifyOutcome> {
  const p = await prepareVerification(kind, request, build);
  return checkPrepared(base64ToBytes(build.tx), p);
}

/** Strict standard base64 (the Worker's tx field). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
