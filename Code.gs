/**
 * ระบบให้คะแนนหมวด 1: ข้อเสนอหัวข้อ (Proposal) — วิชาปัญหาพิเศษ
 * Google Apps Script + Google Sheets
 *
 * Flow การใช้งาน (เวอร์ชันนี้):
 *   1) กรรมการเข้าสู่ระบบด้วย Google account ที่มีอีเมลใน Committees
 *   2) พิมพ์รหัสนิสิต -> ระบบดึงชื่อ / ห้องสอบ / แผนการเรียน / ที่ปรึกษา / หัวข้อ ให้อัตโนมัติ
 *   3) ให้คะแนน 5 เกณฑ์ -> กดบันทึก -> ฟอร์มเคลียร์ตัวเอง พร้อมรับนิสิตคนถัดไปทันที
 *
 * โครงสร้าง Sheet ที่ต้องมีในไฟล์ Google Sheet เดียวกัน:
 *   - Students   : รายชื่อนิสิตทั้งหมด + หัวข้อปัญหาพิเศษ
 *   - Committees : รายชื่อกรรมการประจำแต่ละห้อง/แผนการเรียน (คงที่ทั้งวัน)
 *   - Scores     : คะแนนดิบที่กรรมการแต่ละท่านกรอก (1 แถวต่อ 1 คน ต่อ 1 นิสิต)
 *   - Summary    : สรุปคะแนนหัวข้อเดิม
 *   - DefenseScores / DefenseSummary : คะแนนสอบวิพากษ์และสรุปเฉลี่ย (แยกจากคะแนนเดิม)
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

// หมวดที่เปิดใช้งานแยกชีท เพื่อรักษาคะแนนหัวข้อเดิม
const DEFENSE_CRITERIA = [
  { key: 'c1', label: 'ระบบสารสนเทศและการแก้ปัญหา', weight: 6, mapping: 'CLO1 → PLO1', evidence: 'สาธิตฟังก์ชันหลัก ผลลัพธ์ถูกต้อง และแก้ปัญหาของโครงงานได้', levels: ['ไม่มีหลักฐานว่าระบบทำงานหรือแก้ปัญหาได้', 'ฟังก์ชันหลักผิดพลาดมาก สาธิตได้จำกัด', 'ระบบทำงานและแก้ปัญหาได้บางส่วน', 'ฟังก์ชันหลักทำงานได้ มีข้อบกพร่องเล็กน้อย', 'ฟังก์ชันหลักครบ ผลลัพธ์ถูกต้อง แก้ปัญหาได้ชัดเจน'] },
  { key: 'c2', label: 'เทคโนโลยี ฐานข้อมูล และโครงสร้างโปรแกรม', weight: 3, mapping: 'CLO2 → PLO2', evidence: 'เหตุผลเลือกเทคโนโลยี การจัดเก็บข้อมูล และโครงสร้างโปรแกรม', levels: ['อธิบายเทคโนโลยีและการออกแบบไม่ได้', 'อธิบายได้จำกัด มีข้อบกพร่องสำคัญ', 'มีเหตุผลบางส่วน การออกแบบยังมีจุดอ่อน', 'เลือกใช้เหมาะสม อธิบายการออกแบบได้เป็นส่วนใหญ่', 'เปรียบเทียบทางเลือกได้ ออกแบบข้อมูลและโปรแกรมเป็นระบบเหมาะกับงาน'] },
  { key: 'c3', label: 'ความต้องการ การบูรณาการ และความปลอดภัย', weight: 5, mapping: 'CLO3 → PLO3', evidence: 'เชื่อมความต้องการผู้ใช้กับผลงาน ผลทดสอบ และการปกป้องข้อมูล', levels: ['ไม่มีหลักฐานด้านความต้องการ การทดสอบ และความปลอดภัย', 'ขาดความต้องการสำคัญ หลักฐานทดสอบหรือปกป้องข้อมูลน้อย', 'ตรงความต้องการบางส่วน การทดสอบหรือความปลอดภัยยังไม่ครบ', 'ตรงความต้องการหลัก มีผลทดสอบและมาตรการความปลอดภัย ขาดเล็กน้อย', 'ตรงความต้องการหลัก ทดสอบครอบคลุม มีหลักฐานมาตรการความปลอดภัยเหมาะสม'] },
  { key: 'c4', label: 'ความรับผิดชอบและความซื่อสัตย์', weight: 2, mapping: 'CLO4 → PLO6', evidence: 'บทบาทรายบุคคล หลักฐานการลงมือทำ และการรายงานข้อจำกัดตามจริง (หลักฐานในบริบทโครงงาน)', levels: ['ไม่มีหลักฐานหรืออธิบายงานที่รับผิดชอบไม่ได้', 'บทบาทไม่ชัด อธิบายงานได้จำกัด หลักฐานน้อย', 'ระบุบทบาทได้ แต่หลักฐานหรือผลงานยังไม่ครบ', 'อธิบายบทบาทและงานได้ มีหลักฐานเป็นส่วนใหญ่', 'บทบาทชัด มีหลักฐานสอดคล้องกับงาน เปิดเผยข้อจำกัดตามจริง'] },
  { key: 'c5', label: 'การสื่อสาร การทำงานร่วมกัน และจริยธรรม IT/AI', weight: 4, mapping: 'CLO5 → PLO4, PLO5', evidence: 'นำเสนอ ตอบคำถาม ประสานงาน อ้างอิง และเปิดเผย/ตรวจสอบการใช้ AI โดยไม่หักคะแนนเพียงเพราะใช้ AI', levels: ['ไม่มีหลักฐานเพียงพอสำหรับประเมิน', 'สื่อสารไม่ชัด ตอบได้น้อย ขาดประเด็นการทำงานร่วมกันหรือจริยธรรม', 'สื่อสารและอธิบายการทำงานร่วมกันกับจริยธรรมได้บางส่วน', 'สื่อสารดี มีหลักฐานทำงานร่วมกันและคำนึงถึงจริยธรรม ขาดเล็กน้อย', 'นำเสนอเป็นลำดับ ตอบมีเหตุผล ประสานงาน อ้างอิงและใช้ IT/AI อย่างรับผิดชอบครบถ้วน'] }
];
const DEFENSE_RUBRIC_VERSION = 'defense-v2-15';
const DEFENSE_QUESTIONS = {
  "c1": [
    {
      "key": "c1_q1",
      "label": "ความครบถ้วนของฟังก์ชันหลัก",
      "weight": 2,
      "evidence": "สาธิตกระบวนการทำงานหลักตั้งแต่เริ่มจนได้ผลลัพธ์",
      "prompt": "ขอให้สาธิตฟังก์ชันหลักตามวัตถุประสงค์ของโครงงาน",
      "levels": [
        "ไม่สามารถสาธิตฟังก์ชันหลักได้",
        "สาธิตได้เพียงเล็กน้อย ฟังก์ชันหลักส่วนใหญ่ยังไม่ทำงาน",
        "ฟังก์ชันหลักทำงานได้บางส่วน ยังมีส่วนสำคัญไม่ครบ",
        "ฟังก์ชันหลักทำงานได้เกือบครบ มีข้อบกพร่องเล็กน้อย",
        "ฟังก์ชันหลักครบและทำงานต่อเนื่องได้จริง"
      ]
    },
    {
      "key": "c1_q2",
      "label": "ความถูกต้องของข้อมูลและผลลัพธ์",
      "weight": 2,
      "evidence": "ใช้กรณีตัวอย่างตรวจข้อมูลเข้า การประมวลผล และผลลัพธ์",
      "prompt": "เมื่อเปลี่ยนข้อมูลนำเข้า ผลลัพธ์ถูกต้องอย่างไร และตรวจสอบด้วยวิธีใด",
      "levels": [
        "ไม่มีหลักฐานยืนยันความถูกต้องของผลลัพธ์",
        "ผลลัพธ์ผิดพลาดบ่อย และอธิบายวิธีตรวจสอบไม่ได้",
        "กรณีทั่วไปให้ผลถูกต้องบางส่วน แต่ยังพบข้อผิดพลาดสำคัญ",
        "กรณีหลักให้ผลถูกต้อง มีหลักฐานตรวจสอบ ขาดกรณีย่อยเล็กน้อย",
        "ผลลัพธ์ถูกต้องตามกฎของงาน มีหลักฐานทดสอบทั้งกรณีปกติและกรณีขอบเขต"
      ]
    },
    {
      "key": "c1_q3",
      "label": "การแก้ปัญหาได้ตรงบริบทของโครงงาน",
      "weight": 2,
      "evidence": "เปรียบเทียบปัญหาเดิมกับประโยชน์ที่ระบบทำได้จริง",
      "prompt": "ระบบช่วยแก้ปัญหาเดิมของใคร และมีหลักฐานใดแสดงว่าแก้ได้",
      "levels": [
        "ไม่สามารถเชื่อมโยงระบบกับปัญหาที่กำหนดได้",
        "อธิบายปัญหาได้ แต่ผลงานยังไม่ช่วยแก้ปัญหาหลัก",
        "แก้ปัญหาได้บางส่วน หลักฐานประโยชน์ยังจำกัด",
        "แก้ปัญหาหลักได้เหมาะกับบริบท มีตัวอย่างสนับสนุน",
        "แก้ปัญหาหลักได้ชัดเจน พร้อมหลักฐานเปรียบเทียบหรือผลใช้งานที่ตรวจสอบได้"
      ]
    }
  ],
  "c2": [
    {
      "key": "c2_q1",
      "label": "เหตุผลในการเลือกเทคโนโลยี",
      "weight": 1,
      "evidence": "พิจารณาความเหมาะสม ข้อจำกัด และทางเลือกอื่น",
      "prompt": "เหตุใดจึงเลือกเทคโนโลยีนี้ และต่างจากทางเลือกอื่นอย่างไร",
      "levels": [
        "ไม่สามารถอธิบายเทคโนโลยีที่ใช้ได้",
        "ระบุเครื่องมือได้ แต่ให้เหตุผลเชื่อมโยงกับงานไม่ได้",
        "อธิบายความเหมาะสมได้บางส่วน ยังไม่เห็นข้อจำกัด",
        "ให้เหตุผลสอดคล้องกับงานและอธิบายข้อจำกัดสำคัญได้",
        "เปรียบเทียบทางเลือกและข้อแลกเปลี่ยนได้ชัด เลือกเหมาะกับบริบทและทรัพยากร"
      ]
    },
    {
      "key": "c2_q2",
      "label": "การออกแบบฐานข้อมูลและการจัดเก็บข้อมูล",
      "weight": 1,
      "evidence": "ดูโครงสร้างข้อมูล ความสัมพันธ์ ความซ้ำซ้อน และรูปแบบการใช้งาน",
      "prompt": "ข้อมูลหลักสัมพันธ์กันอย่างไร และออกแบบการจัดเก็บให้เหมาะกับการใช้งานอย่างไร",
      "levels": [
        "อธิบายโครงสร้างและวิธีจัดเก็บข้อมูลไม่ได้",
        "โครงสร้างข้อมูลมีข้อบกพร่องสำคัญ ไม่สอดคล้องกับการใช้งาน",
        "จัดเก็บและใช้งานได้ แต่ความสัมพันธ์หรือความซ้ำซ้อนยังมีปัญหา",
        "โครงสร้างเหมาะกับงาน อธิบายความสัมพันธ์และการเข้าถึงข้อมูลได้",
        "ออกแบบข้อมูลเป็นระบบ เหมาะกับชนิดข้อมูลและการใช้งาน พร้อมเหตุผลและตัวอย่างตรวจสอบได้"
      ]
    },
    {
      "key": "c2_q3",
      "label": "โครงสร้างโปรแกรมและการบำรุงรักษา",
      "weight": 1,
      "evidence": "ดูการแบ่งส่วนงาน ความชัดเจนของโค้ด และการจัดการข้อผิดพลาด",
      "prompt": "หากต้องเพิ่มหรือแก้ฟังก์ชันหนึ่ง จะต้องแก้ส่วนใดและกระทบส่วนอื่นอย่างไร",
      "levels": [
        "ไม่สามารถอธิบายโครงสร้างโปรแกรมได้",
        "โค้ดเชื่อมโยงกันสับสน อธิบายเส้นทางการทำงานได้น้อย",
        "แบ่งส่วนงานได้บางส่วน แต่ยังแก้ไขหรือดูแลได้ยาก",
        "โครงสร้างชัดพอเหมาะ แบ่งหน้าที่และอธิบายจุดแก้ไขได้",
        "โครงสร้างเป็นระบบ ลดความซ้ำซ้อน อธิบายและสาธิตการแก้ไขหรือจัดการข้อผิดพลาดได้"
      ]
    }
  ],
  "c3": [
    {
      "key": "c3_q1",
      "label": "ความสอดคล้องกับความต้องการผู้ใช้",
      "weight": 2,
      "evidence": "เชื่อมความต้องการที่ระบุไว้กับฟังก์ชันและผลทดสอบ",
      "prompt": "ยกตัวอย่างความต้องการสำคัญของผู้ใช้ แล้วชี้ว่าระบบตอบสนองตรงส่วนใด",
      "levels": [
        "ไม่มีหลักฐานเชื่อมโยงผลงานกับความต้องการผู้ใช้",
        "ระบุความต้องการได้ แต่ผลงานไม่ตอบโจทย์สำคัญ",
        "ตอบความต้องการได้บางส่วน หลักฐานการตรวจรับยังจำกัด",
        "ตอบความต้องการหลักได้ มีผลตรวจสอบสนับสนุนเป็นส่วนใหญ่",
        "เชื่อมความต้องการหลักกับฟังก์ชันและหลักฐานตรวจรับได้ครบและชัดเจน"
      ]
    },
    {
      "key": "c3_q2",
      "label": "การบูรณาการความรู้และการทดสอบระบบ",
      "weight": 2,
      "evidence": "อธิบายการเชื่อมส่วนประกอบ วิธีแก้ปัญหา และผลทดสอบ",
      "prompt": "ส่วนประกอบของระบบทำงานร่วมกันอย่างไร และทดสอบเส้นทางการใช้งานจริงอย่างไร",
      "levels": [
        "ไม่สามารถอธิบายการเชื่อมส่วนประกอบ และไม่มีหลักฐานการทดสอบ",
        "ส่วนประกอบยังทำงานร่วมกันไม่ได้ มีหลักฐานทดสอบน้อย",
        "บูรณาการได้บางส่วน ทดสอบเฉพาะกรณีทั่วไปอย่างจำกัด",
        "ส่วนประกอบทำงานร่วมกันได้ มีผลทดสอบกระบวนการหลัก",
        "บูรณาการความรู้ได้เป็นระบบ มีผลทดสอบกรณีหลักและกรณีผิดพลาด พร้อมอธิบายการแก้ปัญหา"
      ]
    },
    {
      "key": "c3_q3",
      "label": "ความปลอดภัยและการปกป้องข้อมูล",
      "weight": 1,
      "evidence": "ตรวจสิทธิ์ผู้ใช้ การตรวจข้อมูล และมาตรการที่เหมาะกับความเสี่ยงของงาน",
      "prompt": "ข้อมูลใดต้องปกป้อง และระบบป้องกันการเข้าถึงหรือแก้ไขโดยไม่มีสิทธิ์อย่างไร",
      "levels": [
        "ไม่ระบุความเสี่ยงหรือไม่มีมาตรการปกป้องข้อมูลที่จำเป็น",
        "ทราบความเสี่ยงบางส่วน แต่ยังมีช่องโหว่สำคัญที่ไม่ได้จัดการ",
        "มีมาตรการพื้นฐาน แต่หลักฐานตรวจสอบหรือความครอบคลุมยังไม่พอ",
        "มีมาตรการเหมาะกับความเสี่ยงหลัก และแสดงหลักฐานตรวจสอบได้",
        "ระบุความเสี่ยงและจัดการอย่างเหมาะสม พร้อมทดสอบการเข้าถึงหรือใช้งานผิดเงื่อนไข"
      ]
    }
  ],
  "c4": [
    {
      "key": "c4_q1",
      "label": "หลักฐานการทำงานตามบทบาทที่รับผิดชอบ",
      "weight": 1,
      "evidence": "พิจารณาผลงานรายบุคคล บันทึกงาน หรือประวัติการพัฒนา",
      "prompt": "ส่วนใดเป็นงานที่คุณลงมือทำเอง และมีหลักฐานการพัฒนาใดประกอบ",
      "levels": [
        "ไม่สามารถระบุหรือแสดงหลักฐานงานของตนเองได้",
        "ระบุบทบาทไม่ชัด อธิบายผลงานตนเองได้จำกัด",
        "ระบุบทบาทและแสดงผลงานได้บางส่วน แต่หลักฐานยังไม่ครบ",
        "อธิบายงานที่รับผิดชอบได้ชัด มีหลักฐานสอดคล้องเป็นส่วนใหญ่",
        "บทบาทชัดเจน มีหลักฐานต่อเนื่อง และอธิบายรายละเอียดงานที่ลงมือทำได้ครบ"
      ]
    },
    {
      "key": "c4_q2",
      "label": "ความรับผิดชอบและการรายงานผลงานตามจริง",
      "weight": 1,
      "evidence": "เทียบแผนกับผลงาน และดูการเปิดเผยข้อจำกัดหรือส่วนที่ยังไม่เสร็จ",
      "prompt": "งานใดทำได้ตามแผน งานใดยังไม่สำเร็จ และจัดการปัญหาอย่างไร",
      "levels": [
        "ไม่มีข้อมูลหรือหลักฐานเพียงพอประเมินความรับผิดชอบ",
        "สถานะงานไม่ชัด ไม่สามารถอธิบายส่วนที่ยังขาดได้",
        "รายงานสถานะและข้อจำกัดได้บางส่วน หลักฐานหรือแนวทางติดตามยังไม่ครบ",
        "รายงานสถานะตามหลักฐาน เปิดเผยข้อจำกัดและอธิบายการจัดการงานได้",
        "รับผิดชอบงานตามแผนหรืออธิบายการปรับแผนด้วยหลักฐาน รายงานข้อจำกัดและแหล่งที่มาตามจริง"
      ]
    }
  ],
  "c5": [
    {
      "key": "c5_q1",
      "label": "ความชัดเจนของการนำเสนอ",
      "weight": 1,
      "evidence": "การเรียงลำดับเนื้อหา สื่อประกอบ และการใช้เวลา",
      "prompt": "อธิบายปัญหา วิธีดำเนินงาน และผลลัพธ์สำคัญของโครงงานให้กระชับ",
      "levels": [
        "ไม่สามารถสื่อสารสาระสำคัญของโครงงานได้",
        "เนื้อหาสับสน ขาดสาระสำคัญหลายส่วน",
        "สื่อสารเข้าใจได้บางส่วน แต่ลำดับหรือสื่อยังไม่ชัด",
        "นำเสนอเป็นลำดับ สื่อเหมาะสม และสื่อสารสาระสำคัญได้ชัด",
        "นำเสนอกระชับเป็นระบบ ใช้สื่อและเวลาเหมาะสม เชื่อมปัญหา วิธีทำ และผลลัพธ์ได้ครบ"
      ]
    },
    {
      "key": "c5_q2",
      "label": "การตอบข้อซักถามและอธิบายเหตุผล",
      "weight": 1,
      "evidence": "ความเข้าใจงานของตน การใช้หลักฐาน และการยอมรับข้อจำกัด",
      "prompt": "เมื่อกรรมการเสนอข้อโต้แย้ง คุณอธิบายทางเลือกและเหตุผลโดยใช้หลักฐานได้อย่างไร",
      "levels": [
        "ตอบคำถามพื้นฐานเกี่ยวกับงานตนเองไม่ได้",
        "ตอบได้จำกัดและไม่สามารถอธิบายเหตุผลได้",
        "ตอบได้บางประเด็น แต่เหตุผลหรือหลักฐานยังไม่เพียงพอ",
        "ตอบคำถามหลักได้ตรงประเด็น มีเหตุผล และยอมรับข้อจำกัด",
        "ตอบได้ชัดและลึกตามบริบท ใช้หลักฐานสนับสนุน วิเคราะห์ทางเลือกและข้อจำกัดได้"
      ]
    },
    {
      "key": "c5_q3",
      "label": "การทำงานร่วมกันและการพัฒนาตนเอง",
      "weight": 1,
      "evidence": "ดูการประสานงานกับทีม ผู้ใช้ หรือที่ปรึกษา และการนำข้อเสนอแนะไปปรับปรุง",
      "prompt": "คุณประสานงานกับใครบ้าง และนำข้อเสนอแนะไปปรับปรุงผลงานหรือทักษะอย่างไร",
      "levels": [
        "ไม่มีหลักฐานการประสานงานหรือปรับปรุงจากข้อเสนอแนะ",
        "อธิบายการประสานงานได้จำกัด ยังไม่เห็นการนำข้อเสนอแนะไปใช้",
        "มีการประสานงานและปรับปรุงงานบางส่วน แต่หลักฐานยังจำกัด",
        "ประสานงานตามบทบาทได้เหมาะสม และมีหลักฐานปรับปรุงตามข้อเสนอแนะ",
        "ทำงานกับผู้เกี่ยวข้องอย่างรับผิดชอบ สื่อสารเหมาะสม และแสดงพัฒนาการจากข้อเสนอแนะได้ชัดเจน"
      ]
    },
    {
      "key": "c5_q4",
      "label": "จริยธรรมการใช้ข้อมูล แหล่งที่มา และ AI",
      "weight": 1,
      "evidence": "การอ้างอิง สิทธิ์การใช้ข้อมูล การเปิดเผยเครื่องมือ และการตรวจสอบผลงาน",
      "prompt": "ใช้ข้อมูล โค้ด หรือ AI จากแหล่งใดบ้าง และตรวจสอบสิทธิ์ ความถูกต้อง และความเป็นส่วนตัวอย่างไร",
      "levels": [
        "ไม่มีข้อมูลหรือหลักฐานเพียงพอประเมินการใช้ทรัพยากรอย่างรับผิดชอบ",
        "อธิบายแหล่งที่มาหรือการจัดการข้อมูลได้จำกัด ขาดการตรวจสอบที่จำเป็น",
        "ระบุแหล่งที่มาและแนวปฏิบัติได้บางส่วน แต่ยังมีประเด็นสำคัญไม่ครบ",
        "อ้างอิงและใช้ทรัพยากรเหมาะสม เปิดเผยการใช้เครื่องมือและตรวจสอบผลงานเป็นส่วนใหญ่",
        "แสดงที่มาและสิทธิ์การใช้ทรัพยากรชัดเจน ปกป้องข้อมูล เปิดเผยและตรวจสอบการใช้ AI ตามจริง หรืออธิบายได้ว่าไม่ได้ใช้"
      ]
    }
  ]
};
DEFENSE_CRITERIA.forEach(function(c) { c.questions = DEFENSE_QUESTIONS[c.key]; });

const ASSESSMENTS = {
  proposal: { id: 'proposal', label: 'หัวข้อโครงงาน', max: 10, status: 'completed', sheet: 'Scores', criteria: CRITERIA },
  advisor: { id: 'advisor', label: 'อาจารย์ที่ปรึกษา', max: 50, status: 'planned', criteria: [] },
  progress: { id: 'progress', label: 'รายงานความก้าวหน้า', max: 20, status: 'planned', criteria: [] },
  defense: { id: 'defense', label: 'สอบวิพากษ์', max: 20, status: 'open', sheet: 'DefenseScores', criteria: DEFENSE_CRITERIA, rubricVersion: DEFENSE_RUBRIC_VERSION }
};

function getAssessment(id) {
  const key = id || 'proposal';
  if (!Object.prototype.hasOwnProperty.call(ASSESSMENTS, key)) throw new Error('ไม่พบหมวดคะแนน');
  return ASSESSMENTS[key];
}

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
    const auth = getMyEvaluatorInfo(e.parameter.idToken);
    if (!auth.ok) return jsonOutput({ status: 'unauthorized', reason: auth.reason });
    return jsonOutput(getStudentById(e.parameter.id));
  }
  if (action === 'getCriteria') {
    return jsonOutput({ assessments: Object.keys(ASSESSMENTS).map(function (key) {
      const a = ASSESSMENTS[key];
      return { id: a.id, label: a.label, max: a.max, status: a.status, criteria: a.criteria, rubricVersion: a.rubricVersion };
    }), scaleLabels: SCALE_LABELS });
  }
  if (action === 'getMyWorkspace') {
    return jsonOutput(getMyWorkspace(e.parameter.idToken));
  }
  if (action === 'getMyEvaluatorInfo') {
    return jsonOutput(getMyEvaluatorInfo(e.parameter.idToken));
  }
  if (action === 'getDashboard') {
    const auth = verifyGoogleIdToken(e.parameter.idToken);
    if (!auth.ok) {
      return jsonOutput({ status: 'unauthorized', email: auth.email || null, reason: auth.reason || null });
    }
    const assessment = getAssessment(e.parameter.assessment);
    if (!assessment.sheet) return jsonOutput({ status: 'error', message: 'หมวดนี้ยังไม่เปิดใช้งาน' });
    return jsonOutput(getDashboardData(assessment.id));
  }

  // หน้าใช้งานจริงโฮสต์แบบ static; deployment นี้ให้บริการ API
  return HtmlService.createHtmlOutput('<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API ประเมินโครงงาน</title><body style="font-family:sans-serif;padding:32px"><h1>ระบบประเมินโครงงาน 02739498</h1><p>API พร้อมให้บริการ กรุณาเปิดหน้าเว็บ GitHub Pages ของรายวิชาเพื่อเข้าสู่ระบบและให้คะแนน</p></body></html>');
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

/** ข้อมูลส่วนตัวกรรมการ: เฉพาะนิสิตในห้องที่รับผิดชอบและคะแนนของตนเอง */
function getMyWorkspace(idToken) {
  const auth = getMyEvaluatorInfo(idToken);
  if (!auth.ok) return { status: 'unauthorized', reason: auth.reason };
  const ss = getSS();
  const rows = ss.getSheetByName('Students').getDataRange().getValues();
  const seen = {};
  const students = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], id = String(r[0] || '').trim();
    if (!id || seen[id]) continue;
    if (!auth.assignments.some(function(a) { return a.term === r[3] && a.room === r[2]; })) continue;
    seen[id] = true;
    students.push({ id: id, name: r[1], room: r[2], term: r[3], advisor: r[4], topic: r[5] || '' });
  }
  const records = [];
  ['proposal', 'defense'].forEach(function(section) {
    const assessment = getAssessment(section), sheet = ss.getSheetByName(assessment.sheet);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const own = {};
    for (let i = 1; i < data.length; i++) {
      const r = data[i], id = String(r[1] || '').trim();
      if (!seen[id]) continue;
      const email = String(r[12] || '').trim().toLowerCase();
      // คะแนนหัวข้อเดิมไม่มีอีเมล จึงจับคู่ชื่อกับบัญชีที่ยืนยันแล้ว
      const matches = email ? email === auth.email.toLowerCase()
        : section === 'proposal' && String(r[5] || '').trim() === auth.name;
      if (!matches) continue;
      const scores = {};
      assessment.criteria.forEach(function(c, idx) { scores[c.key] = Number(r[6 + idx]); });
      const record = { assessment: section, studentId: id, scores: scores, total: Number(r[11]),
        updatedAt: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || '') };
      if (section === 'defense') {
        record.rubricVersion = r[13] || 'defense-v1';
        record.questionScores = null;
        if (r[13] === DEFENSE_RUBRIC_VERSION) {
          const questions = getDefenseQuestions_();
          const complete = questions.every(function(q, idx) { const raw = r[14 + idx]; return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4; });
          if (complete) {
            record.questionScores = {};
            questions.forEach(function(q, idx) { record.questionScores[q.key] = r[14 + idx]; });
          }
        }
      }
      own[id] = record;
    }
    Object.keys(own).forEach(function(id) { records.push(own[id]); });
  });
  return { status: 'ok', evaluator: { name: auth.name, email: auth.email, assignments: auth.assignments },
    students: students, records: records };
}

