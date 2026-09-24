import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Users,
  UserCog,
  ClipboardList,
  Clock,
  TrendingUp,
  GraduationCap,
  RefreshCw,
  Search,
  ChevronRight,
} from "lucide-react";

import "./AdminDashboard.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const TOP_COURSES_IN_CHART = 10;
const MAX_TERM_BUCKET = 8; // 8 = "8+ terms"

const STATUS_LABELS = {
  no_grades: "No grades uploaded",
  no_curriculum: "No curriculum",
};

function termLabel(terms) {
  if (terms === 0) return "Ready";
  if (terms >= MAX_TERM_BUCKET) return `${MAX_TERM_BUCKET}+ terms`;
  return `${terms} term${terms === 1 ? "" : "s"}`;
}

function StatCard({ icon: Icon, label, value, hint, onClick, tone = "" }) {
  return (
    <button type="button" className={`dash-stat ${tone}`} onClick={onClick}>
      <span className="dash-stat-icon">
        <Icon size={20} />
      </span>
      <span className="dash-stat-body">
        <span className="dash-stat-value">{value}</span>
        <span className="dash-stat-label">{label}</span>
        {hint && <span className="dash-stat-hint">{hint}</span>}
      </span>
      <ChevronRight size={16} className="dash-stat-arrow" />
    </button>
  );
}

