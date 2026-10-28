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

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
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

  return router;
};
