'use strict';
window.SPAdvisor = (() => {
  const $ = id => document.getElementById(id);
  const node = (tag,cls,text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; };
  let connection, rubric, data=null, selected=null, answers={}, evidence={}, note='', original='', logOriginal='', busy=false, fetching=false, generation=0, needsReload=true;
  const questions=()=>rubric.criteria.flatMap(c=>c.questions);
  const state=()=>JSON.stringify({answers,evidence,note});
  const dirty=()=>!!selected && (state()!==original || ($('advisorLogForm') && logState()!==logOriginal));
  const points=c=>c.questions.reduce((sum,q)=>sum+(answers[q.key]??0)/4*q.weight,0);
  const total=()=>rubric.criteria.reduce((sum,c)=>sum+points(c),0);
  const record=id=>data.records.find(r=>r.studentId===id);
  const draft=id=>data.drafts.find(r=>r.studentId===id);
  const date=value=>value?new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  function message(text,error=false){$('advisorMessage').textContent=text;$('advisorMessage').className='alert '+(error?'error':'success');$('advisorMessage').hidden=false;}
  function configure(options){connection=options;rubric=options.rubric;}
  function reset(){generation++;data=null;selected=null;answers={};evidence={};note='';original='';logOriginal='';busy=false;fetching=false;needsReload=true;$('advisorReview')?.close();$('advisorList').replaceChildren();$('advisorDetail').hidden=true;}
  async function load(force=false){
    if(fetching||busy)return;
    if(data&&!force&&!needsReload)return;
    if(selected&&dirty()&&!force)return;
    const version=++generation;fetching=true;$('advisorLoading').hidden=false;$('advisorRetry').hidden=true;$('advisorMessage').hidden=true;
    try{
      const result=await connection.read('getAdvisorWorkspace');if(version!==generation)return;
      if(result.status!=='ok'||!Array.isArray(result.students))throw new Error('โหลดข้อมูลที่ปรึกษาไม่สำเร็จ');
      if(selected&&dirty()){needsReload=true;return;}
      data=result;needsReload=false;renderList();if(selected){selected=data.students.find(s=>s.id===selected.id)||null;if(selected)renderDetail();else $('advisorDetail').hidden=true;}
    }catch(error){if(version===generation){message(error.message,true);$('advisorRetry').hidden=false;}}
    finally{if(version===generation){fetching=false;$('advisorLoading').hidden=true;}}
  }
  function allowLeave(){return !busy&&(!dirty()||confirm('มีคะแนนหรือบันทึกปรึกษาที่ยังไม่ได้บันทึก ต้องการออกและยกเลิกการแก้ไขหรือไม่?'));}
  function discard(){selected=null;answers={};evidence={};note='';original='';logOriginal='';$('advisorDetail').hidden=true;}
  function renderList(){
    const query=$('advisorSearch').value.trim().toLowerCase();const status=$('advisorFilter').value;
    const done=data.records.length;$('advisorStats').textContent='นิสิตในที่ปรึกษา '+data.students.length+' คน · ยืนยันแล้ว '+done+' คน · ยังไม่ยืนยัน '+(data.students.length-done)+' คน';
    $('advisorEmpty').hidden=!!data.students.length;$('advisorExport').disabled=!done;
    $('advisorList').replaceChildren();
    const visible=data.students.filter(s=>(s.id+s.name+s.topic).toLowerCase().includes(query)&&(status==='all'||(status==='done'?!!record(s.id):!record(s.id))));
    visible.forEach(s=>{
      const r=record(s.id),d=draft(s.id),hasDraft=d&&(!r||new Date(d.updatedAt)>new Date(r.updatedAt));const card=node('article','advisor-student-row');
      const info=node('div');info.append(node('strong','',s.name),node('span','student-id',s.id),node('p','student-topic',s.topic||'ยังไม่ระบุหัวข้อ'));
      const right=node('div','advisor-row-actions');right.append(node('span','badge '+(r?'sage':'neutral'),r?Number(r.total).toFixed(2)+' / 50':'ยังไม่ยืนยัน'));
      if(hasDraft)right.append(node('span','badge warning','มีร่าง '+Object.keys(d.questionScores).length+'/15 ข้อ'));
      const button=node('button','btn secondary small',r?'ดู / แก้ไข':'เปิดประเมิน');button.type='button';button.setAttribute('aria-label','ประเมินที่ปรึกษา '+s.name);button.addEventListener('click',()=>open(s.id));right.append(button);card.append(info,right);$('advisorList').append(card);
    });
    $('advisorNoResults').hidden=!data.students.length||!!visible.length;
  }
  function open(id){
    if(!allowLeave())return;selected=data.students.find(s=>s.id===id);if(!selected)return;
    const r=record(id),d=draft(id);const source=d&&(!r||new Date(d.updatedAt)>new Date(r.updatedAt))?d:r;
    answers=source?.rubricVersion===rubric.rubricVersion?{...source.questionScores}:{};evidence={...(source?.evidence||{})};note=source?.note||'';original=state();
    renderDetail();$('advisorDetail').scrollIntoView({block:'start',behavior:'auto'});$('advisorStudentName').focus({preventScroll:true});
  }
  function field(label,id,value='',rows=3){const wrap=node('label','advisor-field',label),input=node('textarea');input.id=id;input.rows=rows;input.value=value;input.maxLength=4000;wrap.append(input);return wrap;}
  function renderDetail(){
    $('advisorDetail').hidden=false;$('advisorStudentName').textContent=selected.name;$('advisorStudentMeta').textContent=selected.id+' · '+selected.topic;
    const r=record(selected.id);$('advisorOfficial').textContent=r?'คะแนนยืนยันล่าสุด '+Number(r.total).toFixed(2)+' / 50 · '+date(r.updatedAt):'ยังไม่มีคะแนนยืนยัน · คะแนนร่างไม่รวมในผลรายวิชา';
    $('advisorCriteria').replaceChildren();
    rubric.criteria.forEach((c,i)=>{
      const group=node('details','rubric-group card advisor-group');group.open=i===0;group.id='advisorGroup_'+c.key;
      const summary=node('summary','rubric-group-heading');summary.append(node('strong','',(i+1)+'. '+c.label),node('span','badge neutral',c.weight+' คะแนน'));const progress=node('span','badge neutral');progress.id='advisorGroupProgress_'+c.key;summary.append(progress);
      const body=node('div','rubric-group-body');body.append(node('p','helper',c.mapping+' · '+c.evidence));
      c.questions.forEach((q,j)=>{
        const f=node('fieldset','question-card'),legend=node('legend','',(i+1)+'.'+(j+1)+' '+q.label);f.append(legend,node('p','criterion-evidence',q.evidence),node('div','question-weight',q.weight+' คะแนน'));
        const scale=node('div','scale');['ไม่ผ่าน','ต้องปรับปรุง','พอใช้','ดี','ดีเยี่ยม'].forEach((label,value)=>{
          const option=node('label'),input=node('input'),box=node('span');input.type='radio';input.name='advisor_'+q.key;input.value=value;input.checked=answers[q.key]===value;input.setAttribute('aria-label',value+' '+label);
          input.addEventListener('change',()=>{answers[q.key]=value;update();});box.append(node('b','',value),node('span','',label));option.append(input,box);scale.append(option);
        });
        const current=node('p','selected-level');current.id='advisorLevel_'+q.key;
        const help=node('details','question-help'),ol=node('ol');ol.start=0;q.levels.forEach(l=>ol.append(node('li','',l)));help.append(node('summary','','คำอธิบายคะแนน 0–4'),ol);
        const proof=field('หลักฐาน / ลิงก์ประกอบข้อนี้ (ถ้ามี)','advisorEvidence_'+q.key,evidence[q.key]||'',2);const input=proof.querySelector('textarea');input.maxLength=1500;input.addEventListener('input',()=>{if(input.value)evidence[q.key]=input.value;else delete evidence[q.key];});
        f.append(scale,current,help,proof);body.append(f);
      });
      const next=node('button','btn secondary group-next',i<rubric.criteria.length-1?'ด้านถัดไป →':'ตรวจสอบคะแนนทั้ง 15 ข้อ →');next.type='button';next.id='advisorNext_'+c.key;next.addEventListener('click',()=>{if(i===rubric.criteria.length-1){review();return;}const target=$('advisorGroup_'+rubric.criteria[i+1].key);target.open=true;target.scrollIntoView({block:'start',behavior:'auto'});target.querySelector('summary').focus({preventScroll:true});});body.append(next);
      group.append(summary,body);group.addEventListener('toggle',()=>{if(group.open)document.querySelectorAll('.advisor-group').forEach(other=>{if(other!==group)other.open=false;});});$('advisorCriteria').append(group);
    });
    $('advisorNote').value=note;renderLogs();renderRevisions();update();
  }
  function update(){
    document.querySelectorAll('#advisorDetail input,#advisorDetail textarea').forEach(input=>{input.disabled=busy;});
    const count=questions().filter(q=>Number.isInteger(answers[q.key])).length;
    $('advisorTotal').textContent=total().toFixed(2);$('advisorCompletion').textContent='ประเมินแล้ว '+count+' / 15 ข้อ · ข้อที่เว้นไว้ยังไม่ประเมิน';$('advisorProgress').value=count;
    $('advisorReviewButton').disabled=busy||count!==15;$('advisorSaveDraft').disabled=busy;$('advisorLogSave').disabled=busy;$('advisorCloseStudent').disabled=busy;$('advisorRefresh').disabled=busy;
    $('advisorBreakdown').replaceChildren();rubric.criteria.forEach((c,i)=>{const answered=c.questions.filter(q=>Number.isInteger(answers[q.key])).length;$('advisorGroupProgress_'+c.key).textContent=answered+'/'+c.questions.length+' ข้อ';$('advisorNext_'+c.key).disabled=busy||(i===rubric.criteria.length-1?count!==15:answered!==c.questions.length);const row=node('div','breakdown-row');row.append(node('span','',c.mapping),node('strong','',points(c).toFixed(2)+' / '+c.weight));$('advisorBreakdown').append(row);});
    questions().forEach(q=>{$('advisorLevel_'+q.key).textContent=answers[q.key]===undefined?'ยังไม่ประเมิน':answers[q.key]+' · '+q.levels[answers[q.key]];});
  }
  function logState(){return JSON.stringify(['Date','Work','Evidence','Problems','Feedback','NextDate'].map(key=>$('advisorLog'+key)?.value||''));}
  function renderLogs(){
    $('advisorLogForm').reset();$('advisorLogDate').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());logOriginal=logState();
    $('advisorLogs').replaceChildren();const logs=data.consultations.filter(r=>r.studentId===selected.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    if(!logs.length)$('advisorLogs').append(node('p','helper','ยังไม่มีบันทึกการให้คำปรึกษา'));
    logs.forEach(r=>{const detail=node('details','advisor-log');detail.append(node('summary','',String(r.date).slice(0,10)+' · '+r.work.slice(0,90)));[['งานที่ตกลง / ความก้าวหน้า',r.work],['หลักฐาน',r.evidence],['ปัญหา',r.problems],['ข้อเสนอแนะ',r.feedback],['นัดหมายถัดไป',r.nextDate]].forEach(([label,text])=>{if(text)detail.append(node('strong','',label),node('p','advisor-prewrap',String(text)));});$('advisorLogs').append(detail);});
  }
  function renderRevisions(){
    $('advisorRevisions').replaceChildren();const list=data.revisions.filter(r=>r.studentId===selected.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    if(!list.length)$('advisorRevisions').append(node('p','helper','ยังไม่มีประวัติการบันทึกคะแนน'));
    list.forEach(r=>{const detail=node('details','advisor-log');detail.append(node('summary','',date(r.updatedAt)+' · '+(r.action==='confirmed'?'ยืนยัน '+Number(r.total).toFixed(2)+' / 50':'บันทึกร่าง')));
      questions().forEach(q=>detail.append(node('p','',q.label+': '+(r.snapshot.questionScores[q.key]??'ยังไม่ประเมิน')+' / 4'),node('p','helper advisor-prewrap',r.snapshot.evidence?.[q.key]||'')));
      if(r.snapshot.note)detail.append(node('p','advisor-prewrap','หมายเหตุ: '+r.snapshot.note));$('advisorRevisions').append(detail);});
  }
  async function write(payload){
    const result=await connection.write({assessment:'advisor',studentId:selected.id,...payload});
    if(!['created','updated'].includes(result.status))throw new Error(result.message||'บันทึกไม่สำเร็จ');return result;
  }
  async function save(action){
    if(busy||!selected)return;const submitted={answers:{...answers},evidence:{...evidence},note};busy=true;update();$('advisorSaveStatus').textContent='กำลังบันทึก…';$('advisorConfirm').disabled=true;$('advisorReviewBack').disabled=true;$('advisorReviewError').hidden=true;
    try{
      const result=await write({action,rubricVersion:rubric.rubricVersion,questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note});
      const saved={studentId:selected.id,rubricVersion:rubric.rubricVersion,questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note,total:result.total,updatedAt:result.updatedAt};
      const key=action==='confirm'?'records':'drafts';data[key]=data[key].filter(r=>r.studentId!==selected.id);data[key].push(saved);
      data.revisions.unshift({...saved,id:'local-'+result.updatedAt,action:action==='confirm'?'confirmed':'draft',snapshot:{questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note}});
      original=JSON.stringify(submitted);needsReload=true;$('advisorReview').close();renderList();renderRevisions();
      $('advisorOfficial').textContent=action==='confirm'?'คะแนนยืนยันล่าสุด '+Number(result.total).toFixed(2)+' / 50 · '+date(result.updatedAt):$('advisorOfficial').textContent;
      message(action==='confirm'?'ยืนยันคะแนน '+Number(result.total).toFixed(2)+' / 50 แล้ว':'บันทึกร่างแล้ว คะแนนยืนยันเดิมยังคงเดิม');
      $('advisorSaveStatus').textContent=(action==='confirm'?'ยืนยันคะแนนแล้ว':'บันทึกร่างแล้ว')+' · '+date(result.updatedAt);
    }catch(error){$('advisorSaveStatus').textContent=error.message;message(error.message+' หากไม่แน่ใจว่าสำเร็จ ให้รีเฟรชตรวจสอบก่อนลองอีกครั้ง',true);if($('advisorReview').open){$('advisorReviewError').textContent=error.message;$('advisorReviewError').hidden=false;}}
    finally{busy=false;$('advisorConfirm').disabled=false;$('advisorReviewBack').disabled=false;update();}
  }
  function review(){
    if(busy||questions().some(q=>answers[q.key]===undefined))return;
    $('advisorReviewStudent').textContent=selected.name+' · '+selected.id;$('advisorReviewDetails').replaceChildren();
    rubric.criteria.forEach(c=>{const group=node('section','review-group');group.append(node('h3','review-group-title',c.label+' · '+points(c).toFixed(2)+' / '+c.weight));c.questions.forEach(q=>{const row=node('div','review-row'),label=node('div');label.append(node('span','',q.label),node('small','helper','ระดับ '+answers[q.key]+'/4'));if(evidence[q.key])label.append(node('p','helper advisor-prewrap',evidence[q.key]));row.append(label,node('strong','',(answers[q.key]/4*q.weight).toFixed(2)));group.append(row);});$('advisorReviewDetails').append(group);});
    if(note)$('advisorReviewDetails').append(node('p','advisor-prewrap','หมายเหตุ: '+note));$('advisorReviewTotal').textContent=total().toFixed(2)+' / 50';$('advisorReviewError').hidden=true;$('advisorReview').showModal();
  }
  function init(){
    $('advisorRefresh').addEventListener('click',()=>{if(allowLeave()){discard();load(true);}});$('advisorRetry').addEventListener('click',()=>load(true));
    $('advisorSearch').addEventListener('input',()=>{if(data)renderList();});$('advisorFilter').addEventListener('change',()=>{if(data)renderList();});
    $('advisorCloseStudent').addEventListener('click',()=>{if(allowLeave())discard();});$('advisorNote').addEventListener('input',()=>{note=$('advisorNote').value;});
    $('advisorSaveDraft').addEventListener('click',()=>save('saveDraft'));$('advisorReviewButton').addEventListener('click',review);
    $('advisorConfirm').addEventListener('click',()=>save('confirm'));$('advisorReviewBack').addEventListener('click',()=>{if(!busy)$('advisorReview').close();});$('advisorReview').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    let requestId=null;
    $('advisorLogForm').addEventListener('input',()=>{requestId=null;});
    $('advisorLogForm').addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!selected)return;if(!$('advisorLogForm').reportValidity())return;
      busy=true;update();$('advisorLogStatus').textContent='กำลังบันทึก…';requestId=requestId||('log_'+Date.now()+'_'+Math.random().toString(36).slice(2));
      const entry={};['Date','Work','Evidence','Problems','Feedback','NextDate'].forEach(key=>{entry[key[0].toLowerCase()+key.slice(1)]=$('advisorLog'+key).value;});
      try{const result=await write({action:'consultation',requestId,entry});if(!data.consultations.some(r=>r.id===result.id))data.consultations.push({...entry,id:result.id,studentId:selected.id,updatedAt:new Date().toISOString()});requestId=null;needsReload=true;renderLogs();message('บันทึกการให้คำปรึกษาแล้ว');$('advisorLogStatus').textContent='บันทึกการให้คำปรึกษาแล้ว';}
      catch(error){message(error.message,true);$('advisorLogStatus').textContent=error.message;}finally{busy=false;update();}
    });
    $('advisorExport').addEventListener('click',()=>{
      const rows=[['รหัสนิสิต','ชื่อ','คะแนนที่ปรึกษาเต็ม50','บันทึกเมื่อ','เวอร์ชัน',...questions().map(q=>q.label+' (0–4)')]];data.records.forEach(r=>{const s=data.students.find(s=>s.id===r.studentId);if(s)rows.push([s.id,s.name,r.total,r.updatedAt,r.rubricVersion,...questions().map(q=>r.questionScores[q.key]??'')]);});
      const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=node('a');a.href=url;a.download='คะแนนที่ปรึกษาของฉัน.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    window.addEventListener('beforeunload',event=>{if(busy||dirty()){event.preventDefault();event.returnValue='';}});
  }
  init();return {configure,reset,load,allowLeave,discard,dirty,isBusy:()=>busy};
})();
