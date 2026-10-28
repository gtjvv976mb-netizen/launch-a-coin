import { EDITION_CATALOG, type Edition, type EditionKey } from "./editions";
import { MEME_ICON_CATALOG, type MemeIcon, type MemeIconCategory, type MemeIconKey } from "./meme-icons";

/** One preview catalog; the underlying cosmetic identities and earned-tier system stay independent. */
export type LimitedTemplate =
  | (Edition & { kind: "edition"; category: "original-themes"; inspiration?: undefined })
  | (MemeIcon & { kind: "icon" });
export type LimitedTemplateKey = LimitedTemplate["key"];
export type LimitedTemplateCategory = MemeIconCategory | "original-themes";

export const LIMITED_TEMPLATE_CATEGORIES: readonly { key: LimitedTemplateCategory; label: string }[] = [
  { key: "memecoins", label: "Meme coins" },
  { key: "meme-stocks", label: "Meme stocks" },
  { key: "crypto-companies", label: "Crypto companies" },
  { key: "original-themes", label: "Original themes" },
];

export const LIMITED_TEMPLATE_CATALOG: readonly LimitedTemplate[] = [
  ...MEME_ICON_CATALOG.map((icon): LimitedTemplate => ({ ...icon, kind: "icon" })),
  ...EDITION_CATALOG.map((edition): LimitedTemplate => ({ ...edition, kind: "edition", category: "original-themes" })),
];

export function getLimitedTemplate(input: unknown): LimitedTemplate | null {
  return typeof input === "string" ? LIMITED_TEMPLATE_CATALOG.find((entry) => entry.key === input) ?? null : null;
}

/** Preserve valid old selection fields; a new Limited editions visit starts with Doge. */
export function limitedTemplateFromSearch(search?: { icon?: unknown; edition?: unknown } | null): LimitedTemplate {
  const icon = getLimitedTemplate(search?.icon);
  if (icon?.kind === "icon") return icon;
  const edition = getLimitedTemplate(search?.edition);
  return edition?.kind === "edition" ? edition : LIMITED_TEMPLATE_CATALOG[0];
}

export type LimitedTemplateSearch = { collection: "limited"; icon?: MemeIconKey; edition?: EditionKey };
export function limitedTemplateSearch(key: LimitedTemplateKey): LimitedTemplateSearch {
  const entry = getLimitedTemplate(key) ?? LIMITED_TEMPLATE_CATALOG[0];
  return entry.kind === "icon" ? { collection: "limited", icon: entry.key } : { collection: "limited", edition: entry.key };
}

/** Only cosmetic fields: never earned rarity, token identity, market data or purchase rights. */
export function limitedTemplateTheme(entry: LimitedTemplate): { edition: EditionKey } | { memeIcon: MemeIconKey } {
  return entry.kind === "edition" ? { edition: entry.key } : { memeIcon: entry.key };
}

/** Restore only an existing public token from an exact legacy or current viewer ID. */
export function limitedTemplateLinkedTokenId(viewerId: unknown, tokens: readonly { id: string }[]): string | null {
  if (typeof viewerId !== "string") return null;
  for (const token of tokens) {
    if (LIMITED_TEMPLATE_CATALOG.some((entry) => viewerId === `${entry.kind === "edition" ? "edition" : "creator-template"}-${token.id}-${entry.key}`)) return token.id;
  }
  return null;
}
