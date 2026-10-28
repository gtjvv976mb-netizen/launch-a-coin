// Build-time variables (Vite replaces each with a literal in both the client and the SSR build).
// refs/chain/m3-contract.md §1.2 and §2, refs/mainnet/app-mainnet.md. Never put a secret or a keyed RPC URL in a VITE_
// variable: they ship to browsers.
interface ImportMetaEnv {
  /** Unset (the platform build of main): devnet. "sim": the simulation. "mainnet": the guarded real-money build. */
  readonly VITE_MINTDEX_MODE?: string;
  /** Mainnet only: must equal the program id, or vite.config.ts refuses the build. */
  readonly VITE_MINTDEX_MAINNET_ACK?: string;
  /**
   * Devnet and sim: origin of the mintdex-chain API (default https://devnet.mintdex.fun; local: http://127.0.0.1:8788).
   * Mainnet: comes from src/lib/chain/anchors.mainnet.ts; if set here it must equal that file.
   */
  readonly VITE_CHAIN_API_ORIGIN?: string;
  /**
   * Devnet: public RPC for browser trust reads (default https://api.devnet.solana.com). Mainnet: comes from
   * anchors.mainnet.ts (a keyless, origin-locked endpoint); if set here it must equal that file.
   */
  readonly VITE_SOLANA_PUBLIC_RPC?: string;
}
