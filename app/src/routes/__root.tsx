import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportHiggsfieldError } from "../lib/higgsfield-error-reporting";
import { getMe } from "../lib/mintdex/api";
// Page metadata (browser <title>/favicon + social og: tags) committed into the
// repo by the marketplace meta API and read at BUILD time — no runtime fetch.
import appMetaJson from "../app-meta.json";
import { AppShell } from "../components/mintdex/AppShell";
import { liveReadinessQuery } from "../components/carddex/live/readiness";
import { SessionProvider } from "../components/mintdex/session";
import { WalletMount } from "../components/chain/WalletMount";
import { IS_SIM, MODE } from "../lib/mintdex/mode";
import { manifestFileName } from "../lib/mintdex/manifest";
import { isDevnetTestSite } from "../lib/mintdex/site-host";
import { PageNotFound } from "../components/mintdex/PageStatus";
import { Button, ToastProvider } from "../components/mintdex/ui";
import { markHydrated, View3DProvider } from "../components/mintdex/card3d";
import { ROUTE_ERROR } from "../lib/mintdex/copy";
import { SITE_DESCRIPTION, SITE_OG_IMAGE, SITE_OG_IMAGE_ALT, absoluteUrl } from "../lib/mintdex/seo";
import { readViewport } from "../lib/mintdex/viewport";

declare const __HF_DESIGN_INSPECTOR__: boolean;

const DEFAULT_TITLE = "Launch a Card";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;

// app-meta.json may carry an absolute higgsfield-app URL with a stale host;
// strip it down to a root-relative path so it resolves against this deploy.
const APP_HOST_ZONES = ["higgsfield.app", "higgsfield-dev.app"];

function toOwnAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const u = new URL(value);
    const isAppHost = APP_HOST_ZONES.some(
      (zone) => u.hostname === zone || u.hostname.endsWith(`.${zone}`),
    );
    if (isAppHost) return u.pathname + u.search;
    return value;
  } catch {
    return value;
  }
}

/**
 * `devnetSite`: the devnet test site (site-host.ts) gets robots noindex, so search engines keep mintdex.fun. Its
 * canonical links follow SITE_ORIGIN (seo.ts): mintdex.fun while both hosts serve the same devnet site, then
 * devnet.mintdex.fun once MAINNET_SITE_LIVE is set.
 */
function buildHead(meta: AppMeta, devnetSite = false, notFound = false) {
  // An unknown path (the root's not-found page, HTTP 404): its own title and description, and noindex (A11Y-11, F15).
  const title = notFound ? "Page not found | Launch a Card" : (meta.og_title ?? DEFAULT_TITLE);
  // Always our own description, never app-meta.json's og_description: the marketplace meta API writes that
  // file with claims test mode cannot make ("every pump.fun coin"), and ours carries the mode suffix (P0-5).
  const description = notFound
    ? "This page is not on Launch a Card. Browse tokens and their cards on Discover, or go back home."
    : SITE_DESCRIPTION;
  // The site's own share image (Home's hero, 1200x630) unless app-meta.json names one (SEO-1).
  const ownImage = toOwnAssetUrl(meta.og_image_url);
  const ogImage = ownImage ?? absoluteUrl(SITE_OG_IMAGE);
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      // resizes-content (P1-1): on Android the page shrinks above the on-screen keyboard, so a sheet's button or
      // the trade ticket's Buy stays visible; iOS ignores it and vaul and useKeyboardSafe lift what matters.
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title },
      { name: "description", content: description },
      { name: "theme-color", content: "#29231d" },
      { name: "application-name", content: "Launch a Card" },
      // Which build this is (launch-plan D4 and E checks: curl the HTML and read it). sim, devnet or mainnet.
      { name: "carddex-mode", content: MODE },
      ...(devnetSite || notFound ? [{ name: "robots", content: "noindex" }] : []),
      { property: "og:site_name", content: "Launch a Card" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
            ...(ownImage ? [] : [{ property: "og:image:alt", content: SITE_OG_IMAGE_ALT }, { name: "twitter:image:alt", content: SITE_OG_IMAGE_ALT }]),
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // No font preload (F17): Instrument Sans is not used early enough for one to pay off, and Chrome warned on
      // every route that the preloaded file went unused. Its @font-face (font-display: swap) loads it on use.
      // The same wordless gold card-and-crown mark serves browser, mobile and installed-app branding.
      { rel: "icon", href: "/assets/brand/carddex.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/assets/brand/carddex-180.png" },
      // One manifest per mode under its own name (lib/mintdex/manifest.ts; vite.config.ts emits it).
      { rel: "manifest", href: `/${manifestFileName(MODE)}` },
    ],
  };
}

