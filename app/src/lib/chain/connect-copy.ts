// The few wallet words the main chunk needs (the Connect buttons in the rail, the phone header and the guide).
// Everything else the wallet surfaces say is in wallet-copy.ts and tx-copy.ts, which only lazy chunks import (C10).
// Plain English, no em dashes, en dashes or middle dots (app/tests/chain/copy.test.ts). Owner: app:wallet.

export const CONNECT_COPY = {
  connect: "Connect wallet",
  connectShort: "Connect",
  connecting: "Connecting...",
} as const;
