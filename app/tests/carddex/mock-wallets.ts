import { ed25519 } from "@noble/curves/ed25519.js";
import { getWallets } from "@wallet-standard/app";
import { base58, parseFeeTransaction, parseLiveTransaction } from "../../src/components/carddex/live/transaction";

/**
 * Stand-in Wallet Standard wallets, registered in the real registry the page reads (@wallet-standard/app). Each keeps a
 * prompt log: one entry per approval a person would see. Keys are synthetic and unfunded; nothing has a network.
 */
export type Prompt = "connect" | "signIn" | "signMessage" | "signTransaction";
export type MockWalletOptions = {
  name: string; seed: Uint8Array;
  /** Offer solana:signIn. `text` rewrites the SIWS text the wallet composes (a wallet that changes it). */
  signIn?: boolean; signInText?: (text: string) => string; signInError?: unknown;
  /** A multi-input signTransaction: one prompt for all ("one"), one per transaction ("each"), or only the first back. */
  batch?: "one" | "each" | "first-only";
  /** Prompts the person refuses (code 4001, as Phantom and others report it). */
  reject?: Prompt[];
  /** Changes each transaction before signing it (by its position in the request). */
  change?: (bytes: Uint8Array, index: number) => Uint8Array;
};
const REJECTED = () => Object.assign(new Error("User rejected the request."), { code: 4001 });
/** createSignInMessageText from @solana/wallet-standard-util, written out independently of the site's own builder. */
function signInText(input: Record<string, unknown>, address: string) {
  let message = `${input.domain} wants you to sign in with your Solana account:\n${address}`;
  if (input.statement) message += `\n\n${input.statement}`;
  const fields: string[] = [];
  for (const [key, label] of [["uri", "URI"], ["version", "Version"], ["chainId", "Chain ID"], ["nonce", "Nonce"], ["issuedAt", "Issued At"], ["expirationTime", "Expiration Time"], ["notBefore", "Not Before"], ["requestId", "Request ID"]] as const) {
    if (input[key]) fields.push(`${label}: ${input[key]}`);
  }
  if (Array.isArray(input.resources)) { fields.push("Resources:"); for (const resource of input.resources) fields.push(`- ${resource}`); }
  return fields.length ? `${message}\n\n${fields.join("\n")}` : message;
}
export function mockWallet(options: MockWalletOptions) {
  const publicKey = ed25519.getPublicKey(options.seed), address = base58(publicKey);
  const prompts: Prompt[] = [], shown: Uint8Array[][] = [], signInInputs: Record<string, unknown>[] = [];
  const features = ["solana:signTransaction", "solana:signMessage", ...(options.signIn ? ["solana:signIn"] : [])] as const;
  const account = { address, publicKey, chains: ["solana:mainnet"] as const, features };
  let accounts: (typeof account)[] = [];
  const ask = (prompt: Prompt) => { prompts.push(prompt); if (options.reject?.includes(prompt)) throw REJECTED(); };
  const sign = (bytes: Uint8Array, index: number) => {
    // A creator fee split has one signature slot (the creator's); a coin or card has two.
    const out = options.change ? options.change(bytes.slice(), index) : bytes.slice(), wire = out[0] === 1 ? parseFeeTransaction(out) : parseLiveTransaction(out);
    out.set(ed25519.sign(wire.message, options.seed), wire.signatureOffset);
    return { signedTransaction: out };
  };
  const wallet = {
    version: "1.0.0" as const, name: options.name, icon: "data:image/svg+xml;base64,PHN2Zy8+" as const, chains: ["solana:mainnet"] as const,
    get accounts() { return accounts; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { ask("connect"); accounts = [account]; return { accounts }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { accounts = []; } },
      "standard:events": { version: "1.0.0", on: () => () => undefined },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
        shown.push(inputs.map(input => input.transaction.slice()));
        if (options.batch === "each") return inputs.map((input, index) => { ask("signTransaction"); return sign(input.transaction, index); });
        ask("signTransaction");
        const outputs = inputs.map((input, index) => sign(input.transaction, index));
        return options.batch === "first-only" ? outputs.slice(0, 1) : outputs;
      } },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: { message: Uint8Array }[]) => {
        ask("signMessage");
        return inputs.map(input => ({ signedMessage: input.message, signature: ed25519.sign(input.message, options.seed) }));
      } },
      ...(options.signIn ? { "solana:signIn": { version: "1.0.0", signIn: async (...inputs: Record<string, unknown>[]) => {
        signInInputs.push(...inputs); ask("signIn");
        if (options.signInError) throw options.signInError;
        accounts = [account];
        return inputs.map(input => {
          const text = signInText(input, address), signed = new TextEncoder().encode(options.signInText ? options.signInText(text) : text);
          return { account, signedMessage: signed, signature: ed25519.sign(signed, options.seed) };
        });
      } } } : {}),
    },
  };
  const unregister = getWallets().register(wallet as never);
  return { wallet, address, prompts, shown, signInInputs, unregister };
}
