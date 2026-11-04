/**
 * Nhận diện cách cục — port từ src/cach_cuc.py (gốc: ziwei-doushu lib/ziwei/patterns.ts, MIT).
 *
 * Mỗi cách có ba tầng: điều kiện bắt buộc / điểm cộng / yếu tố phá cách, kèm thư tịch.
 * Đọc lá số lasotuvi: tên sao Việt, độ sáng từ `dacTinh` (M/V/Đ = sáng, H = hãm),
 * Tứ Hóa từ trường `hoa`. Câu chữ định mệnh trong cổ thư được viết lại thành lưu ý.
 */
import { pymod, pysorted, pytitle } from "../lib/py.js";
import type { Chart, Palace, Star } from "./tuviEngine.js";

export const DAI_CAT = "dai_cat";
export const CAT = "cat";
export const TRUNG = "trung_binh";
export const LUU_Y = "can_luu_y";
export type MucCachCuc = typeof DAI_CAT | typeof CAT | typeof TRUNG | typeof LUU_Y;

const TOAN_THU = "Tử Vi Đẩu Số Toàn Thư";
const TOAN_TAP = "Tử Vi Đẩu Số Toàn Tập";
const COT_TUY = "Cốt Tủy Phú";

const SAT_CUNG = ["kình dương", "đà la", "hỏa tinh", "linh tinh"];
const KHONG_KIEP = ["địa không", "địa kiếp"];
const BIG = new Set(["tử vi", "thiên cơ", "thái dương", "vũ khúc", "thiên đồng", "liêm trinh", "thiên phủ",
  "thái âm", "tham lang", "cự môn", "thiên tướng", "thiên lương", "thất sát", "phá quân"]);

export interface CachCuc {
  ten: string;
  muc: MucCachCuc;
  mo_ta: string;
  cung: string[];
  dieu_kien: { bat_buoc: string[]; diem_cong: string[]; pha_cach: string[] };
  nguon: string;
}

/** Cung trên lá số với truy vấn sao theo tên thường. */
class P {
  i: number;
  cung: string | null;
  branch: string;
  stars: Map<string, Star>;

  constructor(raw: Palace) {
    this.i = raw.index;
    this.cung = raw.cung;
    this.branch = raw.branch;
    this.stars = new Map();
    for (const s of raw.stars) this.stars.set((s.name || "").toLowerCase(), s);
  }

  has(...names: string[]) { return names.every((n) => this.stars.has(n)); }
  anyOf(names: Iterable<string>) { for (const n of names) if (this.stars.has(n)) return true; return false; }
  dem(names: Iterable<string>) { let k = 0; for (const n of names) if (this.stars.has(n)) k++; return k; }
  hoa(name: string): string | null { return this.stars.get(name)?.hoa ?? null; }
  coHoa(loai: string, chinh = false): string | null {
    for (const [n, s] of this.stars) if (s.hoa === loai && (!chinh || BIG.has(n))) return n;
    return null;
  }
  sang(name: string) { const d = this.stars.get(name)?.dacTinh; return d === "M" || d === "V" || d === "Đ"; }
  ham(name: string) { return this.stars.get(name)?.dacTinh === "H"; }
  chinh() { return [...this.stars.keys()].filter((n) => BIG.has(n)); }
}

class Ctx {
  ps = new Map<number, P>();
  m: number;
  t: number;
  menh: P;
  than: P;
  tam: P[];
  sf: Set<string>;
  truoc: P;
  sau: P;
  out: CachCuc[] = [];

  constructor(chart: Chart) {
    for (const p of chart.palaces) this.ps.set(p.index, new P(p));
    this.m = chart.menh_index;
    this.t = chart.than_index;
    this.menh = this.ps.get(this.m)!;
    this.than = this.ps.get(this.t)!;
    this.tam = [0, 4, 8, 6].map((d) => this.at(this.m + d));
    this.sf = new Set(this.tam.flatMap((p) => [...p.stars.keys()]));
    this.truoc = this.at(this.m - 1);
    this.sau = this.at(this.m + 1);
  }

