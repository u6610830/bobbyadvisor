// Computes the "current" academic semester label (e.g. "1/2026") from
// today's real-world date, per the school's term calendar:
//
//   - June through October    -> term 1 of the current calendar year
//   - November through March  -> term 2, labeled with the year term 2
//     started in (so Nov/Dec of year Y and Jan/Feb/Mar of year Y+1 are
//     both "2/Y")
//   - April / May are the gap between term 2 ending and term 1
//     starting — there's no term running yet, so this is treated as a
//     continuation of the term that just ended ("2/<previous year>").
export function getCurrentSemester(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();

  if (month >= 6 && month <= 10) {
    return `1/${year}`;
  }

  if (month === 11 || month === 12) {
    return `2/${year}`;
  }

  // January through May all fall in (or right after) the term-2 window
  // that started the previous November.
  return `2/${year - 1}`;
}
