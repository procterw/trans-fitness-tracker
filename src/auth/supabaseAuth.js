import { createRemoteJWKSet, jwtVerify } from "jose";

function buildJwksUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    url.pathname = "/auth/v1/.well-known/jwks.json";
    return url.toString();
  } catch {
    return null;
  }
}

export function createSupabaseAuth({ supabaseUrl, required = false }) {
  const jwksUrl = buildJwksUrl(supabaseUrl);
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

  return async function supabaseAuth(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;

    if (!token && !required) {
      req.user = null;
      return next();
    }

    if (!jwks) {
      const status = required ? 500 : 401;
      return res.status(status).json({ ok: false, error: "SUPABASE_URL is not configured." });
    }

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization bearer token." });
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: "authenticated",
      });

      req.user = {
        id: payload.sub,
        email: payload.email || null,
      };

      return next();
    } catch {
      if (!required) {
        req.user = null;
        return next();
      }
      return res.status(401).json({ ok: false, error: "Invalid or expired token." });
    }
  };
}
