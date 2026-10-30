import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useLiveLaunchOpen } from "../components/carddex/live/readiness";
import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE } from "../components/carddex/live/wallet-notice";
import { CalmSwitch, PageFrame, PageHeader, TextLink } from "../components/mintdex/ui";
import { FAUCET_AMOUNT, FAUCET_BELOW, LAMPORTS, LAUNCH_FEE, SOL_USD, START_BALANCE, TRADE_FEE_BPS } from "../lib/mintdex/constants";
import { IS_SIM, WORDS, pct } from "../lib/mintdex/copy";
import { pageHead } from "../lib/mintdex/seo";
import { getCardDesign } from "../lib/carddex/designs";
import { OFFERED_PAIRS, designForPair, isDirectPair, mainnetPairHold } from "../lib/carddex/pairs";

/** The Pairs lines that follow the offered set (pairs.ts): DOGE's card, and whether any crypto or direct pair is offered. */
const DOGE_DESIGN = getCardDesign(designForPair("doge") ?? undefined).name;
const OFFERS_CRYPTO = OFFERED_PAIRS.some((asset) => asset.kind === "crypto");
const OFFERS_DIRECT = OFFERED_PAIRS.some(isDirectPair);
// Direct pairs wait for the owner's confirmation before mainnet launches (pairs.ts CONFIRMED_DIRECT_PAIRS).
const DIRECT_HELD = OFFERED_PAIRS.filter(isDirectPair).every((asset) => mainnetPairHold(asset.key));

/*
 * How it works (/how): the one page that holds every explanation the screens leave out (the words rule: screens
 * carry the fewest words that let someone act, and each links here with one "How it works" or "Details" link).
 * MintDex's reading format, like /legal: the title row, a section list (a column from 1024px, a row on phones)
 * beside one plinth panel. The panel opens with the old guide's three steps, then one anchored section per topic, in
 * the order a newcomer needs them (#launch, #pairs, #cards, #fees, #demo, #trading, then the mainnet-only #wallet and
 * #recovery, and #motion). From 1024px the panel scrolls on
 * its own; phones scroll the page. A #hash link lands its section at the top and moves focus to its heading.
 * Terms, privacy and risks stay at /legal. Styles: styles/screens/how.css.
 */
export const Route = createFileRoute("/how")({
  head: () =>
    pageHead({
      path: "/how",
      title: "How it works | Launch a Card",
      description:
        "Launch a pump.fun coin whose pair picks its card design. Pairs, trading, wallet approvals, fees and the demo, in short.",
    }),
  component: How,
});

const sol = (lamports: number) => (lamports / LAMPORTS).toLocaleString("en-US");
const START_SOL = sol(START_BALANCE);

type Step = { title: string; body: string };
/** The guide's three steps (formerly the "How Launch a Card works" dialog), demo first while mainnet launches are off. */
const DEMO_STEPS: Step[] = [
  {
    title: "Launch your coin",
    body: "Give it a name, ticker and artwork, and pick its pair. The demo runs on test SOL.",
  },
  {
    title: "The pair picks its card",
    body: "Each pair has one card design, shown as you pick. Its one-of-one card goes into your demo collection.",
  },
  {
    title: "Trade the coin. Keep the card.",
    body: "Trade with test funds on a simulated pump.fun curve. No real coin or NFT is minted.",
  },
];
const LIVE_STEPS: Step[] = [
  {
    title: "Launch your coin",
    body: "Give it a name, ticker and artwork. Pick its pair, then review the pump.fun launch in your wallet.",
  },
  {
    title: "The pair picks its card",
    body: "Each pair has one card design, shown as you pick. After the coin is verified, approve its one-of-one card to your wallet.",
  },
  {
    title: "Trade the coin. Keep the card.",
    body: "Trade your coin on pump.fun and keep its card NFT in your wallet. The demo lets you try it with test SOL.",
  },
];

type Section = { id: string; nav: string; title: string; body: ReactNode };

/** The demo's first line. "Not open yet" only while mainnet launches are off: production opens them beside the demo. */
function DemoLine() {
  const liveOpen = useLiveLaunchOpen();
  return (
    <li>
      {liveOpen ? "" : "Mainnet launches are not open yet. "}The demo uses test SOL: no real coin or card is created.
    </li>
  );
}

