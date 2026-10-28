// Which MintDex IDL the SDK uses. Order: setMintdexIdl() at runtime > idl.generated.ts (synced from
// `anchor build`) > the hand-written placeholder in spec-idl.ts.
import { IdlProgram } from "../idl.ts";
import type { Idl } from "../idl.ts";
import { MINTDEX_PROGRAM_ID } from "../constants.ts";
import { MINTDEX_IDL_GENERATED } from "./idl.generated.ts";
import { MINTDEX_SPEC_IDL } from "./spec-idl.ts";

let current = new IdlProgram(MINTDEX_IDL_GENERATED ?? MINTDEX_SPEC_IDL, MINTDEX_PROGRAM_ID);
let placeholder = MINTDEX_IDL_GENERATED === null;

/** The active MintDex program coder. */
export const mintdexProgram = (): IdlProgram => current;

/** True while the SDK still runs on the placeholder IDL (no program build synced yet). */
export const mintdexIdlIsPlaceholder = (): boolean => placeholder;

/**
 * Swaps in a MintDex IDL at runtime (for example the JSON of a freshly built program, or a test double).
 * The IDL must describe the v2 card program (it must contain `register_card`).
 */
export function setMintdexIdl(idl: Idl | null): void {
  if (idl === null) {
    current = new IdlProgram(MINTDEX_IDL_GENERATED ?? MINTDEX_SPEC_IDL, MINTDEX_PROGRAM_ID);
    placeholder = MINTDEX_IDL_GENERATED === null;
    return;
  }
  if (!idl.instructions.some((i) => i.name === "register_card")) {
    throw new Error("not a MintDex v2 IDL (no register_card instruction)");
  }
  current = new IdlProgram(idl, MINTDEX_PROGRAM_ID);
  placeholder = false;
}

export { MINTDEX_SPEC_IDL };
