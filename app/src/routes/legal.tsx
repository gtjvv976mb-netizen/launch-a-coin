import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { oneOf, searchSchema } from "../lib/mintdex/search";
import { PageFrame, PageHeader, TextLink } from "../components/mintdex/ui";
import { LAMPORTS, LAUNCH_FEE, TRADE_FEE_BPS } from "../lib/mintdex/constants";
import { pct } from "../lib/mintdex/copy";
import { pageHead } from "../lib/mintdex/seo";

export const Route = createFileRoute("/legal")({
  // ?tab= picks the section shown (Terms when absent); an old #hash link (#fees, #token-risk) opens its section.
  validateSearch: searchSchema({
    tab: oneOf(["terms", "fees", "privacy", "risks"]),
  }),
  head: () => pageHead({
    path: "/legal",
    title: "Terms, privacy and risks | Launch a Card",
    description: "Terms of use, privacy, fees and risk disclosures for launching coins with Launch a Card.",
  }),
  component: Legal,
});

const UPDATED = "30 October 2026";

/** A fact the operator still has to supply. Shown as an obvious marked slot, never as a guess. */
function Fill({ children }: { children: string }) {
  return <mark className="cdx-legal__fill">[TO FILL: {children}]</mark>;
}

type Item = { id: string; title: string; body: ReactNode };
type Section = { id: "terms" | "fees" | "privacy" | "risks"; title: string; items: Item[] };

const DEMO_LAUNCH_FEE = (LAUNCH_FEE / LAMPORTS).toLocaleString("en-US");

