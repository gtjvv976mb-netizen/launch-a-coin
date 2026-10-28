// READ-ONLY devnet fetch of the account and transaction fixtures used by the chain-sdk tests.
// It never signs or sends anything: only getMultipleAccounts / getTransaction.
// usage (from chain/sdk): node scripts/fetch-fixtures.mjs        RPC=<devnet url> to override
// Account files use the `solana account --output json` shape, so solana-test-validator --account can load them.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bondingCurvePda, creatorVaultPda, cardVaultPda } from "../src/pda.ts";
import { base58Encode } from "../src/bytes.ts";

const RPC = process.env.RPC || "https://api.devnet.solana.com";
if (/mainnet/i.test(RPC)) throw new Error("refusing: mainnet RPC");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "devnet");
mkdirSync(OUT, { recursive: true });

let id = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  }
  throw new Error(`${method}: rate limited`);
}

const COIN1 = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
const COIN2 = "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint";
const COIN1_POOL = "GoNfjcoURBJwijyt5eKgU2rw82M297anFHncfw5gyNpx";

const accounts = {
  pump_global: "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
  pump_fee_config: "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
  amm_global_config: "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
  amm_fee_config: "5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx",
  pyth_sol_usd: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  shared_alt: "G66jR7Q7FCX8pDZP5Lq6QypZcJUQRzDkyELHZKCtS9XN",
  coin1_mint: COIN1,
  coin1_curve: bondingCurvePda(COIN1),
  coin1_pool: COIN1_POOL,
  coin1_card_vault: cardVaultPda(COIN1),
  coin2_mint: COIN2,
  coin2_curve: bondingCurvePda(COIN2),
  coin2_card_vault: cardVaultPda(COIN2),
  coin2_pump_creator_vault: creatorVaultPda(cardVaultPda(COIN2)),
};

const txs = {
  coin1_launch: "37bd9e5ufwHmrsJeJHp3F1ADpokv6dq1RSCZfwb6mbnavG64gAH7MA7kcMif6nrL5uo7bFN53ws6n1ttAQ6dwffC",
  coin1_buy: "hVzEZeWBYCSyHTeK4AhRfiPCRKohJ2uUej78h9uXfWKTfN66GRgF6VJRRCD3VEEEoorxgUGRCsADwrHPovMKEGQ",
  coin1_sell: "5q4ZeTtmTwe2MJZBBinUhRBVti7tk8TK2ytgBbMoGyZxVZEzfYiLBJ85ye92mWaLSoTwbagRpgxuzivnXiyHJFPr",
  coin1_collect: "4j9i1zREj8p71SjKBGku9HX9ao68QGRvgjHCtQcFEBNnHcaducdaYpEurrk3UyFmZ2yYKKTGp59igU7LbhEduMSN",
  coin1_complete: "48j8babLr1bVZX6M7wmkKAGgc5V59XgnX6fotbfAHAQPmWqMmUyq2L5XZuNM9es8kL1GfhGbL67Jf5zQtLgtoSst",
  coin1_migrate: "2N15DMEhrx2zEan6ixq6dFzPGirFZE9dukrYiYK6hdFknNULEupYtiL1ZtX1FEBcFb5Hmno7LA7RFHff9bfsU3UB",
  coin1_amm_sell: "nBzRiB7qSiP5kC81YyuAommWjZf6LFqChsHbZxfdvYcrxgUc9gjnk6zZqvEgQ9aDX1HLQfg8p7Dittt1mMJVvxj",
  coin1_transfer_collect: "3zzCXffinRBp17jV6Ty7no2PiqUrfr2qaiTby4iVZSer7kgBhmmZjd3kHkvZePNRNRCCUhKrCPVNfSigZPXsKc9U",
  coin2_launch_alt: "4oneKJG5BggSVwNwudN73PoxjkivFVTivNqQUqKwKyKbEANUq52rkjYZwBkrzEssgNymb9E4JhyTtA8vb3GSm5YT",
};

function accountJson(pubkey, info) {
  return {
    pubkey,
    account: {
      lamports: info.lamports,
      data: info.data,
      owner: info.owner,
      executable: info.executable,
      rentEpoch: 0,
      space: info.space ?? Buffer.from(info.data[0], "base64").length,
    },
  };
}

async function fetchAccounts(map) {
  const names = Object.keys(map);
  const keys = names.map((n) => map[n]);
  const res = await rpc("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
  const out = {};
  names.forEach((n, i) => {
    if (!res.value[i]) throw new Error(`missing account ${n} ${keys[i]}`);
    out[n] = accountJson(keys[i], res.value[i]);
  });
  return { slot: res.context.slot, out };
}

const { slot, out } = await fetchAccounts(accounts);
// The pool's own token accounts sit at fixed offsets of the pool data.
const pool = Buffer.from(out.coin1_pool.account.data[0], "base64");
const more = await fetchAccounts({
  coin1_pool_base_ta: base58Encode(pool.subarray(139, 171)),
  coin1_pool_quote_ta: base58Encode(pool.subarray(171, 203)),
});
Object.assign(out, more.out);
for (const [name, json] of Object.entries(out))
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(json, null, 1) + "\n");

const meta = { fetched_at: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=REDACTED"), slot };
for (const [name, sig] of Object.entries(txs)) {
  const t = await rpc("getTransaction", [
    sig,
    { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);
  if (!t) throw new Error(`missing tx ${name}`);
  writeFileSync(
    join(OUT, `tx_${name}.json`),
    JSON.stringify(
      {
        signature: sig,
        slot: t.slot,
        blockTime: t.blockTime,
        version: t.version,
        err: t.meta.err,
        transaction: t.transaction[0],
        loadedAddresses: t.meta.loadedAddresses ?? { writable: [], readonly: [] },
        computeUnitsConsumed: t.meta.computeUnitsConsumed ?? null,
      },
      null,
      1
    ) + "\n"
  );
}
writeFileSync(join(OUT, "_meta.json"), JSON.stringify(meta, null, 1) + "\n");
console.log(`wrote ${Object.keys(out).length} accounts and ${Object.keys(txs).length} txs at slot ${slot} to ${OUT}`);
