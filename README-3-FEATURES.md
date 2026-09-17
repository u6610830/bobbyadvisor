# สรุปงาน 3 ฟีเจอร์ที่ขอมา

## สรุปสถานะ (ก่อนแก้)
เช็คโค้ดใน `merged.zip` แล้วพบว่า:
- **ข้อ 2 (Pre-Require)**: ทำไว้ครบแล้วทั้งหมด (Admin CRUD + Student check +
  บล็อกตอนลงทะเบียนใน Planner) — **ไม่ได้แก้อะไรเพิ่ม**
- **ข้อ 1 (แชท student ↔ advisor)**: มีแค่ฝั่ง instructor เป็น mock (ไม่บันทึกอะไร),
  ฝั่ง student ยังไม่มีหน้าแชทเลย แม้ App.jsx จะ import ไว้รอแล้วก็ตาม
- **ข้อ 3 (แก้เกรด)**: Backend endpoint `PUT /grades/:id` มีอยู่แล้ว
  แต่หน้า GradeList ฝั่ง student ยังไม่มีปุ่มดินสอให้กด

## สิ่งที่แก้ไป/เพิ่มในรอบนี้

### 1. แชท student ↔ advisor (real-time, เก็บใน Supabase)
ไฟล์ใหม่/แก้:
- `client/src/utils/supabaseClient.js` — Supabase client ฝั่ง browser (ใช้ anon key)
- `client/src/pages/StudentAdvisorChat.jsx` — หน้าแชทฝั่ง student (ของเดิม import ไว้แล้วใน App.jsx แต่ไฟล์ยังไม่มี)
- `client/src/pages/InstructorStudentChat.jsx` — เปลี่ยนจาก mock เป็นแชทจริง (แก้ทับของเดิม)
- `client/src/pages/AdvisorChat.css` — style ที่ใช้ร่วมกันทั้งสองฝั่ง
- `client/src/pages/InstructorPortal.jsx` — ส่ง `advisorId={userId}` เข้า chat component
- `client/.env.example` — ตัวอย่างไฟล์ env ที่ต้องใช้

ใช้ตาราง `advisor_messages` ที่มี SQL พร้อมอยู่แล้วที่ `server/supabase_chat.sql`
(ของเดิมในโปรเจกต์ ยังไม่เคยรัน)

### 2. Pre-Require — ไม่ต้องแก้อะไร (ของเดิมทำไว้ครบแล้ว)
Admin เข้าได้ที่ Sidebar > "Pre-Require", Student เข้าได้ที่ Sidebar > "Pre-Require"
เช่นกัน ตาราง `course_prerequisites` มี SQL พร้อมที่ `server/supabase_prerequisites.sql`

### 3. แก้เกรด (ปุ่มดินสอ)
ไฟล์แก้:
- `client/src/pages/GradeList.jsx` — เพิ่มปุ่มดินสอต่อรายวิชา กดแล้วแก้ชื่อวิชา/เกรด/หน่วยกิตได้
  กด ✓ เพื่อบันทึก (เรียก `PUT /grades/:id` ที่มีอยู่แล้ว), กด ✕ เพื่อยกเลิก
- `client/src/pages/GradeList.css` — style ของฟอร์มแก้ไข

**GPA รวมไม่มีปุ่มแก้ตรงๆ** ตามที่คุยกันไว้ — มันคำนวณอัตโนมัติจากเกรดรายวิชาเสมอ
ดังนั้นแก้เกรดวิชาไหน GPA รวม/เฉลี่ยเทอมจะขยับให้เองอัตโนมัติ

## ต้องทำเองก่อนใช้งานได้จริง (ผมเข้าถึง Supabase ของจริงไม่ได้)

1. เปิด Supabase SQL Editor ของโปรเจกต์
   (`https://supabase.com/dashboard/project/ipkxqqnuwswuwbtsemdp`)
   แล้วรันไฟล์ต่อไปนี้ **ถ้ายังไม่เคยรัน**:
   - `server/supabase_chat.sql` ← จำเป็นสำหรับข้อ 1 (แชท)
   - `server/supabase_prerequisites.sql` ← ถ้ายังไม่เคยรันสำหรับข้อ 2

