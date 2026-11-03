// Đọc mảng ca [{y,m,d,gio,gt}] từ stdin, xuất lá số iztro (dùng trong compare_iztro.py).
// iztro chỉ là engine ĐỐI CHIẾU cho test, không phải dependency chạy thật của backend.
import { astro } from 'iztro';
let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  const out = JSON.parse(raw).map(c => {
    const a = astro.bySolar(`${c.y}-${c.m}-${c.d}`, c.gio - 1, c.gt === 1 ? 'male' : 'female', false, 'zh-CN');
    return {
      soul: a.soul, body: a.body, ju: a.fiveElementsClass,
      palaces: a.palaces.map(p => ({
        name: p.name, branch: p.earthlyBranch, stem: p.heavenlyStem, isBody: p.isBodyPalace,
        decadal: p.decadal.range,
        stars: [...p.majorStars, ...p.minorStars].map(s => ({ name: s.name, mutagen: s.mutagen })),
      })),
    };
  });
  process.stdout.write(JSON.stringify(out));
});
