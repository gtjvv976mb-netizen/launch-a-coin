import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { claimFaucet, signOut } from "../../lib/mintdex/api";
import { FAUCET_AMOUNT } from "../../lib/mintdex/constants";
import { FLOW, MODE_COPY } from "../../lib/mintdex/copy";
import { sol } from "../../lib/mintdex/format";
import { IS_SIM } from "../../lib/mintdex/mode";
import { writeViewport } from "../../lib/mintdex/viewport";
import { setMe } from "./hooks";
import { useMe, useSessionUi } from "./session";
import { ConfirmDialog } from "./trust";
import { motionLevel, onMotionLevel } from "./card3d/motion3d";
import { Avatar, Button, CalmSwitch, GenIcon, Hallmark, isDialogOpen, isTypingTarget, Num, useToast, type GenIconName } from "./ui";

type NavPath = "/" | "/discover" | "/launch" | "/levels" | "/portfolio";
const NAV: Array<{ to: NavPath; label: string; icon: GenIconName }> = [
  { to: "/", label: "The gallery", icon: "cards" },
  { to: "/discover", label: "Discover", icon: "volume" },
  { to: "/levels", label: "Design archive", icon: "levelup" },
  { to: "/launch", label: "Create a card", icon: "launch" },
  { to: "/portfolio", label: "My collection", icon: "deed" },
];
function activePath(path: string, to: NavPath) {
  return to === "/" ? path === "/" : path.startsWith(to) || to === "/discover" && path.startsWith("/coin/");
}

function Account() {
  const me = useMe();
  const { openEnter } = useSessionUi();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"faucet" | "leave" | null>(null);
  if (!me) return <Button size="sm" onClick={() => openEnter()}>Enter the demo <span aria-hidden>↗</span></Button>;
  async function faucet() {
    setBusy("faucet");
    try {
      const result = await claimFaucet();
      if (result.ok) { setMe(qc, result.me); void qc.invalidateQueries({ queryKey: ["portfolio"] }); toast("ok", `Added ${sol(FAUCET_AMOUNT, 0)} test SOL.`); setOpen(false); }
      else toast("err", result.error);
    } catch { toast("err", FLOW.connection); }
    finally { setBusy(null); }
  }
  async function leave() {
    setBusy("leave");
    try {
      const result = await signOut();
      if (!result.ok) { toast("err", FLOW.connection); return; }
      qc.setQueryData(["me"], null);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      setConfirm(false); setOpen(false);
      toast("ok", "Your demo session has ended.");
    } catch { toast("err", FLOW.connection); }
    finally { setBusy(null); }
  }
  return <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button type="button" className="cdx-account-trigger flex min-h-11 items-center gap-2.5 rounded-full border border-hairline px-2 py-1.5 text-left transition-transform hover:-translate-y-0.5" aria-label={`Your collection, @${me.handle}`}><Avatar handle={me.handle} size={28} /><span className="hidden sm:block"><span className="block text-[11px] leading-4 text-slate">@{me.handle}</span><span className="num block text-[12px] font-medium leading-4">{sol(me.balance, 2)} test SOL</span></span><span aria-hidden className="pr-1 text-slate">⌄</span></button></Popover.Trigger>
      <Popover.Portal><Popover.Content align="end" sideOffset={12} className="mdx-menu z-50 w-60 rounded-panel border border-hairline bg-plinth p-2 shadow-float"><p className="px-3 py-2 text-[12px] leading-5 text-slate"><span className="block font-medium text-ink">@{me.handle}</span><span className="num">{sol(me.balance, 2)} test SOL</span></p><Link to="/portfolio" className="mdx-menu-item" onClick={() => setOpen(false)}>Open my collection</Link><button type="button" className="mdx-menu-item" onClick={() => void faucet()} disabled={!me.canFaucet || !!busy}>{busy === "faucet" ? "Adding test SOL…" : "Get test SOL"}</button><button type="button" className="mdx-menu-item text-slate" onClick={() => { setOpen(false); setConfirm(true); }}>Start a new session</button></Popover.Content></Popover.Portal>
    </Popover.Root>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Leave this demo account?" confirmLabel="Leave account" cancelLabel="Keep collecting" pending={busy === "leave"} pendingLabel="Leaving…" onConfirm={() => void leave()}><p>This browser is the only way back to @{me.handle}. Its tokens and cards stay with that handle. Start a new session only when you are ready to leave it.</p></ConfirmDialog>
  </>;
}

