'use strict';
window.SPProgress = (() => {
  const $ = id => document.getElementById(id);
  const node = (tag,cls,text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; };
  let planOriginal='',reviewPlanRevision=null;
  let connection, rubric, data=null, selected=null, answers={}, evidence={}, note='', original='', busy=false, fetching=false, generation=0, needsReload=true;
  const questions=()=>rubric.criteria.flatMap(c=>c.questions);
  const state=()=>JSON.stringify({answers,evidence,note});
  const planState=()=>JSON.stringify({title:$('progressPlanTitle').value,date:$('progressPlanDate').value,expectations:$('progressPlanExpectations').value});
  const planDirty=()=>!!data&&planState()!==planOriginal;
  const dirty=()=>planDirty()||!!selected&&state()!==original;
  const points=c=>c.questions.reduce((sum,q)=>sum+(answers[q.key]??0)/4*q.weight,0);
  const total=()=>rubric.criteria.reduce((sum,c)=>sum+points(c),0);
  const record=id=>data.records.find(r=>r.studentId===id);
  const draft=id=>data.drafts.find(r=>r.studentId===id);
  const date=value=>value?new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  function message(text,error=false){$('progressMessage').textContent=text;$('progressMessage').className='alert '+(error?'error':'success');$('progressMessage').hidden=false;}
  function configure(options){if(connection&&connection.accountKey!==options.accountKey)reset();connection=options;rubric=options.rubric;}
  function reset(){generation++;data=null;selected=null;answers={};evidence={};note='';original='';planOriginal='';busy=false;fetching=false;needsReload=true;$('progressReview')?.close();$('progressList').replaceChildren();$('progressDetail').hidden=true;['progressCriteria','progressRevisions','progressReviewDetails'].forEach(id=>$(id).replaceChildren());['progressStudentName','progressStudentMeta','progressOfficial','progressPlanNotice','progressPlanSummary','progressPlanEvidence','progressPlanHeadingMeta','progressReviewStudent','progressReviewPlan','progressReviewTotal','progressSaveStatus'].forEach(id=>{$(id).textContent='';});['progressPlanTitle','progressPlanDate','progressPlanExpectations','progressNote'].forEach(id=>{$(id).value='';});}
  async function load(force=false){
    $('progressDenied').hidden=!!connection?.isManager;$('progressWorkspace').hidden=!connection?.isManager;if(!connection?.isManager)return;
    if(fetching||busy)return;
    if(data&&!force&&!needsReload)return;
    if(dirty()&&!force)return;
    const version=++generation;fetching=true;$('progressLoading').hidden=false;$('progressRetry').hidden=true;$('progressMessage').hidden=true;
    try{
      const result=await connection.read('getProgressWorkspace');if(version!==generation)return;
      if(result.status!=='ok'||!Array.isArray(result.students))throw new Error('โหลดรายงานความก้าวหน้าไม่สำเร็จ');
      if(dirty()){needsReload=true;return;}
      data=result;needsReload=false;renderPlan();renderList();if(selected){selected=data.students.find(s=>s.id===selected.id)||null;if(selected)renderDetail();else $('progressDetail').hidden=true;}
    }catch(error){if(version===generation){message(error.message,true);$('progressRetry').hidden=false;}}
    finally{if(version===generation){fetching=false;$('progressLoading').hidden=true;}}
  }
  function allowLeave(){return !busy&&(!dirty()||confirm('มีแผนหรือคะแนนที่ยังไม่ได้บันทึก ต้องการออกและยกเลิกการแก้ไขหรือไม่?'));}
  function discard(){selected=null;answers={};evidence={};note='';original='';$('progressDetail').hidden=true;if(data)renderPlan();}
  function renderList(){
    const query=$('progressSearch').value.trim().toLowerCase();const status=$('progressFilter').value;
    const done=data.records.length;$('progressStats').textContent='นิสิตทั้งหมด '+data.students.length+' คน · ยืนยันแล้ว '+done+' คน · ยังไม่ยืนยัน '+(data.students.length-done)+' คน';
    $('progressEmpty').hidden=!!data.students.length;$('progressExport').disabled=!done;
    $('progressList').replaceChildren();
    const visible=data.students.filter(s=>(s.id+s.name+s.topic).toLowerCase().includes(query)&&(status==='all'||(status==='done'?!!record(s.id):!record(s.id))));
    visible.forEach(s=>{
      const r=record(s.id),d=draft(s.id),hasDraft=d&&(!r||new Date(d.updatedAt)>new Date(r.updatedAt));const card=node('article','progress-student-row');
      const info=node('div');info.append(node('strong','',s.name),node('span','student-id',s.id),node('p','student-topic',s.topic||'ยังไม่ระบุหัวข้อ'));
      const right=node('div','progress-row-actions');right.append(node('span','badge '+(r?'sage':'neutral'),r?Number(r.total).toFixed(2)+' / 20':'ยังไม่ยืนยัน'));
      if(hasDraft)right.append(node('span','badge warning','มีร่าง '+Object.keys(d.questionScores).length+'/15 ข้อ'));
      const button=node('button','btn secondary small',r?'ดู / แก้ไข':'เปิดประเมิน');button.type='button';button.setAttribute('aria-label','ประเมินความก้าวหน้า '+s.name);button.addEventListener('click',()=>open(s.id));right.append(button);card.append(info,right);$('progressList').append(card);
    });
    $('progressNoResults').hidden=!data.students.length||!!visible.length;
  }
  function open(id){
    if(!allowLeave())return;if(planDirty())renderPlan();selected=data.students.find(s=>s.id===id);if(!selected)return;
    const r=record(id),d=draft(id);const source=d&&(!r||new Date(d.updatedAt)>new Date(r.updatedAt))?d:r;
    answers=source?.rubricVersion===rubric.rubricVersion?{...source.questionScores}:{};evidence={...(source?.evidence||{})};note=source?.note||'';original=state();
    renderDetail();$('progressDetail').scrollIntoView({block:'start',behavior:'auto'});$('progressStudentName').focus({preventScroll:true});
  }
  function field(label,id,value='',rows=3){const wrap=node('label','progress-field',label),input=node('textarea');input.id=id;input.rows=rows;input.value=value;input.maxLength=4000;wrap.append(input);return wrap;}
  function renderDetail(){
    $('progressSaveStatus').textContent='';$('progressSaveStatus').classList.remove('is-error');$('progressDetail').hidden=false;$('progressStudentName').textContent=selected.name;$('progressStudentMeta').textContent=selected.id+' · '+selected.topic;
    const r=record(selected.id);$('progressOfficial').textContent=r?'คะแนนยืนยันล่าสุด '+Number(r.total).toFixed(2)+' / 20 · '+date(r.updatedAt):'ยังไม่มีคะแนนยืนยัน · คะแนนร่างไม่รวมในผลรายวิชา';
    $('progressCriteria').replaceChildren();
    rubric.criteria.forEach((c,i)=>{
      const group=node('details','rubric-group card progress-group');group.open=i===0;group.id='progressGroup_'+c.key;
      const summary=node('summary','rubric-group-heading');summary.append(node('strong','',(i+1)+'. '+c.label),node('span','badge neutral',c.weight+' คะแนน'));const progress=node('span','badge neutral');progress.id='progressGroupProgress_'+c.key;summary.append(progress);
      const body=node('div','rubric-group-body');body.append(node('p','helper',c.mapping+' · '+c.evidence));
      c.questions.forEach((q,j)=>{
        const f=node('fieldset','question-card'),legend=node('legend','',(i+1)+'.'+(j+1)+' '+q.label);f.append(legend,node('p','criterion-evidence',q.evidence),node('div','question-weight',q.weight+' คะแนน'));
        const scale=node('div','scale');['ไม่ผ่าน','ต้องปรับปรุง','พอใช้','ดี','ดีเยี่ยม'].forEach((label,value)=>{
          const option=node('label'),input=node('input'),box=node('span');input.type='radio';input.name='progress_'+q.key;input.value=value;input.checked=answers[q.key]===value;input.setAttribute('aria-label',value+' '+label);
          input.addEventListener('change',()=>{answers[q.key]=value;update();});box.append(node('b','',value),node('span','',label));option.append(input,box);scale.append(option);
        });
        const current=node('p','selected-level');current.id='progressLevel_'+q.key;
        const help=node('details','question-help'),ol=node('ol');ol.start=0;q.levels.forEach(l=>ol.append(node('li','',l)));help.append(node('summary','','คำอธิบายคะแนน 0–4'),ol);
        const proof=field('หลักฐาน / ลิงก์ประกอบข้อนี้ (ถ้ามี)','progressEvidence_'+q.key,evidence[q.key]||'',2);const input=proof.querySelector('textarea');input.maxLength=1500;input.addEventListener('input',()=>{if(input.value)evidence[q.key]=input.value;else delete evidence[q.key];});
        f.append(scale,current,help,proof);body.append(f);
      });
      const next=node('button','btn secondary group-next',i<rubric.criteria.length-1?'ด้านถัดไป →':'ตรวจสอบคะแนนทั้ง 15 ข้อ →');next.type='button';next.id='progressNext_'+c.key;next.addEventListener('click',()=>{if(i===rubric.criteria.length-1){review();return;}const target=$('progressGroup_'+rubric.criteria[i+1].key);target.open=true;target.scrollIntoView({block:'start',behavior:'auto'});target.querySelector('summary').focus({preventScroll:true});});body.append(next);
      group.append(summary,body);group.addEventListener('toggle',()=>{if(group.open)document.querySelectorAll('.progress-group').forEach(other=>{if(other!==group)other.open=false;});});$('progressCriteria').append(group);
    });
    $('progressNote').value=note;renderRevisions();renderPlanNotice();update();
  }
  function update(){
    document.querySelectorAll('#view-progress input,#view-progress textarea').forEach(input=>{input.disabled=busy;});
    $('progressPlanSave').disabled=busy||!planDirty();$('progressRefresh').disabled=busy;
    if(!selected)return;
    const count=questions().filter(q=>Number.isInteger(answers[q.key])).length;
    $('progressTotal').textContent=total().toFixed(2);$('progressCompletion').textContent='ประเมินแล้ว '+count+' / 15 ข้อ · ข้อที่เว้นไว้ยังไม่ประเมิน';$('progressProgress').value=count;
    $('progressReviewButton').disabled=busy||planDirty()||count!==15;$('progressSaveDraft').disabled=busy||planDirty();$('progressCloseStudent').disabled=busy;$('progressRefresh').disabled=busy;
    $('progressBreakdown').replaceChildren();rubric.criteria.forEach((c,i)=>{const answered=c.questions.filter(q=>Number.isInteger(answers[q.key])).length;$('progressGroupProgress_'+c.key).textContent=answered+'/'+c.questions.length+' ข้อ';$('progressNext_'+c.key).disabled=busy||(i===rubric.criteria.length-1?count!==15:answered!==c.questions.length);const row=node('div','breakdown-row');row.append(node('span','',c.mapping),node('strong','',points(c).toFixed(2)+' / '+c.weight));$('progressBreakdown').append(row);});
    questions().forEach(q=>{$('progressLevel_'+q.key).textContent=answers[q.key]===undefined?'ยังไม่ประเมิน':answers[q.key]+' · '+q.levels[answers[q.key]];});
  }
  function renderRevisions(){
    $('progressRevisions').replaceChildren();const list=data.revisions.filter(r=>r.studentId===selected.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    if(!list.length)$('progressRevisions').append(node('p','helper','ยังไม่มีประวัติการบันทึกคะแนน'));
    list.forEach(r=>{const detail=node('details','progress-log');detail.append(node('summary','',date(r.updatedAt)+' · '+(r.action==='confirmed'?'ยืนยัน '+Number(r.total).toFixed(2)+' / 20':'บันทึกร่าง')));
      questions().forEach(q=>detail.append(node('p','',q.label+': '+(r.snapshot.questionScores[q.key]??'ยังไม่ประเมิน')+' / 4'),node('p','helper progress-prewrap',r.snapshot.evidence?.[q.key]||'')));
      if(r.snapshot.plan)detail.append(node('p','helper','แผนรุ่น '+r.snapshot.plan.revision+' · '+r.snapshot.plan.title),node('p','helper progress-prewrap',r.snapshot.plan.expectations));
      if(r.snapshot.note)detail.append(node('p','progress-prewrap','หมายเหตุ: '+r.snapshot.note));$('progressRevisions').append(detail);});
  }
  async function write(payload){
    const result=await connection.write({assessment:'progress',studentId:selected?.id,planRevision:data.plan.revision,...payload});
    if(!['created','updated'].includes(result.status))throw new Error(result.message||'บันทึกไม่สำเร็จ');return result;
  }
  async function save(action){
    if(busy||!selected||planDirty())return;const submitted={answers:{...answers},evidence:{...evidence},note};busy=true;update();$('progressSaveStatus').classList.remove('is-error');$('progressSaveStatus').textContent='กำลังบันทึก…';$('progressConfirm').disabled=true;$('progressReviewBack').disabled=true;$('progressReviewError').hidden=true;
    try{
      const result=await write({action,rubricVersion:rubric.rubricVersion,questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note,planRevision:action==='confirm'?reviewPlanRevision:data.plan.revision});
      const saved={studentId:selected.id,rubricVersion:rubric.rubricVersion,questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note,plan:result.plan,total:result.total,updatedAt:result.updatedAt};
      const key=action==='confirm'?'records':'drafts';data[key]=data[key].filter(r=>r.studentId!==selected.id);data[key].push(saved);
      data.revisions.unshift({...saved,id:'local-'+result.updatedAt,action:action==='confirm'?'confirmed':'draft',snapshot:{questionScores:submitted.answers,evidence:submitted.evidence,note:submitted.note,plan:result.plan}});
      original=JSON.stringify(submitted);needsReload=true;$('progressReview').close();renderList();renderRevisions();renderPlanNotice();
      $('progressOfficial').textContent=action==='confirm'?'คะแนนยืนยันล่าสุด '+Number(result.total).toFixed(2)+' / 20 · '+date(result.updatedAt):$('progressOfficial').textContent;
      message(action==='confirm'?'ยืนยันคะแนน '+Number(result.total).toFixed(2)+' / 20 แล้ว':'บันทึกร่างแล้ว คะแนนยืนยันเดิมยังคงเดิม');
      $('progressSaveStatus').textContent=(action==='confirm'?'ยืนยันคะแนนแล้ว':'บันทึกร่างแล้ว')+' · '+date(result.updatedAt);
    }catch(error){$('progressSaveStatus').classList.add('is-error');$('progressSaveStatus').textContent=error.message;message(error.message+' หากไม่แน่ใจว่าสำเร็จ ให้รีเฟรชตรวจสอบก่อนลองอีกครั้ง',true);if($('progressReview').open){$('progressReviewError').textContent=error.message;$('progressReviewError').hidden=false;}}
    finally{busy=false;$('progressConfirm').disabled=false;$('progressReviewBack').disabled=false;update();}
  }
  function review(){
    if(busy||planDirty()||questions().some(q=>answers[q.key]===undefined))return;
    reviewPlanRevision=data.plan.revision;$('progressReviewStudent').textContent=selected.name+' · '+selected.id;$('progressReviewPlan').textContent=data.plan.title+' · แผนรุ่น '+data.plan.revision+' · '+(data.plan.date||'ยังไม่กำหนดวันประเมิน');$('progressReviewDetails').replaceChildren();
    rubric.criteria.forEach(c=>{const group=node('section','review-group');group.append(node('h3','review-group-title',c.label+' · '+points(c).toFixed(2)+' / '+c.weight));c.questions.forEach(q=>{const row=node('div','review-row'),label=node('div');label.append(node('span','',q.label),node('small','helper','ระดับ '+answers[q.key]+'/4'));if(evidence[q.key])label.append(node('p','helper progress-prewrap',evidence[q.key]));row.append(label,node('strong','',(answers[q.key]/4*q.weight).toFixed(2)));group.append(row);});$('progressReviewDetails').append(group);});
    if(note)$('progressReviewDetails').append(node('p','progress-prewrap','หมายเหตุ: '+note));$('progressReviewTotal').textContent=total().toFixed(2)+' / 20';$('progressReviewError').hidden=true;$('progressReview').showModal();
  }
  function renderPlan(){
    $('progressPlanTitle').value=data.plan.title;$('progressPlanDate').value=data.plan.date;$('progressPlanExpectations').value=data.plan.expectations;planOriginal=planState();
    $('progressPlanSummary').textContent=data.plan.title+' · '+(data.plan.date||'ยังไม่กำหนดวันประเมิน')+' · แผนรุ่น '+data.plan.revision;
    $('progressPlanHeadingMeta').textContent=data.plan.title+' · '+(data.plan.date||'ยังไม่กำหนดวันประเมิน');$('progressPlanEvidence').textContent=data.plan.expectations;update();
  }
  function renderPlanNotice(){
    if(!selected)return;const saved=record(selected.id);$('progressPlanNotice').hidden=!saved?.plan||saved.plan.revision===data.plan.revision;
    $('progressPlanNotice').textContent=saved?.plan?'คะแนนยืนยันเดิมใช้แผนรุ่น '+saved.plan.revision+' · '+saved.plan.title+' ขณะนี้เป็นแผนรุ่น '+data.plan.revision+' คะแนนเดิมจะคงอยู่จนกว่าจะประเมินและยืนยันใหม่':'';
  }
  async function savePlan(){
    if(busy||!data||!planDirty())return;if(!$('progressPlanForm').reportValidity())return;
    const submitted=JSON.parse(planState());busy=true;update();$('progressPlanStatus').textContent='กำลังบันทึกแผน…';
    try{const result=await write({action:'savePlan',plan:submitted});data.plan=result.plan;renderPlan();renderPlanNotice();$('progressPlanStatus').textContent='บันทึกแผนรุ่น '+data.plan.revision+' แล้ว';message('บันทึกแผนประเมินแล้ว คะแนนที่เคยยืนยันไม่เปลี่ยนแปลง');}
    catch(error){$('progressPlanStatus').textContent=error.message;message(error.message,true);}finally{busy=false;update();}
  }
  function init(){
    $('progressPlanForm').addEventListener('submit',event=>{event.preventDefault();savePlan();});['Title','Date','Expectations'].forEach(key=>$('progressPlan'+key).addEventListener('input',update));
    $('progressRefresh').addEventListener('click',()=>{if(allowLeave()){discard();load(true);}});$('progressRetry').addEventListener('click',()=>load(true));
    $('progressSearch').addEventListener('input',()=>{if(data)renderList();});$('progressFilter').addEventListener('change',()=>{if(data)renderList();});
    $('progressCloseStudent').addEventListener('click',()=>{if(allowLeave())discard();});$('progressNote').addEventListener('input',()=>{note=$('progressNote').value;});
    $('progressSaveDraft').addEventListener('click',()=>save('saveDraft'));$('progressReviewButton').addEventListener('click',review);
    $('progressConfirm').addEventListener('click',()=>save('confirm'));$('progressReviewBack').addEventListener('click',()=>{if(!busy)$('progressReview').close();});$('progressReview').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    $('progressExport').addEventListener('click',()=>{
      const rows=[['รหัสนิสิต','ชื่อ','คะแนนความก้าวหน้าเต็ม20','บันทึกเมื่อ','เวอร์ชัน','รุ่นแผน','รอบประเมิน',...questions().map(q=>q.label+' (0–4)')]];data.records.forEach(r=>{const s=data.students.find(s=>s.id===r.studentId);if(s)rows.push([s.id,s.name,r.total,r.updatedAt,r.rubricVersion,r.plan?.revision??'',r.plan?.title??'',...questions().map(q=>r.questionScores[q.key]??'')]);});
      const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=node('a');a.href=url;a.download='คะแนนรายงานความก้าวหน้า.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    window.addEventListener('beforeunload',event=>{if(busy||dirty()){event.preventDefault();event.returnValue='';}});
  }
  function search(query){$('progressSearch').value=query;if(data)renderList();$('progressSearch').focus({preventScroll:true});}
  init();return {configure,reset,load,allowLeave,discard,dirty,search,isBusy:()=>busy};
})();
