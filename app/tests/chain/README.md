# CardDex checks

Run `bun test tests/chain tests/carddex` for active CardDex checks. The suite includes exact local SQL migrations/services, fixed design persistence, retired endpoint rejection, isolated configuration, token quote conservation and offline transaction-verifier tamper rejection.

Files named `*.mintdex-reference.ts` retain MintDex's historical signed-wallet and mainnet activation tests. They are intentionally outside test discovery: CardDex has no configured program, trust anchors or remote API, and NFT marketplace/royalty behavior is removed. They are source references, not proof of CardDex issuance. The complete inherited SDK test sources remain in `chain/sdk/test/`; enabling a future independent CardDex adapter requires its own integration tests and owner-authorized deployment.