2. สร้างไฟล์ `client/.env` (copy จาก `client/.env.example`) แล้วใส่ค่า:
   ```
   VITE_SUPABASE_URL=https://ipkxqqnuwswuwbtsemdp.supabase.co
   VITE_SUPABASE_ANON_KEY=<เอาจาก Supabase > Project Settings > API > anon public key>
   ```
   **ห้ามใส่ service_role key** ในไฟล์นี้เด็ดขาด (มันจะถูกฝังไปในโค้ด browser
   ที่ใครก็เปิดดูได้) — service_role key ใช้ใน `server/.env` (`SUPABASE_KEY`) เท่านั้น

3. รัน `npm install` ใน `client/` (เผื่อยังไม่เคยลง `@supabase/supabase-js` —
   จริงๆ อยู่ใน package.json อยู่แล้ว)

4. รัน `npm run dev` (client) และ `npm start`/`node server.js` (server) ตามปกติ
   ต้อง restart dev server หลังเพิ่ม/แก้ `.env` ด้วย (Vite อ่าน env แค่ตอน start)

## จุดที่อยากให้รู้ไว้ (ไม่ใช่บั๊ก แต่เป็นข้อจำกัดของระบบเดิม)
- Login ของระบบนี้เช็คแค่ prefix ตัวอักษรแรกของ ID (U/E/A) ไม่มี auth จริง
  ดังนั้น RLS policy ของตาราง `advisor_messages` เปิดกว้างไว้ (any anon อ่าน/เขียนได้)
  — ถ้าต้องการความปลอดภัยจริงจังต้องทำ Supabase Auth เพิ่ม ซึ่งเป็นงานอีกก้อนใหญ่
  แยกจากนี้ ตอนนี้ทำแค่ให้ฟีเจอร์ทำงานได้ตามที่ขอก่อน

---

## รอบที่ 2 — แก้ตามฟีดแบ็ก (23 ส.ค.)

### แก้ error "Could not find the table 'public.course_prerequisites'"
Error นี้แปลว่ายังไม่เคยรัน `server/supabase_prerequisites.sql` ใน Supabase SQL Editor
ของโปรเจกต์จริง — ต้องรันไฟล์นี้ก่อนถึงจะใช้หน้า Pre-Require ได้ (ทั้งฝั่ง Admin และ Student)

### 1. Admin Pre-Require: อัพโหลดรูป/PDF แทนพิมพ์เอง
- `server/server.js` — เพิ่ม endpoint ใหม่ `POST /extract-prerequisites`
  (ใช้ Gemini อ่านตาราง prerequisite จากรูปหรือ PDF แบบเดียวกับที่ Course Timetable ใช้อยู่)
- `client/src/pages/AdminPreRequire.jsx` — เพิ่มกล่องอัพโหลดไฟล์ด้านบนตาราง
  กดอัพโหลดแล้วจะเรียก `/extract-prerequisites` → บันทึกลง Supabase ทันทีผ่าน
  `/prerequisites/import` (ของเดิมมีอยู่แล้ว) → โหลดตารางใหม่ให้แก้ไข/เพิ่ม/ลบต่อได้เลย
  **หมายเหตุ: การอัพโหลดจะแทนที่ข้อมูลทั้งตาราง** (เหมือนพฤติกรรมของ Course Timetable
  ที่มีอยู่แล้ว) ถ้าไม่อยากให้แทนที่ทั้งหมด บอกได้ จะเปลี่ยนเป็น "เพิ่มเข้าไปแทนที่จะแทนที่ทั้งหมด" ให้

### 2. Student Pre-Require ย้ายเข้าไปในหน้า Planner
- ลบเมนู "Pre-Require" แยกออกจาก Sidebar ฝั่ง student (`layout/Sidebar.jsx`)
- `client/src/pages/Planner.jsx` — เพิ่ม tab ด้านบน 2 อัน: "Planner" และ
  "Check Pre-Require" กด tab หลังแล้วจะเห็นหน้าตรวจสอบว่าลงได้/ลงไม่ได้ (component เดิม
  `StudentPrerequisites.jsx` เอามาใช้ซ้ำ ไม่ได้เขียนใหม่)
- `client/src/App.jsx` — เอา route "prerequisites" เดิมออก (ย้ายเข้า Planner แล้ว)

