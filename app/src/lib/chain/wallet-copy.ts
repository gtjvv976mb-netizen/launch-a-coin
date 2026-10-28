// Every visible word of the devnet wallet surfaces (refs/chain/m3-contract.md §2.2, §8.4): the picker, the
// connected wallet's menus, the network notice and the handle dialog. Only lazy chunks import this module (the
// main chunk's Connect words are connect-copy.ts; the signing steps and error sentences are tx-copy.ts), C10.
// Chain builds only: nothing here is reachable from the simulation, and nothing here mentions test SOL, faucets in the
// app, or bots (C9). The devnet and mainnet words are separate objects, so each bundle carries only its own.
// Rules: plain English, no em dashes, en dashes or middle dots (app/tests/chain/copy.test.ts greps this file).
// Owner: app:wallet.

import { CONNECT_COPY } from "./connect-copy";
import { APP_CLUSTER } from "./env";

/**
 * The public faucet the wallet menus link to on devnet (the app has no faucet of its own). Empty on mainnet: the menus
 * render no faucet link there, and the URL is not in the mainnet bundle.
 */
export const FAUCET_URL: string = APP_CLUSTER === "mainnet" ? "" : "https://faucet.solana.com";

/** The wallets' official download pages, for a desktop browser with no Solana wallet installed (both builds). */
export const WALLET_DOWNLOADS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Get Phantom", href: "https://phantom.com/download" },
  { label: "Get Solflare", href: "https://solflare.com/download" },
  { label: "Get Backpack", href: "https://backpack.app/downloads" },
];

/** Words with no network name in them (both builds). */
const SHARED_WALLET_COPY = {
  ...CONNECT_COPY,
  pickerTitle: "Connect a wallet",
  pickerEmpty: "No Solana wallet found in this browser.",
  /** Under the install links (desktop). */
  pickerInstall: "Install one, then reload this page.",
  /** Phones without a wallet in the browser: the wallet apps open MintDex in their own browser. */
  pickerPhone: "Open MintDex in your wallet app to connect.",
  openInPhantom: "Open in Phantom",
  openInSolflare: "Open in Solflare",
  copyAddress: "Copy address",
  addressCopied: "Address copied.",
  copyFailed: "Could not copy. Your address:",
  viewExplorer: "View on Solana Explorer",
  openPortfolio: "Open portfolio",
  switchWallet: "Switch wallet",
  disconnect: "Disconnect",
  disconnected: "Wallet disconnected.",
  connected: (name: string) => `${name} connected.`,
  connectFailed: "The wallet did not connect. Try again.",
  balanceLabel: "Balance",
  balanceLoading: "Reading balance...",
  accountTitle: "Your wallet",
  setHandle: "Set a handle",
  editHandle: "Change handle",
  handleTitle: "Your handle",
  handleBody:
    "A handle shows next to your address on MintDex. Your wallet signs a short message to prove the address is yours. It sends no transaction and costs nothing.",
  handleHelp: "3 to 16 characters: lowercase letters, numbers or underscores.",
  handleInvalid: "Handles need 3 to 16 characters: lowercase letters, numbers or underscores.",
  handleReserved: "That handle is reserved. Try another one.",
  handleEmpty: "Pick a handle first.",
  handleSave: "Sign in and save",
  handleSaving: "Saving...",
  handleSaved: (h: string) => `You are @${h} now.`,
  handleNoSign: "This wallet cannot sign messages, so it cannot set a handle.",
};

/** The words that name the network, per cluster. */
type NetWalletCopy = {
  pickerBody: string;
  /** The small label beside the balance in the account sheet. */
  solNote: string;
  /** Under the wallet picker. */
  valueNote: string;
  /** The faucet link label (devnet; never rendered on mainnet, where FAUCET_URL is empty). */
  getSol: string;
  faucetHint: string;
  switchNetwork: string;
  switchNetworkShort: string;
  switchNetworkHow: string;
};

const DEVNET_WALLET_COPY: NetWalletCopy = {
  pickerBody: "MintDex runs on Solana devnet. Pick a wallet that is set to devnet.",
  solNote: "Devnet SOL only",
  valueNote: "Devnet SOL has no real value.",
  getSol: "Get devnet SOL",
  faucetHint: "Free devnet SOL comes from public faucets.",
  switchNetwork: "Switch your wallet to devnet",
  switchNetworkShort: "Not on devnet",
  switchNetworkHow:
    "This wallet account is not on Solana devnet. In Phantom: Settings, Developer Settings, Testnet Mode, Solana Devnet. Solflare and Backpack have a devnet setting too.",
};

/** The mainnet build's wallet words (compat §6.4): no faucet, no devnet setting, a short real-money notice. */
const MAINNET_WALLET_COPY: NetWalletCopy = {
  pickerBody: "MintDex runs on Solana mainnet. Pick a wallet that is set to mainnet.",
  solNote: "Real SOL",
  valueNote: "This is real SOL. Only spend what you can afford to lose.",
  getSol: "Add SOL",
  faucetHint: "Add SOL to your wallet from an exchange or another wallet.",
  switchNetwork: "Switch your wallet to mainnet",
  switchNetworkShort: "Not on mainnet",
  switchNetworkHow: "This wallet account is not on Solana mainnet. Turn off the test network setting in your wallet, then try again.",
};

export const WALLET_COPY: typeof SHARED_WALLET_COPY & NetWalletCopy = {
  ...SHARED_WALLET_COPY,
  ...(APP_CLUSTER === "mainnet" ? MAINNET_WALLET_COPY : DEVNET_WALLET_COPY),
};