  at(idx: number): P { return this.ps.get(pymod(idx - 1, 12) + 1)!; }
  find(name: string): P | undefined { for (const p of this.ps.values()) if (p.stars.has(name)) return p; return undefined; }
  byCung(ten: string): P | undefined { for (const p of this.ps.values()) if ((p.cung || "").toLowerCase() === ten) return p; return undefined; }
  inTam(p: P) { return [0, 4, 6, 8].includes(pymod(p.i - this.m, 12)); }
  satTam(names: string[] = SAT_CUNG) { return this.tam.reduce((a, p) => a + p.dem(names), 0); }
  hoaTam(loai: string) { return this.tam.some((p) => p.coHoa(loai)); }
  kepMenh(a: string, b: string) {
    return (this.truoc.has(a) && this.sau.has(b)) || (this.truoc.has(b) && this.sau.has(a));
  }
  sfHas(...names: string[]) { return names.every((n) => this.sf.has(n)); }

  add(ten: string, muc: MucCachCuc, moTa: string, cung: (string | null)[], batBuoc: string[],
    cong: string[] = [], pha: string[] = [], nguon = TOAN_THU) {
    const uniq: string[] = [];
    for (const c of cung) if (!uniq.includes(c as string) && c !== null) uniq.push(c as string);
    this.out.push({
      ten, muc, mo_ta: moTa, cung: uniq.filter(Boolean),
      dieu_kien: { bat_buoc: [...batBuoc], diem_cong: [...cong], pha_cach: [...pha] },
      nguon,
    });
  }
}

/** Lấy text của các mục có điều kiện đúng. */
function f(...items: [unknown, string][]): string[] {
  return items.filter(([cond]) => Boolean(cond)).map(([, text]) => text);
}

const T = pytitle;

function quanThan(c: Ctx) {
  const sf = c.sf;
  if (!(c.menh.has("tử vi") && c.sfHas("tả phù", "hữu bật"))) return;
  const pha = f([c.satTam(KHONG_KIEP) >= 2, "Không Kiếp cùng hội (Tử Vi kỵ Không Kiếp)"]);
  c.add("Quân Thần Khánh Hội", pha.length ? CAT : DAI_CAT,
    "Tử Vi thủ Mệnh có Tả Hữu hội về, như vua được hiền thần phò tá. Thường có người nâng đỡ, hợp vai trò lãnh đạo, quản trị.",
    ["Mệnh"], ["Tử Vi thủ Mệnh", "Tả Phù, Hữu Bật hội tam phương tứ chính"],
    f([sf.has("văn xương") || sf.has("văn khúc"), "hội thêm Xương hoặc Khúc"],
      [sf.has("thiên khôi") || sf.has("thiên việt"), "Khôi Việt quý nhân chiếu"],
      [c.menh.hoa("tử vi") === "Quyền", "Tử Vi hóa Quyền"]), pha);
}

function tuPhu(c: Ctx) {
  const tv = c.find("tử vi");
  const tp = c.find("thiên phủ");
  if (!tv || tv !== tp) return;
  const oMenh = tv.i === c.m;
  const pha = f([tv.anyOf(KHONG_KIEP), "cung có Không Kiếp"], [tv.dem(SAT_CUNG) >= 2, "cung có từ hai sát tinh"]);
  c.add("Tử Phủ Đồng Cung", oMenh && !pha.length ? DAI_CAT : CAT,
    oMenh
      ? "Tử Vi, Thiên Phủ cùng thủ Mệnh, tôn quý, ổn định, có tài tổ chức; cần Tả Hữu phối hợp mới trọn."
      : "Tử Phủ đồng cung nhưng không thủ Mệnh, có chỗ dựa quý nhân, mức độ phú quý còn tùy cát sát hội chiếu.",
    [tv.cung], !oMenh ? ["Tử Vi, Thiên Phủ đồng cung"] : ["Tử Vi, Thiên Phủ đồng thủ Mệnh"],
    f([c.sfHas("tả phù", "hữu bật"), "Tả Hữu cùng hội"],
      [c.sf.has("văn xương") || c.sf.has("văn khúc"), "hội Xương Khúc"]), pha);
}

function phuTuong(c: Ctx) {
  const p = c.find("thiên phủ");
  const t = c.find("thiên tướng");
  if (!p || !t || p === t || !(c.inTam(p) && c.inTam(t))) return;
  const pha = f([c.menh.anyOf(SAT_CUNG), "Mệnh có sát tinh"], [c.satTam() >= 3, "tam phương nhiều sát tinh"]);
  c.add("Phủ Tướng Triều Viên", pha.length ? CAT : DAI_CAT,
    "Thiên Phủ, Thiên Tướng cùng ở tam phương tứ chính của Mệnh, văn võ kiêm toàn, có quyền có ấn, đời sống đủ đầy.",
    [p.cung, t.cung], ["Thiên Phủ, Thiên Tướng ở tam phương Mệnh, không đồng cung"],
    f([c.menh.has("lộc tồn") || c.menh.coHoa("Lộc"), "Mệnh có Lộc"], [c.sf.has("tả phù"), "hội Tả Phù"]), pha);
}