/**
 * เรียกจากหน้าเว็บ: บันทึกคะแนน (upsert — กรรมการท่านเดิมกรอกคะแนนนิสิตคนเดิมซ้ำ
 * จะเขียนทับแถวเดิมแทนการเพิ่มแถวใหม่)
 *
 * payload = {
 *   studentId, studentName, room, term, evaluatorName,
 *   rubricVersion, questionScores: { c1_q1: 0-4, ... รวม 15 ข้อ }
 * }
 *
 * ยืนยัน Google ID token และอ่านตัวตน/ข้อมูลนิสิตจากชีทฝั่งเซิร์ฟเวอร์
 */
function submitScore(payload) {
  if (!payload) throw new Error('ข้อมูลคะแนนไม่ครบ');
  const auth = getMyEvaluatorInfo(payload.idToken);
  if (!auth.ok) return { status: 'unauthorized', message: 'กรุณาเข้าสู่ระบบด้วยอีเมลกรรมการใน Committees', reason: auth.reason };
  const assessment = getAssessment(payload.assessment);
  if (assessment.status !== 'open') throw new Error('หมวดนี้ยังไม่เปิดรับคะแนนหรือปิดการประเมินแล้ว');
  const student = getStudentById(payload.studentId);
  if (!student) throw new Error('ไม่พบรหัสนิสิต');
  if (!auth.assignments.some(function (a) { return a.term === student.term && a.room === student.room; })) {
    throw new Error('นิสิตไม่อยู่ในห้องสอบ/แผนการเรียนที่ได้รับมอบหมาย');
  }
  if (payload.rubricVersion !== DEFENSE_RUBRIC_VERSION) throw new Error('เกณฑ์สอบวิพากษ์ปรับเป็น 15 ข้อย่อยแล้ว กรุณารีเฟรชหน้าเว็บก่อนให้คะแนน');
  const calculated = calculateDefenseScores_(payload.questionScores);
  const total = calculated.total, rawValues = calculated.rawValues;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSS().getSheetByName(assessment.sheet);
    if (!sheet) throw new Error('ยังไม่ได้เตรียมชีทสอบวิพากษ์ กรุณารัน setupDefenseSheets');
    const data = sheet.getDataRange().getValues();
    ensureDefenseQuestionColumns_(sheet, data[0] || [], data);
    const newRow = [new Date(), student.id, student.name, student.room, student.term, auth.name]
      .concat(rawValues).concat([total, auth.email, DEFENSE_RUBRIC_VERSION])
      .concat(getDefenseQuestions_().map(function(q) { return payload.questionScores[q.key]; }));
    let existingRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(student.id).trim() &&
          String(data[i][12] || '').trim().toLowerCase() === auth.email.toLowerCase()) {
        existingRow = i + 1;
        break;
      }
    }
    if (existingRow > 0) sheet.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
    else sheet.appendRow(newRow);
    SpreadsheetApp.flush();
    return { status: existingRow > 0 ? 'updated' : 'created', total: total, assessment: assessment.id, rubricVersion: DEFENSE_RUBRIC_VERSION, criterionScores: calculated.criterionScores };
  } finally {
    lock.releaseLock();
  }
}

