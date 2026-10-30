import { createFileRoute, notFound } from "@tanstack/react-router";

import { LaunchCardPreview } from "../../components/carddex/live/LaunchCardPreview";
import { PairLogo } from "../../components/carddex/PairLogo";
import { EmptyState } from "../../components/mintdex/empty-state";
import { Icon, PageFrame, PageHeader, TextLink, buttonClass } from "../../components/mintdex/ui";
import { getCardDesign } from "../../lib/carddex/designs";
import { getLaunchedCoin } from "../../lib/carddex/live/launched";
import {
  SOLANA_ADDRESS,
  launchCard,
  pumpFunCoinUrl,
  solscanTokenUrl,
  type PublicLiveLaunch,
} from "../../lib/carddex/live/launches";
import { getPairAsset } from "../../lib/carddex/pairs";
import { clip, pageHead, sentences, shareArt } from "../../lib/mintdex/seo";

/*
 * A launched coin's page, at /coin/<its pump.fun mint>: the one-of-one card it minted (the rounded 3D card, turnable,
 * with its shimmer on both faces), what the card records (design, pair, creator, when), and the two places the coin
 * lives: pump.fun to trade it, Solscan for the chain record. Anything that is not a finished launch's mint is a real
 * 404 inside the app shell. The page reads the launch receipt this Worker stored, never the chain or a price.
 */
export const Route = createFileRoute("/coin/$id")({
  loader: async ({ params }) => {
    const id = params.id.trim();
    if (!SOLANA_ADDRESS.test(id)) throw notFound();
    const coin = await getLaunchedCoin({ data: { mint: id } });
    if (!coin) throw notFound();
    return coin;
  },
  head: ({ loaderData }) =>
    loaderData ? coinHead(loaderData) : { meta: [{ title: "Coin not found | Launch a Card" }, { name: "robots", content: "noindex" }] },
  notFoundComponent: CoinNotFound,
  component: CoinView,
});

function coinHead(coin: PublicLiveLaunch) {
  const design = getCardDesign(coin.designKey);
  return pageHead({
    path: `/coin/${coin.tokenMint}`,
    title: `${coin.name} ($${coin.ticker}) | Launch a Card`,
    description: sentences(clip(coin.lore, 140), `${design.name}, its one-of-one card`, "Launched on pump.fun"),
    image: shareArt(coin.cardImage ?? coin.image ?? ""),
    imageAlt: `${coin.name} card`,
    card: "summary",
  });
}

function CoinNotFound() {
  return (
    <EmptyState
      className="mdx-page"
      title="No coin here"
      body="This address is not a coin launched through Launch a Card."
      action={<TextLink to="/discover">Discover coins</TextLink>}
    />
  );
}

function External({ href, children, primary = false, label }: { href: string; children: string; primary?: boolean; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      className={buttonClass({ variant: primary ? "primary" : "outline", size: "md", block: false })}
    >
      {children}
      <Icon name="external" size={16} />
    </a>
  );
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function CoinView() {
  const coin = Route.useLoaderData();
  const design = getCardDesign(coin.designKey);
  const pair = getPairAsset(coin.quoteAssetKey);
  const launched = new Date(coin.createdAt);
  return (
    <PageFrame className="mdx-page cdx-coin-launched">
      <PageHeader
        title={coin.name}
        context={
          <>
            <span className="num">${coin.ticker}</span> · {design.name} design ·{" "}
            <TextLink to="/how" hash="cards">How it works</TextLink>
          </>
        }
      />
      <div className="cdx-coin-launched__body">
        <section aria-label={`${coin.name} card`} className="cdx-launch-stage cdx-coin-launched__card">
          <LaunchCardPreview card={launchCard(coin)} />
        </section>
        <section aria-label="Coin details" className="cdx-coin-launched__facts mdx-plinth">
          {coin.lore ? <p className="cdx-coin-launched__lore">{coin.lore}</p> : null}
          <dl className="cdx-coin-launched__list">
            <div>
              <dt>Pair</dt>
              <dd className="cdx-coin-launched__pair">
                <PairLogo asset={pair} size={20} />
                <span>
                  ${coin.ticker} / {pair.symbol}
                </span>
              </dd>
            </div>
            <div>
              <dt>Card design</dt>
              <dd>{design.name}</dd>
            </div>
            {coin.creator ? (
              <div>
                <dt>Creator</dt>
                <dd className="num">{coin.creator}</dd>
              </div>
            ) : null}
            <div>
              <dt>Launched</dt>
              <dd>
                <time dateTime={launched.toISOString()}>
                  {launched.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
                </time>
              </dd>
            </div>
            <div>
              <dt>Coin</dt>
              <dd className="num">{short(coin.tokenMint)}</dd>
            </div>
            {coin.nftMint ? (
              <div>
                <dt>Card NFT</dt>
                <dd>
                  <TextLink href={solscanTokenUrl(coin.nftMint)} target="_blank">
                    <span className="num">{short(coin.nftMint)}</span>
                    <span className="sr-only"> on Solscan (opens in a new tab)</span>
                    <Icon name="external" size={14} />
                  </TextLink>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="cdx-coin-launched__actions">
            <External href={pumpFunCoinUrl(coin.tokenMint)} primary label={`Trade ${coin.name} on pump.fun`}>
              Trade on pump.fun
            </External>
            <External href={solscanTokenUrl(coin.tokenMint)} label={`${coin.name} on Solscan`}>
              Solscan
            </External>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