const SECTIONS: Section[] = [
  {
    id: "terms",
    title: "Terms",
    items: [
      {
        id: "operator",
        title: "Who runs Launch a Card",
        body: (
          <>
            <p>
              Launch a Card is operated by <Fill>operator legal name</Fill>, <Fill>registered address</Fill>.
            </p>
            <p>
              Questions about these terms: <Fill>contact email</Fill>. Rights and takedown requests:{" "}
              <Fill>takedown contact</Fill>.
            </p>
          </>
        ),
      },
      {
        id: "eligibility",
        title: "Who can use it",
        body: (
          <p>
            Minimum age: <Fill>minimum age</Fill>. Not available in: <Fill>restricted countries and regions</Fill>.
          </p>
        ),
      },
      {
        id: "wallet-launches",
        title: "Wallet launches and demo trading",
        body: (
          <p>
            The wallet launch flow, when configured and enabled, creates a real pump.fun token and a separate
            collectible NFT on Solana mainnet. Each transaction requires your wallet approval and real network costs.
            Pages labelled demo use simulated tokens, balances and trading; test funds have no cash value. On this
            site, a coin means a token created on pump.fun.
          </p>
        ),
      },
      {
        id: "your-card",
        title: "Your card",
        body: (
          <p>
            A creator chooses one permanent design at launch. Market-cap changes never replace it. After the token
            launch is verified, a separate immutable one-of-one card NFT is created in the creator’s wallet. NFT
            ownership does not convey token ownership or stock rights. Launch a Card has no NFT marketplace, bids or
            resale royalties.
          </p>
        ),
      },
      {
        id: "content-rules",
        title: "Content rules",
        body: (
          <p>
            Use names, descriptions and art you have the right to use. Do not impersonate another project, mislead
            users, promote scams or promise investment returns.
          </p>
        ),
      },
      {
        id: "test-data",
        title: "Test data",
        body: <p>Demo tokens and balances may be reset during development. The demo is provided as is.</p>,
      },
      {
        id: "liability",
        title: "Liability",
        body: (
          <p>
            <Fill>warranty disclaimer and limitation of liability, written by counsel</Fill>
          </p>
        ),
      },
      {
        id: "governing-law",
        title: "Governing law and disputes",
        body: (
          <p>
            Governing law: <Fill>governing law</Fill>. Disputes: <Fill>courts or dispute process</Fill>.
          </p>
        ),
      },
      {
        id: "changes",
        title: "Changes to these terms",
        body: (
          <p>
            The Updated date at the top of this page shows the current version. How changes are announced:{" "}
            <Fill>how changes are announced</Fill>.
          </p>
        ),
      },
    ],
  },
  {
    id: "fees",
    title: "Fees",
    items: [
      {
        id: "fee-table",
        title: "What a launch and a trade cost",
        body: (
          <>
            <p>Your wallet shows the exact amounts of every real transaction before you sign it.</p>
            <table className="cdx-legal__fees">
              <thead>
                <tr>
                  <th scope="col">Fee</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Launch a Card fee per launch</th>
                  <td>None. Launch a Card adds no fee to launch or card transactions.</td>
                </tr>
                <tr>
                  <th scope="row">Launch a Card share of trading fees</th>
                  <td>None.</td>
                </tr>
                <tr>
                  <th scope="row">Card NFT issuance</th>
                  <td>
                    Account rent, the Solana network fee and the Metaplex NFT fee, paid from your wallet.
                  </td>
                </tr>
                <tr>
                  <th scope="row">pump.fun creation and trading fees</th>
                  <td>
                    Set and charged by pump.fun.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Solana network fees</th>
                  <td>Paid to the network for each transaction you sign.</td>
                </tr>
                <tr>
                  <th scope="row">Demo</th>
                  <td>
                    Launch fee {DEMO_LAUNCH_FEE} test SOL. Trading fee {pct(TRADE_FEE_BPS)} in test SOL. Test SOL has
                    no cash value.
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ),
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy",
    items: [
      {
        id: "browser-session",
        title: "Browser session",
        body: (
          <p>
            Separate session cookies remember your demo account and wallet-authenticated launch session. Wallet
            authentication uses a clearly labelled message, not a transaction. No wallet private keys are requested or
            stored by the server.
          </p>
        ),
      },
      {
        id: "launch-records",
        title: "Launch records and public assets",
        body: (
          <p>
            Launch details, wallet addresses, recovery records and images are stored in this platform’s own database
            and object storage. Published token and NFT metadata, images and blockchain records are public. Confirmed
            blockchain data cannot be removed by clearing browser data. Launch a Card accounts and data are separate
            from any other service.
          </p>
        ),
      },
      {
        id: "external-links",
        title: "External links",
        body: (
          <p>
            Opening pump.fun or another external link takes you to that service, which applies its own terms and
            privacy policy.
          </p>
        ),
      },
      {
        id: "privacy-requests",
        title: "Questions about your data",
        body: (
          <p>
            Contact <Fill>privacy contact email</Fill>.
          </p>
        ),
      },
    ],
  },
  {
    id: "risks",
    title: "Risks",
    items: [
      {
        id: "demo-values",
        title: "Demo values",
        body: (
          <p>
            Prices and market caps in this demo are simulated. They are not investment advice or live market quotes.
          </p>
        ),
      },
      {
        id: "live-launches",
        title: "Live launches",
        body: (
          <p>
            Real launches require wallet approval, current network costs and an admitted pump.fun quote asset. Token
            creation and NFT delivery are separate wallet transactions. If NFT delivery is interrupted after token
            creation, resume the existing launch rather than creating another token. A design preview is not proof of
            an on-chain NFT.
          </p>
        ),
      },
      {
        id: "token-risk",
        title: "Token risk",
        body: (
          <p>
            Real memecoins can lose all value. A collectible design does not guarantee token demand, returns or
            liquidity.
          </p>
        ),
      },
      {
        id: "stock-pairs",
        title: "Stock and memecoin pairs",
        body: (
          <p>
            A stock-themed design selects a specific admitted tokenized quote asset. It does not make the new token a
            stock, grant equity or promise backing. Quote assets have their own issuer terms, availability and risks.
            Pump.fun admission is rechecked before each wallet transaction.
          </p>
        ),
      },
    ],
  },
];

type SectionId = Section["id"];

/** The section a #hash names: a section itself, or the section holding that topic. */
function sectionOf(hash: string): SectionId | null {
  for (const s of SECTIONS) if (s.id === hash || s.items.some((i) => i.id === hash)) return s.id;
  return null;
}

/*
 * Terms, privacy and risks (MintDex's format): the title row, then a vertical list of the four sections (a row of
 * them on phones) beside one panel with the chosen section's topics, in two columns on wide screens. From 1024px
 * the panel scrolls on its own; phones scroll the page. The section lives in ?tab=, so a link opens it; an old
 * #hash link opens its section and brings the topic into view. The [TO FILL] slots stay marked until the operator
 * supplies the facts. Styles: styles/screens/legal.css.
 */
function Legal() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const docRef = useRef<HTMLDivElement>(null);
  const current: SectionId = tab ?? "terms";
  const section = SECTIONS.find((s) => s.id === current) ?? SECTIONS[0];
  // The topic an old #hash link names, brought into view once its section shows.
  const [topic, setTopic] = useState<string | null>(null);

  // An old #hash link (#fees, #token-risk): open its section (the URL keeps ?tab=, so the list marks it).
  useEffect(() => {
    const land = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const owner = hash ? sectionOf(hash) : null;
      if (!owner) return;
      if (owner !== (tab ?? "terms")) {
        void navigate({ search: { tab: owner === "terms" ? undefined : owner }, hash, replace: true, resetScroll: false });
      }
      setTopic(hash === owner ? null : hash);
    };
    land();
    window.addEventListener("hashchange", land);
    return () => window.removeEventListener("hashchange", land);
  }, [tab, navigate]);
  useEffect(() => {
    if (topic && sectionOf(topic) === current) document.getElementById(topic)?.scrollIntoView({ block: "start" });
  }, [topic, current]);

  return (
    <PageFrame className="mdx-page cdx-legal">
      <PageHeader title="Terms, privacy and risks" context={`Updated ${UPDATED}`} />
      <div className="cdx-legal__layout">
        <nav className="cdx-legal__nav" aria-label="Sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  to="/legal"
                  search={{ tab: s.id === "terms" ? undefined : s.id }}
                  replace
                  resetScroll={false}
                  // Marked current by the router (aria-current="page") only when ?tab= matches exactly.
                  activeOptions={{ explicitUndefined: true }}
                  onClick={() => {
                    setTopic(null);
                    docRef.current?.scrollTo({ top: 0 });
                  }}
                  className="cdx-legal__tab"
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="cdx-legal__more">
            <TextLink to="/how">How it works</TextLink>
          </p>
        </nav>
        <div ref={docRef} className="cdx-legal__doc mdx-scroll" tabIndex={-1}>
          <section aria-labelledby={section.id}>
            <h2 id={section.id} className="sr-only">{section.title}</h2>
            {section.id === "terms" ? (
              <>
                <p className="cdx-legal__lead">By using Launch a Card you agree to these terms.</p>
                <aside className="cdx-legal__summary" aria-labelledby="legal-summary">
                  <h3 id="legal-summary">The short version</h3>
                  <ul>
                    <li>Demo prices, balances and trades are simulated. Test funds have no cash value.</li>
                    <li>Wallet launches create a real pump.fun token and cost real SOL. You approve each transaction.</li>
                    <li>Real memecoins can lose all value.</li>
                  </ul>
                </aside>
              </>
            ) : null}
            <div className="cdx-legal__cols">
              {section.items.map((item) => (
                <div key={item.id} className="cdx-legal__item">
                  <h3 id={item.id} tabIndex={-1}>
                    {item.title}
                  </h3>
                  {item.body}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageFrame>
  );
}