function duongLuong(c: Ctx) {
  if (!c.sfHas("thái dương", "thiên lương", "văn xương", "lộc tồn")) return;
  const d = c.find("thái dương")!;
  const l = c.find("thiên lương")!;
  const pha = f([d.ham("thái dương"), "Thái Dương hãm địa"], [c.satTam() >= 2, "tam phương sát nặng"]);
  c.add("Dương Lương Xương Lộc", pha.length ? CAT : DAI_CAT,
    "Thái Dương, Thiên Lương, Văn Xương, Lộc Tồn cùng hội, thuận đường học vấn, thi cử, nghiên cứu và chuyên môn.",
    [d.cung, l.cung], ["Bốn sao Nhật, Lương, Xương, Lộc hội tam phương Mệnh"],
    f([d.sang("thái dương"), "Thái Dương sáng"], [l.sang("thiên lương"), "Thiên Lương sáng"],
      [c.hoaTam("Khoa"), "hội Hóa Khoa"]), pha);
}

function hoaTham(c: Ctx) {
  const th = c.find("tham lang");
  if (!th || !c.inTam(th)) return;
  for (const [tenSao, sao, ten] of [["Hỏa Tinh", "hỏa tinh", "Hỏa Tham"], ["Linh Tinh", "linh tinh", "Linh Tham"]]) {
    const p = c.find(sao);
    if (!p || ![0, 4, 6, 8].includes(pymod(p.i - th.i, 12))) continue;
    const dong = p === th;
    const pha = f([th.anyOf(["kình dương", "đà la"]), "cung Tham Lang có Kình Đà"],
      [th.anyOf(KHONG_KIEP), "Tham Lang gặp Không Kiếp"]);
    const h = th.hoa("tham lang");
    c.add(ten, pha.length ? CAT : DAI_CAT,
      `Tham Lang gặp ${tenSao} (${dong ? "đồng cung" : "hội chiếu"}), dễ có cơ hội đến nhanh, bứt phá đột ngột; nên giữ thành quả vì được nhanh cũng dễ mất nhanh.`,
      [th.cung, p.cung], [`Tham Lang ${dong ? "đồng cung" : "hội chiếu"} ${tenSao}`, "Tham Lang ở tam phương Mệnh"],
      f([th.sang("tham lang"), "Tham Lang sáng"], [h === "Lộc" || h === "Quyền", "Tham Lang hóa Lộc/Quyền"]),
      pha, COT_TUY);
  }
}

function vuTham(c: Ctx) {
  const v = c.find("vũ khúc");
  const t = c.find("tham lang");
  if (!v || !t || ![0, 6].includes(pymod(v.i - t.i, 12)) || !(c.inTam(v) || c.inTam(t))) return;
  const pha = f([v.anyOf(["kình dương", "đà la"]), "cung Vũ Khúc có Kình Đà"], [v.anyOf(KHONG_KIEP), "gặp Không Kiếp"]);
  c.add("Vũ Tham", pha.length ? CAT : DAI_CAT,
    "Tài tinh gặp Tham Lang; cổ thư nói “Vũ Tham bất phát thiếu niên nhân”, thường tích lũy và thành tựu từ trung niên.",
    [v.cung, t.cung], [`Vũ Khúc, Tham Lang ${v === t ? "đồng cung" : "đối cung"}`, "hội tam phương Mệnh"],
    f([c.sf.has("hỏa tinh") || c.sf.has("linh tinh"), "gặp thêm Hỏa/Linh"], [v.hoa("vũ khúc") === "Lộc", "Vũ Khúc hóa Lộc"]),
    pha, COT_TUY);
}

