import { createContext } from "react";

/**
 * The depth of the Card3D a face renders in (null outside one). MintCardFace reads it to draw the right light
 * layers: the glint pass for table cards; the flash is shared. Kept apart so MintCard and Card3D never import
 * each other in a cycle.
 */
export const FaceDepth = createContext<"table" | "hand" | null>(null);