### 3. ปุ่มแก้เกรด ย้ายไปมุมบนขวาของกล่องวิชา
- `client/src/pages/GradeList.jsx` + `.css` — ออกแบบใหม่ให้แต่ละวิชาเป็นกล่อง (card)
  ของตัวเอง ปุ่มดินสอ (วงกลมเล็ก) ปักอยู่มุมบนขวาของกล่องเสมอ ทุกวิชากดแก้ได้เหมือนกันหมด
  ไม่ได้จำกัดแค่วิชาล่าสุด

  **หมายเหตุ**: ข้อความที่ส่งมา ("กรอบวิชาที่ลงล่าสุด") ตีความได้สองแบบ ผมเลือกแบบที่
  ปุ่มอยู่มุมขวาบนของ**ทุกกล่องวิชา** (ทุกวิชาแก้ได้เท่ากันหมด) เพราะตรงกับที่บอกว่า
  "สามารถแก้ได้ทุกวิชา" มากกว่า — ถ้าจริงๆ อยากได้แบบอื่น (เช่น ปุ่มเดียวมุมขวาบนของกล่อง
  แต่ละเทอมเพื่อเข้าสู่โหมดแก้ไขทั้งเทอม) บอกได้เลย แก้ให้ใหม่ได้เร็ว

---

## รอบที่ 3 — แก้ตามฟีดแบ็ก (24 ส.ค.)

### 1. Admin Pre-Require: อัพโหลดรูปไม่ได้
เช็คโค้ด endpoint `/extract-prerequisites` แล้ว ใช้ pattern เดียวกับ
`/extract-timetable` (ที่ใช้งานได้อยู่แล้ว) เป๊ะๆ ทุกจุด — เพิ่มการแสดง preview รูปหลัง
เลือกไฟล์ (เหมือนหน้า Course Timetable) ให้เห็นชัดว่าเลือกไฟล์ถูกไหมก่อนกดอัพโหลด

**ถ้ายัง upload ไม่ได้หลังโหลดโค้ดชุดนี้ไปแล้ว ที่เป็นไปได้มากที่สุดคือ**:
1. เซิร์ฟเวอร์ (`server/server.js`) ยังไม่ได้ restart หลังเอาโค้ดใหม่ไปใส่ — endpoint
   `/extract-prerequisites` เป็น route ใหม่ ถ้า server เดิมยังรันอยู่จะได้ 404
2. `GEMINI_API_KEY` ใน `server/.env` ไม่ถูกต้องหรือหมดอายุ
3. ไฟล์ที่อัพโหลดใหญ่เกินไปหรือเป็น format ที่ Gemini อ่านไม่ออก

ถ้าลอง restart server แล้วยังไม่ได้ ส่ง error message ที่ขึ้นมา (บน UI หรือใน browser
console/server terminal) มาให้ดูได้เลย จะได้ตามหาสาเหตุที่แท้จริงต่อ

### 2. Student → Admin: Pre-Require sync ผ่าน database อยู่แล้ว
ของเดิมเชื่อม database อยู่แล้ว (ไม่ใช่ local mock) — ฝั่ง Admin บันทึกผ่าน
`POST/PUT/DELETE /prerequisites` ลง Supabase ตาราง `course_prerequisites` โดยตรง
ฝั่ง Student ก็ดึงจากตารางเดียวกันผ่าน `GET /prerequisites/check` ไม่มีการ mock ข้อมูล
ฝั่งไหนเลย ตราบใดที่รัน `server/supabase_prerequisites.sql` แล้ว ข้อมูลจะ sync กันอัตโนมัติ

### 3. Student: กลุ่ม Prerequisite ดึงจากรหัสนักศึกษาอัตโนมัติ (ไม่ต้องเลือกเอง)
- `client/src/utils/prereqGroup.js` — เขียนใหม่ทั้งไฟล์ ตัด logic การเลือกเองออก
  ดึง 3 ตัวเลขแรกจากรหัสนักศึกษา (เช่น `u6610001` → `661`) มาคำนวณกลุ่มอัตโนมัติ:
  - ปี < 65 → กลุ่ม g1 (รุ่น 62-64)
  - ปี = 65 และ revision ≤ 2 → กลุ่ม g2 (รุ่น 65/1, 65/2)
  - ปี = 65 revision ≥ 3, หรือปี > 65 (66, 67, ...) → กลุ่ม g3 (รุ่น 65/3 เป็นต้นไป)
