// The three prerequisite groups from the university's course-prerequisite
// sheet. Which prerequisite text applies to a course depends on which
// group the student's intake batch falls into (e.g. batch 62-64 follow one
// curriculum revision, 65-1/65-2 another, 65-3 onwards a newer one).
//
// `id` is the column key stored in Supabase (course_prerequisites.g1_text /
// g2_text / g3_text). `label` is what admins/students see on screen.
export const PREREQ_GROUPS = [
  { id: "g1", label: "Batch 62 - 64 (Prerequisite for 621 - 643)" },
  { id: "g2", label: "Batch 65/1, 65/2 (Prerequisite for 651 - 652)" },
  { id: "g3", label: "Batch 65/3 onwards (Prerequisite for 653 onwards)" },
];

export function getPrereqGroupLabel(groupId) {
  return PREREQ_GROUPS.find((g) => g.id === groupId)?.label ?? groupId;
}
