'use strict';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzYTvGLDpeLlW6FqIl1KX1tpOcatmjrnkKiUYL1jfx7tCHs8jPmX8Zm2wqMJsfR11Vm/exec';
const GOOGLE_CLIENT_ID = '992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com';
const TOKEN_KEY = 'sp_committee_token';
const $ = id => document.getElementById(id);
const SCALE = ['ไม่ผ่าน','ต้องปรับปรุง','พอใช้','ดี','ดีเยี่ยม'];
let assessments = [], evaluator = null, token = null, students = [], records = [];
let selectedStudent = null, scores = {}, originalScores = {}, busy = false, loading = false, loaded = false;
let studentFilter = 'all', authVersion = 0, workspaceVersion = 0, activeView = 'overview';
const defense = () => assessments.find(a => a.id === 'defense');
const ownRecord = (id, section = 'defense') => records.find(r => r.studentId === id && r.assessment === section);
const pending = () => students.filter(s => !ownRecord(s.id));
const dirty = () => JSON.stringify(scores) !== JSON.stringify(originalScores);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="icons.svg#${name}"/></svg>`;
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'ไม่ระบุเวลา' : date.toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }
function displayMessage(text, error = false) { $('globalMessage').textContent = text; $('globalMessage').className = 'alert ' + (error ? 'error' : 'success'); $('globalMessage').hidden = false; }
function storageSet(value) { try { if (value) sessionStorage.setItem(TOKEN_KEY,value); else sessionStorage.removeItem(TOKEN_KEY); } catch {} }
function storageGet() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
async function api(action, params = {}) {
  const url = new URL(GAS_URL); url.searchParams.set('action',action);
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,value));
  const response = await fetch(url);
  if (!response.ok) throw new Error('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
  const result = await response.json();
  if (result.status === 'error') throw new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
  return result;
}
function setMobileMenu(open) { $('sidebar').classList.toggle('mobile-open',open); $('navOverlay').hidden = !open; $('menuToggle').setAttribute('aria-expanded',String(open)); }
function allowLeave() { return !busy && (!dirty() || confirm('มีคะแนนที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้และยกเลิกการแก้ไขหรือไม่?')); }
function navigate(view, options = {}) {
  if (!['overview','students','grade','history','guide'].includes(view)) view = 'overview';
  if (view === 'grade' && !selectedStudent && $('saveSuccess').hidden) view = 'students';
  if (activeView === 'grade' && view !== 'grade' && !options.force) {
    if (!allowLeave()) return false;
    scores = {}; originalScores = {}; selectedStudent = null;
  }
  activeView = view;
  history.replaceState(null,'','#'+view);
  setMobileMenu(false);
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== 'view-'+view || !loaded; });
  document.querySelectorAll('[data-route]').forEach(link => { const selected = link.dataset.route === view || view === 'grade' && link.dataset.route === 'students'; if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
  const titles = {overview:'ภาพรวมงานของฉัน',students:'รายชื่อนิสิต',grade:'ให้คะแนนสอบวิพากษ์',history:'ประวัติการประเมิน',guide:'คู่มือและเกณฑ์'};
  document.title = titles[view]+' · ปัญหาพิเศษ';
  if (loaded) renderCurrentView();
  if (!options.keepScroll) window.scrollTo({top:0,behavior:'instant'});
  return true;
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.getAttribute('href') === '#mainContent') return;
  event.preventDefault(); navigate(link.getAttribute('href').slice(1));
});
window.addEventListener('hashchange', () => { const desired = location.hash.slice(1); if (!navigate(desired)) history.replaceState(null,'','#'+activeView); });
$('menuToggle').addEventListener('click', () => setMobileMenu(!$('sidebar').classList.contains('mobile-open')));
$('navOverlay').addEventListener('click', () => setMobileMenu(false));
window.addEventListener('keydown', event => { if (event.key === 'Escape') setMobileMenu(false); });
async function login(credential) {
  const version = ++authVersion;
  $('authStatus').textContent = 'กำลังตรวจสอบบัญชีกรรมการ…';
  try {
    const identity = await api('getMyEvaluatorInfo',{idToken:credential});
    if (version !== authVersion) return;
    if (!identity.ok) throw new Error(identity.reason === 'not_committee_member' ? 'บัญชีนี้ยังไม่มีสิทธิ์กรรมการ กรุณาเลือกบัญชีที่ลงทะเบียนไว้ หรือติดต่อผู้ดูแลรายวิชา' : 'การเข้าสู่ระบบหมดอายุ กรุณาเลือกบัญชี Google อีกครั้ง');
    token = credential; evaluator = identity; storageSet(token);
    $('evaluatorName').textContent = identity.name; $('evaluatorEmail').textContent = identity.email;
    $('userAvatar').textContent = identity.name.replace(/^อาจารย์(?:ดร\.)?/,'').trim().slice(0,1) || 'ก';
    $('loginScreen').hidden = true; $('appShell').hidden = false;
    activeView = location.hash.slice(1) || 'overview';
    await loadWorkspace();
  } catch(error) { if (version === authVersion) { storageSet(null); $('authStatus').textContent = error.message; } }
}
function logout(expired = false) {
  if (!expired && !allowLeave()) return;
  authVersion++; workspaceVersion++; evaluator = null; token = null; loaded = false; loading = false;
  students = []; records = []; scores = {}; originalScores = {}; selectedStudent = null; storageSet(null);
  $('appShell').hidden = true; $('loginScreen').hidden = false;
  $('authStatus').textContent = expired ? 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'เลือกบัญชี Google เพื่อเข้าสู่ระบบ';
  if ($('reviewDialog').open) $('reviewDialog').close();
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  history.replaceState(null,'','#overview');
}
$('logout').addEventListener('click', () => logout());
async function loadWorkspace() {
  if (!token || loading || busy) return;
  const version = ++workspaceVersion; loading = true; loaded = false;
  $('workspaceLoading').hidden = false; $('workspaceError').hidden = true; $('globalMessage').hidden = true;
  document.querySelectorAll('.view').forEach(node => { node.hidden = true; });
  try {
    const [config,data] = await Promise.all([api('getCriteria'),api('getMyWorkspace',{idToken:token})]);
    if (version !== workspaceVersion) return;
    if (data.status === 'unauthorized') { logout(true); return; }
    if (!Array.isArray(config.assessments) || data.status !== 'ok' || !Array.isArray(data.students) || !Array.isArray(data.records)) throw new Error('ระบบยังไม่พร้อมโหลดพื้นที่ทำงาน กรุณาติดต่อผู้ดูแลรายวิชา');
    assessments = config.assessments; students = data.students; records = data.records;
    if (!defense()?.criteria?.length) throw new Error('ไม่พบเกณฑ์สอบวิพากษ์');
    loaded = true; populateRooms(); renderAll(); navigate(activeView,{force:true});
  } catch(error) { if (version === workspaceVersion) { $('workspaceErrorText').textContent = error.message; $('workspaceError').hidden = false; } }
  finally { if (version === workspaceVersion) { loading = false; $('workspaceLoading').hidden = true; } }
}
$('retryWorkspace').addEventListener('click',loadWorkspace);
$('refreshWorkspace').addEventListener('click',loadWorkspace);
function renderAll() { renderOverview(); renderStudents(); renderHistory(); renderGuide(); $('navPending').textContent = pending().length; }
function renderCurrentView() { if (activeView === 'overview') renderOverview(); if (activeView === 'students') renderStudents(); if (activeView === 'history') renderHistory(); if (activeView === 'guide') renderGuide(); }
function studentInfoNode(student, compact = false) {
  const wrap = el('div','student-info'); wrap.append(el('strong','',student.name),el('span','student-id',student.id));
  if (!compact) wrap.append(el('p','student-topic',student.topic || 'ยังไม่ระบุหัวข้อโครงงาน'));
  return wrap;
}
function actionButton(student, compact = false) {
  const record = ownRecord(student.id), button = el('button','btn '+(record ? 'secondary' : ''),record ? 'แก้ไขคะแนน' : 'ให้คะแนน');
  button.type = 'button'; button.setAttribute('aria-label',(record?'แก้ไขคะแนน ':'ให้คะแนน ')+student.name); if (compact) button.classList.add('small');
  button.addEventListener('click', () => openStudent(student.id)); return button;
}
function previewRow(student, record) {
  const row = el('div','preview-row'), avatar = el('span','mini-avatar',student.name.slice(0,1)); row.append(avatar,studentInfoNode(student,true));
  if (record) { row.append(el('strong','preview-score',Number(record.total).toFixed(2)+'/20')); }
  else row.append(actionButton(student,true));
  return row;
}
function renderOverview() {
  const done = students.length-pending().length, total = students.length, remaining = pending().length;
  $('welcomeText').textContent = 'สวัสดี '+evaluator.name+' · '+[...new Set(evaluator.assignments.map(a=>'ห้อง '+a.room+' ภาค'+a.term))].join(' / ');
  $('myStats').replaceChildren();
  [{label:'นิสิตที่รับผิดชอบ',value:total,unit:'คน',icon:'users',tone:'navy'},{label:'ประเมินแล้ว',value:done,unit:'คน',icon:'check',tone:'sage'},{label:'รอประเมิน',value:remaining,unit:'คน',icon:'clock',tone:'amber'}].forEach(item => {
    const card = el('div','stat-card');const badge = el('span','stat-icon '+item.tone);badge.innerHTML = icon(item.icon); const text = el('div');text.append(el('span','stat-label',item.label));const number = el('div','stat-value');number.append(el('strong','',item.value),el('span','',item.unit));text.append(number);card.append(badge,text);$('myStats').append(card);
  });
  $('focusTitle').textContent = !total ? 'ยังไม่มีรายชื่อนิสิตที่ได้รับมอบหมาย' : remaining ? 'เหลือนิสิตอีก '+remaining+' คนที่รอการประเมิน' : 'ประเมินครบทุกคนแล้ว';
  $('focusDescription').textContent = !total ? 'ติดต่อผู้ดูแลเพื่อตรวจสอบการมอบหมายห้องสอบและแผนการเรียน' : remaining ? 'เลือกนิสิตจากรายชื่อ แล้วให้คะแนน 5 เกณฑ์ รวม 20 คะแนน' : 'ตรวจคะแนนย้อนหลังหรือแก้ไขได้จากประวัติการประเมิน';
  $('overviewProgress').max = total || 1; $('overviewProgress').value = done;
  $('overviewProgressLabel').textContent = done+' / '+total+' คน';
  $('continueScoring').textContent = remaining ? 'ประเมินคนถัดไป →' : 'ดูประวัติการประเมิน →';
  $('pendingPreview').replaceChildren(); pending().slice(0,4).forEach(s => $('pendingPreview').append(previewRow(s)));
  if (!remaining) $('pendingPreview').append(el('p','empty-inline',total ? 'ประเมินครบแล้ว ขอบคุณสำหรับการประเมิน' : 'ยังไม่มีรายชื่อที่ได้รับมอบหมาย'));
  $('recentPreview').replaceChildren(); const recent = records.filter(r=>r.assessment==='defense').sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,4);
  recent.forEach(r => { const s=students.find(s=>s.id===r.studentId);if(s)$('recentPreview').append(previewRow(s,r)); });
  if(!recent.length)$('recentPreview').append(el('p','empty-inline','ยังไม่มีคะแนนสอบวิพากษ์ที่บันทึก'));
  $('assessmentPlan').replaceChildren();
  assessments.forEach(a=>{const item=el('div','plan-item '+a.status);const heading=el('div');heading.append(el('span','plan-label',a.label),el('span','badge '+(a.status==='open'?'sage':a.status==='completed'?'neutral':'warning'),a.status==='open'?'เปิดประเมิน':a.status==='completed'?'เก็บคะแนนแล้ว':'ยังไม่เปิด'));const number=el('div','plan-points');number.append(el('strong','',a.max),el('span','','คะแนน'));item.append(heading,number);if(a.status==='open'){const link=el('a','text-link','ไปรายชื่อนิสิต →');link.href='#students';item.append(link);}else item.append(el('span','helper',a.status==='completed'?'ดูคะแนนของคุณได้ในประวัติ':'วางแผนไว้ ยังไม่รับคะแนน'));$('assessmentPlan').append(item);});
}
$('continueScoring').addEventListener('click',()=>{const next=pending()[0];if(next)openStudent(next.id);else navigate('history');});
function populateRooms() {
  const previous=$('roomFilter').value;$('roomFilter').replaceChildren(new Option('ทุกห้อง / แผนการเรียน',''));
  const groups=[...new Set(students.map(s=>s.term+'|'+s.room))];groups.forEach(key=>{const [term,room]=key.split('|');$('roomFilter').add(new Option(room+' · ภาค'+term,key));});
  if(groups.includes(previous))$('roomFilter').value=previous;
  $('assignedLabel').textContent=students.length+' คนที่ได้รับมอบหมาย';
}
function renderStudents() {
  const query=$('studentSearch').value.trim().toLowerCase(), room=$('roomFilter').value;
  const filtered=students.filter(s=>(s.name+s.id+s.topic).toLowerCase().includes(query)&&(!room||s.term+'|'+s.room===room)&&(studentFilter==='all'||(studentFilter==='done')===!!ownRecord(s.id)));
  $('studentRows').replaceChildren();filtered.forEach(s=>{const record=ownRecord(s.id),tr=el('tr');const name=el('td');name.append(studentInfoNode(s));const roomCell=el('td');roomCell.append(el('span','room-name',s.room),el('small','', 'ภาค'+s.term));const status=el('td');status.append(el('span','badge '+(record?'sage':'warning'),record?'ประเมินแล้ว':'รอประเมิน'));const score=el('td','table-score',record?Number(record.total).toFixed(2)+' / 20':'—');const action=el('td');action.append(actionButton(s));tr.append(name,roomCell,status,score,action);$('studentRows').append(tr);});
  $('studentEmpty').hidden=!!filtered.length;$('studentResultCount').textContent='แสดง '+filtered.length+' จาก '+students.length+' คน';
  document.querySelectorAll('[data-filter]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.filter===studentFilter));});
}
$('studentSearch').addEventListener('input',renderStudents);$('roomFilter').addEventListener('change',renderStudents);
$('studentTabs').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(button){studentFilter=button.dataset.filter;renderStudents();}});
$('clearStudentFilters').addEventListener('click',()=>{$('studentSearch').value='';$('roomFilter').value='';studentFilter='all';renderStudents();});
function openStudent(id) {
  if (!allowLeave()) return;
  const student=students.find(s=>s.id===id);if(!student)return;
  selectedStudent=student;const record=ownRecord(id);scores=record?{...record.scores}:{};originalScores={...scores};
  $('gradeContent').hidden=false;$('saveSuccess').hidden=true;$('globalMessage').hidden=true;
  $('gradeStudentName').textContent=student.name;$('gradeStudentMeta').textContent=student.id+' · '+student.room+' · ภาค'+student.term;
  $('gradeStudentAdvisor').textContent='อาจารย์ที่ปรึกษา: '+student.advisor;$('gradeStudentTopic').textContent=student.topic;
  $('editingNotice').hidden=!record;$('editingNotice').textContent=record?'กำลังแก้ไขคะแนนที่บันทึกเมื่อ '+dateLabel(record.updatedAt)+' · การยืนยันจะอัปเดตคะแนนเดิมของคุณ':'';
  renderRubric();navigate('grade',{force:true});
}
function renderRubric() {
  $('criteria').replaceChildren();
  defense().criteria.forEach((c,index)=>{
    const field=el('fieldset','criterion-card card');const legend=el('legend');legend.append(el('span','criterion-number',String(index+1)),el('span','',c.label));
    const meta=el('div','criterion-meta');meta.append(el('span','badge neutral',c.mapping),el('span','criterion-weight','เต็ม '+c.weight+' คะแนน'));
    const evidence=el('p','criterion-evidence',c.evidence);const scale=el('div','scale');
    SCALE.forEach((label,value)=>{const option=el('label'),input=el('input'),box=el('span'),number=el('b','',value);input.type='radio';input.name=c.key;input.value=value;input.checked=scores[c.key]===value;input.setAttribute('aria-label',value+' '+label);input.addEventListener('change',()=>{scores[c.key]=value;updateTotal();updateLevel(c);});box.append(number,el('span','',label));option.append(input,box);scale.append(option);});
    const selected=el('div','selected-level');selected.id='level-'+c.key;selected.setAttribute('aria-live','polite');
    const details=el('details'),summary=el('summary','','ดูคำอธิบายทุกระดับ');const list=el('ol');list.start=0;c.levels.forEach(level=>list.append(el('li','',level)));details.append(summary,list);
    field.append(legend,meta,evidence,scale,selected,details);$('criteria').append(field);updateLevel(c);
  });updateTotal();
}
function updateLevel(c){const node=$('level-'+c.key),value=scores[c.key];node.textContent=value===undefined?'เลือกคะแนน 0–4 ที่ตรงกับผลงาน':value+' · '+c.levels[value];node.classList.toggle('chosen',value!==undefined);}
function totalScore(){return defense().criteria.reduce((sum,c)=>sum+(scores[c.key]??0)/4*c.weight,0);}
function updateTotal(){
  const criteria=defense().criteria,count=criteria.filter(c=>Number.isInteger(scores[c.key])).length;
  $('total').textContent=totalScore().toFixed(2);$('completion').textContent='ให้คะแนนแล้ว '+count+' / '+criteria.length+' เกณฑ์';$('scoreProgress').value=count;
  $('scoreBreakdown').replaceChildren();criteria.forEach((c,i)=>{const row=el('div','breakdown-row');row.append(el('span','', 'เกณฑ์ '+(i+1)),el('strong','',scores[c.key]===undefined?'— / '+c.weight:(scores[c.key]/4*c.weight).toFixed(2)+' / '+c.weight));$('scoreBreakdown').append(row);});
  $('reviewScore').disabled=busy||count!==criteria.length;
}
$('scoreForm').addEventListener('submit',event=>{
  event.preventDefault();if($('reviewScore').disabled||!selectedStudent||busy)return;
  $('reviewStudent').textContent=selectedStudent.name+' · '+selectedStudent.id;
  $('reviewDetails').replaceChildren();defense().criteria.forEach((c,i)=>{const row=el('div','review-row');row.append(el('span','',(i+1)+'. '+c.label),el('strong','',(scores[c.key]/4*c.weight).toFixed(2)+' / '+c.weight));$('reviewDetails').append(row);});
  $('reviewTotal').textContent=totalScore().toFixed(2)+' / 20';$('reviewUpdateNotice').textContent=ownRecord(selectedStudent.id)?'คุณกำลังอัปเดตคะแนนเดิมของตนเอง ระบบจะไม่เพิ่มรายการซ้ำ':'ผู้ประเมิน: '+evaluator.name;
  $('saveError').hidden=true;$('reviewDialog').showModal();
});
function closeReview(){if(!busy)$('reviewDialog').close();}
$('closeReview').addEventListener('click',closeReview);$('backToGrade').addEventListener('click',closeReview);
$('reviewDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('confirmSave').addEventListener('click',async()=>{
  if(busy||!selectedStudent)return;busy=true;const student=selectedStudent,payloadScores={...scores};$('confirmSave').disabled=true;$('confirmSave').textContent='กำลังบันทึก…';$('backToGrade').disabled=true;$('closeReview').disabled=true;$('saveError').hidden=true;
  try{
    const response=await fetch(GAS_URL,{method:'POST',body:JSON.stringify({assessment:'defense',idToken:token,studentId:student.id,scores:payloadScores})});
    if(!response.ok)throw new Error('เชื่อมต่อระบบไม่สำเร็จ');const result=await response.json();
    if(result.status==='unauthorized'){logout(true);return;}
    if(!['created','updated'].includes(result.status))throw new Error(result.message||'บันทึกไม่สำเร็จ');
    records=records.filter(r=>!(r.assessment==='defense'&&r.studentId===student.id));records.push({assessment:'defense',studentId:student.id,scores:payloadScores,total:result.total,updatedAt:new Date().toISOString()});
    scores={};originalScores={};selectedStudent=null;$('reviewDialog').close();$('gradeContent').hidden=true;$('saveSuccess').hidden=false;
    $('savedStudent').textContent=student.name+' · '+student.id;$('savedTotal').textContent=Number(result.total).toFixed(2);
    $('nextStudent').textContent=pending().length?'ประเมินคนถัดไป →':'กลับภาพรวมงานของฉัน';renderAll();window.scrollTo({top:0,behavior:'instant'});
  }catch(error){$('saveError').textContent=error.message+' หากไม่แน่ใจว่าสำเร็จ สามารถยืนยันซ้ำได้โดยไม่เพิ่มรายการซ้ำ';$('saveError').hidden=false;}
  finally{busy=false;$('confirmSave').disabled=false;$('confirmSave').textContent='ยืนยันบันทึกคะแนน';$('backToGrade').disabled=false;$('closeReview').disabled=false;}
});
$('nextStudent').addEventListener('click',()=>{const next=pending()[0];if(next)openStudent(next.id);else navigate('overview');});
function renderHistory(){
  const section=$('historySection').value,query=$('historySearch').value.trim().toLowerCase(),assessment=assessments.find(a=>a.id===section);
  const list=records.filter(r=>{const s=students.find(s=>s.id===r.studentId);return r.assessment===section&&s&&(s.name+s.id).toLowerCase().includes(query);}).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  $('historyRows').replaceChildren();list.forEach(r=>{const s=students.find(s=>s.id===r.studentId),tr=el('tr'),name=el('td');name.append(studentInfoNode(s,true));const type=el('td');type.append(el('span','badge neutral',assessment.label));const score=el('td','table-score',Number(r.total).toFixed(2)+' / '+assessment.max),date=el('td','date-cell',dateLabel(r.updatedAt)),action=el('td');if(section==='defense')action.append(actionButton(s));else action.append(el('span','helper','ปิดรับคะแนนแล้ว'));tr.append(name,type,score,date,action);$('historyRows').append(tr);});$('historyEmpty').hidden=!!list.length;
}
$('historySearch').addEventListener('input',renderHistory);$('historySection').addEventListener('change',renderHistory);
function renderGuide(){
  $('guideCriteria').replaceChildren();defense().criteria.forEach((c,index)=>{const detail=el('details','card guide-criterion'),summary=el('summary');summary.append(el('span','',(index+1)+'. '+c.label),el('span','badge neutral',c.weight+' คะแนน'));const meta=el('p','helper',c.mapping+' · '+c.evidence),list=el('ol','guide-levels');list.start=0;c.levels.forEach((level,i)=>{const li=el('li');li.append(el('strong','',SCALE[i]),el('p','',level));list.append(li);});detail.append(summary,meta,list);$('guideCriteria').append(detail);});
}
window.addEventListener('beforeunload',event=>{if(busy||dirty()){event.preventDefault();event.returnValue='';}});
function initializeGoogle(){
  if(!window.google?.accounts?.id){$('authStatus').textContent='โหลด Google Sign-In ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';$('retryAuth').hidden=false;return;}
  google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:response=>login(response.credential)});
  google.accounts.id.renderButton($('googleButton'),{theme:'outline',size:'large',text:'signin_with',locale:'th',width:Math.max(200,Math.min(300,$('googleButton').clientWidth))});
  $('authStatus').textContent='เข้าใช้งานด้วยอีเมลกรรมการที่ลงทะเบียนไว้';$('retryAuth').hidden=true;
  const cached=storageGet();if(cached)login(cached);
}
$('retryAuth').addEventListener('click',initializeGoogle);window.addEventListener('load',initializeGoogle);
