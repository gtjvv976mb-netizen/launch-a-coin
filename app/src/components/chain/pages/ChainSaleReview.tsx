/**
 * The step before a card changes hands on devnet (backlog P0-8, card-program-v2 §7.7 and §7.8): accepting a bid
 * shows the bid, the protocol fee, the resale royalty (none when the launcher sells), the card fees the sale
 * sweeps to the seller and what lands in the wallet; buying shows the price, the buyer's own bid coming back and
 * the wallet after. The wallet's own prompt follows the confirm button; the flow's step shows on the button, and
 * a fee floor that moved while signing (FeesBelowFloor) shows as a note while the wallet asks again.
 *
 * Owner: app:pages. Display only: the amounts the transaction enforces come from the client flows (accept with
 * min_amount = the bid shown, buy now with expected_price = the price shown).
 */
import { useState, type ReactNode } from "react";

import { CHAIN_COPY, FLOW, pct } from "../../../lib/mintdex/copy";
import { sol } from "../../../lib/mintdex/format";
import { Button, Modal, Num, type Feedback } from "../../mintdex/ui";
import { FaucetLinks } from "./tx";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type ChainReview =
  | {
      kind: "accept";
      coin: { mint: string; name: string; ticker: string };
      bid: { bidder: string; amount: number; handle: string };
      /** The seller launched this coin: no resale royalty. */
      launcherIsSeller: boolean;
      /** Card fees the sale sweeps to the seller (fees.netToHolder at the last read). */
      feesToSeller: number;
      protocolBps: number;
      royaltyBps: number;
    }
  | {
      kind: "buy";
      coin: { mint: string; name: string; ticker: string };
      price: number;
      /** The buyer's own open bid on this card: buy now cancels it first and returns it. */
      myBid: number | null;
      balance: number | null;
    };

function Row({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cx("h-7 text-[14px] leading-7", strong && "font-semibold")}>
      <dt className={strong ? "text-ink" : "text-slate"}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Lamports({ v, sign, strong = false, digits = 3 }: { v: number; sign?: "+" | "-"; strong?: boolean; digits?: number }) {
  return (
    <Num size={strong ? "md" : "sm"} unit="SOL">
      {sign && v > 0 ? sign : ""}
      {sol(v, digits)}
    </Num>
  );
}

/** What the seller ends up with (card-program-v2 §7.7): price minus fees, plus the card fees swept at the sale. */
export function chainProceeds(r: Extract<ChainReview, { kind: "accept" }>) {
  const protocol = Math.floor((r.bid.amount * r.protocolBps) / 10_000);
  const royalty = r.launcherIsSeller ? 0 : Math.floor((r.bid.amount * r.royaltyBps) / 10_000);
  return { protocol, royalty, receive: r.bid.amount - protocol - royalty + r.feesToSeller };
}

export function ChainSaleReview({
  review,
  pending,
  pendingLabel,
  feedback,
  error,
  note,
  onConfirm,
  onClose,
}: {
  review: ChainReview | null;
  pending: boolean;
  pendingLabel: ReactNode;
  feedback?: Feedback;
  error: string | null;
  note: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Keep the last review while the dialog animates out.
  const [shown, setShown] = useState<ChainReview | null>(review);
  if (review && review !== shown) setShown(review);
  const r = review ?? shown;
  let title = "";
  let body: ReactNode = null;
  let confirm: ReactNode = "";
  let blocked: ReactNode = null;
  if (r?.kind === "accept") {
    const p = chainProceeds(r);
    title = `Sell the ${r.coin.name} card?`;
    confirm = `Sell card for ${sol(p.receive, 3)} SOL`;
    body = (
      <>
        <dl className="mdx-leaders">
          <Row label={`Bid from ${r.bid.handle}`}>
            <Lamports v={r.bid.amount} />
          </Row>
          <Row label={`Protocol fee ${pct(r.protocolBps)}`}>
            <Lamports v={p.protocol} sign="-" />
          </Row>
          <Row label={r.launcherIsSeller ? "Resale royalty (you launched it)" : `Resale royalty ${pct(r.royaltyBps)} to the launcher`}>
            <Lamports v={p.royalty} sign="-" />
          </Row>
          <Row label="Card fees, swept to you">
            <Lamports v={r.feesToSeller} sign="+" />
          </Row>
        </dl>
        <dl className="mdx-leaders mt-2 border-t border-hairline pt-2">
          <Row label="You receive" strong>
            <Lamports v={p.receive} strong />
          </Row>
        </dl>
        <p className="mt-3 text-pretty text-[13px] leading-[1.45] text-slate">
          The card and its future card fees go to {r.bid.handle}. If more card fees come in before you sign, the
          sale pays you those too. Network fee not included.
        </p>
      </>
    );
  } else if (r?.kind === "buy") {
    const refund = r.myBid ?? 0;
    const after = r.balance != null ? r.balance + refund - r.price : null;
    if (after != null && after < 0)
      blocked = (
        <>
          {FLOW.notEnough} to buy this card. <FaucetLinks lead={false} />
        </>
      );
    title = `Buy the ${r.coin.name} card?`;
    confirm = `Buy card for ${sol(r.price, 3)} SOL`;
    body = (
      <>
        <dl className="mdx-leaders">
          <Row label="Buy now price">
            <Lamports v={r.price} />
          </Row>
          {refund > 0 ? (
            <Row label="Your open bid is returned">
              <Lamports v={refund} sign="+" />
            </Row>
          ) : null}
        </dl>
        {after != null ? (
          <dl className="mdx-leaders mt-2 border-t border-hairline pt-2">
            <Row label="Wallet after" strong>
              <Lamports v={Math.max(0, after)} strong />
            </Row>
          </dl>
        ) : null}
        <p className="mt-3 text-pretty text-[13px] leading-[1.45] text-slate">
          The card lands in your wallet and its card fees are yours from then on. {CHAIN_COPY.noValue}
        </p>
      </>
    );
  }

  const message = blocked ?? error ?? null;
  return (
    <Modal
      open={!!review}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
    >
      {body}
      {note && !error ? (
        <p role="status" className="mt-3 text-[13px] font-medium leading-[1.45] text-ink">
          {note}
        </p>
      ) : null}
      <p role="alert" className={cx("text-[13px] leading-[1.45] text-down", message ? "mt-3" : "sr-only")}>
        {message}
      </p>
      <div className="mdx-sheet-foot mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          pending={pending}
          pendingLabel={pendingLabel}
          disabled={!!blocked}
          feedback={feedback}
          successLabel={r?.kind === "accept" ? "Sold" : "Card bought"}
          onClick={onConfirm}
        >
          {confirm}
        </Button>
      </div>
    </Modal>
  );
}