- `client/src/pages/Profile.jsx` — เอาฟอร์ม "เลือกกลุ่ม Prerequisite" ออก เหลือแค่แสดง
  รหัสรุ่น (batch) และกลุ่มที่คำนวณได้แบบ read-only
- `client/src/pages/Register.jsx` — เอา dropdown เลือกกลุ่มตอนสมัครออก คำนวณจากรหัส
  นักศึกษาที่กรอกให้อัตโนมัติแทน
- `client/src/App.jsx` — ตัดการเชื่อม `onPrereqGroupChange` ที่ไม่ใช้แล้วออก


---

## รอบที่ 4 — แก้ error 500 (24 ส.ค.)

### 1. `/extract-prerequisites` → Gemini error `400 INVALID_ARGUMENT`
Error นี้มาจาก Gemini API ตรงๆ (ไม่ใช่บั๊กจาก endpoint เอง เพราะ pattern เหมือน
`/extract-timetable` เป๊ะ) ที่พบบ่อยที่สุดคือไฟล์ที่ส่งไปไม่ใช่ชนิดที่ Gemini รองรับ
(เช่น .heic จากมือถือ iPhone, ไฟล์เสีย, หรือไฟล์ว่างเปล่า) → เพิ่ม guard ไว้ที่
`server/server.js`:
- เช็คชนิดไฟล์ก่อนส่งเข้า Gemini (รับเฉพาะ PNG/JPEG/WEBP/HEIC/HEIF/PDF) ถ้าไม่ตรงจะ
  ตอบ error ที่อ่านเข้าใจได้ทันที ไม่ต้องเดา
- เช็คว่าไฟล์ไม่ว่างเปล่าก่อนส่ง
- ถ้า Gemini ตอบ `INVALID_ARGUMENT` กลับมา จะแปลเป็นข้อความภาษาไทยที่บอกสาเหตุที่เป็นไปได้
- `client/src/pages/AdminPreRequire.jsx` — จำกัด accept ของ input file ให้เหลือแค่
  `image/png, image/jpeg, image/webp, .pdf` (ตัด mimetype แปลกๆ ออกตั้งแต่ตอนเลือกไฟล์)

**ถ้าลองไฟล์ jpg/png ปกติแล้วยัง error INVALID_ARGUMENT อยู่** ส่งข้อความ error ใหม่ที่ขึ้น
มาให้ดู (ตอนนี้จะอ่านง่ายขึ้นแล้ว ไม่ใช่ JSON ดิบๆ) พร้อมบอกว่าไฟล์ที่อัพโหลดเป็นไฟล์แบบไหน
(รูปถ่าย/screenshot/PDF, ประมาณกี่ MB)

### 2. `/prerequisites` (GET) และ `/timetable-note` ก็ error 500 ด้วย
**อันนี้ไม่เกี่ยวกับโค้ดที่ผมแก้เลย** — สองตัวนี้คนละตารางกันเลย
(`course_prerequisites` กับ `course_timetable_note`) แต่ error พร้อมกันทั้งคู่ แปลว่าน่าจะ
เป็นปัญหาระดับการเชื่อมต่อ Supabase ฝั่ง **server** เอง (ไม่ใช่ table ใดตารางหนึ่งเจาะจง)
ที่เป็นไปได้:
- `server/.env` ไม่มี หรือค่า `SUPABASE_URL` / `SUPABASE_KEY` ผิด/หมดอายุ
  (**ต้องเป็น service_role key ไม่ใช่ anon key ที่ใช้ใน client/.env** — คนละไฟล์ คนละ key กัน)
- server ไม่ได้ restart หลังแก้ `server/.env`

วิธีเช็คสาเหตุจริง: **ดู terminal ที่รัน `node server.js` อยู่** (ไม่ใช่ browser console) ตอนที่
error เกิดขึ้น จะเห็นข้อความจาก `console.error(...)` ที่บอกสาเหตุจริงจาก Supabase เช่น
"Invalid API key" หรือ "relation ... does not exist" — copy ข้อความนั้นมาให้ดูได้เลย
จะช่วยตามหาสาเหตุที่แท้จริงต่อได้เร็วขึ้นมาก