// Admin > Dashboard. All numbers come from GET /admin-dashboard in
// server/server.js. Cards, chart bars and table rows link to the admin
// page that holds the details.
function AdminDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [termFilter, setTermFilter] = useState(null); // number | "no_data" | null
  const [studentQuery, setStudentQuery] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await axios.get(`${API_BASE}/admin-dashboard`);
      setData(res.data);
    } catch (err) {
      console.error("Failed to load admin dashboard:", err);
      setError(err.response?.data?.error || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const go = (page, extra) => onNavigate?.(page, extra);

  // ---- Course demand ----
  const courseDemand = data?.courseDemand || [];
  const topCourses = courseDemand.slice(0, TOP_COURSES_IN_CHART);
  const maxDemand = Math.max(1, ...topCourses.map((c) => c.total));
  const filteredCourses = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    if (!q) return courseDemand;
    return courseDemand.filter(
      (c) => c.code.toLowerCase().includes(q) || String(c.title || "").toLowerCase().includes(q)
    );
  }, [courseDemand, courseQuery]);

  // ---- Graduation ----
  const graduation = data?.graduation || [];
  const termBuckets = useMemo(() => {
    const buckets = Array.from({ length: MAX_TERM_BUCKET + 1 }, (_, terms) => ({ terms, count: 0 }));
    graduation.forEach((s) => {
      if (s.status !== "ok") return;
      buckets[Math.min(s.termsLeft, MAX_TERM_BUCKET)].count += 1;
    });
    return buckets;
  }, [graduation]);
  const noDataCount = graduation.filter((s) => s.status !== "ok").length;
  const maxBucket = Math.max(1, ...termBuckets.map((b) => b.count), noDataCount);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return graduation
      .filter((s) => {
        if (termFilter === "no_data") return s.status !== "ok";
        if (termFilter !== null) return s.status === "ok" && Math.min(s.termsLeft, MAX_TERM_BUCKET) === termFilter;
        return true;
      })
      .filter(
        (s) =>
          !q ||
          String(s.studentId).toLowerCase().includes(q) ||
          String(s.name || "").toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (a.status !== "ok" || b.status !== "ok") return a.status === "ok" ? -1 : b.status === "ok" ? 1 : 0;
        return a.remaining - b.remaining;
      });
  }, [graduation, termFilter, studentQuery]);

  const overview = data?.overview;
  const approvals = overview?.approvals;
  const approvalTotal = approvals ? approvals.pending + approvals.approved + approvals.rejected : 0;
  const pct = (n) => (approvalTotal ? (n / approvalTotal) * 100 : 0);

  return (
    <div className="dash-page">
      <div className="dash-head">
        <span className="dash-title-pill">Dashboard</span>
        <button type="button" className="dash-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {error && <div className="dash-error">{error}</div>}
      {loading && !data && <p className="dash-muted">Loading dashboard…</p>}

      {overview && (
        <>
          {/* ---------------- Overview ---------------- */}
          <section className="dash-stats">
            <StatCard
              icon={Users}
              label="Students"
              value={overview.students}
              hint={overview.studentsWithoutAdvisor ? `${overview.studentsWithoutAdvisor} without advisor` : "All have an advisor"}
              onClick={() => go("manage-users")}
            />
            <StatCard
              icon={UserCog}
              label="Advisors"
              value={overview.advisors}
              onClick={() => go("manage-users")}
            />
            <StatCard
              icon={Clock}
              label="Plans waiting for approval"
              value={approvals ? approvals.pending : "—"}
              hint={approvals ? `${approvals.approved} approved · ${approvals.rejected} rejected` : "Approval table not found"}
              tone={approvals?.pending ? "warn" : ""}
              onClick={() => go("registrations")}
            />
            <StatCard
              icon={ClipboardList}
              label="Students with a plan"
              value={overview.studentsWithPlan}
              hint={`${overview.registrations} course registrations`}
              onClick={() => go("registrations")}
            />
            <StatCard
              icon={TrendingUp}
              label="Course requests"
              value={overview.requests}
              hint="Courses not on the timetable"
              onClick={() => go("high-demand")}
            />
          </section>

          {approvals && approvalTotal > 0 && (
            <section className="dash-card">
              <h3>Plan approval status</h3>
              <div className="dash-approval">
                <div
                  className="dash-donut"
                  style={{
                    background: `conic-gradient(#F59E0B 0 ${pct(approvals.pending)}%, #22C55E 0 ${
                      pct(approvals.pending) + pct(approvals.approved)
                    }%, #EF4444 0 100%)`,
                  }}
                >
                  <span>{approvalTotal}</span>
                </div>
                <ul className="dash-legend">
                  <li><i style={{ background: "#F59E0B" }} /> Pending <b>{approvals.pending}</b></li>
                  <li><i style={{ background: "#22C55E" }} /> Approved <b>{approvals.approved}</b></li>
                  <li><i style={{ background: "#EF4444" }} /> Rejected <b>{approvals.rejected}</b></li>
                </ul>
              </div>
            </section>
          )}

          {/* ---------------- Course demand ---------------- */}
          <section className="dash-card">
            <div className="dash-card-head">
              <h3>Course demand</h3>
              <div className="dash-links">
                <button type="button" onClick={() => go("registrations")}>Course Registrations</button>
                <button type="button" onClick={() => go("high-demand")}>Requested Courses</button>
              </div>
            </div>
            <p className="dash-muted">
              Number of students per course — registered (on the timetable) and requested (not open yet).
            </p>

            {courseDemand.length === 0 ? (
              <p className="dash-muted">No registrations or requests yet.</p>
            ) : (
              <>
                <div className="dash-legend-inline">
                  <span><i className="reg" /> Registered</span>
                  <span><i className="req" /> Requested</span>
                </div>
                <div className="dash-hbars">
                  {topCourses.map((c) => (
                    <button
                      type="button"
                      key={c.code}
                      className="dash-hbar-row"
                      onClick={() => go(c.registered > 0 ? "registrations" : "high-demand")}
                      title={`${c.code} ${c.title || ""}`}
                    >
                      <span className="dash-hbar-label">{c.code}</span>
                      <span className="dash-hbar-track">
                        <span className="dash-hbar reg" style={{ width: `${(c.registered / maxDemand) * 100}%` }} />
                        <span className="dash-hbar req" style={{ width: `${(c.requested / maxDemand) * 100}%` }} />
                      </span>
                      <span className="dash-hbar-value">{c.total}</span>
                    </button>
                  ))}
                </div>

                <div className="dash-search">
                  <Search size={15} />
                  <input
                    placeholder="Search course code or title"
                    value={courseQuery}
                    onChange={(e) => setCourseQuery(e.target.value)}
                  />
                </div>
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>Course</th>
                        <th>Title</th>
                        <th className="num">Registered</th>
                        <th>By section</th>
                        <th className="num">Requested</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCourses.map((c) => (
                        <tr key={c.code} onClick={() => go(c.registered > 0 ? "registrations" : "high-demand")}>
                          <td><strong>{c.code}</strong></td>
                          <td>{c.title || "—"}</td>
                          <td className="num">{c.registered}</td>
                          <td className="dash-sections">
                            {c.sections.length
                              ? c.sections.map((s) => `Sec.${s.section}: ${s.count}`).join(" · ")
                              : "—"}
                          </td>
                          <td className="num">{c.requested}</td>
                          <td className="num"><b>{c.total}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* ---------------- Graduation ---------------- */}
          <section className="dash-card">
            <div className="dash-card-head">
              <h3>
                <GraduationCap size={18} /> Estimated terms to graduate
              </h3>
              <div className="dash-links">
                <button type="button" onClick={() => go("graduation-check")}>Graduation Check</button>
              </div>
            </div>
            <p className="dash-muted">
              Terms left = remaining credits ÷ {data.creditsPerTerm} (rounded up). Remaining credits = the
              curriculum's total credits minus credits already passed. Click a bar to filter the list.
            </p>

            <div className="dash-vbars">
              {termBuckets.map((b) => (
                <button
                  type="button"
                  key={b.terms}
                  className={`dash-vbar-col ${termFilter === b.terms ? "active" : ""} ${b.terms === 0 ? "ready" : ""}`}
                  onClick={() => setTermFilter(termFilter === b.terms ? null : b.terms)}
                >
                  <span className="dash-vbar-value">{b.count}</span>
                  <span className="dash-vbar-track">
                    <span className="dash-vbar" style={{ height: `${(b.count / maxBucket) * 100}%` }} />
                  </span>
                  <span className="dash-vbar-label">{termLabel(b.terms)}</span>
                </button>
              ))}
              {noDataCount > 0 && (
                <button
                  type="button"
                  className={`dash-vbar-col nodata ${termFilter === "no_data" ? "active" : ""}`}
                  onClick={() => setTermFilter(termFilter === "no_data" ? null : "no_data")}
                >
                  <span className="dash-vbar-value">{noDataCount}</span>
                  <span className="dash-vbar-track">
                    <span className="dash-vbar" style={{ height: `${(noDataCount / maxBucket) * 100}%` }} />
                  </span>
                  <span className="dash-vbar-label">No data</span>
                </button>
              )}
            </div>

            <div className="dash-filter-row">
              <div className="dash-search">
                <Search size={15} />
                <input
                  placeholder="Search student ID or name"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                />
              </div>
              {termFilter !== null && (
                <button type="button" className="dash-clear" onClick={() => setTermFilter(null)}>
                  Showing: {termFilter === "no_data" ? "No data" : termLabel(termFilter)} ✕
                </button>
              )}
            </div>

            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Curriculum</th>
                    <th className="num">Passed</th>
                    <th className="num">Remaining</th>
                    <th>Terms left</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.studentId} onClick={() => go("graduation-check", { studentId: s.studentId })}>
                      <td><strong>{s.studentId}</strong></td>
                      <td>{s.name || "—"}</td>
                      <td>{s.curriculumYear || "—"}</td>
                      <td className="num">{s.status === "no_curriculum" ? "—" : `${s.earned}${s.totalRequired ? ` / ${s.totalRequired}` : ""}`}</td>
                      <td className="num">{s.status === "ok" ? s.remaining : "—"}</td>
                      <td>
                        {s.status === "ok" ? (
                          <span className={`dash-pill ${s.termsLeft === 0 ? "ready" : s.termsLeft <= 2 ? "soon" : ""}`}>
                            {s.termsLeft === 0 ? "Ready to graduate" : `${s.termsLeft} term${s.termsLeft === 1 ? "" : "s"}`}
                          </span>
                        ) : (
                          <span className="dash-pill nodata">{STATUS_LABELS[s.status]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredStudents.length === 0 && (
                    <tr className="empty"><td colSpan={6}>No students match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AdminDashboard;