"""Append root-approved exact public-account identities; no RPC, generation or wallet access."""
from pathlib import Path
import hashlib,json,re

root=Path(__file__).resolve().parents[4]
source_dir=root/'creative/higgsfield/pair-identities-2026-10-30'
decoded=json.loads((source_dir/'research/expansion-final-identities-and-metadata.json').read_text())
briefs=json.loads((source_dir/'expansion-final-identity-briefs.json').read_text())['entries']
snapshots=json.loads((source_dir/'research/expansion-final-public-account-snapshots.json').read_text())
app_path=root/'app/src/lib/carddex/pair-assets.json'
adapter_path=root/'reports/pump-pair-assets-2026-10-28.json'
design_path=root/'app/src/lib/carddex/pair-designs.json'
fixture_path=root/'integrations/pumpfun/tests/fixtures/mainnet-pair-accounts-2026-10-28.json'
app=json.loads(app_path.read_text());adapter=json.loads(adapter_path.read_text());designs=json.loads(design_path.read_text());fixture=json.loads(fixture_path.read_text())
expected=['pump','alch','pumpcade','codec','ape','link','ore','skr']
if [a['key'] for a in decoded['assets']]!=expected:raise ValueError('Unexpected final identity scope')
if len(app)!=89 or len(designs)!=89:raise ValueError('Run once against the preserved89 baseline; inspect rather than duplicate an installation')
baseline=json.loads(json.dumps({'app':app,'adapter':adapter['assets'],'designs':designs,'fixture':fixture}))
dest=root/'app/tests/carddex/fixtures'
for name,path in [('legacy-pair-assets-89-2026-10-30.json',app_path),('legacy-pair-designs-89-2026-10-30.json',design_path)]:
 target=dest/name
 if target.exists() and target.read_bytes()!=path.read_bytes():raise ValueError('Refuse to overwrite historical baseline '+name)
 target.write_bytes(path.read_bytes())

public={'pump','alch','pumpcade','codec','ore','skr'}
descriptions={
 'pump':'Exact Pump capsule details in dark navy, mint enamel and polished silver.',
 'alch':'Exact Alchemist AI pixel-A details in obsidian, scarlet and satin gold.',
 'pumpcade':'Exact arcade-medallion details in burgundy enamel and satin gold.',
 'codec':'Exact segmented CODEC mark in black ceramic and polished palladium.',
 'ape':'Exact Solana APE gorilla details in cobalt enamel and polished silver.',
 'link':'Exact Solana LINK hexagon details in Chainlink blue enamel and polished silver.',
 'ore':'Exact ORE ring details in black stone and platinum.',
 'skr':'Exact Seeker split-S details in obsidian and brushed silver.',
}
new_app=[];new_adapter=[];new_designs=[]
for a in decoded['assets']:
 key=a['key'];admission=a['admission'];brief=next(b for b in briefs if b['quoteKey']==key)
 if admission['source']!='quoteControl' or not admission['initialized'] or admission['paused'] or admission['defaultFrozen']:raise ValueError('Invalid exact direct admission '+key)
 if brief['exactQuoteMint']!=a['mint']:raise ValueError('Art identity/quote mismatch '+key)
 urls=['https://pump.fun/docs/custom-pairs'] if key in public else [f'https://solscan.io/token/{a["mint"]}','https://solscan.io/account/6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP']
 if key=='link':urls+=['https://docs.chain.link/resources/link-token-contracts',a['metadata']['uri']]
 if key=='ore':urls+=['https://github.com/regolith-labs/ore-app','https://raw.githubusercontent.com/regolith-labs/ore-app/33fa7dea28cab6fec2212bab258560d9be88e337/public/metadata.json']
 if key=='skr':urls+=['https://solanamobile.com/blog/skr-is-live']
 name='ApeCoin (Solana quote)' if key=='ape' else 'Chainlink Token (Solana)' if key=='link' else a['name']
 row={'key':key,'symbol':a['symbol'],'name':name,'mint':a['mint'],'decimals':admission['decimals'],'tokenProgram':admission['tokenProgram'],'kind':'crypto','issuer':'Golden Fields Partners, Ltd.' if key=='pump' else None,'issuerTerms':None,'verifiedDate':'2026-10-30','admission':'quoteControl','initialVirtualQuoteReserves':admission['initialVirtualQuoteReserves']}
 if key not in public:row.update({'listingStatus':'direct-onchain','listingNotice':'Direct QuoteControl-enabled; not found in the checked dated public table.'})
 row.update({'sourceUrls':urls,'sourceEvidenceArtifact':'creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-identities-and-metadata.json'})
 new_app.append({**row,'verifiedAt':'2026-10-30','verificationSlot':a['accountSlot']})
 new_adapter.append({**row,'mintVerificationSlot':a['accountSlot'],'admissionVerificationSlot':a['accountSlot']})
 colors=brief['palette']['proposedMaterialColors']
 # The identity's colors stay in generated artwork; the shared fallback paper
 # must remain light enough for the canonical dark creator-content ink.
 palette=[colors[0],colors[1],'#F3EEE4']
 new_designs.append({'key':'pair-'+key,'quoteKey':key,'name':brief['name'],'description':descriptions[key],'category':'crypto','materialLevel':14,'palette':palette,'finish':'gold' if key in {'alch','pumpcade'} else 'holo','quoteMint':a['mint']})

