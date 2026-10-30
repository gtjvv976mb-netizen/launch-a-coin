import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  bondingCurvePda, GLOBAL_PDA, PUMP_PROGRAM_ID, QUOTE_CONTROL_PDA,
} from "@pump-fun/pump-sdk";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import fixture from "./fixtures/mainnet-pair-accounts-2026-10-28.json";
import art from "../src/design-assets.json";
import finalIdentitySnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-identities-and-metadata.json";
import finalRawSnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-public-account-snapshots.json";
import { CARD_DESIGNS } from "../../../app/src/lib/carddex/designs";
import { OFFERED_PAIRS, defaultQuoteForDesign, designForPair } from "../../../app/src/lib/carddex/pairs";
import {
  MAINNET_GENESIS_HASH, PAIR_ASSETS, preparePumpLaunchPlan,
  type PairReadConnection, type PrepareLaunchInput,
} from "../src/index.ts";

// Deterministic test-only public identities. No signatures are ever generated.
const creator = Keypair.fromSeed(new Uint8Array(32).fill(101)).publicKey.toBase58();
const mint = Keypair.fromSeed(new Uint8Array(32).fill(102)).publicKey.toBase58();
const now = () => new Date("2026-10-28T12:00:00Z");
/**
 * Reviewed pairs whose Token-2022 mint charges a transfer fee (ZCAT: 3%, in the 30 October fixtures). This adapter's
 * pre-send check (quoteIssuerControls) refuses them, since SDK 4.1.0 prices buys without the fee; the demo is unaffected.
 */
const TRANSFER_FEE_QUOTES = new Set(["zcat"]);
const moreMemeQuotes = ["goat", "zerebro", "act", "pippin", "vine", "aura", "michi", "cate", "ansem", "bert", "chillhouse", "usduc"];

function input(designKey = "stock-tsla", quoteKey = "tslax"): PrepareLaunchInput {
  const design = art[designKey as keyof typeof art];
  return {
    creator, mint, name: "CardDex Example", symbol: "CARDX", quoteKey,
    tokenMetadataUri: "ipfs://bafybeiexample/token.json",
    card: {
      designKey,
      frontUri: `https://assets.example.com${design?.front.path ?? "/unknown-front.webp"}`,
      backUri: `https://assets.example.com${design?.back.path ?? "/unknown-back.webp"}`,
      frontSha256: design?.front.sha256 ?? "a".repeat(64),
      backSha256: design?.back.sha256 ?? "b".repeat(64),
      nftMetadataUri: "ipfs://bafybeiexample/nft.json",
    },
  };
}

function reader(options: {
  mutate?: (accounts: Map<string, AccountInfo<Buffer> | null>) => void;
  genesisHash?: string;
} = {}) {
  const accounts = new Map<string, AccountInfo<Buffer> | null>(
    Object.entries(fixture.accounts).map(([key, value]) => [key, {
      executable: value.executable, owner: new PublicKey(value.owner),
      lamports: value.lamports, data: Buffer.from(value.data[0], "base64"),
      rentEpoch: value.rentEpoch,
    }]),
  );
  options.mutate?.(accounts);
  let reads = 0;
  const connection: PairReadConnection = {
    getGenesisHash: async () => options.genesisHash ?? MAINNET_GENESIS_HASH,
    getMultipleAccountsInfoAndContext: async (keys) => {
      reads++;
      return { context: fixture.context, value: keys.map((key) => accounts.get(key.toBase58()) ?? null) };
    },
  };
  return { connection, reads: () => reads };
}

