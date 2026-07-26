/**
 * ระบบให้คะแนนหมวด 1: ข้อเสนอหัวข้อ (Proposal) — วิชาปัญหาพิเศษ
 * Google Apps Script + Google Sheets
 *
 * Flow การใช้งาน (เวอร์ชันนี้):
 *   1) กรรมการเลือกชื่อตัวเอง 1 ครั้งตอนเปิดเว็บ (ระบบจำไว้ในเบราว์เซอร์ ไม่ต้องเลือกซ้ำ)
 *   2) พิมพ์รหัสนิสิต -> ระบบดึงชื่อ / ห้องสอบ / แผนการเรียน / ที่ปรึกษา / หัวข้อ ให้อัตโนมัติ
 *   3) ให้คะแนน 5 เกณฑ์ -> กดบันทึก -> ฟอร์มเคลียร์ตัวเอง พร้อมรับนิสิตคนถัดไปทันที
 *
 * โครงสร้าง Sheet ที่ต้องมีในไฟล์ Google Sheet เดียวกัน:
 *   - Students   : รายชื่อนิสิตทั้งหมด + หัวข้อปัญหาพิเศษ
 *   - Committees : รายชื่อกรรมการประจำแต่ละห้อง/แผนการเรียน (คงที่ทั้งวัน)
 *   - Scores     : คะแนนดิบที่กรรมการแต่ละท่านกรอก (1 แถวต่อ 1 คน ต่อ 1 นิสิต)
 *   - Summary    : สรุปคะแนนเฉลี่ยต่อคน (คำนวณอัตโนมัติด้วยสูตร)
 *
 * Scores columns: A Timestamp, B รหัสนิสิต, C ชื่อนิสิต, D ห้องสอบ, E แผนการเรียน,
 *                  F ชื่อกรรมการ, G-K คะแนนดิบ 5 เกณฑ์, L คะแนนรวม (เต็ม 10)
 */

// น้ำหนักคะแนนแต่ละเกณฑ์ (รวม = 10)
const CRITERIA = [
  { key: 'c1', label: 'ความชัดเจนของปัญหาและวัตถุประสงค์', weight: 3 },
  { key: 'c2', label: 'ความเหมาะสมของขอบเขตงาน', weight: 3 },
  { key: 'c3', label: 'ความรู้พื้นฐาน/ทบทวนเทคโนโลยีที่เกี่ยวข้อง', weight: 2 },
  { key: 'c4', label: 'ความเป็นประโยชน์/กลุ่มผู้ใช้ที่ชัดเจน', weight: 1 },
  { key: 'c5', label: 'การนำเสนอและตอบข้อซักถาม', weight: 1 }
];

const SCALE_LABELS = {
  0: 'ไม่ผ่าน',
  1: 'ต้องปรับปรุง',
  2: 'พอใช้',
  3: 'ดี',
  4: 'ดีเยี่ยม'
};

