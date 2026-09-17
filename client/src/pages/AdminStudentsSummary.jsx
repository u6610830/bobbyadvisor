import "./AdminStudentsSummary.css";

// Static placeholder aggregate stats — swap for real queries later.
const COURSE_DEMAND = [
  { code: "CSX-9010", count: 45 },
  { code: "CSX-9011", count: 47 },
];

const CAREER_INTERESTS = [
  { title: "Software Engineer", count: 45 },
  { title: "AI Engineer", count: 47 },
];

const GRADUATION_RATES = [
  { term: "2/2026", count: 65 },
  { term: "1/2027", count: 77 },
];

function AdminStudentsSummary() {
  return (
    <div className="admin-summary-page">
      <span className="admin-summary-title-pill">Report &amp; Analytics</span>

      <div className="admin-summary-card">
        <h3>Course demand statistics</h3>
        <p>Many student are interest to register :</p>
        <ul>
          {COURSE_DEMAND.map(({ code, count }) => (
            <li key={code}>
              {code} &nbsp; {count} people
            </li>
          ))}
        </ul>
      </div>

      <div className="admin-summary-card">
        <h3>Popular career interests</h3>
        <p>Many student are want to be :</p>
        <ul>
          {CAREER_INTERESTS.map(({ title, count }) => (
            <li key={title}>
              {title} &nbsp; {count} people
            </li>
          ))}
        </ul>
      </div>

      <div className="admin-summary-card">
        <h3>Graduation rates</h3>
        <p>Many student are graduation :</p>
        <ul>
          {GRADUATION_RATES.map(({ term, count }) => (
            <li key={term}>
              In &ldquo;{term}&rdquo; &nbsp; {count} people
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default AdminStudentsSummary;
