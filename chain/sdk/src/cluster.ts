// Per-cluster constants (refs/mainnet/design-compat.md §6.2, started with O2 and O5). Devnet stays the default
// everywhere; nothing reads the mainnet profile unless a deployment says CLUSTER = "mainnet". Every value below is a
// measured fact with its source, so a change on either cluster is a reviewed edit here, never a silent default.
//
// Fix pack (fix-plan §4.1): the pump recipient lists, the 43-entry lookup-table layout (the 38 + the 4 collection PDAs
// + the Metaplex program, admin B6), the foreign operational keys (compat L5) and the crank priority defaults.
import { toAddress } from "./address.ts";
import type { Address, AddressLike } from "./address.ts";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  DEVNET_PUMP_WITHDRAW_AUTHORITY,
  MAINNET_GENESIS_HASH,
  MINTDEX_PROGRAM_ID,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PYTH_SOL_USD_PRICE_ACCOUNT,
} from "./constants.ts";
import { mintdexAltAddresses } from "./mintdex/alt.ts";
import { collectionAddresses } from "./pda.ts";

export type Cluster = "devnet" | "mainnet";

export interface ClusterProfile {
  cluster: Cluster;
  genesisHash: string;
  walletChain: "solana:devnet" | "solana:mainnet";
  /** 4HTSBY… on both clusters (decision D1; the O4 placeholder claims it on mainnet). */
  programId: Address;
  /**
   * Metaplex Token Metadata's NFT creation fee, charged on the metadata account at CreateV1 and not refundable.
   * devnet: measured on the M3 launches; mainnet: 8 landed CreateMetadataAccountV3 and read-only CreateV1 simulations
   * (2026-10-06, chain/scripts/mainnet/03-launch-cost.out.json). A flat 10,000,000 lamports on both builds.
   */
  metaplexCreationFeeLamports: bigint;
  /**
   * Largest fresh create_v2 bonding curve (bytes): devnet 174; mainnet 166 since pump's 2026-10-08 redeploy (live
   * creates, 02-pump-compat.js C1 and C7; 141 or 151 B before it). Devnet's redeploy made its fresh curves 166 B too,
   * so 174 stays an upper bound there. Rents are estimated with this; the Worker uses the measured length from the
   * launch simulation when it has one.
   */
  freshCurveLenMax: number;
  /** Highest transaction version the indexer asks the RPC for (maxSupportedTransactionVersion, O2). */
  maxTxVersion: number;
  /**
   * A public, successful v1 transaction on this cluster: the Watchdog fetches it once a day to prove the configured
   * RPC serves v1 in the shape the indexer reads (O2). null where no v1 traffic was seen (devnet, 2026-10-06).
   */
  txVersionProbeSig: string | null;
  /** Appended to explorer links ("?cluster=devnet" / ""). */
  explorerQuery: string;
  /** Sign In With Solana chain id (a devnet sign-in can never be replayed on mainnet). */
  siwsChainId: "devnet" | "mainnet";
  /** pump `Global.fee_recipient` + `fee_recipients` (8): ALT entries 9..16. */
  pumpFeeRecipients: readonly Address[];
  /** pump `Global.buyback_fee_recipients` (8): ALT entries 17..24. */
  pumpBuybackFeeRecipients: readonly Address[];
  /** pump `Global.withdraw_authority` (writable in `migrate`). */
  pumpWithdrawAuthority: Address;
  /**
   * The other cluster's operational keys (treasury, crank, ALTs, test wallets): a Worker refuses a TREASURY,
   * CRANK_PUBKEY, ALT or crank secret that is one of these (compat L5).
   */
  foreignOperationalKeys: readonly Address[];
  /** Crank observation priority (µlamports per CU): fixed per cluster, doubled on a send that does not land (§4.2.5). */
  crankCuPrice: number;
  /** Ceiling of the escalation (separate from the client verifier cap). */
  crankCuPriceMax: number;
  /** "SOL" wording for user copy ("devnet SOL" on devnet). */
  solLabel: string;
}

/**
 * Devnet operational keys (public): test wallet / treasury, crank, ALT A and B, alice, bob, and the devnet observer
 * keys (standby 83secu…, watcher 3B2ZV8…): a mainnet Worker or watcher refuses any of them (review round 2: a watcher
 * key reused across clusters would sign on the wrong one).
 */
export const DEVNET_OPERATIONAL_KEYS: readonly Address[] = [
  "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj",
  "ELqqNK1m7nFPvV6s3maE5BYxfxgEJR5VMWqjaCgzHLD",
  "ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW",
  "5ZirDYYECSxPV2nxn5icHiPJqxZKQJZpt4TBVzAhqEgg",
  "BiHs2Ds6u3tHrmD5CzoHAyR79uC5VhdPH51ii4Y7dFtQ",
  "HGXEqHkPAcK7vfGZxCKG1UbXdQsZrhuBKuMUKiga83ER",
  "83secuJhm1zhSXkMuZ4HJa7BSChT9m7dUC4ywH95pBua",
  "3B2ZV8zcJX6QEPWGEbDssnMtw7wRruVxZtnxj9tkCf1R",
];

/**
 * Mainnet pump `Global` recipients and withdraw authority (chain/scripts/mainnet/00-facts.out.json, 2026-10-06;
 * 22-alt.js refuses to build the ALTs if the live Global differs). The buyback recipients equal devnet's.
 */
export const MAINNET_PUMP_FEE_RECIPIENTS: readonly Address[] = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
];
export const MAINNET_PUMP_BUYBACK_FEE_RECIPIENTS: readonly Address[] = DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS;
export const MAINNET_PUMP_WITHDRAW_AUTHORITY: Address = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";

