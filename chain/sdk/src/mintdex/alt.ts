// The MintDex address lookup table contents (card-program-v2 §10.1: 38 entries, ALTs A and B identical).
// Used by the ALT creation script, by the Worker when it compiles v0 messages, and by the browser, which can
// check that the ALT it fetched holds exactly these addresses before trusting it for verification.
import { toAddress } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  MAYHEM_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PYTH_SOL_USD_PRICE_ACCOUNT,
  SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "../constants.ts";
import {
  ammEventAuthority,
  configPda,
  globalVolumeAccumulatorPda,
  mayhemGlobalParamsPda,
  mayhemSolVaultPda,
  mintdexEventAuthority,
  pumpEventAuthority,
  pumpFeeConfigPda,
  pumpGlobalPda,
  pumpMintAuthorityPda,
} from "../pda.ts";

export interface MintdexAltParams {
  /** `config.treasury` */
  treasury: AddressLike;
  /** pump `Global.fee_recipient` + `fee_recipients` (8); default: devnet */
  pumpFeeRecipients?: readonly AddressLike[];
  /** pump `Global.buyback_fee_recipients` (8); default: devnet */
  pumpBuybackFeeRecipients?: readonly AddressLike[];
  pythPriceAccount?: AddressLike;
}

/** The 38 ALT addresses in a fixed order. Top-level program ids still compile as static keys. */
export function mintdexAltAddresses(p: MintdexAltParams): Address[] {
  const list: AddressLike[] = [
    pumpGlobalPda(),
    pumpMintAuthorityPda(),
    pumpEventAuthority(),
    globalVolumeAccumulatorPda(),
    pumpFeeConfigPda(),
    PUMP_FEES_PROGRAM_ID,
    MAYHEM_PROGRAM_ID,
    mayhemGlobalParamsPda(),
    mayhemSolVaultPda(),
    ...(p.pumpFeeRecipients ?? DEVNET_PUMP_FEE_RECIPIENTS),
    ...(p.pumpBuybackFeeRecipients ?? DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS),
    SYSTEM_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    WSOL_MINT,
    PUMP_PROGRAM_ID,
    PAMM_PROGRAM_ID,
    ammEventAuthority(),
    configPda(),
    p.treasury,
    mintdexEventAuthority(),
    SYSVAR_INSTRUCTIONS_ID,
    p.pythPriceAccount ?? PYTH_SOL_USD_PRICE_ACCOUNT,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ];
  const out = list.map(toAddress);
  if (new Set(out).size !== out.length) throw new Error("duplicate ALT address");
  return out;
}

/** True when a fetched ALT holds exactly the expected MintDex addresses (extensions appended at the end are allowed). */
export function isMintdexAlt(fetched: readonly AddressLike[], p: MintdexAltParams): boolean {
  const want = mintdexAltAddresses(p);
  return fetched.length >= want.length && want.every((a, i) => toAddress(fetched[i]) === a);
}
