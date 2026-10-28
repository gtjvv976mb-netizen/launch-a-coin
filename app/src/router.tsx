import { QueryClient } from "@tanstack/react-query";
import { createRouter, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";

import { PageError, PageNotFound } from "./components/mintdex/PageStatus";
import { reportHiggsfieldError } from "./lib/higgsfield-error-reporting";
import { routeTree } from "./routeTree.gen";

/**
 * A page that failed to load, rendered in that page's place (backlog P0-10): the app shell, its nav and the
 * other tabs keep working. Only a failure in the root itself falls back to the root error screen.
 */
function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
    reportHiggsfieldError(error, { boundary: "tanstack_route_error_component" });
  }, [error]);
  return (
    <PageError
      onRetry={() => {
        void router.invalidate();
        reset();
      }}
    />
  );
}

const MAIN_SELECTOR = '[data-scroll-restoration-id="content"]';
const MAIN_SCROLLED_KEY = "cdx-main-scrolled-v1";

/**
 * <main> is the page scroller. TanStack's scrollToTopSelectors also resets that element after it has just
 * restored it, so Back would always land at the top. Return <main> for a reset only when the router saved no
 * position for it on this history entry: a new page starts at its top, Back and Forward return to where you were.
 * The router records a position for an element only after it scrolls during a visit, which is mirrored here.
 */
function mainScrollReset(router: { latestLocation: { href: string; state: { __TSR_key?: string } } }) {
  let saved = new Set<string>();
  try {
    saved = new Set(JSON.parse(sessionStorage.getItem(MAIN_SCROLLED_KEY) || "[]") as string[]);
  } catch {
    // Private mode or blocked storage: positions still restore within this page load.
  }
  let scrolled = false;
  document.addEventListener(
    "scroll",
    (event) => {
      if ((event.target as Element | null)?.matches?.(MAIN_SELECTOR)) scrolled = true;
    },
    true,
  );
  addEventListener("pagehide", () => {
    try {
      sessionStorage.setItem(MAIN_SCROLLED_KEY, JSON.stringify([...saved].slice(-200)));
    } catch {
      // Ignored: see above.
    }
  });
  const keyOf = (location: { href: string; state: { __TSR_key?: string } }) => location.state.__TSR_key || location.href;
  return {
    leave(from: { href: string; state: { __TSR_key?: string } } | undefined) {
      if (from && scrolled) saved.add(keyOf(from));
      scrolled = false;
    },
    rendered() {
      scrolled = false;
    },
    target: () => (saved.has(keyOf(router.latestLocation)) ? null : document.querySelector(MAIN_SELECTOR)),
  };
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  let mainReset: ReturnType<typeof mainScrollReset> | undefined;
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // <main> is the page scroller (the shell keeps the rail and tab bar in view): a new page starts at its top.
    // Back and Forward restore it (see mainScrollReset).
    scrollToTopSelectors: [() => mainReset?.target()],
    // Page changes feel instant (backlog P0-2, step 1): links start loading on hover or touch, and a load
    // that just happened is reused for 10 s instead of being fetched again on click.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 10_000,
    defaultErrorComponent: RouteError,
    // A route that answered notFound() without its own not-found view.
    defaultNotFoundComponent: PageNotFound,
    // People type tickers with their "$" (/coin/$HONK). The router would read "$HONK" as a param placeholder
    // and redirect to /coin/undefined, so drop the "$" first; the coin loader then 301s HONK to /coin/honk.
    rewrite: {
      input: ({ url }) => {
        if (!/^\/coin\/(?:\$|%24)/i.test(url.pathname)) return undefined;
        url.pathname = url.pathname.replace(/^\/coin\/(?:\$|%24)+/i, "/coin/");
        return url;
      },
    },
  });

  if (typeof document !== "undefined") {
    mainReset = mainScrollReset(router);
    router.subscribe("onBeforeLoad", (event) => mainReset?.leave(event.fromLocation));
    router.subscribe("onRendered", () => mainReset?.rendered());
  }

  return router;
};
