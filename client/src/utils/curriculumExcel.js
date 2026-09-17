// Parses the university's "Graduation Checklist" Excel workbook into this
// app's curriculum shape (see data/mockCurriculum.js) so Admin can upload
// the file directly on the Upload Table Data page instead of typing every
// row by hand.
//
// Expected layout (one worksheet per concentration, e.g. "BSCS - SED 653
// onward"), matching the university's real checklist template:
//   - a "Credits Required:" cell holding the total credits for the degree
//   - a header row containing "Check", "Course No.", "Course Title",
//     "Credits Required"
//   - section rows (no Check value, a label in the Course No. column, and
//     a number in the Credits Required column) that start a new
//     requirement block — e.g. "Major Elective Courses (Group 1A)" with
//     15 credits required
//   - course rows underneath each section (Check is true/false, a real
//     course code in Course No., a title, and its own credits)
//
// A "Setting" sheet (grade→GPA table) is skipped automatically.
import * as XLSX from "xlsx";
import { DEFAULT_COURSE_GROUPS } from "./courseGroups.js";

function guessGroupFromLabel(label) {
  const text = (label || "").toLowerCase();
  if (text.includes("free elective")) return "C. Free Elective Course";
  if (text.includes("group 1a") || (text.includes("elective") && text.includes("software")))
    return "Major Elective Courses (Group 1A) - Software Engineering and Development";
  if (text.includes("group 1b") || (text.includes("elective") && (text.includes("informatics") || text.includes("data science"))))
    return "Major Elective Courses (Group 1B) - Informatics and Data Science";
  if (text.includes("other") && text.includes("elective")) return "Other Major Elective Courses";
  if (text.includes("elective")) return "Other Major Elective Courses";
  if (text.includes("general education")) return "A. General Education Courses";
  if (text.includes("core")) return "Core Courses";
  return "Major Courses";
}

function isCourseCodeLike(value) {
  return /^[A-Z]{2,4}\d{3,4}(-\d{2,4})?$/.test(String(value || "").trim().toUpperCase());
}

/** Lists every non-"Setting" sheet name in the workbook, for the caller to
 * offer a picker when the file has more than one concentration. */
export function listCurriculumSheets(workbook) {
  return workbook.SheetNames.filter((name) => name.trim().toLowerCase() !== "setting");
}

export async function readCurriculumWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array" });
}

/**
 * Parses one worksheet of the workbook into { programName, totalCreditsRequired, groups }.
 * Throws a descriptive Error if the expected header row can't be found.
 */
export function parseCurriculumSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" was not found in this file.`);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  // Program name: row 1 is usually a generic document title ("Graduation
  // Checklist"), with the actual curriculum name on the next couple of
  // non-empty rows, e.g. "BSCS - 2022 Curriculum" / "for 653 onward".
  const titleRows = rows
    .slice(0, 6)
    .map((r) => (r || []).find((cell) => cell !== null && String(cell).trim() !== ""))
    .filter((cell) => cell !== undefined)
    .map((cell) => String(cell).trim());
  const programName =
    titleRows.length > 1 && /checklist/i.test(titleRows[0])
      ? titleRows.slice(1, 3).join(" ")
      : titleRows[0] || sheetName;

  // Total credits required: scan every row for a "Credits Required:" label
  // and take the next non-empty cell on the same row as the number.
  let totalCreditsRequired = null;
  for (const row of rows) {
    const labelIdx = row.findIndex(
      (cell) => typeof cell === "string" && cell.trim().toLowerCase() === "credits required:"
    );
    if (labelIdx !== -1) {
      const value = row.slice(labelIdx + 1).find((cell) => typeof cell === "number");
      if (typeof value === "number") {
        totalCreditsRequired = value;
        break;
      }
    }
  }

  // Header row: contains both "Check" and "Course No.".
  const headerIdx = rows.findIndex(
    (row) =>
      row.some((cell) => String(cell || "").trim() === "Check") &&
      row.some((cell) => String(cell || "").trim().toLowerCase() === "course no.")
  );
  if (headerIdx === -1) {
    throw new Error(
      `Could not find the "Check / Course No. / Course Title" header row on sheet "${sheetName}". Please check the file matches the Graduation Checklist template.`
    );
  }

  const header = rows[headerIdx].map((cell) => String(cell || "").trim().toLowerCase());
  const checkCol = header.indexOf("check");
  const courseNoCol = header.indexOf("course no.");
  const courseTitleCol = header.indexOf("course title");
  const creditsCol = header.indexOf("credits required");

  const groups = [];
  let current = null;
  let blockCounter = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const checkValue = row[checkCol];
    const courseNoValue = row[courseNoCol];
    const creditsValue = row[creditsCol];

    const isCourseRow = typeof checkValue === "boolean";

    if (isCourseRow) {
      const code = String(courseNoValue || "").trim().toUpperCase();
      // Blank placeholder rows (Free Elective / "Other Major Elective")
      // exist only so the printed checklist has room to write in a course
      // by hand — skip them, there's nothing to import.
      if (!code || !isCourseCodeLike(code) || !current) continue;

      current.courses.push({
        code,
        name: String(row[courseTitleCol] || "").trim(),
        credits: typeof creditsValue === "number" ? creditsValue : 0,
      });
      continue;
    }

    // Otherwise: either a section header (has a label and a numeric
    // credits target) or a purely decorative row (category title with no
    // credits, or a blank/signature row) — only the former starts a block.
    const label = String(courseNoValue || "").trim();
    if (!label || typeof creditsValue !== "number") continue;

    blockCounter += 1;
    current = {
      id: `import-${blockCounter}`,
      label,
      group: guessGroupFromLabel(label),
      mode: "all", // resolved below once we know every course's credits
      chooseCount: 0,
      creditsRequired: creditsValue,
      courses: [],
    };
    groups.push(current);
  }

  // Now that every block has its full course list, decide All vs Choose:
  // if the listed courses' credits add up to exactly the block's target,
  // every course is required. Otherwise the student only needs enough of
  // them to reach the target credits.
  groups.forEach((block) => {
    const totalListedCredits = block.courses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
    if (block.courses.length === 0) {
      block.mode = "choose";
      block.chooseCount = 0; // open pool — no fixed course list to choose from
    } else if (Math.abs(totalListedCredits - block.creditsRequired) < 0.01) {
      block.mode = "all";
      block.chooseCount = block.courses.length;
    } else {
      block.mode = "choose";
      const avgCredits = totalListedCredits / block.courses.length || 3;
      block.chooseCount = Math.max(1, Math.round(block.creditsRequired / avgCredits));
    }
  });

  return {
    programName,
    totalCreditsRequired: totalCreditsRequired ?? groups.reduce((sum, g) => sum + g.creditsRequired, 0),
    groups,
  };
}

/** Course group names this file actually used, for the caller to add any
 * new/unrecognized ones to Admin's Course groups list. */
export function collectGroupNames(parsedGroups) {
  return [...new Set(parsedGroups.map((g) => g.group).filter(Boolean))];
}

export { DEFAULT_COURSE_GROUPS };
