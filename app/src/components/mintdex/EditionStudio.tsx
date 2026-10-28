import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type CSSProperties } from "react";

import { chainCoinList } from "../../lib/chain/data";
import { listCoins } from "../../lib/mintdex/api";
import { EDITION_CATALOG, getEdition, type Edition, type EditionKey } from "../../lib/mintdex/editions";
import { IS_SIM } from "../../lib/mintdex/mode";
import type { CoinSummary } from "../../lib/mintdex/types";
import { EditionCard } from "./EditionCard";
import { faceSlot, type CardData } from "./MintCard";
import { Card3D, View3DHost, useMotionLevel, type Card3DHandle } from "./card3d";
import { editionMaterialStyle } from "./card3d/edition-material";

const CARD_SIZES = "(max-width: 640px) 240px, (max-width: 1100px) 260px, 300px";
const PURCHASE_NOTICE = "Preview only. Purchases will open after funding, pricing and edition limits are confirmed.";
// Print vermilion needs a lighter ink on the surrounding dark interface.
const interfaceAccent = (edition: Edition) => edition.key === "ronin" ? "#ef9f87" : edition.palette[1];

const EMPTY_CARD: CardData = {
  name: "Your token",
  ticker: "TOKEN",
  image: "",
  level: 1,
  mcapUsd: 0,
  mcapLabel: "Not quoted",
  holders: 0,
  dexNo: 0,
  dexLabel: "Preview",
  lore: "Your token’s artwork and identity will make this edition your own.",
  mintAddress: null,
};

