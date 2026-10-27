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
  const wrap = name => ({getDataRange:()=>({getValues:()=>sheets[name].map(r=>r.slice())}),appendRow:row=>{assert.ok(locked);sheets[name].push(row)},getRange:r=>({setValues:rows=>{assert.ok(locked);sheets[name][r-1]=rows[0]}})});
  const context = vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:name=>sheets[name]?wrap(name):null}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{locked=true},releaseLock:()=>{locked=false}})},UrlFetchApp:{fetch:url=>({getResponseCode:()=>url.endsWith('valid')?200:401,getContentText:()=>JSON.stringify({aud:'992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com',email:'teacher@example.com',email_verified:'true'})})}});
  vm.runInContext(fs.readFileSync('Code.gs','utf8'),context);
  const payload = {idToken:'valid',assessment:'defense',studentId:'1234567890',studentName:'Forged',evaluatorName:'Forged',scores:{c1:4,c2:4,c3:4,c4:4,c5:4}};
  return {context,sheets,payload};
}
test('defense totals 20; identity and student fields come from sheets; proposal unchanged',()=>{
  const {context,sheets,payload}=fixture(); const before=JSON.stringify(sheets.Scores);
  assert.equal(context.submitScore(payload).total,20);
  assert.equal(sheets.DefenseScores[1][2],'Student'); assert.equal(sheets.DefenseScores[1][5],'Teacher'); assert.equal(sheets.DefenseScores[1][12],'teacher@example.com'); assert.equal(JSON.stringify(sheets.Scores),before);
});
test('upsert is keyed by student and verified email',()=>{
  const {context,sheets,payload}=fixture(); context.submitScore(payload); sheets.Committees[1][2]='Renamed'; payload.scores.c1=0;
  assert.equal(context.submitScore(payload).status,'updated'); assert.equal(sheets.DefenseScores.length,2); assert.equal(sheets.DefenseScores[1][11],14);
});
test('invalid token, wrong assignment, closed/planned sections and invalid scores cannot write',()=>{
  const {context,sheets,payload}=fixture();
  assert.equal(context.submitScore({...payload,idToken:'bad'}).status,'unauthorized');
  for(const assessment of ['proposal','advisor','progress','unknown','toString']) assert.throws(()=>context.submitScore({...payload,assessment}));
  for(const value of [-1,5,2.5,null,'4',NaN,Infinity,undefined]) assert.throws(()=>context.submitScore({...payload,scores:{...payload.scores,c1:value}}));
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