function satPhaTham(c: Ctx) {
  if (!c.sfHas("thất sát", "phá quân", "tham lang")) return;
  const pha = f([c.satTam() >= 3, "sát tinh quá nặng"], [c.menh.anyOf(KHONG_KIEP), "Mệnh có Không Kiếp"]);
  const cung = c.tam.filter((p) => p.anyOf(["thất sát", "phá quân", "tham lang"])).map((p) => p.cung);
  c.add("Sát Phá Tham", pha.length ? LUU_Y : CAT,
    "Bộ Sát Phá Tham hội Mệnh: tính khai phá, không chịu yên, đời nhiều thay đổi. Hợp khởi nghiệp, kinh doanh, môi trường cạnh tranh; thường ổn định từ trung niên.",
    cung, ["Thất Sát, Phá Quân, Tham Lang ở tam phương tứ chính"],
    f([c.hoaTam("Lộc") || c.hoaTam("Quyền"), "có Hóa Lộc/Quyền"],
      [c.sfHas("tả phù", "hữu bật"), "Tả Hữu cùng hội"]), pha);
}

function coNguyet(c: Ctx) {
  const bo = ["thiên cơ", "thái âm", "thiên đồng", "thiên lương"];
  const co = bo.filter((s) => c.sf.has(s));
  const cung = c.tam.filter((p) => p.anyOf(co)).map((p) => p.cung);
  if (co.length === 4) {
    const pha = f([c.satTam() >= 3, "nhiều sát tinh"], [c.menh.anyOf(SAT_CUNG), "Mệnh có sát tinh"]);
    c.add("Cơ Nguyệt Đồng Lương", pha.length ? CAT : DAI_CAT,
      "Bốn sao Cơ, Nguyệt, Đồng, Lương hội Mệnh: nho nhã, cẩn trọng, giỏi mưu tính; hợp công chức, học thuật, y tế, dịch vụ, ngành cần tích lũy bền.",
      cung, ["Bốn sao hội đủ tam phương tứ chính"],
      f([c.sf.has("văn xương") || c.sf.has("văn khúc"), "hội Xương Khúc"], [c.hoaTam("Khoa"), "hội Hóa Khoa"]), pha);
  } else if (co.length === 3) {
    const thieu = bo.filter((s) => !co.includes(s))[0];
    c.add("Cơ Nguyệt Đồng Lương (chưa đủ)", TRUNG,
      `Bộ bốn sao mới hội ba, thiếu ${T(thieu)}; có khuynh hướng nhưng không tính là chân cách.`,
      cung, [`Tam phương có ${co.map(T).join(", ")}`]);
  }
}

function liemTuong(c: Ctx) {
  const l = c.find("liêm trinh");
  const t = c.find("thiên tướng");
  if (!l || l !== t) return;
  const pha = f([l.has("kình dương"), "có Kình Dương"], [l.hoa("liêm trinh") === "Kỵ", "Liêm Trinh hóa Kỵ"]);
  c.add("Liêm Tướng", pha.length ? LUU_Y : l.i === c.m ? CAT : TRUNG,
    "Liêm Trinh, Thiên Tướng đồng cung, làm việc có nguyên tắc; hợp hành chính, pháp chế, quản lý. Gặp Kình, Kỵ nên cẩn trọng giấy tờ, pháp lý.",
    [l.cung], ["Liêm Trinh, Thiên Tướng đồng cung"],
    f([l.has("lộc tồn") || l.hoa("liêm trinh") === "Lộc", "có Lộc"], [c.sf.has("tả phù"), "hội Tả Phù"]), pha);
}

function vuSat(c: Ctx) {
  const v = c.find("vũ khúc");
  const s = c.find("thất sát");
  if (!v || v !== s) return;
  const pha = f([v.hoa("vũ khúc") === "Kỵ", "Vũ Khúc hóa Kỵ"], [v.anyOf(SAT_CUNG), "có sát tinh đồng cung"]);
  c.add("Vũ Sát", pha.length ? LUU_Y : v.i === c.m ? DAI_CAT : CAT,
    "Vũ Khúc, Thất Sát đồng cung, quyết đoán, giỏi xoay xở tài chính; hợp tài chính, kỹ thuật, khởi nghiệp. Đời phải tự lực nhiều.",
    [v.cung], ["Vũ Khúc, Thất Sát đồng cung"],
    f([v.hoa("vũ khúc") === "Quyền", "Vũ Khúc hóa Quyền"], [v.hoa("vũ khúc") === "Lộc", "Vũ Khúc hóa Lộc"]), pha);
}

