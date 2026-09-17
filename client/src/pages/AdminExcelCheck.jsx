import { useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { findStudentByStudentId } from "../utils/students.js";
import { getCurriculum } from "../utils/curriculum.js";
import { checkGraduation } from "../utils/graduation.js";
import "./AdminExcelCheck.css";

const ID_KEYS = ["studentid", "student id", "student_id", "id", "รหัสนักศึกษา"];
const NAME_KEYS = ["name", "fullname", "full name", "displayname", "ชื่อ"];

function normalizeKey(key) {
  return key.trim().toLowerCase();
}

function pickValue(row, keys) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const found = entries.find(([k]) => normalizeKey(k) === key);
    if (found) return String(found[1]).trim();
  }
  return "";
}

function AdminExcelCheck() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError("");
    setRows([]);
    setLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (parsed.length === 0) {
        setError("No data found in the Excel file, or the first sheet is empty.");
        setLoading(false);
        return;
      }

      const results = parsed.map((row) => {
        const studentId = pickValue(row, ID_KEYS);
        const excelName = pickValue(row, NAME_KEYS);

        if (!studentId) {
          return {
            studentId: "-",
            excelName,
            status: "invalid-row",
            reasons: ["This row has no recognizable Student ID column (e.g. Student ID / StudentID)."],
          };
        }

        const student = findStudentByStudentId(studentId);
        if (!student) {
          return {
            studentId,
            excelName,
            status: "not-found",
            reasons: [`Student ${studentId} was not found in the system (not registered yet, or the ID is wrong).`],
          };
        }

        const curriculum = getCurriculum(student.curriculumYear);
        const result = checkGraduation(student, curriculum);

        return {
          studentId,
          excelName,
          displayName: student.displayName,
          status: result.graduated ? "graduated" : "not-graduated",
          curriculumYear: result.curriculumYear ?? student.curriculumYear,
          reasons: result.reasons,
        };
      });

      setRows(results);
    } catch (err) {
      console.error(err);
      setError("Could not read this file. Please check that it is a valid .xlsx or .csv file.");
    } finally {
      setLoading(false);
    }
  };

  const graduatedCount = rows.filter((r) => r.status === "graduated").length;
  const notGraduatedCount = rows.filter((r) => r.status === "not-graduated").length;
  const unresolvedCount = rows.filter((r) => r.status === "not-found" || r.status === "invalid-row").length;

  return (
    <div className="excel-check-page">
      <span className="admin-summary-title-pill">Check from Excel</span>

      <div className="excel-check-upload upload-area">
        <p>
          Upload an Excel file (Graduation List) with a <strong>Student ID</strong> column (a Name column is optional) —
          the system will automatically check each person's graduation status.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        {fileName && (
          <p className="excel-check-filename">
            <FileSpreadsheet size={16} strokeWidth={2} />
            <span>{fileName}</span>
          </p>
        )}
        {loading && <p className="excel-check-loading">Processing...</p>}
        {error && <p className="excel-check-error">{error}</p>}
      </div>

      {rows.length > 0 && (
        <>
          <div className="excel-check-summary">
            <span className="badge excel-check-badge-graduated">
              <CheckCircle2 size={14} strokeWidth={2} /> Graduated: {graduatedCount}
            </span>
            <span className="badge excel-check-badge-not-graduated">
              <XCircle size={14} strokeWidth={2} /> Not Graduated: {notGraduatedCount}
            </span>
            {unresolvedCount > 0 && (
              <span className="badge excel-check-badge-unresolved">
                <AlertCircle size={14} strokeWidth={2} /> Could not check: {unresolvedCount}
              </span>
            )}
          </div>

          <table className="excel-check-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Curriculum Year</th>
                <th>Status</th>
                <th>Reason (if not graduated)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.studentId}</td>
                  <td>{row.displayName || row.excelName || "-"}</td>
                  <td>{row.curriculumYear ?? "-"}</td>
                  <td>
                    {row.status === "graduated" && <span className="excel-status-pill graduated">Graduated</span>}
                    {row.status === "not-graduated" && <span className="excel-status-pill not-graduated">Not Graduated</span>}
                    {row.status === "not-found" && <span className="excel-status-pill unresolved">Not Found</span>}
                    {row.status === "invalid-row" && <span className="excel-status-pill unresolved">Invalid Row</span>}
                  </td>
                  <td>
                    {row.reasons.length > 0 ? (
                      <ul className="excel-check-reasons-list">
                        {row.reasons.map((reason, rIdx) => (
                          <li key={rIdx}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default AdminExcelCheck;
