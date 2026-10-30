import { readFileSync, writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID, PUMP_SDK, OnlinePumpSdk, GLOBAL_PDA, QUOTE_CONTROL_PDA } from "@pump-fun/pump-sdk";
import { unpackMint, getExtensionData, ExtensionType, getPausableConfig, getDefaultAccountState } from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";

// Research only. No credential reads, signing, transaction preparation or sends.
// Run from integrations/pumpfun with its installed dependencies:
// bun ../../creative/higgsfield/pair-identities-2026-10-30/research/verify-public.ts
const root = new URL("../../../../", import.meta.url);
const out = new URL("./", import.meta.url);
const registered = JSON.parse(readFileSync(new URL("app/src/lib/carddex/pair-assets.json", root), "utf8"));
const crypto = JSON.parse(readFileSync(new URL("crypto-candidates.json", out), "utf8"));
const assets = [...registered, ...crypto];
const metadataProgram = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const metadataPda = (mint: string) => PublicKey.findProgramAddressSync([
  Buffer.from("metadata"), metadataProgram.toBytes(), new PublicKey(mint).toBytes(),
], metadataProgram)[0];
const keys = [GLOBAL_PDA.toBase58(), QUOTE_CONTROL_PDA.toBase58(), ...assets.flatMap((a) => [a.mint, metadataPda(a.mint).toBase58()])];
// Public RPC permits at most100 accounts; preserve each response's context slot.
const snapshots: any[] = [];
for (let start = 0; start < keys.length; start += 90) {
  const batch = keys.slice(start, start + 90);
  const request = { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [batch, { encoding: "base64", commitment: "confirmed" }] };
  const result = Bun.spawnSync(["python3", "-c", "import urllib.request,sys; p=sys.stdin.buffer.read(); print(urllib.request.urlopen(urllib.request.Request('https://api.mainnet-beta.solana.com',data=p,headers={'Content-Type':'application/json'}),timeout=25).read().decode())"], {
    stdin: Buffer.from(JSON.stringify(request)), stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode) throw new Error(result.stderr.toString());
  const rpc = JSON.parse(result.stdout.toString());
  if (!rpc.result) throw new Error(JSON.stringify(rpc.error));
  snapshots.push({ keys: batch, ...rpc.result });
}
writeFileSync(new URL("public-account-snapshots.json", out), JSON.stringify({ endpoint: "https://api.mainnet-beta.solana.com", fetchedAt: new Date().toISOString(), snapshots }, null, 2) + "\n");
const byKey = new Map<string, any>();
const slotByKey = new Map<string, number>();
for (const s of snapshots) s.keys.forEach((key: string, i: number) => {
  const v = s.value[i]; byKey.set(key, v && { ...v, owner: new PublicKey(v.owner), data: Buffer.from(v.data[0], "base64") }); slotByKey.set(key, s.context.slot);
});
for (const key of [GLOBAL_PDA, QUOTE_CONTROL_PDA]) if (!byKey.get(key.toBase58())?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Pump account owner mismatch");
const sdk = new OnlinePumpSdk({ getMultipleAccountsInfo: async (requested: PublicKey[]) => requested.map((k) => byKey.get(k.toBase58()) ?? null) } as any);
const identities = [];
for (const asset of assets) {
  const mint = byKey.get(asset.mint), address = new PublicKey(asset.mint), metadataAddress = metadataPda(asset.mint), metaplex = byKey.get(metadataAddress.toBase58());
  let metadata: any = null;
  if (mint && mint.owner.toBase58().startsWith("Tokenz")) {
    const state = unpackMint(address, mint, mint.owner);
    const data = getExtensionData(ExtensionType.TokenMetadata, state.tlvData);
    if (data) { const d = unpack(data); metadata = { name: d.name, symbol: d.symbol, uri: d.uri, source: "Token2022 inline metadata" }; }
  }
  if (!metadata && metaplex?.owner.equals(metadataProgram)) {
    let pos = 65;
    const string = () => { const n = metaplex.data.readUInt32LE(pos); pos += 4; const s = metaplex.data.subarray(pos, pos + n).toString().replaceAll("\u0000", "").trim(); pos += n; return s; };
    metadata = { name: string(), symbol: string(), uri: string(), source: metadataAddress.toBase58() };
  }
  let admission: any;
  try {
    const resolved = await sdk.resolveQuoteMint(address), state = unpackMint(address, mint, resolved.quoteTokenProgram);
    admission = { source: resolved.source, decimals: resolved.decimals, tokenProgram: resolved.quoteTokenProgram.toBase58(), initialVirtualQuoteReserves: resolved.initialVirtualQuoteReserves.toString(), initialized: state.isInitialized, paused: getPausableConfig(state)?.paused ?? false, defaultFrozen: getDefaultAccountState(state)?.state === 2 };
  } catch (error) { admission = { error: error instanceof Error ? error.message : String(error) }; }
  identities.push({ key: asset.key, symbol: asset.symbol, name: asset.name, mint: asset.mint, existingRegistry: registered.some((a) => a.key === asset.key), accountSlot: slotByKey.get(asset.mint), metadata, admission });
}
writeFileSync(new URL("verified-identities-and-metadata.json", out), JSON.stringify({ fetchedAt: new Date().toISOString(), scope: "Read-only source research; not installed in launch registry", officialList: "https://pump.fun/docs/custom-pairs", snapshotSlots: snapshots.map((s) => s.context.slot), quoteControlCount: PUMP_SDK.decodeQuoteControl(byKey.get(QUOTE_CONTROL_PDA.toBase58())).mints.length, assets: identities }, null, 2) + "\n");
console.log(JSON.stringify({ assets: identities.length, existing: registered.length, newCrypto: crypto.length, slots: snapshots.map((s) => s.context.slot), admitted: identities.filter((a) => !a.admission.error).length }));
