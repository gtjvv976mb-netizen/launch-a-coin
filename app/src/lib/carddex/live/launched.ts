import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getCompletedLaunch, listCompletedLaunches } from "./launches.server";
import type { PublicLiveLaunch } from "./launches";

/**
 * The launched coins for a page's server render (Home, Discover): the same rows GET /api/live/launches serves, read
 * in-process. A failed read answers null, so the page still renders and its query asks the API again in the browser.
 */
export const getLaunchedCoins = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLiveLaunch[] | null> => {
    try {
      return await listCompletedLaunches();
    } catch (error) {
      console.error("Launched coins read failed", error);
      return null;
    }
  },
);

/** One launched coin by its mint, for its page (/coin/<mint>); null for anything else. */
export const getLaunchedCoin = createServerFn({ method: "GET" })
  .validator(z.object({ mint: z.string().max(64) }))
  .handler(({ data }): Promise<PublicLiveLaunch | null> => getCompletedLaunch(data.mint.trim()));
