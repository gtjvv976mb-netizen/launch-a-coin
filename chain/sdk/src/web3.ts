// Optional adapters for @solana/web3.js v1 (node scripts, the chain Worker). Import from
// "@mintdex/chain-sdk/web3"; the main entry never imports web3.js, so the browser verifier stays small.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import type { AccountData } from "./accounts/types.ts";
import type { Instruction } from "./instruction.ts";

export function toWeb3Instruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((m) => ({
      pubkey: new PublicKey(m.address),
      isSigner: m.isSigner,
      isWritable: m.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

export const toWeb3Instructions = (ixs: Instruction[]): TransactionInstruction[] => ixs.map(toWeb3Instruction);

export function fromWeb3Instruction(ix: TransactionInstruction): Instruction {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Uint8Array.from(ix.data),
  };
}

export function fromWeb3AccountInfo(
  address: PublicKey | string,
  info: AccountInfo<Buffer>
): AccountData & { address: string } {
  return {
    address: typeof address === "string" ? address : address.toBase58(),
    owner: info.owner.toBase58(),
    lamports: BigInt(info.lamports),
    data: Uint8Array.from(info.data),
  };
}
