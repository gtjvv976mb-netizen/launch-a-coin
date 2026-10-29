import { createLiveSignInChallenge, createLiveWalletChallenge, verifyLiveSignIn, verifyLiveWallet, type LiveResult } from "../../../lib/carddex/live/api";
import { proveOwnership } from "./launch-flow";
import { connectLiveWallet, signInLiveWallet, signLiveMessage, walletSupportsSignIn, whileConnecting } from "./wallet";

function unwrap<T extends object>(result: LiveResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result;
}
/**
 * proveOwnership wired to this site's server functions and the chosen Wallet Standard wallet: one solana:signIn
 * prompt where the wallet has it, else the ownership message (after connect when `address` is null).
 */
export function signInCreator(walletName: string, address: string | null) {
  return proveOwnership({
    address, canSignIn: walletSupportsSignIn(walletName), origin: window.location.origin,
    signInChallenge: async () => unwrap(await createLiveSignInChallenge()),
    verifySignIn: async proof => { unwrap(await verifyLiveSignIn({ data: proof })); },
    messageChallenge: async wallet => unwrap(await createLiveWalletChallenge({ data: { wallet } })),
    verifyMessage: async proof => { unwrap(await verifyLiveWallet({ data: proof })); },
    signIn: input => signInLiveWallet(walletName, input),
    connect: () => connectLiveWallet(walletName),
    signMessage: (message, wallet) => signLiveMessage(message, wallet),
  });
}
/**
 * The wallet list's connect after Launch was pressed with no wallet connected: a wallet with solana:signIn connects and
 * proves its owner in one prompt; any other wallet only connects (its ownership message follows in the launch).
 */
export async function connectForLaunch(walletName: string): Promise<string> {
  if (!walletSupportsSignIn(walletName)) return connectLiveWallet(walletName);
  return whileConnecting(walletName, async () => (await signInCreator(walletName, null)).address);
}
