import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { oneOf, searchSchema } from "../lib/mintdex/search";
import { PageFrame, PageHeader, TextLink } from "../components/mintdex/ui";
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

const UPDATED = "31 October 2026";

type Item = { id: string; title: string; body: ReactNode };
type Section = { id: "terms" | "fees" | "privacy" | "risks"; title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    id: "terms",
    title: "Terms",
    items: [
      {
        id: "eligibility",
        title: "Who can use it",
        body: (
          <>
            <p>You must be at least 18, or the age of majority where you live if that is higher.</p>
            <p>
              Not available to anyone in, or ordinarily resident in, a country or region under comprehensive sanctions
              (including Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk and Luhansk regions of Ukraine), or to
              anyone named on a government sanctions list. You are responsible for following the laws that apply to you.
            </p>
          </>
        ),
      },
      {
        id: "wallet-launches",
        title: "Wallet launches",
        body: (
          <p>
            A launch creates a real pump.fun token and a separate collectible NFT on Solana mainnet. Each transaction
            requires your wallet approval and real network costs. Tokens trade on pump.fun, not on Launch a Card. On
            this site, a coin means a token created on pump.fun.
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
        id: "liability",
        title: "Liability",
        body: (
          <>
            <p>
              Launch a Card is provided “as is” and “as available”, without warranties of any kind, express or implied,
              including merchantability, fitness for a particular purpose and non-infringement. Launch a Card does not
              control Solana, pump.fun, wallets or quote-asset issuers and is not responsible for their availability,
              fees, errors or losses.
            </p>
            <p>
              To the fullest extent the law allows, Launch a Card and its operator are not liable for indirect,
              incidental, special, consequential or punitive damages, or for lost profits, tokens, funds or data. Total
              liability for any claim is limited to the fees you paid to Launch a Card in the 12 months before the claim.
              Nothing here limits liability that the law does not allow to be limited.
            </p>
          </>
        ),
      },
      {
        id: "changes",
        title: "Changes to these terms",
        body: (
          <p>
            The Updated date at the top of this page shows the current version. Changes are posted on this page with a
            new Updated date. Using Launch a Card after a change means you accept the updated terms.
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
            A session cookie remembers your wallet-authenticated launch session. Wallet authentication uses a clearly
            labelled message, not a transaction. No wallet private keys are requested or
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
    ],
  },
  {
    id: "risks",
    title: "Risks",
    items: [
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
 * #hash link opens its section and brings the topic into view. Styles: styles/screens/legal.css.
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
                    <li>Every launch creates a real pump.fun token and costs real SOL. You approve each transaction.</li>
                    <li>Coins trade on pump.fun. Launch a Card takes no fee on launches or trades.</li>
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