const SECTIONS: Section[] = [
  {
    id: "launch",
    nav: "Launch",
    title: "Launch a coin",
    body: (
      <ul>
        <li>Name, ticker and artwork are all you need. Everything else has a default: the pair starts on SOL.</li>
        <li>The ticker takes 2 to 8 letters or numbers (A to Z, 0 to 9).</li>
        <li>Card art: PNG, JPG, WEBP or GIF up to 12 MB. Square works best. You can also drop the image on the box.</li>
        <li>The pair panel filters by Memes, Stocks, Crypto and Collector, and searches by symbol or name.</li>
        <li>More options holds your website, X link, an optional initial buy and its slippage.</li>
        <li>The exact initial buy and slippage show before your wallet opens.</li>
        <li>
          Creating a coin means you accept the <TextLink to="/legal" hash="content-rules">content rules</TextLink>: {WORDS.contentRule}
        </li>
        <li>Anyone can report a coin from its Coin details. Coins that break the content rules are hidden.</li>
        <li>Home's Launched on pump.fun list shows real launches on Solana mainnet, newest first.</li>
      </ul>
    ),
  },
  {
    id: "pairs",
    nav: "Pairs",
    title: "Pairs",
    body: (
      <ul>
        <li>The pair is what your coin is priced and bought in: SOL, USDC, a crypto, meme or collector token, or a tokenized stock.</li>
        <li>The pair picks the card. Each pair has exactly one design, so choosing the pair and the design is one choice. DOGE gets {DOGE_DESIGN}.</li>
        <li>SOL is pump.fun's default pair and gets the One Piece design. USDC gets Duel Masters.</li>
        {OFFERS_CRYPTO ? <li>Crypto pairs are Solana tokens or Solana versions of other coins; the panel names the bridge where one is listed.</li> : null}
        {OFFERS_DIRECT ? <li>Some pairs are admitted on-chain but missing from pump.fun's dated public list; their panel says so.{DIRECT_HELD ? " Mainnet launches can't use them yet." : ""}</li> : null}
        <li>Under the pair panel: the exact mint, its issuer and when it was reviewed. The mint is checked again before wallet review.</li>
        <li>The pair funds the optional initial buy, so changing the pair clears it. SOL also pays network and account costs.</li>
        <li>Stock pairs use tokenized quote assets. They grant no equity: your coin is not company shares.</li>
        <li>Each quote asset has its own issuer terms, availability and risks.</li>
        {IS_SIM ? <li>Demo pairs use no real assets.</li> : null}
      </ul>
    ),
  },
  {
    id: "cards",
    nav: "Cards",
    title: "Your card",
    body: (
      <ul>
        <li>The design is printed on the card and kept for good. Market cap never changes it.</li>
        <li>The token trades. Its creator holds the separate one-of-one card made at launch.</li>
        <li>Picking another pair keeps your coin details and artwork; only the pair and its card change.</li>
        <li>Designs shows one sample coin in each pair's design, grouped as Memes, Stocks, Crypto and Collector.</li>
        <li>Designs with no pair are kept by the coins already made with them. They are not offered for new coins.</li>
        <li>In the demo the card goes into your demo collection. On mainnet it is permanent once your coin is created.</li>
        <li>There are no card sales, bids, auctions or royalties. The card NFT gives no token ownership or stock rights.</li>
      </ul>
    ),
  },
  {
    id: "fees",
    nav: "Fees",
    title: "Fees",
    body: (
      <ul>
        <li>Launch a Card charges no platform fee.</li>
        <li>
          A mainnet launch pays Solana network and priority fees, account rent for the new accounts, the Metaplex NFT
          fee for the card, and pump.fun's protocol and creator fees inside any initial buy.
        </li>
        <li>Coin creation and card issuance are paid mainnet transactions. Exact costs show before your wallet asks.</li>
        {IS_SIM ? (
          <li>
            In the demo, the {sol(LAUNCH_FEE)} test SOL launch cost stands in for those network fees and account rent.
            Demo trades pay {pct(TRADE_FEE_BPS)}.
          </li>
        ) : null}
        <li>
          Every fee in one table: <TextLink to="/legal" search={{ tab: "fees" }}>Fees</TextLink>.
        </li>
      </ul>
    ),
  },
  {
    id: "demo",
    nav: "Demo",
    title: "The demo",
    body: (
      <ul>
        <DemoLine />
        <li>Pick a handle to get {START_SOL} test SOL. No wallet needed.</li>
        <li>Your test account lives in this browser. Clearing site data ends access to it.</li>
        <li>Balances, the bonding curve and trades are simulated. Each quote asset has its own demo balance.</li>
        <li>Activity includes demo bots: simulated traders, marked bot.</li>
        <li>Portfolio holds your coins and your one-of-one cards. Value is test SOL plus your coins; 24h is their price move.</li>
        <li>
          Under {sol(FAUCET_BELOW)} test SOL, the faucet in your wallet menu gives {sol(FAUCET_AMOUNT)} more.
        </li>
        <li>Start over leaves your handle for good. Its coins and cards stay with it, and nobody can enter it again.</li>
        <li>Only demo coins have cards here. Coins on Solana devnet or mainnet don't, yet.</li>
      </ul>
    ),
  },
  {
    id: "trading",
    nav: "Trading",
    title: "Trading",
    body: (
      <ul>
        <li>
          The price follows a pump.fun bonding curve. When the curve sells out, the coin graduates to a PumpSwap pool.
          {IS_SIM ? " The demo's curve is simulated." : ""}
        </li>
        <li>Bonding curve shows how far a coin is from graduating.</li>
        <li>Each step on the chart is a trade. The first buy starts the chart and the trade list.</li>
        <li>A range with no trades stays empty. Choose a longer one.</li>
        <li>Check the price impact, fee and max slippage before you confirm a trade.</li>
        {IS_SIM ? (
          <li>
            Demo trades pay a {pct(TRADE_FEE_BPS)} fee in test SOL. USD is shown at a fixed ${SOL_USD} per SOL, a test
            rate. Market data is simulated, not live quotes.
          </li>
        ) : null}
      </ul>
    ),
  },
  {
    id: "wallet",
    nav: "Wallet",
    title: "Wallet launch",
    body: (
      <>
        <ol className="cdx-how__ol">
          <li>Pick your coin's pair: its card design comes with it. Add your token name, ticker and artwork.</li>
          <li>Connect your creator wallet and sign an ownership message. It starts your launch session and spends nothing.</li>
          <li>Review the token creation costs and any initial buy, then approve the pump.fun transaction in your wallet.</li>
          <li>After the token is verified, approve its one-of-one card NFT to that same wallet. Some wallets sign both in one approval.</li>
          <li>If the token lands before the card, finish the card from Launch. Your token is not created again.</li>
        </ol>
        <h3>{WALLET_NOTICE_TITLE}</h3>
        <p>Launch lists what the wallet prompt will carry before it opens:</p>
        <ul>
          <li>How many approvals are left: one for the coin and its card, or the card after the coin.</li>
          <li>The network fee. The exact amount is in your review.</li>
          <li>With an initial buy: a new token account for your coin, and the coin marked unverified. That's normal for a coin created seconds ago.</li>
          <li>With a tokenized stock quote: a note that the stock token has issuer controls.</li>
          <li>A second signer for each new address. This page created it, and it can't move your other funds.</li>
          <li>{WALLET_NOTICE_COPY.cardLock}</li>
          <li>Phantom may say this site is new. Check that the address bar reads launchacard.fun.</li>
        </ul>
        <p className="cdx-how__safety">{WALLET_NOTICE_COPY.safety}</p>
        <p>Connecting a wallet authorizes no payment or transaction.</p>
      </>
    ),
  },
  {
    id: "recovery",
    nav: "Saved launches",
    title: "Saved launches",
    body: (
      <ul>
        <li>While new mainnet launches are closed, you can still finish a saved launch.</li>
        <li>Connect the same creator wallet on Launch to find it.</li>
        <li>If the coin was created before its card, finish the card there. The coin is not created again.</li>
        <li>
          A launch prepared in another browser can't be signed here. Discard the unused draft about a minute after it
          was prepared, then launch again.
        </li>
        <li>Your form draft lives only in this browser.</li>
      </ul>
    ),
  },
  {
    id: "motion",
    nav: "Motion",
    title: "Calm motion",
    body: (
      <>
        <p>Stops the sky, the card turns and the ticker. It starts on when your device asks for reduced motion.</p>
        <CalmSwitch size="md" className="cdx-how__calm" />
      </>
    ),
  },
];

const IDS = new Set(SECTIONS.map((s) => s.id));

function How() {
  const liveOpen = useLiveLaunchOpen();
  const steps = liveOpen || !IS_SIM ? LIVE_STEPS : DEMO_STEPS;
  const hash = useRouterState({ select: (s) => s.location.hash });

  // A #hash (a link from a screen, or the section list) lands its section at the top and focus on its heading.
  useEffect(() => {
    const id = decodeURIComponent((hash || window.location.hash.slice(1)).replace(/^#/, ""));
    if (!IDS.has(id)) return;
    const heading = document.getElementById(`${id}-title`);
    if (!heading) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [hash]);

  return (
    <PageFrame className="mdx-page cdx-how">
      <PageHeader title="How it works" context={<TextLink to="/legal">Terms &amp; risks</TextLink>} />
      <div className="cdx-how__layout">
        <nav className="cdx-how__nav" aria-label="Sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  to="/how"
                  hash={s.id}
                  replace
                  resetScroll={false}
                  hashScrollIntoView={false}
                  // Only the section the address names is current (aria-current="page").
                  activeOptions={{ includeHash: true }}
                  className="cdx-how__tab"
                >
                  {s.nav}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="cdx-how__doc mdx-scroll">
          <ol className="cdx-guide__steps cdx-how__steps" role="list" aria-label="In three steps">
            {steps.map((s, i) => (
              <li key={s.title} className="cdx-guide__step">
                <span className="cdx-guide__n num" aria-hidden>
                  {i + 1}
                </span>
                <h2 className="cdx-how__step-title">{s.title}</h2>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="cdx-how__sections">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="cdx-how__section">
                <h2 id={`${s.id}-title`} tabIndex={-1}>
                  {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
