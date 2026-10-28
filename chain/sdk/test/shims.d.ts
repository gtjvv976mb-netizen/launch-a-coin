// bs58 (4.x, pulled in by web3.js) ships no types; the tests only use encode().
declare module "bs58" {
  const bs58: { encode(bytes: Uint8Array | number[]): string; decode(text: string): Uint8Array };
  export default bs58;
}
