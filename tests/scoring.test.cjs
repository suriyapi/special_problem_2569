const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const sheets = {
    Students: [['id','name','room','term','advisor','topic'],['1234567890','Student','R1','ปกติ','Advisor','Topic']],
    Committees: [['term','room','name','email'],['ปกติ','R1','Teacher','teacher@example.com']],
    Scores: [['timestamp','id','name','room','term','evaluator','c1','c2','c3','c4','c5','total'],[new Date(),'1234567890','Student','R1','ปกติ','Teacher',4,4,4,4,4,10]],
    DefenseScores: [['timestamp','id','name','room','term','evaluator','c1','c2','c3','c4','c5','total','email']]
  };
  let locked = false;
  const maxColumns = {};
  const wrap = name => ({
    getDataRange:()=>({getValues:()=>sheets[name].map(r=>r.slice())}),
    getMaxColumns:()=>maxColumns[name] || 26,
    insertColumnsAfter:(after,count)=>{assert.ok(locked);assert.equal(after,maxColumns[name] || 26);maxColumns[name]=after+count;},
    appendRow:row=>{assert.ok(locked);sheets[name].push(row)},
    getRange:(r,c=1)=>({setValues:rows=>{assert.ok(locked);rows.forEach((row,i)=>{if(!sheets[name][r-1+i])sheets[name][r-1+i]=[];row.forEach((value,j)=>{sheets[name][r-1+i][c-1+j]=value;});});}})
  });
  const context = vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:name=>sheets[name]?wrap(name):null}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{locked=true},releaseLock:()=>{locked=false}})},UrlFetchApp:{fetch:url=>({getResponseCode:()=>url.endsWith('valid')?200:401,getContentText:()=>JSON.stringify({aud:'992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com',email:'teacher@example.com',email_verified:'true'})})}});
  vm.runInContext(fs.readFileSync('Code.gs','utf8'),context);
  const payload = {idToken:'valid',assessment:'defense',studentId:'1234567890',studentName:'Forged',evaluatorName:'Forged',scores:{c1:999,c2:999,c3:999,c4:999,c5:999},rubricVersion:'defense-v2-15',questionScores:Object.fromEntries(context.getDefenseQuestions_().map(q=>[q.key,4]))};
  return {context,sheets,payload};
}
test('defense totals 20; identity and student fields come from sheets; proposal unchanged',()=>{
  const {context,sheets,payload}=fixture(); const before=JSON.stringify(sheets.Scores);
  assert.equal(context.submitScore(payload).total,20);
  assert.equal(sheets.DefenseScores[1][2],'Student'); assert.equal(sheets.DefenseScores[1][5],'Teacher'); assert.equal(sheets.DefenseScores[1][12],'teacher@example.com'); assert.equal(JSON.stringify(sheets.Scores),before);
});
test('upsert is keyed by student and verified email',()=>{
  const {context,sheets,payload}=fixture(); context.submitScore(payload); sheets.Committees[1][2]='Renamed'; payload.questionScores.c1_q1=0;payload.questionScores.c1_q2=0;payload.questionScores.c1_q3=0;
  assert.equal(context.submitScore(payload).status,'updated'); assert.equal(sheets.DefenseScores.length,2); assert.equal(sheets.DefenseScores[1][11],14);
});
test('invalid token, wrong assignment, closed/planned sections and invalid scores cannot write',()=>{
  const {context,sheets,payload}=fixture();
  assert.equal(context.submitScore({...payload,idToken:'bad'}).status,'unauthorized');
  for(const assessment of ['proposal','advisor','progress','unknown','toString']) assert.throws(()=>context.submitScore({...payload,assessment}));
  for(const value of [-1,5,2.5,null,'4',NaN,Infinity,undefined]) assert.throws(()=>context.submitScore({...payload,questionScores:{...payload.questionScores,c1_q1:value}}));
  sheets.Committees[1][1]='R2'; assert.throws(()=>context.submitScore(payload)); assert.equal(sheets.DefenseScores.length,1);
});
test('dashboard reads selected section and total column L rather than email',()=>{
  const {context,payload}=fixture(); context.submitScore(payload);
  const defense=context.getDashboardData('defense'),proposal=context.getDashboardData('proposal');
  assert.equal(defense.assessment.max,20);assert.equal(defense.students[0].avg,20);assert.equal(proposal.students[0].avg,10);
});
test('unknown student and unlisted email rejected',()=>{
  const {context,payload,sheets}=fixture();assert.throws(()=>context.submitScore({...payload,studentId:'9999999999'}));
  sheets.Committees[1][3]='someone@example.com';assert.equal(context.submitScore(payload).status,'unauthorized');assert.equal(sheets.DefenseScores.length,1);
});
test('setupDefenseSheets is repeatable and preserves existing score sheets',()=>{
  const {context,sheets,payload}=fixture();context.submitScore(payload);const before=JSON.stringify(sheets);
  const summaries={};
  function sheet(name){return {getLastRow:()=>sheets[name]?.length||0,getRange:(r,c,n,w)=>({setValues:values=>{summaries[name]=values},setFormulas:values=>{summaries[name]=values}}),setFrozenRows:()=>{}}}
  context.SpreadsheetApp.getActiveSpreadsheet=()=>({getSheetByName:name=>sheets[name]||summaries[name]?sheet(name):null,insertSheet:name=>{summaries[name]=[];return sheet(name)}});
  context.setupDefenseSheets();context.setupDefenseSheets();
  assert.equal(JSON.stringify(sheets),before);assert.match(summaries.DefenseSummary[0][3],/DefenseScores!L:L/);
});
test('workspace exposes assigned students and only verified evaluator records',()=>{
  const {context,sheets,payload}=fixture();context.submitScore(payload);
  sheets.Students.push(['9999999999','Other room','R2','ปกติ','Advisor','Private topic']);
  sheets.DefenseScores.push([new Date(),'1234567890','Student','R1','ปกติ','Other teacher',0,0,0,0,0,0,'other@example.com']);
  sheets.DefenseScores.push([new Date(),'9999999999','Other room','R2','ปกติ','Teacher',4,4,4,4,4,20,'teacher@example.com']);
  const result=context.getMyWorkspace('valid');assert.equal(result.status,'ok');assert.equal(result.students.length,1);assert.equal(result.students[0].id,'1234567890');assert.equal(result.records.length,2);assert.equal(result.records.find(r=>r.assessment==='defense').total,20);assert.equal(result.records.find(r=>r.assessment==='proposal').total,10);
  assert.equal(context.getMyWorkspace('bad').status,'unauthorized');
});
test('workspace does not use display name to claim another email defense record',()=>{
  const {context,sheets}=fixture();sheets.DefenseScores.push([new Date(),'1234567890','Student','R1','ปกติ','Teacher',4,4,4,4,4,20,'other@example.com']);
  assert.equal(context.getMyWorkspace('valid').records.filter(r=>r.assessment==='defense').length,0);
});

