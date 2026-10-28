// CardDex is an independent local simulation until its own pump.fun + NFT adapter is configured.
// Inherited MintDex chain implementations are source references, never active defaults.
export type Mode = "sim" | "devnet" | "mainnet";
export const MODE: Mode = "sim" as Mode;
export const IS_SIM = MODE === "sim";
export const IS_DEVNET = MODE === "devnet";
export const IS_MAINNET = MODE === "mainnet";
export const IS_CHAIN = MODE !== "sim";
export const CLUSTER: "devnet" | "mainnet" = MODE === "mainnet" ? "mainnet" : "devnet";
