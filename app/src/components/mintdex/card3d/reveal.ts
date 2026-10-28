/**
 * The reveals (spec 6.3), a lazy chunk loaded on first use (or when the page is idle after a hand card mounts):
 * Ascend and Ascend short (M12, M13), the mint reveal (M14) and claim (M15). Springs move the body; the burst
 * behind the card is WAAPI on transform and opacity; sparks and confetti go to the lazy fx canvas.
 */
import { burst, chargeGlow, confetti, sparkCount, sparks } from "./burst";
import { sideFromAngle } from "./light";
import { Engine, motionLevel, SPRINGS, type Body } from "./motion3d";
import { decodeSlot, type SceneCtl } from "./scene";
import type { TierLight } from "./types";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function begin(ctl: SceneCtl, b: Body, token: "ascending" | "turning") {
  ctl.busy = true;
  b.moments++;
  Engine.moments++;
  b.setToken(token, true);
}
function end(ctl: SceneCtl, b: Body, token: "ascending" | "turning") {
  b.moments = Math.max(0, b.moments - 1);
  Engine.moments = Math.max(0, Engine.moments - 1);
  b.setToken(token, false);
  b.flip.tune(SPRINGS.flip);
  b.lift.tune(SPRINGS.lift);
  ctl.busy = false;
}

/** Resolve when the body's flip, lift and scale settle (or after `cap` ms). */
function settled(b: Body, cap: number) {
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    b.watchers.add(() => {
      const done = (!b.flip.busy(0.4) && !b.lift.busy(0.4) && !b.sc.busy(0.002)) || performance.now() - t0 > cap;
      if (done) resolve();
      return done;
    });
    Engine.kick();
  });
}

/**
 * M12 Ascend (and M13 short): charge (0 to 200 ms: dip, scale .965, a radial glow gone by 380 ms), launch a full
 * turn with lift and scale, swap the face while the back faces the viewer (rel > 125 deg), burst as the new face
 * comes round (rel > 262 deg) with the holo flash, then land with one bounce. Resolves when settled.
 */
export async function ascend(ctl: SceneCtl, o: { key: string; tier: TierLight; short: boolean; onBurst: () => void }) {
  const b = ctl.ensureBody();
  if (!b || motionLevel() === "calm") {
    ctl.swapIn(o.key, true);
    o.onBurst();
    return;
  }
  begin(ctl, b, "ascending");
  ctl.mountBack();
  await decodeSlot(ctl.slot(o.key));
  const W = b.W;
  if (!o.short) {
    chargeGlow(ctl.scene, o.tier);
    b.lift.t = -10;
    b.sc.t = 0.965;
    Engine.kick();
    await wait(200);
  }
  const onBack = sideFromAngle(b.flip.t) === "back";
  const start = b.flip.x;
  const target = onBack ? Math.round(b.flip.t / 180) * 180 + 540 : Math.round(b.flip.t / 360) * 360 + 360;
  b.flip.tune(o.short ? SPRINGS.short : SPRINGS.ascend);
  b.flip.t = target;
  // Lift and swell stay inside the stage's headroom (QA: on Designs the climbing card grew over the page subtitle
  // and down to its caption).
  b.lift.t = W * (o.short ? 0.12 : 0.22);
  b.sc.t = o.short ? 1.025 : 1.05;
  ctl.faceUp();
  let swapped = false;
  if (onBack) {
    swapped = true;
    ctl.swapIn(o.key, false);
  }
  await new Promise<void>((done) => {
    b.watchers.add((f) => {
      if (!swapped && f - start > 125) {
        swapped = true;
        ctl.swapIn(o.key, false);
      }
      if (target - f < 98) {
        if (!swapped) ctl.swapIn(o.key, false);
        burst(ctl.scene, o.tier, { rays: !o.short, glow: !o.short });
        sparks(ctl.scene, o.tier, sparkCount(o.tier.finish, o.short));
        if (!o.short) ctl.flash();
        o.onBurst();
        done();
        return true;
      }
      return false;
    });
    Engine.kick();
  });
  await wait(o.short ? 60 : 180);
  b.lift.tune(SPRINGS.landing);
  b.lift.t = 0;
  b.sc.t = 1;
  await settled(b, 1100);
  end(ctl, b, "ascending");
}

/**
 * M14 the mint reveal: the card starts face down (primed on mount), turns 180 to 720 after the dialog's entrance,
 * bursts as the face comes round the last time and throws confetti from both bottom corners.
 */
export async function mintReveal(ctl: SceneCtl, tier: TierLight, onBurst: () => void) {
  const b = ctl.body;
  if (!b || motionLevel() === "calm") {
    onBurst();
    return;
  }
  begin(ctl, b, "ascending");
  await wait(300);
  if (ctl.destroyed) return;
  const W = b.W;
  b.flip.tune(SPRINGS.ascend);
  b.flip.t = 720;
  b.lift.t = W * 0.28;
  b.sc.t = 1.06;
  Engine.kick();
  await new Promise<void>((done) => {
    b.watchers.add((f) => {
      if (720 - f < 98) {
        burst(ctl.scene, tier);
        sparks(ctl.scene, tier, sparkCount(tier.finish, false));
        confetti(tier);
        ctl.flash();
        onBurst();
        done();
        return true;
      }
      return false;
    });
  });
  await wait(180);
  b.lift.tune(SPRINGS.landing);
  b.lift.t = 0;
  b.sc.t = 1;
  await settled(b, 1200);
  // Back to a small angle so later turns count from zero.
  b.flip.snap(0);
  end(ctl, b, "ascending");
}

/** M15 claim: a full turn with lift, a ring and 14 sparks. Resolves when settled (at most 1000 ms). */
export async function claim(ctl: SceneCtl, tier: TierLight) {
  const b = motionLevel() === "calm" ? null : ctl.ensureBody();
  if (!b || ctl.busy) return;
  begin(ctl, b, "turning");
  ctl.mountBack();
  const target = Math.round(b.flip.t / 180) * 180 + 360;
  b.flip.tune(SPRINGS.flip);
  b.flip.t = target;
  b.lift.t = b.W * 0.2;
  b.sc.t = 1.04;
  Engine.kick();
  const t0 = performance.now();
  await new Promise<void>((done) => {
    b.watchers.add((f) => {
      if (target - f < 90 || performance.now() - t0 > 700) {
        burst(ctl.scene, tier, { rays: false, glow: false });
        sparks(ctl.scene, tier, 14);
        b.lift.t = 0;
        b.sc.t = 1;
        done();
        return true;
      }
      return false;
    });
  });
  await settled(b, Math.max(80, 1000 - (performance.now() - t0)));
  end(ctl, b, "turning");
}
