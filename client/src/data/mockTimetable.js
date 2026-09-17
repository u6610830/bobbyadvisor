// Default "1/2026 CS & IT Course Timetable" seed data for the Admin >
// Course Timetable grid. `day` is 0 = Sunday ... 6 = Saturday, matching
// the grid rows in the UI. `start`/`end` are 24h "HH:MM" strings.
// This is only the starting seed — the page itself is fully editable and
// whatever the admin builds there is what gets persisted/shown.

export const TIMETABLE_DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Grid spans 09:00–21:00 in 90-minute columns, same as the reference
// timetable image this page is modeled on.
export const TIMETABLE_TIME_START = "09:00";
export const TIMETABLE_TIME_END = "21:00";
export const TIMETABLE_TIME_LABELS = [
  "09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00",
];

export const TIMETABLE_COLORS = [
  "#6B7280", // gray
  "#E8833C", // orange
  "#8E5FC7", // purple
  "#5BB85C", // green
  "#F0BB3E", // gold
  "#E1483F", // red
  "#4F93D6", // blue
  "#3FB6A8", // teal
  "#D0609E", // pink
];

export const TIMETABLE_NOTE = "10 seats reserved for IT 684.";

// `name` = course title, `section` = "sec" number. Two entries that share
// the same code + day + start + end are treated as two sections meeting
// at the exact same time (student Planner asks which one to join); two
// entries that share a code but meet at different times are just shown
// as separate blocks with no picker needed.
export const DEFAULT_TIMETABLE_ENTRIES = [
  { id: "seed-1", day: 0, code: "CSX3010", name: "Data Structures and Algorithms", section: "1", room: "NULL", start: "09:00", end: "12:00", color: TIMETABLE_COLORS[0] },
  { id: "seed-2", day: 2, code: "ITX4213", name: "Mobile Application Development", section: "1", room: "VMES0313", start: "09:00", end: "12:00", color: TIMETABLE_COLORS[1] },
  { id: "seed-3", day: 2, code: "CSX3008", name: "Object-Oriented Programming", section: "1", room: "VMES0314", start: "13:30", end: "16:30", color: TIMETABLE_COLORS[2] },
  { id: "seed-4", day: 3, code: "ITX2007", name: "Database Systems", section: "1", room: "VMES1002", start: "09:00", end: "12:00", color: TIMETABLE_COLORS[3] },
  { id: "seed-4b", day: 3, code: "ITX2007", name: "Database Systems", section: "2", room: "VMES1002", start: "09:00", end: "12:00", color: TIMETABLE_COLORS[3] },
  { id: "seed-5", day: 3, code: "BG14037", name: "General Elective", section: "1", room: "SM418", start: "13:30", end: "16:30", color: TIMETABLE_COLORS[4] },
  { id: "seed-6", day: 5, code: "CSX4201", name: "Machine Learning", section: "1", room: "VMES1005", start: "09:00", end: "12:00", color: TIMETABLE_COLORS[5] },
  { id: "seed-7", day: 5, code: "CSX4203", name: "Machine Learning Lab", section: "1", room: "VMES1002", start: "13:30", end: "16:30", color: TIMETABLE_COLORS[6] },
];