test('rubric has 15 unique scored questions with matching domain weights and five levels',()=>{
  const {context}=fixture();const questions=context.getDefenseQuestions_();assert.equal(questions.length,15);assert.equal(new Set(questions.map(q=>q.key)).size,15);
  assert.equal(questions.reduce((sum,q)=>sum+q.weight,0),20);
  for(const q of questions){assert.equal(q.levels.length,5);assert.ok(q.prompt);}
  assert.equal(context.calculateDefenseScores_(Object.fromEntries(questions.map(q=>[q.key,0]))).total,0);
});
test('weighted question totals populate equivalent domain scores and dedicated raw columns',()=>{
  const {context,payload,sheets}=fixture();for(const key of Object.keys(payload.questionScores))payload.questionScores[key]=0;
  payload.questionScores.c1_q1=4;payload.questionScores.c3_q1=4;payload.questionScores.c3_q3=4;
  const result=context.submitScore(payload);assert.equal(result.total,5);assert.equal(result.criterionScores.c1,4/3);assert.equal(result.criterionScores.c3,2.4);
  const row=sheets.DefenseScores[1];assert.equal(row.length,29);assert.equal(row[11],5);assert.equal(row[12],'teacher@example.com');assert.equal(row[13],'defense-v2-15');assert.equal(row[14],4);assert.equal(row[28],0);
  assert.equal(sheets.DefenseScores[0][11],'total');assert.equal(sheets.DefenseScores[0][12],'email');assert.match(sheets.DefenseScores[0][14],/c1_q1/);
  const own=context.getMyWorkspace('valid').records.find(r=>r.assessment==='defense');assert.equal(Object.keys(own.questionScores).length,15);assert.equal(own.questionScores.c3_q3,4);assert.equal(own.total,5);
});
test('legacy scores remain unmodified and are never projected into new question answers',()=>{
  const {context,payload,sheets}=fixture();const legacy=[new Date(),'1234567890','Student','R1','ปกติ','Teacher',3,3,3,3,3,15,'teacher@example.com'];sheets.DefenseScores.push(legacy.slice());
  let record=context.getMyWorkspace('valid').records.find(r=>r.assessment==='defense');assert.equal(record.rubricVersion,'defense-v1');assert.equal(record.questionScores,null);assert.equal(record.total,15);
  const before=JSON.stringify(sheets.DefenseScores[1]);sheets.Students.push(['2234567890','Second','R1','ปกติ','Advisor','Topic']);context.submitScore({...payload,studentId:'2234567890'});assert.equal(JSON.stringify(sheets.DefenseScores[1]),before);
  assert.equal(context.submitScore(payload).status,'updated');record=context.getMyWorkspace('valid').records.find(r=>r.assessment==='defense'&&r.studentId==='1234567890');assert.equal(record.total,20);assert.equal(record.rubricVersion,'defense-v2-15');assert.equal(sheets.DefenseScores.length,3);
});
test('incomplete questions, stale five-domain clients and foreign reserved columns cannot write',()=>{
  const {context,payload,sheets}=fixture();const missing={...payload.questionScores};delete missing.c1_q1;
  assert.throws(()=>context.submitScore({...payload,questionScores:missing}));assert.throws(()=>context.submitScore({...payload,questionScores:{...payload.questionScores,other:4}}));
  assert.throws(()=>context.submitScore({...payload,rubricVersion:undefined,questionScores:undefined}));
  sheets.DefenseScores[0][13]='บันทึกเดิม';const before=JSON.stringify(sheets.DefenseScores);assert.throws(()=>context.submitScore(payload));assert.equal(JSON.stringify(sheets.DefenseScores),before);
});
test('reserved question columns with existing data but blank headers are protected',()=>{
  const {context,payload,sheets}=fixture();const row=[new Date(),'1234567890','Student','R1','ปกติ','Teacher',3,3,3,3,3,15,'teacher@example.com','หมายเหตุเดิม'];sheets.DefenseScores.push(row);const before=JSON.stringify(sheets.DefenseScores);
  assert.throws(()=>context.submitScore(payload));assert.equal(JSON.stringify(sheets.DefenseScores),before);
});
