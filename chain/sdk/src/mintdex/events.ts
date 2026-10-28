// Event decoding with the authenticity rule of card-program-v2 §9 (rev 1): an `emit_cpi!` event counts only
// when the inner instruction's program is the emitting program AND its only account is that program's
// event-authority PDA. Anyone can emit the same bytes from their own program.
import { toAddress } from "../address.ts";
import type { AddressLike } from "../address.ts";
import { bytesEqual } from "../bytes.ts";
import { ANCHOR_EVENT_IX_TAG, MINTDEX_PROGRAM_ID } from "../constants.ts";
import type { Instruction } from "../instruction.ts";
import { eventAuthorityPda } from "../pda.ts";
import { mintdexProgram } from "./program.ts";

/** True when `ix` is an authentic `emit_cpi!` self-invocation of `programId`. */
export function isAuthenticEventIx(ix: Instruction, programId: AddressLike): boolean {
  const program = toAddress(programId);
  return (
    ix.programId === program &&
    ix.accounts.length === 1 &&
    ix.accounts[0].address === eventAuthorityPda(program) &&
    ix.data.length >= 16 &&
    bytesEqual(ix.data.subarray(0, 8), ANCHOR_EVENT_IX_TAG)
  );
}

/** Decodes a MintDex event from an inner instruction; null when it is not an authentic MintDex event. */
export function decodeMintdexEvent(ix: Instruction): { name: string; data: Record<string, unknown> } | null {
  if (!isAuthenticEventIx(ix, MINTDEX_PROGRAM_ID)) return null;
  return mintdexProgram().decodeEvent(ix.data.subarray(8));
}