// เข้าถึงหน้า dashboard ได้เฉพาะบัญชี Google นี้เท่านั้น (ตรวจสอบจริงฝั่ง server ด้วย verifyGoogleIdToken)
const DASHBOARD_ALLOWED_EMAIL = 'suriya.p@ku.th';
// ใช้ Client ID เดียวกันทั้ง index.html และ dashboard.html (OAuth 2.0 Client ID จาก Google Cloud Console)
const WEBAPP_GOOGLE_CLIENT_ID = '992775338655-41i4ftusliminfbr35i31cj20n7lpd12.apps.googleusercontent.com';

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  // --- โหมด API (เรียกจากหน้าเว็บภายนอก เช่น GitHub Pages ผ่าน fetch) ---
  if (action === 'getEvaluators') {
    return jsonOutput(getEvaluators());
  }
  if (action === 'getStudentById') {
    return jsonOutput(getStudentById(e.parameter.id));
  }
  if (action === 'getCriteria') {
    return jsonOutput({ criteria: CRITERIA, scaleLabels: SCALE_LABELS });
  }
  if (action === 'getMyEvaluatorInfo') {
    return jsonOutput(getMyEvaluatorInfo(e.parameter.idToken));
  }
  if (action === 'getDashboard') {
    const auth = verifyGoogleIdToken(e.parameter.idToken);
    if (!auth.ok) {
      return jsonOutput({ status: 'unauthorized', email: auth.email || null, reason: auth.reason || null });
    }
    return jsonOutput(getDashboardData());
  }

  // --- โหมดหน้าเว็บปกติ (เปิด URL ของ Apps Script ตรงๆ โดยไม่มี ?action) ---
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.criteria = CRITERIA;
  tpl.scaleLabels = SCALE_LABELS;
  return tpl.evaluate()
    .setTitle('ให้คะแนนข้อเสนอหัวข้อ - ปัญหาพิเศษ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * รับคำขอ POST จากหน้าเว็บภายนอก (เช่น GitHub Pages) เพื่อบันทึกคะแนน
 * ฝั่งหน้าเว็บต้องส่ง body เป็น JSON string ด้วย Content-Type: text/plain
 * (ห้ามตั้งเป็น application/json เพราะ Apps Script จะตอบ CORS preflight ไม่ได้)
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const result = submitScore(payload);
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ status: 'error', message: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ตรวจสอบ Google ID token (จาก Google Identity Services ฝั่งหน้าเว็บ) ผ่าน
 * Google tokeninfo endpoint — Google เป็นผู้ตรวจลายเซ็นและวันหมดอายุให้ฝั่งเรา
 * (ไม่ต้องเขียนโค้ด verify JWT เอง) ยืนยันแค่ว่า token ถูกต้องและออกให้แอปเรา
 * ไม่ได้เช็คว่าเป็นใครที่ "มีสิทธิ์" — ผู้เรียกต้องเช็คอีเมลที่ได้ต่อเอง
 * คืนค่า { ok: boolean, email: string|undefined, reason: string|undefined }
 */
function verifyGoogleIdTokenRaw(idToken) {
  if (!idToken) return { ok: false, reason: 'no_token' };
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      return { ok: false, reason: 'tokeninfo_http_' + res.getResponseCode() + ':' + res.getContentText() };
    }
    const info = JSON.parse(res.getContentText());

    if (info.aud !== WEBAPP_GOOGLE_CLIENT_ID) {
      return { ok: false, email: info.email, reason: 'aud_mismatch: got=' + info.aud + ' expected=' + WEBAPP_GOOGLE_CLIENT_ID };
    }
    if (info.email_verified !== 'true' && info.email_verified !== true) {
      return { ok: false, email: info.email, reason: 'email_not_verified' };
    }
    return { ok: true, email: info.email };
  } catch (err) {
    return { ok: false, reason: 'exception: ' + err.message };
  }
}

/** ตรวจสอบ token + จำกัดให้เฉพาะบัญชีที่ได้รับอนุญาตดู dashboard เท่านั้น */
function verifyGoogleIdToken(idToken) {
  const base = verifyGoogleIdTokenRaw(idToken);
  if (!base.ok) return base;
  if (String(base.email || '').toLowerCase() !== DASHBOARD_ALLOWED_EMAIL.toLowerCase()) {
    return { ok: false, email: base.email, reason: 'email_mismatch' };
  }
  return base;
}

/**
 * เรียกจากหน้าให้คะแนน: ตรวจสอบ token แล้วหาว่าอีเมลนี้ตรงกับกรรมการคนไหน
 * ในชีท Committees (คอลัมน์ D = อีเมล) — ชื่อกรรมการที่ได้มาจากตรงนี้เท่านั้น
 * ที่นำไปใช้บันทึกคะแนนได้ (submitScore ไม่เชื่อชื่อที่ส่งมาจาก client)
 */
function getMyEvaluatorInfo(idToken) {
  const auth = verifyGoogleIdTokenRaw(idToken);
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const match = findEvaluatorByEmail(auth.email);
  if (!match) {
    return { ok: false, reason: 'not_committee_member', email: auth.email };
  }
  return { ok: true, email: auth.email, name: match.name, assignments: match.assignments };
}

/** ค้นหากรรมการจากอีเมล (คอลัมน์ D ของชีท Committees) คืนชื่อ + (แผนการเรียน+ห้องสอบ) ทุกแถวที่ตรง */
function findEvaluatorByEmail(email) {
  const sheet = getSS().getSheetByName('Committees');
  const data = sheet.getDataRange().getValues();
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  let name = null;
  const assignments = [];
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][3] || '').trim().toLowerCase();
    if (rowEmail && rowEmail === target) {
      name = String(data[i][2]).trim();
      assignments.push({ term: data[i][0], room: data[i][1] });
    }
  }
  if (!name) return null;
  return { name: name, assignments: assignments };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** เรียกจากหน้าเว็บตอนโหลดหน้า: ดึงรายชื่อกรรมการทั้งหมด (ไม่ซ้ำ) พร้อม (แผนการเรียน+ห้องสอบ) ที่แต่ละท่านประจำอยู่ */
function getEvaluators() {
  const sheet = getSS().getSheetByName('Committees');
  const data = sheet.getDataRange().getValues();
  const map = {}; // name -> [{term, room}, ...]
  for (let i = 1; i < data.length; i++) {
    const term = data[i][0];
    const room = data[i][1];
    const name = data[i][2];
    if (!name) continue;
    const key = String(name).trim();
    if (!map[key]) map[key] = [];
    map[key].push({ term: term, room: room });
  }
  return Object.keys(map).sort().map(function (name) {
    return { name: name, assignments: map[name] };
  });
}

