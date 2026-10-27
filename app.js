'use strict';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzYTvGLDpeLlW6FqIl1KX1tpOcatmjrnkKiUYL1jfx7tCHs8jPmX8Zm2wqMJsfR11Vm/exec';
const GOOGLE_CLIENT_ID = '992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com';
const TOKEN_KEY = 'sp_committee_token';
const $ = id => document.getElementById(id);
const SCALE = ['ไม่ผ่าน','ต้องปรับปรุง','พอใช้','ดี','ดีเยี่ยม'];
let assessments = [], evaluator = null, token = null, students = [], records = [];
let selectedStudent = null, scores = {}, originalScores = {}, busy = false, loading = false, loaded = false;
let chartRoomKey='',chartStatus='all';
let studentFilter = 'all', authVersion = 0, workspaceVersion = 0, activeView = 'overview';
const defense = () => assessments.find(a => a.id === 'defense');
const defenseQuestions = () => defense().criteria.flatMap(c => c.questions || []);
const completeQuestionRecord = record => record?.rubricVersion === defense().rubricVersion && defenseQuestions().every(q => Number.isInteger(record.questionScores?.[q.key]) && record.questionScores[q.key] >= 0 && record.questionScores[q.key] <= 4);
const groupPoints = (criterion, answers = scores) => criterion.questions.reduce((sum,q) => sum + (answers[q.key] ?? 0) / 4 * q.weight, 0);
const criterionRawScores = answers => Object.fromEntries(defense().criteria.map(c => [c.key, groupPoints(c,answers) / c.weight * 4]));
const ownRecord = (id, section = 'defense') => records.find(r => r.studentId === id && r.assessment === section);
const pending = () => students.filter(s => !ownRecord(s.id));
const dirty = () => JSON.stringify(scores) !== JSON.stringify(originalScores);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="icons.svg#${name}"/></svg>`;
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'ไม่ระบุเวลา' : date.toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }
function displayMessage(text, error = false) { $('globalMessage').textContent = text; $('globalMessage').className = 'alert ' + (error ? 'error' : 'success'); $('globalMessage').hidden = false; }
function storageSet(value) { try { if (value) sessionStorage.setItem(TOKEN_KEY,value); else sessionStorage.removeItem(TOKEN_KEY); } catch {} }
function storageGet() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
const REQUEST_TIMEOUT_MS = 25000;
function replaceViewUrl(view){try{history.replaceState(null,'','#'+view);}catch{}}
function scrollTopNow(){if(window.SPRecovery)window.SPRecovery.scrollTop();else window.scrollTo(0,0);}
function setMobileMenu(open){if(window.SPUI?.setMenu)window.SPUI.setMenu(open);else if(!open)window.SPRecovery?.resetLayout();}
async function api(action,params={}){
  const url=new URL(GAS_URL);url.searchParams.set('action',action);url.searchParams.set('_ts',String(Date.now()));
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
  const controller=typeof AbortController==='function'?new AbortController():null;let timer;
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{reject(new Error('การเชื่อมต่อใช้เวลานาน กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'));controller?.abort();},REQUEST_TIMEOUT_MS);});
  try{
    return await Promise.race([(async()=>{
      const response=await fetch(url,controller?{signal:controller.signal}:{});
      if(!response.ok)throw new Error('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
      let result;try{result=await response.json();}catch{throw new Error('โหลดข้อมูลไม่สมบูรณ์ กรุณาลองอีกครั้ง');}
      if(result.status==='error')throw new Error(result.message||'โหลดข้อมูลไม่สำเร็จ');return result;
    })(),timeout]);
  }finally{clearTimeout(timer);}
}
function allowLeave() { return !busy && (!dirty() || confirm('มีคะแนนที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้และยกเลิกการแก้ไขหรือไม่?')); }
function navigate(view, options = {}) {
  if (!['overview','students','grade','history','guide'].includes(view)) view = 'overview';
  if (view === 'grade' && !selectedStudent && $('saveSuccess').hidden) view = 'students';
  if (activeView === 'grade' && view !== 'grade' && !options.force) {
    if (!allowLeave()) return false;
    scores = {}; originalScores = {}; selectedStudent = null;
  }
  activeView = view;
  replaceViewUrl(view);
  setMobileMenu(false);
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== 'view-'+view || !loaded; });
  document.querySelectorAll('[data-route]').forEach(link => { const selected = link.dataset.route === view || view === 'grade' && link.dataset.route === 'students'; if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
  const titles = {overview:'ภาพรวมงานของฉัน',students:'รายชื่อนิสิต',grade:'ให้คะแนนสอบวิพากษ์',history:'ประวัติการประเมิน',guide:'คู่มือและเกณฑ์'};
  document.title = titles[view]+' · ปัญหาพิเศษ';
  if (loaded) renderCurrentView();
  if (!options.keepScroll) scrollTopNow();
  return true;
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.getAttribute('href') === '#mainContent') return;
  event.preventDefault(); navigate(link.getAttribute('href').slice(1));
});
window.addEventListener('hashchange', () => { const desired = location.hash.slice(1); if (!navigate(desired)) replaceViewUrl(activeView); });
async function login(credential) {
  if(busy)return;
  const version = ++authVersion;workspaceVersion++;loading=false;loaded=false;
  $('authProgress').hidden=false;
  $('authStatus').textContent = 'กำลังตรวจสอบบัญชีกรรมการ…';
  try {
    const identity = await api('getMyEvaluatorInfo',{idToken:credential});
    if (version !== authVersion) return;
    if (!identity.ok) throw new Error(identity.reason === 'not_committee_member' ? 'บัญชีนี้ยังไม่มีสิทธิ์กรรมการ กรุณาเลือกบัญชีที่ลงทะเบียนไว้ หรือติดต่อผู้ดูแลรายวิชา' : 'การเข้าสู่ระบบหมดอายุ กรุณาเลือกบัญชี Google อีกครั้ง');
    token = credential; evaluator = identity; storageSet(token);
    $('evaluatorName').textContent = identity.name; $('evaluatorEmail').textContent = identity.email;
    $('userAvatar').textContent = identity.name.replace(/^อาจารย์(?:ดร\.)?/,'').trim().slice(0,1) || 'ก';
    $('topAvatar').textContent = $('userAvatar').textContent;
    window.SPRecovery?.resetLayout();
    $('loginScreen').hidden = true; $('appShell').hidden = false;
    scrollTopNow();
    activeView = location.hash.slice(1) || 'overview';
    await loadWorkspace();
  } catch(error) {
    if(version===authVersion){storageSet(null);token=null;evaluator=null;loaded=false;
      window.SPRecovery?.resetLayout();$('appShell').hidden=true;$('loginScreen').hidden=false;
      $('authStatus').textContent=error.message||'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';
      $('googleButton').scrollIntoView({block:'center',behavior:'auto'});
    }
  } finally { if(version===authVersion)$('authProgress').hidden=true; }
}
function logout(expired = false) {
  if (!expired && !allowLeave()) return;
  setMobileMenu(false);
  authVersion++; workspaceVersion++; evaluator = null; token = null; loaded = false; loading = false;
  students = []; records = []; scores = {}; originalScores = {}; selectedStudent = null; chartRoomKey='';chartStatus='all';storageSet(null);
  $('appShell').hidden = true; $('loginScreen').hidden = false;
  $('authProgress').hidden=true;
  $('authStatus').textContent = expired ? 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'เลือกบัญชี Google เพื่อเข้าสู่ระบบ';
  if ($('reviewDialog').open) $('reviewDialog').close();
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  replaceViewUrl('overview');
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
    if (!defense()?.rubricVersion || defenseQuestions().length !== 15) throw new Error('เกณฑ์สอบวิพากษ์ปรับเป็น 15 ข้อย่อย กรุณารีเฟรชหรือติดต่อผู้ดูแล');
    loaded = true; populateRooms(); renderAll(); navigate(activeView,{force:true});
  } catch(error) {
    if(version===workspaceVersion){loaded=false;document.querySelectorAll('.view').forEach(node=>{node.hidden=true;});
      window.SPRecovery?.resetLayout();$('workspaceErrorText').textContent=error.message||'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';$('workspaceError').hidden=false;scrollTopNow();}
  }
  finally { if (version === workspaceVersion) { loading = false; $('workspaceLoading').hidden = true; } }
}
$('retryWorkspace').addEventListener('click',loadWorkspace);
$('workspaceSignOut').addEventListener('click',()=>logout());
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
function renderOverview() {
  const done = students.length-pending().length, total = students.length, remaining = pending().length;
  const completed = records.filter(r => r.assessment === 'defense' && students.some(s => s.id === r.studentId));
  const average = completed.length ? completed.reduce((sum,r) => sum + Number(r.total),0)/completed.length : null;
  const firstName = evaluator.name.replace(/^อาจารย์(?:\s*ดร\.)?\s*/,'').trim().split(/\s+/)[0];
  $('greetingTitle').textContent = 'สวัสดี, อาจารย์'+firstName;
  const date = new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  $('welcomeText').replaceChildren(document.createTextNode(date+' — '),el('span','course-open','สอบวิพากษ์: เปิดประเมิน'));
  $('myStats').replaceChildren();
  const percent = total ? Math.round(done / total * 100) : 0;
  const roomCount = new Set(students.map(s => s.term+'|'+s.room)).size;
  [{label:'นิสิตที่รับผิดชอบ',value:total,unit:'คน',icon:'users',tone:'lavender',tag:roomCount+' กลุ่ม',note:'เฉพาะห้องและแผนการเรียนที่ได้รับมอบหมาย'},
   {label:'ประเมินแล้ว',value:done,unit:'คน',icon:'file',tone:'blue',tag:percent+'%',note:'บันทึกคะแนนสอบวิพากษ์เรียบร้อยแล้ว'},
   {label:'รอประเมิน',value:remaining,unit:'คน',icon:'clock',tone:'slate',tag:total ? (100-percent)+'%' : '0%',note:'ยังไม่มีคะแนนสอบวิพากษ์จากคุณ'},
   {label:'คะแนนเฉลี่ยของฉัน',value:average===null?'—':average.toFixed(2),unit:'/ 20',icon:'chart',tone:'mint',tag:'เต็ม 20',note:completed.length?'จากการประเมิน '+completed.length+' คน':'ยังไม่มีคะแนนที่บันทึก'}].forEach(item => {
    const card=el('div','stat-card');const top=el('div','metric-top'),symbol=el('span','stat-icon '+item.tone);symbol.innerHTML=icon(item.icon);top.append(symbol,el('span','metric-tag',item.tag));
    const number=el('div','stat-value');number.append(el('strong','',item.value),el('span','',item.unit));card.append(top,el('span','stat-label',item.label),number,el('p','metric-note',item.note));$('myStats').append(card);
  });
  $('focusTitle').textContent = !total ? 'ยังไม่มีรายชื่อนิสิตที่ได้รับมอบหมาย' : remaining ? 'เหลือนิสิตอีก '+remaining+' คนที่รอการประเมิน' : 'ประเมินครบทุกคนแล้ว';
  $('focusDescription').textContent = !total ? 'ติดต่อผู้ดูแลเพื่อตรวจสอบการมอบหมายห้องสอบ' : 'ข้อมูลเฉพาะคะแนนที่คุณเป็นผู้ประเมิน';
  $('overviewProgress').max=total||1;$('overviewProgress').value=done;$('overviewProgressLabel').textContent=done+' / '+total+' คน';
  $('continueScoring').textContent=remaining?'＋ เริ่มประเมิน':'ดูประวัติการประเมิน →';
  $('exportScores').disabled=!completed.length;
  updateAnalytics(true);
  $('assessmentPlan').replaceChildren();
  assessments.forEach(a=>{const item=el('div','plan-item '+a.status);const heading=el('div');heading.append(el('span','plan-label',a.label),el('span','badge '+(a.status==='open'?'sage':a.status==='completed'?'neutral':'warning'),a.status==='open'?'เปิดประเมิน':a.status==='completed'?'เก็บคะแนนแล้ว':'ยังไม่เปิด'));const number=el('div','plan-points');number.append(el('strong','',a.max),el('span','','คะแนน'));item.append(heading,number);if(a.status==='open'){const link=el('a','text-link','ไปรายชื่อนิสิต →');link.href='#students';item.append(link);}else item.append(el('span','helper',a.status==='completed'?'ดูคะแนนของคุณได้ในประวัติ':'วางแผนไว้ ยังไม่รับคะแนน'));$('assessmentPlan').append(item);});
}
function bindChartTooltip(node,text){
  node.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')window.SPUI?.showTooltip?.(node,text);});
  node.addEventListener('pointerleave',()=>window.SPUI?.hideTooltip?.());
  node.addEventListener('focus',()=>window.SPUI?.showTooltip?.(node,text));
  node.addEventListener('blur',()=>window.SPUI?.hideTooltip?.());
}
function chartScopeStudents(){return students.filter(student=>!chartRoomKey||student.term+'|'+student.room===chartRoomKey);}
function chartFilteredStudents(){return chartScopeStudents().filter(student=>chartStatus==='all'||(chartStatus==='done')===!!ownRecord(student.id));}
function roomLabel(key){if(!key)return 'ทุกห้อง';const parts=key.split('|');return parts[1]+' · ภาค'+parts[0];}
function statusLabel(status){return status==='done'?'ประเมินแล้ว':status==='pending'?'รอประเมิน':'ทุกสถานะ';}
function updateAnalytics(animate=false){
  if(chartRoomKey&&!students.some(student=>student.term+'|'+student.room===chartRoomKey))chartRoomKey='';
  window.SPUI?.hideTooltip?.();
  $('roomProgressChart').classList.toggle('chart-updating',!animate);
  renderRoomAnalytics();const scope=chartScopeStudents(),done=scope.filter(student=>ownRecord(student.id)).length;renderCompletionDonut(done,scope.length);
  $('completionScope').textContent=chartRoomKey?roomLabel(chartRoomKey):'สัดส่วนนิสิตทุกห้องที่คุณรับผิดชอบ';
  $('chartFilterSummary').textContent=roomLabel(chartRoomKey)+' · '+statusLabel(chartStatus)+' · '+chartFilteredStudents().length+' คน';
  $('resetChartFilters').hidden=!chartRoomKey&&chartStatus==='all';
  $('viewChartStudents').disabled=!students.length;$('viewDonutStudents').disabled=!students.length;
  renderActivity();
}
function selectChartRoom(key,keyboard){
  chartRoomKey=chartRoomKey===key?'':key;updateAnalytics();
  if(keyboard){const button=[...document.querySelectorAll('[data-chart-room]')].find(node=>node.dataset.chartRoom===key);button?.focus({preventScroll:true});}
}
function selectChartStatus(status,keyboard){
  chartStatus=chartStatus===status?'all':status;updateAnalytics();
  if(keyboard)document.querySelector('[data-legend-status="'+status+'"]')?.focus({preventScroll:true});
}
function renderActivity(){
  const filtered=chartFilteredStudents(),ids=new Set(filtered.map(student=>student.id));
  const completed=records.filter(record=>record.assessment==='defense'&&ids.has(record.studentId)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  const waiting=filtered.filter(student=>!ownRecord(student.id));
  const ordered=[...completed.map(record=>filtered.find(student=>student.id===record.studentId)),...waiting].filter(Boolean).slice(0,5);
  $('activityScope').textContent=roomLabel(chartRoomKey)+' · '+statusLabel(chartStatus)+' · รายการล่าสุดและนิสิตที่รอประเมิน';
  $('activityRows').replaceChildren();
  ordered.forEach(student=>{
    const record=ownRecord(student.id),row=el('tr'),name=el('td'),person=el('div','activity-person');
    person.append(el('span','mini-avatar avatar-tone-'+students.indexOf(student)%4,String(student.name).replace(/^(นาย|นางสาว|นาง)/,'').slice(0,1)),studentInfoNode(student,true));name.append(person);
    const room=el('td');room.append(el('span','room-name',student.room),el('small','','ภาค'+student.term));
    const timestamp=el('td','activity-date',record?dateLabel(record.updatedAt):'ยังไม่บันทึก'),status=el('td');status.append(el('span','badge '+(record?'sage':'neutral'),record?'ประเมินแล้ว':'รอประเมิน'));
    const action=el('td');action.append(actionButton(student,true));row.append(name,room,timestamp,status,action);$('activityRows').append(row);
  });
  $('activityEmpty').hidden=!!ordered.length;$('activityEmpty').textContent=students.length?'ไม่พบรายชื่อในตัวกรองนี้ ลองเลือกสถานะอื่นหรือล้างตัวกรองกราฟ':'ยังไม่มีรายชื่อนิสิตที่ได้รับมอบหมาย';
}
function renderRoomAnalytics(){
  const chart=$('roomProgressChart');chart.replaceChildren();const groups=new Map();
  students.forEach(student=>{const key=student.term+'|'+student.room;if(!groups.has(key))groups.set(key,{key,room:student.room,term:student.term,total:0,done:0});const group=groups.get(key);group.total++;if(ownRecord(student.id))group.done++;});
  if(!groups.size){chart.append(el('p','empty-inline','ยังไม่มีข้อมูลสำหรับแสดงกราฟ'));return;}
  const max=Math.max(4,Math.ceil(Math.max(...[...groups.values()].map(group=>group.total))/4)*4);
  const grid=el('div','chart-grid-lines');for(let i=4;i>=0;i--){const line=el('div');line.append(el('span','',Math.round(max*i/4)));grid.append(line);}chart.append(grid);
  const columns=el('div','room-columns');
  groups.forEach(group=>{
    const column=el('button','room-column interactive-column'),track=el('span','column-track'),bar=el('span','column-bar');column.type='button';column.dataset.chartRoom=group.key;column.setAttribute('aria-pressed',String(chartRoomKey===group.key));
    column.setAttribute('aria-label',roomLabel(group.key)+' ประเมินแล้ว '+group.done+' จาก '+group.total+' คน แตะเพื่อกรองข้อมูล');
    bar.style.height=(group.total/max*100)+'%';bar.setAttribute('aria-hidden','true');const pendingBar=el('span','column-pending'),doneBar=el('span','column-done');pendingBar.style.height=((group.total-group.done)/group.total*100)+'%';doneBar.style.height=(group.done/group.total*100)+'%';bar.append(pendingBar,doneBar);
    track.style.setProperty('--bar-height',(group.total/max*100)+'%');track.append(el('span','column-count',group.done+'/'+group.total),bar);column.append(track,el('strong','',group.room),el('small','','ภาค'+group.term));
    column.addEventListener('click',event=>selectChartRoom(group.key,event.detail===0));bindChartTooltip(column,roomLabel(group.key)+'\nประเมินแล้ว '+group.done+' คน · รอ '+(group.total-group.done)+' คน\nแตะเพื่อกรองกราฟและรายชื่อ');columns.append(column);
  });chart.append(columns);
}
function renderCompletionDonut(done,total){
  const fraction=total?done/total:0,circumference=2*Math.PI*76,svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('role','group');svg.setAttribute('aria-label','สถานะการประเมิน แตะส่วนกราฟหรือป้ายกำกับเพื่อกรอง');
  [{status:'pending',color:total?'#0f172a':'#e2e8f0',value:total-done},{status:'done',color:'#059669',value:done}].forEach(item=>{
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');Object.entries({cx:100,cy:100,r:76,fill:'none',stroke:item.color,'stroke-width':21}).forEach(([key,value])=>circle.setAttribute(key,String(value)));
    if(item.status==='done'){circle.setAttribute('stroke-dasharray',(fraction*circumference)+' '+circumference);circle.setAttribute('transform','rotate(-90 100 100)');}
    circle.classList.add('interactive-sector');circle.dataset.chartStatus=item.status;circle.setAttribute('role','button');circle.setAttribute('tabindex',total?'0':'-1');circle.setAttribute('aria-label',statusLabel(item.status)+' '+item.value+' คน');circle.setAttribute('aria-pressed',String(chartStatus===item.status));
    circle.style.opacity=chartStatus!=='all'&&chartStatus!==item.status?'.3':'1';
    if(total){circle.addEventListener('click',event=>selectChartStatus(item.status,event.detail===0));circle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectChartStatus(item.status,true);}});bindChartTooltip(circle,statusLabel(item.status)+' '+item.value+' คน\nแตะเพื่อกรองตารางรายชื่อ');}svg.append(circle);
  });
  $('completionDonut').replaceChildren(svg);const center=el('div','donut-center'),value=chartStatus==='done'?done:chartStatus==='pending'?total-done:total;center.append(el('strong','',value),el('span','',chartStatus==='all'?'นิสิตที่รับผิดชอบ':statusLabel(chartStatus)));$('completionDonut').append(center);
  $('completionLegend').replaceChildren();[{status:'done',value:done,color:'sage-dot'},{status:'pending',value:total-done,color:'navy-dot'}].forEach(item=>{
    const row=el('button','legend-filter'),name=el('span');row.type='button';row.disabled=!total;row.dataset.legendStatus=item.status;row.setAttribute('aria-pressed',String(chartStatus===item.status));
    name.append(el('i','legend-dot '+item.color),document.createTextNode(statusLabel(item.status)));row.append(name,el('strong','',(total?(item.status==='done'?Math.round(fraction*100):100-Math.round(fraction*100)):0)+'%'),el('small','',item.value+' คน'));row.addEventListener('click',event=>selectChartStatus(item.status,event.detail===0));bindChartTooltip(row,'กรองเฉพาะ'+statusLabel(item.status)+' '+item.value+' คน');$('completionLegend').append(row);
  });
}
function openChartStudents(){
  if(!navigate('students'))return;studentFilter=chartStatus;$('roomFilter').value=chartRoomKey;$('studentSearch').value='';renderStudents();window.SPUI?.refreshSelects?.();
}
$('resetChartFilters').addEventListener('click',()=>{chartRoomKey='';chartStatus='all';updateAnalytics();});
['viewChartStudents','viewDonutStudents','chartActivityMore'].forEach(id=>$(id).addEventListener('click',openChartStudents));
$('globalSearchForm').addEventListener('submit',event=>{event.preventDefault();if(!loaded)return;if(!navigate('students'))return;studentFilter='all';$('roomFilter').value='';$('studentSearch').value=$('globalSearch').value;renderStudents();$('studentSearch').focus({preventScroll:true});});
$('exportScores').addEventListener('click',()=>{
  const lines=[['รหัสนิสิต','ชื่อ-สกุล','ห้องสอบ','แผนการเรียน','หมวด','คะแนนเต็ม 20','บันทึกล่าสุด','เวอร์ชันเกณฑ์',...defenseQuestions().map(q=>q.label+' (0–4)')]];
  records.filter(record=>record.assessment==='defense').forEach(record=>{const student=students.find(s=>s.id===record.studentId);if(student)lines.push([student.id,student.name,student.room,student.term,'สอบวิพากษ์',record.total,record.updatedAt,record.rubricVersion || 'defense-v1',...defenseQuestions().map(q=>record.questionScores?.[q.key] ?? '')]);});
  const cell=value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const csv='\ufeff'+lines.map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=el('a');link.href=url;link.download='คะแนนสอบวิพากษ์ของฉัน.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
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
  selectedStudent=student;const record=ownRecord(id);scores=completeQuestionRecord(record)?{...record.questionScores}:{};originalScores={...scores};
  $('gradeContent').hidden=false;$('saveSuccess').hidden=true;$('globalMessage').hidden=true;
  $('gradeStudentName').textContent=student.name;$('gradeStudentMeta').textContent=student.id+' · '+student.room+' · ภาค'+student.term;
  $('gradeStudentAdvisor').textContent='อาจารย์ที่ปรึกษา: '+student.advisor;$('gradeStudentTopic').textContent=student.topic;
  $('editingNotice').hidden=!record;
  $('editingNotice').textContent=!record?'':completeQuestionRecord(record)?'กำลังแก้ไขคะแนนที่บันทึกเมื่อ '+dateLabel(record.updatedAt)+' · การยืนยันจะอัปเดตคะแนนเดิมของคุณ':'คะแนนเดิม '+Number(record.total).toFixed(2)+'/20 ประเมินแบบ 5 ด้าน ยังไม่มีรายละเอียดข้อย่อย กรุณาประเมินใหม่ให้ครบ 15 ข้อก่อนยืนยันอัปเดต คะแนนเดิมจะยังอยู่จนกว่าจะยืนยัน';
  renderRubric();navigate('grade',{force:true});
}
function revealGroup(key) {
  const group=$('group-'+key);if(!group)return;
  document.querySelectorAll('.rubric-group').forEach(node=>{node.open=node===group;});
  group.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  group.querySelector('summary').focus({preventScroll:true});
}
function renderRubric() {
  $('criteria').replaceChildren();
  const firstIncomplete=defense().criteria.find(c=>c.questions.some(q=>scores[q.key]===undefined)) || defense().criteria[0];
  defense().criteria.forEach((c,index)=>{
    const group=el('details','rubric-group card');group.id='group-'+c.key;group.dataset.key=c.key;group.open=c.key===firstIncomplete.key;
    const summary=el('summary','rubric-group-heading'),title=el('div','rubric-group-title');title.append(el('span','criterion-number',String(index+1)),el('strong','',c.label));
    const meta=el('div','rubric-group-meta');const progress=el('span','badge neutral');progress.id='group-progress-'+c.key;meta.append(progress,el('span','criterion-weight',c.weight+' คะแนน'));summary.append(title,meta);
    const intro=el('div','rubric-group-intro');intro.append(el('span','badge neutral',c.mapping),el('p','',c.evidence));
    const body=el('div','rubric-group-body');body.append(intro);
    c.questions.forEach((q,questionIndex)=>{
      const field=el('fieldset','question-card');field.dataset.question=q.key;
      const legend=el('legend');legend.append(el('span','question-number',(index+1)+'.'+(questionIndex+1)),el('span','',q.label));
      const weight=el('div','question-weight','น้ำหนัก '+q.weight+' คะแนน');
      const evidence=el('p','criterion-evidence',q.evidence),scale=el('div','scale');
      SCALE.forEach((label,value)=>{const option=el('label'),input=el('input'),box=el('span'),number=el('b','',value);input.type='radio';input.name=q.key;input.value=value;input.checked=scores[q.key]===value;input.setAttribute('aria-label',value+' '+label);input.addEventListener('change',()=>{scores[q.key]=value;updateTotal();updateLevel(q);});box.append(number,el('span','',label));option.append(input,box);scale.append(option);});
      const selected=el('div','selected-level');selected.id='level-'+q.key;selected.setAttribute('aria-live','polite');
      const details=el('details','question-help'),helpSummary=el('summary','','ดูคำถามสำหรับซักถามและคำอธิบายคะแนน');const prompt=el('p','interview-prompt','คำถามเสนอแนะ: '+q.prompt),list=el('ol');list.start=0;q.levels.forEach(level=>list.append(el('li','',level)));details.append(helpSummary,prompt,list);
      field.append(legend,weight,evidence,scale,selected,details);body.append(field);
    });
    const next=el('button','btn secondary group-next',index<defense().criteria.length-1?'ด้านถัดไป →':'ตรวจสอบคะแนนทั้ง 15 ข้อ →');next.type='button';next.dataset.nextGroup=c.key;
    next.addEventListener('click',()=>{if(index<defense().criteria.length-1)revealGroup(defense().criteria[index+1].key);else $('reviewScore').click();});
    body.append(next);group.append(summary,body);group.addEventListener('toggle',()=>{if(group.open)document.querySelectorAll('.rubric-group').forEach(other=>{if(other!==group)other.open=false;});});$('criteria').append(group);
    c.questions.forEach(updateLevel);
  });updateTotal();
}
function updateLevel(question){const node=$('level-'+question.key),value=scores[question.key];node.textContent=value===undefined?'เลือกคะแนน 0–4 สำหรับข้อนี้':value+' · '+question.levels[value];node.classList.toggle('chosen',value!==undefined);}
function totalScore(){return defense().criteria.reduce((sum,c)=>sum+groupPoints(c),0);}
function updateTotal(){
  const questions=defenseQuestions(),count=questions.filter(q=>Number.isInteger(scores[q.key])).length;
  $('total').textContent=totalScore().toFixed(2);$('completion').textContent='ตอบแล้ว '+count+' / '+questions.length+' ข้อย่อย';$('scoreProgress').max=questions.length;$('scoreProgress').value=count;
  $('scoreBreakdown').replaceChildren();defense().criteria.forEach((c,i)=>{
    const answered=c.questions.filter(q=>Number.isInteger(scores[q.key])).length;
    const row=el('button','breakdown-row jump-group');row.type='button';row.append(el('span','','ด้าน '+(i+1)+' · '+answered+'/'+c.questions.length+' ข้อ'),el('strong','',groupPoints(c).toFixed(2)+' / '+c.weight));row.addEventListener('click',()=>revealGroup(c.key));$('scoreBreakdown').append(row);
    const progress=$('group-progress-'+c.key);if(progress){progress.textContent=answered+'/'+c.questions.length+' ข้อ';progress.className='badge '+(answered===c.questions.length?'sage':'neutral');}
    const next=document.querySelector('[data-next-group="'+c.key+'"]');if(next)next.disabled=i===defense().criteria.length-1?count!==questions.length:answered!==c.questions.length;
  });
  $('reviewScore').disabled=busy||count!==questions.length;
}
$('scoreForm').addEventListener('submit',event=>{
  event.preventDefault();if($('reviewScore').disabled||!selectedStudent||busy)return;
  $('reviewStudent').textContent=selectedStudent.name+' · '+selectedStudent.id;
  $('reviewDetails').replaceChildren();defense().criteria.forEach((c,i)=>{
    const section=el('section','review-group'),heading=el('div','review-group-title');heading.append(el('strong','',(i+1)+'. '+c.label),el('strong','',groupPoints(c).toFixed(2)+' / '+c.weight));section.append(heading);
    c.questions.forEach((q,idx)=>{const row=el('div','review-row'),label=el('div');label.append(el('span','',(i+1)+'.'+(idx+1)+' '+q.label),el('small','helper','ระดับ '+scores[q.key]+'/4'));row.append(label,el('strong','',(scores[q.key]/4*q.weight).toFixed(2)+' / '+q.weight));section.append(row);});$('reviewDetails').append(section);
  });
  $('reviewTotal').textContent=totalScore().toFixed(2)+' / 20';$('reviewUpdateNotice').textContent=ownRecord(selectedStudent.id)?'คุณกำลังอัปเดตคะแนนเดิมของตนเอง ระบบจะไม่เพิ่มรายการซ้ำ':'ผู้ประเมิน: '+evaluator.name;
  $('saveError').hidden=true;$('reviewDialog').showModal();
});
function closeReview(){if(!busy)$('reviewDialog').close();}
$('closeReview').addEventListener('click',closeReview);$('backToGrade').addEventListener('click',closeReview);
$('reviewDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('confirmSave').addEventListener('click',async()=>{
  if(busy||!selectedStudent)return;busy=true;const student=selectedStudent,payloadScores={...scores};$('confirmSave').disabled=true;$('confirmSave').textContent='กำลังบันทึก…';$('backToGrade').disabled=true;$('closeReview').disabled=true;$('saveError').hidden=true;
  try{
    const response=await fetch(GAS_URL,{method:'POST',body:JSON.stringify({assessment:'defense',idToken:token,studentId:student.id,rubricVersion:defense().rubricVersion,questionScores:payloadScores})});
    if(!response.ok)throw new Error('เชื่อมต่อระบบไม่สำเร็จ');const result=await response.json();
    if(result.status==='unauthorized'){logout(true);return;}
    if(!['created','updated'].includes(result.status))throw new Error(result.message||'บันทึกไม่สำเร็จ');
    records=records.filter(r=>!(r.assessment==='defense'&&r.studentId===student.id));records.push({assessment:'defense',studentId:student.id,scores:result.criterionScores || criterionRawScores(payloadScores),questionScores:payloadScores,rubricVersion:result.rubricVersion || defense().rubricVersion,total:result.total,updatedAt:new Date().toISOString()});
    scores={};originalScores={};selectedStudent=null;$('reviewDialog').close();$('gradeContent').hidden=true;$('saveSuccess').hidden=false;
    $('savedStudent').textContent=student.name+' · '+student.id;$('savedTotal').textContent=Number(result.total).toFixed(2);
    $('nextStudent').textContent=pending().length?'ประเมินคนถัดไป →':'กลับภาพรวมงานของฉัน';renderAll();scrollTopNow();
  }catch(error){$('saveError').textContent=error.message+' หากไม่แน่ใจว่าสำเร็จ สามารถยืนยันซ้ำได้โดยไม่เพิ่มรายการซ้ำ';$('saveError').hidden=false;}
  finally{busy=false;$('confirmSave').disabled=false;$('confirmSave').textContent='ยืนยันบันทึกคะแนน';$('backToGrade').disabled=false;$('closeReview').disabled=false;}
});
$('nextStudent').addEventListener('click',()=>{const next=pending()[0];if(next)openStudent(next.id);else navigate('overview');});
function renderHistory(){
  const section=$('historySection').value,query=$('historySearch').value.trim().toLowerCase(),assessment=assessments.find(a=>a.id===section);
  const list=records.filter(r=>{const s=students.find(s=>s.id===r.studentId);return r.assessment===section&&s&&(s.name+s.id).toLowerCase().includes(query);}).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  $('historyRows').replaceChildren();list.forEach(r=>{const s=students.find(s=>s.id===r.studentId),tr=el('tr'),name=el('td');name.append(studentInfoNode(s,true));const type=el('td');type.append(el('span','badge neutral',assessment.label));if(section==='defense')type.append(el('small','helper',completeQuestionRecord(r)?'15 ข้อย่อย':'แบบเดิม 5 ด้าน'));const score=el('td','table-score',Number(r.total).toFixed(2)+' / '+assessment.max),date=el('td','date-cell',dateLabel(r.updatedAt)),action=el('td');if(section==='defense')action.append(actionButton(s));else action.append(el('span','helper','ปิดรับคะแนนแล้ว'));tr.append(name,type,score,date,action);$('historyRows').append(tr);});$('historyEmpty').hidden=!!list.length;
}
$('historySearch').addEventListener('input',renderHistory);$('historySection').addEventListener('change',renderHistory);
function renderGuide(){
  $('guideCriteria').replaceChildren();defense().criteria.forEach((c,index)=>{
    const detail=el('details','card guide-criterion'),summary=el('summary');summary.append(el('span','',(index+1)+'. '+c.label),el('span','badge neutral',c.questions.length+' ข้อ · '+c.weight+' คะแนน'));
    detail.append(summary,el('p','helper',c.mapping+' · '+c.evidence));
    c.questions.forEach((q,qIndex)=>{const item=el('details','guide-question'),heading=el('summary');heading.append(el('span','',(index+1)+'.'+(qIndex+1)+' '+q.label),el('span','question-weight',q.weight+' คะแนน'));const prompt=el('p','interview-prompt','คำถามเสนอแนะ: '+q.prompt),list=el('ol','guide-levels');list.start=0;q.levels.forEach((level,i)=>{const li=el('li');li.append(el('strong','',SCALE[i]),el('p','',level));list.append(li);});item.append(heading,prompt,list);detail.append(item);});$('guideCriteria').append(detail);
  });
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

window.SP_APP_READY=true;
