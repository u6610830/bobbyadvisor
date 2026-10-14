
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { X, AlertTriangle, Save, Clock, RefreshCcw } from "lucide-react";
import EditableList from "../components/EditableList.jsx";
import { ALWAYS_OPEN_COURSES, seniorProjectProblems } from "../utils/alwaysOpenCourses.js";
import { computePassedAndCredits } from "../utils/earnedCredits.js";
import { loadState } from "../utils/storage.js";
import {
  TIMETABLE_DAY_LABELS,
  TIMETABLE_TIME_START,
  TIMETABLE_TIME_END,
  TIMETABLE_TIME_LABELS,
  DEFAULT_TIMETABLE_ENTRIES,
} from "../data/mockTimetable.js";
import { getCurrentPrereqGroupId } from "../utils/prereqGroup.js";
import { prereqTextKey } from "../data/prereqGroups.js";
import {
  getCurriculumForStudent,
  syncCurriculaFromServer,
  subscribeCurricula,
} from "../utils/curriculum.js";
import { evaluateCurriculumProgress } from "../utils/curriculumProgress.js";
import {
  getStudentElectiveGroup,
  filterBlocksForElectiveGroup,
} from "../utils/electiveGroup.js";
import { normalizeCourseCode, extractCourseCodes } from "../utils/courseCode.js";
import { COMPLETED_GRADES, PASSING_WITHOUT_MIN_C, normalizeGrade, courseMatchesRule } from "../utils/graduation.js";
import {
  statusOverrideGroupKey,
  fetchStudentElectiveCourses,
  mergeElectiveGroupRows,
  electiveGroupCreditsEarned,
} from "../utils/studentElectiveCourses.js";
import StudentPrerequisites from "./StudentPrerequisites.jsx";
import "./Planner.css";
import UnsavedNotice from "../components/UnsavedNotice.jsx";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

const APPROVAL_LABELS = {
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

const TIMETABLE_ENTRIES_KEY = "timetableEntries";
const BLOCK_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#16A34A",
  "#0891B2",
  "#CA8A04",
];

const CREDITS_PER_COURSE = 3;

function getDifficulty(courseCount) {
  if (courseCount >= 4) return "Hard";
  if (courseCount >= 2) return "Moderate";
  if (courseCount === 1) return "Light";
  return "None planned";
}

function getBalanceSuggestion(courseCount, difficulty) {
  if (courseCount === 0) {
    return "Add a course above to get a balance suggestion.";
  }
  if (difficulty === "Hard") {
    return "This load looks heavy — consider spreading some courses across another term.";
  }
  if (difficulty === "Moderate") {
    return "This looks manageable — keep an eye on overlapping deadlines.";
  }
  return "This is a light load — you could consider adding another course.";
}

function toMinutes(hhmm) {
  const [h, m] = (hhmm || "09:00").split(":").map(Number);
  return h * 60 + m;
}

const RANGE_START = toMinutes(TIMETABLE_TIME_START);
const RANGE_END = toMinutes(TIMETABLE_TIME_END);
const RANGE_SPAN = RANGE_END - RANGE_START;

function pctFromTime(hhmm) {
  const clamped = Math.min(
    Math.max(toMinutes(hhmm), RANGE_START),
    RANGE_END
  );
  return ((clamped - RANGE_START) / RANGE_SPAN) * 100;
}

