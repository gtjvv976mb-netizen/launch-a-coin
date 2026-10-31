"""Registry identities for the 20 new pairs (verified on mainnet at slot 463747004, 31 October 2026)."""
SLOT = 463747004
DATE = "2026-10-31"
QC = "https://solscan.io/account/6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP"
TABLE = "https://pump.fun/docs/custom-pairs"
XTERMS = "https://xstocks.fi/documents/xstocks-terms-of-service.pdf"
# key: (symbol, name, kind, extra, design name, description, palette)
PAIRS = {
 "ray": ("RAY", "Raydium", "crypto", {}, "Raydium Signature", "Raydium details in space-navy ceramic, iridescent violet-to-cyan titanium and faceted hexagonal crystal.", ["#141a4a", "#7B5CFF", "#4FD1E8"]),
 "met": ("MET", "Meteora", "crypto", {}, "Meteora Signature", "Meteora details in midnight lacquer, sunset-to-magenta enamel and polished rose gold.", ["#120c1c", "#F2652E", "#C93F9B"]),
 "bp": ("BP", "Backpack", "crypto", {"listingProvider": "Sunrise (Wormhole Labs)", "listingProviderTerms": "https://sunrise.xyz/terms-of-service"}, "Backpack Signature", "Backpack details in crimson enamel, white porcelain and polished silver stitching.", ["#B3161E", "#F4F1EC", "#C9CCD1"]),
 "w": ("W", "Wormhole Token", "crypto", {"direct": True}, "Wormhole Signature", "Wormhole details in lavender-violet enamel, pearl ceramic and spiralling polished silver.", ["#3F2B96", "#8C7FD8", "#EEEAF8"]),
 "psol": ("PSOL", "Phantom Staked SOL", "crypto", {"direct": True}, "Phantom Staked SOL Signature", "Phantom staked-SOL details in lavender porcelain, frosted lilac glass and polished silver.", ["#9E8FE0", "#1C1A24", "#EDE8FA"]),
 "hsol": ("hSOL", "Helius Staked SOL", "crypto", {}, "Helius Staked SOL Signature", "Helius staked-SOL details in black obsidian, ember-orange enamel and blackened copper.", ["#0D0C0C", "#F2541B", "#8A3A1A"]),
 "cbltc": ("cbLTC", "Coinbase Wrapped LTC", "crypto", {"direct": True}, "Coinbase Wrapped LTC Signature", "Litecoin details in brushed sterling silver, white porcelain and bright blue enamel.", ["#0052FF", "#C7CCD4", "#F6F7F9"]),
 "cbada": ("cbADA", "Coinbase Wrapped ADA", "crypto", {"direct": True}, "Coinbase Wrapped ADA Signature", "Cardano details in deep navy lacquer, royal-blue enamel and pale-gold dot constellations.", ["#0B1640", "#1F4FD8", "#D9C48A"]),
 "spyx": ("SPYX", "SP500 xStock", "stock", {"ticker": "SPY"}, "S&P 500 Signature", "SP500 xStock details in deep navy lacquer, ivory porcelain and polished-gold columns.", ["#0E1A3C", "#F2EBDA", "#C9A24A"]),
 "qqqx": ("QQQX", "Nasdaq xStock", "stock", {"ticker": "QQQ"}, "Nasdaq Signature", "Nasdaq xStock details in glacier ice-blue glass, snow-white enamel and polished silver.", ["#7FB6E6", "#F7FAFD", "#B9C6D3"]),
 "googlx": ("GOOGLX", "Alphabet xStock", "stock", {"ticker": "GOOGL"}, "Alphabet Signature", "Alphabet xStock details in white porcelain with four-colour enamel and polished silver.", ["#4285F4", "#F8F8F6", "#34A853"]),
 "msftx": ("MSFTX", "Microsoft xStock", "stock", {"ticker": "MSFT"}, "Microsoft Signature", "Microsoft xStock details in matte graphite, four-colour glass tiles and brushed aluminium.", ["#2B2D31", "#F25022", "#00A4EF"]),
 "metax": ("METAX", "Meta xStock", "stock", {"ticker": "META"}, "Meta Signature", "Meta xStock details in pearl ceramic, gradient blue glass and polished chrome.", ["#0866FF", "#F3F5F8", "#B8C2CC"]),
 "amznx": ("AMZNX", "Amazon xStock", "stock", {"ticker": "AMZN"}, "Amazon Signature", "Amazon xStock details in amber-orange enamel, black lacquer and polished brass.", ["#FF9900", "#16120E", "#B88A3E"]),
 "crclx": ("CRCLX", "Circle xStock", "stock", {"ticker": "CRCL"}, "Circle Signature", "Circle xStock details in jet-black ceramic, mint-to-violet enamel and brushed palladium.", ["#0B0B0D", "#5EE0B5", "#8C7BF2"]),
 "hoodx": ("HOODX", "Robinhood xStock", "stock", {"ticker": "HOOD"}, "Robinhood Signature", "Robinhood xStock details in chartreuse enamel, matte black lacquer and blackened steel.", ["#CCFF00", "#101310", "#4B5148"]),
 "gldx": ("GLDX", "Gold xStock", "stock", {"ticker": "GLD"}, "Gold Signature", "Gold xStock details in polished gold, ivory enamel and stamped bullion textures.", ["#C99A2E", "#F4ECD6", "#5A4320"]),
 "pltrx": ("PLTRX", "Palantir xStock", "stock", {"ticker": "PLTR"}, "Palantir Signature", "Palantir xStock details in matte black ceramic, brushed white steel and pale silver.", ["#111213", "#E8E9EA", "#9DA2A8"]),
 "mcdx": ("MCDX", "McDonald's xStock", "stock", {"ticker": "MCD"}, "McDonald's Signature", "McDonald's xStock details in golden-yellow enamel, red lacquer and polished gold.", ["#FFBC0D", "#DA291C", "#B8862B"]),
 "kox": ("KOX", "Coca-Cola xStock", "stock", {"ticker": "KO"}, "Coca-Cola Signature", "Coca-Cola xStock details in cherry-red enamel, white ribbon waves and polished chrome.", ["#E61A27", "#FFFFFF", "#C4C8CC"]),
}
