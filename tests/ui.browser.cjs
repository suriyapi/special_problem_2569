const {chromium}=require('playwright');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const touchMode=process.argv.includes('--touch');
const path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(os.tmpdir(),'special-problem-ui-tests');fs.mkdirSync(artifacts,{recursive:true});const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(root+'/Code.gs','utf8'),ctx);const config=JSON.parse(vm.runInContext('JSON.stringify({assessments:Object.values(ASSESSMENTS)})',ctx));
const people=['นายธนกร ใจดี','นางสาวกัญญารัตน์ วัฒนกุล','นายปกรณ์ พัฒนกิจ','นางสาวชลธิชา ศรีสุข','นายภัทรพล ตั้งใจ','นางสาวณัฐธิดา ก้าวหน้า'];
const students=people.map((name,i)=>({id:'66216000'+String(i+1).padStart(2,'0'),name,term:i<3?'ปกติ':'พิเศษ',room:i<3?'SC11-103':'SC11-203',advisor:'กรรมการทดสอบ',topic:['ระบบจัดการโครงงานและติดตามความก้าวหน้าของนิสิต','แอปพลิเคชันแนะนำเส้นทางการท่องเที่ยวเชิงชุมชน','ระบบวิเคราะห์ข้อมูลเพื่อสนับสนุนการตัดสินใจ','ระบบจองห้องประชุมและบริหารทรัพยากร','ระบบติดตามสินค้าคงคลังสำหรับธุรกิจขนาดเล็ก','แพลตฟอร์มแลกเปลี่ยนความรู้สำหรับนิสิต'][i]}));
const evaluator={ok:true,name:'กรรมการทดสอบ',email:'committee@example.com',assignments:[{term:'ปกติ',room:'SC11-103'},{term:'พิเศษ',room:'SC11-203'}]};
let records=[{assessment:'defense',studentId:students[0].id,scores:{c1:3,c2:4,c3:3,c4:4,c5:3},total:16.25,updatedAt:'2026-10-28T01:00:00Z'},{assessment:'proposal',studentId:students[0].id,scores:{c1:4,c2:4,c3:4,c4:4,c5:4},total:10,updatedAt:'2026-07-25T01:00:00Z'}];
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL==='bundled'?{}:{channel:process.env.UI_BROWSER_CHANNEL||'chrome'})});const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:touchMode,isMobile:touchMode});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0,failSave=false;
await page.route('https://fonts.googleapis.com/**',r=>r.abort());
await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'window.google={accounts:{id:{initialize:o=>window.testLogin=o.callback,renderButton:el=>{el.innerHTML="<button onclick=\\"testLogin({credential:\\u0027token\\u0027})\\">เข้าสู่ระบบด้วย Google</button>"},disableAutoSelect:()=>{}}}}'}));
await page.route('http://scoring.test/**',r=>{const path=new URL(r.request().url()).pathname;const file=path==='/'?'index.html':path.slice(1);r.fulfill({body:fs.readFileSync(root+'/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});});
await page.route('https://script.google.com/**',r=>{const request=r.request(),action=new URL(request.url()).searchParams.get('action');let result;if(request.method()==='POST'){const data=request.postDataJSON();assert.equal(data.idToken,'token');assert.equal(data.assessment,'defense');if(failSave){result={status:'error',message:'เครือข่ายขัดข้อง กรุณาลองใหม่'};}else{writes++;assert.equal(data.rubricVersion,'defense-v2-15');const calculated=ctx.calculateDefenseScores_(data.questionScores);const total=calculated.total;records=records.filter(x=>!(x.assessment==='defense'&&x.studentId===data.studentId));records.push({assessment:'defense',studentId:data.studentId,scores:calculated.criterionScores,questionScores:data.questionScores,rubricVersion:data.rubricVersion,total,updatedAt:new Date().toISOString()});result={status:'updated',total,criterionScores:calculated.criterionScores,rubricVersion:data.rubricVersion};}}else if(action==='getCriteria')result=config;else if(action==='getMyEvaluatorInfo')result=evaluator;else if(action==='getMyWorkspace')result={status:'ok',evaluator,students,records};else throw Error(action);return r.fulfill({json:result,headers:{'access-control-allow-origin':'*'}});});

await page.goto('http://scoring.test/');await page.waitForFunction(()=>window.testLogin);await page.evaluate(()=>testLogin({credential:'token'}));await page.locator('#view-overview').waitFor({state:'visible'});
for(const width of [1440,1180,1101,1100,1024,834,820,768,600,430,390,375,320]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.locator('#menuToggle').isVisible(),width<=1100,'Hamburger breakpoint '+width);
  for(const route of ['overview','students','history','guide']){
    await page.evaluate(route=>location.hash=route,route);await page.locator('#view-'+route).waitFor({state:'visible'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow '+route+' '+width);
  }
  await page.evaluate(()=>location.hash='students');await page.locator('#view-students').waitFor({state:'visible'});
  if(width<=900)assert.ok(await page.locator('#view-students .table-scroll').evaluate(node=>node.scrollWidth<=node.clientWidth),'No student list horizontal scroll '+width);
  await page.getByRole('button',{name:'แก้ไขคะแนน '+students[0].name,exact:true}).click();await page.locator('#view-grade').waitFor({state:'visible'});
  const bounds=await page.locator('.score-summary').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Grade summary fits '+width);
  await page.evaluate(()=>location.hash='overview');await page.locator('#view-overview').waitFor({state:'visible'});
  if(width<=1100){
    await page.evaluate(()=>scrollTo(0,180));const before=await page.evaluate(()=>scrollY);
    await page.locator('#menuToggle').click();await page.locator('#closeMobileMenu').waitFor({state:'visible'});
    assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.app-main').evaluate(node=>node.inert),true);assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
    await page.locator('#closeMobileMenu').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'logout');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'closeMobileMenu');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.app-main').evaluate(node=>node.inert),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'menuToggle');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1,'Scroll restored '+width);
    await page.locator('#menuToggle').click();await page.locator('#navOverlay').click({position:{x:width-12,y:250}});assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');
  }
}
await page.setViewportSize({width:834,height:1112});await page.evaluate(()=>location.hash='students');await page.locator('#view-students').waitFor({state:'visible'});
await page.locator('#roomFilter-trigger').click();await page.locator('#roomFilter-listbox').waitFor({state:'visible'});
const fonts=await page.evaluate(()=>['studentSearch','roomFilter-trigger','roomFilter-option-1'].map(id=>getComputedStyle(document.getElementById(id)).fontFamily));assert.equal(fonts[0],fonts[1]);assert.equal(fonts[1],fonts[2]);
const panel=await page.locator('#roomFilter-listbox').boundingBox();assert.ok(panel.x>=0&&panel.x+panel.width<=834&&panel.y>=0&&panel.y+panel.height<=1112,'Listbox stays in viewport');
await page.screenshot({path:path.join(artifacts,"responsive-tablet-list.png"),fullPage:true});
await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.locator('#roomFilter').inputValue(),'พิเศษ|SC11-203');assert.equal(await page.locator('#studentRows tr').count(),3);assert.match(await page.locator('#roomFilter-trigger').textContent(),/พิเศษ/);
await page.locator('#roomFilter-trigger').click();await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.equal(await page.locator('#studentRows tr').count(),6);
await page.locator('#roomFilter-trigger').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#roomFilter-trigger').getAttribute('aria-expanded'),'false');
await page.setViewportSize({width:1024,height:600});await page.locator('#menuToggle').click();await page.locator('#logout').scrollIntoViewIfNeeded();const signout=await page.locator('#logout').boundingBox();assert.ok(signout.y>=0&&signout.y+signout.height<=600,'Menu scrolls in landscape');await page.screenshot({path:path.join(artifacts,"responsive-tablet-menu.png"),fullPage:true});
await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('.app-main').evaluate(node=>node.inert),false);assert.equal(await page.evaluate(()=>document.body.style.position),'');
await page.evaluate(()=>location.hash='overview');await page.locator('#view-overview').waitFor({state:'visible'});if(!touchMode){await page.locator('.stat-card').first().hover();await page.waitForTimeout(300);assert.notEqual(await page.locator('.stat-card').first().evaluate(node=>getComputedStyle(node).transform),'none','Hover animates');}
else {
  assert.equal(await page.evaluate(()=>matchMedia('(hover: none)').matches),true,'Touch devices do not retain hover effects');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>location.hash='students');await page.locator('#view-students').waitFor({state:'visible'});
  await page.locator('#roomFilter-trigger').tap();await page.locator('#roomFilter-option-1').tap();assert.equal(await page.locator('#roomFilter').inputValue(),'ปกติ|SC11-103');
  assert.equal(await page.locator('#studentSearch').evaluate(node=>getComputedStyle(node).fontSize),'16px');
  await page.locator('#menuToggle').tap();await page.locator('#closeMobileMenu').tap();assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');
}
await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.stat-card').first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s','Reduced motion is respected');
await page.setViewportSize({width:390,height:844});await page.locator('#menuToggle').click();await page.screenshot({path:path.join(artifacts,"responsive-mobile-menu.png"),fullPage:true});await page.locator('#closeMobileMenu').click();
assert.deepEqual(errors,[]);console.log('PASS responsive UI: 13 widths, tablet/mobile hamburger, focus trap, Escape/overlay, scroll lock/restore, landscape menu, dropdown keyboard/font/viewport, reduced motion, hover and score bar');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
