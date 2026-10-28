# launchacard.fun on Cloudflare for SaaS: cutover runbook

PLDT (Philippines) blocks the two Cloudflare anycast IPs assigned to zone launchacard.fun. To get around this, launchacard.fun and www become custom hostnames on zone launchacard.com, which has different IPs. Requests still arrive with Host launchacard.fun. These stay the same: the app, `CARDDEX_PUBLIC_ORIGIN` (`https://launchacard.fun`), wallet origin checks and token metadata URLs.

## Current state (dashboard, account 985281cb00d5f7379896b62a03e0edb7)

- **Zone launchacard.com.** Cloudflare for SaaS is enabled. The fallback origin is `edge.launchacard.com` (proxied A record to `192.0.2.1`). A Workers route `*/*` points to `launch-a-card` and was added in the dashboard. `edge.launchacard.com` serves the app (verified).
- **launchacard.com apex.** It has no DNS record, so it does not resolve. It could later redirect to `https://launchacard.fun`, using a proxied placeholder record and a Redirect Rule.
- **Zone launchacard.fun.** Today launchacard.fun and www are Worker Custom Domains of `launch-a-card`, using Cloudflare-managed DNS records. The email DNS records stay as they are.
- **Custom hostnames on launchacard.com.** None have been added yet.

## What the code on `claude/saas-edge` changes

- **Self-fetch through SELF.** A Worker running on a route cannot `fetch()` a URL on its own zone, because of the same-zone fetch limitation. Custom Domains are exempt from it, routes are not. When the Worker checks during launch that the public URL serves the exact bytes, it now uses the `SELF` service binding, which is the Worker bound to itself. All the existing checks stay: exact origin, no redirects, status, size and exact byte hash. Local config has no `SELF` and uses the global fetch.
- **Mirror hosts.** Every host other than launchacard.fun, www.launchacard.fun and local hosts is treated as a mirror. That includes `edge.launchacard.com`, `launchacard.com` and workers.dev. Mirrors still answer normally and are not redirected. They send `X-Robots-Tag: noindex`, and their robots.txt disallows everything. The www-to-apex and http-to-https redirects are unchanged.

## Phase 1 config (now in `app/wrangler.production.jsonc`)

```jsonc
  "routes": [
    {"pattern": "launchacard.fun", "custom_domain": true}, {"pattern": "www.launchacard.fun", "custom_domain": true},
    {"pattern": "*/*", "zone_name": "launchacard.com"}
  ],
  "services": [{"binding": "SELF", "service": "launch-a-card"}],
```

The `*/*` route is the same one already set in the dashboard. A deploy keeps it on this Worker. On deploy, Wrangler 4.147.0 replaces the Worker's whole list of routes (a `PUT` of the list), so a deploy from a config without `*/*` removes the dashboard route. From now on, deploy only from this config.

## Cutover, in order

1. **Add the custom hostnames.** In zone launchacard.com, go to SSL/TLS > Custom Hostnames. Add `launchacard.fun` and `www.launchacard.fun`, choosing TXT pre-validation for ownership and TXT validation for the certificate. In zone launchacard.fun, add the TXT records each hostname shows. Do not change the A, AAAA or CNAME records yet.
2. **Wait for Active.** Both hostnames must show Hostname status Active and Certificate status Active.
3. **Deploy Phase 1.** This is a production deploy and needs the owner's go-ahead. Run `cd app && bun run build && bunx wrangler@4.147.0 deploy -c wrangler.production.jsonc`. Then check that https://launchacard.fun/api/live/health still returns `"ok": true`.
4. **Switch DNS.** In zone launchacard.fun, open Workers & Pages > launch-a-card > Settings > Domains & Routes. Remove the Custom Domains `launchacard.fun` and `www.launchacard.fun`, which also deletes their DNS records. Then immediately add these DNS records:
   - `CNAME @ -> edge.launchacard.com`, DNS only, TTL Auto
   - `CNAME www -> edge.launchacard.com`, DNS only, TTL Auto

   Do the removal and the additions back to back, because the site is down in between. Cloudflare flattens the apex CNAME, so the MX and TXT records can stay.
5. **Verify** from a PLDT connection and from outside the Philippines:
   - `dig +short launchacard.fun` and `dig +short www.launchacard.fun` no longer return the two blocked IPs.
   - `curl -sI https://launchacard.fun/` returns 200 with no `X-Robots-Tag`.
   - `curl -sI https://www.launchacard.fun/launch` returns 308 to `https://launchacard.fun/launch`.
   - Read-only health check: `curl -s https://launchacard.fun/api/live/health` shows `"ok": true` and `"publicOrigin": "https://launchacard.fun"`.
   - Asset fetch: `curl -sI` on the metadata URL (`/m/<digest>`) or the image URL (`/api/live/assets/<sha>.png`) of a launched coin returns 200 with the expected content type. A static file under `/assets/` also returns 200.
   - `curl -s https://launchacard.fun/robots.txt` shows `Allow: /` and the Sitemap line.
   - `curl -s https://edge.launchacard.com/robots.txt` shows `Disallow: /`.
6. **Commit Phase 2** right away, before any later deploy.

## Phase 2 config (commit right after cutover, before any later deploy)

Replace the `routes` block in `app/wrangler.production.jsonc`, and its Phase 1 comment, with:

```jsonc
  "routes": [{"pattern": "*/*", "zone_name": "launchacard.com"}],
```

Keep the `SELF` service binding and `CARDDEX_PUBLIC_ORIGIN` unchanged. If you deploy the Phase 1 config after cutover, it re-attaches the Custom Domains on zone launchacard.fun. In an interactive terminal, Wrangler asks about the conflicting DNS records. Run without a terminal (for example from CI or a script), it overrides them: the CNAMEs are replaced and the site goes back to the blocked IPs.

## Rollback

1. In zone launchacard.fun DNS, delete the CNAME records `@` and `www`.
2. In Workers & Pages > launch-a-card > Settings > Domains & Routes, add the Custom Domains `launchacard.fun` and `www.launchacard.fun` again.
3. If Phase 2 was already committed, revert that commit before any deploy. The Phase 1 config lists both Custom Domains and stays valid.

The custom hostnames, the `*/*` route and the `SELF` binding can stay in place, because they receive no launchacard.fun traffic without the CNAMEs. After a rollback, PLDT users are blocked again.
