// The browser's own chain reads for the verifier (refs/chain/m3-contract.md §7.3, R21). Lazy chunk: imported only by
// verify.ts and flows.ts. Owner: app:wallet.
//
// Trust rules:
//   - every read goes to PUBLIC_RPC_URL (the public devnet RPC, a build constant from env.ts), never through the chain
//     Worker, which is the party being checked;
//   - first of all, getGenesisHash() must equal TRUST_ANCHORS.genesisHash (devnet), else nothing is verified or signed
//     (WRONG_NETWORK): the browser's half of hard rule 1;
//   - program id, Config address, ALT A / B and the ALT treasury come from TRUST_ANCHORS only. Nothing here reads the
//     Worker's ApiConfig (an app test pins that).

import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
  MINTDEX_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WSOL_MINT,
  ammFeeConfigPda,
  ammGlobalConfigPda,
  bondingCurvePda,
  clusterAltStatus,
  clusterProfile,
  decodeAddressLookupTable,
  canonicalPoolPda,
  cardStatePda,
  coinAddresses,
  configPda,
  decodeAmmGlobalConfig,
  decodeBondingCurve,
  decodeCard,
  decodeConfig,
  decodeListing,
  decodePool,
  decodePumpGlobal,
  decodeTokenAccount,
  fromBase64,
  listingPda,
  mintSupply,
  pumpFeeConfigPda,
  pumpGlobalPda,
  sellerFeeFloor,
  type AmmGlobalConfig,
  type BondingCurve,
  type CardAccount,
  type ConfigAccount,
  type FeeBalances,
  type ListingAccount,
  type Pool,
  type PumpGlobal,
} from "@mintdex/chain-sdk";
import {
  curveFeeMarketCap,
  decodeFeeConfig,
  feesForMarketCap,
  poolFeeMarketCap,
  type CurveReserves,
  type FeeBps,
  type PoolReserves,
} from "@mintdex/chain-sdk/quote";

import { APP_CLUSTER, NET_NAME, PUBLIC_RPC_URL, TRUST_ANCHORS } from "./env";
import { ChainClientError } from "./errors";

// ---------------------------------------------------------------- public RPC

let rpcId = 0;

/** One JSON-RPC call to the public devnet RPC (retries a 429 once). */
export async function publicRpc<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let status = 0;
    let json: { result?: T; error?: { message?: string } } | null = null;
    try {
      const res = await fetch(PUBLIC_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
        signal: ctl.signal,
      });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch {
      throw new ChainClientError("RPC_UNAVAILABLE", `Could not reach ${NET_NAME}.`);
    } finally {
      clearTimeout(timer);
    }
    if (status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    if (!json || status >= 400 || json.error || !("result" in json)) {
      throw new ChainClientError("RPC_UNAVAILABLE", `${NET_NAME} did not answer ${method}.`);
    }
    return json.result as T;
  }
}

export interface RpcAccount {
  address: string;
  owner: string;
  lamports: bigint;
  data: Uint8Array;
}

type RawAccount = { owner: string; lamports: number; data: [string, string] } | null;

