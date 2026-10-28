import { useEffect, useState, type RefObject } from "react";

/** Also detects errors that happen to server-rendered images before React hydrates. */
export function useImageFailure(ref: RefObject<HTMLImageElement | null>, source: string | null, variant: string) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => {
    const image = ref.current;
    if (!source || !image) return;
    let active = true;
    const sync = () => {
      if (!active || !image.complete) return;
      if (image.naturalWidth === 0) setFailedSource(source);
      else setFailedSource((failed) => failed === source ? null : failed);
    };
    image.addEventListener("load", sync);
    image.addEventListener("error", sync);
    sync();
    return () => {
      active = false;
      image.removeEventListener("load", sync);
      image.removeEventListener("error", sync);
    };
  }, [ref, source, variant]);
  return {
    failed: !!source && failedSource === source,
    onError: () => { if (source) setFailedSource(source); },
    onLoad: () => setFailedSource((failed) => failed === source ? null : failed),
  };
}