def append_array(path,rows):
 text=path.read_text();end=text.rfind('\n]')
 if end<0:raise ValueError('Unexpected array formatting '+str(path))
 block=',\n'.join('  '+json.dumps(row,ensure_ascii=False,indent=2).replace('\n','\n  ') for row in rows)
 path.write_text(text[:end]+',\n'+block+text[end:])

append_array(app_path,new_app);append_array(design_path,new_designs)
adapter['assets']+=new_adapter
adapter['evidence']['finalCryptoIdentityExpansion20261030']={'reviewedDate':'2026-10-30','preservedPreviousAssetCount':89,'additionalCryptoCount':8,'totalReviewedAssets':97,'snapshotSlots':decoded['snapshotSlots'],'fetchedAt':decoded['fetchedAt'],'artifacts':['creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-identities-and-metadata.json','creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-public-account-snapshots.json'],'publishedTableMembers':sorted(public),'directOnchainOnly':['ape','link'],'notes':['All eight are exact direct QuoteControl-admitted crypto/platform/community assets; no memecoin classification is inferred.','APE is the exact Solana quote with gorilla metadata, without an Ethereum/issuer/bridge claim. LINK is the documented exact Solana mint, while public-table inclusion is not asserted.','Original89 asset objects, historical Global/QuoteControl fixture bytes and all prior mint fixtures remain unchanged. New artwork is staged until complete acceptance and canonical derivatives are installed.','Runtime preparation resolves current account state. Fixture captures are deliberately mixed, not presented as one atomic RPC snapshot.']}
for uri in [u for r in new_adapter for u in r['sourceUrls']]:
 if uri not in adapter['sources']:adapter['sources'].append(uri)
adapter_path.write_text(json.dumps(adapter,ensure_ascii=False,indent=2)+'\n')

fresh={}
for s in snapshots['snapshots']:
 for address,account in zip(s['keys'],s['value']):
  if account is not None:fresh[address]=account
for a in decoded['assets']:
 if a['mint'] in fixture['accounts']:raise ValueError('Unexpected existing fixture identity '+a['key'])
 account=fresh[a['mint']]
 if account['owner']!=a['admission']['tokenProgram']:raise ValueError('Fixture token-program mismatch '+a['key'])
 fixture['accounts'][a['mint']]=account
fixture['additionalAccountSnapshots'].append({'at':snapshots['fetchedAt'],'slot':decoded['snapshotSlots'][0],'mints':[a['mint'] for a in decoded['assets']],'source':'creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-public-account-snapshots.json','context':snapshots['snapshots'][0]['context'],'note':'Only eight fresh exact mint accounts appended. Existing Global/QuoteControl and all prior fixture accounts/context remain unchanged; this deterministic multi-capture fixture is not one atomic RPC snapshot.'})
fixture_path.write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')

keys_path=root/'app/src/lib/carddex/pairs.ts';text=keys_path.read_text();match=re.search(r'export const PAIR_ASSET_KEYS = (\[.*?\]) as const;',text)
old_keys=json.loads(match[1]);assert old_keys==[a['key'] for a in baseline['app']]
text=text[:match.start(1)]+json.dumps(old_keys+expected)+text[match.end(1):];keys_path.write_text(text)

new=json.loads(app_path.read_text());new_d=json.loads(design_path.read_text());new_f=json.loads(fixture_path.read_text())
assert new[:89]==baseline['app'] and adapter['assets'][:89]==baseline['adapter'] and new_d[:89]==baseline['designs']
assert new_f['context']==baseline['fixture']['context']
assert all(new_f['accounts'][k]==v for k,v in baseline['fixture']['accounts'].items())
report={'appAssets':len(new),'adapterAssets':len(adapter['assets']),'stagedDesigns':len(new_d),'newKeys':expected,'priorAppObjectsUnchanged':89,'priorAdapterObjectsUnchanged':89,'priorStagedObjectsUnchanged':89,'priorFixtureAccountsUnchanged':len(baseline['fixture']['accounts']),'priorFixtureContextUnchanged':True,'newMintAccounts':8,'rootApproval':'Root accepted eight exact identities within existing maximize-credit scope; no paid calls here.'}
(source_dir/'research/final-registry-install-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