function Search() {
  const navigate = useNavigate();
  const path = useRouterState({ select: s => s.location.pathname });
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setExpanded(false); }, [path]);
  function submit(e: FormEvent) { e.preventDefault(); void navigate({ to: "/discover", search: { q: query.trim() || undefined } }); setExpanded(false); input.current?.blur(); }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isDialogOpen() && !isTypingTarget(e.target)) { e.preventDefault(); setExpanded(true); setTimeout(() => input.current?.focus(), 0); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <Popover.Root open={expanded} onOpenChange={setExpanded}><Popover.Trigger asChild><button type="button" aria-label="Search tokens" className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-track"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button></Popover.Trigger><Popover.Portal><Popover.Content align="end" sideOffset={12} collisionPadding={16} className="z-40 w-[min(340px,calc(100vw-32px))] rounded-panel border border-hairline bg-plinth p-3 shadow-float"><form onSubmit={submit} className="flex gap-2"><label className="sr-only" htmlFor="header-token-search">Search tokens</label><input ref={input} id="header-token-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a token…" className="mdx-input min-w-0 flex-1" /><Button type="submit" size="sm">Find</Button></form></Popover.Content></Popover.Portal></Popover.Root>;
}

/** Enhance visible content only; without JavaScript the complete page remains readable. */
function useScrollReveals(path: string) {
  const router = useRouter();
  useEffect(() => {
    if (!("IntersectionObserver" in window) || !("animate" in HTMLElement.prototype)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const seen = new WeakSet<Element>();
    const running = new Set<Animation>();
    let observer: IntersectionObserver | undefined;
    const permitted = () => !reduced.matches && motionLevel() === "full";
    const stop = () => {
      observer?.disconnect(); observer = undefined;
      for (const animation of running) animation.cancel();
      running.clear();
    };
    const observe = () => {
      if (!permitted()) { stop(); return; }
      if (!observer) observer = new IntersectionObserver(entries => {
        if (!permitted()) { stop(); return; }
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          const target = entry.target as HTMLElement;
          seen.add(target); observer?.unobserve(target);
          const rawDelay = getComputedStyle(target).getPropertyValue("--reveal-delay").trim();
          const amount = Number.parseFloat(rawDelay) || 0;
          const delay = Math.max(0, Math.min(1600, rawDelay.endsWith("s") && !rawDelay.endsWith("ms") ? amount * 1000 : amount));
          const animation = target.animate(
            [{ transform: "translate3d(0,24px,0)", opacity: 0 }, { transform: "translate3d(0,0,0)", opacity: 1 }],
            { duration: 700, delay, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" },
          );
          running.add(animation);
          void animation.finished.then(() => running.delete(animation), () => running.delete(animation));
        }
      }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });
      document.querySelectorAll<HTMLElement>("#content [data-reveal]").forEach(target => { if (!seen.has(target)) observer?.observe(target); });
    };
    observe();
    // A lazy route can finish after the shell's pathname changed.
    const offRendered = router.subscribe("onRendered", observe);
    const offMotion = onMotionLevel(observe);
    reduced.addEventListener("change", observe);
    return () => { stop(); offRendered(); offMotion(); reduced.removeEventListener("change", observe); };
  }, [path, router]);
}

