/** Nội dung các email gửi cho người dùng (text + HTML đơn giản). */
import type { Mail } from "./mailer.js";

const BRAND = () => process.env.BRAND_NAME || "Tử Vi Vi Tinh";
/** Địa chỉ trang web công khai (tu-vi-fe), dùng để tạo link trong email. */
export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, paras: string[], button?: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E7;font-family:Arial,sans-serif;color:#1C1F2B">
<div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #E2D8C6;border-radius:16px;padding:28px">
<p style="margin:0 0 16px;font-size:13px;color:#8A8F9E">${esc(BRAND())}</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>
${paras.map((p) => `<p style="font-size:14px;line-height:1.6;color:#454B5C">${esc(p)}</p>`).join("\n")}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#A63D2F;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:bold">${esc(button.label)}</a></p>
<p style="font-size:12px;color:#8A8F9E">Nếu nút không bấm được, mở đường dẫn: ${esc(button.url)}</p>` : ""}
</div></body></html>`;
  const text = [title, "", ...paras, ...(button ? ["", `${button.label}: ${button.url}`] : []), "", BRAND()].join("\n");
  return { html, text };
}

export function verifyEmail(to: string, token: string): Mail {
  const url = `${appUrl()}/xac-thuc-email?token=${encodeURIComponent(token)}`;
  const { html, text } = layout("Xác nhận email của bạn", [
    "Bạn vừa tạo tài khoản. Bấm nút dưới đây để xác nhận email, sau đó bạn có thể mua gói luận giải chuyên sâu.",
    "Liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản, hãy bỏ qua email này.",
  ], { label: "Xác nhận email", url });
  return { to, kind: "verify", subject: `Xác nhận email — ${BRAND()}`, text, html };
}

export function resetPassword(to: string, token: string): Mail {
  const url = `${appUrl()}/dat-lai-mat-khau?token=${encodeURIComponent(token)}`;
  const { html, text } = layout("Đặt lại mật khẩu", [
    "Có yêu cầu đặt lại mật khẩu cho tài khoản dùng email này. Bấm nút dưới đây để chọn mật khẩu mới.",
    "Liên kết chỉ dùng được một lần và hết hạn sau 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu của bạn không đổi.",
  ], { label: "Đặt mật khẩu mới", url });
  return { to, kind: "reset", subject: `Đặt lại mật khẩu — ${BRAND()}`, text, html };
}

export function receipt(to: string, o: { code: string; amount: number; credits: number; valid_days: number; plan_name: string; paid_at: string }): Mail {
  const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
  const { html, text } = layout("Đã nhận thanh toán", [
    `Mã đơn: ${o.code}`,
    `Gói: ${o.plan_name} — ${o.credits} lượt luận giải chuyên sâu, dùng trong ${o.valid_days} ngày.`,
    `Số tiền: ${vnd(o.amount)}. Thời gian: ${new Date(o.paid_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.`,
    "Mỗi lượt mở khoá luận giải chuyên sâu cho một lá số; đọc lại lá số đã mở khoá không tốn thêm lượt.",
    "Cần hỗ trợ, hãy trả lời email này kèm mã đơn.",
  ], { label: "Xem lá số của tôi", url: `${appUrl()}/la-so-cua-toi` });
  return { to, kind: "receipt", subject: `Biên nhận thanh toán ${o.code} — ${BRAND()}`, text, html };
}

export function refundNotice(to: string, o: { code: string; amount: number; luot_thu_hoi: number; luot_da_dung: number }): Mail {
  const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
  const { html, text } = layout("Đã hoàn tiền đơn hàng", [
    `Mã đơn: ${o.code}. Số tiền hoàn: ${vnd(o.amount)}, chuyển về tài khoản bạn đã thanh toán.`,
    o.luot_thu_hoi
      ? `${o.luot_thu_hoi} lượt chưa dùng của đơn này đã được thu hồi.`
      : "Đơn này không còn lượt chưa dùng.",
    o.luot_da_dung
      ? `Các lá số đã mở khoá bằng ${o.luot_da_dung} lượt đã dùng vẫn được giữ, bạn đọc lại bình thường.`
      : "",
    "Nếu chưa nhận được tiền sau 3 ngày làm việc, hãy trả lời email này kèm mã đơn.",
  ].filter(Boolean), { label: "Xem lá số của tôi", url: `${appUrl()}/la-so-cua-toi` });
  return { to, kind: "refund", subject: `Hoàn tiền đơn ${o.code} — ${BRAND()}`, text, html };
}
