/**
 * Âm lịch Việt Nam — port từ lasotuvi/Lich_HND.py.
 * (c) 2006 Ho Ngoc Duc. Astronomical algorithms from "Astronomical Algorithms",
 * Jean Meeus, 1998. Bản gốc thuộc lasotuvi (MIT, doanguyen).
 */
import { pyint } from "../../lib/py.js";

/** Số ngày Julius (nguyên) của ngày dd/mm/yyyy. */
export function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = pyint((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + pyint((153 * m + 2) / 5) + 365 * y + pyint(y / 4) - pyint(y / 100) + pyint(y / 400) - 32045;
  if (jd < 2299161) {
    jd = dd + pyint((153 * m + 2) / 5) + 365 * y + pyint(y / 4) - 32083;
  }
  return jd;
}

/** Số ngày Julius → [ngày, tháng, năm]. */
export function jdToDate(jd: number): [number, number, number] {
  let b: number;
  let c: number;
  if (jd > 2299160) {
    const a = jd + 32044;
    b = pyint((4 * a + 3) / 146097);
    c = a - pyint((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = pyint((4 * c + 3) / 1461);
  const e = c - pyint((1461 * d) / 4);
  const m = pyint((5 * e + 2) / 153);
  const day = e - pyint((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * pyint(m / 10);
  const year = b * 100 + d - 4800 + pyint(m / 10);
  return [day, month, year];
}

/** Thời điểm sóc thứ k tính từ sóc 1/1/1900. */
export function newMoon(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat: number;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  return Jd1 + C1 - deltat;
}

/** Vị trí mặt trời (0..11, mỗi khoảng 30°) lúc nửa đêm giờ địa phương của ngày jdn. */
export function getSunLongitude(jdn: number, timeZone: number): number {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const T2 = T ** 2;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = L0 + DL;
  const omega = 125.04 - 1934.136 * T;
  L = L - 0.00569 - 0.00478 * Math.sin(omega * dr);
  L = L * dr;
  L = L - Math.PI * 2 * Math.floor(L / (Math.PI * 2));
  return pyint((L / Math.PI) * 6);
}

export function getNewMoonDay(k: number, timeZone: number): number {
  return pyint(newMoon(k) + 0.5 + timeZone / 24);
}

/** Ngày bắt đầu tháng 11 âm lịch của năm yy. */
export function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = pyint(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) nm = getNewMoonDay(k - 1, timeZone);
  return nm;
}

/** Vị trí tháng nhuận sau tháng bắt đầu từ ngày a11. */
export function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = pyint((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  for (;;) {
    last = arc;
    i += 1;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
    if (!(arc !== last && i < 14)) break;
  }
  return i - 1;
}

/** Dương lịch → âm lịch: [ngày, tháng, năm, nhuận(0|1)]. */
export function S2L(dd: number, mm: number, yy: number, timeZone = 7): [number, number, number, number] {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = pyint((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, timeZone);
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = pyint((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth = lunarMonth - 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return [lunarDay, lunarMonth, lunarYear, lunarLeap];
}

/** Âm lịch → dương lịch: [ngày, tháng, năm] ([0,0,0] nếu tháng nhuận không tồn tại). */
export function L2S(
  lunarD: number,
  lunarM: number,
  lunarY: number,
  lunarLeap: number | boolean,
  tZ = 7,
): [number, number, number] {
  let a11: number;
  let b11: number;
  if (lunarM < 11) {
    a11 = getLunarMonth11(lunarY - 1, tZ);
    b11 = getLunarMonth11(lunarY, tZ);
  } else {
    a11 = getLunarMonth11(lunarY, tZ);
    b11 = getLunarMonth11(lunarY + 1, tZ);
  }
  const k = pyint(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarM - 11;
  if (off < 0) off += 12;
  const leap = Number(lunarLeap);
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, tZ);
    let leapM = leapOff - 2;
    if (leapM < 0) leapM += 12;
    if (leap !== 0 && lunarM !== leapM) return [0, 0, 0];
    else if (leap !== 0 || off >= leapOff) off += 1;
  }
  const monthStart = getNewMoonDay(k + off, tZ);
  return jdToDate(monthStart + lunarD - 1);
}
