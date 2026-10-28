// Per-cluster profile (refs/mainnet/design-compat.md §6.2, O2 and O5): measured constants, no silent devnet default.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterOfGenesis,
  clusterProfile,
  DEVNET_GENESIS_HASH,
  DEVNET_PROFILE,
  MAINNET_GENESIS_HASH,
  MAINNET_PROFILE,
  MINTDEX_PROGRAM_ID,
} from "../src/index.ts";

test("profiles: genesis, program id, Metaplex fee, fresh curve size and the v1 probe per cluster", () => {
  assert.equal(DEVNET_PROFILE.genesisHash, DEVNET_GENESIS_HASH);
  assert.equal(MAINNET_PROFILE.genesisHash, MAINNET_GENESIS_HASH);
  for (const p of [DEVNET_PROFILE, MAINNET_PROFILE]) {
    assert.equal(p.programId, MINTDEX_PROGRAM_ID, "4HTSBY… on both (D1)");
    assert.equal(p.metaplexCreationFeeLamports, 10_000_000n, "flat 0.01 SOL measured on both builds");
    assert.equal(p.maxTxVersion, 1);
    assert.ok(Object.isFrozen(p));
  }
  assert.equal(DEVNET_PROFILE.freshCurveLenMax, 174);
  assert.equal(MAINNET_PROFILE.freshCurveLenMax, 166);
  assert.equal(DEVNET_PROFILE.txVersionProbeSig, null);
  assert.match(MAINNET_PROFILE.txVersionProbeSig ?? "", /^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
  assert.equal(DEVNET_PROFILE.walletChain, "solana:devnet");
  assert.equal(MAINNET_PROFILE.walletChain, "solana:mainnet");
});

test("clusterProfile refuses anything but devnet / mainnet; clusterOfGenesis maps both hashes", () => {
  assert.equal(clusterProfile("devnet"), DEVNET_PROFILE);
  assert.equal(clusterProfile("mainnet"), MAINNET_PROFILE);
  assert.equal(clusterProfile("mainnet-beta"), MAINNET_PROFILE);
  for (const bad of ["", "testnet", "localnet", undefined, null, "Devnet"]) assert.throws(() => clusterProfile(bad as string), /unknown cluster/);
  assert.equal(clusterOfGenesis(DEVNET_GENESIS_HASH), "devnet");
  assert.equal(clusterOfGenesis(MAINNET_GENESIS_HASH), "mainnet");
  assert.equal(clusterOfGenesis("4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"), null);
});