function dongLuong(c: Ctx) {
  const d = c.find("thiên đồng");
  const l = c.find("thiên lương");
  if (!d || d !== l) return;
  const pha = f([d.anyOf(SAT_CUNG), "có sát tinh đồng cung"]);
  c.add("Đồng Lương", pha.length ? TRUNG : CAT,
    "Phúc tinh gặp ấm tinh, hiền hòa, thích giúp người; hợp y tế, giáo dục, công tác xã hội. Tính ôn hòa, ít mạo hiểm.",
    [d.cung], ["Thiên Đồng, Thiên Lương đồng cung"],
    f([c.sf.has("văn xương"), "Văn Xương chiếu"], [d.hoa("thiên đồng") === "Lộc", "Thiên Đồng hóa Lộc"]), pha);
}

function nhatNguyet(c: Ctx) {
  const d = c.find("thái dương");
  const a = c.find("thái âm");
  if (d && d === a && (d.branch === "Sửu" || d.branch === "Mùi")) {
    const pha = f([d.anyOf(SAT_CUNG), "có sát tinh đồng cung"]);
    c.add("Nhật Nguyệt Đồng Cung", pha.length || d.i !== c.m ? CAT : DAI_CAT,
      `Nhật Nguyệt cùng ở ${d.branch}, âm dương quân bình, văn võ kiêm toàn, dễ có tiếng tăm và nhân duyên.`,
      [d.cung], [`Thái Dương, Thái Âm đồng cung tại ${d.branch}`],
      f([c.sfHas("văn xương", "văn khúc"), "hội Xương Khúc"]), pha);
  }
  if (c.kepMenh("thái dương", "thái âm")) {
    const pd = c.find("thái dương")!;
    const pa = c.find("thái âm")!;
    const pha = f([pd.ham("thái dương") || pa.ham("thái âm"), "Nhật Nguyệt hãm địa"]);
    c.add("Nhật Nguyệt Giáp Mệnh", pha.length ? CAT : DAI_CAT,
      "Nhật Nguyệt kẹp hai bên Mệnh, sáng sủa, được người nâng đỡ. Nhật Nguyệt không hãm mới là chân cách.",
      ["Mệnh", pd.cung, pa.cung], ["Thái Dương, Thái Âm ở hai cung kề Mệnh"],
      f([pd.sang("thái dương"), "Thái Dương sáng"], [pa.sang("thái âm"), "Thái Âm sáng"]), pha);
  }
}

function cuNhat(c: Ctx) {
  const j = c.find("cự môn");
  const d = c.find("thái dương");
  if (!j || j !== d || (j.branch !== "Dần" && j.branch !== "Thân")) return;
  const hoa = j.hoa("cự môn");
  const pha = f([hoa === "Kỵ", "Cự Môn hóa Kỵ"], [j.branch === "Thân", "Thái Dương ở Thân đã xế, ám khí Cự Môn rõ hơn"]);
  c.add("Cự Nhật Đồng Cung", pha.length ? LUU_Y : j.i === c.m ? DAI_CAT : CAT,
    "Thái Dương giải ám khí của Cự Môn; lập nghiệp bằng lời nói, truyền thông, ngoại ngữ, chuyên môn. Ở Dần tốt hơn Thân.",
    [j.cung], [`Cự Môn, Thái Dương đồng cung tại ${j.branch}`],
    f([hoa === "Lộc" || hoa === "Quyền", "Cự Môn hóa Lộc/Quyền"]), pha);
}

function thachTrung(c: Ctx) {
  const m = c.menh;
  if (!m.has("cự môn") || (m.branch !== "Tý" && m.branch !== "Ngọ")) return;
  const pha = f([m.hoa("cự môn") === "Kỵ", "Cự Môn hóa Kỵ"], [m.anyOf(SAT_CUNG), "Mệnh có sát tinh"]);
  const h = m.hoa("cự môn");
  c.add("Thạch Trung Ẩn Ngọc", pha.length ? LUU_Y : DAI_CAT,
    "Cự Môn thủ Mệnh tại Tý/Ngọ, ngoài bình dị mà trong có thực tài; thường hiển đạt từ trung niên.",
    ["Mệnh"], [`Cự Môn thủ Mệnh tại ${m.branch}`],
    f([h === "Lộc" || h === "Quyền", "Cự Môn hóa Lộc/Quyền"], [c.sf.has("văn xương"), "hội Văn Xương"]), pha, COT_TUY);
}

