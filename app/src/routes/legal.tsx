import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { oneOf, searchSchema } from "../lib/mintdex/search";
import { PageFrame, PageHeader, prefersReducedMotion } from "../components/mintdex/ui";
import { LAMPORTS, LAUNCH_FEE, TRADE_FEE_BPS } from "../lib/mintdex/constants";
import { pct } from "../lib/mintdex/copy";
import { pageHead } from "../lib/mintdex/seo";

export const Route = createFileRoute("/legal")({
  // Old links (?tab=privacy) still land on their section of the one document.
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

const UPDATED = "28 October 2026";

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
                  <td>Launch a Card currently adds no fee to launch or card transactions.</td>
                </tr>
                <tr>
                  <th scope="row">Launch a Card share of trading fees</th>
                  <td>
                    <Fill>platform share of trading fees, or none</Fill>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Card NFT issuance</th>
                  <td>
                    Account rent, the Solana network fee and the Metaplex NFT fee, paid from your wallet.{" "}
                    <Fill>typical total in SOL</Fill>
                  </td>
                </tr>
                <tr>
                  <th scope="row">pump.fun creation and trading fees</th>
                  <td>
                    Set and charged by pump.fun. <Fill>link to pump.fun fee schedule</Fill>
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

/** Every heading the contents list can mark: the four sections and the topics under them, in reading order. */
const HEADINGS = SECTIONS.flatMap((s) => [s.id as string, ...s.items.map((i) => i.id)]);

/**
 * One readable document (a Read screen, one scroller): the title row, then from 1024px three columns across the
 * column (styles/screens/legal.css): the contents (each section one click away, the one you are reading marked, its
 * topics listed; every topic on tall screens), the text in a ~65-character measure, and the short version beside it.
 * From 768px the four section links stay pinned under the top bar over the text and the short version beside it;
 * under 768px the links, then the short version, then the text. Every heading is a linkable anchor; the [TO FILL]
 * slots stay marked until the operator supplies the facts.
 */
function Legal() {
  const { tab } = Route.useSearch();
  const docRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  // A heading jumped to (a contents link or a #hash) stays marked while the page scrolls to it, and at the end of
  // the page where it cannot reach the top; the reader's own scroll (wheel, touch, keys) lets the position decide.
  const pinned = useRef<string | null>(null);

  // The page itself scrolls (main#content, or the window when there is no app frame), so the contents follow
  // that scroller: the last heading that has reached the top of its view is current; at the very end, the last.
  const scroller = useCallback((): HTMLElement | null => docRef.current?.closest<HTMLElement>("#content") ?? null, []);
  const update = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    if (pinned.current) {
      setCurrent(pinned.current);
      return;
    }
    const box = scroller();
    const top = box ? box.getBoundingClientRect().top : 0;
    let next = HEADINGS[0];
    for (const id of HEADINGS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top - top <= 96) next = id;
    }
    const el = box ?? document.documentElement;
    if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) next = HEADINGS[HEADINGS.length - 1];
    setCurrent(next);
  }, [scroller]);

  // Land on the linked section: #token-risk, or an old ?tab=risks link. A later #hash change does the same.
  useEffect(() => {
    const land = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const target = hash && document.getElementById(hash) ? hash : tab;
      if (target && target !== "terms") {
        pinned.current = target;
        document.getElementById(target)?.scrollIntoView({ block: "start" });
      }
      update();
    };
    land();
    // The router may restore or apply the hash scroll after this effect; read the position again once it has.
    const raf = requestAnimationFrame(update);
    window.addEventListener("hashchange", land);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", land);
    };
  }, [tab, update]);

  useEffect(() => {
    const target: HTMLElement | Window = scroller() ?? window;
    // A rect read per heading per scroll event: cheap enough to run directly, and it keeps working in a background tab.
    const release = () => {
      pinned.current = null;
    };
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      window.addEventListener(type, release, { passive: true, capture: true });
    }
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        window.removeEventListener(type, release, { capture: true });
      }
    };
  }, [scroller, update]);

  function onNav(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    history.replaceState(history.state, "", `#${id}`);
    pinned.current = id;
    setCurrent(id);
    el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  const section = SECTIONS.find((s) => s.id === current || s.items.some((i) => i.id === current))?.id ?? SECTIONS[0].id;

  return (
    <PageFrame className="cdx-legal">
      <PageHeader title="Terms, privacy and risks" context={`Launch a Card · Updated ${UPDATED}`} wrapContext />
      <div className="cdx-legal__layout">
        {/* Phones and tablets: the four sections, pinned under the top bar while the text scrolls. */}
        <nav className="cdx-legal__jump" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => onNav(e, s.id)}
              aria-current={section === s.id ? "location" : undefined}
            >
              {s.title}
            </a>
          ))}
        </nav>
        {/* From 1024px: every section and topic; the one in view is marked. */}
        <nav className="cdx-legal__toc" aria-labelledby="legal-contents">
          <p id="legal-contents" className="cdx-legal__toc-head">
            Contents
          </p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => onNav(e, s.id)}
                  className="cdx-legal__toc-section"
                  data-open={section === s.id || undefined}
                  aria-current={current === s.id ? "location" : undefined}
                >
                  {s.title}
                </a>
                <ol>
                  {s.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        onClick={(e) => onNav(e, item.id)}
                        aria-current={current === item.id ? "location" : undefined}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>
        <aside className="cdx-legal__summary" aria-labelledby="legal-summary">
          <h2 id="legal-summary">The short version</h2>
          <ul>
            <li>Demo prices, balances and trades are simulated. Test funds have no cash value.</li>
            <li>Wallet launches create a real pump.fun token and cost real SOL. You approve each transaction.</li>
            <li>Real memecoins can lose all value.</li>
          </ul>
        </aside>
        <div ref={docRef} className="cdx-legal__doc">
          {SECTIONS.map((s) => (
            <section key={s.id} aria-labelledby={s.id}>
              <h2 id={s.id} tabIndex={-1}>
                {s.title}
              </h2>
              {s.items.map((item) => (
                <Fragment key={item.id}>
                  <h3 id={item.id} tabIndex={-1}>
                    {item.title}
                  </h3>
                  {item.body}
                </Fragment>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
