import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE } from "../components/carddex/live/wallet-notice";
import { CalmSwitch, PageFrame, PageHeader, TextLink } from "../components/mintdex/ui";
import { WORDS } from "../lib/mintdex/copy";
import { pageHead } from "../lib/mintdex/seo";
import { getCardDesign } from "../lib/carddex/designs";
import { OFFERED_PAIRS, designForPair, designsForPair, isDirectPair, mainnetPairHold } from "../lib/carddex/pairs";

/** The Pairs lines that follow the offered set (pairs.ts): DOGE's card, and whether any crypto or direct pair is offered. */
const DOGE_DESIGN = getCardDesign(designForPair("doge") ?? undefined).name;
/** SOL's designs (pairs.ts designsForPair): its own card, the main one, then the ones no other pair uses. */
const SOL_DESIGNS = designsForPair("sol");
const SOL_MAIN = getCardDesign(SOL_DESIGNS[0]).name;
const SOL_MORE = SOL_DESIGNS.length - 1;
const OFFERS_CRYPTO = OFFERED_PAIRS.some((asset) => asset.kind === "crypto");
const OFFERS_DIRECT = OFFERED_PAIRS.some(isDirectPair);
// Direct pairs wait for the owner's confirmation before mainnet launches (pairs.ts CONFIRMED_DIRECT_PAIRS).
const DIRECT_HELD = OFFERED_PAIRS.filter(isDirectPair).every((asset) => mainnetPairHold(asset.key));
const SOME_DIRECT_HELD = OFFERED_PAIRS.filter(isDirectPair).some((asset) => mainnetPairHold(asset.key));

/*
 * How it works (/how): the one page that holds every explanation the screens leave out (the words rule: screens
 * carry the fewest words that let someone act, and each links here with one "How it works" or "Details" link).
 * MintDex's reading format, like /legal: the title row, a section list (a column from 1024px, a row on phones)
 * beside one plinth panel. The panel opens with the old guide's three steps, then one anchored section per topic, in
 * the order a newcomer needs them (#launch, #pairs, #cards, #fees, #trading, #wallet, #recovery and #motion). From 1024px the panel scrolls on
 * its own; phones scroll the page. A #hash link lands its section at the top and moves focus to its heading.
 * Terms, privacy and risks stay at /legal. Styles: styles/screens/how.css.
 */
export const Route = createFileRoute("/how")({
  head: () =>
    pageHead({
      path: "/how",
      title: "How it works | Launch a Card",
      description:
        "Launch a pump.fun coin whose pair picks its card design. Pairs, trading, wallet approvals and fees, in short.",
    }),
  component: How,
});

type Step = { title: string; body: string };
/** The guide's three steps (formerly the "How Launch a Card works" dialog). */
const STEPS: Step[] = [
  {
    title: "Launch your coin",
    body: "Give it a name, ticker and artwork. Pick its pair, then review the pump.fun launch in your wallet.",
  },
  {
    title: "The pair picks its card",
    body: `Each pair has its own card design, shown as you pick. SOL also offers ${SOL_MORE} more. After the coin is verified, approve its one-of-one card to your wallet.`,
  },
  {
    title: "Trade the coin. Keep the card.",
    body: "Your coin trades on pump.fun. Its one-of-one card NFT stays in your wallet.",
  },
];

type Section = { id: string; nav: string; title: string; body: ReactNode };

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
        <li>Every launch is a real Solana mainnet coin. Home, Discover and search list them, newest first.</li>
        <li>Portfolio lists the coins your connected wallet launched here, each with its card.</li>
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
        <li>The pair picks the card. Every pair but SOL has exactly one design of its own, so choosing the pair is choosing the design. DOGE gets {DOGE_DESIGN}.</li>
        <li>SOL is pump.fun's default pair. Its own card, {SOL_MAIN}, is its main design, and it offers {SOL_MORE} more designs no other pair uses. Pick one under the pair panel. USDC gets Duel Masters.</li>
        {OFFERS_CRYPTO ? <li>Crypto pairs are Solana tokens or Solana versions of other coins; the panel names the bridge where one is listed.</li> : null}
        {OFFERS_DIRECT ? <li>Some pairs are admitted on-chain but missing from pump.fun's dated public list; their panel says so.{DIRECT_HELD ? " Mainnet launches can't use them yet." : SOME_DIRECT_HELD ? " Mainnet launches can use only the ones confirmed so far." : ""}</li> : null}
        <li>Under the pair panel: the exact mint, its issuer and when it was reviewed. The mint is checked again before wallet review.</li>
        <li>The pair funds the optional initial buy, so changing the pair clears it. SOL also pays network and account costs.</li>
        <li>Stock pairs use tokenized quote assets. They grant no equity: your coin is not company shares.</li>
        <li>Each quote asset has its own issuer terms, availability and risks.</li>
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
        <li>SOL's own card is its main design. SOL also offers {SOL_MORE} more designs no other pair uses. Every other pair has exactly one design of its own.</li>
        <li>Designs shows one sample coin in each pair's design and in all of SOL's, grouped as Memes, Stocks, Crypto and Collector.</li>
        <li>Designs no pair offers are kept by the coins already made with them. They are not offered for new coins.</li>
        <li>The card is permanent once your coin is created.</li>
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
        <li>
          Sharing creator fees, when Launch offers it, is an optional separate approval after the card: a network fee
          and rent for pump.fun's fee-sharing account. pump.fun pays creator fees; Launch a Card takes none and is never
          in your split.
        </li>
        <li>
          Every fee in one table: <TextLink to="/legal" search={{ tab: "fees" }}>Fees</TextLink>.
        </li>
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
          Coins trade on pump.fun, priced by its bonding curve. When the curve sells out, the coin graduates to a
          PumpSwap pool.
        </li>
        <li>Each coin's page links to its pump.fun page, where you trade it, and to its Solscan record.</li>
        <li>Launch a Card shows no prices or charts and takes no fee on trades.</li>
        <li>Check the price impact, fees and slippage on pump.fun before you confirm a trade.</li>
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
          <li>Pick your coin's pair: its card design comes with it (with SOL, pick one of its designs). Add your token name, ticker and artwork.</li>
          <li>Connect your creator wallet and sign an ownership message. It starts your launch session and spends nothing.</li>
          <li>Review the token creation costs and any initial buy, then approve the pump.fun transaction in your wallet.</li>
          <li>After the token is verified, approve its one-of-one card NFT to that same wallet. Some wallets sign both in one approval.</li>
          <li>If the token lands before the card, finish the card from Launch. Your token is not created again.</li>
          <li>If you chose to share creator fees, approve the split last, in its own approval. The split is permanent: pump.fun allows it to be set once. Recipients must be Solana wallets.</li>
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
        <p>Stops the sky and the card turns. It starts on when your device asks for reduced motion.</p>
        <CalmSwitch size="md" className="cdx-how__calm" />
      </>
    ),
  },
];

const IDS = new Set(SECTIONS.map((s) => s.id));

function How() {
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
            {STEPS.map((s, i) => (
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
