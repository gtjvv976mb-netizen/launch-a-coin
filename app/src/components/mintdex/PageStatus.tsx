/**
 * The page-level not-found and error states, one look everywhere (the root and the router's defaults; MintDex's
 * format): the empty state's card back in its tray on the ledge, centred in the page, then one title, one sentence
 * and two actions (a button and a "Go home" link). The title is also the page's h1 for screen readers and the route
 * announcer, which lands focus on a page's h1 after a page change. Styles: styles/screens/legal.css (.cdx-notfound).
 * The server's own 500 page (lib/error-page.ts) draws the same words in the same colours without the app.
 */
import { lazy, Suspense, type ReactNode } from "react";

import { PAGE_NOT_FOUND, ROUTE_ERROR } from "../../lib/mintdex/copy";
import { Button, ButtonLink, TextLink } from "./ui";

// The root and the router use these pages, so the card back behind them (the card engine) loads only when one shows.
// Server HTML hydrates once the chunk is in; a client-side miss shows the h1 until then.
const EmptyState = lazy(() => import("./empty-state").then((m) => ({ default: m.EmptyState })));

function StatusPage({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="mdx-page cdx-notfound">
      <h1 className="sr-only">{title}</h1>
      <Suspense fallback={null}>
        <EmptyState
          title={<span aria-hidden>{title}</span>}
          body={body}
          action={<div className="cdx-notfound__actions">{action}</div>}
        />
      </Suspense>
    </div>
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
