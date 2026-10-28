import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";

import { chainCoinList } from "../../lib/chain/data";
import { listCoins } from "../../lib/mintdex/api";
import { LIMITED_TEMPLATE_CATALOG, LIMITED_TEMPLATE_CATEGORIES as CATEGORIES, getLimitedTemplate, limitedTemplateLinkedTokenId, limitedTemplateTheme, type LimitedTemplateKey } from "../../lib/mintdex/limited-templates";
import { IS_SIM } from "../../lib/mintdex/mode";
import type { CoinSummary } from "../../lib/mintdex/types";
import { MemeIconCard, MemeThemePortrait } from "./MemeIconCard";
import { EditionCard } from "./EditionCard";
import { editionMaterialStyle } from "./card3d/edition-material";
import "../../limited-editions-studio.css";
import { faceSlot, type CardData } from "./MintCard";
import { Card3D, View3DHost, useMotionLevel, type Card3DHandle } from "./card3d";
import { memeIconMaterialStyle } from "./card3d/meme-icon-material";
import { LimitedEditionOwnership } from "./LimitedEditionOwnership";

const CARD_SIZES = "(max-width: 640px) 240px, (max-width: 1100px) 260px, 300px";
const PURCHASE_NOTICE = "Preview only. Purchases are paused until funding, pricing, edition limits and NFT minting are ready.";