/** เรียกจากหน้าเว็บ: กรอกรหัสนิสิตแล้วดึงข้อมูลทั้งหมดของนิสิตคนนั้น */
function getStudentById(studentId) {
  const sheet = getSS().getSheetByName('Students');
  const data = sheet.getDataRange().getValues();
  const id = String(studentId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {
      return {
        id: String(data[i][0]),
        name: data[i][1],
        room: data[i][2],
        term: data[i][3],
        advisor: data[i][4],
        topic: data[i][5] || '(ยังไม่มีข้อมูลหัวข้อ)'
      };
    }
  }
  return null; // ไม่พบรหัสนี้
}

/**
 * เรียกจากหน้าเว็บ: บันทึกคะแนน (upsert — กรรมการท่านเดิมกรอกคะแนนนิสิตคนเดิมซ้ำ
 * จะเขียนทับแถวเดิมแทนการเพิ่มแถวใหม่)
 *
 * payload = {
 *   studentId, studentName, room, term, evaluatorName,
 *   scores: { c1: 0-4, c2: 0-4, c3: 0-4, c4: 0-4, c5: 0-4 }
 * }
 *
 * หมายเหตุ: เวอร์ชันนี้ "เชื่อ" ชื่อกรรมการที่ส่งมาจาก client ตรงๆ (ปิดระบบ
 * ยืนยันตัวตนกรรมการด้วย Google login ไว้ก่อนตามที่ขอ — ถ้าจะเปิดใหม่
 * ดูฟังก์ชัน getMyEvaluatorInfo / findEvaluatorByEmail ที่ยังเก็บไว้เผื่อใช้)
 */
function submitScore(payload) {
  const sheet = getSS().getSheetByName('Scores');
  const data = sheet.getDataRange().getValues();

  let total = 0;
  const rawValues = [];
  CRITERIA.forEach(function (c) {
    const raw = Number(payload.scores[c.key]);
    rawValues.push(raw);
    total += (raw / 4) * c.weight;
  });
  total = Math.round(total * 100) / 100;

  const newRow = [
    new Date(),
    payload.studentId,
    payload.studentName,
    payload.room,
    payload.term,
    payload.evaluatorName
  ].concat(rawValues).concat([total]);

  // หาแถวเดิมของกรรมการท่านนี้ + นิสิตคนนี้ (คอลัมน์ B=รหัสนิสิต, F=ชื่อกรรมการ)
  let existingRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(payload.studentId).trim() &&
        String(data[i][5]).trim() === String(payload.evaluatorName).trim()) {
      existingRow = i + 1;
      break;
    }
  }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
    return { status: 'updated', total: total };
  } else {
    sheet.appendRow(newRow);
    return { status: 'created', total: total };
  }
}

/**
 * เรียกจากหน้า dashboard: สรุปภาพรวมความคืบหน้าการให้คะแนนทั้งหมด
 * - stats: ตัวเลขสรุปรวม (ครบ/บางส่วน/ยังไม่ประเมิน/เฉลี่ยรวม)
 * - byRoom: เฉลี่ย + ความคืบหน้า แยกตามห้องสอบ/แผนการเรียน
 * - students: รายนิสิตทุกคนพร้อมจำนวนกรรมการที่ประเมินแล้วและคะแนนเฉลี่ย
 */
