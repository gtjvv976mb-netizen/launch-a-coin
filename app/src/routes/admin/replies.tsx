import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import { signInCreator } from "../../components/carddex/live/ownership";
import { useLiveWallet } from "../../components/carddex/live/wallet";
import { Button, buttonClass, Icon, PageFrame, PageHeader, TextLink } from "../../components/mintdex/ui";
import { getXReviewQueue, reviewXAnnouncement } from "../../lib/carddex/live/x-announce-api";
import type { XReviewItem } from "../../lib/carddex/live/x-announce.server";
import { getReplyFeed, getReplyHelperAccess, markReplyPost, suggestReplyText } from "../../lib/carddex/live/x-replies-api";
import { REPLY_LIMIT, replyIntentUrl, replyLength, xPostLink, type RankedXReplyPost } from "../../lib/carddex/live/x-replies";

/*
 * The private reply helper (/admin/replies): fresh Solana and pump.fun posts for the site owner to answer by hand.
 * Owner wallets only (CARDDEX_ADMIN_WALLETS, the site's own wallet session); anyone else, and every deployment without
 * the list, gets the site's "not found". Never in the nav or the sitemap, noindex, and robots.txt disallows /admin/.
 * The page only reads: "Reply on X" opens X's own reply composer in a new tab with the text prefilled, and the owner
 * presses Post there. Nothing is posted for them. Above the replies, opted-in coins wait for the owner's approval
 * before @launchacard announces them (the cron posts approved ones). Styles: styles/screens/replies.css.
 */