/** Reusable frame previews. Selecting a template never purchases or applies an entitlement. */
export function LimitedEditionsStudio({
  initialCoin,
  initialView3d,
  selectedKey,
  onSelectTemplate,
}: {
  initialCoin: CoinSummary | null;
  initialView3d?: string;
  selectedKey: LimitedTemplateKey;
  onSelectTemplate: (key: LimitedTemplateKey) => void;
}) {
  const coins = useQuery({
    queryKey: ["edition-preview-coins"],
    queryFn: IS_SIM ? () => listCoins({ data: {} }) : () => chainCoinList(),
    initialData: initialCoin ? [initialCoin] : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    retry: 1,
  });
  const [tokenId, setTokenId] = useState(() => limitedTemplateLinkedTokenId(initialView3d, initialCoin ? [initialCoin] : []) ?? "custom");
  // Initial links may need the public list. A later viewer step must never reset a creator's draft.
  const pendingLinkedViewer = useRef(initialView3d ?? null);
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
    pendingLinkedViewer.current = null;
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
    pendingLinkedViewer.current = null;
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
  useEffect(() => {
    if (!pendingLinkedViewer.current) return;
    const timer = window.setTimeout(() => { pendingLinkedViewer.current = null; }, 8_000);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (pendingLinkedViewer.current !== initialView3d) pendingLinkedViewer.current = null;
  }, [initialView3d]);
  useEffect(() => {
    const linkedToken = limitedTemplateLinkedTokenId(pendingLinkedViewer.current, available);
    if (!linkedToken) return;
    pendingLinkedViewer.current = null;
    setTokenId(linkedToken);
  }, [available]);
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
  const template = getLimitedTemplate(selectedKey) ?? LIMITED_TEMPLATE_CATALOG[0];
  const motion = useMotionLevel();
  const [paused, setPaused] = useState(false);
  const cardRef = useRef<Card3DHandle | null>(null);
  const visibleTemplates = useMemo(() => LIMITED_TEMPLATE_CATALOG.filter((entry) => entry.category === template.category), [template.category]);
  const items = useMemo(
    () => LIMITED_TEMPLATE_CATALOG.map((entry) => ({
      id: `${entry.kind === "edition" ? "edition" : "creator-template"}-${token?.id ?? "preview"}-${entry.key}`,
      card: { ...base, ...limitedTemplateTheme(entry) },
      coinId: token?.id ?? null,
    })),
    [token, base],
  );
  const selectedItem = items[LIMITED_TEMPLATE_CATALOG.findIndex((entry) => entry.key === template.key)] ?? items[0];
  const faces = useMemo(
    () => items.map((item) => faceSlot(item.card, { key: item.id, sizes: CARD_SIZES, priority: item.id === selectedItem.id })),
    [items, selectedItem.id],
  );

  return (
    <section
      className="mdx-meme-studio mdx-limited-studio"
      data-testid="limited-editions-studio"
      data-template={template.key}
      data-category={template.category}
      style={{ "--meme-accent": template.key === "ronin" ? "#ef9f87" : template.palette[1] } as CSSProperties}
      aria-labelledby="limited-editions-title"
    >
      <header className="mdx-meme-studio__header">
        <h1 id="limited-editions-title">Limited editions</h1>
        <p>Explore twenty designs for your token. A purchase will pair permanent styling with a separate collectible NFT.</p>
      </header>

      <div className="mdx-meme-studio__token-preview">
        <label htmlFor="limited-token-preview">Token preview</label>
        <select
          id="limited-token-preview"
          data-testid="limited-token-preview-select"
          value={isCustom ? "custom" : token?.id ?? "custom"}
          onChange={(event) => { pendingLinkedViewer.current = null; setTokenId(event.target.value); }}
          aria-describedby="limited-token-status"
        >
          <option value="custom">Custom token preview</option>
          {available.map((coin) => <option key={coin.id} value={coin.id}>{coin.name} (${coin.ticker})</option>)}
        </select>
        <span className="mdx-meme-studio__preview-label">Preview on your token</span>
        <div id="limited-token-status" className="mdx-meme-studio__token-status">
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
            <div><label htmlFor="limited-token-name">Token name</label><input id="limited-token-name" value={customName} maxLength={32} onChange={(event) => { pendingLinkedViewer.current = null; setCustomName(event.target.value); }} /></div>
            <div><label htmlFor="limited-token-ticker">Token ticker</label><input id="limited-token-ticker" value={customTicker} maxLength={10} onChange={(event) => { pendingLinkedViewer.current = null; setCustomTicker(event.target.value.replace(/^\$/, "").toUpperCase()); }} /></div>
            <div className="mdx-meme-studio__art-field">
              <label htmlFor="limited-token-art">Token artwork</label>
              <input ref={fileInput} id="limited-token-art" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onClick={() => { pendingLinkedViewer.current = null; }} onChange={(event) => void chooseArtwork(event)} aria-describedby="limited-art-help limited-art-status" aria-invalid={!!artError} />
              <p id="limited-art-help">Up to 5 MB. Stays in this browser; nothing is uploaded.</p>
              <div id="limited-art-status">{artError ? <p role="alert">{artError}</p> : artLoading ? <p role="status">Reading your artwork…</p> : null}</div>
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
            data-testid={`limited-category-${category.key}`}
            aria-pressed={category.key === template.category}
            onClick={() => {
              if (category.key === template.category) return;
              const first = LIMITED_TEMPLATE_CATALOG.find((entry) => entry.category === category.key);
              if (first) onSelectTemplate(first.key);
            }}
          >{category.label}<span className="mdx-limited-studio__count" aria-hidden>{LIMITED_TEMPLATE_CATALOG.filter((entry) => entry.category === category.key).length}</span></button>
        ))}
      </div>

      <div
        className="mdx-meme-studio__selector"
        role="group"
        aria-label="Choose a limited edition to preview"
        style={{ "--meme-count": visibleTemplates.length } as CSSProperties}
      >
        {visibleTemplates.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="mdx-meme-studio__option"
            data-testid={`limited-template-option-${entry.key}`}
            aria-pressed={entry.key === template.key}
            aria-label={`Preview ${entry.inspiration ? `${entry.inspiration}-inspired ${entry.name}` : entry.name} on ${base.name}`}
            onClick={() => onSelectTemplate(entry.key)}
            style={{ "--meme-option-accent": entry.key === "ronin" ? "#ef9f87" : entry.palette[1] } as CSSProperties}
          >
            <span className={`mdx-meme-studio__mini ${entry.category === "memecoins" ? "mdx-meme-studio__mini--portrait" : ""}`} aria-hidden>
              {entry.kind === "edition" ? <EditionCard edition={entry} card={base} compact sizes="64px" /> : entry.category === "memecoins" ? <MemeThemePortrait icon={entry} /> : <MemeIconCard icon={entry} card={base} compact sizes="64px" />}
            </span>
            <span className="mdx-meme-studio__option-text">
              <span className="mdx-meme-studio__token">{entry.inspiration ?? entry.name}</span>
              <span className="mdx-meme-studio__ticker">{entry.kind === "edition" ? entry.finish.split(" · ")[0] : entry.name}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mdx-meme-studio__workbench">
        <div className="mdx-meme-studio__stage">
          <div className="mdx-meme-studio__canvas" data-testid="limited-template-preview">
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
                style={template.kind === "edition" ? editionMaterialStyle(template.key) : memeIconMaterialStyle(template.key)}
                backTheme={limitedTemplateTheme(template)}
                label={`${base.name}, ${template.name} limited edition preview. Drag to turn; press F to flip.`}
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
          <h2>{template.name}</h2>
          {template.inspiration ? <p className="mdx-meme-studio__theme">{template.inspiration}-inspired template</p> : null}
          <p className="mdx-meme-studio__tagline">{template.tagline}</p>
          <p className="mdx-meme-studio__description">{template.description}</p>

          <dl className="mdx-meme-studio__facts">
            <div className="mdx-meme-studio__finish"><dt>Design finish</dt><dd>{template.finish}</dd></div>
            <div><dt>Price</dt><dd>To be announced</dd></div>
            <div><dt>Release size</dt><dd>To be announced</dd></div>
          </dl>
          <LimitedEditionOwnership
            templateName={template.name}
            tokenName={base.name}
            tokenTicker={base.ticker}
            tokenMint={token?.mintAddress ?? null}
            isCustomPreview={isCustom}
          />
          <button
            className="mdx-meme-studio__purchase"
            type="button"
            data-testid="limited-template-purchase"
            disabled
            aria-describedby="limited-template-purchase-status"
          >Purchases paused</button>
          <p className="mdx-meme-studio__purchase-status" id="limited-template-purchase-status">{PURCHASE_NOTICE}</p>
          <p className="mdx-meme-studio__concept-note">Your original earned card keeps its market-cap progression and fee rights. The limited collectible adds no fee rights. Tribute-inspired designs imply no affiliation.</p>
        </div>
      </div>
    </section>
  );
}
