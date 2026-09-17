import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// Goals & Career Interest live on the student's own row in the database
// (see server/supabase_goals_career.sql) so Course Recommendation and
// Bobby Advisor can read them, and so they follow the student to any
// device instead of being stuck in one browser's localStorage.

export async function getStudentGoalsCareer(studentId) {
  const res = await axios.get(`${API_BASE}/students/${encodeURIComponent(studentId)}`);
  const student = res.data?.student || {};
  return {
    goals: Array.isArray(student.goals) ? student.goals : [],
    careerInterests: Array.isArray(student.career_interests) ? student.career_interests : [],
  };
}

export async function setStudentGoalsCareer(studentId, { goals, careerInterests }) {
  const res = await axios.put(`${API_BASE}/students/${encodeURIComponent(studentId)}/goals`, {
    goals,
    career_interests: careerInterests,
  });
  const student = res.data?.student || {};
  return {
    goals: Array.isArray(student.goals) ? student.goals : [],
    careerInterests: Array.isArray(student.career_interests) ? student.career_interests : [],
  };
}