function getDashboardData() {
  const ss = getSS();
  const studentsData = ss.getSheetByName('Students').getDataRange().getValues();
  const scoresData = ss.getSheetByName('Scores').getDataRange().getValues();
  const committeesData = ss.getSheetByName('Committees').getDataRange().getValues();

  // จำนวนกรรมการที่ควรมีต่อ (แผนการเรียน+ห้องสอบ) หนึ่งชุด
  const expectedMap = {};
  for (let i = 1; i < committeesData.length; i++) {
    const term = committeesData[i][0], room = committeesData[i][1], name = committeesData[i][2];
    if (!name) continue;
    const key = term + '|' + room;
    expectedMap[key] = (expectedMap[key] || 0) + 1;
  }

  // รวมคะแนนรวม (คอลัมน์สุดท้าย) ของแต่ละนิสิต จากทุกแถวใน Scores
  const scoreMap = {};
  for (let i = 1; i < scoresData.length; i++) {
    const id = String(scoresData[i][1]).trim();
    if (!id) continue;
    const total = Number(scoresData[i][scoresData[i].length - 1]);
    if (!scoreMap[id]) scoreMap[id] = [];
    scoreMap[id].push(total);
  }

  // เฉลี่ยคะแนนดิบแต่ละเกณฑ์ (คอลัมน์ G-K) จากทุกแถวใน Scores — ใช้ทำกราฟสรุปรายเกณฑ์
  const CRITERIA_COL_OFFSET = 6; // A=0..F=5, G เริ่มที่ index 6
  const criteriaTotals = CRITERIA.map(function () { return { sum: 0, count: 0 }; });
  for (let i = 1; i < scoresData.length; i++) {
    if (!String(scoresData[i][1]).trim()) continue;
    CRITERIA.forEach(function (c, idx) {
      const raw = Number(scoresData[i][CRITERIA_COL_OFFSET + idx]);
      if (!isNaN(raw)) {
        criteriaTotals[idx].sum += raw;
        criteriaTotals[idx].count++;
      }
    });
  }
  const criteriaAverages = CRITERIA.map(function (c, idx) {
    const t = criteriaTotals[idx];
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      avg: t.count > 0 ? Math.round((t.sum / t.count) * 100) / 100 : null
    };
  });

  // กันรหัสนิสิตซ้ำในชีท Students (เช่น import ผิดพลาด) ไม่ให้นับซ้ำในสถิติ —
  // ใช้แถวแรกที่เจอ ส่วนรหัสที่ซ้ำจะถูกเก็บชื่อไว้ใน stats.duplicateStudentIds ให้ผู้ดูแลเห็น
  const students = [];
  const seenIds = {};
  const duplicateIds = [];
  for (let i = 1; i < studentsData.length; i++) {
    const id = String(studentsData[i][0]).trim();
    if (!id) continue;
    if (seenIds[id]) {
      if (duplicateIds.indexOf(id) === -1) duplicateIds.push(id);
      continue;
    }
    seenIds[id] = true;

    const room = studentsData[i][2];
    const term = studentsData[i][3];
    const totals = scoreMap[id] || [];
    const count = totals.length;
    const avg = count > 0
      ? Math.round((totals.reduce(function (a, b) { return a + b; }, 0) / count) * 100) / 100
      : null;
    students.push({
      id: id,
      name: studentsData[i][1],
      room: room,
      term: term,
      advisor: studentsData[i][4],
      topic: studentsData[i][5],
      count: count,
      expected: expectedMap[term + '|' + room] || 0,
      avg: avg
    });
  }

  const groupMap = {};
  students.forEach(function (s) {
    const key = s.term + '|' + s.room;
    if (!groupMap[key]) groupMap[key] = { term: s.term, room: s.room, studentCount: 0, fullyEvaluated: 0, totals: [] };
    const g = groupMap[key];
    g.studentCount++;
    if (s.expected > 0 && s.count >= s.expected) g.fullyEvaluated++;
    if (s.avg !== null) g.totals.push(s.avg);
  });
  const avgOf = function (arr) {
    return arr.length > 0 ? Math.round((arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) * 100) / 100 : null;
  };
  const byRoom = Object.keys(groupMap).sort().map(function (key) {
    const g = groupMap[key];
    return { term: g.term, room: g.room, studentCount: g.studentCount, fullyEvaluated: g.fullyEvaluated, avg: avgOf(g.totals) };
  });

  let evaluatedFull = 0, evaluatedPartial = 0, notEvaluated = 0;
  const allAverages = [];
  students.forEach(function (s) {
    if (s.count === 0) notEvaluated++;
    else if (s.expected > 0 && s.count >= s.expected) evaluatedFull++;
    else evaluatedPartial++;
    if (s.avg !== null) allAverages.push(s.avg);
  });

  const byEvaluator = getEvaluatorProgress(committeesData, scoresData, students);

  return {
    stats: {
      totalStudents: students.length,
      evaluatedFull: evaluatedFull,
      evaluatedPartial: evaluatedPartial,
      notEvaluated: notEvaluated,
      overallAverage: avgOf(allAverages),
      duplicateStudentIds: duplicateIds
    },
    byRoom: byRoom,
    byEvaluator: byEvaluator,
    criteriaAverages: criteriaAverages,
    students: students
  };
}

/**
 * สรุปความคืบหน้าของกรรมการแต่ละท่าน: ให้คะแนนไปแล้วกี่คน จาก "ที่ควรให้" กี่คน
 * (นับจากจำนวนนิสิตจริงในห้อง/แผนการเรียนที่กรรมการท่านนั้นประจำอยู่ ตามชีท Committees)
 */