describe("unsigned official Pump custom-pair preparer", () => {
  test("eight exact crypto additions preserve fresh mint bytes and reject substituted units or owning programs",async()=>{
    const source=finalRawSnapshot.snapshots[0];
    for(const snapshot of finalIdentitySnapshot.assets){
      const index=source.keys.indexOf(snapshot.mint);
      expect(index).toBeGreaterThanOrEqual(0);
      const sourceAccount=source.value[index];
      if(!sourceAccount)throw new Error("Missing exact public mint fixture: "+snapshot.key);
      expect(fixture.accounts[snapshot.mint as keyof typeof fixture.accounts]).toEqual(sourceAccount);
      const quote=PAIR_ASSETS.find(asset=>asset.key===snapshot.key)!;
      const request=input("obsidian-archive",quote.key);
      const plan=await preparePumpLaunchPlan(request,{connection:reader().connection,now});
      expect(plan.binding.quote).toMatchObject({key:snapshot.key,kind:"crypto",mint:snapshot.mint,decimals:snapshot.admission.decimals,tokenProgram:snapshot.admission.tokenProgram});
      expect(plan.createInstruction.accounts[16].address).toBe(snapshot.mint);
      expect(plan.createInstruction.accounts[18].address).toBe(snapshot.admission.tokenProgram);
      expect(plan.nft.quoteMint).toBe(snapshot.mint);
      const changedDecimals=reader({mutate(accounts){accounts.get(snapshot.mint)!.data[44]=snapshot.admission.decimals+1;}});
      await expect(preparePumpLaunchPlan(request,{connection:changedDecimals.connection})).rejects.toThrow("decimals or token program");
      const changedProgram=reader({mutate(accounts){accounts.get(snapshot.mint)!.owner=snapshot.admission.tokenProgram===TOKEN_2022_PROGRAM_ID.toBase58()?TOKEN_PROGRAM_ID:TOKEN_2022_PROGRAM_ID;}});
      await expect(preparePumpLaunchPlan(request,{connection:changedProgram.connection})).rejects.toThrow();
    }
  });
  test("TSLA plan carries the exact quote, all four positional accounts, payer and new-mint signers", async () => {
    const rpc = reader();
    const request = input();
    const plan = await preparePumpLaunchPlan(request, { connection: rpc.connection, now });
    const quote = new PublicKey(PAIR_ASSETS.find((asset) => asset.key === "tslax")!.mint);
    expect(plan.status).toBe("unsigned-review-only");
    expect(plan.sdkVersion).toBe("4.1.0");
    expect(rpc.reads()).toBe(1);
    expect(plan.verifiedSlot).toBe(fixture.context.slot);
    expect(plan.admission).toBe("quoteControl");
    expect(plan.binding.quote.mint).toBe(quote.toBase58());
    expect(plan.binding.quote.decimals).toBe(8);
    expect(plan.binding.quote.tokenProgram).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    expect(plan.binding.card.designKey).toBe("stock-tsla");
    expect([...plan.requiredSigners].sort()).toEqual([creator, mint].sort());
    expect(plan.createInstruction.programId).toBe(PUMP_PROGRAM_ID.toBase58());
    expect(plan.createInstruction.accounts).toHaveLength(20);
    expect(plan.createInstruction.accounts[0]).toEqual({ address: mint, signer: true, writable: true });
    expect(plan.createInstruction.accounts[5]).toEqual({ address: creator, signer: true, writable: true });
    expect(plan.createInstruction.accounts.slice(16)).toEqual([
      { address: quote.toBase58(), signer: false, writable: false },
      {
        address: getAssociatedTokenAddressSync(quote, bondingCurvePda(mint), true, TOKEN_2022_PROGRAM_ID).toBase58(),
        signer: false, writable: true,
      },
      { address: TOKEN_2022_PROGRAM_ID.toBase58(), signer: false, writable: false },
      { address: QUOTE_CONTROL_PDA.toBase58(), signer: false, writable: false },
    ]);
    const data = Buffer.from(plan.createInstruction.dataBase64, "base64");
    expect(data.subarray(0, 8).toString("hex")).toBe("d6904cec5f8b31b4");
    let offset = 8;
    for (const expected of [request.name, request.symbol, request.tokenMetadataUri]) {
      const length = data.readUInt32LE(offset); offset += 4;
      expect(data.subarray(offset, offset + length).toString("utf8")).toBe(expected); offset += length;
    }
    expect(new PublicKey(data.subarray(offset, offset + 32)).toBase58()).toBe(creator); offset += 32;
    expect([...data.subarray(offset)]).toEqual(new Array(11).fill(0));
    expect(plan.nft.status).toBe("not-issued");
    expect(plan.nft.quoteMint).toBe(quote.toBase58());
    expect(plan.nft.bindingSha256).toBe(plan.bindingSha256);
    expect(plan.bindingSha256).toBe(createHash("sha256").update(JSON.stringify(plan.binding)).digest("hex"));
    expect(Object.isFrozen(plan.binding.card)).toBe(true);
    expect("signatures" in plan).toBe(false);
    expect("transaction" in plan).toBe(false);
  });

  test("all admitted catalog assets use exact reviewed mints/programs; SOL has no extra quote accounts", async () => {
    expect(PAIR_ASSETS.length).toBeGreaterThanOrEqual(51);
    for (const asset of PAIR_ASSETS) {
      if (TRANSFER_FEE_QUOTES.has(asset.key)) {
        await expect(preparePumpLaunchPlan(input("obsidian-archive", asset.key), { connection: reader().connection, now })).rejects.toThrow("transfer fee");
        continue;
      }
      const plan = await preparePumpLaunchPlan(input("obsidian-archive", asset.key), { connection: reader().connection, now });
      expect(plan.binding.quote.mint).toBe(asset.mint);
      expect(plan.binding.quote.decimals).toBe(asset.decimals);
      expect(plan.binding.quote.tokenProgram).toBe(asset.tokenProgram);
      expect(plan.createInstruction.accounts).toHaveLength(asset.key === "sol" ? 16 : 20);
      if (asset.key !== "sol") {
        expect(plan.createInstruction.accounts[16].address).toBe(asset.mint);
        expect(plan.createInstruction.accounts[18].address).toBe(asset.tokenProgram);
      }
    }
  });

  test("all active designs use the app's immutable design/pair policy", async () => {
    expect(Object.keys(art).length).toBeGreaterThanOrEqual(CARD_DESIGNS.length);
    for (const design of CARD_DESIGNS) {
      const quoteKey = defaultQuoteForDesign(design.key).key;
      if (TRANSFER_FEE_QUOTES.has(quoteKey)) {
        await expect(preparePumpLaunchPlan(input(design.key, quoteKey), { connection: reader().connection, now })).rejects.toThrow("transfer fee");
        continue;
      }
      const plan = await preparePumpLaunchPlan(input(design.key, quoteKey), { connection: reader().connection, now });
      expect(plan.binding.card.designKey).toBe(design.key);
      expect(plan.binding.quote.key).toBe(quoteKey);
    }
  });

  test("every offered pair prepares with its own design's reviewed art hashes (the pair picks the card)", async () => {
    expect(OFFERED_PAIRS).toHaveLength(95);
    for (const asset of OFFERED_PAIRS) {
      const designKey = designForPair(asset.key)!, request = input(designKey, asset.key);
      expect(art[designKey as keyof typeof art]).toBeDefined();
      expect(request.card.frontSha256).toBe(art[designKey as keyof typeof art].front.sha256);
      expect(request.card.backSha256).toBe(art[designKey as keyof typeof art].back.sha256);
      if (TRANSFER_FEE_QUOTES.has(asset.key)) {
        await expect(preparePumpLaunchPlan(request, { connection: reader().connection, now })).rejects.toThrow("transfer fee");
        continue;
      }
      const plan = await preparePumpLaunchPlan(request, { connection: reader().connection, now });
      expect(plan.binding.card).toMatchObject({ designKey, frontSha256: request.card.frontSha256, backSha256: request.card.backSha256 });
      expect(plan.binding.quote).toMatchObject({ key: asset.key, mint: asset.mint });
    }
  });

  test("approved front/back manifest equals the actual 96 local WebPs", async () => {
    for (const design of Object.values(art)) {
      for (const face of [design.front, design.back]) {
        const path = fileURLToPath(new URL(`../../../app/public${face.path}`, import.meta.url));
        expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(face.sha256);
      }
    }
  });

  test("rejects TSLA paired with GME, unknown designs, unknown pair IDs and wrong design bytes", async () => {
    for (const request of [input("stock-tsla", "gmex"), input("not-a-design"), input("obsidian-archive", "fake")]) {
      const rpc = reader();
      await expect(preparePumpLaunchPlan(request, { connection: rpc.connection })).rejects.toThrow();
      expect(rpc.reads()).toBe(0);
    }
    const wrongArt = input(); wrongArt.card.frontSha256 = art["stock-gme"].front.sha256;
    await expect(preparePumpLaunchPlan(wrongArt, { connection: reader().connection })).rejects.toThrow("reviewed design manifest");
  });

  test("a mint removed from live quote control is rejected before instruction construction", async () => {
    const rpc = reader({ mutate(accounts) {
      const account = accounts.get(QUOTE_CONTROL_PDA.toBase58())!;
      account.data = Buffer.from(account.data.subarray(0, 108));
      account.data.writeUInt32LE(0, 104);
    } });
    await expect(preparePumpLaunchPlan(input(), { connection: rpc.connection })).rejects.toThrow("no longer directly admitted");
  });

  test("rejects changed decimals or owning token program", async () => {
    const asset = PAIR_ASSETS.find((candidate) => candidate.key === "tslax")!;
    const changedDecimals = reader({ mutate(accounts) { accounts.get(asset.mint)!.data[44] = 9; } });
    await expect(preparePumpLaunchPlan(input(), { connection: changedDecimals.connection })).rejects.toThrow("decimals or token program");
    const changedProgram = reader({ mutate(accounts) { accounts.get(asset.mint)!.owner = TOKEN_PROGRAM_ID; } });
    await expect(preparePumpLaunchPlan(input(), { connection: changedProgram.connection })).rejects.toThrow();
  });

  test("each additional meme quote rejects substituted mint units or token-program ownership", async () => {
    for (const key of ["pengu","giga","spx","trump","useless","chillguy",...moreMemeQuotes]) {
      const asset=PAIR_ASSETS.find(candidate=>candidate.key===key)!;
      const changedDecimals=reader({mutate(accounts){accounts.get(asset.mint)!.data[44]=asset.decimals+1;}});
      await expect(preparePumpLaunchPlan(input("obsidian-archive",key),{connection:changedDecimals.connection})).rejects.toThrow("decimals or token program");
      const changedProgram=reader({mutate(accounts){accounts.get(asset.mint)!.owner=asset.tokenProgram===TOKEN_2022_PROGRAM_ID.toBase58()?TOKEN_PROGRAM_ID:TOKEN_2022_PROGRAM_ID;}});
      await expect(preparePumpLaunchPlan(input("obsidian-archive",key),{connection:changedProgram.connection})).rejects.toThrow();
    }
  });

  test("new meme quotes resolve current starting reserves rather than pinning the reviewed pricing snapshot", async () => {
    for (const key of moreMemeQuotes) {
      const asset=PAIR_ASSETS.find(candidate=>candidate.key===key)!;
      const currentReserves="123456789000";
      const rpc=reader({mutate(accounts){
        const data=accounts.get(QUOTE_CONTROL_PDA.toBase58())!.data;
        const offset=data.indexOf(new PublicKey(asset.mint).toBuffer(),108);
        expect(offset).toBeGreaterThanOrEqual(108);
        data.writeBigUInt64LE(BigInt(currentReserves),offset+32);
      }});
      const plan=await preparePumpLaunchPlan(input("obsidian-archive",key),{connection:rpc.connection,now});
      expect(plan.initialVirtualQuoteReserves).toBe(currentReserves);
      expect(plan.initialVirtualQuoteReserves).not.toBe(asset.initialVirtualQuoteReserves);
      expect(plan.admission).toBe("quoteControl");
      expect(plan.binding.quote.mint).toBe(asset.mint);
      expect(rpc.reads()).toBe(1);
    }
  });

  test("rejects zero quote reserves and disabled coin creation", async () => {
    const asset = PAIR_ASSETS.find((candidate) => candidate.key === "tslax")!;
    const noReserves = reader({ mutate(accounts) {
      const data = accounts.get(QUOTE_CONTROL_PDA.toBase58())!.data;
      const offset = data.indexOf(new PublicKey(asset.mint).toBuffer(), 108);
      expect(offset).toBeGreaterThanOrEqual(108);
      data.writeBigUInt64LE(0n, offset + 32);
    } });
    await expect(preparePumpLaunchPlan(input(), { connection: noReserves.connection })).rejects.toThrow("positive starting reserves");
    const disabledCreate = reader({ mutate(accounts) { accounts.get(GLOBAL_PDA.toBase58())!.data[450] = 0; } });
    await expect(preparePumpLaunchPlan(input(), { connection: disabledCreate.connection })).rejects.toThrow("create_v2 is disabled");
  });

  test("rejects a paused xStock mint", async () => {
    const asset = PAIR_ASSETS.find((candidate) => candidate.key === "tslax")!;
    const rpc = reader({ mutate(accounts) {
      const data = accounts.get(asset.mint)!.data;
      let offset = 166, found = false;
      while (offset + 4 <= data.length) {
        const type = data.readUInt16LE(offset), length = data.readUInt16LE(offset + 2);
        if (type === 26) { data[offset + 4 + 32] = 1; found = true; break; }
        offset += 4 + length;
      }
      expect(found).toBe(true);
    } });
    await expect(preparePumpLaunchPlan(input(), { connection: rpc.connection })).rejects.toThrow("paused or frozen");
  });

  test("rejects wrong network, invalid Pump ownership, missing quotes and an already-created mint", async () => {
    await expect(preparePumpLaunchPlan(input(), { connection: reader({ genesisHash: "devnet" }).connection })).rejects.toThrow("mainnet");
    const invalidOwner = reader({ mutate(accounts) { accounts.get(GLOBAL_PDA.toBase58())!.owner = PublicKey.default; } });
    await expect(preparePumpLaunchPlan(input(), { connection: invalidOwner.connection })).rejects.toThrow("Global account owner");
    const missingMint = reader({ mutate(accounts) { accounts.delete(PAIR_ASSETS.find((asset) => asset.key === "tslax")!.mint); } });
    await expect(preparePumpLaunchPlan(input(), { connection: missingMint.connection })).rejects.toThrow("Pair mint account is missing");
    const existingMint = reader({ mutate(accounts) { accounts.set(mint, accounts.get(GLOBAL_PDA.toBase58())!); } });
    await expect(preparePumpLaunchPlan(input(), { connection: existingMint.connection })).rejects.toThrow("already exists");
  });

  test("rejects local metadata URLs and preserves distinct per-design commitments", async () => {
    const local = input(); local.tokenMetadataUri = "http://127.0.0.1:5310/token.json";
    await expect(preparePumpLaunchPlan(local, { connection: reader().connection })).rejects.toThrow("public HTTPS or IPFS");
    const tsla = await preparePumpLaunchPlan(input(), { connection: reader().connection, now });
    const gme = await preparePumpLaunchPlan(input("stock-gme", "gmex"), { connection: reader().connection, now });
    expect(tsla.bindingSha256).not.toBe(gme.bindingSha256);
    expect(tsla.instructionSha256).not.toBe(gme.instructionSha256);
  });
});
