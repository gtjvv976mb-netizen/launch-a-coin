import { describe, expect, test } from "bun:test";
import bs58 from "bs58";
import {
  LIGHTHOUSE_PROGRAM_ID, MAX_WALLET_GUARDS, PUMP_LOOKUP_TABLE, WalletMessageRefused, decodeV0Message, keyFlags,
  walletMessageChange, withoutWalletGuards, resolveInstructions,
} from "../src/wallet-guards.ts";
import { encodeV0Message, payerGuardData, phantomGuarded, reordered, tokenGuardData, type MessageParts } from "./message-fixtures.ts";

// Synthetic keys only: this suite decodes and compares messages; nothing is signed or sent.
const key = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
const creator = key(11), mint = key(12), curve = key(13), creatorAta = key(14);
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", COMPUTE = "ComputeBudget111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", SYSTEM = "11111111111111111111111111111111";
const OLD_LIGHTHOUSE = "L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK";
// A coin-shaped plan: two writable signers, two writable accounts, four readonly programs, the two compute-budget
// instructions first, then a create and an ATA create.
const parts: MessageParts = {
  header: { required: 2, readonlySigned: 0, readonlyUnsigned: 4 },
  staticKeys: [creator, mint, curve, creatorAta, PUMP, COMPUTE, ATA, SYSTEM], blockhash: key(44), lookups: [],
  instructions: [
    { program: 5, accounts: [], data: Uint8Array.from([2, 0x40, 0x0d, 0x03, 0]) },
    { program: 5, accounts: [], data: Uint8Array.from([3, 0x40, 0x0d, 3, 0, 0, 0, 0, 0]) },
    { program: 4, accounts: [1, 0, 2, 7], data: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180, 1, 2, 3]) },
    { program: 6, accounts: [0, 3, 0, 1, 7], data: Uint8Array.from([1]) },
  ],
};
const plan = encodeV0Message(parts);
const planView = decodeV0Message(plan);
const phantom = [{ target: creator, data: payerGuardData(5_000_000n) }, { target: creatorAta, data: tokenGuardData(1n) }];
const change = (returned: Uint8Array, allowBlockhashChange = false) => walletMessageChange(planView, decodeV0Message(returned), { allowBlockhashChange });
const refusal = (returned: Uint8Array, allowBlockhashChange = false) => {
  try { change(returned, allowBlockhashChange); return "accepted"; } catch (error) { return error instanceof WalletMessageRefused ? error.reason : `error: ${(error as Error).message}`; }
};

