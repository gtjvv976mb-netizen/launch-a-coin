/** The 3D card surface (refs/alive-3d-spec.md section 4.1). MintCard itself stays at ../MintCard.tsx. */
export { Card3D } from "./Card3D";
export { CardBack, CardDeck } from "./CardBack";
export { CardCase } from "./CardCase";
export { GyroChip } from "./GyroChip";
export { InspectDialog, prefetchInspect } from "./InspectDialog";
export { CardMotionProvider, CardMotionCell, gather, prefetchGather } from "./context";
export { fanVars } from "./light";
export { motionLevel, useMotionLevel, setCalm, markHydrated, isHydrated, useFreshMount, whenRevealed } from "./motion3d";
export type * from "./types";
export type { CardCaseProps } from "./CardCase";
export { View3DProvider, View3DButton, View3DHost, prefetchView3D, useView3D, useView3DGestures, type View3DItem } from "./view3d";
