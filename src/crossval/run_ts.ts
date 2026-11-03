// Runner: chạy engine TS thật (tuvi.ts của repo tuvi-ai) standalone,
// xuất JSON lá số cho cùng bộ input với engine Python để đối chiếu.
import { generateTuviChart } from "./tuvi_engine_ts";

// 5 ca mẫu — TRÙNG với SAMPLES trong test_engine.py (Python)
// gio_sinh Python 1..12 = Tý..Hợi  ->  chi giờ
const BRANCH = ["Tý","Sửu","Dần","Mão","Thìn","Tỵ","Ngọ","Mùi","Thân","Dậu","Tuất","Hợi"];
const samples = [
  { ngay:15, thang:8,  nam:1990, g:7,  gt:"male",   },
  { ngay:1,  thang:1,  nam:2000, g:1,  gt:"female", },
  { ngay:29, thang:12, nam:1985, g:12, gt:"male",   },
  { ngay:10, thang:6,  nam:1975, g:5,  gt:"female", },
  { ngay:20, thang:3,  nam:2010, g:9,  gt:"male",   },
];

const out = samples.map(s => {
  const pad = (n:number)=>String(n).padStart(2,"0");
  const chart = generateTuviChart({
    fullName: "Test",
    birthDate: `${s.nam}-${pad(s.thang)}-${pad(s.ngay)}`,
    birthHour: BRANCH[s.g-1],           // chi giờ
    gender: s.gt as "male"|"female",
    calendarType: "solar",
  });
  return {
    key: `${s.ngay}/${s.thang}/${s.nam}-g${s.g}`,
    lunarDate: chart.lunarDate,
    heavenlyStem: chart.heavenlyStem,
    earthlyBranch: chart.earthlyBranch,
    element: chart.element,
    palaces: chart.palaces.map(p => ({
      name: p.name,
      position: p.position,
      element: p.element,
      main: p.mainStars.map(x=>x.name),
      secondary: p.secondaryStars.map(x=>x.name),
    })),
  };
});

console.log(JSON.stringify(out, null, 2));
