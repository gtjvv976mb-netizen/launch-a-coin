import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageFrame, PageHeader } from "../components/mintdex/ui";
import { pageHead } from "../lib/mintdex/seo";
export const Route = createFileRoute("/legal")({
  validateSearch: z.object({
    tab: z.enum(["terms", "privacy", "risks"]).optional().catch(undefined),
  }),
  head: () => pageHead({ path: "/legal", title: "Terms and privacy | CardDex" }),
  component: Legal,
});
const CONTENT = {
  terms: {
    title: "Terms",
    sections: [
      [
        "Local demo",
        "This CardDex build simulates token launches, NFT cards and pump.fun token trading. Test SOL has no cash value. No real token or NFT is minted, and nothing is sent to Solana or pump.fun.",
      ],
      [
        "Your card",
        "A creator chooses one permanent design at launch. Market-cap changes never replace it. The card is a collectible record paired with the token. CardDex has no NFT marketplace, bids or resale royalties.",
      ],
      [
        "Content rules",
        "Use names, descriptions and art you have the right to use. Do not impersonate another project, mislead users, promote scams or promise investment returns.",
      ],
      [
        "Test data",
        "Demo tokens and balances may be reset during development. This local build is provided as is.",
      ],
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      [
        "Browser session",
        "A session cookie remembers your local demo account. Clearing browser data ends access to that session. No wallet private keys are requested or stored.",
      ],
      [
        "Local storage",
        "Token details, trades and uploaded card images are stored in this project’s isolated local database and image storage. CardDex does not share MintDex accounts or data.",
      ],
      [
        "External links",
        "Opening pump.fun or another external link takes you to that service, which applies its own terms and privacy policy.",
      ],
    ],
  },
  risks: {
    title: "Risks",
    sections: [
      [
        "Demo values",
        "Prices and market caps in this demo are simulated. They are not investment advice or live market quotes.",
      ],
      [
        "Live launches",
        "Future real launches through pump.fun require wallet approval, current launch costs and an independently configured CardDex NFT integration. A design preview is not proof of an on-chain NFT.",
      ],
      [
        "Token risk",
        "Real memecoins can lose all value. A collectible design does not guarantee token demand, returns or liquidity.",
      ],
    ],
  },
};
function Legal() {
  const tab = Route.useSearch().tab ?? "terms",
    content = CONTENT[tab];
  return (
    <PageFrame className="mdx-scroll overflow-y-auto pb-10">
      <PageHeader title={content.title} context="CardDex · Updated 28 October 2026" />
      <nav className="flex gap-5">
        {(["terms", "privacy", "risks"] as const).map((t) => (
          <Link
            key={t}
            to="/legal"
            search={{ tab: t }}
            aria-current={tab === t ? "page" : undefined}
            className="mdx-link min-h-11 inline-flex items-center"
          >
            {CONTENT[t].title}
          </Link>
        ))}
      </nav>
      <div className="max-w-[68ch] space-y-8">
        {content.sections.map(([title, body]) => (
          <section key={title}>
            <h2 className="mb-2 text-lg font-semibold">{title}</h2>
            <p className="leading-relaxed text-slate">{body}</p>
          </section>
        ))}
      </div>
    </PageFrame>
  );
}
