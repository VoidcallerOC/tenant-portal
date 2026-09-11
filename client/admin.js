const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
function photoMarkup(url,title){return url?`<img class="maintenance-photo" src="${esc(url)}" alt="${esc(title)}" loading="lazy">`:''}
function badge(v){return `<span class="badge ${(v||'').toLowerCase()}">${esc((v||'').replace('_',' '))}</span>`}
async function api(url,options){
  const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options?.headers||{})},...options});
  if(r.status===401){location.href='/login';throw Error('Your session has expired.');}
  if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||'Something went wrong.');}
  return r.status===204?null:r.json();
}
function fail(e){$('#error').textContent=e.message;$('#error').hidden=false}
function clearFail(){$('#error').hidden=true}
function money(v){return v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v))}
function route(){
  const raw=(location.hash.slice(1)||'overview').split('?')[0];
  const propertyMatch=raw.match(/^property\/([0-9a-f-]{36})$/i);
  if(propertyMatch){
    showView('properties');
    setPropertyListVisible(false);
    detail(propertyMatch[1]);
    return;
  }
  showView(raw||'overview');
  if(raw==='properties') setPropertyListVisible(true);
  if(raw==='overview')loadDashboard();
  if(raw==='properties')loadProperties();
  if(raw==='tenants')loadTenants();
  if(raw==='maintenance')loadMaintenance();
  if(raw==='payments')loadPayments();
}
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active', a.getAttribute('href')==='#properties' ? id==='properties' : a.getAttribute('href')==='#'+id));
}
function setPropertyListVisible(showList){
  const form=$('#property-form');
  const list=$('#property-list');
  const add=$('#show-property-form');
  const head=$('#properties .section-head');
  if(form) form.hidden=true;
  if(list) list.hidden=!showList;
  if(add) add.hidden=!showList;
  if(head) head.hidden=!showList;
  if(showList) $('#property-detail').innerHTML='';
}
function openProperty(id){location.hash='property/'+id}
function closeProperty(){location.hash='properties'}
function stat(label,value){return `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`}
async function loadDashboard(){
  try{
    clearFail();
    const d=await api('/admin/dashboard');
    if(d.user){$('#user-name').textContent=d.user.firstName;$('#user-avatar').textContent=(d.user.firstName[0]+d.user.lastName[0]).toUpperCase();}
    $('#stats').innerHTML=stat('Properties',d.stats.properties)+stat('Total units',d.stats.units)+stat('Occupied',d.stats.occupied)+stat('Vacant',d.stats.vacant)+stat('Active tenants',d.stats.activeTenants)+stat('Open requests',d.stats.openMaintenance);
    $('#recent-maintenance').classList.remove('loading');
    $('#recent-maintenance').innerHTML=d.recentRequests.length?d.recentRequests.map(x=>`<div class="list-item"><div><strong>${esc(x.request.title)}</strong><small>${esc(x.user.firstName+' '+x.user.lastName)} · ${esc(x.property.name)} ${esc(x.unit.unitNumber)}</small></div><span class="badge ${x.request.status.toLowerCase()}">${esc(x.request.status.replace('_',' '))}</span></div>`).join(''):'<p class="muted">No maintenance requests yet.</p>';
    $('#recent-tenants').classList.remove('loading');
    $('#recent-tenants').innerHTML=d.recentTenants.length?d.recentTenants.map(x=>`<div class="list-item"><div><strong>${esc(x.user.firstName+' '+x.user.lastName)}</strong><small>${esc(x.user.email)}</small></div><span class="badge active">Tenant</span></div>`).join(''):'<p class="muted">No tenants yet.</p>';
    $('#overview-properties').classList.remove('loading');
    $('#overview-properties').innerHTML=d.propertyOverview.length?d.propertyOverview.map(x=>propertyCard(x)).join(''):'<p class="muted">No properties yet.</p>';
  }catch(e){fail(e)}
}
function propertyCard(x){
  const pct=x.unitCount?Math.round(x.occupied/x.unitCount*100):0;
  return `<article class="property-card"><h3>${esc(x.property.name)}</h3><p>${esc(x.property.addressLine1)}, ${esc(x.property.city)}, ${esc(x.property.state)}</p><div class="bar"><span style="width:${pct}%"></span></div><div class="property-meta"><span>${x.unitCount} units</span><span>${pct}% occupied</span></div></article>`;
}
async function loadProperties(){
  try{
    const rows=await api('/admin/properties');
    $('#property-list').classList.remove('loading');
    $('#property-list').hidden=false;
    $('#property-list').innerHTML=rows.length?rows.map(x=>`<article class="property-card"><h3>${esc(x.property.name)}</h3><p>${esc(x.property.addressLine1)}, ${esc(x.property.city)}, ${esc(x.property.state)} ${esc(x.property.zip)}</p><div class="bar"><span style="width:${x.unitCount?x.occupied/x.unitCount*100:0}%"></span></div><div class="property-meta"><span>${x.unitCount} units · ${x.occupied} occupied</span><button type="button" class="ghost" onclick="openProperty('${x.property.id}')">Open</button></div></article>`).join(''):'<div class="panel"><p class="muted">No properties yet. Add your first property to get started.</p></div>';
  }catch(e){fail(e)}
}
let lastProperty=null;
async function detail(id){
  try{
    clearFail();
    const d=await api('/admin/properties/'+id);
    lastProperty=d;
    $('#property-detail').innerHTML=`<article class="panel">
      <div class="panel-head">
        <div>
          <button type="button" class="ghost" onclick="closeProperty()">Back to properties</button>
          <p class="eyebrow" style="margin-top:16px">Property detail</p>
          <h2>${esc(d.property.name)}</h2>
          <p class="muted">${esc(d.property.addressLine1)}, ${esc(d.property.city)}, ${esc(d.property.state)} ${esc(d.property.zip)}</p>
        </div>
        <button type="button" class="primary" onclick="unitForm('${id}')">+ Add unit</button>
      </div>
      <div id="unit-editor"></div>
      <h3 style="margin-top:26px">Units</h3>
      <div class="table-wrap"><table><thead><tr><th>Unit</th><th>Bedrooms</th><th>Bathrooms</th><th>Status</th><th></th></tr></thead>
      <tbody>${d.units.length?d.units.map(u=>`<tr><td><strong>${esc(u.unitNumber)}</strong></td><td>${u.bedrooms??'—'}</td><td>${u.bathrooms??'—'}</td><td><span class="badge ${u.status.toLowerCase()}">${u.status}</span></td><td><button type="button" class="ghost" onclick="unitForm('${id}','${u.id}')">Edit</button></td></tr>`).join(''):'<tr><td colspan="5" class="muted">No units yet.</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:26px">Residents and maintenance</h3>
      <p class="muted">${d.tenants.length} tenant lease(s) · ${d.maintenance.length} maintenance request(s)</p>
    </article>`;
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){fail(e)}
}
function unitForm(propertyId,id=''){
  const row=(lastProperty&&lastProperty.units||[]).find(u=>u.id===id)||{};
  $('#unit-editor').innerHTML=`<form class="form-grid" style="margin-top:18px" onsubmit="saveUnit(event,'${propertyId}','${id}')">
    <label>Unit number<input name="unitNumber" required value="${esc(row.unitNumber||'')}"></label>
    <label>Bedrooms<input name="bedrooms" type="number" min="0" value="${row.bedrooms??''}"></label>
    <label>Bathrooms<input name="bathrooms" type="number" step="0.5" min="0" value="${row.bathrooms??''}"></label>
    <label>Status<select name="status">
      <option ${row.status==='VACANT'||!row.status?'selected':''}>VACANT</option>
      <option ${row.status==='OCCUPIED'?'selected':''}>OCCUPIED</option>
      <option ${row.status==='MAINTENANCE'?'selected':''}>MAINTENANCE</option>
    </select></label>
    <div class="form-actions">
      <button type="button" class="ghost" onclick="$('#unit-editor').innerHTML=''">Cancel</button>
      <button class="primary">Save unit</button>
    </div>
  </form>`;
}
async function saveUnit(e,pid,id){
  e.preventDefault();
  try{
    const body=Object.fromEntries(new FormData(e.target));
    body.bedrooms=body.bedrooms?Number(body.bedrooms):null;
    body.bathrooms=body.bathrooms?Number(body.bathrooms):null;
    await api(id?`/admin/properties/${pid}/units/${id}`:'/admin/properties/'+pid+'/units',{method:id?'PATCH':'POST',body:JSON.stringify(body)});
    await detail(pid);
  }catch(err){fail(err)}
}
async function loadTenants(){
  try{
    const rows=await api('/admin/tenants');
    $('#tenant-list').innerHTML=rows.length?rows.map(x=>`<tr><td><strong>${esc(x.user.firstName+' '+x.user.lastName)}</strong></td><td>${esc(x.user.email)}</td><td>${esc(x.tenant.phone||'—')}</td><td>${esc(x.property?.name||'—')} / ${esc(x.unit?.unitNumber||'—')}</td><td><span class="badge ${(x.lease?.status||'').toLowerCase()}">${esc(x.lease?.status||'No lease')}</span></td><td>${x.lease?.status==='ACTIVE'?'<span class="muted">Assigned</span>':`<button type="button" class="ghost" onclick="leaseForm('${x.tenant.id}')">Assign lease</button>`}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">No tenants yet.</td></tr>';
  }catch(e){fail(e)}
}
async function leaseForm(tenantId){
  try{
    const options=await api('/admin/lease-options');
    $('#lease-editor').innerHTML=`<form class="panel form-grid" onsubmit="saveLease(event,'${tenantId}')"><h2>Assign lease</h2>
      <label>Unit<select name="unitId" required>${options.units.map(u=>`<option value="${u.id}">${esc(u.propertyName)} · ${esc(u.unitNumber)}</option>`).join('')}</select></label>
      <label>Start date<input name="startDate" type="date" required></label>
      <label>End date<input name="endDate" type="date"></label>
      <label>Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required></label>
      <label>Security deposit<input name="securityDeposit" type="number" min="0" step="0.01"></label>
      <label>Status<select name="status"><option selected>ACTIVE</option><option>PENDING</option></select></label>
      <div class="form-actions"><button type="button" class="ghost" onclick="$('#lease-editor').innerHTML=''">Cancel</button><button class="primary">Assign lease</button></div></form>`;
  }catch(e){fail(e)}
}
async function saveLease(e,tenantId){
  e.preventDefault();
  try{
    await api('/admin/tenants/'+tenantId+'/lease',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    $('#lease-editor').innerHTML='';
    await loadTenants();
  }catch(err){fail(err)}
}
async function loadMaintenance(){
  try{
    const rows=await api('/admin/maintenance');
    $('#maintenance-list').innerHTML=rows.length?rows.map(x=>`<tr><td><strong>${esc(x.request.title)}</strong><br><small>${esc(x.request.description)}</small></td><td>${esc(x.user.firstName+' '+x.user.lastName)}</td><td>${esc(x.property.name)} / ${esc(x.unit.unitNumber)}</td><td><span class="badge ${x.request.priority.toLowerCase()}">${x.request.priority}</span></td><td><select onchange="changeStatus('${x.request.id}',this.value)"><option ${x.request.status==='OPEN'?'selected':''}>OPEN</option><option ${x.request.status==='IN_PROGRESS'?'selected':''}>IN_PROGRESS</option><option ${x.request.status==='RESOLVED'?'selected':''}>RESOLVED</option><option ${x.request.status==='CLOSED'?'selected':''}>CLOSED</option></select></td><td><button type="button" class="ghost" onclick="maintenanceDetail('${x.request.id}')">Open</button></td></tr>`).join(''):'<tr><td colspan="6" class="muted">No maintenance requests yet.</td></tr>';
  }catch(e){fail(e)}
}
async function changeStatus(id,status){
  try{
    await api('/admin/maintenance/'+id,{method:'PATCH',body:JSON.stringify({status})});
    await loadMaintenance();
    if($('#maintenance-detail').dataset.requestId===id) await maintenanceDetail(id);
  }catch(e){fail(e)}
}
async function maintenanceDetail(id){
  try{
    const d=await api('/admin/maintenance/'+id);
    $('#maintenance-detail').dataset.requestId=id;
    $('#maintenance-detail').innerHTML=`<article class="panel" style="margin-top:20px"><div class="panel-head"><div><p class="eyebrow">Request details</p><h2>${esc(d.request.title)}</h2><p class="muted">${esc(d.user.firstName+' '+d.user.lastName)} · ${esc(d.property.name)} / ${esc(d.unit.unitNumber)}</p></div><span class="badge ${d.request.status.toLowerCase()}">${esc(d.request.status.replace('_',' '))}</span></div><p>${esc(d.request.description)}</p>${photoMarkup(d.request.photoUrl,d.request.title)}<h3>Timeline</h3><div>${d.comments.length?d.comments.map(x=>`<p><strong>${esc(x.user.firstName+' '+x.user.lastName)}</strong> <small>${new Date(x.comment.createdAt).toLocaleString()}</small><br>${esc(x.comment.body)}</p>`).join(''):'<p class="muted">No comments yet.</p>'}</div><form onsubmit="addAdminComment(event,'${id}')" class="form-actions"><input name="body" required maxlength="5000" placeholder="Add a management comment"><button class="primary">Add comment</button></form></article>`;
    $('#maintenance-detail').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){fail(e)}
}
async function loadPayments(){
  try{
    const status=$('#charge-status-filter')?.value;
    const rows=await api('/admin/charges'+(status?'?status='+encodeURIComponent(status):''));
    const body=$('#payments-list');
    body.classList.remove('loading');
    const today=new Date();today.setHours(0,0,0,0);
    body.innerHTML=rows.length?rows.map(x=>{
      const late=(x.charge.status==='DUE'||x.charge.status==='OPEN')&&new Date(x.charge.periodStart+'T00:00:00')<today;
      return `<tr class="${late?'late-charge':''}"><td><strong>${esc(x.user.firstName+' '+x.user.lastName)}</strong><br><small>${esc(x.user.email)}</small></td><td>${esc(x.property.name)} / ${esc(x.unit.unitNumber)}</td><td>${esc(x.charge.periodStart.slice(0,7))}<br><small>Due ${new Date(x.dueDate+'T00:00:00').toLocaleDateString()}${late?' · Late':''}</small></td><td>${money(x.charge.amount)}</td><td>${badge(x.charge.status)}</td><td>${x.charge.paidAt?new Date(x.charge.paidAt).toLocaleString():'—'}</td></tr>`;
    }).join(''):'<tr><td colspan="6" class="muted">No rent charges yet.</td></tr>';
  }catch(e){fail(e)}
}
async function addAdminComment(e,id){
  e.preventDefault();
  try{
    await api('/admin/maintenance/'+id+'/comments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    await maintenanceDetail(id);
  }catch(err){fail(err)}
}
$('#show-property-form').onclick=()=>{$('#property-form').hidden=false};
$('#cancel-property').onclick=()=>{$('#property-form').hidden=true};
$('#property-form').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/admin/properties',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    e.target.reset();
    e.target.hidden=true;
    await loadProperties();
  }catch(err){fail(err)}
};
$('#show-tenant-form').onclick=()=>{$('#tenant-form').hidden=false};
$('#cancel-tenant').onclick=()=>{$('#tenant-form').hidden=true};
$('#tenant-form').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/admin/tenants',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    e.target.reset();
    e.target.hidden=true;
    await loadTenants();
  }catch(err){fail(err)}
};
$('#charge-status-filter').onchange=()=>loadPayments();
$('#logout').onclick=async()=>{await api('/logout',{method:'POST'});location.href='/login'};
window.openProperty=openProperty;
window.closeProperty=closeProperty;
window.detail=detail;
window.changeStatus=changeStatus;
window.maintenanceDetail=maintenanceDetail;
window.addAdminComment=addAdminComment;
window.unitForm=unitForm;
window.saveUnit=saveUnit;
window.leaseForm=leaseForm;
window.saveLease=saveLease;
window.addEventListener('hashchange',route);
route();
