/** A clear, explicit permission gesture on browsers that require one; never report a sensor active without data. */
import { useEffect, useState } from "react";

import { GYRO_EVENT, gyroStatus, requestGyro, type GyroStatus } from "./gyro";
import { Engine, useMotionLevel } from "./motion3d";

export function GyroChip({ className = "" }: { className?: string }) {
  const level = useMotionLevel();
  const [status, setStatus] = useState<GyroStatus>("idle");
  useEffect(() => {
    const sync = () => setStatus(gyroStatus());
    sync();
    window.addEventListener(GYRO_EVENT, sync);
    return () => window.removeEventListener(GYRO_EVENT, sync);
  }, [level]);
  if (level === "calm" || status === "active" || status === "idle" || status === "unsupported")
    return null;
  const label =
    status === "permission"
      ? "Enable phone tilt"
      : status === "requesting"
        ? "Enabling phone tilt…"
        : status === "waiting"
          ? "Waiting for phone motion…"
          : status === "denied"
            ? "Phone tilt blocked"
            : "Phone tilt unavailable";
  return (
    <button
      type="button"
      className={`mdx-card3d__chip ${className}`}
      disabled={status !== "permission"}
      title={
        status === "denied"
          ? "Allow motion access in your browser settings to use phone tilt."
          : undefined
      }
      onClick={() => {
        void requestGyro().then(() => Engine.kick());
      }}
    >
      <span aria-live="polite">{label}</span>
    </button>
  );
}