function minhChau(c: Ctx) {
  if (c.menh.branch !== "Mùi" || c.menh.chinh().length) return;
  const doi = c.at(c.m + 6);
  if (!doi.has("thái dương", "thái âm")) return;
  const pha = f([c.satTam() >= 2, "sát tinh hội chiếu"]);
  c.add("Minh Châu Xuất Hải", pha.length ? CAT : DAI_CAT,
    "Mệnh vô chính diệu tại Mùi, Nhật Nguyệt ở Sửu chiếu về. Khởi đầu bình thường, nhờ tự thân vươn lên; xa quê hoặc môi trường lớn dễ phát huy.",
    ["Mệnh", doi.cung], ["Mệnh vô chính diệu tại Mùi", "đối cung Sửu có Nhật Nguyệt"],
    f([c.sf.has("văn xương") || c.sf.has("văn khúc"), "hội Xương Khúc"],
      [c.sf.has("tả phù") || c.sf.has("hữu bật"), "có Tả/Hữu"]), pha, TOAN_TAP);
}

function tuViMenh(c: Ctx) {
  if (!c.menh.has("tử vi") || c.menh.has("thiên phủ")) return;
  const coTa = c.sf.has("tả phù");
  const coHuu = c.sf.has("hữu bật");
  const pha = f([!coTa && !coHuu, "không có Tả Hữu (cô quân)"], [c.menh.anyOf(KHONG_KIEP), "Tử Vi gặp Không Kiếp"]);
  const cong = f([coTa && coHuu, "Tả Hữu cùng hội"], [c.sfHas("văn xương", "văn khúc"), "Xương Khúc cùng hội"]);
  c.add("Tử Vi Thủ Mệnh", pha.length ? LUU_Y : cong.length ? DAI_CAT : CAT,
    "Đế tinh thủ Mệnh, tự tôn cao, có sức hút lãnh đạo; thiếu người phò tá thì dễ cô độc, khó nghe góp ý.",
    ["Mệnh"], ["Tử Vi thủ Mệnh, không đồng cung Thiên Phủ"], cong, pha);
}

function giapMenh(c: Ctx) {
  const bo: [string, string, string, MucCachCuc, string][] = [
    ["tả phù", "hữu bật", "Tả Hữu Giáp Mệnh", DAI_CAT, "Tả Hữu kẹp Mệnh, được quý nhân, có sức tổ chức; hợp quản lý, doanh nghiệp lớn."],
    ["văn xương", "văn khúc", "Xương Khúc Giáp Mệnh", DAI_CAT, "Xương Khúc kẹp Mệnh, thông minh, có văn tài; thuận thi cử, học thuật, viết lách."],
    ["thiên khôi", "thiên việt", "Khôi Việt Giáp Mệnh", CAT, "Khôi Việt kẹp Mệnh, lúc quan trọng thường có quý nhân nâng đỡ."],
    ["hỏa tinh", "linh tinh", "Hỏa Linh Giáp Mệnh", LUU_Y, "Hỏa Linh kẹp Mệnh, tính nóng vội; nên rèn kiên nhẫn, tránh quyết định bốc đồng."],
    ["địa không", "địa kiếp", "Không Kiếp Giáp Mệnh", LUU_Y, "Không Kiếp kẹp Mệnh, tiền bạc khó tụ, tư duy khác thường; hợp kỹ nghệ, nghiên cứu, nên có kỷ luật tài chính."],
  ];
  for (const [a, b, ten, muc, moTa] of bo) {
    if (c.kepMenh(a, b)) {
      c.add(ten, muc, moTa, ["Mệnh", c.truoc.cung, c.sau.cung], [`${T(a)}, ${T(b)} ở hai cung kề Mệnh`]);
    }
  }
}

function songLoc(c: Ctx) {
  if (!(c.hoaTam("Lộc") && c.sf.has("lộc tồn"))) return;
  c.add("Song Lộc Triều Viên", DAI_CAT,
    "Hóa Lộc và Lộc Tồn cùng hội, nguồn tài lộc dồi dào, ít lo thiếu thốn.",
    c.tam.map((p) => p.cung), ["Hóa Lộc hội tam phương", "Lộc Tồn hội tam phương"], [],
    f([c.menh.anyOf(KHONG_KIEP), "Mệnh có Không Kiếp: tiền đến rồi đi"]));
}

