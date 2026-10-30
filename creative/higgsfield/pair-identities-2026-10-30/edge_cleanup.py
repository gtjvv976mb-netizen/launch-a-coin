"""Deterministic opt-in removal of neutral near-white pixels connected to the outer background.

Enclosed ivory print panels are protected by connectivity. No fill, repaint or replacement art.
"""
import numpy as np
from PIL import Image
from scipy.ndimage import binary_propagation,binary_dilation

def edge_connected_white_cleanup(image,threshold=195,neutral_spread=18):
    rgba=np.array(image.convert('RGBA'));rgb=rgba[:,:,:3].astype(float);alpha=rgba[:,:,3].copy()
    low=rgb.min(axis=2);spread=rgb.max(axis=2)-low
    candidate=(alpha<255)|((low>=threshold)&(spread<=neutral_spread))
    seed=np.zeros(candidate.shape,dtype=bool)
    seed[0,:]=candidate[0,:];seed[-1,:]=candidate[-1,:];seed[:,0]=candidate[:,0];seed[:,-1]=candidate[:,-1]
    # Only the canvas edge seeds removal; isolated internal alpha is not outside.
    outside=binary_propagation(seed,mask=candidate)
    rgba[outside,3]=0
    # Remove only the neutral near-white antialias fringe immediately adjoining
    # that outside component; colored metal and all isolated ivory stay intact.
    fringe=binary_dilation(outside)&~outside&(low>=threshold-10)&(spread<=neutral_spread)
    rgba[fringe,3]=np.minimum(alpha[fringe],np.clip((255-low[fringe])/(255-threshold+10)*255,0,255)).astype(np.uint8)
    return Image.fromarray(rgba,'RGBA'),{'removedPixels':int((outside&(alpha>0)).sum()),'fringePixels':int(fringe.sum()),'threshold':threshold,'neutralSpread':neutral_spread,'method':'edge-connected-neutral-near-white-v1'}
