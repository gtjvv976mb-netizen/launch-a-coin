import { createFileRoute } from '@tanstack/react-router'

import { isMirrorHost } from '../lib/canonical-url'
import { SITE_ORIGIN } from '../lib/mintdex/seo'

// Crawlers always hear about mintdex.fun (backlog P0-11), even when this answers on the origin host behind the
// proxy: request.url is not the public origin.
export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Mirrors (SEO-4: workers.dev, the launchacard.com zone's own hosts, local dev): crawl nothing there, so
        // search only lists launchacard.fun.
        if (isMirrorHost(new URL(request.url).hostname)) {
          return new Response('User-agent: *\nDisallow: /\n', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
          })
        }
        const body = [
          'User-agent: *',
          'Allow: /',
          // Coin card art, so link previews of coin pages show it (longest match wins over Disallow: /api/).
          'Allow: /api/live/assets/',
          'Disallow: /api/',
          'Disallow: /_serverFn/',
          '',
          `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
          '',
        ].join('\n')
        return new Response(body, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        })
      },
    },
  },
})