function getEvaluatorProgress(committeesData, scoresData, students) {
  const studentCountByRoom = {};
  students.forEach(function (s) {
    const key = s.term + '|' + s.room;
    studentCountByRoom[key] = (studentCountByRoom[key] || 0) + 1;
  });

  const evaluatorMap = {}; // name -> { assignments: [...], expected: n }
  for (let i = 1; i < committeesData.length; i++) {
    const term = committeesData[i][0], room = committeesData[i][1], name = committeesData[i][2];
    if (!name) continue;
    const key = String(name).trim();
    if (!evaluatorMap[key]) evaluatorMap[key] = { assignments: [], expected: 0 };
    evaluatorMap[key].assignments.push({ term: term, room: room });
    evaluatorMap[key].expected += studentCountByRoom[term + '|' + room] || 0;
  }

  // นับจำนวนนิสิต "ไม่ซ้ำ" ที่กรรมการแต่ละท่านให้คะแนนแล้ว (คอลัมน์ F=ชื่อกรรมการ, B=รหัสนิสิต)
  const doneByEvaluator = {};
  for (let i = 1; i < scoresData.length; i++) {
    const evalName = String(scoresData[i][5] || '').trim();
    const sid = String(scoresData[i][1] || '').trim();
    if (!evalName || !sid) continue;
    if (!doneByEvaluator[evalName]) doneByEvaluator[evalName] = {};
    doneByEvaluator[evalName][sid] = true;
  }

  return Object.keys(evaluatorMap).sort().map(function (name) {
    const info = evaluatorMap[name];
    const doneSet = doneByEvaluator[name] || {};
    return {
      name: name,
      assignments: info.assignments,
      expected: info.expected,
      done: Object.keys(doneSet).length
    };
  });
}

/**
 * เรียกครั้งแรกเท่านั้น (รันจาก Apps Script editor ไม่ใช่จากเว็บ):
 * สร้างชีท Students / Committees / Scores / Summary พร้อมหัวตาราง
 */
function setupSheets() {
  const ss = getSS();

  let students = ss.getSheetByName('Students');
  if (!students) students = ss.insertSheet('Students');
  students.clear();
  students.getRange(1, 1, 1, 6).setValues([
    ['รหัสนิสิต', 'ชื่อ-สกุล', 'ห้องสอบ', 'แผนการเรียน', 'อาจารย์ที่ปรึกษา', 'หัวข้อปัญหาพิเศษ']
  ]);
  students.setFrozenRows(1);

  let committees = ss.getSheetByName('Committees');
  if (!committees) committees = ss.insertSheet('Committees');
  committees.clear();
  // หมายเหตุ: คอลัมน์ D "อีเมล" ถูกเพิ่มด้วยมือทีหลัง (ไม่ได้อยู่ใน setup เดิม) —
  // ใช้ผูกตัวตนกรรมการกับ Google account ตอน sign-in ใน findEvaluatorByEmail()
  committees.getRange(1, 1, 1, 4).setValues([
    ['แผนการเรียน', 'ห้องสอบ', 'ชื่อกรรมการ', 'อีเมล']
  ]);
  committees.setFrozenRows(1);

  let scores = ss.getSheetByName('Scores');
  if (!scores) scores = ss.insertSheet('Scores');
  scores.clear();
  const header = ['Timestamp', 'รหัสนิสิต', 'ชื่อนิสิต', 'ห้องสอบ', 'แผนการเรียน', 'ชื่อกรรมการผู้ประเมิน'];
  CRITERIA.forEach(function (c) { header.push(c.label + ' (0-4)'); });
  header.push('คะแนนรวม (เต็ม 10)');
  scores.getRange(1, 1, 1, header.length).setValues([header]);
  scores.setFrozenRows(1);

  let summary = ss.getSheetByName('Summary');
  if (!summary) summary = ss.insertSheet('Summary');
  summary.clear();
  summary.getRange(1, 1, 1, 4).setValues([
    ['รหัสนิสิต', 'ชื่อนิสิต', 'จำนวนกรรมการที่ประเมินแล้ว', 'คะแนนเฉลี่ย (เต็ม 10)']
  ]);
  summary.setFrozenRows(1);

  SpreadsheetApp.getUi().alert(
    'สร้างชีทเรียบร้อยแล้ว: Students, Committees, Scores, Summary\n' +
    'ขั้นต่อไป: รันฟังก์ชัน initializeStudents แล้วตามด้วย initializeCommittees'
  );
}

/**
 * นำเข้ารายชื่อนิสิตทั้งหมด พร้อมหัวข้อปัญหาพิเศษ
 * รันฟังก์ชันนี้ครั้งเดียวจาก Apps Script editor หลังจาก setupSheets
 * (แก้ไขหัวข้อที่ยังไม่ครบ/ผิดได้ตรงๆ ในชีท Students ภายหลัง ไม่ต้องรันซ้ำ)
 */
