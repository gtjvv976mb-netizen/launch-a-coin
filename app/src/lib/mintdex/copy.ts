// Mode-dependent words (backlog P0-5) and the glossary (P0-9) in one place.
//
// Every claim the site makes about what is real (the curve, the money, the addresses, the traders) reads from
// MODE_COPY, so flipping MODE in mode.ts changes them all at once. The fee and design words come from GLOSSARY
// and the sentences below, so the guide, the coin page, Market and Launch say the same thing.
// Server-safe and client-safe: plain data with shared mode, fee and bidding policy. Visible copy rules: no em
// dashes, no en dashes, no middle dots.

import {
  CREATOR_ROYALTY_BPS,
  DEED_PROTOCOL_BPS,
  FAUCET_AMOUNT,
  OWNER_FEE_BPS,
  SOL_USD,
  START_BALANCE,
  LAMPORTS,
  TRADE_FEE_BPS,
} from "./constants";
import { untilText } from "./format";
import { IS_MAINNET, IS_SIM, MODE } from "./mode";
import { CARD_BIDDING_SUSPENDED } from "./card-bidding";

export { IS_SIM, MODE, type Mode } from "./mode";

/** Basis points as a percent: 100 -> "1%", 50 -> "0.5%", 250 -> "2.5%". */
export function pct(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

const START_SOL = (START_BALANCE / LAMPORTS).toLocaleString("en-US");

export type ModeCopy = {
  /** Small pill beside the wordmark (rail lockup and MobileHeader). Empty means no pill. */
  badge: string;
  /** One or two sentences for the badge popover and the guide. */
  explainer: string;
  /** Appended to the site description and og:description. */
  metaSuffix: string;
  /** Appended to every coin description and share text. Never a $ figure in sim (decision C5). */
  coinQualifier: string;
  /** Slate footnote on the coin page and Levels. */
  usdNote: string;
  /** Label of the address row on the coin page (decision C6). */
  addressLabel: string;
  /** Button that copies that address. */
  copyAddress: string;
  /** Toast after the address is copied. */
  addressCopied: string;
  /** Body of the coin not-found page when someone pastes a Solana address. */
  addressNotFound: string;
  /** Home: the line under the display headline that says what is real. */
  hero: string;
  /** Launch page context line. */
  launchContext: string;
  /** Guide step 1 body. */
  guideLaunch: string;
  /** The guide's closing note: what the money is. */
  guideNote: string;
  /** Coin page, when the bonding curve sold out. */
  curveComplete: string;
  /** Under the activity heading (Home) and in the badge popover. Empty means no line. */
  botsNote: string;
  /** The wallet's currency in words ("test SOL"), for labels read aloud. */
  walletUnit: string;
  /** Signed-out trade ticket, in place of a 0.00 balance. */
  enterForSol: string;
  /** Enter dialog: where the account lives. */
  accountNote: string;
  /** Enter dialog, after the reason: what a new player gets and what it is worth. Empty means no line. */
  enterGift: string;
  /** Welcome toast after Enter, after "Welcome, @handle.": what is in the new wallet. Empty means nothing more. */
  enterWelcome: string;
  /** Portfolio header context line under the handle. */
  walletContext: string;
  /** Signed-out Portfolio, the empty binder's body. */
  portfolioSignedOut: string;
  /** Rail, under the wallet card. */
  walletNote: string;
  /** Rail, under the signed-out Enter button. Empty means no line. */
  railStart: string;
  /** Appended to share text and the X post. */
  shareSuffix: string;
};

// devnet and mainnet are provisional: confirm them when MODE flips (M4).
// One top-level constant per mode, picked by MODE below: Vite makes MODE a literal, so the minifier drops the
// other modes' strings from each build (C9: the devnet client bundle carries no simulation words).
const SIM_COPY: ModeCopy = {
  badge: "Demo",
  explainer: "Demo: simulated pump.fun trading and NFT cards with test SOL. No real coins or funds.",
  metaSuffix: "A demo with test SOL.",
  coinQualifier: "Demo: simulated market.",
  usdNote: `USD at a fixed $${SOL_USD} per SOL (test rate)`,
  addressLabel: "Test address, not on chain",
  copyAddress: "Copy test address",
  addressCopied: "Test address copied.",
  addressNotFound:
    "Launch a Card runs as a demo for now, so coins on Solana devnet or mainnet do not have cards here yet. Only demo coins live in this collection.",
  hero: "Try it with test SOL on a simulated pump.fun curve.",
  launchContext:
    "Choose a permanent card design, add your token, and try the pump.fun launch flow with test SOL.",
  guideLaunch:
    "Choose a design, add your token art and launch. The demo creates a simulated token and one-of-one card in your collection.",
  guideNote: "Demo: separate test balances and a simulated bonding curve. No real coin or NFT is minted.",
  curveComplete: "Curve complete (simulated)",
  botsNote: "Includes demo bots.",
  walletUnit: "test SOL",
  enterForSol: `Try the demo for ${START_SOL} test SOL`,
  accountNote: "Your test account lives in this browser. Clearing site data ends access to it.",
  enterGift: `You get ${START_SOL} test SOL. The demo uses no real funds.`,
  enterWelcome: `${START_SOL} test SOL is in your wallet.`,
  walletContext: "Test wallet",
  portfolioSignedOut: `Try the demo to get a test wallet with ${START_SOL} test SOL. Your coins and cards will live here.`,
  walletNote: "Test SOL only",
  railStart: `Get ${START_SOL} test SOL to start. No real funds.`,
  shareSuffix: " (demo)",
};
const DEVNET_COPY: ModeCopy = {
  badge: "Devnet",
  explainer: "Launch a Card runs on Solana devnet, a free test network. Devnet SOL has no real value.",
  metaSuffix: "Live on Solana devnet.",
  coinQualifier: "Solana devnet coin, no real value.",
  usdNote: "USD figures: devnet ×100 at $118 per SOL",
  addressLabel: "Devnet mint address",
  copyAddress: "Copy mint address",
  addressCopied: "Mint address copied.",
  addressNotFound:
    "No Launch a Card card uses that mint address. Only coins launched on Launch a Card have cards.",
  hero: "Try it on Solana devnet, where SOL has no real value.",
  launchContext:
    "Launch on pump.fun (Solana devnet) with an address ending in mint, and get its one-of-one card.",
  guideLaunch:
    "Name it, add art and a description. It launches on pump.fun on Solana devnet with an address ending in mint, and you receive its one-of-one card.",
  guideNote: "Devnet: SOL here has no real value.",
  curveComplete: "Curve complete, trading on PumpSwap",
  botsNote: "",
  walletUnit: "devnet SOL",
  enterForSol: "Connect a wallet to trade",
  accountNote: "",
  enterGift: "",
  enterWelcome: "",
  walletContext: "Devnet wallet",
  portfolioSignedOut: "Connect a wallet to see your tokens and cards here.",
  walletNote: "Devnet SOL only",
  railStart: "Test tokens have no monetary value.",
  shareSuffix: " (devnet)",
};
const MAINNET_COPY: ModeCopy = {
  badge: "",
  explainer: "",
  metaSuffix: "",
  coinQualifier: "",
  usdNote: "",
  addressLabel: "Mint address",
  copyAddress: "Copy mint address",
  addressCopied: "Mint address copied.",
  addressNotFound:
    "No Launch a Card card uses that mint address. Only coins launched on Launch a Card have cards.",
  hero: "Launch on pump.fun with an address ending in mint.",
  launchContext: "Launch on pump.fun with an address ending in mint, and get its one-of-one card.",
  guideLaunch:
    "Name it, add art and a description. It launches on pump.fun with an address ending in mint, and you receive its one-of-one card.",
  guideNote: "",
  curveComplete: "Curve complete, trading on PumpSwap",
  botsNote: "",
  walletUnit: "SOL",
  enterForSol: "Connect a wallet to trade",
  accountNote: "",
  enterGift: "",
  enterWelcome: "",
  walletContext: "Wallet",
  portfolioSignedOut: "Connect a wallet to see your tokens and cards here.",
  walletNote: "",
  railStart: "",
  shareSuffix: "",
};

export const MODE_COPY: ModeCopy =
  MODE === "devnet" ? DEVNET_COPY : MODE === "mainnet" ? MAINNET_COPY : SIM_COPY;

/**
 * The small tag beside simulated market figures (market cap, 24h change, trades) in test mode, and what the bot chip
 * means. Empty off sim: real figures carry no tag.
 */
export const SIM_TAG = IS_SIM ? "Simulated" : "";
export const SIM_TAG_HINT = "Simulated market data in the demo, not live quotes";
export const BOT_HINT = "Simulated trader in the demo";

/** The one label for "go and look at the coins" (Home hero, not-found pages, empty states): links to /discover. */
export const EXPLORE_COINS = "Explore coins";

/** Home and the app shell: short labels (UX pass 2026-10-11). */
export const HOME_COPY = {
  howItWorks: "How it works",
  viewCoin: "View coin",
  /** Under "Trending": what the order is. The list is ranked by 24h volume, then by the latest trade. */
  trendingByVolume: "By 24h volume",
  trendingByLatest: "By latest trade",
  goHome: "Go home",
  /** The Devnet badge's faucet link (devnet build only; MODE is a literal, so other bundles drop the words). */
  getDevnetSol: MODE === "devnet" ? "Get devnet SOL" : "",
} as const;

/** Coin not-found page (P0-10): one title, a body per reason. */
export const COIN_NOT_FOUND = {
  title: "This coin does not exist",
  unknown: "No coin goes by that name or ticker. Check the spelling.",
  address: MODE_COPY.addressNotFound,
  action: EXPLORE_COINS,
  several: "More than one coin goes by that name",
  severalBody: "Pick the one you mean.",
} as const;

/** Coin page words (both modes): the details disclosure, the chart before trades, the unlock row, the fee vault. */
export const COIN_COPY = {
  details: "Coin details",
  chartNone: "No trades yet. The chart starts with the first trade.",
  chartOne: "Only 1 trade so far. The chart fills in as people trade.",
  unlockReady: (name: string) => `The market cap reached ${name}.`,
  unlockAction: "Unlock design",
  unlockStarting: "Starting...",
  unlockPaused: "Unlocks are paused for now.",
  unlocking: (name: string, step: string) => `Unlocking ${name}: ${step}`,
  unlockReset: "The market cap dipped, so the unlock reset.",
  readyForHolder: "Ready for the holder now",
  paidOut: "Paid out so far",
  feeBreakdown: "Show the breakdown",
} as const;

/** Any other unknown page. */
export const PAGE_NOT_FOUND = {
  title: "This page does not exist",
  body: "The link may be wrong, or the page moved.",
  action: EXPLORE_COINS,
  home: HOME_COPY.goHome,
} as const;

/** A route that failed to load, shown inside the app shell so the nav stays. */
export const ROUTE_ERROR = {
  title: "This page did not load",
  body: "Something went wrong on our side. Try again, or head back home.",
  retry: "Try again",
  home: HOME_COPY.goHome,
} as const;

/**
 * Glossary (P0-9, decision C3). The UI uses exactly these words. "Creator fee" appears once, in the guide,
 * to explain pump.fun's own term.
 */
export const GLOSSARY = {
  cardFees: "card fees",
  cardFeesStat: "Card fees (all time)",
  feeVault: "fee vault",
  claimable: "claimable",
  resaleRoyalty: "resale royalty",
  launcher: "launcher",
  design: "design",
  oneOfOne: "one-of-one",
} as const;

/**
 * Devnet fee rates (refs/chain/pump-devnet-facts.md §1, §4, §10; card-program-v2 §13 step 7): pump charges 1.25%
 * per trade (0.95% protocol, 0.30% creator fee, the same total on PumpSwap below 420 SOL market cap), and the
 * 0.30% creator fee is what fills the card's fee vault. Card sales: 2.5% protocol fee and a 5% resale royalty.
 */
const DEVNET_TRADE_FEE_BPS = 125;
const DEVNET_CARD_FEE_BPS = 30;

const TRADE_BPS = IS_SIM ? TRADE_FEE_BPS : DEVNET_TRADE_FEE_BPS;
const VAULT_BPS = IS_SIM ? OWNER_FEE_BPS : DEVNET_CARD_FEE_BPS;

/** The fee figures in words, from constants.ts (sim) or the devnet rates above. */
export const FEES = {
  trade: IS_MAINNET ? "Variable" : pct(TRADE_BPS),
  vault: IS_MAINNET ? "Creator fees" : pct(VAULT_BPS),
  protocol: IS_MAINNET ? "Variable" : pct(TRADE_BPS - VAULT_BPS),
  sale: pct(DEED_PROTOCOL_BPS),
  royalty: pct(CREATOR_ROYALTY_BPS),
  /** "half" when the vault share is half the trade fee, else "0.5%". */
  vaultShare: IS_MAINNET
    ? "the creator fee"
    : VAULT_BPS * 2 === TRADE_BPS
      ? "half"
      : pct(VAULT_BPS),
} as const;

/** The fee vault's share of a trade in basis points (FEES.vault as a number), for worked examples. */
export const CARD_FEE_BPS = IS_MAINNET ? null : VAULT_BPS;

/** One set of fee sentences (P0-9), shared by the coin page, Market, Launch and the guide. */
export const WORDS = {
  /** Owner's note under the card section, and the seller's side of every card sale. */
  salesNote: `Card sales pay a ${FEES.sale} protocol fee and a ${FEES.royalty} resale royalty to the launcher.`,
  /** Why anyone would own a card: "Own this card to collect 0.5% of every $GLORB trade." */
  ownThisCard: (ticker: string) =>
    IS_MAINNET
      ? `Own this card to collect $${ticker} creator fees. The rate follows pump.fun's fee schedule.`
      : `Own this card to collect ${FEES.vault} of every $${ticker} trade.`,
  escrow: "Bids are held in escrow until accepted or cancelled.",
  /** Market context line. */
  marketContext:
    !IS_SIM && CARD_BIDDING_SUSPENDED
      ? "Explore every coin's one-of-one card. New bids are paused until Launch a Card is funded."
      : IS_MAINNET
        ? "Bid on any coin's one-of-one card. Its owner collects the coin's creator fees at pump.fun's current rates."
        : `Bid on any coin's one-of-one card. Its owner collects ${FEES.vault} of every trade as card fees.`,
  /** Launch, under Mint and launch. */
  launcherLine: "Your selected design belongs to your token from the first card.",
  /** Home, the second line under the headline (P1-27). */
  heroBid: "Launch a coin on pump.fun. Give it a card worth collecting.",
  /** Trade ticket fee row. */
  tradeFeeLabel: `Demo trading fee ${FEES.trade}`,
  cardIncome: IS_MAINNET
    ? "A card earns its coin's creator fees at pump.fun's current rates. If trading stops, the card earns nothing."
    : `A card's income is ${FEES.vault} of its coin's trades. If trading stops, the card earns nothing.`,
  /** Launch, the content rule line (P1-28), after a "Content rules" link: one line above Mint and launch. */
  contentRule: "no scams, impersonation, hate or stolen art.",
} as const;

/** Market (UX pass 2026-10-11): the tabs, one empty state per tab, the fee disclosure's title, a gone card. */
export const MARKET_COPY = {
  tabs: { all: "All cards", listed: "For sale", bids: "With bids" },
  empty: {
    all: {
      title: "No cards yet",
      body: "Launch a coin to mint the first card.",
      action: "Launch a coin",
    },
    listed: {
      title: "No cards for sale yet",
      body: "Owners list a card from its page.",
      action: "See all cards",
    },
    bids: {
      title: !IS_SIM && CARD_BIDDING_SUSPENDED ? "Bidding is paused" : "No bids yet",
      body:
        !IS_SIM && CARD_BIDDING_SUSPENDED
          ? "New bids are paused until Launch a Card is funded. You can still explore every card."
          : "Open any card to place the first bid.",
      action: "See all cards",
    },
  },
  feesTitle: "Fees and escrow",
  gone: "This card is gone",
  explore: "Explore coins",
} as const;

/** Discover (UX pass 2026-10-11): the design filter and one empty state per cause. */
export const DISCOVER_COPY = {
  allDesigns: "All designs",
  /** The design filter's way to the full ladder on /levels. */
  levelsLink: "Explore card designs",
  noMatch: (q: string) => `No coin matches “${q}”`,
  noMatchBody: "Try a name or a ticker.",
  clearSearch: "Clear search",
  noDesign: (name: string) => `No coin has the ${name} design yet`,
  noDesignBody: "A design unlocks as the market cap grows.",
  noBoth: "No cards match",
  noBothBody: "Try another design or clear the search.",
  clearFilters: "Clear filters",
} as const;

/**
 * Share text for a coin (P1-12): no $ figure, no price talk, and the mode qualifier off mainnet (decision C5). The X
 * intent adds the coin page link and via @mintdexdotfun. Mainnet adds what the card does, in the glossary's words.
 */
export function shareCoinText(coin: { name: string; ticker: string }): string {
  const base = `${coin.name} ($${coin.ticker}) has a one-of-one card on Launch a Card${MODE_COPY.shareSuffix}`;
  return MODE === "mainnet"
    ? `${base}. Whoever holds the card collects the coin's ${GLOSSARY.cardFees}.`
    : base;
}

/**
 * The mainnet Risks tab's line (launch-plan §5, the user's full-launch decision of 2026-10-06), word for word. Remove it
 * after the external audit, and bump the Terms date in routes/legal.tsx.
 */
export const AUDIT_LINE =
  "The Launch a Card card program has not had an external security audit yet. This line will be removed after one.";

/** The official X account. */
export const X_HANDLE = "mintdexdotfun";
export const X_URL = `https://x.com/${X_HANDLE}`;

/** Report reasons (P1-28): the value is stored, the label is shown. */
export const REPORT_REASONS = [
  { value: "scam", label: "Scam or rug pull" },
  { value: "impersonation", label: "Pretends to be someone else" },
  { value: "hate", label: "Hate or harassment" },
  { value: "stolen_art", label: "Stolen art" },
  { value: "other", label: "Something else breaks the rules" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
export const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value) as [
  ReportReason,
  ...ReportReason[],
];

// ---------------------------------------------------------------- flows (backlog P1-2, P1-8 to P1-13)

const FAUCET_SOL = (FAUCET_AMOUNT / LAMPORTS).toLocaleString("en-US");

/** The words of the money flows: errors people can act on, button feedback, intents and notifications. */
export const FLOW = {
  /** Every network failure, everywhere (P1-9 step 7). */
  connection: "Connection problem. Try again.",
  /** Short form for a ticket or bid hint. */
  notEnough: `Not enough ${MODE_COPY.walletUnit}`,
  /** The faucet button (Portfolio header, and inside a hint). Test mode only: devnet has no in-app faucet. */
  claimFaucet: IS_SIM ? `Claim ${FAUCET_SOL} ${MODE_COPY.walletUnit}` : "",
  /** Toast after the faucet paid out (test mode only). */
  faucetSent: IS_SIM ? `Faucet sent ${FAUCET_SOL} ${MODE_COPY.walletUnit}.` : "",
  /** Toast after Enter: "Welcome, @ana. 100 test SOL is in your wallet." */
  welcome: (handle: string) =>
    [`Welcome, @${handle}.`, MODE_COPY.enterWelcome].filter(Boolean).join(" "),
  /** The trade ticket's slippage limit, folded into the fee row (P1-9 step 4). */
  maxSlippage: (pctText: string) => `max slippage ${pctText}`,
  /** Above the impact threshold (P1-9 step 5). */
  highImpact: (side: "buy" | "sell", pctText: string) =>
    `High price impact: this ${side} moves the price ${pctText}.`,
  /** Signed-out CTAs (P1-11 step 3). On devnet the wallet is the identity. */
  enterToTrade: IS_SIM ? "Try the demo to trade" : "Connect a wallet to trade",
  enterToLaunch: IS_SIM ? "Try the demo to launch" : "Connect a wallet to launch",
} as const;

/**
 * What to say when a wallet is short (P1-9 step 6), on the client and in the server's error alike: claim the
 * faucet when it is open, else when it opens. `faucet` is the player's faucet state (Me carries it).
 */
export function notEnoughSentence(
  faucet: { canFaucet: boolean; faucetReadyAt: number | null },
  now = Date.now(),
) {
  if (!IS_SIM) return `${FLOW.notEnough}. ${CHAIN_COPY.getSol}`;
  if (faucet.canFaucet)
    return `${FLOW.notEnough}. Claim ${FAUCET_SOL} ${MODE_COPY.walletUnit} from the faucet in your wallet menu.`;
  if (faucet.faucetReadyAt)
    return `${FLOW.notEnough}. The faucet opens ${untilText(faucet.faucetReadyAt, now)}.`;
  return `${FLOW.notEnough} in your wallet.`;
}

/** Inbox kinds (P1-13): what happened to a player's cards and bids while they were away. */
export type InboxKind = "offer" | "won" | "outbid" | "sold";

/** One notification toast per new event, with where to go next. Amounts arrive already formatted. */
export function inboxToast(e: {
  kind: InboxKind;
  coinName: string;
  amount: string;
  who: string | null;
  whoIsBot?: boolean;
}) {
  // Demo bots are never shown as people (P0-6).
  const who = e.who ? `@${e.who}${e.whoIsBot ? " (bot)" : ""}` : null;
  switch (e.kind) {
    case "won":
      return { text: `Your ${e.amount} SOL bid won the ${e.coinName} card.`, action: "View card" };
    case "sold":
      return {
        text: `${who ?? "Someone"} bought your ${e.coinName} card for ${e.amount} SOL.`,
        action: "View portfolio",
      };
    case "offer":
      return {
        text: `New ${e.amount} SOL offer on your ${e.coinName} card${who ? ` from ${who}` : ""}.`,
        action: "Review offer",
      };
    case "outbid":
      return {
        text: `Your ${e.amount} SOL bid on the ${e.coinName} card was outbid.`,
        action: "Raise bid",
      };
  }
}

/**
 * What Portfolio says when it opens with unread events (it clears the badge): the one event in full, or the
 * counts ("Since you last looked: 1 card won, 2 new offers.").
 */
export function inboxSummary(counts: {
  won: number;
  sold: number;
  offers: number;
  outbid: number;
}) {
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : null);
  const parts = [
    n(counts.won, "card won", "cards won"),
    n(counts.sold, "card sold", "cards sold"),
    n(counts.offers, "new offer", "new offers"),
    n(counts.outbid, "bid outbid", "bids outbid"),
  ].filter(Boolean);
  return `Since you last looked: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------- Portfolio (both builds) and the network notice

/**
 * Portfolio words: the signed-out invitation (what the page shows, one Connect action, one way to look around
 * without a wallet), the section tabs, and one empty state per section, each with one next action.
 */
export const PORTFOLIO_COPY = {
  signedOutTitle: "See your cards here",
  /** Chain builds; the sim build keeps MODE_COPY.portfolioSignedOut (Enter Launch a Card). */
  signedOutBody: "Connect a wallet to see your coins and cards.",
  explore: "Explore coins",
  tabCoins: "Coins",
  tabCards: "Cards",
  tabBids: "My bids",
  /** Phones: the four tabs share one row. */
  tabBidsShort: "Bids",
  tabOffers: "Offers",
  noCoinsTitle: "No coins yet",
  noCoinsBody: "Buy any coin from its page and it shows up here.",
  noCardsTitle: "No cards yet",
  noCardsBody: "Launch a coin to get its card, or win one with a bid.",
  launch: "Launch a coin",
  noBidsTitle: "No open bids",
  noBidsBody:
    "Bid on any card in the Market. Your SOL waits in escrow until the bid is accepted or you cancel it.",
  toMarket: "Go to the Market",
  noOffersTitle: "No offers yet",
  noOffersBody: "When someone bids on a card you hold, you can accept it here.",
  noOffersNoCards: "Offers come in on cards you hold. Launch a coin to get its first card.",
  seeCards: "See your cards",
} as const;

/**
 * The wrong-network notice (components/chain/NetworkNotice.tsx): what is wrong in a few words, then the one thing to
 * do. The wallet is on another cluster: switch it. The server answers for another cluster: nothing to do but wait.
 */
export const NETWORK_NOTICE_COPY =
  MODE === "mainnet"
    ? {
        wallet: "Switch your wallet to mainnet",
        walletHow: "Turn off the testnet setting in your wallet.",
        server: "Signing is paused for now",
        serverHow:
          "The Launch a Card server is on another network. You can still look around. Try again later.",
      }
    : {
        wallet: "Switch your wallet to devnet",
        walletHow:
          "Phantom: Settings, Developer Settings, Testnet Mode, Solana Devnet. Solflare and Backpack have a devnet setting too.",
        server: "Signing is paused for now",
        serverHow:
          "The Launch a Card server is on another network. You can still look around. Try again later.",
      };

// ---------------------------------------------------------------- devnet pages (refs/chain/m3-contract.md §2.2)
// Read only by the devnet components (components/chain/**), so a sim build drops all of it.

/**
 * Public devnet faucets. Launch a Card has no in-app faucet on devnet: devnet SOL is free from these. Empty in the mainnet and
 * sim builds (MODE is a literal, so the links are not even in the mainnet bundle): every faucet link renders from here.
 */
export const DEVNET_FAUCETS: ReadonlyArray<{ label: string; href: string }> =
  MODE === "devnet"
    ? [
        { label: "Solana faucet", href: "https://faucet.solana.com" },
        { label: "QuickNode faucet", href: "https://faucet.quicknode.com/solana/devnet" },
      ]
    : [];

/** Words of the chain pages: wallet prompts, transaction steps, chain errors people can act on (devnet build). */
const DEVNET_CHAIN_COPY = {
  noValue: "Devnet SOL has no real value.",
  getSol: "Get free devnet SOL from a public faucet.",
  /** Every USD figure on devnet carries this label (ApiConfig.usdLabel, SDK DEVNET_USD_LABEL). */
  usdLabel: "devnet ×100 at $118",
  connect: "Connect a wallet",
  connectToTrade: "Connect a wallet to trade",
  connectToBid: "Connect to bid",
  connectToBuy: "Connect a wallet to buy",
  connectToLaunch: "Connect a wallet to launch",
  switchNetwork: "Switch your wallet to Solana devnet to sign.",
  explorer: "Solana Explorer",
  explorerCoin: "Coin on Solana Explorer",
  explorerCard: "Card on Solana Explorer",
  explorerTx: "View transaction",
  /** Shown while a transaction runs, by client step (lib/chain/client.ts TxStep). */
  steps: {
    "signing-in": "Sign in with your wallet...",
    uploading: "Uploading art...",
    building: "Preparing...",
    verifying: "Checking the transaction...",
    signing: "Approve in your wallet...",
    submitting: "Sending...",
    confirming: "Confirming on devnet...",
    confirmed: "Confirmed",
  } as Record<string, string>,
  /** The seller fee floor moved between the build and the signature (card-program-v2 §18.9, FeesBelowFloor). */
  feesMoved:
    "The card's fees moved while you were signing. Approve again in your wallet to sell with the new numbers.",
  confirmTimeout: "Not confirmed in time. It may still land: the page updates when it does.",
  pendingRefresh: "Confirmed. Updating the page from devnet...",
};

/** The same words for the mainnet build (compat §6.4: no faucet, no "test SOL", a short real-money notice). */
const MAINNET_CHAIN_COPY: typeof DEVNET_CHAIN_COPY = {
  noValue: "Real SOL. Only spend what you can afford to lose.",
  getSol: "Add SOL to your wallet to continue.",
  usdLabel: "at the Pyth SOL/USD price",
  connect: "Connect a wallet",
  connectToTrade: "Connect a wallet to trade",
  connectToBid: "Connect to bid",
  connectToBuy: "Connect a wallet to buy",
  connectToLaunch: "Connect a wallet to launch",
  switchNetwork: "Switch your wallet to Solana mainnet to sign.",
  explorer: "Solana Explorer",
  explorerCoin: "Coin on Solana Explorer",
  explorerCard: "Card on Solana Explorer",
  explorerTx: "View transaction",
  steps: {
    "signing-in": "Sign in with your wallet...",
    uploading: "Uploading art...",
    building: "Preparing...",
    verifying: "Checking the transaction...",
    signing: "Approve in your wallet...",
    submitting: "Sending...",
    confirming: "Confirming on Solana...",
    confirmed: "Confirmed",
  },
  feesMoved:
    "The card's fees moved while you were signing. Approve again in your wallet to sell with the new numbers.",
  confirmTimeout: "Not confirmed in time. It may still land: the page updates when it does.",
  pendingRefresh: "Confirmed. Updating the page...",
};

export const CHAIN_COPY: typeof DEVNET_CHAIN_COPY =
  MODE === "mainnet" ? MAINNET_CHAIN_COPY : DEVNET_CHAIN_COPY;

/**
 * Mainnet fix pack words (refs/mainnet/fix-plan.md §4.4): the listing pause (F2), PumpSwap fees on graduated listings
 * (F7), locked cards (F10), what a design means and concentrated unlocks (tier B1), and the network checks. No em dashes.
 */
export const FIXPACK_COPY = {
  pauseLabel: "Pause the listing while the card unlocks a new design",
  pauseHelp: `So a rarer card never sells at today's price. If the unlock stops, the pause ends after the price stays below the next design for as long as it was above it (at most ${MODE === "devnet" ? "about 30 seconds" : "about an hour"}).`,
  pausedRow: (when: string) =>
    `Paused: the card is unlocking. Resumes about ${when} if the unlock stops.`,
  pausedForBuyers: (when: string) =>
    `Buy now is paused while the card unlocks a new design. Resumes about ${when} if the unlock stops.`,
  pausedNoTime: "Paused: the card is unlocking a new design.",
  keepListed: "Keep it listed without the pause",
  keepListedDone: "The listing no longer pauses during unlocks.",
  protectionOff: "Pause protection is not active right now",
  protectionOffHelp:
    "The service that watches unlocks is behind. A paused listing could sell before its pause starts.",
  graduatedFees:
    "This coin trades on PumpSwap. New trading fees reach the card every few minutes, and a sale always pays you at least the card fees shown when you listed or changed the price.",
  frozenLabel: "Locked by another app",
  frozenHelp:
    "Another app locked this card in your wallet. You can still withdraw its fees. To sell or list it, unlock it in that app first.",
  tierMeaning: `A design shows the market cap the coin held for ${MODE === "devnet" ? "about 30 seconds" : "about an hour"}. It does not show how many people hold the coin.`,
  /** Designs page, under the selected design: the short form (the page header says "for about an hour"). */
  tierMeaningShort: "A design reflects market cap, not how many people hold the coin.",
  concentratedBadge: "Concentrated",
  concentratedHelp: (pct: string) =>
    `When this design unlocked, the 10 largest wallets held ${pct}% of the coin.`,
  wrongServer: (cluster: string) =>
    `This site is set up for Solana ${cluster}, but the server answers for another network. Reading works, but nothing can be signed.`,
  devBuySecond:
    "The dev buy did not fit in the launch transaction, so it is a second step right after the launch.",
  devBuyNow: (sol: string) => `Buy ${sol} SOL of your coin now`,
  inCollection: "In the Launch a Card Cards collection",
} as const;

/**
 * Chain errors as sentences people can act on, by API or client code (m3-contract §3.1, §7.1). One shared set without
 * a network name, then the words that differ per cluster, so a mainnet bundle carries no devnet sentence and the
 * reverse (MODE is a literal; the unused set is dropped).
 */
const COMMON_CHAIN_ERRORS: Record<string, string> = {
  VERIFY_FAILED:
    "Launch a Card stopped this transaction because it did not match what you asked for. Nothing was signed.",
  WALLET_NOT_CONNECTED: "Connect a wallet first.",
  WALLET_REJECTED: "You declined in your wallet. Nothing was sent.",
  CONFIRM_TIMEOUT: "Not confirmed in time. It may still land: the page updates when it does.",
  NETWORK: "Connection problem. Try again.",
  PRICE_CHANGED: "The price changed. Check the new numbers and try again.",
  FEES_BELOW_FLOOR:
    "The card's fees moved while you were signing. Approve again in your wallet to sell with the new numbers.",
  NEEDS_COLLECT: "This card has fees to sweep first. Try again in a minute.",
  NOT_HOLDER: "You do not hold this card right now.",
  NOT_LISTED: "This card is not listed anymore.",
  ALREADY_LISTED: "This card is already listed.",
  NO_BID: "That bid is no longer open.",
  SELF_TRADE: "You cannot trade a card with yourself.",
  LISTING_VOIDED: "This listing was voided when the card unlocked a new design.",
  LISTING_EXPIRED: "This listing expired.",
  NOTHING_TO_WITHDRAW: "No card fees to withdraw yet.",
  CURVE_COMPLETE: "The curve is complete. Trading moves to PumpSwap within a minute.",
  CURVE_NOT_NEAR_COMPLETE: "The curve is not close enough to complete yet.",
  NOT_GRADUATED: "This coin has not moved to PumpSwap yet.",
  POOL_TOO_THIN: "That is more than the pool can fill. Try a smaller amount.",
  PAUSED: "The card market is paused for now. Cancelling bids and delisting still work.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  TOO_MANY_RESERVATIONS: "You already have two launches waiting. Finish one or wait a few minutes.",
  VAULT_EMPTY: "No mint addresses are free right now. Try again in a few minutes.",
  ALT_UNAVAILABLE:
    "A launch with a dev buy is unavailable right now. Set the dev buy to 0 and try again.",
  WALLET_REWROTE_TX:
    "Your wallet changed the transaction in a way Launch a Card cannot accept. Nothing was sent.",
  INTENT_EXPIRED: "That took too long. Try again.",
  INTENT_USED: "That transaction was already sent.",
  SIMULATION_FAILED:
    "The transaction would fail on chain, so nothing was sent. Check the numbers and try again.",
  TX_TOO_LARGE: "The transaction is too large. Try a launch without a dev buy.",
  IMAGE_TOO_LARGE: "That image is over 2 MB. Try a smaller one.",
  IMAGE_TYPE: "Use a PNG, JPG, WEBP or GIF image.",
  IMAGE_NOT_FOUND: "Upload the card art again, then launch.",
  INVALID_NAME: "Use a name of 1 to 32 bytes.",
  INVALID_SYMBOL: "Use 2 to 10 capital letters or digits for the ticker.",
  INVALID_DESCRIPTION: "Keep the description under 400 characters.",
  INVALID_LINK: "Links must start with https:// and stay under 200 characters.",
  INVALID_AMOUNT: "Check the amount and try again.",
  AUTH_EXPIRED: "Your sign-in expired. Try again to sign in with your wallet.",
  UNAUTHORIZED: "Sign in with your wallet, then try again.",
  COIN_NOT_FOUND: "This coin has no Launch a Card card.",
  CARD_FROZEN:
    "This card is locked by another app. It can still withdraw fees; unlock it in that app to sell or list it.",
  TX_VERSION_UNSUPPORTED:
    "Your wallet sent the transaction in a newer format Launch a Card cannot read yet. Nothing was sent. Try again or use another wallet.",
  LAUNCH_COIN_CHECK_FAILED:
    "pump.fun changed how new coins are created, so Launch a Card paused launches. Nothing was signed.",
  /** Launch gate (launch-plan §1.6, LAUNCHES allowlist or closed, or the switch:launches flag). */
  LAUNCHES_NOT_OPEN: "Launches open soon. Trading, bids and listings already work.",
  /** Exposure caps of the first weeks (launch-plan §4.5); the amount comes from the error's details when present. */
  AMOUNT_ABOVE_LAUNCH_CAP: "Early days: bids and listings are capped at 2 SOL for now.",
};
const DEVNET_ONLY_CHAIN_ERRORS: Record<string, string> = {
  WRONG_NETWORK: "Switch your wallet to Solana devnet, then try again.",
  INSUFFICIENT_FUNDS: "Not enough devnet SOL. Get free devnet SOL from a public faucet.",
  BID_TOO_LOW: "Bids start at 0.03 SOL.",
  PRICE_TOO_LOW: "Listings start at 0.03 SOL.",
  ENGINE_OFF: "Devnet transactions are not switched on yet. Reading works; trading opens soon.",
  CLUSTER_MISMATCH: "Launch a Card is not connected to Solana devnet right now. Try again later.",
  RPC_UNAVAILABLE: "Solana devnet did not answer. Try again.",
  SEND_FAILED: "Solana devnet did not take the transaction. Try again.",
};
/** Mainnet build: the same codes without devnet words (compat §6.4). */
const MAINNET_ONLY_CHAIN_ERRORS: Record<string, string> = {
  WRONG_NETWORK: "Switch your wallet to Solana mainnet, then try again.",
  INSUFFICIENT_FUNDS: "Not enough SOL in this wallet for that.",
  BID_TOO_LOW: "Bids start at 0.05 SOL.",
  PRICE_TOO_LOW: "Listings start at 0.05 SOL.",
  ENGINE_OFF: "Launch a Card paused transactions for now. Reading works.",
  CLUSTER_MISMATCH: "Launch a Card is not connected to Solana right now. Try again later.",
  RPC_UNAVAILABLE: "Solana did not answer. Try again.",
  SEND_FAILED: "Solana did not take the transaction. Try again.",
};

/**
 * Launch and Designs pages (UX pass 2026-10-11): the short launch form, its design preview chips and cost disclosure,
 * and the Designs page's controls and hint. No em dashes, en dashes or middle dots.
 */
export const LAUNCH_COPY = {
  artAdd: "Add image",
  artDrop: "or drop it here",
  loreHelp: "Shown on the card. Saved for good.",
  more: "More options",
  moreHint: "Website, X link, dev buy",
  devEmpty: (max: string) => `Buy the first coins yourself, up to ${max}.`,
  total: "Total: up to",
  included: "What is included",
  costDevBuy: (slippage: string) => `Dev buy, with ${slippage} slippage room`,
  costRent: "Account rent and network fee",
  costMetaplex: "Metaplex NFT fee, so the card shows in wallets",
  costLaunchFee: "Launch fee",
  pickerLabel: "Preview your card in a design",
  startsAs: (name: string) => `Your card starts as ${name}.`,
  unlocksAt: (usd: string) => `Unlocks at ${usd} market cap.`,
  allDesigns: (n: number) => `See all ${n} designs`,
  preview3d: "Preview in 3D",
} as const;

export const LEVELS_COPY = {
  context: `A design unlocks once the market cap stays above its mark for ${MODE === "devnet" ? "about 30 seconds" : "about an hour"}. A card keeps its best design.`,
  play: "Watch it level up",
  playing: "Leveling up...",
  cooling: "Cooling off...",
  hintFine: "Drag to turn it. Click or press F to flip.",
  hintTouch: "Drag to turn it. Tap to flip.",
} as const;

export const CHAIN_ERRORS: Record<string, string> = {
  ...COMMON_CHAIN_ERRORS,
  ...(MODE === "mainnet" ? MAINNET_ONLY_CHAIN_ERRORS : DEVNET_ONLY_CHAIN_ERRORS),
};

/**
 * Words for the switches and caps the mainnet Worker adds (launch-plan §1.6 item 6, §4.3, §4.5): the launch gate on the
 * Launch page, exit-only engine mode (the site builds only withdraw_fees, cancel_bid and delist_card), and the 2 SOL
 * caps on bids and listings. No em dashes.
 */
export const SWITCH_COPY = {
  /** Launch page, LAUNCHES=allowlist (from D1 until Phase H): the form stays, the button works for the allowlist only. */
  launchesSoon: "Launches open soon",
  launchesSoonHelp:
    "Launch a Card is checking its first launches. Trading, bids and listings already work.",
  /** Launch page, LAUNCHES=closed or the switch:launches flag. */
  launchesPaused: "Launches are paused for now",
  launchesPausedHelp: "Trading, bids and listings still work. Check @mintdexdotfun on X for news.",
  /** ENGINE_OFF in exit-only mode (details.engine or details.mode "exit"): what still works. */
  engineExitOnly:
    "New transactions are paused for now. Withdrawing card fees, cancelling bids and delisting cards still work.",
  /** "Early days: bids and listings are capped at 2 SOL for now." */
  capError: (maxSol: string) =>
    `Early days: bids and listings are capped at ${maxSol} SOL for now.`,
  /** Under the bid form and in the list dialog while the caps are on. */
  bidCapNote: (maxSol: string) => `Early days: bids are capped at ${maxSol} SOL.`,
  listCapNote: (maxSol: string) => `Early days: listings are capped at ${maxSol} SOL.`,
} as const;
