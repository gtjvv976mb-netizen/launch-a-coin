import { createFileRoute } from '@tanstack/react-router'

import { IS_CHAIN, IS_SIM } from '../lib/mintdex/mode'
import { STATIC_LASTMOD, STATIC_PATHS, absoluteUrl, canonicalCoinPath } from '../lib/mintdex/seo'

type Entry = { loc: string; lastmod: string }

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/**
 * Coin pages, newest activity first, with lastmod = the last trade. Written now, emitted only once coins are
 * real (MODE is not 'sim'): simulated coins and their market caps stay out of search (decision C4, P2-4).
 */
async function coinEntries(): Promise<Entry[]> {
  if (IS_SIM) return []
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
