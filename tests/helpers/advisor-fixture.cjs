const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const sheets={Students:[['id','name','room','term','advisor','topic'],['123','Student','R1','regular','Teacher','Topic'],['456','Other room advisee','R2','special','Teacher','Other topic'],['789','Other student','R1','regular','Other teacher','Topic']],Committees:[['term','room','name','email'],['regular','R1','Teacher','teacher@example.com']],Scores:[['legacy'],['keep']],DefenseScores:[['legacy defense']]};let locked=false;const widths={};
 const wrap=name=>({getDataRange:()=>({getValues:()=>sheets[name].length?sheets[name].map(r=>r.slice()):[['']]}),getMaxColumns:()=>widths[name]||26,insertColumnsAfter:(after,n)=>{assert.ok(locked);widths[name]=after+n;},setFrozenRows:()=>{},appendRow:r=>{assert.ok(locked);sheets[name].push(r);},getRange:(r,c=1)=>({setValues:rows=>{assert.ok(locked);rows.forEach((row,i)=>{sheets[name][r-1+i]??=[];row.forEach((v,j)=>sheets[name][r-1+i][c-1+j]=v);});}})});
 const ss={getSheetByName:n=>sheets[n]?wrap(n):null,insertSheet:n=>{assert.ok(locked);sheets[n]=[];return wrap(n);}};
 const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{assert.ok(!locked);locked=true;},releaseLock:()=>{locked=false;}})},Utilities:{getUuid:()=>Math.random().toString(36)},UrlFetchApp:{fetch:url=>({getResponseCode:()=>url.endsWith('valid')||url.endsWith('advisoronly')?200:401,getContentText:()=>JSON.stringify({aud:'992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com',email:url.endsWith('advisoronly')?'advisor@example.com':'teacher@example.com',email_verified:'true'})})}});
 vm.runInContext(fs.readFileSync('Code.gs','utf8'),context);
 const answers=Object.fromEntries(context.advisorQuestions_().map(q=>[q.key,4]));const payload={assessment:'advisor',action:'confirm',idToken:'valid',studentId:'123',rubricVersion:'advisor-v1-15',questionScores:answers,evidence:{a1_q1:'https://example.com/work'},note:'Notes'};
 return {context,sheets,payload};
}
module.exports={fixture};