function tamKy(c: Ctx) {
  if (c.hoaTam("Lộc") && c.hoaTam("Quyền") && c.hoaTam("Khoa")) {
    c.add("Tam Kỳ Gia Hội", DAI_CAT, "Lộc, Quyền, Khoa cùng hội tam phương tứ chính, một trong những cách cát cao nhất: có tiền tài, quyền hành và danh tiếng.",
      c.tam.map((p) => p.cung), ["Hóa Lộc, Quyền, Khoa hội đủ tam phương tứ chính"]);
  } else if (c.tam.some((p) => p.coHoa("Khoa", true)) && c.tam.some((p) => p.coHoa("Quyền", true))) {
    c.add("Khoa Quyền Song Hội", CAT, "Khoa và Quyền cùng hội, vừa có học thức danh tiếng vừa có năng lực nắm việc; hợp hướng chuyên gia.",
      ["Mệnh"], ["Hóa Khoa, Hóa Quyền hội tam phương tứ chính"]);
  }
}

function hoaNhap(c: Ctx) {
  let s = c.menh.coHoa("Lộc", true);
  if (s) {
    c.add(`${T(s)} Hóa Lộc Thủ Mệnh`, CAT, "Hóa Lộc tại Mệnh, nhiều cơ duyên, nhân duyên tốt, kiếm tiền thuận hơn.", ["Mệnh"], [`${T(s)} hóa Lộc tại Mệnh`]);
  }
  for (const [p, nhan] of [[c.menh, "Mệnh"], [c.at(c.m + 6), "Thiên Di"]] as const) {
    const k = p.coHoa("Kỵ", true);
    if (k) {
      c.add(`${T(k)} Hóa Kỵ tại ${nhan}`, LUU_Y,
        nhan === "Mệnh"
          ? "Hóa Kỵ tại Mệnh: dễ cố chấp, tự tạo áp lực; nên nhường một bước, chú ý nghỉ ngơi."
          : "Hóa Kỵ tại Thiên Di: đi xa, giao tế dễ gặp trục trặc; nên chuẩn bị kỹ, thận trọng khi mở rộng.",
        [p.cung], [`${T(k)} hóa Kỵ tại ${nhan}`]);
    }
  }
  if (c.menh.coHoa("Kỵ") && c.kepMenh("kình dương", "đà la")) {
    c.add("Kình Đà Giáp Kỵ", LUU_Y, "Hóa Kỵ tại Mệnh lại bị Kình Đà kẹp, dễ vất vả, nhiều trắc trở; nên chậm mà chắc, tránh quá sức, chủ động tìm hỗ trợ.",
      ["Mệnh", c.truoc.cung, c.sau.cung], ["Hóa Kỵ tại Mệnh", "Kình Dương, Đà La ở hai cung kề Mệnh"], [], [], COT_TUY);
  }
  const tb = c.byCung("tài bạch");
  const ql = c.byCung("quan lộc");
  s = tb ? tb.coHoa("Lộc", true) : null;
  if (s) {
    c.add("Hóa Lộc Nhập Tài", CAT, `${T(s)} hóa Lộc tại Tài Bạch, nguồn thu thông suốt.`, ["Tài Bạch"], [`${T(s)} hóa Lộc tại Tài Bạch`]);
  }
  s = ql ? ql.coHoa("Quyền", true) : null;
  if (s) {
    c.add("Hóa Quyền Nhập Quan", CAT, `${T(s)} hóa Quyền tại Quan Lộc, công việc có quyền chủ động, gánh được vai trò độc lập.`, ["Quan Lộc"], [`${T(s)} hóa Quyền tại Quan Lộc`]);
  }
  for (const [p, nhan] of [[c.menh, "Mệnh"], [c.than, "Thân"]] as const) {
    const k = p.coHoa("Khoa", true);
    if (k) {
      c.add(`Hóa Khoa Nhập ${nhan}`, CAT, `${T(k)} hóa Khoa tại ${nhan}, thuận danh tiếng, giấy tờ, học thuật.`, [p.cung], [`${T(k)} hóa Khoa tại ${nhan}`]);
      break;
    }
  }
}