/** คะแนนย่อยเป็นแหล่งข้อมูลหลัก; G–K ยังคงเป็นคะแนนดิบเทียบเท่า 0–4 ของแต่ละด้าน */
function getDefenseQuestions_() {
  return DEFENSE_CRITERIA.reduce(function(all, c) { return all.concat(c.questions); }, []);
}
function calculateDefenseScores_(questionScores) {
  const questions = getDefenseQuestions_();
  if (!questionScores || Array.isArray(questionScores) || Object.keys(questionScores).length !== questions.length) throw new Error('กรุณาให้คะแนนครบทั้ง 15 ข้อย่อย');
  questions.forEach(function(q) {
    const raw = questionScores[q.key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 4) throw new Error('คะแนนย่อยต้องเป็นจำนวนเต็ม 0–4 ครบทั้ง 15 ข้อ');
  });
  let total = 0;
  const criterionScores = {};
  const rawValues = DEFENSE_CRITERIA.map(function(c) {
    const points = c.questions.reduce(function(sum, q) { return sum + questionScores[q.key] / 4 * q.weight; }, 0);
    total += points;
    const raw = points / c.weight * 4;
    criterionScores[c.key] = raw;
    return raw;
  });
  return { total: Math.round(total * 100) / 100, rawValues: rawValues, criterionScores: criterionScores };
}
function ensureDefenseQuestionColumns_(sheet, existingHeader, existingRows) {
  const columns = ['เวอร์ชันเกณฑ์สอบวิพากษ์'].concat(getDefenseQuestions_().map(function(q) { return q.key + ' · ' + q.label + ' (0–4)'; }));
  columns.forEach(function(label, idx) {
    const previous = existingHeader[13 + idx];
    const dataWithoutHeader = !previous && (existingRows || []).slice(1).some(function(row) { const value = row[13 + idx]; return value !== undefined && value !== null && value !== ''; });
    if ((previous && previous !== label) || dataWithoutHeader) throw new Error('คอลัมน์คะแนนย่อยมีข้อมูลอื่นอยู่ กรุณาให้ผู้ดูแลตรวจสอบก่อนบันทึก');
  });
  const required = 13 + columns.length, current = sheet.getMaxColumns();
  if (current < required) sheet.insertColumnsAfter(current, required - current);
  if (columns.some(function(label, idx) { return existingHeader[13 + idx] !== label; })) sheet.getRange(1, 14, 1, columns.length).setValues([columns]);
}

