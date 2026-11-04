/**
 * Đăng nhập Google (OAuth 2.0 / OpenID Connect, luồng authorization code do backend xử lý).
 *
 * start → chuyển hướng sang Google; callback nhận `code`, đổi lấy id_token tại token endpoint của Google
 * (gọi trực tiếp server-to-server qua TLS nên theo OIDC Core §3.1.3.7 không cần kiểm chữ ký, chỉ kiểm
 * aud/iss/exp), rồi đăng nhập hoặc tạo tài khoản.
 *
 * Cấu hình: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. GOOGLE_OAUTH=fake: giả lập cho E2E (không gọi Google;
 * email lấy từ tham số `hint`) — bị cấm ở production.
 */
export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
}

export interface GoogleOAuth {
  authUrl(state: string, redirectUri: string, hint?: string): string;
  exchange(code: string, redirectUri: string): Promise<GoogleProfile>;
}

export class GoogleError extends Error {}

const b64url = (s: string) => Buffer.from(s, "utf-8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf-8");

export function realGoogle(clientId: string, clientSecret: string, fetchFn: typeof fetch = fetch): GoogleOAuth {
  return {
    authUrl(state, redirectUri, hint) {
      const q = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile",
        state, prompt: "select_account", ...(hint ? { login_hint: hint } : {}),
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchange(code, redirectUri) {
      const r = await fetchFn("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      if (!r.ok) throw new GoogleError(`Google từ chối mã đăng nhập (${r.status})`);
      const { id_token } = (await r.json()) as { id_token?: string };
      if (!id_token) throw new GoogleError("Google không trả id_token");
      const p = JSON.parse(unb64url(id_token.split(".")[1] ?? "")) as Record<string, unknown>;
      if (p.aud !== clientId) throw new GoogleError("id_token không dành cho ứng dụng này");
      if (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com") throw new GoogleError("id_token sai nơi phát hành");
      if (typeof p.exp !== "number" || p.exp * 1000 < Date.now()) throw new GoogleError("id_token đã hết hạn");
      if (typeof p.sub !== "string" || typeof p.email !== "string") throw new GoogleError("id_token thiếu thông tin");
      return { sub: p.sub, email: p.email, email_verified: p.email_verified === true || p.email_verified === "true", name: typeof p.name === "string" ? p.name : "" };
    },
  };
}

/** Giả lập cho kiểm thử: không gọi Google; `hint` là email muốn đăng nhập. */
export function fakeGoogle(): GoogleOAuth {
  return {
    authUrl(state, redirectUri, hint) {
      const email = hint || "google-user@e2e.test";
      const code = "fake." + b64url(JSON.stringify({ email, name: email.split("@")[0] }));
      return `${redirectUri}?${new URLSearchParams({ code, state })}`;
    },
    async exchange(code) {
      if (!code.startsWith("fake.")) throw new GoogleError("Mã giả lập không hợp lệ");
      const { email, name } = JSON.parse(unb64url(code.slice(5))) as { email: string; name: string };
      return { sub: "fake-" + email.toLowerCase(), email, email_verified: true, name };
    },
  };
}

export function googleFromEnv(): GoogleOAuth | null {
  if (process.env.GOOGLE_OAUTH === "fake") return fakeGoogle();
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? realGoogle(id, secret) : null;
}