/** getMultipleAccounts (base64, confirmed) in input order; null for accounts that do not exist. */
export async function getAccounts(addresses: string[]): Promise<Array<RpcAccount | null>> {
  if (addresses.length === 0) return [];
  const r = await publicRpc<{ value: RawAccount[] }>("getMultipleAccounts", [
    addresses,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (!r || !Array.isArray(r.value) || r.value.length !== addresses.length) {
    throw new ChainClientError("RPC_UNAVAILABLE", `${NET_NAME} returned a malformed account list.`);
  }
  return r.value.map((a, i) =>
    a ? { address: addresses[i], owner: a.owner, lamports: BigInt(a.lamports), data: fromBase64(a.data[0]) } : null,
  );
}

// ---------------------------------------------------------------- the genesis check (hard rule 1, browser half)

let genesis: Promise<void> | null = null;

/** Resolves once the public RPC is proven to be the build's cluster (TRUST_ANCHORS.genesisHash); WRONG_NETWORK (cached) for anything else. */
export function assertCluster(): Promise<void> {
  if (!genesis) {
    const p = (async () => {
      let hash: unknown;
      try {
        hash = await publicRpc<string>("getGenesisHash", []);
      } catch {
        genesis = null; // a network failure may pass; try again next time
        throw new ChainClientError("NETWORK", `Could not reach ${NET_NAME} to check the network. Nothing was signed.`);
      }
      if (hash !== TRUST_ANCHORS.genesisHash) {
        throw new ChainClientError("WRONG_NETWORK", `The Solana RPC is not ${APP_CLUSTER}, so MintDex will not sign anything.`);
      }
    })();
    genesis = p;
  }
  return genesis;
}

// ---------------------------------------------------------------- session anchors

export interface Anchors {
  config: ConfigAccount;
  /** pump Global (fee and buyback recipients, initial curve); null when it could not be read (SDK devnet constants then). */
  pumpGlobal: PumpGlobal | null;
  /** pAMM GlobalConfig (protocol and buyback recipients); null when it could not be read (PumpSwap intents then fail). */
  ammGlobal: AmmGlobalConfig | null;
  /**
   * Review round 2: what the client read in each MintDex lookup table (A, B and the spare C): "full" (the 43-entry
   * layout), "base" (its first 38 entries), or null (missing, inactive, or holding other addresses). The verifier
   * resolves only through tables with a status, cut to that length.
   */
  altStatus?: Record<string, "full" | "base" | null>;
  readAt: number;
}

/** The status of one lookup table account against the cluster layout (pure; exported for tests). */
export function altStatusOf(acc: RpcAccount | null): "full" | "base" | null {
  if (!acc || acc.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM_ID) return null;
  try {
    const t = decodeAddressLookupTable(acc.data);
    return t.isActive ? clusterAltStatus(t.addresses, clusterProfile(APP_CLUSTER), TRUST_ANCHORS.altTreasury) : null;
  } catch {
    return null;
  }
}

const ANCHOR_TTL_MS = 5 * 60_000;
let anchors: Promise<Anchors> | null = null;
let anchorsAt = 0;

/** Genesis check, then Config, pump Global and pAMM GlobalConfig from the public RPC (cached for 5 minutes). */
export function loadAnchors(): Promise<Anchors> {
  if (!anchors || Date.now() - anchorsAt > ANCHOR_TTL_MS) {
    anchorsAt = Date.now();
    anchors = readAnchors().catch((e) => {
      anchors = null;
      throw e;
    });
  }
  return anchors;
}

async function readAnchors(): Promise<Anchors> {
  await assertCluster();
  // The SDK builders derive Config and program accounts from its own constants: they must be our anchors.
  if (MINTDEX_PROGRAM_ID !== TRUST_ANCHORS.programId || configPda() !== TRUST_ANCHORS.configAddress) {
    throw new ChainClientError("VERIFY_FAILED", "The MintDex program constants in this build disagree.");
  }
  const tables = [TRUST_ANCHORS.altA, TRUST_ANCHORS.altB, ...(TRUST_ANCHORS.altC ? [TRUST_ANCHORS.altC] : [])];
  const [cfg, global, amm, ...altAccs] = await getAccounts([TRUST_ANCHORS.configAddress, pumpGlobalPda(), ammGlobalConfigPda(), ...tables]);
  // review round 2: the tables' on-chain prefix, read by the client itself (never the Worker's word)
  const altStatus: Record<string, "full" | "base" | null> = {};
  tables.forEach((t, i) => (altStatus[t] = altStatusOf(altAccs[i] ?? null)));
  if (!cfg || cfg.owner !== TRUST_ANCHORS.programId) {
    throw new ChainClientError("RPC_UNAVAILABLE", `Could not read the MintDex config from ${NET_NAME}.`);
  }
  const config = decodeConfig(cfg.data);
  let pumpGlobal: PumpGlobal | null = null;
  let ammGlobal: AmmGlobalConfig | null = null;
  try {
    if (global && global.owner === PUMP_PROGRAM_ID) pumpGlobal = decodePumpGlobal(global.data);
  } catch {
    pumpGlobal = null;
  }
  try {
    if (amm && amm.owner === PAMM_PROGRAM_ID) ammGlobal = decodeAmmGlobalConfig(amm.data);
  } catch {
    ammGlobal = null;
  }
  return { config, pumpGlobal, ammGlobal, altStatus, readAt: Date.now() };
}

let rent0Value: bigint | null = null;

/** Rent::minimum_balance(0) of the cluster (devnet 650,240), read once. */
export async function rent0(): Promise<bigint> {
  if (rent0Value === null) {
    const v = await publicRpc<number>("getMinimumBalanceForRentExemption", [0]);
    if (typeof v !== "number" || v <= 0) throw new ChainClientError("RPC_UNAVAILABLE", "Could not read the rent figure.");
    rent0Value = BigInt(v);
  }
  return rent0Value;
}

/** Forget every cached read (tests; a later session starts clean). */
export function resetTrust(): void {
  genesis = null;
  anchors = null;
  anchorsAt = 0;
  rent0Value = null;
}

// ---------------------------------------------------------------- per coin (quotes, holders, floors)

/** Safe fee lookup: null when the FeeConfig cannot be decoded (the quote then falls back to the Worker's values). */
function feesFrom(feeAcc: RpcAccount | null, mcapLamports: () => bigint): FeeBps | null {
  if (!feeAcc || feeAcc.owner !== PUMP_FEES_PROGRAM_ID) return null;
  try {
    return feesForMarketCap(decodeFeeConfig(feeAcc.data), mcapLamports());
  } catch {
    return null;
  }
}

export interface CurveContext {
  curve: BondingCurve;
  reserves: CurveReserves;
  fees: FeeBps | null;
  /** The coin mint's token program (Token-2022 for every create_v2 coin). */
  tokenProgram: string;
}

/** The coin's bonding curve, its token program and pump's fees at its market cap; null when unreadable. */
export async function readCurveContext(mint: string): Promise<CurveContext | null> {
  try {
    const [curveAcc, mintAcc, feeAcc] = await getAccounts([bondingCurvePda(mint), mint, pumpFeeConfigPda()]);
    if (!curveAcc || curveAcc.owner !== PUMP_PROGRAM_ID) return null;
    const curve = decodeBondingCurve(curveAcc.data);
    const reserves: CurveReserves = {
      virtualTokenReserves: curve.virtualTokenReserves,
      virtualSolReserves: curve.virtualQuoteReserves,
      realTokenReserves: curve.realTokenReserves,
      realSolReserves: curve.realQuoteReserves,
      tokenTotalSupply: curve.tokenTotalSupply,
      complete: curve.complete,
    };
    const tokenProgram = mintAcc?.owner === TOKEN_PROGRAM_ID ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
    // pump's fee tier reads the market cap on a fixed 1e15 supply basis (pump-sdk getFee), not the live supply.
    const fees = feesFrom(feeAcc, () => curveFeeMarketCap(reserves));
    return { curve, reserves, fees, tokenProgram };
  } catch {
    return null;
  }
}

export interface PoolContext {
  pool: Pool;
  reserves: PoolReserves;
  fees: FeeBps | null;
}

/** The canonical PumpSwap pool, its live reserves and pAMM's fees at its market cap; null when unreadable. */
export async function readPoolContext(mint: string): Promise<PoolContext | null> {
  try {
    const a = coinAddresses(mint);
    const [poolAcc, mintAcc, feeAcc, baseAcc, quoteAcc] = await getAccounts([
      canonicalPoolPda(mint),
      mint,
      ammFeeConfigPda(),
      a.poolBaseTokenAccount,
      a.poolQuoteTokenAccount,
    ]);
    if (!poolAcc || poolAcc.owner !== PAMM_PROGRAM_ID || !mintAcc) return null;
    const pool = decodePool(poolAcc.data);
    let base = baseAcc;
    let quote = quoteAcc;
    if (pool.poolBaseTokenAccount !== a.poolBaseTokenAccount || pool.poolQuoteTokenAccount !== a.poolQuoteTokenAccount) {
      [base, quote] = await getAccounts([pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount]);
    }
    if (!base || !quote) return null;
    const reserves: PoolReserves = {
      baseAmount: decodeTokenAccount(base.data).amount,
      quoteAmount: decodeTokenAccount(quote.data).amount,
      virtualQuoteReserves: pool.virtualQuoteReserves,
      mintSupply: mintSupply(mintAcc.data),
    };
    const fees = feesFrom(feeAcc, () => poolFeeMarketCap(reserves));
    return { pool, reserves, fees };
  } catch {
    return null;
  }
}

/** The card's Listing and Card accounts (holder checks for withdraw); either may be null. */
export async function readListingAndCard(mint: string): Promise<{ listing: ListingAccount | null; card: CardAccount | null }> {
  const [l, c] = await getAccounts([listingPda(mint), cardStatePda(mint)]);
  let listing: ListingAccount | null = null;
  let card: CardAccount | null = null;
  try {
    if (l && l.owner === TRUST_ANCHORS.programId) listing = decodeListing(l.data);
  } catch {
    listing = null;
  }
  try {
    if (c && c.owner === TRUST_ANCHORS.programId) card = decodeCard(c.data);
  } catch {
    card = null;
  }
  return { listing, card };
}

export interface SellerFloor {
  /** sellerFeeFloor over the vault, pump's creator vault, the AMM creator-vault ATA and every vault-owned WSOL account. */
  floor: bigint;
  /** Vault-owned WSOL accounts other than ATA(card_vault, WSOL) (that one is a sweep leg of its own, never an extra). */
  extraWsolAccounts: string[];
  balances: FeeBalances;
}

/**
 * The seller's own fee floor (card-program-v2 §18.9, m3-contract §3.6): read from the public RPC by the seller's
 * client and sent with accept and list builds, so the Worker can only raise it.
 */
export async function readSellerFloor(mint: string): Promise<SellerFloor> {
  await assertCluster();
  const a = coinAddresses(mint);
  const [accounts, wsol, r0] = await Promise.all([
    getAccounts([a.cardVault, a.pumpCreatorVault, a.ammCreatorVaultAta]),
    publicRpc<{ value: Array<{ pubkey: string; account: { lamports: number } }> }>("getTokenAccountsByOwner", [
      a.cardVault,
      { mint: WSOL_MINT },
      { encoding: "base64", commitment: "confirmed" },
    ]),
    rent0(),
  ]);
  const [vault, pumpCv, ammAta] = accounts;
  if (!wsol || !Array.isArray(wsol.value)) throw new ChainClientError("RPC_UNAVAILABLE", "Could not read the card's fee accounts.");
  let ammAmount: bigint | null = null;
  if (ammAta) {
    try {
      ammAmount = decodeTokenAccount(ammAta.data).amount;
    } catch {
      ammAmount = null;
    }
  }
  const balances: FeeBalances = {
    vaultLamports: vault?.lamports ?? 0n,
    pumpCreatorVaultLamports: pumpCv?.lamports ?? 0n,
    ammVaultAtaAmount: ammAmount,
    vaultWsolAccountLamports: wsol.value.map((x) => BigInt(x.account.lamports)),
    rent0: r0,
  };
  return {
    floor: sellerFeeFloor(balances),
    extraWsolAccounts: wsol.value.map((x) => x.pubkey).filter((p) => p !== a.vaultWsolAta),
    balances,
  };
}