/** A read-only atelier: choosing a token or edition never applies a design or creates a purchase. */
export function EditionStudio({
  initialCoin,
  selectedKey,
  onSelectEdition,
}: {
  initialCoin: CoinSummary | null;
  selectedKey: EditionKey;
  onSelectEdition: (key: EditionKey) => void;
}) {
  const coins = useQuery({
    queryKey: ["edition-preview-coins"],
    queryFn: IS_SIM ? () => listCoins({ data: {} }) : () => chainCoinList(),
    initialData: initialCoin ? [initialCoin] : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    retry: 1,
  });
  const [tokenId, setTokenId] = useState(initialCoin?.id ?? "");
  const [paused, setPaused] = useState(false);
  const cardRef = useRef<Card3DHandle | null>(null);
  const motion = useMotionLevel();
  const available = useMemo(() => {
    const loaded = coins.data ?? [];
    return initialCoin && !loaded.some((coin) => coin.id === initialCoin.id) ? [initialCoin, ...loaded] : loaded;
  }, [coins.data, initialCoin]);
  const token = available.find((coin) => coin.id === tokenId) ?? available[0] ?? null;
  const edition = getEdition(selectedKey) ?? EDITION_CATALOG[0];
  const base: CardData = token ?? EMPTY_CARD;
  const items = useMemo(
    () => EDITION_CATALOG.map((entry) => ({
      id: `edition-${token?.id ?? "preview"}-${entry.key}`,
      card: { ...base, edition: entry.key },
      coinId: token?.id ?? null,
    })),
    [token, base],
  );
  const selectedItem = items.find((item) => item.card.edition === edition.key) ?? items[0];
  const faces = useMemo(
    () => items.map((item) => faceSlot(item.card, { key: item.id, sizes: CARD_SIZES, priority: item.id === selectedItem.id })),
    [items, selectedItem.id],
  );
  const name = token ? `${token.name} · $${token.ticker}` : "Your token · artwork preview";

  return (
    <section
      className="mdx-edition-studio"
      data-testid="limited-edition-studio"
      data-edition={edition.key}
      style={{ "--edition-accent": interfaceAccent(edition) } as CSSProperties}
      aria-label="Limited edition card previews"
    >
      <h1 className="sr-only">Limited edition card previews</h1>
      <div className="mdx-edition-studio__stage">
        <div className="mdx-edition-studio__token">
          <label htmlFor="edition-token-preview">Token preview</label>
          <select
            id="edition-token-preview"
            data-testid="token-preview-select"
            value={token?.id ?? ""}
            onChange={(event) => setTokenId(event.target.value)}
            disabled={!available.length}
            aria-describedby="edition-token-status"
          >
            {!available.length ? <option value="">{coins.isPending ? "Loading tokens…" : "Your token"}</option> : null}
            {available.map((coin) => <option key={coin.id} value={coin.id}>{coin.name} (${coin.ticker})</option>)}
          </select>
        </div>

        <div className="mdx-edition-studio__canvas" data-testid="edition-preview">
          <View3DHost
            className="mdx-edition-studio__card"
            btnClassName="mdx-v3dbtn--stage"
            item={selectedItem}
            list={items}
          >
            <Card3D
              key={`${token?.id ?? "preview"}:${base.level}`}
              ref={cardRef}
              faces={faces}
              front={selectedItem.id}
              style={editionMaterialStyle(edition.key)}
              label={`${base.name}, ${edition.name} edition preview. Drag to turn; press F to flip.`}
              swap={motion === "calm" ? "fade" : "spin"}
              depth="hand"
              ground="none"
              idle={paused ? "none" : "spin"}
              drag="turn"
              flippable
              tapTurns
              focusable
              gyroChip={false}
            />
          </View3DHost>
        </div>

        <div className="mdx-edition-studio__stage-foot">
          <p className="mdx-edition-studio__token-name" title={name}>{name}</p>
          <p className="mdx-edition-studio__hint">Drag to turn. Tap the card or press F to flip.</p>
          <div className="mdx-edition-studio__tools">
            <button type="button" onClick={() => cardRef.current?.turnOver()}>Flip card</button>
            <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
              {paused ? "Resume motion" : "Pause motion"}
            </button>
          </div>
          <div id="edition-token-status" className="mdx-edition-studio__token-status">
            {coins.isError ? (
              <p role="alert">Tokens couldn’t load. {token ? "Your current preview is still available. " : "You can still explore each template. "}
                <button type="button" onClick={() => void coins.refetch()} disabled={coins.isFetching}>{coins.isFetching ? "Refreshing…" : "Refresh tokens"}</button>
              </p>
            ) : coins.isPending ? (
              <p role="status">Loading tokens. You can explore the templates while they load.</p>
            ) : !available.length ? (
              <p>No public tokens are available yet. This is a template preview. <button type="button" onClick={() => void coins.refetch()} disabled={coins.isFetching}>{coins.isFetching ? "Refreshing…" : "Refresh tokens"}</button></p>
            ) : coins.isFetching ? <p role="status">Refreshing token previews…</p> : null}
            {!IS_SIM && (coins.data?.length ?? 0) >= 500 ? <p>Showing up to 500 public tokens.</p> : null}
          </div>
        </div>
      </div>

      <div className="mdx-edition-studio__collection">
        <div className="mdx-edition-studio__detail">
          <h2>{edition.name}</h2>
          <p className="mdx-edition-studio__tagline">{edition.tagline}</p>
          <p className="mdx-edition-studio__description">{edition.description}</p>
          <dl className="mdx-edition-studio__facts">
            <div className="mdx-edition-studio__finish"><dt>Signature finish</dt><dd>{edition.finish}</dd></div>
            <div><dt>Price</dt><dd>To be announced</dd></div>
            <div><dt>Release size</dt><dd>To be announced</dd></div>
          </dl>
          <button
            className="mdx-edition-studio__purchase"
            type="button"
            data-testid="edition-purchase"
            disabled
            aria-describedby="edition-purchase-status"
          >Purchases paused</button>
          <p id="edition-purchase-status" className="mdx-edition-studio__purchase-status">{PURCHASE_NOTICE}</p>
        </div>

        <div className="mdx-edition-studio__catalog" role="group" aria-label="Choose an edition to preview">
          {EDITION_CATALOG.map((entry) => (
            <button
              key={entry.key}
              className="mdx-edition-studio__option"
              type="button"
              data-testid={`edition-option-${entry.key}`}
              aria-pressed={entry.key === edition.key}
              onClick={() => onSelectEdition(entry.key)}
              style={{ "--option-accent": interfaceAccent(entry) } as CSSProperties}
            >
              <span className="mdx-edition-studio__mini" aria-hidden>
                <EditionCard edition={entry} card={base} compact sizes="100px" />
              </span>
              <span className="mdx-edition-studio__option-name">{entry.name}</span>
              <span className="mdx-edition-studio__option-state">{entry.key === edition.key ? "Previewing" : "Preview edition"}</span>
            </button>
          ))}
        </div>
        <p className="mdx-edition-studio__policy">Planned for the token’s original creator. Editions change the look; earned rarity and creator fees stay the same.</p>
      </div>
    </section>
  );
}
