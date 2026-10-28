// The devnet coin route's 404 (routes/coin/$id.tsx notFoundComponent), inside the app shell like every not-found.
// The loader says why (lib/chain/data.ts ChainCoinNotFound): no coin goes by the ticker or name (or a mint has no
// card), several do (listed as links to their mint pages), or the chain API did not answer the lookup during SSR,
// in which case the browser asks once more and moves to /coin/{mint} when exactly one coin goes by it.
// Owner: app:pages.

import { getRouteApi, type NotFoundRouteProps } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { findCoinSlug, type ChainCoinNotFound as Why } from "../../../lib/chain/data";
import { COIN_NOT_FOUND } from "../../../lib/mintdex/copy";
import { looksLikeAddress } from "../../../lib/mintdex/seo";
import { Button, ButtonLink, EmptyState, TextLink } from "../../mintdex/ui";
import { NET_NAME, NET_SHORT } from "../../../lib/chain/env";

const routeApi = /* @__PURE__ */ getRouteApi("/coin/$id");

/** More than this many matches: the first ones, then Explore coins. */
const MAX_LISTED = 12;

function asWhy(data: unknown): Why | null {
  const kind = (data as { kind?: unknown } | null | undefined)?.kind;
  if (kind === "none" || kind === "unavailable") return { kind };
  if (kind === "several" && Array.isArray((data as { matches?: unknown }).matches))
    return data as Why;
  return null;
}

/** Match the shared not-found page: one primary heading, with unchanged visible empty-state typography. */
function CoinLookupState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <EmptyState className="mdx-page" title={<span aria-hidden>{title}</span>} body={body} action={action} />
    </>
  );
}

export function ChainCoinNotFound({ data }: NotFoundRouteProps) {
  const { id } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [why, setWhy] = useState<Why | null>(() => asWhy(data));
  // The server renders "Looking up" for an unanswered lookup, so the page does not flash an error before the retry.
  const unavailableOnLoad = asWhy(data)?.kind === "unavailable";
  const [looking, setLooking] = useState(unavailableOnLoad);

  const lookUp = useCallback(async () => {
    setLooking(true);
    const found = await findCoinSlug(id);
    if (found.kind === "one") {
      void navigate({ to: "/coin/$id", params: { id: found.mint }, search, replace: true });
      return;
    }
    setWhy(found);
    setLooking(false);
  }, [id, navigate, search]);

  // The server could not ask the chain API in time: ask once from the browser (20 s budget instead of 1.5 s). A
  // retry after that is the reader's Try again.
  useEffect(() => {
    if (unavailableOnLoad) void lookUp();
  }, [unavailableOnLoad, lookUp]);

  const browse = <ButtonLink to="/discover">{COIN_NOT_FOUND.action}</ButtonLink>;

  if (why?.kind === "unavailable") {
    return (
      <CoinLookupState
        title={looking ? "Looking up this card" : `${NET_SHORT} did not answer`}
        body={
          looking
            ? `Reading ${NET_NAME}...`
            : `This card could not be looked up on ${NET_NAME} right now. Try again in a moment.`
        }
        action={
          looking ? undefined : (
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => void lookUp()}>Try again</Button>
              <TextLink to="/discover">{COIN_NOT_FOUND.action}</TextLink>
            </div>
          )
        }
      />
    );
  }

  if (why?.kind === "several") {
    const listed = why.matches.slice(0, MAX_LISTED);
    return (
      <CoinLookupState
        title={COIN_NOT_FOUND.several}
        body={COIN_NOT_FOUND.severalBody}
        action={
          <div className="flex flex-col items-center gap-4">
            <ul className="flex flex-col items-center gap-1.5 text-[14px] leading-[1.45]">
              {listed.map((m) => (
                <li key={m.mint}>
                  <TextLink to="/coin/$id" params={{ id: m.mint }}>
                    {`${m.name} ($${m.symbol})`}
                  </TextLink>
                </li>
              ))}
            </ul>
            {browse}
          </div>
        }
      />
    );
  }

  return (
    <CoinLookupState
      title={COIN_NOT_FOUND.title}
      body={
        why?.kind === "none" || !looksLikeAddress(id)
          ? COIN_NOT_FOUND.unknown
          : COIN_NOT_FOUND.address
      }
      action={browse}
    />
  );
}