function groupIntoBlocks(entries) {
  const byKey = new Map();

  entries.forEach((entry) => {
    const key = `${entry.code}|${entry.day}|${entry.start}|${entry.end}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        day: entry.day,
        start: entry.start,
        end: entry.end,
        code: entry.code,
        color: entry.color,
        sections: [],
      });
    }

    byKey.get(key).sections.push(entry);
  });

  return [...byKey.values()];
}

function applyBlockColors(blocks) {
  const byDay = new Map();

  blocks.forEach((block) => {
    const dayBlocks = byDay.get(block.day) || [];
    dayBlocks.push(block);
    byDay.set(block.day, dayBlocks);
  });

  const colors = new Map();

  byDay.forEach((dayBlocks) => {
    let previousColor = null;

    [...dayBlocks]
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
      .forEach((block, index) => {
        let color = BLOCK_COLORS[(block.day + index) % BLOCK_COLORS.length];

        if (color === previousColor) {
          color = BLOCK_COLORS.find((item) => item !== previousColor);
        }

        colors.set(block.key, color);
        previousColor = color;
      });
  });

  return blocks.map((block) => ({
    ...block,
    color: colors.get(block.key) || BLOCK_COLORS[0],
  }));
}

const LANE_HEIGHT = 60;
const ROW_PADDING = 10;

function layoutDayLanes(dayBlocks) {
  const sorted = [...dayBlocks].sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start)
  );

  const laneEndTimes = [];

  const placed = sorted.map((block) => {
    const start = toMinutes(block.start);
    let lane = laneEndTimes.findIndex((end) => end <= start);

    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(toMinutes(block.end));
    } else {
      laneEndTimes[lane] = toMinutes(block.end);
    }

    return { ...block, lane };
  });

  return {
    placed,
    laneCount: Math.max(1, laneEndTimes.length),
  };
}

function sortSections(sections) {
  return [...sections].sort((a, b) => {
    const numA = Number(a.section);
    const numB = Number(b.section);

    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return numA - numB;
    }

    return String(a.section || "").localeCompare(
      String(b.section || "")
    );
  });
}

const PLANNER_TABS = [
  { id: "planner", label: "Planner" },
  { id: "prereq-check", label: "Check Pre-Require" },
];

function Planner({ studentId, curriculumYear = null }) {
  const [activeTab, setActiveTab] = useState("planner");
  const [courses, setCourses] = useState([]);

  const [openEntries, setOpenEntries] = useState(() =>
    loadState(TIMETABLE_ENTRIES_KEY, DEFAULT_TIMETABLE_ENTRIES)
  );

  const [sectionPicker, setSectionPicker] = useState(null);
  const [prereqRows, setPrereqRows] = useState([]);
  const [courseCreditsByCode, setCourseCreditsByCode] = useState({});
  const [gradeRows, setGradeRows] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState(null);

  const plannerCourseRef = useRef(null);

  const scrollToPlannerCourse = () => {
    setTimeout(() => {
      plannerCourseRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };

  const [blockedNotice, setBlockedNotice] = useState(null);
  const [conflictNotice, setConflictNotice] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [approval, setApproval] = useState(null);
  const [approvalRefreshing, setApprovalRefreshing] = useState(false);
  const [courseGroupByCode, setCourseGroupByCode] = useState({});
  const [aiInsights, setAiInsights] = useState({
    difficulty: null,
    balanceSuggestion: null,
  });
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showCourseLeft, setShowCourseLeft] = useState(false);
  const [electiveGroupId, setElectiveGroupId] = useState(null);
  const [, setCurriculaVersion] = useState(0);
  const [electiveCourses, setElectiveCourses] = useState([]);

  const [advisorRecommendations, setAdvisorRecommendations] = useState([]);
  const [recommendationStatus, setRecommendationStatus] = useState("");

  const curriculum = studentId
    ? getCurriculumForStudent(studentId, curriculumYear)
    : null;

  const { passedCodes, creditsEarned } = useMemo(
    () => computePassedAndCredits(gradeRows, curriculum),
    [gradeRows, curriculum]
  );

  const prereqGroupId = studentId
    ? getCurrentPrereqGroupId(studentId)
    : null;

  const prereqColumn = prereqTextKey(prereqGroupId);

  useEffect(() => {
    syncCurriculaFromServer();

    return subscribeCurricula(() =>
      setCurriculaVersion((version) => version + 1)
    );
  }, []);

  useEffect(() => {
    if (!studentId) {
      setElectiveGroupId(null);
      return;
    }

    getStudentElectiveGroup(studentId)
      .then(setElectiveGroupId)
      .catch((err) =>
        console.error("Failed to load elective group:", err)
      );
  }, [studentId]);

  useEffect(() => {
    if (!showCourseLeft || !studentId) return;

    fetchStudentElectiveCourses(studentId).then(setElectiveCourses);
  }, [showCourseLeft, studentId]);

  useEffect(() => {
    if (!studentId) {
      setCourses([]);
      setApproval(null);
      return;
    }

    axios
      .get(
        `${API_BASE}/registrations/${encodeURIComponent(studentId)}`
      )
      .then((res) => {
        const registrations = res.data?.registrations || [];

        const savedCourses = registrations
          .map((row) => {
            if (row.course_label) {
              return row.course_label;
            }

            if (row.course_code) {
              return row.section
                ? `${row.course_code} Sec.${row.section}`
                : row.course_code;
            }

            return null;
          })
          .filter(Boolean);

        setCourses(savedCourses);
        setSavedSnapshot(JSON.stringify([...savedCourses].sort()));
        setApproval(res.data?.approval || null);
      })
      .catch((err) => {
        console.warn("Could not load saved planner:", err.message);
        setCourses([]);
        setSavedSnapshot(JSON.stringify([]));
        setApproval(null);
      });
  }, [studentId]);

  useEffect(() => {
    if (!studentId) {
      setAdvisorRecommendations([]);
      return;
    }

    axios
      .get(
        `${API_BASE}/advisor-course-recommendations/${encodeURIComponent(
          studentId
        )}`
      )
      .then((res) => {
        const rows = res.data?.recommendations || [];

        setAdvisorRecommendations(
          rows.filter(
            (row) =>
              String(row.status || "pending").trim().toLowerCase() ===
              "pending"
          )
        );
      })
      .catch((err) => {
        console.warn(
          "Could not load advisor course recommendations:",
          err.message
        );
        setAdvisorRecommendations([]);
      });
  }, [studentId]);

  useEffect(() => {
    axios
      .get(`${API_BASE}/prerequisites`)
      .then((res) =>
        setPrereqRows(res.data.prerequisites || [])
      )
      .catch((err) =>
        console.warn("Could not load prerequisites:", err.message)
      );

    if (!studentId) return;

    axios
      .get(`${API_BASE}/grades?student_id=${studentId}`)
      .then((res) =>
        setGradeRows(Array.isArray(res.data) ? res.data : [])
      )
      .catch((err) =>
        console.warn(
          "Could not load grades for prerequisite check:",
          err.message
        )
      );
  }, [studentId]);

  useEffect(() => {
    axios
      .get(`${API_BASE}/courses`)
      .then((res) => {
        const catalogCourses = res.data?.courses || [];
        const groupMap = {};
        const creditMap = {};

        catalogCourses.forEach((course) => {
          const code = normalizeCourseCode(course.course_code);

          if (code && course.course_group) {
            groupMap[code] = course.course_group;
          }

          const credits = Number(course.credits);

          if (code && Number.isFinite(credits) && credits > 0) {
            creditMap[code] = credits;
          }
        });

        setCourseGroupByCode(groupMap);
        setCourseCreditsByCode(creditMap);
      })
      .catch((err) =>
        console.warn("Could not load course catalog:", err.message)
      );
  }, []);

  useEffect(() => {
    if (courses.length === 0) {
      setAiInsights({
        difficulty: null,
        balanceSuggestion: null,
      });
      setInsightsLoading(false);
      return;
    }

    setInsightsLoading(true);

    const timer = setTimeout(() => {
      axios
        .post(`${API_BASE}/planner-insights`, { courses })
        .then((res) => {
          setAiInsights({
            difficulty: res.data?.difficulty || null,
            balanceSuggestion: res.data?.balanceSuggestion || null,
          });
        })
        .catch((err) =>
          console.warn("Could not load planner insights:", err.message)
        )
        .finally(() => setInsightsLoading(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [courses]);

  const checkPrerequisite = (courseCode, courseTitle) => {
    const seniorProblems = seniorProjectProblems(courseCode, {
      passedCodes,
      creditsEarned,
      studentId,
    });

    if (seniorProblems.length > 0) {
      return {
        code: normalizeCourseCode(courseCode) || courseCode,
        reason: seniorProblems.join(" and "),
      };
    }

    if (!prereqColumn) return null;

    const normalizedCourseCode = normalizeCourseCode(courseCode);

    let row = normalizedCourseCode
      ? prereqRows.find(
          (item) =>
            normalizeCourseCode(item.course_code) === normalizedCourseCode
        )
      : null;

    if (!row && courseTitle) {
      const normalizedTitle = String(courseTitle).trim().toLowerCase();

      row = prereqRows.find(
        (item) =>
          String(item.course_title || "").trim().toLowerCase() ===
          normalizedTitle
      );
    }

    if (!row) return null;

    const ruleText = row[prereqColumn];

    if (!ruleText || !ruleText.trim()) return null;

    const rowCode =
      normalizeCourseCode(row.course_code) || normalizedCourseCode;

    const requiredCodes = extractCourseCodes(ruleText).filter(
      (code) => code !== rowCode
    );

    const missing = requiredCodes.filter(
      (code) => !passedCodes.has(code)
    );

    if (missing.length === 0) return null;

    return {
      code: rowCode || courseCode,
      reason: `You have not yet passed: ${missing.join(", ")}`,
    };
  };

  const courseLabel = (entry) =>
    `${entry.code} Sec.${entry.section || "1"}`;

  const checkCourseLabelPrerequisite = (label) => {
    const courseCode = extractCourseCodes(label)[0];

    const matchingEntry = openEntries.find(
      (entry) =>
        courseCode &&
        normalizeCourseCode(entry.code) === courseCode
    );

    return courseCode
      ? checkPrerequisite(courseCode, matchingEntry?.name)
      : null;
  };

  const checkTimeConflict = (newEntry) => {
    const newStart = toMinutes(newEntry.start);
    const newEnd = toMinutes(newEntry.end);

    for (const existingLabel of courses) {
      const existingEntries = openEntries.filter(
        (entry) => courseLabel(entry) === existingLabel
      );

      for (const existing of existingEntries) {
        if (existing.day !== newEntry.day) continue;

        const existingStart = toMinutes(existing.start);
        const existingEnd = toMinutes(existing.end);

        if (newStart < existingEnd && newEnd > existingStart) {
          return existingLabel;
        }
      }
    }

    return null;
  };

  const checkLabelTimeConflict = (label) => {
    const code = extractCourseCodes(label)[0];

    if (!code) return null;

    const entries = openEntries.filter(
      (entry) =>
        normalizeCourseCode(entry.code) === normalizeCourseCode(code)
    );

    for (const entry of entries) {
      const conflict = checkTimeConflict(entry);
      if (conflict) return conflict;
    }

    return null;
  };

  useEffect(() => {
    let cancelled = false;

    axios
      .get(`${API_BASE}/timetable`)
      .then((res) => {
        if (cancelled) return;

        if (res.data.entries?.length) {
          setOpenEntries(res.data.entries);
        }
      })
      .catch((err) => {
        console.warn(
          "Could not load open courses from database, using cached copy:",
          err.message
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const blocks = useMemo(
    () => groupIntoBlocks(openEntries),
    [openEntries]
  );

  const coloredBlocks = useMemo(
    () => applyBlockColors(blocks),
    [blocks]
  );

  const dayLayouts = useMemo(() => {
    const byDay = TIMETABLE_DAY_LABELS.map(() => []);

    coloredBlocks.forEach((block) => {
      if (byDay[block.day]) {
        byDay[block.day].push(block);
      }
    });

    return byDay.map(layoutDayLanes);
  }, [coloredBlocks]);

  const alwaysOpenSelected = courses.filter((label) =>
    ALWAYS_OPEN_COURSES.some(
      ({ code }) =>
        code ===
        normalizeCourseCode(extractCourseCodes(label)[0])
    )
  );

  const selectedDayLayouts = useMemo(() => {
    const selectedEntries = openEntries.filter((entry) =>
      courses.includes(courseLabel(entry))
    );

    const byDay = TIMETABLE_DAY_LABELS.map(() => []);

    applyBlockColors(groupIntoBlocks(selectedEntries)).forEach(
      (block) => {
        if (byDay[block.day]) {
          byDay[block.day].push(block);
        }
      }
    );

    return byDay.map(layoutDayLanes);
  }, [courses, openEntries]);

  const hasAnyBlocks = blocks.length > 0;

  const addSection = (entry) => {
    const label = courseLabel(entry);

    const blocked = checkPrerequisite(entry.code, entry.name);

    if (blocked) {
      setBlockedNotice(blocked);
      return;
    }

    const conflicting = checkTimeConflict(entry);

    if (conflicting) {
      setConflictNotice({
        newLabel: label,
        conflictingLabel: conflicting,
      });
      return;
    }

    setCourses((prev) =>
      prev.includes(label) ? prev : [...prev, label]
    );
  };

  const addManualCourse = (label) => {
    const blocked = checkCourseLabelPrerequisite(label);

    if (blocked) {
      setBlockedNotice(blocked);
      return;
    }

    const conflicting = checkLabelTimeConflict(label);

    if (conflicting) {
      setConflictNotice({
        newLabel: label,
        conflictingLabel: conflicting,
      });
      return;
    }

    setCourses((prev) =>
      prev.includes(label) ? prev : [...prev, label]
    );
  };

  const editManualCourse = (index, label) => {
    const blocked = checkCourseLabelPrerequisite(label);

    if (blocked) {
      setBlockedNotice(blocked);
      return;
    }

    const conflicting = checkLabelTimeConflict(label);

    if (conflicting) {
      setConflictNotice({
        newLabel: label,
        conflictingLabel: conflicting,
      });
      return;
    }

    setCourses((prev) =>
      prev.map((course, i) => (i === index ? label : course))
    );
  };

  const updateRecommendationStatus = async (
    recommendation,
    status
  ) => {
    if (!studentId || !recommendation?.id) return false;

    try {
      await axios.patch(
        `${API_BASE}/advisor-course-recommendations/${recommendation.id}`,
        { studentId, status }
      );

      setAdvisorRecommendations((prev) =>
        prev.filter((row) => row.id !== recommendation.id)
      );

      return true;
    } catch (err) {
      console.warn(
        `Could not mark recommendation as ${status}:`,
        err.message
      );

      setRecommendationStatus(
        err.response?.data?.error ||
          "Could not update the recommendation. Please try again."
      );

      return false;
    }
  };

  const handleAddRecommendation = async (recommendation) => {
    const rawCourseCode = String(
      recommendation?.course_code || ""
    ).trim();

    const courseCode =
      extractCourseCodes(rawCourseCode)[0] ||
      normalizeCourseCode(rawCourseCode);

    const embeddedSection =
      rawCourseCode.match(/\bSEC\.?\s*([A-Z0-9-]+)/i)?.[1] || "";

    const recommendedSection = String(
      recommendation?.section || embeddedSection
    ).trim();

    if (!courseCode) {
      setRecommendationStatus(
        "The recommended course code is invalid. Please ask your advisor to resend it."
      );
      return;
    }

    const alreadyAdded = courses.some(
      (label) =>
        normalizeCourseCode(extractCourseCodes(label)[0]) === courseCode
    );

    if (alreadyAdded) {
      setRecommendationStatus(
        `${courseCode} is already in your planner.`
      );
      return;
    }

    setRecommendationStatus("");

    const blocked = checkPrerequisite(
      courseCode,
      recommendation?.course_name || ""
    );

    if (blocked) {
      setBlockedNotice(blocked);
      return;
    }

    const matchingEntries = openEntries.filter(
      (entry) => normalizeCourseCode(entry.code) === courseCode
    );

    if (recommendedSection) {
      const matchingSection = matchingEntries.find(
        (entry) =>
          String(entry.section || "1").trim().toLowerCase() ===
          recommendedSection.toLowerCase()
      );

      if (!matchingSection) {
        setRecommendationStatus(
          `${courseCode} Sec.${recommendedSection} was not found in the published timetable. Please ask your advisor to check the section.`
        );
        return;
      }

      const label = courseLabel(matchingSection);
      const conflicting = checkTimeConflict(matchingSection);

      if (conflicting) {
        setConflictNotice({
          newLabel: label,
          conflictingLabel: conflicting,
        });
        return;
      }

      setCourses((prev) =>
        prev.includes(label) ? prev : [...prev, label]
      );

      await updateRecommendationStatus(recommendation, "accepted");
      return;
    }

    if (matchingEntries.length === 1) {
      const entry = matchingEntries[0];
      const label = courseLabel(entry);
      const conflicting = checkTimeConflict(entry);

      if (conflicting) {
        setConflictNotice({
          newLabel: label,
          conflictingLabel: conflicting,
        });
        return;
      }

      setCourses((prev) =>
        prev.includes(label) ? prev : [...prev, label]
      );

      await updateRecommendationStatus(recommendation, "accepted");
      return;
    }

    if (matchingEntries.length > 1) {
      setSectionPicker({
        code: courseCode,
        sections: matchingEntries,
        recommendation,
      });
      return;
    }

    setCourses((prev) =>
      prev.some(
        (label) =>
          normalizeCourseCode(extractCourseCodes(label)[0]) ===
          courseCode
      )
        ? prev
        : [...prev, courseCode]
    );

    await updateRecommendationStatus(recommendation, "accepted");
  };

  const handleDismissRecommendation = async (recommendation) => {
    setRecommendationStatus("");
    await updateRecommendationStatus(recommendation, "dismissed");
  };

  const handleBlockClick = (block) => {
    if (block.sections.length === 1) {
      addSection(block.sections[0]);
    } else {
      setSectionPicker(block);
    }
  };

  const pickSection = async (entry) => {
    const label = courseLabel(entry);
    const blocked = checkPrerequisite(entry.code, entry.name);

    if (blocked) {
      setBlockedNotice(blocked);
      setSectionPicker(null);
      return;
    }

    const conflicting = checkTimeConflict(entry);

    if (conflicting) {
      setConflictNotice({
        newLabel: label,
        conflictingLabel: conflicting,
      });
      setSectionPicker(null);
      return;
    }

    setCourses((prev) =>
      prev.includes(label) ? prev : [...prev, label]
    );

    const recommendation = sectionPicker?.recommendation;

    setSectionPicker(null);

    if (recommendation) {
      await updateRecommendationStatus(recommendation, "accepted");
    }
  };

  const handleSavePlan = async () => {
    if (!studentId) return;

    setSaveStatus("saving");

    try {
      const res = await axios.post(`${API_BASE}/registrations`, {
        studentId,
        courses,
      });

      setApproval(res.data?.approval || null);
      setSavedSnapshot(JSON.stringify([...courses].sort()));
      setSaveStatus("saved");

      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.warn("Could not save registration:", err.message);

      const firstBlocked = err.response?.data?.blockedCourses?.[0];

      if (firstBlocked) {
        setBlockedNotice({
          code: firstBlocked.courseCode,
          reason: `You have not yet passed: ${firstBlocked.missingCourses.join(", ")}`,
        });
      }

      setSaveStatus("error");
    }
  };

  const refreshApproval = async () => {
    if (!studentId) return;

    setApprovalRefreshing(true);

    try {
      const res = await axios.get(
        `${API_BASE}/registrations/${encodeURIComponent(studentId)}`
      );

      setApproval(res.data?.approval || null);
    } catch (err) {
      console.warn("Could not refresh plan status:", err.message);
    } finally {
      setApprovalRefreshing(false);
    }
  };

  const totalPlannedCredits = courses.reduce((sum, label) => {
    const code = normalizeCourseCode(extractCourseCodes(label)[0]);

    return sum + (courseCreditsByCode[code] || CREDITS_PER_COURSE);
  }, 0);

  const totalCreditsRequired =
    curriculum?.totalCreditsRequired ?? null;

  const creditLeft =
    totalCreditsRequired !== null
      ? Math.max(totalCreditsRequired - creditsEarned, 0)
      : null;

  const difficulty =
    aiInsights.difficulty || getDifficulty(courses.length);

  const balanceSuggestion =
    aiInsights.balanceSuggestion ||
    getBalanceSuggestion(courses.length, difficulty);

  const inProgressCodes = useMemo(() => {
    const set = new Set();

    courses.forEach((label) => {
      const code = extractCourseCodes(label)[0];
      if (code) set.add(code);
    });

    return set;
  }, [courses]);

  const courseLeftProgress = useMemo(
    () =>
      evaluateCurriculumProgress(
        curriculum,
        passedCodes,
        inProgressCodes
      ),
    [curriculum, passedCodes, inProgressCodes]
  );

  const courseLeftBlocks = useMemo(
    () =>
      filterBlocksForElectiveGroup(
        courseLeftProgress.blocks,
        electiveGroupId
      ),
    [courseLeftProgress, electiveGroupId]
  );

  const groupForLabel = (label) => {
    const code = extractCourseCodes(label)[0];
    return code ? courseGroupByCode[code] : null;
  };

  return (
    <div className="planner-page">
      <h2 className="planner-title">Semester Planner</h2>

      <div className="planner-tabs">
        {PLANNER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`planner-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "prereq-check" && (
        <StudentPrerequisites
          studentId={studentId}
          prereqGroupId={prereqGroupId}
        />
      )}

      {activeTab === "planner" && (
        <>
          {advisorRecommendations.length > 0 && (
            <div className="planner-card">
              <h3>Advisor Recommended Courses :</h3>

              <p className="sp-hint">
                Your advisor recommended the following course
                {advisorRecommendations.length === 1 ? "" : "s"} for you.
                You can add a recommendation to your planner or dismiss it.
              </p>

              <div className="planner-recommendation-list">
                {advisorRecommendations.map((recommendation) => (
                  <div
                    key={recommendation.id}
                    className="planner-recommendation-item"
                  >
                    <div>
                      <strong>
                        {recommendation.course_code}
                        {recommendation.course_name
                          ? ` - ${recommendation.course_name}`
                          : ""}
                      </strong>

                      {recommendation.message && (
                        <p className="sp-hint">
                          {recommendation.message}
                        </p>
                      )}
                    </div>

                    <div className="planner-card-head-actions">
                      <button
                        type="button"
                        className="planner-save-btn"
                        onClick={() =>
                          handleAddRecommendation(recommendation)
                        }
                      >
                        Add to Planner
                      </button>

                      <button
                        type="button"
                        className="planner-schedule-btn"
                        onClick={() =>
                          handleDismissRecommendation(recommendation)
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {recommendationStatus && (
                <span className="planner-save-error">
                  {recommendationStatus}
                </span>
              )}
            </div>
          )}

          <div className="planner-card planner-schedule-inline">
            <h3>My Class Schedule :</h3>

            {courses.length === 0 ? (
              <p className="planner-empty">
                No courses selected yet.
              </p>
            ) : (
              <div className="sp-grid-scroll">
                <div className="sp-grid">
                  <div className="sp-header">
                    <div className="sp-label-col" />
                    <div className="sp-time-track">
                      {TIMETABLE_TIME_LABELS.map((label) => (
                        <span key={label} className="sp-time-label">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
                    const { placed, laneCount } =
                      selectedDayLayouts[dayIndex];

                    if (dayIndex === 0 && placed.length === 0) {
                      return null;
                    }

                    const trackHeight =
                      ROW_PADDING * 2 + laneCount * LANE_HEIGHT;

                    return (
                      <div
                        className="sp-row"
                        key={dayLabel}
                        style={{ minHeight: `${trackHeight}px` }}
                      >
                        <div className="sp-label-col">{dayLabel}</div>

                        <div
                          className="sp-day-track"
                          style={{ height: `${trackHeight}px` }}
                        >
                          {placed.map((block) => {
                            const left = pctFromTime(block.start);
                            const width =
                              pctFromTime(block.end) - left;
                            const primary = block.sections[0];

                            return (
                              <div
                                key={block.key}
                                className="sp-block sp-schedule-block"
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  top: `${
                                    ROW_PADDING +
                                    block.lane * LANE_HEIGHT
                                  }px`,
                                  height: `${LANE_HEIGHT - 8}px`,
                                  background: block.color,
                                }}
                              >
                                <span className="sp-block-code">
                                  {courseLabel(primary)}
                                </span>
                                <span className="sp-block-name">
                                  {primary.name ||
                                    `${dayLabel} ${primary.start}–${primary.end}`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {alwaysOpenSelected.length > 0 && (
              <p className="planner-schedule-no-time">
                <strong>No class time (open every term):</strong>{" "}
                {alwaysOpenSelected.join(", ")}
              </p>
            )}
          </div>

          <div className="planner-card" ref={plannerCourseRef}>
            <div className="planner-card-head">
              <h3>Planner Course :</h3>

              <div className="planner-card-head-actions">
                <button
                  type="button"
                  className={`planner-approval-status planner-approval-${
                    approval?.status || "none"
                  }`}
                  onClick={refreshApproval}
                  disabled={approvalRefreshing || !studentId}
                  title="Click to check the latest status from your advisor"
                >
                  <RefreshCcw
                    size={13}
                    strokeWidth={2}
                    className={
                      approvalRefreshing ? "planner-approval-spin" : ""
                    }
                  />
                  Status:{" "}
                  {approval
                    ? APPROVAL_LABELS[approval.status] ||
                      approval.status
                    : "Pending Approval"}
                </button>

                <button
                  type="button"
                  className="planner-schedule-btn"
                  onClick={() => setShowCourseLeft(true)}
                >
                  Check course left
                </button>

                <button
                  type="button"
                  className="planner-schedule-btn planner-remove-all-btn"
                  disabled={courses.length === 0}
                  onClick={() => {
                    setCourses([]);
                    scrollToPlannerCourse();
                  }}
                >
                  Remove all
                </button>
              </div>
            </div>

            <EditableList
              items={courses}
              suggestions={[
                ...new Map(
                  openEntries
                    .filter((entry) => entry.code)
                    .map((entry) => [
                      entry.code,
                      {
                        code: entry.code,
                        name: entry.name || "",
                      },
                    ])
                ).values(),
              ]}
              placeholder="Add a course code (e.g. CSX-9004)"
              onAdd={addManualCourse}
              onEdit={editManualCourse}
              showEdit={false}
              onDelete={(index) => {
                setCourses((prev) =>
                  prev.filter((_, i) => i !== index)
                );
                scrollToPlannerCourse();
              }}
              renderLabel={(code, index) => {
                const group = groupForLabel(code);

                return `Selected Course ${index + 1} : ${code}${
                  group ? ` (${group})` : ""
                }`;
              }}
            />

            <div className="planner-save-row">
              <button
                type="button"
                className="planner-save-btn"
                onClick={handleSavePlan}
                disabled={saveStatus === "saving" || !studentId}
              >
                <Save size={16} strokeWidth={2} />
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "saved"
                  ? "Saved!"
                  : "Save"}
              </button>

              {saveStatus === "error" && (
                <span className="planner-save-error">
                  Could not save — please try again.
                </span>
              )}

              <UnsavedNotice
                show={
                  saveStatus !== "saving" &&
                  savedSnapshot !== null &&
                  JSON.stringify([...courses].sort()) !== savedSnapshot
                }
              />
            </div>
          </div>

          <div className="planner-card">
            <h3>Which courses are open :</h3>

            {!hasAnyBlocks ? (
              <p className="planner-empty">
                No open courses published yet — check back once the admin
                posts the course timetable.
              </p>
            ) : (
              <>
                <div className="sp-grid-scroll">
                  <div className="sp-grid">
                    <div className="sp-header">
                      <div className="sp-label-col" />
                      <div className="sp-time-track">
                        {TIMETABLE_TIME_LABELS.map((label) => (
                          <span key={label} className="sp-time-label">
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
                      const { placed, laneCount } = dayLayouts[dayIndex];

                      if (dayIndex === 0 && placed.length === 0) {
                        return null;
                      }

                      const trackHeight =
                        ROW_PADDING * 2 + laneCount * LANE_HEIGHT;

                      return (
                        <div
                          className="sp-row"
                          key={dayLabel}
                          style={{ minHeight: `${trackHeight}px` }}
                        >
                          <div className="sp-label-col">
                            {dayLabel}
                          </div>

                          <div
                            className="sp-day-track"
                            style={{ height: `${trackHeight}px` }}
                          >
                            {placed.map((block) => {
                              const left = pctFromTime(block.start);
                              const width =
                                pctFromTime(block.end) - left;
                              const top =
                                ROW_PADDING +
                                block.lane * LANE_HEIGHT;

                              const alreadyAdded = block.sections.every(
                                (section) =>
                                  courses.includes(courseLabel(section))
                              );

                              const primary = block.sections[0];

                              return (
                                <button
                                  type="button"
                                  key={block.key}
                                  className={`sp-block${
                                    alreadyAdded ? " is-added" : ""
                                  }`}
                                  style={{
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    top: `${top}px`,
                                    height: `${LANE_HEIGHT - 8}px`,
                                    background: block.color,
                                  }}
                                  onClick={() => handleBlockClick(block)}
                                  title={
                                    alreadyAdded
                                      ? "Already added"
                                      : "Click to add"
                                  }
                                >
                                  <span className="sp-block-code">
                                    {block.code}
                                    {block.sections.length > 1
                                      ? ` (${block.sections.length} secs)`
                                      : ""}
                                  </span>

                                  {primary.name && (
                                    <span className="sp-block-name">
                                      {primary.name}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="sp-always-open">
                  <span className="sp-always-open-label">
                    Open every term (not on the timetable):
                  </span>

                  {ALWAYS_OPEN_COURSES.map(({ code, name }) => {
                    const added = courses.some(
                      (label) =>
                        normalizeCourseCode(
                          extractCourseCodes(label)[0]
                        ) === code
                    );

                    return (
                      <button
                        type="button"
                        key={code}
                        className="sp-always-open-btn"
                        disabled={added}
                        onClick={() => addManualCourse(code)}
                      >
                        {code} {name}
                        {added ? " · Added" : ""}
                      </button>
                    );
                  })}
                </div>

                <p className="sp-hint">
                  Click a course on the timetable to add it — if a course
                  has more than one section at the same time, you'll be
                  asked which section to join.
                </p>
              </>
            )}
          </div>

          <div className="planner-row">
            <span>Total credit in semester : {totalPlannedCredits}</span>
            <span>
              Credit Left: {creditLeft !== null ? creditLeft : "—"}
            </span>
          </div>

          <div className="planner-row">
            <span>
              Difficulty indicator : {difficulty}
              {insightsLoading && " (updating…)"}
            </span>
          </div>

          <div className="planner-row">
            <span>
              Balance suggestion : {balanceSuggestion}
              {insightsLoading && " (updating…)"}
            </span>
          </div>
        </>
      )}

      {sectionPicker && (
        <div
          className="sp-modal-backdrop"
          onClick={() => setSectionPicker(null)}
        >
          <div
            className="sp-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sp-modal-head">
              <h4>Choose a section — {sectionPicker.code}</h4>

              <button
                type="button"
                className="sp-modal-close"
                onClick={() => setSectionPicker(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="sp-section-grid">
              {sortSections(sectionPicker.sections).map((entry) => {
                const label = courseLabel(entry);
                const added = courses.includes(label);

                return (
                  <button
                    type="button"
                    key={entry.id}
                    className={`sp-section-box${
                      added ? " is-added" : ""
                    }`}
                    onClick={() => pickSection(entry)}
                    disabled={added}
                  >
                    <strong className="sp-section-box-title">
                      Sec. {entry.section || "1"}
                    </strong>

                    <span className="sp-section-schedule">
                      {TIMETABLE_DAY_LABELS[entry.day]} {entry.start}–
                      {entry.end}
                    </span>

                    {added && (
                      <span className="sp-section-added-tag">
                        Added
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {conflictNotice && (
        <div
          className="sp-modal-backdrop"
          onClick={() => setConflictNotice(null)}
        >
          <div
            className="sp-modal planner-blocked-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sp-modal-head">
              <h4>
                <Clock size={18} strokeWidth={2} /> Schedule Conflict
              </h4>

              <button
                type="button"
                className="sp-modal-close"
                onClick={() => setConflictNotice(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p className="planner-blocked-reason">
              <strong>{conflictNotice.newLabel}</strong> overlaps in time
              with{" "}
              <strong>{conflictNotice.conflictingLabel}</strong> that you
              already added. Please remove the conflicting course first,
              or choose a different section.
            </p>

            <button
              type="button"
              className="planner-blocked-ok"
              onClick={() => setConflictNotice(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {blockedNotice && (
        <div
          className="sp-modal-backdrop"
          onClick={() => setBlockedNotice(null)}
        >
          <div
            className="sp-modal planner-blocked-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sp-modal-head">
              <h4>
                <AlertTriangle size={18} strokeWidth={2} /> Can&apos;t add{" "}
                {blockedNotice.code}
              </h4>

              <button
                type="button"
                className="sp-modal-close"
                onClick={() => setBlockedNotice(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p className="planner-blocked-reason">
              {blockedNotice.reason}
            </p>

            <button
              type="button"
              className="planner-blocked-ok"
              onClick={() => setBlockedNotice(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {showCourseLeft && (
        <div
          className="sp-modal-backdrop"
          onClick={() => setShowCourseLeft(false)}
        >
          <div
            className="sp-modal planner-course-left-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sp-modal-head">
              <h4>Course Left</h4>

              <button
                type="button"
                className="sp-modal-close"
                onClick={() => setShowCourseLeft(false)}
              >
                <X size={18} />
              </button>
            </div>

            {!curriculum ? (
              <p className="planner-empty">
                No curriculum requirements found for your batch yet —
                please check back once Admin uploads them.
              </p>
            ) : (
              <div className="planner-course-left-groups">
                {!electiveGroupId && (
                  <p className="planner-course-left-hint">
                    Tip: pick your Major Elective group on the Goal and
                    Career page to only see your chosen group here.
                  </p>
                )}

                {courseLeftBlocks.map((block) => {
                  const groupKey = statusOverrideGroupKey(block);
                  const rows = mergeElectiveGroupRows(
                    block.courses,
                    groupKey,
                    electiveCourses
                  );

                  const groupCreditsEarned =
                    electiveGroupCreditsEarned(rows);

                  const rowsCompletedCount = rows.filter(
                    (row) => row.status === "completed"
                  ).length;

                  const blockSatisfied =
                    groupCreditsEarned >= (block.creditsRequired || 0);

                  return (
                    <div
                      key={block.id}
                      className="planner-course-left-block"
                    >
                      <div className="planner-course-left-block-head">
                        <strong>{block.label}</strong>

                        <span
                          className={`planner-course-left-status${
                            blockSatisfied ? " done" : ""
                          }`}
                        >
                          {block.courses.length === 0
                            ? `${groupCreditsEarned}/${block.creditsRequired ?? "—"} credits`
                            : block.mode === "all"
                            ? `${rowsCompletedCount}/${block.courses.length} completed`
                            : `${rowsCompletedCount}/${block.chooseCount} chosen (choose ${block.chooseCount} of ${block.courses.length})`}
                        </span>
                      </div>

                      <span className="planner-course-left-group-tag">
                        {block.group}
                      </span>

                      {rows.length === 0 ? (
                        <p className="planner-course-left-open">
                          Open selection — any course counts toward this
                          group.
                        </p>
                      ) : (
                        <ul className="planner-course-left-course-list">
                          {rows.map((course) => (
                            <li
                              key={course.code}
                              className={`course-status-${course.status}`}
                            >
                              <span>
                                {course.code} {course.name}
                              </span>

                              <span className="planner-course-left-tag">
                                {course.status === "completed" &&
                                  "Completed"}
                                {course.status === "in-progress" &&
                                  "In Progress"}
                                {course.status === "not-taken" &&
                                  "Not Taken"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Planner;
