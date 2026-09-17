// Static placeholder curriculum/graduation requirements, keyed by
// curriculum year. Swap for real data (e.g. Admin-uploaded tables or an
// API) once the backend exists — see AdminUploadData.jsx, which lets an
// Admin add/replace entries here at runtime via localStorage, either by
// hand or by uploading the university's Graduation Checklist Excel file.
//
// Each curriculum's `groups` array is a list of requirement blocks:
//   - label: the block's heading, e.g. "Major Elective Courses (Group 1A)"
//   - group: which of Admin's Course groups this block counts toward
//            (see utils/courseGroups.js) — Major Courses / Major Elective /
//            General Education / Free Elective
//   - mode: "all" (every listed course is required) or "choose" (the
//           student only needs `chooseCount` of the listed courses)
//   - courses: the course pool for this block (can be empty for an "open"
//              block, e.g. Free Elective, where any course counts)

export const CURRICULUM_YEARS = ["2021", "2022", "2023", "2024"];

export const DEFAULT_CURRICULA = {
  "2021": {
    year: "2021",
    programName: "B.Sc. Computer Science (Curriculum 2021)",
    totalCreditsRequired: 130,
    minGpa: 2.0,
    groups: [
      {
        id: "2021-major",
        label: "Major Courses",
        group: "Major Courses",
        mode: "all",
        chooseCount: 7,
        creditsRequired: 15,
        courses: [
          { code: "CSX1001", name: "Introduction to Programming", credits: 3 },
          { code: "CSX2001", name: "Data Structures and Algorithms", credits: 3 },
          { code: "CSX3002", name: "Object-Oriented Concepts and Programming", credits: 3 },
          { code: "CSX3011", name: "Database Systems", credits: 3 },
          { code: "CSX4201", name: "Artificial Intelligence Concepts", credits: 3 },
          { code: "CSX4900", name: "Senior Project I", credits: 1 },
          { code: "CSX4901", name: "Senior Project II", credits: 2 },
        ],
      },
    ],
  },
  "2022": {
    year: "2022",
    programName: "B.Sc. Computer Science (Curriculum 2022)",
    totalCreditsRequired: 132,
    minGpa: 2.0,
    groups: [
      {
        id: "2022-major",
        label: "Major Courses",
        group: "Major Courses",
        mode: "all",
        chooseCount: 8,
        creditsRequired: 21,
        courses: [
          { code: "CSX1001", name: "Introduction to Programming", credits: 3 },
          { code: "CSX2001", name: "Data Structures and Algorithms", credits: 3 },
          { code: "CSX3002", name: "Object-Oriented Concepts and Programming", credits: 3 },
          { code: "CSX3011", name: "Database Systems", credits: 3 },
          { code: "CSX3021", name: "Software Engineering", credits: 3 },
          { code: "CSX4201", name: "Artificial Intelligence Concepts", credits: 3 },
          { code: "CSX4900", name: "Senior Project I", credits: 1 },
          { code: "CSX4901", name: "Senior Project II", credits: 2 },
        ],
      },
    ],
  },
  "2023": {
    year: "2023",
    programName: "B.Sc. Computer Science (Curriculum 2023)",
    totalCreditsRequired: 132,
    minGpa: 2.0,
    groups: [
      {
        id: "2023-gened",
        label: "General Education Courses",
        group: "General Education",
        mode: "all",
        chooseCount: 4,
        creditsRequired: 11,
        courses: [
          { code: "ELE1001", name: "Communicative English I", credits: 3 },
          { code: "ELE1002", name: "Communicative English II", credits: 3 },
          { code: "GE1410", name: "Thai for Professional Communication", credits: 2 },
          { code: "GE2202", name: "Ethics", credits: 3 },
        ],
      },
      {
        id: "2023-major",
        label: "Major Courses",
        group: "Major Courses",
        mode: "all",
        chooseCount: 6,
        creditsRequired: 18,
        courses: [
          { code: "CSX3001", name: "Fundamentals of Computer Programming", credits: 3 },
          { code: "CSX3002", name: "Object-Oriented Concepts and Programming", credits: 3 },
          { code: "CSX3003", name: "Data Structure and Algorithms", credits: 3 },
          { code: "CSX3006", name: "Database Systems", credits: 3 },
          { code: "CSX4210", name: "Machine Learning", credits: 3 },
          { code: "CSX3010", name: "Senior Project I", credits: 3 },
        ],
      },
      {
        id: "2023-major-elective",
        label: "Major Elective Courses (Group 1A)",
        group: "Major Elective",
        mode: "choose",
        chooseCount: 3,
        creditsRequired: 9,
        courses: [
          { code: "ITX3004", name: "Information System Analysis and Design", credits: 3 },
          { code: "CSX4107", name: "Web Application Development", credits: 3 },
          { code: "CSX4109", name: "Android Application Development", credits: 3 },
          { code: "CSX4110", name: "Backend Application Development", credits: 3 },
          { code: "ITX4104", name: "Software Testing", credits: 3 },
        ],
      },
      {
        // Open pool for major-elective credit beyond the fixed Group 1A
        // list above — same "open selection, no fixed course list" shape
        // as Free Elective below. Placeholder credits target; adjust via
        // Admin > Upload Table Data to match the real checklist.
        id: "2023-other-major-elective",
        label: "Other Major Elective Courses",
        group: "Other Major Elective Courses",
        mode: "choose",
        chooseCount: 0,
        creditsRequired: 6,
        courses: [],
      },
      {
        id: "2023-free-elective",
        label: "Free Elective Course",
        group: "Free Elective",
        mode: "choose",
        chooseCount: 4,
        creditsRequired: 12,
        courses: [],
      },
    ],
  },
  "2024": {
    year: "2024",
    programName: "B.Sc. Computer Science (Curriculum 2024)",
    totalCreditsRequired: 135,
    minGpa: 2.0,
    groups: [
      {
        id: "2024-major",
        label: "Major Courses",
        group: "Major Courses",
        mode: "all",
        chooseCount: 8,
        creditsRequired: 24,
        courses: [
          { code: "CSX1001", name: "Introduction to Programming", credits: 3 },
          { code: "CSX2001", name: "Data Structures and Algorithms", credits: 3 },
          { code: "CSX3002", name: "Object-Oriented Concepts and Programming", credits: 3 },
          { code: "CSX3011", name: "Database Systems", credits: 3 },
          { code: "CSX3021", name: "Software Engineering", credits: 3 },
          { code: "CSX4201", name: "Artificial Intelligence Concepts", credits: 3 },
          { code: "CSX4210", name: "Machine Learning", credits: 3 },
          { code: "CSX4220", name: "Cloud Computing", credits: 3 },
        ],
      },
    ],
  },
};
