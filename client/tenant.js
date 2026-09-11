const $=s=>document.querySelector(s);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
async function api(url,options){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options?.headers||{})},...options});if(r.status===401){location.href='/login';throw Error('Your session has expired.');}if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||'Something went wrong.');}return r.status===204?null:r.json()}
function fail(e){$('#error').textContent=e.message;$('#error').hidden=false}function clearFail(){$('#error').hidden=true}function money(v){return v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v))}function date(v){return v?new Date(v+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'No end date'}function badge(v){return `<span class=\"badge ${(v||'').toLowerCase()}\">${esc((v||'').replace('_',' '))}</span>`}function photoMarkup(url,title){return url?`<img class=\"maintenance-photo\" src=\"${esc(url)}\" alt=\"${esc(title)}\" loading=\"lazy\">`:''}
function dueDateFromStart(startDate,offsetMonths=0){
  if(!startDate) return null;
  const start=new Date(startDate+'T00:00:00');
  if(Number.isNaN(start.getTime())) return null;
  const dueDay=start.getDate();
  const today=new Date(); today.setHours(0,0,0,0);
  const clamp=(year,month)=>{const last=new Date(year,month+1,0).getDate();return new Date(year,month,Math.min(dueDay,last));};
  let candidate=clamp(today.getFullYear(),today.getMonth());
  if(candidate<today) candidate=clamp(today.getFullYear(),today.getMonth()+1);
  if(offsetMonths) candidate=clamp(candidate.getFullYear(),candidate.getMonth()+offsetMonths);
  const y=candidate.getFullYear(); const m=String(candidate.getMonth()+1).padStart(2,'0'); const d=String(candidate.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function nextDue(startDate){const iso=dueDateFromStart(startDate);return iso?date(iso):'—'}
function route(){
  const hash=(location.hash.slice(1)||'home');
  const focusForm=hash==='maintenance-form';
  const id=focusForm?'maintenance':hash;
  show(id,focusForm);
}
function tabFor(id){
  if(id==='maintenance') return 'maintenance';
  if(id==='profile'||id==='documents') return 'profile';
  return 'home';
}
function show(id,focusForm){
  document.querySelectorAll('.tenant-view').forEach(v=>v.hidden=v.id!==id);
  document.querySelectorAll('.side-nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+id));
  const tab=tabFor(id);
  document.querySelectorAll('.tenant-tabs a').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  if(id==='home')loadHome();
  if(id==='lease')loadLease();
  if(id==='maintenance')loadMaintenance().then(()=>{if(focusForm) focusMaintenanceForm()});
  if(id==='documents')loadDocuments();
  if(id==='profile')loadProfile();
}
function focusMaintenanceForm(){
  const form=$('#maintenance-form');
  if(!form) return;
  form.scrollIntoView({behavior:'smooth',block:'start'});
  const title=form.querySelector('input[name="title"]');
  if(title) title.focus();
}
async function loadHome(){try{clearFail();const d=await api('/tenant/dashboard');const name=d.user.firstName;$('#greeting').textContent=`Welcome home, ${name}`;$('#resident-name').textContent=`${d.user.firstName} ${d.user.lastName}`;$('#initials').textContent=(d.user.firstName[0]+d.user.lastName[0]).toUpperCase();const l=d.lease;$('#hero').classList.remove('loading');$('#hero').innerHTML=l?`<p>Your current home</p><h2>${esc(l.property.name)} · Unit ${esc(l.unit.unitNumber)}</h2><p>${esc(l.property.addressLine1)}, ${esc(l.property.city)}, ${esc(l.property.state)} · Lease ${esc(l.lease.status.toLowerCase())}</p>`:`<p>Your current home</p><h2>No active lease found</h2><p>Contact your property team if this looks incorrect.</p>`;$('#quick-stats').innerHTML=`<div class="quick-stat"><span>Monthly rent</span><strong>${l?money(l.lease.monthlyRent):'—'}</strong></div><div class="quick-stat"><span>Next due</span><strong>${l?nextDue(l.lease.startDate):'—'}</strong></div><div class="quick-stat"><span>Lease end</span><strong>${l?date(l.lease.endDate):'—'}</strong></div><div class="quick-stat"><span>Open requests</span><strong>${d.openMaintenanceCount}</strong></div>`;$('#recent-maintenance').classList.remove('loading');$('#recent-maintenance').innerHTML=d.recentMaintenance.length?d.recentMaintenance.map(x=>`<div class="list-item"><div><strong>${esc(x.request.title)}</strong><small>${esc(x.property.name)} · Unit ${esc(x.unit.unitNumber)}</small></div>${badge(x.request.status)}</div>`).join(''):'<p class="muted">You have no maintenance requests.</p>'}catch(e){fail(e)}}
async function loadLease(){try{const d=await api('/tenant/lease');const l=d[0];$('#lease-card').classList.remove('loading');$('#lease-card').innerHTML=l?`<div class="panel-head"><div><p class="eyebrow">Current agreement</p><h2>${esc(l.property.name)} · Unit ${esc(l.unit.unitNumber)}</h2></div>${badge(l.lease.status)}</div><div class="lease-summary"><div class="detail"><label>Property</label><strong>${esc(l.property.name)}</strong></div><div class="detail"><label>Unit</label><strong>${esc(l.unit.unitNumber)}</strong></div><div class="detail"><label>Lease start</label><strong>${date(l.lease.startDate)}</strong></div><div class="detail"><label>Lease end</label><strong>${date(l.lease.endDate)}</strong></div><div class="detail"><label>Monthly rent</label><strong>${money(l.lease.monthlyRent)}</strong></div><div class="detail"><label>Security deposit</label><strong>${money(l.lease.securityDeposit)}</strong></div></div>`:'<p class="muted">No lease information is available yet.</p>'}catch(e){fail(e)}}
async function loadMaintenance(){try{const d=await api('/tenant/maintenance');$('#maintenance-list').classList.remove('loading');$('#maintenance-list').innerHTML=d.length?d.map(x=>`<article class="request-card" onclick="window.maintenanceDetail('${x.id}')"><div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><small>${esc(x.priority)} · Submitted ${new Date(x.createdAt).toLocaleDateString()}</small></div>${badge(x.status)}</article>`).join(''):'<div class="tenant-panel"><p class="muted">No maintenance requests yet.</p></div>'}catch(e){fail(e)}}
async function maintenanceDetail(id){try{const d=await api('/tenant/maintenance/'+id);$('#maintenance-detail').innerHTML=`<article class="tenant-panel"><div class="panel-head"><div><p class="eyebrow">Request details</p><h2>${esc(d.request.title)}</h2></div>${badge(d.request.status)}</div><p>${esc(d.request.description)}</p>${photoMarkup(d.request.photoUrl,d.request.title)}<p class="muted">Priority: ${esc(d.request.priority)} · Updated ${new Date(d.request.updatedAt).toLocaleDateString()}</p><h3>Comments</h3><div>${d.comments.length?d.comments.map(x=>`<p><strong>${esc(x.user.firstName+' '+x.user.lastName)}</strong> <small>${new Date(x.comment.createdAt).toLocaleString()}</small><br>${esc(x.comment.body)}</p>`).join(''):'<p class="muted">No comments yet.</p>'}</div><form onsubmit="addTenantComment(event,'${id}')" class="form-actions"><input name="body" required maxlength="5000" placeholder="Add a comment"><button class="primary">Add comment</button></form></article>`;$('#maintenance-detail').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){fail(e)}}
async function addTenantComment(e,id){e.preventDefault();try{await api('/tenant/maintenance/'+id+'/comments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});await maintenanceDetail(id)}catch(err){fail(err)}}
async function loadDocuments(){try{const d=await api('/tenant/documents');$('#documents-list').classList.remove('loading');$('#documents-list').innerHTML=d.length?d.map(x=>`<div class="file-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.documentType)} · Added ${new Date(x.createdAt).toLocaleDateString()}</small></div><a class="button" href="${esc(x.fileUrl)}" target="_blank" rel="noopener">Open</a></div>`).join(''):'<p class="muted">No documents have been shared with you yet.</p>'}catch(e){fail(e)}}
async function loadProfile(){try{const d=await api('/tenant/profile');const f=$('#profile-form');f.classList.remove('loading');f.innerHTML=`<h2>Contact information</h2><label>First name<input value="${esc(d.user.firstName)}" disabled></label><label>Last name<input value="${esc(d.user.lastName)}" disabled></label><label>Email<input value="${esc(d.user.email)}" disabled></label><label>Phone<input name="phone" value="${esc(d.tenant.phone)}" placeholder="Optional"></label><label>Emergency contact name<input name="emergencyName" value="${esc(d.tenant.emergencyName)}" placeholder="Optional"></label><label>Emergency contact phone<input name="emergencyPhone" value="${esc(d.tenant.emergencyPhone)}" placeholder="Optional"></label><div class="form-actions"><span id="profile-status" class="muted"></span><button class="primary">Save changes</button></div>`;f.onsubmit=async e=>{e.preventDefault();try{await api('/tenant/profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(f)))});$('#profile-status').textContent='Saved';setTimeout(()=>$('#profile-status').textContent='',2500)}catch(err){fail(err)}}}catch(e){fail(e)}}
$('#maintenance-form').onsubmit=async e=>{e.preventDefault();const form=e.target;const body=Object.fromEntries(new FormData(form));if(body.priority==='EMERGENCY'&&!window.confirm('This pages after hours. Use only for active leak, no heat, no power, lockout, or safety issue.'))return;try{const created=await api('/tenant/maintenance/new',{method:'POST',body:JSON.stringify(body)});form.reset();await loadMaintenance();await maintenanceDetail(created.id)}catch(err){fail(err)}};window.maintenanceDetail=maintenanceDetail;window.addTenantComment=addTenantComment;$('#logout').onclick=async()=>{await api('/logout',{method:'POST'});location.href='/login'};window.addEventListener('hashchange',route);route();