/** เพิ่มเฉพาะชีทใหม่ ไม่ล้างคะแนนหรือรายชื่อเดิม รันซ้ำได้ */
function setupDefenseSheets() {
  const ss = getSS();
  let scores = ss.getSheetByName('DefenseScores');
  if (!scores) scores = ss.insertSheet('DefenseScores');
  if (scores.getLastRow() === 0) {
    const header = ['Timestamp', 'รหัสนิสิต', 'ชื่อนิสิต', 'ห้องสอบ', 'แผนการเรียน', 'ชื่อกรรมการผู้ประเมิน'];
    DEFENSE_CRITERIA.forEach(function (c) { header.push(c.label + ' (0-4)'); });
    scores.getRange(1, 1, 1, 13).setValues([header.concat(['คะแนนรวม (เต็ม 20)', 'อีเมลกรรมการ'])]);
    scores.setFrozenRows(1);
  }
  let summary = ss.getSheetByName('DefenseSummary');
  if (!summary) summary = ss.insertSheet('DefenseSummary');
  summary.getRange(1, 1, 1, 4).setValues([['รหัสนิสิต', 'ชื่อนิสิต', 'จำนวนกรรมการที่ประเมินแล้ว', 'คะแนนเฉลี่ย (เต็ม 20)']]);
  const students = ss.getSheetByName('Students');
  if (!students) throw new Error('ไม่พบชีท Students');
  const n = students.getLastRow() - 1;
  if (n > 0) {
    const formulas = [];
    for (let r = 2; r <= n + 1; r++) {
      formulas.push(['=Students!A' + r, '=Students!B' + r,
        '=COUNTIF(DefenseScores!B:B,A' + r + ')',
        '=IF(C' + r + '=0,"-",AVERAGEIF(DefenseScores!B:B,A' + r + ',DefenseScores!L:L))']);
    }
    summary.getRange(2, 1, n, 4).setFormulas(formulas);
  }
  summary.setFrozenRows(1);
}

