"""Refresh the review list from authoritative staged/accepted installation records."""
import json
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).resolve().parent
PROJECT = BASE.parents[2]
designs = json.loads((PROJECT / 'app/src/lib/carddex/pair-designs.json').read_text())
quotes = {q['key']: q for q in json.loads((PROJECT / 'app/src/lib/carddex/pair-assets.json').read_text())}
layers = []
for name in ['accepted-pairs-51.json', 'accepted-pairs-38.json', 'accepted-pairs-final.json', 'accepted-pairs-tailoring-v2.json']:
    p = BASE / name
    if p.exists():
        layers.append({'fileName': name, 'data': json.loads(p.read_text())})
provenance = json.loads((BASE / 'integration-provenance.json').read_text())
installed = provenance['pairs']
# Reuse the importer's whole-pair priority/quarantine contract. Reporting must
# never silently revive a withdrawn v2 source or count a superseded installation.
bun = shutil.which('bun') or str(Path.home() / '.bun/bin/bun')
selector = PROJECT / 'app/scripts/lib/pair-acceptance.ts'
code = f"""import {{selectAcceptedPairs,previouslyInstalledTailoringKeys}} from {json.dumps(str(selector))};
const input=await Bun.stdin.json();
const result=selectAcceptedPairs(input.layers,previouslyInstalledTailoringKeys(input.provenance));
console.log(JSON.stringify({{accepted:[...result.accepted.values()],blockedDesignKeys:result.blockedDesignKeys}}));"""
result = subprocess.run([bun, '--eval', code], input=json.dumps({'layers': layers, 'provenance': provenance}), text=True, capture_output=True, check=True)
selection = json.loads(result.stdout)
accepted = {p['designKey']: p for p in selection['accepted']}
blocked = set(selection['blockedDesignKeys'])
current_installed = {
    key: row for key, row in installed.items()
    if key in accepted
    and row['quoteMint'] == accepted[key]['exactQuoteMint']
    and all(row['faces'][face]['masterSha256'] == accepted[key][face]['sha256'] for face in ('front', 'back'))
}
rows = []
for d in designs:
    key = d['key']
    status = 'Installed in source' if key in current_installed else 'Accepted; awaiting installation' if key in accepted else 'Quarantined; awaiting an accepted replacement' if key in blocked else 'In production; not selectable yet'
    q = quotes[d['quoteKey']]
    source = accepted.get(key)
    source_record = {'acceptanceManifest': source['acceptanceManifest'], 'faces': {face: {field: source[face][field] for field in ('sourcePath', 'sha256', 'jobId', 'newGeneration', 'countsAsNewPaidJob', 'derivation', 'reusedSourceJobs') if field in source[face]} for face in ('front', 'back')}} if source else None
    retired = [history_key for history_key, row in provenance.get('retired', {}).items() if row.get('designKey', history_key.split('@')[0]) == key]
    rows.append({**d, 'symbol': q['symbol'], 'status': status, 'acceptedSource': source_record, 'installedMatchesAcceptedSource': key in current_installed, 'retiredProvenanceKeys': retired})
tailored = sum(p['acceptanceManifest'] == 'accepted-pairs-tailoring-v2.json' for p in accepted.values())
composed_faces = sum(bool(p[face].get('derivation')) for p in accepted.values() for face in ('front', 'back'))
counts = {'planned': len(rows), 'acceptedComplete': len(accepted), 'installedCurrentSource': len(current_installed), 'tailoredV2Accepted': tailored, 'sourceOnlyFaces': composed_faces, 'blockedDesignKeys': sorted(blocked)}
if '--dry-run' in sys.argv:
    print(json.dumps(counts))
    sys.exit(0)
lines = ['# Exact pair design collection', '', f"Updated {datetime.now(timezone.utc).isoformat()}. {len(rows)} planned designs; {len(accepted)} complete accepted pairs ({tailored} tailored-v2); {len(current_installed)} installed with the current accepted source. The running preview build may lag the latest source import; see the delivery report for its final verified count.", '', f'Higgsfield supplies the decorative card artwork. {composed_faces} accepted faces are explicit source-only compositions that reuse it with exact logos/photos or verified earlier heroes; those are not new generations. Exact source logo lettering is approved; added theme names, captions and serials are excluded. All creator content uses the same canonical card structure. Historical designs and immutable media stay recoverable in integration-provenance.json; the structured list records the selected revision and retired provenance keys.', '', 'Only complete accepted pairs with verified source/layout/atlas/reverse records become selectable. A pending or quarantined generation is never presented as finished artwork. This list does not authorize deployment or an on-chain launch.', '', '| Pair | Design | Look | Status |', '|---|---|---|---|']
for r in rows:
    lines.append('| ' + ' | '.join(str(r[k]).replace('|', '\\|') for k in ['symbol', 'name', 'description', 'status']) + ' |')
(BASE / 'DESIGN-LIST.md').write_text('\n'.join(lines) + '\n')
(BASE / 'design-list-status.json').write_text(json.dumps({'updatedAt': datetime.now(timezone.utc).isoformat(), 'counts': counts, 'provenance': 'creative/higgsfield/pair-identities-2026-10-30/integration-provenance.json', 'designs': rows}, indent=2) + '\n')
print(f'Refreshed {len(rows)} designs, {len(accepted)} accepted ({tailored} tailored-v2), {len(current_installed)} installed.')