function initializeStudents() {
  const rows = [
    // รหัสนิสิต, ชื่อ-สกุล, ห้องสอบ, แผนการเรียน, อาจารย์ที่ปรึกษา, หัวข้อปัญหาพิเศษ
    ['6621600771', 'นายคุณาวุฒิ ดอกบัว', 'SC11-103', 'ปกติ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบการบริหารจัดการร้านกาแฟ'],
    ['6621601221', 'นายศกรณ์ คัจฉพันธุ์', 'SC11-103', 'ปกติ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบวิเคราะห์ศักยภาพและความก้าวหน้าทางการศึกษา'],
    ['6621604891', 'นายศิวกร ภูภักดี', 'SC11-103', 'ปกติ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบจัดการร้านจำหน่ายเหล็ก'],
    ['6621600801', 'นายชัยวัฒน์ คดบุญ', 'SC11-103', 'ปกติ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบยืมคืนอุปกรณ์ IOT'],
    ['6621600836', 'นายณธนกร ชัยญาติ', 'SC11-103', 'ปกติ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบจัดการร้านอาหาร'],
    ['6621600968', 'นางสาวนวลจันทร์ เกตุศรี', 'SC11-103', 'ปกติ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบจัดการร้านอะไหล่และงานซ่อมรถจักรยานยนต์'],
    ['6621601042', 'นายปิยะพงษ์ ขาวประไพ', 'SC11-103', 'ปกติ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบจัดการการผลิตและขายเครื่องดื่ม'],
    ['6621601107', 'นางสาวพัชลดา นวลแสง', 'SC11-103', 'ปกติ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบบริหารจัดการหอพักสำหรับผู้เช่าและผู้ดูแล'],
    ['6621604866', 'นางสาวมณธิรา แนวนาค', 'SC11-103', 'ปกติ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบแพลตฟอร์มเว็บนิยายออนไลน์พร้อมระบบสนับสนุนนักเขียน'],
    ['6621604874', 'นางสาวมธุรดา มีปาน', 'SC11-103', 'ปกติ', 'อาจารย์ดร.สุริยะ พินิจการ', 'แอปพลิเคชั่นแนะนำข้อมูลพยากรณ์โชคชะตา โดยใช้ Retrieval-Augmented Generation AI'],
    ['6621600861', 'นายทัตพงศ์ ทองยวง', 'SC11-103', 'ปกติ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบวิเคราะห์พฤติกรรมการบริโภคอาหาร'],
    ['6621604807', 'นางสาวณัชชา รุนศรี', 'SC11-103', 'ปกติ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบแนะนำเมนูอาหารเพื่อช่วยในการตัดสินใจ'],

    ['6621601263', 'นายอธิวัฒน์ อภิวัฒน์ภูวสิน', 'SC11-203', 'ปกติ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบแจ้งของหายภายในมหาวิทยาลัยเกษตรศาสตร์'],
    ['6621601018', 'นายปฏิภาณ อาจเพล', 'SC11-203', 'ปกติ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบบริหารจัดการพนักงานร้านล้างรถ (คู่กับ นายอนาวิล ย้อยแย้ม)'],
    ['6621601271', 'นายอนาวิล ย้อยแย้ม', 'SC11-203', 'ปกติ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบบริหารจัดการพนักงานร้านล้างรถ'],
    ['6621604831', 'นางสาวนุสนีย์ มะแอเคียน', 'SC11-203', 'ปกติ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบจัดการข้อมูลภาษีและการออกใบกำกับภาษีอิเล็กทรอนิกส์สำหรับผู้ผลิตเนื้อหาดิจิทัล เอเจนซี่ และองค์กรธุรกิจ (คู่กับนางสาววลัยลักษณ์ ศรีสวัสดิ์)'],
    ['6621604882', 'นางสาววลัยลักษณ์ ศรีสวัสดิ์', 'SC11-203', 'ปกติ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบจัดการข้อมูลภาษีและการออกใบกำกับภาษีอิเล็กทรอนิกส์สำหรับผู้ผลิตเนื้อหาดิจิทัล เอเจนซี่และองค์กรธุรกิจ'],
    ['6621600950', 'นายนวพร สุขสวัสดิ์', 'SC11-203', 'ปกติ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบเรียกวินมอเตอร์ไซค์มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621601085', 'นางสาวพรนัชชา แก้วชมเชย', 'SC11-203', 'ปกติ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบเรียกวินมอเตอร์ไซค์มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621601247', 'นางสาวสุพิตตา ชัยงาม', 'SC11-203', 'ปกติ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบจัดการสถานพยาบาล มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621604858', 'นางสาวภัทรลดา ดารา', 'SC11-203', 'ปกติ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบจัดการสถานพยาบาล มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],

    ['6521655477', 'นายกฤตานนท์ สาสนะ', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบวางแผนอาหารและโภชนาการตามงบประมาณ'],
    ['6621650493', 'นางสาวกานต์ทิตา อมรเทพ', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบบริหารจัดการโรงงานผลิตน้ำดื่มสำหรับโรงเรียน'],
    ['6621650507', 'นางสาวจารุชา ทองร้อยยศ', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบบริหารจัดการร้านขายของชำ ร้านเป็นธุรกิจที่บ้าน'],
    ['6621650621', 'นายภัทรดนัย บัวทองสดใส', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบการเช่ายืมจักรยานไฟฟ้าในมหาวิทยาลัย ด้วย Mobile Application'],
    ['6621653751', 'นายณันธภัทร์ ลิ่มเจริญ', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบประเมินและคำนวณราคาต้นทุนงานก่อสร้างและ Web Application ลูกค้า'],
    ['6621655215', 'นายณชล นุชนิยม', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบจัดการทรัพยากรภายในครัวเรือนอัจฉริยะ'],
    ['6621655282', 'นางสาวปนัดดา ชมภูวงศ์', 'SC11-103', 'พิเศษ', 'อาจารย์กนิษฐา ตั้งไทยขวัญ', 'ระบบบริหารจัดการงานซ่อมและคลังสินค้าอุปกรณ์นำทางทางเรือ'],
    ['6621650574', 'นายปรัชญ์ โกศลดำรงทรัพย์', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบบริหารงานโต๊ะจีน "ตั้งใจธรรม"'],
    ['6621650591', 'นายปิยพัทธ์ นัสฐาน', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบติดตามและบันทึกข้อมูลสวนผลไม้สำหรับเกษตรกร'],
    ['6621653743', 'นายณัฐภัทร สุวรรณยุหะ', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบบริหารความปลอดภัย AEROTHAI Safety Performance Dashboard เพื่อสนับสนุนการตัดสินใจผู้บริหารฝ่ายวิศวกรรมจราจรทางอากาศ'],
    ['6621653786', 'นายนพรัตน์ ดิษฐทรัพย์', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบจัดการซ่อมและติดตามสถานะรถเกี่ยวข้าว'],
    ['6621653841', 'นายวิชยุตม์ คชอินทร์', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบจัดการการจ้างงานรถแทรกเตอร์เพื่องานเกษตร'],
    ['6621653859', 'นายวีรภัทร์ บุญแตง', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์', 'ระบบบริการอู่ซ่อมรถ "อู่ช่างโอ"'],
    ['6621650582', 'นายป้องเกียรติ หันกลาง', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบการจองที่พัก baanrai pakchong'],
    ['6621653778', 'นายธนาธร ขวัญมั่นคง', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบแจ้งซ่อมรถยนต์ให้กับลูกค้า คำนวณการใช้วัสดุ-อะไหล่ และหน้าข้อมูล Dashboard ผ่านบน Website'],
    ['6621655231', 'นายณัฐภัทร ยืนยง', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบพัฒนา Admin เว็บไซต์บริษัท อยู่เย็นเป็นสุข วิศวกรรม จำกัด'],
    ['6621655304', 'นายพสธร วิภาหัสน์', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบแจ้งซ่อมรถยนต์ให้กับลูกค้า คำนวณการใช้วัสดุ-อะไหล่ และหน้าข้อมูล Dashboard ผ่านบน Website'],
    ['6621655321', 'นายภาณุพงศ์ อินทะแสน', 'SC11-103', 'พิเศษ', 'อาจารย์ดร.สุริยะ พินิจการ', 'ระบบพัฒนาเว็บไซต์บริษัท อยู่เย็นเป็นสุข วิศวกรรม จำกัด'],

    ['6621650604', 'นายพงศ์พัทธ์ ดวงจิตต์', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบค้นหาตำแหน่งและแนะนำเส้นทางอาคารศูนย์เรียนรวม และอาคาร 80 ปี มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621650671', 'นายอริญชัย สุวรรณเกิด', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบแอปพลิเคชั่นสำหรับผู้สูงอายุในการป้องกันการหลอกลวงทางโทรศัพท์'],
    ['6621650680', 'นายเอกณัฐ แช่มละออ', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบบริหารจัดการร้านเคมีเกษตรและวิเคราะห์โรคพืช'],
    ['6621653735', 'นางสาวณัฐชานันท์ นุ่มสารพัดนึก', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบประชาสัมพันธ์และลงทะเบียนกิจกรรมมหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621653808', 'นางสาวปรียนันท์ เนื่องชุมพร', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', '(ออกแบบฝั่ง UX/UI) ระบบบริหารความปลอดภัย AEROTHAI Safety Performance Dashboard เพื่อสนับสนุนการตัดสินใจผู้บริหารฝ่ายวิศวกรรมจราจรทางอากาศ'],
    ['6621653875', 'นางสาวแสงรัส จองดี', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน', 'ระบบค้นหาตำแหน่งและแนะนำเส้นทางอาคารศูนย์เรียนรวม และอาคาร 80 ปี มหาวิทยาลัยเกษตรศาสตร์วิทยาเขตกำแพงแสน'],
    ['6621650515', 'นางสาวญาดา ทับเทศ', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบบริหารจัดการสุขภาพส่วนบุคคล'],
    ['6621650647', 'นายรพีภัทร หงษ์วิชุลดา', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบยืมคืนหนังสือออนไลน์ร้านหนังสือ'],
    ['6621653824', 'นายมนัสวิน ไชยพยอม', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบบริหารจัดการการจองโต๊ะร้านอาหารออนไลน์'],
    ['6621653832', 'นายวัชพล ชิวค้ำ', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบจัดการคลังขนส่งมะพร้าว'],
    ['6621653883', 'นายอัครพล ไวเหาะ', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบยืมคืนอุปกรณ์ IOT'],
    ['6621655312', 'นายณัฏฐวัฒน์ โชตินันทณพร', 'SC11-203', 'พิเศษ', 'อาจารย์ดร.โรจนี ขุมมงคล', 'ระบบจัดหางาน Part-time']
  ];

  const sheet = getSS().getSheetByName('Students');
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);

  buildSummaryFormulas();
  SpreadsheetApp.getUi().alert('นำเข้ารายชื่อนิสิต ' + rows.length + ' คน เรียบร้อยแล้ว');
}

/**
 * นำเข้ารายชื่อกรรมการประจำห้อง/แผนการเรียน (คงที่ทั้งวัน)
 * รันฟังก์ชันนี้ครั้งเดียวหลัง initializeStudents
 * แก้ไข/เพิ่มรายชื่อได้ตรงๆ ในชีท Committees ภายหลัง ไม่ต้องรันซ้ำ
 */
function initializeCommittees() {
  const rows = [
    // แผนการเรียน, ห้องสอบ, ชื่อกรรมการ
    ['ปกติ', 'SC11-103', 'อาจารย์กนิษฐา ตั้งไทยขวัญ'],
    ['ปกติ', 'SC11-103', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์'],
    ['ปกติ', 'SC11-103', 'อาจารย์ดร.สุริยะ พินิจการ'],

    ['ปกติ', 'SC11-203', 'อาจารย์ดร.โรจนี ขุมมงคล'],
    ['ปกติ', 'SC11-203', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน'],
    ['ปกติ', 'SC11-203', 'อาจารย์กรานตวัน ชิวปรีชา'],

    ['พิเศษ', 'SC11-103', 'อาจารย์กนิษฐา ตั้งไทยขวัญ'],
    ['พิเศษ', 'SC11-103', 'อาจารย์ดร.ปัญญาพร ปรางจโรจน์'],
    ['พิเศษ', 'SC11-103', 'อาจารย์ดร.สุริยะ พินิจการ'],

    ['พิเศษ', 'SC11-203', 'อาจารย์ดร.ธีรานันต์ ธนาวัฒน์ภูวพัน'],
    ['พิเศษ', 'SC11-203', 'อาจารย์ดร.โรจนี ขุมมงคล'],
    ['พิเศษ', 'SC11-203', 'อาจารย์กรานตวัน ชิวปรีชา']
  ];

  const sheet = getSS().getSheetByName('Committees');
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  SpreadsheetApp.getUi().alert('นำเข้ารายชื่อกรรมการ ' + rows.length + ' แถว เรียบร้อยแล้ว');
}

/** สร้างสูตรในชีท Summary ให้ดึงรายชื่อนิสิตทั้งหมดมาพร้อมสูตรเฉลี่ยอัตโนมัติ */
function buildSummaryFormulas() {
  const studentsSheet = getSS().getSheetByName('Students');
  const summarySheet = getSS().getSheetByName('Summary');
  const lastRow = studentsSheet.getLastRow();
  if (lastRow < 2) return;

  const n = lastRow - 1;
  for (let i = 0; i < n; i++) {
    const r = i + 2;
    summarySheet.getRange(r, 1).setFormula('=Students!A' + (i + 2));
    summarySheet.getRange(r, 2).setFormula('=Students!B' + (i + 2));
    summarySheet.getRange(r, 3).setFormula('=COUNTIF(Scores!B:B,A' + r + ')');
    summarySheet.getRange(r, 4).setFormula(
      '=IF(C' + r + '=0,"-",AVERAGEIF(Scores!B:B,A' + r + ',Scores!L:L))'
    );
  }
}
