/**
 * The page-level not-found and error states, one look everywhere (the root and the router's defaults): one compact
 * block (styles/screens/overlays.css .cdx-status) centred in the page: the card back on its ledge (no halo), the
 * title, one sentence that says what to do, then one button and a "Go home" link. The title is the page's one h1,
 * where the route announcer lands focus after a page change. The server's own 500 page (lib/error-page.ts) draws the
 * same words in the same colours without the app.
 */
import { lazy, Suspense, useId, type ReactNode } from "react";

import { PAGE_NOT_FOUND, ROUTE_ERROR } from "../../lib/mintdex/copy";
import { Button, ButtonLink, Ledge, Pocket, TextLink } from "./ui";

// The root and the router use these pages, so the card back (the card engine) loads only when one shows. The slot
// holds the card's shape until it lands, so nothing moves when it does.
const CardBack = lazy(() => import("./card3d/CardBack").then((m) => ({ default: m.CardBack })));

function StatusPage({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  const id = useId();
  return (
    <section className="mdx-page cdx-status" aria-labelledby={id}>
      <div className="cdx-status__block">
        <div className="cdx-status__art" aria-hidden>
          <Pocket className="cdx-status__card [--pocket:6px]">
            <Suspense fallback={<div className="cdx-status__slot" />}>
              <CardBack depth="hand" />
            </Suspense>
          </Pocket>
          <Ledge className="cdx-status__ledge" />
        </div>
        <div className="cdx-status__text">
          <h1 id={id} className="cdx-status__title">
            {title}
          </h1>
          <p className="cdx-status__body">{body}</p>
          <div className="cdx-status__actions">{action}</div>
        </div>
      </div>
    </section>
  );
}

/** An unknown page: Explore coins, or Go home. */
export function PageNotFound() {
  return (
    <StatusPage
      title={PAGE_NOT_FOUND.title}
      body={PAGE_NOT_FOUND.body}
      action={
        <>
          <ButtonLink to="/discover">{PAGE_NOT_FOUND.action}</ButtonLink>
          <TextLink to="/">{PAGE_NOT_FOUND.home}</TextLink>
        </>
      }
    />
  );
}

/** A page that failed to load, inside the app shell: Try again, or Go home. */
export function PageError({ onRetry }: { onRetry: () => void }) {
  return (
    <StatusPage
      title={ROUTE_ERROR.title}
      body={ROUTE_ERROR.body}
      action={
        <>
          <Button onClick={onRetry}>{ROUTE_ERROR.retry}</Button>
          <TextLink to="/">{ROUTE_ERROR.home}</TextLink>
        </>
      }
    />
  );
}