export const Route = createFileRoute("/admin/replies")({
  loader: async () => {
    const access = await getReplyHelperAccess();
    if (access.state === "hidden") throw notFound();
    return access;
  },
  head: () => ({ meta: [{ title: "Replies | Launch a Card" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ReplyHelper,
});

const LiveWalletButton = lazy(() => import("../../components/carddex/live/LiveWalletButton").then((m) => ({ default: m.LiveWalletButton })));

function ReplyHelper() {
  const access = Route.useLoaderData();
  return access.state === "admin" ? <Feed /> : <SignIn />;
}

/** Signed out: the same wallet sign-in as Launch, then the loader runs again. Shows nothing about the page. */
function SignIn() {
  const wallet = useLiveWallet();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function signIn() {
    if (!wallet.name || !wallet.address) return;
    setBusy(true); setError(null);
    try { await signInCreator(wallet.name, wallet.address); await router.invalidate(); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }
  return (
    <PageFrame className="mdx-page cdx-replies">
      <PageHeader title="Sign in" context="Sign in with your wallet to continue." />
      <div className="cdx-replies__signin">
        <Suspense fallback={null}>
          <LiveWalletButton compact quiet={!!wallet.address} />
        </Suspense>
        {wallet.address ? <Button size="sm" pending={busy} pendingLabel="Check your wallet" onClick={signIn}>Sign in</Button> : null}
        {error ? <p role="alert" className="cdx-replies__error">{error}</p> : null}
      </div>
    </PageFrame>
  );
}

const minutes = (ms: number) => Math.max(0, Math.ceil(ms / 60_000));
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function age(post: RankedXReplyPost) {
  return post.ageMinutes < 1 ? "just now" : post.ageMinutes < 60 ? `${post.ageMinutes} min ago` : `${Math.floor(post.ageMinutes / 60)} h ago`;
}

function Feed() {
  const queryClient = useQueryClient();
  const router = useRouter();
  // Only loading the page and the button search: X bills every read, so focus and reconnect never refetch.
  const feed = useQuery({ queryKey: ["x-replies"], queryFn: () => getReplyFeed(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  // A failed refresh keeps the last list on screen, with the error and a way to try again.
  const current = feed.data?.ok ? feed.data : null;
  const lastGood = useRef(current);
  if (current) lastGood.current = current;
  const data = lastGood.current;
  const error = feed.data && !feed.data.ok ? feed.data.error : feed.isError ? "The posts could not be loaded." : null;
  const waitMs = data?.nextCheckAt ? data.nextCheckAt - now : 0;
  const readsLeft = data ? Math.max(0, data.reads.max - data.reads.used) : 0;
  const remove = (id: string) => {
    queryClient.setQueryData(["x-replies"], (old: typeof feed.data) => old?.ok ? { ...old, posts: old.posts.filter((p) => p.id !== id) } : old);
    if (lastGood.current) lastGood.current = { ...lastGood.current, posts: lastGood.current.posts.filter((p) => p.id !== id) };
  };
  // The session may have ended: the loader runs again (sign-in when signed out), then the list.
  const retry = async () => { await router.invalidate(); await feed.refetch(); };
  return (
    <PageFrame className="mdx-page cdx-replies">
      <PageHeader
        title="Replies"
        context="Fresh Solana and pump.fun posts. You write and post every reply yourself on X."
        wrapContext
        right={data?.searchConfigured ? (
          <Button size="sm" variant="outline" pending={feed.isFetching} pendingLabel="Checking" disabled={waitMs > 0 || readsLeft === 0} onClick={() => feed.refetch()}>
            {waitMs > 0 ? `Next check in ${minutes(waitMs)} min` : data.reads.max <= 0 ? "Searching is off" : readsLeft === 0 ? "No searches left this hour" : "Check for new posts"}
          </Button>
        ) : null}
      />
      {error ? (
        <div className="cdx-replies__retry">
          <p role="alert" className="cdx-replies__error">{error}</p>
          <Button size="sm" variant="outline" pending={feed.isFetching} pendingLabel="Trying" onClick={retry}>Try again</Button>
        </div>
      ) : null}
      {data ? <Announcements /> : null}
      {data ? (
        <>
          <p className="cdx-replies__budget">
            Searches left this hour: <span className="num">{readsLeft}</span> of <span className="num">{data.reads.max}</span>
            {data.suggestConfigured ? <> · Suggestions left: <span className="num">{Math.max(0, data.suggestions.max - data.suggestions.used)}</span></> : null}
            {data.fetchedAt ? <> · Checked {minutes(now - data.fetchedAt) <= 1 ? "just now" : `${minutes(now - data.fetchedAt)} min ago`}</> : null}
          </p>
          {data.notice ? <p role="status" className="cdx-replies__notice">{data.notice}</p> : null}
          {!data.searchConfigured ? <Setup /> : data.posts.length ? (
            <ol className="cdx-replies__list">
              {data.posts.map((post) => <li key={post.id}><ReplyCard post={post} canSuggest={data.suggestConfigured} onDone={remove} /></li>)}
            </ol>
          ) : <p className="cdx-replies__empty">{data.fetchedAt ? "No new posts to answer right now." : "No search has run yet."}</p>}
        </>
      ) : feed.isPending ? <p className="cdx-replies__empty">Loading posts…</p> : null}
    </PageFrame>
  );
}

function Setup() {
  return (
    <section className="cdx-replies__setup" aria-labelledby="replies-setup">
      <h2 id="replies-setup" className="mdx-h2">Search is not set up</h2>
      <p>Add the X app's bearer token as the Worker secret <code>X_BEARER_TOKEN</code> (README, "Reply helper"). It only reads: X bills each post a search returns, so searches are capped per hour.</p>
      <p>Optional: an Anthropic API key as <code>ANTHROPIC_API_KEY</code> adds a suggested reply you can edit.</p>
    </section>
  );
}

function ReplyCard({ post, canSuggest, onDone }: { post: RankedXReplyPost; canSuggest: boolean; onDone: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"suggest" | "done" | "hidden" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const length = replyLength(text);
  const tooLong = length > REPLY_LIMIT;
  const field = `reply-${post.id}`;
  async function suggest() {
    setBusy("suggest"); setMessage(null);
    const result = await suggestReplyText({ data: { tweetId: post.id } }).catch(() => ({ ok: false as const, error: "Suggestions could not be reached." }));
    setBusy(null);
    if (!result.ok) return setMessage(result.error);
    if (result.suggestion) setText(result.suggestion);
    else setMessage("No suggestion for this post. Write your own or hide it.");
  }
  async function mark(markAs: "done" | "hidden") {
    setBusy(markAs); setMessage(null);
    const result = await markReplyPost({ data: { tweetId: post.id, mark: markAs } }).catch(() => ({ ok: false as const, error: "Could not save. Try again." }));
    setBusy(null);
    if (!result.ok) return setMessage(result.error);
    onDone(post.id);
  }
  return (
    <article className="cdx-replies__post" aria-labelledby={`${field}-author`}>
      <header className="cdx-replies__author">
        <span id={`${field}-author`}><strong>{post.name}</strong> <span className="cdx-replies__muted">@{post.username}</span></span>
        <span className="cdx-replies__muted">
          <span className="num">{compact.format(post.followers)}</span> followers · {age(post)}{post.fresh === "new" ? <span className="cdx-replies__new"> · New</span> : null}
        </span>
      </header>
      <p className="cdx-replies__text">{post.text}</p>
      <p className="cdx-replies__muted">
        <span className="num">{post.likes}</span> likes · <span className="num">{post.replies}</span> replies · <span className="num">{post.reposts}</span> reposts ·{" "}
        <TextLink href={xPostLink(post)} target="_blank">Open post<Icon name="external" size={12} /></TextLink>
      </p>
      <label htmlFor={field} className="mdx-label">Your reply</label>
      <textarea id={field} rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${field}-count`} className="mdx-input cdx-replies__box" />
      <p id={`${field}-count`} className={tooLong ? "cdx-replies__count cdx-replies__count--over" : "cdx-replies__count"}>
        <span className="num">{length}</span>/<span className="num">{REPLY_LIMIT}</span>
      </p>
      {message ? <p role="status" className="cdx-replies__notice">{message}</p> : null}
      <div className="cdx-replies__actions">
        {canSuggest ? <Button size="sm" variant="outline" pending={busy === "suggest"} pendingLabel="Drafting" disabled={!!busy} onClick={suggest}>Suggest a reply</Button> : null}
        {text.trim() && !tooLong ? (
          <a className={buttonClass({ size: "sm" })} href={replyIntentUrl(post.id, text.trim())} target="_blank" rel="noopener noreferrer">Reply on X</a>
        ) : (
          <Button size="sm" disabled onBlocked={() => setMessage(tooLong ? "Shorten the reply to fit X." : "Write a reply first.")}>Reply on X</Button>
        )}
        <Button size="sm" variant="ghost" pending={busy === "done"} disabled={!!busy} onClick={() => mark("done")}>Done</Button>
        <Button size="sm" variant="ghost" pending={busy === "hidden"} disabled={!!busy} onClick={() => mark("hidden")}>Hide</Button>
      </div>
    </article>
  );
}

/**
 * Coins whose creators asked for an announcement, waiting for the owner: the exact text and the card image that would
 * be posted. Approve queues it for the cron (still within the daily cap and gap); Skip means it is never posted.
 * Hidden while nothing waits.
 */
function Announcements() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ["x-review"], queryFn: () => getXReviewQueue(), staleTime: 60_000, retry: false });
  const items = queue.data?.ok ? queue.data.items : [];
  if (queue.data && !queue.data.ok) return <p role="alert" className="cdx-replies__error">{queue.data.error}</p>;
  if (!items.length) return null;
  const remove = (id: string) => queryClient.setQueryData(["x-review"], (old: typeof queue.data) => old?.ok ? { ...old, items: old.items.filter((item) => item.intentId !== id) } : old);
  return (
    <section className="cdx-replies__review" aria-labelledby="replies-review">
      <h2 id="replies-review" className="mdx-h2">Announcements to approve</h2>
      <p className="cdx-replies__muted">Each is posted once from @launchacard after you approve it. Check the name and the card image first.</p>
      <ol className="cdx-replies__list">
        {items.map((item) => <li key={item.intentId}><ReviewCard item={item} onDone={remove} /></li>)}
      </ol>
    </section>
  );
}

function ReviewCard({ item, onDone }: { item: XReviewItem; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState<"approve" | "skip" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const field = `review-${item.intentId}`;
  async function decide(decision: "approve" | "skip") {
    setBusy(decision); setMessage(null);
    const result = await reviewXAnnouncement({ data: { intentId: item.intentId, decision } }).catch(() => ({ ok: false as const, error: "Could not save. Try again." }));
    setBusy(null);
    if (!result.ok) return setMessage(result.error);
    onDone(item.intentId);
  }
  return (
    <article className="cdx-replies__post" aria-labelledby={`${field}-name`}>
      <header className="cdx-replies__author">
        <span id={`${field}-name`}><strong>{item.name || "Unnamed coin"}</strong> <span className="cdx-replies__muted">{item.symbol}</span></span>
        <TextLink href={`/coin/${item.tokenMint}`} target="_blank">Coin page<Icon name="external" size={12} /></TextLink>
      </header>
      <div className="cdx-replies__preview">
        {item.imagePath ? <img src={item.imagePath} alt={`Card image for ${item.name || "this coin"}`} width={126} height={176} loading="lazy" decoding="async" className="cdx-replies__card" /> : <p className="cdx-replies__muted">No card image: posted as text.</p>}
        {item.text ? <p className="cdx-replies__text">{item.text}</p> : <p className="cdx-replies__error">{item.reason}</p>}
      </div>
      {message ? <p role="status" className="cdx-replies__notice">{message}</p> : null}
      <div className="cdx-replies__actions">
        {item.text ? <Button size="sm" pending={busy === "approve"} pendingLabel="Approving" disabled={!!busy} onClick={() => decide("approve")}>Approve</Button> : null}
        <Button size="sm" variant="ghost" pending={busy === "skip"} disabled={!!busy} onClick={() => decide("skip")}>Skip</Button>
      </div>
    </article>
  );
}
