import { createFileRoute } from '@tanstack/react-router'

import { IS_CHAIN, IS_SIM } from '../lib/mintdex/mode'
import { STATIC_LASTMOD, STATIC_PATHS, absoluteUrl, canonicalCoinPath } from '../lib/mintdex/seo'

type Entry = { loc: string; lastmod: string }

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/**
 * Coin pages: every finished mainnet launch (/coin/<mint>), newest first, with lastmod = its launch day. A failed read
 * lists the static pages only.
 */
async function coinEntries(): Promise<Entry[]> {
  if (IS_SIM) {
    // Its own read, past the page lists' limit: every finished launch's mint and day, nothing else.
    const { all } = await import('../lib/mintdex/server/db.server')
    const rows = await all<{ token_mint: string; created_at: number }>(
      "SELECT token_mint, created_at FROM live_launch_intents WHERE status = 'complete' ORDER BY created_at DESC LIMIT 45000",
    ).catch(() => [])
    return rows
      .filter((r) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.token_mint))
      .map((r) => ({
        loc: absoluteUrl(`/coin/${r.token_mint}`),
        lastmod: new Date(r.created_at).toISOString().split('T')[0],
      }))
  }
  // Devnet: every coin with a MintDex card, from the chain API (never throws; whatever it read in time).
  if (IS_CHAIN) {
    const { chainSitemapCoins } = await import('../lib/chain/data')
    return (await chainSitemapCoins()).map((c) => ({
      loc: absoluteUrl(canonicalCoinPath({ id: c.mint, mintAddress: c.mint })),
      lastmod: new Date(c.lastTradeAt || Date.now()).toISOString().split('T')[0],
    }))
  }
  const { all } = await import('../lib/mintdex/server/db.server')
  const rows = await all<{ id: string; mint_address: string | null; last_trade_at: number }>(
    'SELECT id, mint_address, last_trade_at FROM coins WHERE hidden = 0 ORDER BY last_trade_at DESC LIMIT 45000',
  )
  return rows.map((r) => ({
    loc: absoluteUrl(canonicalCoinPath({ id: r.id, mintAddress: r.mint_address })),
    lastmod: new Date(r.last_trade_at).toISOString().split('T')[0],
  }))
}

// Every <loc> is on mintdex.fun (backlog P0-11). Static pages carry a fixed lastmod, not today's date, and no
// changefreq or priority (search engines ignore both).
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const entries: Entry[] = [
          ...STATIC_PATHS.map((p) => ({ loc: absoluteUrl(p), lastmod: STATIC_LASTMOD })),
          ...(await coinEntries()),
        ]
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...entries.map((e) =>
            ['  <url>', `    <loc>${xmlEscape(e.loc)}</loc>`, `    <lastmod>${e.lastmod}</lastmod>`, '  </url>'].join('\n'),
          ),
          '</urlset>',
          '',
        ].join('\n')
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