/**
 * The root's own failure screen (the app shell may be what failed, so plain markup): the same words and actions as
 * the in-shell error page (PageStatus.tsx), and a plain link home that does not need the router.
 */
function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportHiggsfieldError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="grid h-full min-h-[60dvh] place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <h1 className="mdx-h1">{ROUTE_ERROR.title}</h1>
        <p className="text-[15px] text-slate">{ROUTE_ERROR.body}</p>
        <div className="mt-4 flex items-center gap-5">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            {ROUTE_ERROR.retry}
          </Button>
          <a href="/" className="mdx-link mdx-hit">
            {ROUTE_ERROR.home}
          </a>
        </div>
      </div>
    </div>
  );
}

async function loadRootData({location,context}:{location:{pathname:string;searchStr:string};context:{queryClient:QueryClient}}):Promise<{me:Awaited<ReturnType<typeof getMe>>|null;now:number;vp:ReturnType<typeof readViewport>;devnetSite:boolean}> {
  // Test mode is the default on /launch, so the demo session loads there too. Only a mainnet launch that can
  // really open (mode=live and readiness.ready, from the same cached query the page uses) leaves it out.
  const liveLaunch = location.pathname === "/launch" && new URLSearchParams(location.searchStr).get("mode") === "live" &&
    (await context.queryClient.ensureQueryData(liveReadinessQuery).catch(() => null))?.ready === true;
  return {
    me: IS_SIM && !liveLaunch ? await getMe() : null,
    now: Date.now(), vp: readViewport(), devnetSite: isDevnetTestSite(),
  };
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ loaderData, match }) => buildHead(appMeta, loaderData?.devnetSite ?? false, !!match.globalNotFound),
  // `now` is the page's clock for its first frame (see useNow in hooks.ts): it is dehydrated with the
  // loader data, so server HTML and the hydrating client compute the same relative times. `vp` is the
  // viewport cookie (P1-20), so fitted grids lay out their server HTML for this screen.
  // Devnet: the wallet is the identity (client only), so there is no session to read on the server.
  // `devnetSite`: this devnet build is answering as the devnet test site (lib/mintdex/site-host.ts); always false in the
  // sim and mainnet builds.
  loader: loadRootData,
  staleTime: 10_000,
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: PageNotFound,
  errorComponent: ErrorComponent,
});

/**
 * Motion level before first paint. A stored Calm motion choice (mdx-motion-v2) wins in either direction: "calm"
 * puts html[data-motion="calm"] in place, "full" keeps full motion and marks html[data-motion-pref="full"] so the
 * CSS reduced-motion fallback stands down. With no stored choice, the device's reduced motion setting starts the
 * page calm. Legacy keys (mdx-motion, mdx-motion-lite) are ignored. The only server and client difference on the
 * page, so <html> carries suppressHydrationWarning. The CSP allows inline scripts.
 */
const MOTION_SCRIPT =
  'var d=document.documentElement,v=null;try{v=localStorage.getItem("mdx-motion-v2")}catch(e){}try{if(v==="full")d.dataset.motionPref="full";if(v==="calm"||(v!=="full"&&matchMedia("(prefers-reduced-motion: reduce)").matches))d.dataset.motion="calm"}catch(e){}';

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="bg-wall text-ink">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const devnetSite = Route.useLoaderData({ select: (d) => d.devnetSite });

  // Hydration is done: cards that mount from now on came with a client navigation and may play their entrance
  // (Deal, Unbox); server-painted cards never fly in again. The page's own route is code-split and may hydrate
  // after this root effect, so the mark waits for the router's first render report (or 1.2 s at the latest).
  const router = useRouter();
  useEffect(() => {
    let done = false;
    const mark = () => {
      if (done) return;
      done = true;
      markHydrated();
    };
    const unsub = router.subscribe("onRendered", () => setTimeout(mark, 0));
    const t = setTimeout(mark, 1200);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [router]);

  useEffect(() => {
    if (!__HF_DESIGN_INSPECTOR__) {
      return;
    }

    void import("../module/design-inspector/runtime")
      .then(({ installHiggsfieldDesignInspector }) => {
        installHiggsfieldDesignInspector();
      })
      .catch((error) => {
        reportHiggsfieldError(
          error instanceof Error ? error : new Error("Failed to load design inspector"),
          {
            boundary: "higgsfield_design_inspector_import",
          },
        );
      });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>
          {/* "View in 3D": one turntable viewer for every card on the site (card3d/view3d.tsx, lazy stage). */}
          <View3DProvider>
            <AppShell devnetSite={devnetSite}>
              {/* Required: nested routes render here. */}
              <Outlet />
            </AppShell>
          </View3DProvider>
          {/* Devnet: the Wallet Standard host, lazy after hydration (no wallet code in sim builds). */}
          {IS_SIM ? null : <WalletMount />}
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
