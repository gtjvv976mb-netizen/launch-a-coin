/**
 * The page-level not-found and error states, one look everywhere (the root and the router's defaults): the empty
 * state's card back, one title, one sentence and two actions (a button and a "Go home" link). The title is also an h1
 * for screen readers and the route announcer, which lands focus on a page's h1 after a page change.
 */
import type { ReactNode } from "react";

import { PAGE_NOT_FOUND, ROUTE_ERROR } from "../../lib/mintdex/copy";
import { Button, ButtonLink, EmptyState, TextLink } from "./ui";

function StatusPage({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <EmptyState
        className="mdx-page"
        title={<span aria-hidden>{title}</span>}
        body={body}
        action={<div className="flex items-center gap-5">{action}</div>}
      />
    </>
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