/**
 * เรียกจากหน้า dashboard: สรุปภาพรวมความคืบหน้าการให้คะแนนทั้งหมด
 * - stats: ตัวเลขสรุปรวม (ครบ/บางส่วน/ยังไม่ประเมิน/เฉลี่ยรวม)
 * - byRoom: เฉลี่ย + ความคืบหน้า แยกตามห้องสอบ/แผนการเรียน
 * - students: รายนิสิตทุกคนพร้อมจำนวนกรรมการที่ประเมินแล้วและคะแนนเฉลี่ย
 */
function getDashboardData(assessmentId) {
  const assessment = getAssessment(assessmentId);
  const criteria = assessment.criteria;
  const ss = getSS();
  const studentsData = ss.getSheetByName('Students').getDataRange().getValues();
  const scoreSheet = ss.getSheetByName(assessment.sheet);
  const scoresData = scoreSheet ? scoreSheet.getDataRange().getValues() : [];
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
    const total = Number(scoresData[i][11]);
    if (!scoreMap[id]) scoreMap[id] = [];
    scoreMap[id].push(total);
  }

  // เฉลี่ยคะแนนดิบแต่ละเกณฑ์ (คอลัมน์ G-K) จากทุกแถวใน Scores — ใช้ทำกราฟสรุปรายเกณฑ์
  const CRITERIA_COL_OFFSET = 6; // A=0..F=5, G เริ่มที่ index 6
  const criteriaTotals = criteria.map(function () { return { sum: 0, count: 0 }; });
  for (let i = 1; i < scoresData.length; i++) {
    if (!String(scoresData[i][1]).trim()) continue;
    criteria.forEach(function (c, idx) {
      const raw = Number(scoresData[i][CRITERIA_COL_OFFSET + idx]);
      if (!isNaN(raw)) {
        criteriaTotals[idx].sum += raw;
        criteriaTotals[idx].count++;
      }
    });
  }
  const criteriaAverages = criteria.map(function (c, idx) {
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
    assessment: { id: assessment.id, label: assessment.label, max: assessment.max },
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
 * สรุปความคืบหน้าของกรรมการแต่ละท่าน: ให้คะแนนนิสิตคนไหนไปแล้ว/ยังไม่ได้ให้บ้าง
 * (เทียบจากนิสิตจริงในห้อง/แผนการเรียนที่กรรมการท่านนั้นประจำอยู่ ตามชีท Committees)
 */
function getEvaluatorProgress(committeesData, scoresData, students) {
  const studentById = {};
  students.forEach(function (s) { studentById[s.id] = s; });

  const evaluatorMap = {}; // name -> { assignments: [...], studentIds: {id: true} }
  for (let i = 1; i < committeesData.length; i++) {
    const term = committeesData[i][0], room = committeesData[i][1], name = committeesData[i][2];
    if (!name) continue;
    const key = String(name).trim();
    if (!evaluatorMap[key]) evaluatorMap[key] = { assignments: [], studentIds: {} };
    evaluatorMap[key].assignments.push({ term: term, room: room });
    students.forEach(function (s) {
      if (s.term === term && s.room === room) evaluatorMap[key].studentIds[s.id] = true;
    });
  }

  // นิสิตที่กรรมการแต่ละท่านให้คะแนนไปแล้ว (คอลัมน์ F=ชื่อกรรมการ, B=รหัสนิสิต)
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
    const doneStudents = [];
    const pendingStudents = [];
    Object.keys(info.studentIds).forEach(function (id) {
      const s = studentById[id];
      if (!s) return;
      const entry = { id: id, name: s.name, room: s.room, term: s.term };
      if (doneSet[id]) doneStudents.push(entry); else pendingStudents.push(entry);
    });
    const byName = function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); };
    doneStudents.sort(byName);
    pendingStudents.sort(byName);

    return {
      name: name,
      assignments: info.assignments,
      expected: doneStudents.length + pendingStudents.length,
      done: doneStudents.length,
      doneStudents: doneStudents,
      pendingStudents: pendingStudents
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
