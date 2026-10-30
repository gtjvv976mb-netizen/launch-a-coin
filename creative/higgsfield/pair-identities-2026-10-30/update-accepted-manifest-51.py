from pathlib import Path
from PIL import Image
import json, hashlib, datetime
import numpy as np
BASE = Path(__file__).resolve().parent
PROJECT = BASE.parents[2]
def master_record(entry, face, record):
    path = Path(record["masterPath"])
    actual = path if path.is_absolute() else PROJECT / path
    sha = hashlib.sha256(actual.read_bytes()).hexdigest()
    if sha != record["masterSha256"]: raise ValueError(f"Master hash mismatch: {actual}")
    with Image.open(actual) as image:
        image.load(); a=np.asarray(image.convert("RGB")); ys,xs=np.where(a.min(axis=2)<240)
        bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
        result = {"quoteKey":entry["quoteKey"],"designKey":entry["proposedDesignKey"],"exactQuoteMint":entry["exactQuoteMint"],"face":face,"sourcePath":str(path),"sha256":sha,"jobId":record.get("jobId",record.get("sourceJobId")),"index":record.get("index",record.get("sourceIndex")),"dimensions":[image.width,image.height],"format":image.format,"cropApplied":False,"foregroundBoundsCandidate":bounds,"boundsNote":"Machine minRGB<240 crop proposal only; root canonical builder owns final crop/normalization.","visualStatus":record["visualStatus"]}
        for key in ["countsAsNewPaidJob","newGeneration","reusedSourceJobs","exactIdentityReference","derivation","visualReviewFile"]:
            if key in record: result[key] = record[key]
        if record.get("newGeneration") is False:
            result["boundsNote"] = "Reviewed reproducible source-only composition, not a new provider result. Reused source jobs and exact identity input are recorded separately; masters remain unmodified."
        return result
def accepted(record): return str(record.get("visualStatus", "")).startswith("accepted")
def main():
    ledger=json.loads((BASE/"generation-ledger-51.json").read_text()); faces=[]; pairs=[]
    for e in ledger["entries"]:
        front=e[e.get("acceptedFrontField","front")]; back=e[e.get("acceptedBackField","back")]; ff=bb=None
        if accepted(front): ff=master_record(e,"front",front); faces.append(ff)
        if accepted(back): bb=master_record(e,"back",back); faces.append(bb)
        if ff and bb:pairs.append({"quoteKey":e["quoteKey"],"designKey":e["proposedDesignKey"],"exactQuoteMint":e["exactQuoteMint"],"front":ff,"back":bb})
    result={"updatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"Progressive accepted original51 source masters and explicitly marked source-only derivatives; incomplete/rejected/superseded faces excluded.","plannedPairs":51,"acceptedPairCount":len(pairs),"acceptedFaceCount":len(faces),"paidSubmissionCount":ledger["paidSubmissions"],"quotedSubmittedCredits":ledger["quotedSubmittedCredits"],"acceptedPairs":pairs,"acceptedFaces":faces}
    target=BASE/"accepted-pairs-51.json"; temporary=target.with_name(target.name+".tmp")
    temporary.write_text(json.dumps(result,indent=2)+"\n"); temporary.replace(target)
    print(json.dumps({k:result[k] for k in ["acceptedPairCount","acceptedFaceCount","paidSubmissionCount","quotedSubmittedCredits"]}))
if __name__=="__main__": main()
