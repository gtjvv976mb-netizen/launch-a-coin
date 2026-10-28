import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageFrame, PageHeader } from "../components/mintdex/ui";
import { pageHead } from "../lib/mintdex/seo";
export const Route = createFileRoute("/legal")({
  validateSearch: z.object({
    tab: z.enum(["terms", "privacy", "risks"]).optional().catch(undefined),
  }),
  head: () => pageHead({ path: "/legal", title: "Terms and privacy | Launch a Card" }),
  component: Legal,
});
const CONTENT = {
  terms: {
    title: "Terms",
    sections: [
      [
        "Wallet launches and demo trading",
        "The wallet launch flow, when configured and enabled, creates a real pump.fun token and a separate collectible NFT on Solana mainnet. Each transaction requires your wallet approval and real network costs. Pages labelled demo use simulated tokens, balances and trading; test funds have no cash value.",
      ],
      [
        "Your card",
        "A creator chooses one permanent design at launch. Market-cap changes never replace it. After the token launch is verified, a separate immutable one-of-one card NFT is created in the creator’s wallet. NFT ownership does not convey token ownership or stock rights. Launch a Card has no NFT marketplace, bids or resale royalties.",
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
        "Separate session cookies remember your demo account and wallet-authenticated launch session. Wallet authentication uses a clearly labelled message, not a transaction. No wallet private keys are requested or stored by the server.",
      ],
      [
        "Launch records and public assets",
        "Launch details, wallet addresses, recovery records and images are stored in this platform’s own database and object storage. Published token and NFT metadata, images and blockchain records are public. Confirmed blockchain data cannot be removed by clearing browser data. Launch a Card does not share MintDex accounts or data.",
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
        "Real launches require wallet approval, current network costs and an admitted pump.fun quote asset. Token creation and NFT delivery are separate wallet transactions. If NFT delivery is interrupted after token creation, resume the existing launch rather than creating another token. A design preview is not proof of an on-chain NFT.",
      ],
      [
        "Token risk",
        "Real memecoins can lose all value. A collectible design does not guarantee token demand, returns or liquidity.",
      ],
      ["Stock and memecoin pairs", "A stock-themed design selects a specific admitted tokenized quote asset. It does not make the new token a stock, grant equity or promise backing. Quote assets have their own issuer terms, availability and risks. Pump.fun admission is rechecked before each wallet transaction."],
    ],
  },
};
function Legal() {
  const tab = Route.useSearch().tab ?? "terms",
    content = CONTENT[tab];
  return (
    <PageFrame className="mdx-scroll overflow-y-auto pb-10">
      <PageHeader title={content.title} context="Launch a Card · Updated 28 October 2026" />
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