describe("the shared wallet rule", () => {
  test("the prepared message itself is accepted as identical", () => {
    expect(change(plan)).toEqual({ identical: true, recompiled: false, blockhashChanged: false, guards: [] });
  });
  test("Phantom's shape is accepted: assertions appended, the message recompiled with Lighthouse mid-way through the readonly keys", () => {
    const returned = phantomGuarded(plan, phantom), view = decodeV0Message(returned);
    // The program key really moved into the middle of the readonly section and shifted the keys after it.
    expect(view.staticKeys.indexOf(LIGHTHOUSE_PROGRAM_ID)).toBe(6);
    expect(view.staticKeys.indexOf(SYSTEM)).toBe(8);
    expect(view.header.readonlyUnsigned).toBe(5);
    expect(keyFlags(view, 6)).toEqual({ signer: false, writable: false });
    expect(change(returned)).toEqual({ identical: false, recompiled: true, blockhashChanged: false,
      guards: [{ discriminator: 6, target: 0, dataBytes: 26 }, { discriminator: 10, target: 3, dataBytes: 27 }] });
    // Each plan instruction still resolves to the same program, accounts and data.
    expect(resolveInstructions(view).slice(0, 4).map(ix => ix.program)).toEqual([COMPUTE, COMPUTE, PUMP, ATA]);
  });
  test("every one-account Assert* variant is accepted, up to the guard cap; nine as seen on real transactions", () => {
    for (const discriminator of [5, 6, 7, 8, 9, 10]) expect(refusal(phantomGuarded(plan, [{ target: curve, data: Uint8Array.from([discriminator, 4, 0]) }]))).toBe("accepted");
    expect(change(phantomGuarded(plan, Array.from({ length: 9 }, () => phantom[1]))).guards).toHaveLength(9);
    expect(refusal(phantomGuarded(plan, Array.from({ length: MAX_WALLET_GUARDS + 1 }, () => phantom[0])))).toBe("guard");
  });
  test("a recompile that only reorders keys is the same decompiled message", () => {
    expect(change(reordered(plan))).toEqual({ identical: false, recompiled: true, blockhashChanged: false, guards: [] });
  });
  test("a refreshed blockhash is accepted only when the caller allows it", () => {
    const refreshed = phantomGuarded(plan, phantom, { blockhash: key(45) });
    expect(refusal(refreshed)).toBe("blockhash");
    expect(change(refreshed, true)).toMatchObject({ blockhashChanged: true, guards: [{ discriminator: 6 }, { discriminator: 10 }] });
    expect(change(encodeV0Message({ ...parts, blockhash: key(45) }), true)).toMatchObject({ blockhashChanged: true, guards: [] });
  });
  test("other programs, the old Lighthouse, memory writes and wide or oversized assertions are refused", () => {
    expect(refusal(phantomGuarded(plan, [{ ...phantom[0], program: OLD_LIGHTHOUSE }]))).toBe("guard");
    expect(refusal(phantomGuarded(plan, [{ ...phantom[0], program: key(90) }]))).toBe("guard");
    for (const discriminator of [0, 1, 2, 3, 4, 11, 15, 17]) expect(refusal(phantomGuarded(plan, [{ target: creator, data: Uint8Array.from([discriminator, 4, 0]) }]))).toBe("guard");
    expect(refusal(phantomGuarded(plan, [{ target: creator, data: Uint8Array.from([6]) }]))).toBe("guard");
    expect(refusal(phantomGuarded(plan, [{ target: creator, data: new Uint8Array(201).fill(6) }]))).toBe("guard");
    expect(refusal(phantomGuarded(plan, [{ ...phantom[0], extraAccounts: [curve] }]))).toBe("guard");
  });
  test("an assertion on an account the plan does not have, or any other new key, is refused", () => {
    const stranger = key(91);
    expect(refusal(phantomGuarded(plan, [{ target: stranger, data: payerGuardData() }], { newKeys: [stranger] }))).toBe("guard");
    expect(refusal(phantomGuarded(plan, phantom, { newKeys: [stranger] }))).toBe("accounts");
    // A Memory account a MemoryWrite would need: a new key plus a signer and writable payer.
    expect(refusal(phantomGuarded(plan, [{ target: creator, data: Uint8Array.from([0, 0, 0]), extraAccounts: [stranger, SYSTEM] }], { newKeys: [stranger] }))).toBe("guard");
  });
  test("an assertion placed among or before the plan instructions is refused", () => {
    expect(refusal(phantomGuarded(plan, phantom, { at: 0 }))).toBe("instructions");
    expect(refusal(phantomGuarded(plan, phantom, { at: 3 }))).toBe("instructions");
  });
  test("a writable Lighthouse key, or any plan key whose flags move, is refused", () => {
    expect(refusal(phantomGuarded(plan, phantom, { writableProgram: true }))).toBe("flags");
    // The recompiled message makes the readonly System program writable (one fewer readonly key, nothing added).
    expect(refusal(encodeV0Message({ ...parts, header: { ...parts.header, readonlyUnsigned: 3 } }))).toBe("flags");
    // A plan account made readonly.
    expect(refusal(encodeV0Message({ ...parts, header: { ...parts.header, readonlyUnsigned: 5 } }))).toBe("flags");
  });
  test("changed signers, signer order, plan instructions or compute budget are refused", () => {
    expect(refusal(encodeV0Message({ ...parts, header: { ...parts.header, required: 3 } }))).toBe("header");
    expect(refusal(encodeV0Message({ ...parts, header: { ...parts.header, readonlySigned: 1 } }))).toBe("header");
    expect(refusal(encodeV0Message({ ...parts, staticKeys: [mint, creator, ...parts.staticKeys.slice(2)] }))).toBe("signers");
    const price = parts.instructions.map((ix, i) => i === 1 ? { ...ix, data: Uint8Array.from([3, 0x41, 0x0d, 3, 0, 0, 0, 0, 0]) } : ix);
    expect(refusal(encodeV0Message({ ...parts, instructions: price }))).toBe("instructions");
    expect(refusal(encodeV0Message({ ...parts, instructions: parts.instructions.slice(1) }))).toBe("instructions");
    const swapped = [parts.instructions[0], parts.instructions[1], parts.instructions[3], parts.instructions[2]];
    expect(refusal(encodeV0Message({ ...parts, instructions: swapped }))).toBe("instructions");
    const moved = parts.instructions.map((ix, i) => i === 2 ? { ...ix, accounts: [1, 0, 3, 7] } : ix);
    expect(refusal(encodeV0Message({ ...parts, instructions: moved }))).toBe("instructions");
  });
  test("lookups must stay exactly as planned", () => {
    const withTable = { ...parts, lookups: [{ table: PUMP_LOOKUP_TABLE.address, writable: [], readonly: [1] }] };
    const tablePlan = decodeV0Message(encodeV0Message(withTable));
    expect(tablePlan.keys.at(-1)).toBe("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
    expect(() => walletMessageChange(tablePlan, decodeV0Message(encodeV0Message(parts)))).toThrow(WalletMessageRefused);
    expect(() => walletMessageChange(tablePlan, decodeV0Message(encodeV0Message({ ...withTable, lookups: [{ ...withTable.lookups[0], readonly: [3] }] })))).toThrow("lookups");
    expect(walletMessageChange(tablePlan, decodeV0Message(phantomGuarded(encodeV0Message(withTable), phantom))).guards).toHaveLength(2);
  });
});

describe("the strict v0 decoder", () => {
  test("lookups resolve only through pinned entries of pump.fun's table", () => {
    const table = { table: PUMP_LOOKUP_TABLE.address, writable: [19], readonly: [1, 158] };
    expect(decodeV0Message(encodeV0Message({ ...parts, lookups: [table] })).keys.slice(8)).toEqual(["BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s", "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf", "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"]);
    expect(keyFlags(decodeV0Message(encodeV0Message({ ...parts, lookups: [table] })), 8)).toEqual({ signer: false, writable: true });
    expect(() => decodeV0Message(encodeV0Message({ ...parts, lookups: [{ ...table, readonly: [2] }] }))).toThrow("unexpected lookup-table entry");
    expect(() => decodeV0Message(encodeV0Message({ ...parts, lookups: [{ ...table, table: key(77) }] }))).toThrow("unexpected address lookup table");
    // A lookup key repeating a static key, and an invoked program reached through a lookup, are refused.
    expect(() => decodeV0Message(encodeV0Message({ ...parts, lookups: [{ ...table, writable: [], readonly: [10] }] }))).toThrow("repeats an account");
    expect(() => decodeV0Message(encodeV0Message({ ...parts, lookups: [{ ...table, writable: [], readonly: [1] }], instructions: [...parts.instructions, { program: 8, accounts: [], data: new Uint8Array(1) }] }))).toThrow("Invalid transaction program");
  });
  test("non-v0, truncated, padded and non-canonical messages are refused", () => {
    expect(() => decodeV0Message(plan.slice(1))).toThrow("version 0");
    expect(() => decodeV0Message(plan.slice(0, -3))).toThrow();
    expect(() => decodeV0Message(Uint8Array.from([...plan, 0]))).toThrow("trailing bytes");
    const padded = Uint8Array.from([...plan.slice(0, 4), 0x88, 0x00, ...plan.slice(5)]);
    expect(() => decodeV0Message(padded)).toThrow("Non-canonical");
  });
});

describe("the finalized-transaction form of the rule", () => {
  const instructions = (message: Uint8Array) => resolveInstructions(decodeV0Message(message));
  test("a trailing assertion suffix is stripped only when the landed message is the validated one", () => {
    const landed = phantomGuarded(plan, phantom), keys = decodeV0Message(landed).keys;
    expect(withoutWalletGuards(instructions(landed), true, keys)).toHaveLength(4);
    expect(() => withoutWalletGuards(instructions(landed), false, keys)).toThrow(WalletMessageRefused);
    expect(withoutWalletGuards(instructions(plan), false, planView.keys)).toHaveLength(4);
  });
  test("interleaved or misshapen Lighthouse instructions are refused even with a validated hash", () => {
    const interleaved = phantomGuarded(plan, phantom, { at: 2 });
    expect(() => withoutWalletGuards(instructions(interleaved), true, decodeV0Message(interleaved).keys)).toThrow(WalletMessageRefused);
    const memory = phantomGuarded(plan, [{ target: creator, data: Uint8Array.from([0, 0, 0]) }]);
    expect(() => withoutWalletGuards(instructions(memory), true, decodeV0Message(memory).keys)).toThrow(WalletMessageRefused);
  });
});
