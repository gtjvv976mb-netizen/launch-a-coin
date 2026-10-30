import {describe,expect,it} from 'bun:test';
import {selectAcceptedPairs,previouslyInstalledTailoringKeys,TAILORING_ACCEPTANCE_FILE} from '../../scripts/lib/pair-acceptance';

const pair=(revision:string)=>({designKey:'pair-pepe',exactQuoteMint:'exact-pepe-mint',front:{designKey:'pair-pepe',exactQuoteMint:'exact-pepe-mint',face:'front',visualStatus:'accepted-visual-review',sha256:revision+'-front'},back:{designKey:'pair-pepe',exactQuoteMint:'exact-pepe-mint',face:'back',visualStatus:'accepted-visual-review',sha256:revision+'-back'}});
const original={fileName:'accepted-pairs-38.json',data:{acceptedPairs:[pair('original')]}};

describe('whole-pair revision acceptance',()=>{
 it('keeps the approved original while a new front is only work in progress',()=>{
  const selected=selectAcceptedPairs([original,{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[],acceptedFaces:[pair('new').front]}}]);
  expect(selected.accepted.get('pair-pepe').front.sha256).toBe('original-front');
  expect(selected.accepted.get('pair-pepe').back.sha256).toBe('original-back');
 });
 it('replaces both faces together, with v2 priority independent of input order',()=>{
  const selected=selectAcceptedPairs([{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[pair('new')]}},original]);
  expect(selected.accepted.get('pair-pepe').front.sha256).toBe('new-front');
  expect(selected.accepted.get('pair-pepe').back.sha256).toBe('new-back');
  expect(selected.accepted.get('pair-pepe').acceptanceManifest).toBe(TAILORING_ACCEPTANCE_FILE);
 });
 it('quarantines withdrawn installed v2 art instead of silently reviving an old generic design',()=>{
  const selected=selectAcceptedPairs([original,{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[]}}],['pair-pepe']);
  expect(selected.accepted.has('pair-pepe')).toBe(false);
  expect(selected.blockedDesignKeys).toEqual(['pair-pepe']);
 });
 it('honors explicit revocation and remembers prior v2 installation through retired provenance',()=>{
  const selected=selectAcceptedPairs([original,{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[pair('new')],revokedDesignKeys:['pair-pepe']}}]);
  expect(selected.accepted.has('pair-pepe')).toBe(false);
  expect(previouslyInstalledTailoringKeys({retired:{'pair-pepe@fingerprint':{designKey:'pair-pepe',acceptanceManifest:TAILORING_ACCEPTANCE_FILE}}})).toEqual(['pair-pepe']);
 });
 it('rejects incomplete or mixed-mint acceptedPairs rather than borrowing the other face',()=>{
  const incomplete={...pair('new'),back:undefined};
  expect(()=>selectAcceptedPairs([original,{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[incomplete]}}])).toThrow('Incomplete or unreviewed');
  const wrongMint=pair('new');wrongMint.back.exactQuoteMint='different-mint';
  expect(()=>selectAcceptedPairs([original,{fileName:TAILORING_ACCEPTANCE_FILE,data:{acceptedPairs:[wrongMint]}}])).toThrow('Incomplete or unreviewed');
 });
});
