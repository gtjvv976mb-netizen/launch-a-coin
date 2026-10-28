// Packaging: the main entry loads without web3.js, CommonJS scripts (chain/scripts/*.js) can require() it,
// and the web3 adapters convert both ways.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import * as sdk from "../src/index.ts";
import { fromWeb3Instruction, toWeb3Instruction } from "../src/web3.ts";
import { assertSameIx } from "./helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("main entry exposes the documented surface", () => {
  for (const name of [
    "coinAddresses",
    "cardVaultPda",
    "canonicalPoolPda",
    "levelFor",
    "mcapUsdE6",
    "readMarketCap",
    "curveMarketCapLamports",
    "poolMarketCapLamports",
    "pumpCreateV2",
    "pumpBuy",
    "pumpSell",
    "pumpCollectCreatorFee",
    "pumpMigrate",
    "pammBuy",
    "pammSell",
    "pammTransferCreatorFeesToPump",
    "registerCardIx",
    "withdrawFeesIx",
    "verifyTransaction",
    "decodeTransaction",
    "mintdexAltAddresses",
    "setMintdexIdl",
    "evolveStep",
    "saleSplits",
  ]) {
    assert.equal(typeof (sdk as Record<string, unknown>)[name], "function", name);
  }
});

test("the main entry never imports @solana/web3.js (browser bundle stays small)", () => {
  const files = execFileSync("find", [join(ROOT, "src"), "-name", "*.ts"], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const f of files) {
    if (f.endsWith("/web3.ts")) continue;
    assert.ok(
      !/from "@solana\/web3\.js"|from "@pump-fun|from "@coral-xyz|from "bn\.js"/.test(readFileSync(f, "utf8")),
      f
    );
  }
});

test("CommonJS scripts can require() the SDK (Node ≥ 22.12 require(esm) + type stripping)", () => {
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      `const s = require(${JSON.stringify(
        join(ROOT, "src", "index.ts")
      )}); console.log(s.cardVaultPda("GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint"))`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  assert.equal(out.trim(), "CbSXLuJ78qdNNGzpNqWmdTvGdbQPvyY3LiVCijS9eKpA");
});

test("web3 adapters round-trip instructions", () => {
  const ix = sdk.pumpCollectCreatorFee({ creator: Keypair.generate().publicKey.toBase58() });
  const w = toWeb3Instruction(ix);
  assert.equal(w.programId.toBase58(), sdk.PUMP_PROGRAM_ID);
  assertSameIx(fromWeb3Instruction(w), ix);
});
