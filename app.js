'use strict';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzYTvGLDpeLlW6FqIl1KX1tpOcatmjrnkKiUYL1jfx7tCHs8jPmX8Zm2wqMJsfR11Vm/exec';
const GOOGLE_CLIENT_ID = '992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com';
const $ = id => document.getElementById(id);
const SCALE = ['ไม่ผ่าน', 'ต้องปรับปรุง', 'พอใช้', 'ดี', 'ดีเยี่ยม'];
const FALLBACK = [
  {id:'proposal',label:'หัวข้อโครงงาน',max:10,status:'completed'},
  {id:'advisor',label:'อาจารย์ที่ปรึกษา',max:50,status:'planned'},
  {id:'progress',label:'รายงานความก้าวหน้า',max:20,status:'planned'},
  {id:'defense',label:'สอบวิพากษ์',max:20,status:'open'}
];
let assessments = FALLBACK, activeId = 'defense', token = null, evaluator = null, student = null;
let scores = {}, busy = false, lookupVersion = 0, authVersion = 0, configReady = false;
const current = () => assessments.find(a => a.id === activeId);
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').hidden = false; }
async function api(action, params = {}) {
  const url = new URL(GAS_URL); url.searchParams.set('action', action);
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,value));
  const response = await fetch(url);
  if (!response.ok) throw new Error('เชื่อมต่อระบบไม่สำเร็จ');
  return response.json();
}
function drawCards() {
  $('assessmentCards').replaceChildren();
  const status = {completed:'เก็บคะแนนแล้ว',open:'เปิดประเมิน',planned:'วางแผนไว้'};
  assessments.forEach(a => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'assessment-tile ' + a.status + (a.id === activeId ? ' active' : '');
    button.setAttribute('aria-pressed', String(a.id === activeId));
    const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = status[a.status];
    const title = document.createElement('strong'); title.textContent = a.label;
    const points = document.createElement('span'); points.className = 'points'; points.textContent = a.max;
    const unit = document.createElement('small'); unit.textContent = 'คะแนน';
    button.append(pill,title,points,unit);
    button.addEventListener('click', () => { if (busy) return; if (Object.keys(scores).length && !confirm('มีคะแนนที่ยังไม่ได้บันทึก ต้องการเปลี่ยนหมวดหรือไม่?')) return; activeId = a.id; resetStudent(); $('message').hidden = true; drawCards(); drawSection(); });
    $('assessmentCards').append(button);
  });
}
function drawSection() {
  const a = current(); $('sectionTitle').textContent = a.label + ' · ' + a.max + ' คะแนน';
  const open = configReady && a.status === 'open' && evaluator;
  $('scoreForm').hidden = !open; $('sectionNotice').hidden = !!open;
  $('sectionNotice').textContent = !configReady ? 'ยังโหลดการตั้งค่าไม่สำเร็จ กรุณาตรวจสอบการ Deploy แล้วรีเฟรชหน้า' : a.status === 'completed' ? 'เก็บคะแนนหัวข้อโครงงานแล้ว คะแนนเดิมอยู่ใน Scores และ Summary ดูผลได้ที่แดชบอร์ดผู้ดูแล' : a.status === 'planned' ? 'วางแผนสัดส่วนคะแนนไว้แล้ว ยังไม่เปิดรับคะแนนและยังไม่กำหนดเกณฑ์ประเมิน' : 'กรุณาเข้าสู่ระบบก่อนค้นหานิสิตและให้คะแนน';
}
function resetStudent() {
  lookupVersion++; student = null; scores = {}; $('studentId').value = ''; $('studentCard').hidden = true; $('rubricArea').hidden = true; $('roomWarning').hidden = true; $('lookupStatus').textContent = ''; updateTotal();
}
function renderRubric() {
  $('criteria').replaceChildren();
  current().criteria.forEach((c,index) => {
    const field = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = (index+1) + '. ' + c.label;
    const meta = document.createElement('div'); meta.className = 'criterion-meta';
    const mapping = document.createElement('span'); mapping.textContent = c.mapping || '';
    const weight = document.createElement('span'); weight.textContent = 'น้ำหนัก ' + c.weight + ' คะแนน'; meta.append(mapping,weight);
    const evidence = document.createElement('p'); evidence.textContent = c.evidence || '';
    const scale = document.createElement('div'); scale.className = 'scale';
    SCALE.forEach((label,value) => {
      const option = document.createElement('label'), input = document.createElement('input'), box = document.createElement('span'), number = document.createElement('b');
      input.type = 'radio'; input.name = c.key; input.value = value; input.required = true;
      input.addEventListener('change', () => { scores[c.key] = value; updateTotal(); });
      number.textContent = value; box.append(number,document.createTextNode(label)); option.append(input,box); scale.append(option);
    });
    field.append(legend,meta,evidence,scale);
    if (c.levels) { const detail = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ol'); summary.textContent = 'ดูคำอธิบายระดับคะแนน 0–4'; list.start = 0; c.levels.forEach(level => { const li = document.createElement('li'); li.textContent = level; list.append(li); }); detail.append(summary,list); field.append(detail); }
    $('criteria').append(field);
  });
  updateTotal();
}
function updateTotal() {
  const a = current(), criteria = a.criteria || [];
  $('total').textContent = criteria.reduce((sum,c) => sum + (scores[c.key] || 0) / 4 * c.weight,0).toFixed(2);
  $('maximum').textContent = ' / ' + a.max + ' คะแนน';
  $('completion').textContent = 'ให้คะแนนแล้ว ' + Object.keys(scores).length + '/' + criteria.length + ' ข้อ';
  $('save').disabled = busy || !student || !evaluator || !criteria.length || Object.keys(scores).length !== criteria.length;
}
async function login(credential) {
  const version = ++authVersion;
  token = null; evaluator = null; resetStudent(); drawSection();
  $('identityCard').hidden = true; $('loginCard').hidden = false;
  $('authStatus').textContent = 'กำลังตรวจสอบอีเมลกับรายชื่อกรรมการ…';
  try {
    const result = await api('getMyEvaluatorInfo', {idToken:credential});
    if (version !== authVersion) return;
    if (!result.ok) throw new Error(result.reason === 'not_committee_member' ? 'อีเมลนี้ไม่มีใน Committees กรุณาใช้บัญชีที่ได้รับมอบหมาย หรือติดต่อผู้ดูแล' : 'ยืนยันบัญชีไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่');
    token = credential; evaluator = result;
    $('evaluatorName').textContent = result.name; $('evaluatorEmail').textContent = result.email;
    $('assignments').textContent = result.assignments.map(a => 'ภาค' + a.term + ' · ห้อง ' + a.room).join('\n');
    $('loginCard').hidden = true; $('identityCard').hidden = false; drawSection();
  } catch(error) { if (version === authVersion) $('authStatus').textContent = error.message; }
}
function logout() {
  authVersion++; token = null; evaluator = null; resetStudent();
  $('identityCard').hidden = true; $('loginCard').hidden = false; $('authStatus').textContent = 'กรุณาเลือกบัญชี Google เพื่อเข้าสู่ระบบ';
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  drawSection();
}
async function lookup() {
  if (busy || !evaluator || !configReady) return;
  const id = $('studentId').value.trim(), version = ++lookupVersion;
  student = null; scores = {}; $('studentCard').hidden = true; $('rubricArea').hidden = true; $('roomWarning').hidden = true; updateTotal();
  if (!/^\d{10}$/.test(id)) { $('lookupStatus').textContent = 'กรุณากรอกรหัสนิสิต 10 หลัก'; return; }
  $('lookupStatus').textContent = 'กำลังค้นหานิสิต…'; $('message').hidden = true;
  try {
    const found = await api('getStudentById', {id,idToken:token});
    if (version !== lookupVersion) return;
    if (found?.status === 'unauthorized') { logout(); message('การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่',true); return; }
    if (!found) { $('lookupStatus').textContent = 'ไม่พบรหัสนิสิตนี้'; return; }
    $('lookupStatus').textContent = ''; $('studentName').textContent = found.name;
    $('studentMeta').textContent = found.id + ' · ภาค' + found.term + ' · ห้อง ' + found.room;
    $('studentAdvisor').textContent = 'อาจารย์ที่ปรึกษา: ' + found.advisor; $('studentTopic').textContent = found.topic;
    $('studentCard').hidden = false;
    const assigned = evaluator.assignments.some(a => a.term === found.term && a.room === found.room);
    $('roomWarning').hidden = assigned;
    if (!assigned) return;
    student = found; renderRubric(); $('rubricArea').hidden = false;
  } catch(error) { if (version === lookupVersion) $('lookupStatus').textContent = 'ค้นหาไม่สำเร็จ: ' + error.message; }
}
$('studentId').addEventListener('input', () => { lookupVersion++; student = null; scores = {}; $('studentCard').hidden = true; $('rubricArea').hidden = true; $('roomWarning').hidden = true; $('lookupStatus').textContent = ''; updateTotal(); });
$('lookup').addEventListener('click',lookup);
$('studentId').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); lookup(); } });
$('logout').addEventListener('click', () => { if (!busy) logout(); });
$('scoreForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || $('save').disabled) return;
  const submittedStudent = student, assessment = current();
  busy = true; updateTotal(); $('save').textContent = 'กำลังบันทึก…';
  $('studentId').disabled = true; $('lookup').disabled = true; $('logout').disabled = true;
  $('criteria').querySelectorAll('fieldset').forEach(field => { field.disabled = true; });
  try {
    const response = await fetch(GAS_URL, {method:'POST', body:JSON.stringify({assessment:assessment.id,idToken:token,studentId:submittedStudent.id,scores:{...scores}})});
    if (!response.ok) throw new Error('เชื่อมต่อระบบไม่สำเร็จ');
    const result = await response.json();
    if (result.status === 'unauthorized') { logout(); throw new Error('การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
    if (!['created','updated'].includes(result.status)) throw new Error(result.message || 'บันทึกไม่สำเร็จ');
    resetStudent(); message((result.status === 'updated' ? 'อัปเดต' : 'บันทึก') + 'คะแนน ' + submittedStudent.name + ' แล้ว\n' + assessment.label + ': ' + result.total + '/' + assessment.max + ' คะแนน'); $('studentId').focus();
  } catch(error) { message(error.message + '\nหากไม่แน่ใจว่าบันทึกสำเร็จ สามารถกดบันทึกซ้ำได้โดยไม่เพิ่มรายการซ้ำ',true); }
  finally { busy = false; $('save').textContent = 'บันทึกคะแนนสอบวิพากษ์'; $('studentId').disabled = false; $('lookup').disabled = false; $('logout').disabled = false; $('criteria').querySelectorAll('fieldset').forEach(field => { field.disabled = false; }); updateTotal(); }
});
window.addEventListener('beforeunload', event => { if (busy || Object.keys(scores).length) { event.preventDefault(); event.returnValue = ''; } });
function initializeGoogle() {
  if (!window.google?.accounts?.id) { $('authStatus').textContent = 'โหลด Google Sign-In ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'; $('retryAuth').hidden = false; return; }
  google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:response => login(response.credential)});
  google.accounts.id.renderButton($('googleButton'),{theme:'outline',size:'large',text:'signin_with',locale:'th'});
  $('authStatus').textContent = 'อนุญาตเฉพาะอีเมลกรรมการที่ลงทะเบียนไว้'; $('retryAuth').hidden = true;
}
$('retryAuth').addEventListener('click',initializeGoogle);
window.addEventListener('load',initializeGoogle);
drawCards(); drawSection();
api('getCriteria').then(result => {
  if (!Array.isArray(result.assessments) || !result.assessments.some(a => a.id === 'defense' && a.criteria?.length === 5)) throw new Error('กรุณา Deploy Code.gs เวอร์ชันใหม่ก่อนใช้งาน');
  assessments = result.assessments; configReady = true; drawCards(); drawSection();
}).catch(error => message('โหลดเกณฑ์ไม่สำเร็จ: ' + error.message,true));
