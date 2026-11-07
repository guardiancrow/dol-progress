// Pure planning only. No database handles or write operations are accepted here.
const key = row => `${row.profile_id}:${row.discovery_id}`;
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort((a,b)=>a-b);

export function merit(data, histories = data.histories) {
  const discovery = new Map(data.discoveries.map(d=>[d.id,d]));
  return data.profiles.map(p=>{
    const ids=new Set();
    for(const h of histories) if(h.profile_id===p.id && (h.first_report_status==='confirmed'||h.legacy_merit_credit===1)) ids.add(h.discovery_id);
    for(const dp of data.progress) if(dp.profile_id===p.id && data.automaticIds.includes(dp.discovery_id)) ids.add(dp.discovery_id);
    const eligibleIds=sorted([...ids].filter(id=>discovery.has(id)&&!discovery.get(id).relic));
    const rows=eligibleIds.map(id=>discovery.get(id));
    return {profileId:p.id,eligibleIds,count:rows.length,known:rows.filter(d=>d.experience!==null).length,
      unknown:rows.filter(d=>d.experience===null).length,knownMerit:rows.reduce((n,d)=>n+(d.experience??0),0)};
  });
}

export function sameMerit(before,after) { return equal(before,after); }

export function planHistory(source,target) {
  const problems=[];
  if(source.version!==3||target.version!==4) problems.push('schema_version');
  for(const field of ['profiles','discoveries']) if(!equal(source[field],target[field])) problems.push(`${field}_identity`);
  const old=new Map(source.progress.map(r=>[key(r),r]));
  const current=new Map(target.progress.map(r=>[key(r),r]));
  const history=new Map(target.histories.map(r=>[key(r),r]));
  if(old.size!==source.progress.length||current.size!==target.progress.length||history.size!==target.histories.length) problems.push('duplicate_primary_key');
  const sourceOnly=[...old.keys()].filter(k=>!current.has(k));
  const targetOnly=[...current.keys()].filter(k=>!old.has(k));
  if(sourceOnly.length||targetOnly.length) problems.push('progress_primary_keys');
  let progressDifferences=0;
  for(const [k,r] of old) {
    const next=current.get(k); if(!next) continue;
    if(!equal(Object.fromEntries(Object.keys(r).map(c=>[c,next[c]])),r)||(next.report_hold??0)!==0) progressDifferences++;
  }
  if(progressDifferences) problems.push('current_progress_changed');
  const discoveries=new Map(source.discoveries.map(d=>[d.id,d]));
  const profiles=new Set(source.profiles.map(p=>p.id));
  const actions=[], conflicts=[];
  const counts={oldReported:0,oldUnreported:0,confirmedUpdates:0,notReportedInserts:0,unchanged:0,excludedRelics:0,legacyNormalizations:0};
  for(const [k,r] of old) {
    const d=discoveries.get(r.discovery_id);
    if(!profiles.has(r.profile_id)||!d||![0,1].includes(r.reported)) {conflicts.push({key:k,reason:'invalid_source_reference_or_flag'});continue;}
    if(d.relic) {counts.excludedRelics++;continue;}
    if(!current.has(k)) continue;
    const h=history.get(k);
    if(h && (!['unknown','confirmed','not_reported'].includes(h.first_report_status)||![0,1].includes(h.legacy_merit_credit)||(h.legacy_merit_credit===1&&h.first_report_status!=='unknown'))) {
      conflicts.push({key:k,reason:'invalid_history_constraint'});continue;
    }
    const common={profile_id:r.profile_id,discovery_id:r.discovery_id};
    if(r.reported===1) {
      counts.oldReported++;
      if(h?.first_report_status==='confirmed') {counts.unchanged++;continue;}
      if(h?.first_report_status!=='unknown'||h.legacy_merit_credit!==1) {
        conflicts.push({key:k,reason:h?.first_report_status==='not_reported'?'contradictory_not_reported':'missing_or_changed_legacy_history'});continue;
      }
      actions.push({...common,kind:'update',expected:{...h},first_report_status:'confirmed',legacy_merit_credit:0});
      counts.confirmedUpdates++; counts.legacyNormalizations++;
    } else {
      counts.oldUnreported++;
      // A later confirmed report supersedes the old "not yet reported" observation.
      if(h?.first_report_status==='confirmed'||h?.first_report_status==='not_reported') {counts.unchanged++;continue;}
      if(h) {conflicts.push({key:k,reason:h.legacy_merit_credit?'legacy_conflicts_with_not_reported':'ambiguous_existing_unknown'});continue;}
      actions.push({...common,kind:'insert',expected:null,first_report_status:'not_reported',legacy_merit_credit:0});
      counts.notReportedInserts++;
    }
  }
  const projected=new Map(target.histories.map(h=>[key(h),{...h}]));
  for(const a of actions) projected.set(key(a),{profile_id:a.profile_id,discovery_id:a.discovery_id,first_report_status:a.first_report_status,
    legacy_merit_credit:a.legacy_merit_credit,updated_at:a.expected?.updated_at??null});
  const before=merit(target), after=merit(target,[...projected.values()]);
  if(!sameMerit(before,after)) problems.push('merit_or_eligible_ids_changed');
  return {blocked:problems.length>0||conflicts.length>0,problems,conflicts,counts,actions,before,after,
    primaryKeyMismatch:sourceOnly.length+targetOnly.length,progressDifferences,requiresLegacyNormalizationApproval:counts.legacyNormalizations>0};
}
