// Devnet trust anchors (refs/chain/m3-contract.md §7.3, R21): the values the devnet build verifies against. Unchanged
// from the M3 go-live; env.ts picks this set unless the build is VITE_MINTDEX_MODE=mainnet. Same shape as the
// generated anchors.mainnet.ts. The devnet API origin and RPC can be overridden for local work (VITE_CHAIN_API_ORIGIN,
// VITE_SOLANA_PUBLIC_RPC); the mainnet build takes both from its anchors file only.

/**
 * True once https://devnet.mintdex.fun/api/chain/health answers "devnet" (DNS record U4 plus the m3 routes, B0). Until
 * then the devnet build calls the m3 Worker on mintdex.fun/api/chain/*, which it owns before the cutover: a build that
 * names a host with no DNS record fails every chain read (SSR and browser). Launch day B3 sets it to true.
 */
export const DEVNET_HOST_LIVE = true;

export const DEVNET_ANCHORS = {
  cluster: "devnet",
  /** Solana devnet genesis hash; anything else (mainnet 5eykt4…) is refused. */
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  programId: "",
  configAddress: "",
  /** The only lookup tables a verified tx may use (allowedLookupTables). */
  altA: "",
  altB: "",
  /** The spare table C (admin B6); none on devnet. */
  altC: "",
  /** The treasury the ALTs were created with: lookupTables = clusterAltAddresses(profile, altTreasury). */
  altTreasury: "",
  /**
   * The devnet chain Worker (env m3) on its own host (launch-plan §1.1, fix-plan §4.4): the devnet site keeps working on
   * devnet.mintdex.fun and on mintdex.fun before the cutover (m3 ALLOWED_ORIGINS lists both), and after the cutover
   * mintdex.fun/api/chain/* belongs to the mainnet Worker. Needs the devnet DNS record (launch-plan U4): until
   * DEVNET_HOST_LIVE, mintdex.fun.
   */
  chainApiOrigin: "http://127.0.0.1:8788",
  publicRpc: "http://127.0.0.1:8899",
  walletChain: "solana:devnet",
  explorerQuery: "?cluster=devnet",
} as const;