/** A collector's folio: one continuous page beneath a quiet, sticky masthead. */
export function AppShell({ children }: { children: ReactNode; devnetSite?: boolean }) {
  const path = useRouterState({ select: s => s.location.pathname });
  const pending = useRouterState({ select: s => s.status === "pending" });
  // SSR can report a pending router while the hydrated client is already settled.
  const [showPending, setShowPending] = useState(false);
  useEffect(() => {
    if (!pending) { setShowPending(false); return; }
    const timer = window.setTimeout(() => setShowPending(true), 120);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useScrollReveals(path);
  const router = useRouter();
  const { openGuide } = useSessionUi();
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    writeViewport();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => { clearTimeout(timer); timer = setTimeout(writeViewport, 250); };
    window.addEventListener("resize", resize); return () => { clearTimeout(timer); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => router.subscribe("onRendered", e => {
    if (!e.pathChanged) return;
    requestAnimationFrame(() => {
      const main = document.getElementById("content");
      const heading = main?.querySelector<HTMLElement>("h1");
      if (heading && !isTypingTarget(document.activeElement)) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      setAnnouncement(document.title);
    });
  }), [router]);
  return (
    <div className="cdx-shell min-h-dvh bg-wall text-ink">
      <a href="#content" className="mdx-skip" onClick={e => { e.preventDefault(); document.getElementById("content")?.focus(); }}>Skip to content</a>
      <header className="cdx-site-header sticky top-0 z-30 border-b border-hairline bg-wall/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-7 lg:gap-8 lg:px-10">
          <Link to="/" aria-label="CardDex home" className="cdx-brand flex flex-none items-center gap-2.5"><span className="cdx-brand__seal"><Hallmark size={33} /></span><span className="font-title text-[24px] font-semibold tracking-[-.045em]">CardDex</span></Link>
          <nav aria-label="Main" className="cdx-site-nav hidden items-center gap-5 lg:flex xl:gap-8">{NAV.map((item,i) => <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/" }} className="cdx-nav-link relative py-7 text-[13px] font-medium transition-colors" data-active={activePath(path,item.to)} style={{ animationDelay: `${i*40}ms` }} aria-current={activePath(path,item.to)?"page":undefined}>{item.label}</Link>)}</nav>
          <div className="flex flex-none items-center gap-1 sm:gap-3"><Search /><div className="hidden xl:block"><CalmSwitch /></div><Account /></div>
        </div>
        {showPending ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-neon" /> : null}
      </header>
      {IS_SIM && <div className="cdx-demo-banner mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-[11px] tracking-[.015em] text-slate sm:px-7 lg:px-10"><p><span className="font-semibold text-ink">Local studio preview</span><span className="mx-2 opacity-40" aria-hidden>/</span>Simulated token launches, trades &amp; NFT cards. No real funds.</p><button type="button" onClick={openGuide} className="min-h-6 font-medium text-ink underline-offset-4 hover:underline">How it works ↗</button></div>}
      <main id="content" tabIndex={-1} aria-busy={showPending || undefined} className="cdx-site-main mx-auto min-h-[calc(100svh-220px)] max-w-[1600px] px-4 pb-12 pt-2 outline-none sm:px-7 lg:px-10 lg:pt-5">{children}</main>
      <footer className="cdx-site-foot mx-auto mb-20 flex max-w-[1600px] flex-wrap items-center justify-between gap-4 border-t border-hairline px-4 py-6 text-[11px] text-slate sm:px-7 lg:mb-0 lg:px-10"><p>CardDex · A new frame for your token.</p><div className="flex flex-wrap items-center gap-5"><button type="button" onClick={openGuide} className="min-h-6 hover:text-ink">How it works</button><Link to="/legal" className="min-h-6 hover:text-ink">Terms &amp; privacy</Link><span className="xl:hidden"><CalmSwitch /></span></div></footer>
      <nav aria-label="Mobile navigation" className="cdx-mobile-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-wall/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">{NAV.map(item => <Link key={item.to} to={item.to} className="flex min-h-[66px] min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium" data-active={activePath(path,item.to)} aria-current={activePath(path,item.to)?"page":undefined}><GenIcon name={item.icon} size={18} /><span>{item.to === "/" ? "Gallery" : item.to === "/levels" ? "Designs" : item.to === "/launch" ? "Create" : item.to === "/portfolio" ? "Collection" : item.label}</span></Link>)}</nav>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}