export const DEVNET_PROFILE: ClusterProfile = Object.freeze({
  cluster: "devnet",
  genesisHash: DEVNET_GENESIS_HASH,
  walletChain: "solana:devnet",
  programId: MINTDEX_PROGRAM_ID,
  metaplexCreationFeeLamports: 10_000_000n,
  freshCurveLenMax: 174,
  maxTxVersion: 1,
  txVersionProbeSig: null,
  explorerQuery: "?cluster=devnet",
  siwsChainId: "devnet",
  pumpFeeRecipients: DEVNET_PUMP_FEE_RECIPIENTS,
  pumpBuybackFeeRecipients: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  pumpWithdrawAuthority: DEVNET_PUMP_WITHDRAW_AUTHORITY,
  // filled with the mainnet operational keys once deployed.mainnet.json exists (the user creates them)
  foreignOperationalKeys: [],
  crankCuPrice: 10_000,
  crankCuPriceMax: 100_000,
  solLabel: "devnet SOL",
}) as ClusterProfile;

export const MAINNET_PROFILE: ClusterProfile = Object.freeze({
  cluster: "mainnet",
  genesisHash: MAINNET_GENESIS_HASH,
  walletChain: "solana:mainnet",
  programId: MINTDEX_PROGRAM_ID,
  metaplexCreationFeeLamports: 10_000_000n,
  freshCurveLenMax: 166,
  maxTxVersion: 1,
  // a third-party pump trade sent as version 1, slot 453,789,184 (captured read-only 2026-10-06; it is also the
  // chain-worker indexer fixture test/fixtures/tx-v1/mainnet-pump-trade-v1.json)
  txVersionProbeSig: "4fNyNnWST8iFoJDnZgjUoYeochunfwjfYPWD3wqLQKhXh1FdSD7XTtJN7tRBgh7VLS7qJDtnP3mBLw5AKZre9YZw",
  explorerQuery: "",
  siwsChainId: "mainnet",
  pumpFeeRecipients: MAINNET_PUMP_FEE_RECIPIENTS,
  pumpBuybackFeeRecipients: MAINNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  pumpWithdrawAuthority: MAINNET_PUMP_WITHDRAW_AUTHORITY,
  foreignOperationalKeys: DEVNET_OPERATIONAL_KEYS,
  // a fixed observation priority well above the median for small transactions; escalation doubles it per missed send
  crankCuPrice: 50_000,
  crankCuPriceMax: 1_000_000,
  solLabel: "SOL",
}) as ClusterProfile;

/** The profile for a deployment's CLUSTER value; throws on anything else (never a silent devnet default). */
export function clusterProfile(name: string | undefined | null): ClusterProfile {
  if (name === "devnet") return DEVNET_PROFILE;
  if (name === "mainnet" || name === "mainnet-beta") return MAINNET_PROFILE;
  throw new Error(`unknown cluster ${JSON.stringify(name)} (devnet or mainnet)`);
}

/** The cluster a genesis hash belongs to, or null (testnet, localnet, anything else). */
export function clusterOfGenesis(hash: string): Cluster | null {
  if (hash === DEVNET_GENESIS_HASH) return "devnet";
  if (hash === MAINNET_GENESIS_HASH) return "mainnet";
  return null;
}

/** The 5 entries the fix pack appends to the 38 (ALT entries 39..43): the 4 collection PDAs and the Metaplex program (admin B6). */
export function collectionAltExtension(): Address[] {
  const c = collectionAddresses();
  return [c.authority, c.mint, c.metadata, c.edition, MPL_TOKEN_METADATA_PROGRAM_ID];
}

/**
 * The MintDex lookup-table layout for a cluster: the 38 (card-program-v2 §10.1) with the profile's pump recipients,
 * then (`withCollection`, default) the 5 collection entries. Devnet ALTs A and B hold the 38 today and are extended
 * append-only (§5 step 9), so a table whose first 38 entries match is still valid for every non-collection template.
 */
export function clusterAltAddresses(p: ClusterProfile, treasury: AddressLike, opts: { withCollection?: boolean } = {}): Address[] {
  const base = mintdexAltAddresses({
    treasury,
    pumpFeeRecipients: p.pumpFeeRecipients,
    pumpBuybackFeeRecipients: p.pumpBuybackFeeRecipients,
    pythPriceAccount: PYTH_SOL_USD_PRICE_ACCOUNT,
  });
  return opts.withCollection === false ? base : [...base, ...collectionAltExtension()];
}

/**
 * How a fetched lookup table matches the cluster layout: "full" (the 43, the collection launch fits), "base" (the 38
 * only, an unextended table: every template except the collection launch), or null (not a MintDex table). Extra
 * entries appended after the layout are allowed (tables are append-only).
 */
export function clusterAltStatus(fetched: readonly AddressLike[], p: ClusterProfile, treasury: AddressLike): "full" | "base" | null {
  const want = clusterAltAddresses(p, treasury);
  const got = fetched.map((a) => toAddress(a));
  const prefix = (n: number) => got.length >= n && want.slice(0, n).every((a, i) => got[i] === a);
  if (prefix(want.length)) return "full";
  if (prefix(want.length - 5)) return "base";
  return null;
}

/** True when `key` is one of the other cluster's operational keys (compat L5). */
export const isForeignOperationalKey = (p: ClusterProfile, key: AddressLike): boolean =>
  p.foreignOperationalKeys.includes(toAddress(key));
