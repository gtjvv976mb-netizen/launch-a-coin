import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as pump from "@pump-fun/pump-sdk";
import * as amm from "@pump-fun/pump-swap-sdk";
import * as P from "../src/pda.ts";
import { MINTDEX_PROGRAM_ID } from "../src/constants.ts";
import { decodePool } from "../src/accounts/pamm.ts";
import { fixtureAccount } from "./helpers.ts";

const COIN1 = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
const COIN2 = "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint";
const MDX = new PublicKey(MINTDEX_PROGRAM_ID);

test("pump / PumpSwap global PDAs equal the SDK and the facts doc addresses", () => {
  const cases: [string, string, string?][] = [
    [P.pumpGlobalPda(), pump.GLOBAL_PDA.toBase58(), "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"],
    [
      P.pumpMintAuthorityPda(),
      PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], pump.PUMP_PROGRAM_ID)[0].toBase58(),
      "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",
    ],
    [P.pumpEventAuthority(), pump.PUMP_EVENT_AUTHORITY_PDA.toBase58(), "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"],
    [
      P.globalVolumeAccumulatorPda(),
      pump.GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58(),
      "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
    ],
    [P.pumpFeeConfigPda(), pump.PUMP_FEE_CONFIG_PDA.toBase58(), "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"],
    [P.pumpQuoteControlPda(), pump.QUOTE_CONTROL_PDA.toBase58(), "6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP"],
    [P.mayhemGlobalParamsPda(), pump.getGlobalParamsPda().toBase58(), "13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ"],
    [P.mayhemSolVaultPda(), pump.getSolVaultPda().toBase58(), "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"],
    [P.ammGlobalConfigPda(), amm.GLOBAL_CONFIG_PDA.toBase58(), "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"],
    [P.ammFeeConfigPda(), amm.PUMP_AMM_FEE_CONFIG_PDA.toBase58(), "5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx"],
    [
      P.ammEventAuthority(),
      pump.PUMP_AMM_EVENT_AUTHORITY_PDA.toBase58(),
      "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR",
    ],
    [P.ammGlobalVolumeAccumulatorPda(), pump.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58()],
  ];
  for (const [mine, sdk, facts] of cases) {
    assert.equal(mine, sdk);
    if (facts) assert.equal(mine, facts);
  }
});

test("per-mint pump / PumpSwap PDAs equal the SDK for random mints and the two devnet coins", () => {
  const mints = [COIN1, COIN2, ...Array.from({ length: 20 }, () => Keypair.generate().publicKey.toBase58())];
  for (const m of mints) {
    const mint = new PublicKey(m);
    const user = Keypair.generate().publicKey;
    assert.equal(P.bondingCurvePda(m), pump.bondingCurvePda(mint).toBase58());
    assert.equal(P.bondingCurveV2Pda(m), pump.bondingCurveV2Pda(mint).toBase58());
    assert.equal(P.poolAuthorityPda(m), pump.pumpPoolAuthorityPda(mint).toBase58());
    assert.equal(P.canonicalPoolPda(m), pump.canonicalPumpPoolPda(mint).toBase58());
    assert.equal(P.mayhemStatePda(m), pump.getMayhemStatePda(mint).toBase58());
    assert.equal(P.mayhemTokenVault(m), pump.getTokenVaultPda(mint).toBase58());
    assert.equal(P.userVolumeAccumulatorPda(user.toBase58()), pump.userVolumeAccumulatorPda(user).toBase58());
    assert.equal(
      P.ammUserVolumeAccumulatorPda(user.toBase58()),
      pump.userVolumeAccumulatorPda(user, pump.PUMP_AMM_PROGRAM_ID).toBase58()
    );
    assert.equal(P.poolV2Pda(m), amm.poolV2Pda(mint).toBase58());
    const pool = pump.canonicalPumpPoolPda(mint);
    assert.equal(P.lpMintPda(pool.toBase58()), amm.lpMintPda(pool).toBase58());
    assert.equal(P.boostVaultAuthorityPda(pool.toBase58()), pump.boostVaultAuthorityPda(pool).toBase58());
    const vault = P.cardVaultPda(m);
    assert.equal(P.creatorVaultPda(vault), pump.creatorVaultPda(new PublicKey(vault)).toBase58());
    assert.equal(P.ammCreatorVaultAuthorityPda(vault), pump.ammCreatorVaultPda(new PublicKey(vault)).toBase58());
    assert.equal(
      P.ammCreatorVaultAta(vault),
      amm
        .coinCreatorVaultAtaPda(amm.coinCreatorVaultAuthorityPda(new PublicKey(vault)), NATIVE_MINT, TOKEN_PROGRAM_ID)
        .toBase58()
    );
  }
});

test("MintDex PDAs use the card-program-v2 §3 seeds", () => {
  const seed = (s: string) => Buffer.from(s);
  const m = Keypair.generate().publicKey;
  const bidder = Keypair.generate().publicKey;
  const d = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, MDX)[0].toBase58();
  assert.equal(P.configPda(), d([seed("config")]));
  assert.equal(P.ticketPda(m.toBase58()), d([seed("vanity"), m.toBuffer()]));
  assert.equal(P.cardVaultPda(m.toBase58()), d([seed("card"), m.toBuffer()]));
  assert.equal(P.cardStatePda(m.toBase58()), d([seed("card-state"), m.toBuffer()]));
  assert.equal(P.cardMintPda(m.toBase58()), d([seed("card-mint"), m.toBuffer()]));
  assert.equal(P.bidPda(m.toBase58(), bidder.toBase58()), d([seed("bid"), m.toBuffer(), bidder.toBuffer()]));
  assert.equal(P.listingPda(m.toBase58()), d([seed("listing"), m.toBuffer()]));
  assert.equal(P.mintdexEventAuthority(), d([seed("__event_authority")]));
  assert.equal(
    P.programDataAddress(),
    PublicKey.findProgramAddressSync(
      [MDX.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    )[0].toBase58()
  );
});

test("devnet facts: card vaults of coins 1 and 2, coin 1 pool and pool authority", () => {
  assert.equal(P.cardVaultPda(COIN1), "CbSXLuJ78qdNNGzpNqWmdTvGdbQPvyY3LiVCijS9eKpA");
  assert.equal(P.cardVaultPda(COIN2), "6DRrwVRrsnNHkYnPCK9jsbjxLQpMC8U3PZpWQcQSt26S");
  assert.equal(P.canonicalPoolPda(COIN1), "GoNfjcoURBJwijyt5eKgU2rw82M297anFHncfw5gyNpx");
  assert.equal(P.poolAuthorityPda(COIN1), "B9ZLCdP5T3kcmptadZTXegs7iXu3F9GHYZtiiF4YLWYx");
  // the canonical pool's token accounts are the ATAs coinAddresses() derives
  const pool = decodePool(fixtureAccount("coin1_pool").data);
  const a = P.coinAddresses(COIN1);
  assert.equal(pool.poolBaseTokenAccount, a.poolBaseTokenAccount);
  assert.equal(pool.poolQuoteTokenAccount, a.poolQuoteTokenAccount);
  assert.equal(pool.coinCreator, a.cardVault);
  assert.equal(pool.creator, a.poolAuthority);
  assert.equal(fixtureAccount("coin1_card_vault").address, a.cardVault);
  assert.equal(fixtureAccount("coin2_pump_creator_vault").address, P.coinAddresses(COIN2).pumpCreatorVault);
});
