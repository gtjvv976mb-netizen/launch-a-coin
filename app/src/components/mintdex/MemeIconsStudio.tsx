import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";

import { chainCoinList } from "../../lib/chain/data";
import { listCoins } from "../../lib/mintdex/api";
import { MEME_ICON_CATALOG, getMemeIcon, type MemeIconKey } from "../../lib/mintdex/meme-icons";
import { IS_SIM } from "../../lib/mintdex/mode";
import type { CoinSummary } from "../../lib/mintdex/types";
import { MemeIconCard, MemeThemePortrait } from "./MemeIconCard";
import { faceSlot, type CardData } from "./MintCard";
import { Card3D, View3DHost, useMotionLevel, type Card3DHandle } from "./card3d";
import { memeIconMaterialStyle } from "./card3d/meme-icon-material";

const CARD_SIZES = "(max-width: 640px) 240px, (max-width: 1100px) 260px, 300px";
const PURCHASE_NOTICE = "Preview only. Purchases will open after funding, pricing and edition limits are confirmed.";
const CATEGORIES = [
  { key: "memecoins", label: "Meme coins" },
  { key: "meme-stocks", label: "Meme stocks" },
  { key: "crypto-companies", label: "Crypto companies" },
] as const;

/** Reusable frame previews. Selecting a template never purchases or applies an entitlement. */
export function MemeIconsStudio({
  initialCoin,
  selectedKey,
  onSelectIcon,
}: {
  initialCoin: CoinSummary | null;
  selectedKey: MemeIconKey;
  onSelectIcon: (key: MemeIconKey) => void;
}) {
  const coins = useQuery({
    queryKey: ["edition-preview-coins"],
    queryFn: IS_SIM ? () => listCoins({ data: {} }) : () => chainCoinList(),
    initialData: initialCoin ? [initialCoin] : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    retry: 1,
  });
  const [tokenId, setTokenId] = useState("custom");
  const [customName, setCustomName] = useState("Your token");
  const [customTicker, setCustomTicker] = useState("TOKEN");
  const [customArt, setCustomArt] = useState("");
  const [artError, setArtError] = useState<string | null>(null);
  const [artLoading, setArtLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const activeArt = useRef("");
  const artRequest = useRef(0);
  const objectUrls = useRef(new Set<string>());
  const releaseArt = (url: string) => {
    if (objectUrls.current.delete(url)) URL.revokeObjectURL(url);
  };
  useEffect(() => () => {
    artRequest.current++;
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  async function chooseArtwork(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    const file = field.files?.[0];
    if (!file) return;
    const request = ++artRequest.current;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setArtError("Use a PNG, JPEG, WebP or GIF image up to 5 MB.");
      setArtLoading(false);
      field.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setArtError(null);
    setArtLoading(true);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request !== artRequest.current) {
        releaseArt(url);
        return;
      }
      releaseArt(activeArt.current);
      activeArt.current = url;
      setCustomArt(url);
    } catch {
      releaseArt(url);
      if (request === artRequest.current) {
        setArtError("That image couldn’t be read. Choose another image.");
        field.value = "";
      }
    } finally {
      if (request === artRequest.current) setArtLoading(false);
    }
  }

  function removeArtwork() {
    artRequest.current++;
    releaseArt(activeArt.current);
    activeArt.current = "";
    setCustomArt("");
    setArtError(null);
    setArtLoading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  const available = useMemo(() => {
    const loaded = coins.data ?? [];
    return initialCoin && !loaded.some((coin) => coin.id === initialCoin.id) ? [initialCoin, ...loaded] : loaded;
  }, [coins.data, initialCoin]);
  const isCustom = tokenId === "custom";
  const token = isCustom ? null : available.find((coin) => coin.id === tokenId) ?? available[0] ?? null;
  const base = useMemo<CardData>(() => token ?? ({
    name: customName.trim() || "Your token",
    ticker: customTicker.trim() || "TOKEN",
    image: customArt,
    lore: "Your token’s story appears here.",
    level: 1,
    mcapUsd: 0,
    mcapLabel: "Not quoted",
    holders: 0,
    dexNo: 0,
    dexLabel: "Preview",
    mintAddress: null,
  }), [token, customName, customTicker, customArt]);
  const icon = getMemeIcon(selectedKey) ?? MEME_ICON_CATALOG[0];
  const motion = useMotionLevel();
  const [paused, setPaused] = useState(false);
  const cardRef = useRef<Card3DHandle | null>(null);
  const visibleIcons = useMemo(() => MEME_ICON_CATALOG.filter((entry) => entry.category === icon.category), [icon.category]);
  const items = useMemo(
    () => visibleIcons.map((entry) => ({
      id: `creator-template-${token?.id ?? "preview"}-${entry.key}`,
      card: { ...base, memeIcon: entry.key },
      coinId: token?.id ?? null,
    })),
    [visibleIcons, token, base],
  );
  const selectedItem = items.find((item) => item.card.memeIcon === icon.key) ?? items[0];
  const faces = useMemo(
    () => items.map((item) => faceSlot(item.card, { key: item.id, sizes: CARD_SIZES, priority: item.id === selectedItem.id })),
    [items, selectedItem.id],
  );

  return (
    <section
      className="mdx-meme-studio"
      data-testid="meme-icons-studio"
      data-meme-icon={icon.key}
      data-category={icon.category}
      style={{ "--meme-accent": icon.palette[1] } as CSSProperties}
      aria-labelledby="meme-icons-title"
    >
      <header className="mdx-meme-studio__header">
        <h1 id="meme-icons-title">Creator templates</h1>
        <p>Choose a meme coin, stock or crypto-inspired design for your token. Your artwork, name and ticker stay yours.</p>
      </header>

      <div className="mdx-meme-studio__token-preview">
        <label htmlFor="creator-token-preview">Token preview</label>
        <select
          id="creator-token-preview"
          data-testid="creator-token-preview-select"
          value={isCustom ? "custom" : token?.id ?? "custom"}
          onChange={(event) => setTokenId(event.target.value)}
          aria-describedby="creator-token-status"
        >
          <option value="custom">Custom token preview</option>
          {available.map((coin) => <option key={coin.id} value={coin.id}>{coin.name} (${coin.ticker})</option>)}
        </select>
        <span className="mdx-meme-studio__preview-label">Preview on your token</span>
        <div id="creator-token-status" className="mdx-meme-studio__token-status">
          {coins.isError ? <p role="alert">Public tokens couldn’t load. Custom previews still work. <button type="button" onClick={() => void coins.refetch()} disabled={coins.isFetching}>{coins.isFetching ? "Refreshing…" : "Refresh tokens"}</button></p>
            : coins.isPending ? <p role="status">Loading public tokens. You can preview your own artwork now.</p>
              : !available.length ? <p>No public tokens are available yet. <button type="button" onClick={() => void coins.refetch()} disabled={coins.isFetching}>{coins.isFetching ? "Refreshing…" : "Refresh tokens"}</button></p>
                : null}
          {!IS_SIM && (coins.data?.length ?? 0) >= 500 ? <p>Showing up to 500 public tokens.</p> : null}
        </div>
      </div>

      {isCustom ? (
        <details className="mdx-meme-studio__custom" data-testid="custom-token-preview">
          <summary className="mdx-meme-studio__custom-heading"><span>Personalize your token</span><span>Name, ticker & artwork</span></summary>
          <div className="mdx-meme-studio__custom-fields">
            <div><label htmlFor="creator-token-name">Token name</label><input id="creator-token-name" value={customName} maxLength={32} onChange={(event) => setCustomName(event.target.value)} /></div>
            <div><label htmlFor="creator-token-ticker">Token ticker</label><input id="creator-token-ticker" value={customTicker} maxLength={10} onChange={(event) => setCustomTicker(event.target.value.replace(/^\$/, "").toUpperCase())} /></div>
            <div className="mdx-meme-studio__art-field">
              <label htmlFor="creator-token-art">Token artwork</label>
              <input ref={fileInput} id="creator-token-art" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void chooseArtwork(event)} aria-describedby="creator-art-help creator-art-status" aria-invalid={!!artError} />
              <p id="creator-art-help">Up to 5 MB. Stays in this browser; nothing is uploaded.</p>
              <div id="creator-art-status">{artError ? <p role="alert">{artError}</p> : artLoading ? <p role="status">Reading your artwork…</p> : null}</div>
              {customArt ? <button type="button" onClick={removeArtwork}>Remove artwork</button> : null}
            </div>
          </div>
        </details>
      ) : null}

      <div className="mdx-meme-studio__categories" role="group" aria-label="Template categories">
        {CATEGORIES.map((category) => (
          <button
            key={category.key}
            type="button"
            data-testid={`icon-category-${category.key}`}
            aria-pressed={category.key === icon.category}
            onClick={() => {
              if (category.key === icon.category) return;
              const first = MEME_ICON_CATALOG.find((entry) => entry.category === category.key);
              if (first) onSelectIcon(first.key);
            }}
          >{category.label}</button>
        ))}
      </div>

      <div
        className="mdx-meme-studio__selector"
        role="group"
        aria-label="Choose a creator template to preview"
        style={{ "--meme-count": visibleIcons.length } as CSSProperties}
      >
        {visibleIcons.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="mdx-meme-studio__option"
            data-testid={`meme-icon-option-${entry.key}`}
            aria-pressed={entry.key === icon.key}
            aria-label={`Preview ${entry.inspiration ? `${entry.inspiration}-inspired ${entry.name}` : entry.name} on ${base.name}`}
            onClick={() => onSelectIcon(entry.key)}
            style={{ "--meme-option-accent": entry.palette[1] } as CSSProperties}
          >
            <span className={`mdx-meme-studio__mini ${entry.category === "memecoins" ? "mdx-meme-studio__mini--portrait" : ""}`} aria-hidden>
              {entry.category === "memecoins" ? <MemeThemePortrait icon={entry} /> : <MemeIconCard icon={entry} card={base} compact sizes="64px" />}
            </span>
            <span className="mdx-meme-studio__option-text">
              <span className="mdx-meme-studio__token">{entry.inspiration ?? entry.name}</span>
              <span className="mdx-meme-studio__ticker">{entry.name}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mdx-meme-studio__workbench">
        <div className="mdx-meme-studio__stage">
          <div className="mdx-meme-studio__canvas" data-testid="meme-icon-preview">
            <View3DHost
              className="mdx-meme-studio__card"
              btnClassName="mdx-v3dbtn--stage"
              item={selectedItem}
              list={items}
            >
              <Card3D
                key={`${token?.id ?? "custom"}:${base.level}`}
                ref={cardRef}
                faces={faces}
                front={selectedItem.id}
                style={memeIconMaterialStyle(icon.key)}
                label={`${base.name}, ${icon.name} creator template preview. Drag to turn; press F to flip.`}
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
          <div className="mdx-meme-studio__stage-foot">
            <p>{base.name} <span>· ${base.ticker}{token ? "" : " · Preview only"}</span></p>
            <p className="mdx-meme-studio__hint">Drag to turn. Tap the card or press F to flip.</p>
            <div className="mdx-meme-studio__tools">
              <button type="button" onClick={() => cardRef.current?.turnOver()}>Flip card</button>
              <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
                {paused ? "Resume motion" : "Pause motion"}
              </button>
            </div>
          </div>
        </div>

        <div className="mdx-meme-studio__detail">
          {icon.inspiration ? <p className="mdx-meme-studio__theme">{icon.inspiration}-inspired template</p> : null}
          <h2>{icon.name}</h2>
          <p className="mdx-meme-studio__tagline">{icon.tagline}</p>
          <p className="mdx-meme-studio__description">{icon.description}</p>

          <dl className="mdx-meme-studio__facts">
            <div className="mdx-meme-studio__finish"><dt>Design finish</dt><dd>{icon.finish}</dd></div>
            <div><dt>Price</dt><dd>To be announced</dd></div>
            <div><dt>Release size</dt><dd>To be announced</dd></div>
          </dl>
          <button
            className="mdx-meme-studio__purchase"
            type="button"
            data-testid="meme-icon-purchase"
            disabled
            aria-describedby="meme-icon-purchase-status"
          >Purchases paused</button>
          <p className="mdx-meme-studio__purchase-status" id="meme-icon-purchase-status">{PURCHASE_NOTICE}</p>
          <p className="mdx-meme-studio__concept-note">Cosmetic templates leave earned rarity and creator fees unchanged. Purchases are planned for the token’s original creator, one token per purchase.</p>
        </div>
      </div>
    </section>
  );
}
