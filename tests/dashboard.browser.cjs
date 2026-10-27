const {chromium}=require('playwright');
const fs=require('fs'),assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(os.tmpdir(),'special-problem-ui-tests');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL==='bundled'?{}:{channel:process.env.UI_BROWSER_CHANNEL||'chrome'})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let calls=0;
await page.route('https://fonts.googleapis.com/**',r=>r.abort());
await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'window.google={accounts:{id:{initialize:o=>window.testLogin=o.callback,renderButton:el=>el.textContent="Google Sign-In",disableAutoSelect:()=>{}}}}'}));
await page.route('http://scoring.test/**',r=>{const file=new URL(r.request().url()).pathname.slice(1);return r.fulfill({body:fs.readFileSync(root+'/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});});
await page.route('https://script.google.com/**',r=>{
 calls++;const section=new URL(r.request().url()).searchParams.get('assessment');const max=section==='proposal'?10:20;
 const students=Array.from({length:13},(_,i)=>({id:'12345678'+String(i).padStart(2,'0'),name:'นิสิตทดสอบ '+(i+1),term:'ปกติ',room:i<7?'SC11-103':'SC11-203',topic:'ระบบสารสนเทศสำหรับจัดการโครงงานและติดตามผลการประเมิน',count:i<8?3:i<11?1:0,expected:3,avg:i<11?max-2:null}));
 return r.fulfill({json:{assessment:{id:section,label:'สอบวิพากษ์',max},stats:{totalStudents:13,overallAverage:max-2,evaluatedFull:8,evaluatedPartial:3,notEvaluated:2,duplicateStudentIds:[]},students,byRoom:[{room:'SC11-103',term:'ปกติ',studentCount:7,fullyEvaluated:7,avg:max-2},{room:'SC11-203',term:'ปกติ',studentCount:6,fullyEvaluated:1,avg:max-2}],criteriaAverages:['ระบบสารสนเทศและการแก้ปัญหา','เทคโนโลยี ฐานข้อมูล และโครงสร้างโปรแกรม','ความต้องการและความปลอดภัย','ความรับผิดชอบและความซื่อสัตย์','การสื่อสารและจริยธรรม IT/AI'].map((label,i)=>({label,weight:[6,3,5,2,4][i],avg:3.4})),byEvaluator:[{name:'อาจารย์ทดสอบการประเมิน',assignments:[{room:'SC11-103',term:'ปกติ'}],done:5,expected:7,doneStudents:students.slice(0,5),pendingStudents:students.slice(5,7)}]},headers:{'access-control-allow-origin':'*'}});
});
await page.goto('http://scoring.test/dashboard.html');await page.waitForFunction(()=>window.testLogin);
await page.screenshot({path:path.join(artifacts,"redesign-dashboard-login.png"),fullPage:true});
await page.evaluate(()=>testLogin({credential:'token'}));await page.locator('#dashboardContent').waitFor({state:'visible'});
assert.match(await page.locator('#statGrid').textContent(),/18\/20/);assert.equal(await page.locator('#studentTbody tr').count(),10);
await page.locator('.eval-toggle').click();assert.equal(await page.locator('.eval-toggle').getAttribute('aria-expanded'),'true');
await page.locator('#nextPage').click();assert.equal(await page.locator('#studentTbody tr').count(),3);
await page.locator('#assessmentSelect').selectOption('proposal',{force:true});await page.waitForFunction(()=>document.getElementById('statGrid').textContent.includes('8/10'));
await page.locator('#searchInput').fill('นิสิตทดสอบ 13');assert.equal(await page.locator('#studentTbody tr').count(),1);
await page.locator('#searchInput').fill('');await page.locator('#assessmentSelect').selectOption('defense',{force:true});await page.waitForFunction(()=>document.getElementById('statGrid').textContent.includes('18/20'));
await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,"redesign-dashboard-desktop.png"),fullPage:true});
for(const width of [768,390,320]){await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow at '+width);if(width===390)await page.screenshot({path:path.join(artifacts,"redesign-dashboard-mobile.png"),fullPage:true});}
await page.locator('#dashboardSort-trigger').click();await page.getByRole('option',{name:'คะแนนมากไปน้อย',exact:true}).click();assert.equal(await page.locator('#dashboardSort').inputValue(),'avg:-1');
await page.locator('#menuToggle').click();assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'true');await page.locator('#adminLogout').click();assert.equal(await page.locator('#loginGate').isVisible(),true);assert.deepEqual(errors,[]);console.log('Dashboard passed: auth gate, section switch, totals, search, pagination, accessible expand, widths 1440/768/390/320; no JS errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
