// Chinese statutory holiday dates used for DeepSeek peak pricing (docs/14-gateway-settings.md H3).
// Source: State Council General Office 放假 ranges only — makeup work weekends stay off-peak via
// officialPeak's Saturday/Sunday check (DeepSeek: weekends and statutory holidays are off-peak).
// Maintain: when a new 国办发明电 year is published, append that year's 放假 dates here and bump tests.
// Env EMPLOYEE_CREDIT_HOLIDAYS may add temporary extra YYYY-MM-DD days; it does not replace this list.

const SOURCE_2026 = 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'; // 国办发明电〔2025〕7号
const SOURCE_2027 = 'https://www.gov.cn/zhengce/content/202611/content_7085101.htm'; // 国办发明电〔2026〕10号

function days(year, month, from, to) {
  const out = [];
  for (let d = from; d <= to; d++) out.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return out;
}

/** All 放假 calendar days for years we ship in-code. */
export const CHINA_HOLIDAY_YEARS = {
  2026: {
    source: SOURCE_2026, notice: '国办发明电〔2025〕7号',
    days: [
      ...days(2026, 1, 1, 3),   // 元旦
      ...days(2026, 2, 15, 23), // 春节
      ...days(2026, 4, 4, 6),   // 清明
      ...days(2026, 5, 1, 5),   // 劳动节
      ...days(2026, 6, 19, 21), // 端午
      ...days(2026, 9, 25, 27), // 中秋
      ...days(2026, 10, 1, 7)   // 国庆
    ]
  },
  2027: {
    source: SOURCE_2027, notice: '国办发明电〔2026〕10号',
    days: [
      ...days(2027, 1, 1, 3),   // 元旦
      ...days(2027, 2, 5, 13),  // 春节
      ...days(2027, 4, 3, 5),   // 清明
      ...days(2027, 5, 1, 5),   // 劳动节
      '2027-06-09',            // 端午
      '2027-09-15',            // 中秋
      ...days(2027, 10, 1, 7)   // 国庆
    ]
  }
};

export const CHINA_HOLIDAYS = new Set(Object.values(CHINA_HOLIDAY_YEARS).flatMap(y => y.days));

/** Merge built-in holidays with optional env extras (temporary add-days only). */
export function mergeHolidays(extra = []) {
  const out = new Set(CHINA_HOLIDAYS);
  for (const d of extra) if (d) out.add(String(d).trim());
  return out;
}

export function holidayYearsMeta() {
  return Object.entries(CHINA_HOLIDAY_YEARS).map(([year, y]) => ({
    year: Number(year), notice: y.notice, source: y.source, days: y.days.length
  }));
}
