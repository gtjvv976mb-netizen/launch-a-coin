from pathlib import Path
import json
from PIL import Image, ImageOps, ImageDraw
PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(__file__).resolve().parent.parent
MASTERS = PROJECT / "output/higgsfield/pair-identities-2026-10-30/originals"
KEYS = ["sol", "tslax", "doge", "pnut"]
def main():
    board = Image.new("RGB", (1920, 1550), "#f3eee7")
    draw = ImageDraw.Draw(board)
    draw.text((24, 14), "Higgsfield pilot: actual generated front / matching back", fill="#201b18")
    errors=[]
    for i,key in enumerate(KEYS):
        x=i*480+20
        draw.text((x,42), key.upper(), fill="#201b18")
        for n,face in enumerate(["front","back"]):
            path=MASTERS/f"{key}-{face}.png"
            y=72+n*730
            draw.text((x,y), face, fill="#201b18")
            if not path.exists():
                errors.append(str(path)); draw.text((x,y+30),"PENDING — no generated master",fill="#9b332b");continue
            im=Image.open(path).convert("RGB")
            thumb=ImageOps.contain(im,(440,680),Image.Resampling.LANCZOS)
            board.paste(thumb,(x+(440-thumb.width)//2,y+22))
    out=BASE/"pilot/contact-proof.png"
    board.save(out)
    print(json.dumps({"path":str(out),"missing":errors}))
if __name__ == "__main__":main()
