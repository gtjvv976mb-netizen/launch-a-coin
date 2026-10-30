"""Choose only unrelated unsubmitted faces; paid calls remain explicit MCP actions."""
import json,subprocess,sys
from pathlib import Path
P=Path(__file__).resolve().parent
d=json.loads((P/'generation-ledger-51.json').read_text()); lease=json.loads((P/'generation-batch-lease.json').read_text())
assert lease['status']in['terminal','released','idle','quarantined-unknown','active']
if lease['status']=='active':assert len(lease.get('activeBatches',[lease]))<2
candidates=[]
for e in d['entries']:
    for field in ['frontCorrection','backCorrection']:
        q=e.get(field,{})
        if q.get('status')=='prepared'and not q.get('jobId'):candidates.append(e['quoteKey']+':'+field)
for e in d['entries']:
    q=e['back'];front=e[e.get('acceptedFrontField','front')]
    if not q.get('jobId')and q.get('status')!='submission-outcome-unknown'and str(front.get('visualStatus','')).startswith('accepted'):candidates.append(e['quoteKey']+':back')
for e in d['entries']:
    q=e['front']
    if not q.get('jobId')and q.get('status')!='submission-outcome-unknown':candidates.append(e['quoteKey']+':front')
assert candidates,'No unrelated unsubmitted faces remain; do not retry quarantined outcomes'
subprocess.run([sys.executable,str(P/'prepare-batch-51.py'),sys.argv[1],*candidates[:2]],check=True)
