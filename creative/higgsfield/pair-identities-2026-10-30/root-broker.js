/* Codex functions runner; evaluate this reviewed function in the tools isolate.
 * No credentials. Requires a frozen, separately authorized plan and root-only paid lane.
 * It never retries an uncertain write. Only explicit 0-submitted HTTP429 may retry.
 */
async function runPairBroker(config) {
  const { base, relative, planFile, planSha256, maximumJobs, startingKnown, reservedUnknown, maximumCredits, startingCredits, reservedCredits } = config;
  const model = config.expectedModel ?? 'gpt_image_2_5';
  const unitCredits = config.quotedCreditsPerImage ?? 2.75;
  if (!((model === 'gpt_image_2_5' && unitCredits === 2.75) || (model === 'seedream_5_0_flash' && unitCredits === 0.5))) throw new Error('Unreviewed model/price configuration');
  const shell = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
  const command = async (code, args = [], budget = 12000) => {
    const result = await tools.exec_command({cmd: 'python3 -c ' + shell(code) + ' ' + args.map(shell).join(' '), workdir: base, max_output_tokens: budget});
    if (result.exit_code !== 0) throw new Error('Local guard or receipt persistence failed');
    return result.output;
  };
  const write = async (file, value) => command('from pathlib import Path;import sys;p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(sys.argv[2])', [relative + '/' + file, JSON.stringify(value, null, 2) + '\n'], 100);
  const metadata = JSON.parse(await command('import sys,json,hashlib;from pathlib import Path;p=Path(sys.argv[1]);assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2];a=json.loads(p.read_text());print(json.dumps({"imageCount":a["imageCount"],"quotedPlanCredits":a["quotedPlanCredits"],"batches":[{k:b[k] for k in ["batchId","indices","requestFile","receiptFile","statusFile","requestSha256"]} for b in a["batches"]]}))', [relative + '/' + planFile, planSha256], 6000));
  const count = metadata.batches.reduce((total, batch) => total + batch.indices.length, 0);
  const indices = metadata.batches.flatMap(batch => batch.indices);
  if (count !== metadata.imageCount || new Set(indices).size !== count || metadata.quotedPlanCredits !== count * unitCredits ||
      startingKnown + reservedUnknown + count > maximumJobs || startingCredits + reservedCredits + count * unitCredits > maximumCredits ||
      metadata.batches.some(batch => batch.indices.length < 1 || batch.indices.length > 2)) throw new Error('Plan accounting guard failed');
  let pending = [], pendingBatches = [], group = 0, known = 0;
  const settle = async () => {
    if (!pending.length) return;
    group++;
    for (let poll = 1; poll <= (config.maximumStatusPolls ?? 24); poll++) {
      const event = 'batches/' + config.prefix + '-group-' + group + '-status-' + poll + '-' + Date.now() + '.json';
      let receipt;
      try { receipt = await tools.mcp__codex_apps__higgsfield_jobs_wait({jobs: pending, timeout_seconds: 0}); }
      catch (error) { await write(event, {readOnlyError: String(error), jobs: pending}); await new Promise(resolve => setTimeout(resolve, 5000)); continue; }
      await write(event, receipt);
      const data = receipt.structuredContent;
      if (!data?.jobs) throw new Error('Status schema unavailable; known IDs retained');
      for (const batch of pendingBatches) await write(batch.statusFile, {derivedFrom: event, structuredContent: {...data, jobs: data.jobs.filter(job => batch.indices.includes(job.index))}});
      if (data.all_terminal) { notify({plan: config.prefix, group, terminal: data.summary}); pending = []; pendingBatches = []; return; }
      await new Promise(resolve => setTimeout(resolve, Math.min(15, Math.max(3, data.poll_after_seconds ?? 5)) * 1000));
    }
    throw new Error('Known jobs remain unresolved after read budget; stop before more writes');
  };
  try {
    for (const batch of metadata.batches) {
      if (config.stopFile) {
        const stopped = JSON.parse(await command('import sys,json;from pathlib import Path;print(json.dumps(Path(sys.argv[1]).exists()))', [relative + '/' + config.stopFile], 100));
        if (stopped) { await settle(); throw new Error('Quality stop file set; no more paid calls'); }
      }
      const previous = JSON.parse(await command('import sys,json;from pathlib import Path;p=Path(sys.argv[1]);print(json.dumps(json.loads(p.read_text()) if p.exists() else None))', [relative + '/' + batch.receiptFile], 5000));
      if (previous) {
        const data = previous.structuredContent;
        if (!(data?.submitted_count === 0 && data.jobs?.length === batch.indices.length && data.jobs.every(job => job.status === 'submission_failed' && job.error?.includes('429')))) throw new Error('Existing receipt prevents duplicate submission: ' + batch.batchId);
        await write('batches/' + batch.batchId + '-previous-zero-429-' + Date.now() + '.json', previous);
      }
      const request = JSON.parse(await command('import sys,hashlib;from pathlib import Path;p=Path(sys.argv[1]);assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2];print(p.read_text())', [relative + '/' + batch.requestFile, batch.requestSha256]));
      if (JSON.stringify(request.requests.map(item => item.index)) !== JSON.stringify(batch.indices) || request.requests.some(item => item.params.count !== 1 || item.params.model !== model || (model === 'gpt_image_2_5' && item.params.quality !== 'high') || (model === 'seedream_5_0_flash' && item.params.quality !== undefined) || item.params.resolution !== '2k')) throw new Error('Request identity/model guard failed');
      let acknowledged = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const event = 'batches/' + batch.batchId + '-attempt-' + attempt + '-' + Date.now();
        await write(event + '-reservation.json', {executor: 'root', indices: batch.indices, maximumQuotedCredits: batch.indices.length * unitCredits, status: 'reserved-before-one-write', automaticUnknownRetry: false});
        let receipt;
        try { receipt = await tools.mcp__codex_apps__higgsfield_generate_image_batch(request); }
        catch (error) { receipt = {outcome: 'submission-unknown', error: String(error), indices: batch.indices}; }
        await write(event + '-receipt.json', receipt);
        await write(batch.receiptFile, receipt);
        const data = receipt.structuredContent;
        const jobs = data?.jobs?.filter(job => job.job_id).map(({index, job_id}) => ({index, job_id})) ?? [];
        if (jobs.length === batch.indices.length) { known += jobs.length; pending.push(...jobs); pendingBatches.push(batch); acknowledged = true; notify({plan: config.prefix, batch: batch.batchId, acknowledged: jobs.length, knownNewJobs: known}); break; }
        if (data?.submitted_count === 0 && data.jobs?.length === batch.indices.length && data.jobs.every(job => job.status === 'submission_failed' && job.error?.includes('429'))) {
          notify({plan: config.prefix, batch: batch.batchId, rejectedZeroJobs: 'HTTP429', attempt});
          await settle();
          if (attempt === 2) throw new Error('Provider rate limit persists; no jobs created');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }
        await write('batches/' + batch.batchId + '-unknown.json', {status: 'quarantined-no-retry', indices: batch.indices.filter(index => !jobs.some(job => job.index === index)), maximumQuotedCredits: (batch.indices.length - jobs.length) * unitCredits, returnedKnownJobs: jobs});
        throw new Error('Unknown or partial write; stop all further paid calls');
      }
      if (!acknowledged) throw new Error('No acknowledged result');
      if (pendingBatches.length === 2) await settle();
    }
    await settle();
    text({status: 'broker-jobset-terminal', plan: config.prefix, knownNewJobs: known, quotedCredits: known * unitCredits});
  } catch (error) {
    text({status: 'stopped-safely', plan: config.prefix, reason: String(error), knownNewJobs: known, pendingKnownJobs: pending});
  }
}
