import type { Address } from "../address.ts";

/** The account fields every reader needs; build it from any RPC client's account info. */
export interface AccountData {
  address?: Address;
  owner: Address;
  lamports: bigint | number;
  data: Uint8Array;
}

/** Thrown when an account fails a check that the MintDex program also performs on chain. */
export class ChainCheckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "ChainCheckError";
  }
}
