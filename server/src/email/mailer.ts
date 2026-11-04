/**
 * Gửi email qua SMTP (Resend, Amazon SES, Brevo, Gmail... đều có SMTP).
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465   MAIL_FROM="Tử Vi Vi Tinh <no-reply@example.com>"
 * Chưa đặt SMTP_URL: email không được gửi mà in ra log (dev/test). Mọi email đều ghi vào
 * bảng email_outbox (không lưu nội dung, vì có link đặt lại mật khẩu) để tra soát.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/index.js";

export interface Mail {
  to: string;
  kind: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
  /** Email gửi gần nhất (chỉ chế độ log, dùng cho test). */
  last?: Mail[];
}

export async function createMailer(db: Db, log: FastifyBaseLogger): Promise<Mailer> {
  const url = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM || "Tử Vi Vi Tinh <no-reply@localhost>";
  const ghi = (m: Mail, status: string, error: string | null = null) =>
    db.query("INSERT INTO email_outbox (to_email, kind, subject, status, error) VALUES ($1, $2, $3, $4, $5)",
      [m.to, m.kind, m.subject, status, error]).catch((e) => log.error({ err: e }, "ghi email_outbox lỗi"));

  if (!url) {
    const last: Mail[] = [];
    return {
      last,
      async send(m) {
        last.push(m);
        if (last.length > 50) last.shift();
        log.info({ to: m.to, subject: m.subject, text: m.text }, "email (chưa cấu hình SMTP_URL, chỉ ghi log)");
        await ghi(m, "logged");
      },
    };
  }
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport(url);
  return {
    async send(m) {
      try {
        await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
        await ghi(m, "sent");
      } catch (e) {
        log.error({ err: e, to: m.to, kind: m.kind }, "gửi email lỗi");
        await ghi(m, "failed", String(e).slice(0, 500));
      }
    },
  };
}