function satCach(c: Ctx) {
  const bo: [string[], string, string][] = [
    [["liêm trinh", "thất sát", "kình dương"], "Liêm Sát Dương", TOAN_THU],
    [["cự môn", "hỏa tinh", "kình dương"], "Cự Hỏa Dương", COT_TUY],
    [["linh tinh", "văn xương", "đà la", "vũ khúc"], "Linh Xương Đà Vũ", COT_TUY],
  ];
  for (const [sao, ten, nguon] of bo) {
    if (c.sfHas(...sao)) {
      c.add(ten, LUU_Y,
        "Tổ hợp cổ thư lưu ý, thường ứng khi hạn kích hoạt. Không phải định mệnh: nên giữ cân bằng tâm lý, tránh quyết định lớn lúc áp lực và chủ động tìm hỗ trợ khi cần.",
        ["Mệnh"], [`${pysorted(sao.map(T)).join(", ")} hội tam phương tứ chính`], [], [], nguon);
    }
  }
}

function maDau(c: Ctx) {
  const m = c.menh;
  if (m.branch !== "Ngọ" || !m.has("kình dương")) return;
  const cong = f([c.sf.has("thất sát") || c.sf.has("phá quân"), "hội Sát/Phá"],
    [c.sf.has("thiên khôi") || c.sf.has("thiên việt"), "Khôi Việt chiếu"]);
  c.add("Mã Đầu Đới Tiễn", cong.length ? CAT : LUU_Y,
    "Kình Dương thủ Mệnh tại Ngọ, quyết liệt, có tinh thần cạnh tranh; hợp môi trường cần hành động mạnh, nhưng nên kiềm chế nóng nảy.",
    ["Mệnh"], ["Kình Dương thủ Mệnh tại Ngọ"], cong, [], COT_TUY);
}

function locMa(c: Ctx) {
  let p = c.find("lộc tồn");
  if (p && (p.i === c.m || p.i === c.t)) {
    const noi = p.i === c.m ? "Mệnh" : "Thân";
    c.add(`Lộc Tồn Thủ ${noi}`, CAT, `Lộc Tồn tại ${noi}, tài lộc ổn định, giỏi tích lũy, tính thận trọng.`,
      [p.cung], [`Lộc Tồn tại ${noi}`]);
  }
  p = c.find("thiên mã");
  if (p && [0, 6].includes(pymod(p.i - c.m, 12))) {
    const oMenh = p.i === c.m;
    c.add(`Thiên Mã ${oMenh ? "Thủ Mệnh" : "Tại Thiên Di"}`, TRUNG,
      oMenh ? "Thiên Mã tại Mệnh, đời nhiều di chuyển, trong động có tài; gặp Lộc càng tốt."
        : "Thiên Mã tại Thiên Di, đi xa có lợi, hợp phát triển ở nơi khác.",
      [p.cung], [`Thiên Mã tại ${oMenh ? "Mệnh" : "Thiên Di"}`]);
  }
}

function dongHoi(c: Ctx) {
  if (c.sfHas("văn xương", "văn khúc")) {
    const o = c.menh.has("văn xương", "văn khúc");
    c.add(`Xương Khúc ${o ? "Thủ Mệnh" : "Đồng Hội"}`, CAT, "Xương Khúc hội Mệnh, có tài ăn nói, văn chương; hợp nghề cần biểu đạt.", ["Mệnh"], ["Văn Xương, Văn Khúc hội tam phương tứ chính"]);
  }
  if (c.sfHas("tả phù", "hữu bật")) {
    c.add("Tả Hữu Đồng Hội", CAT, "Tả Hữu hội Mệnh, được nhiều người giúp, nhân duyên tốt; hợp vai trò dẫn dắt và làm việc nhóm.", ["Mệnh"], ["Tả Phù, Hữu Bật hội tam phương tứ chính"]);
  }
  if (c.sfHas("thiên khôi", "thiên việt")) {
    c.add("Khôi Việt Đồng Hội", CAT, "Khôi Việt hội Mệnh, lúc then chốt thường có quý nhân nâng đỡ.", ["Mệnh"], ["Thiên Khôi, Thiên Việt hội tam phương tứ chính"]);
  }
}

const QUY_TAC: ((c: Ctx) => void)[] = [
  quanThan, tuPhu, phuTuong, duongLuong, hoaTham, vuTham, satPhaTham, coNguyet,
  liemTuong, vuSat, dongLuong, nhatNguyet, cuNhat, thachTrung, minhChau, tuViMenh,
  giapMenh, songLoc, tamKy, hoaNhap, satCach, maDau, locMa, dongHoi,
];

export function nhanDienCachCuc(chart: Chart): CachCuc[] {
  const c = new Ctx(chart);
  for (const rule of QUY_TAC) rule(c);
  return c.out;
}
