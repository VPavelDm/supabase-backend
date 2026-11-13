// FCM HTTP v1 for the Android apps, apns.ts's twin: an OAuth access token
// minted from a Firebase service account (RS256 JWT via WebCrypto, cached for
// the warm isolate), one POST per device. Adapted from Calyo's own backend
// (Calories/supabase functions/together/fcm.ts).
//
// Configured per caller through one secret holding the service account JSON
// downloaded from Firebase (Project settings → Service accounts → Generate new
// private key):
//   supabase secrets set <PREFIX>_FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
// A missing or malformed secret skips Android pushes silently ("skipped"), as a
// missing APNs key does — iOS pushes are not affected.

import type { PushResult } from "./apns.ts";

interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** The service account's private key (PEM, PKCS#8). */
  privateKey: string;
}

/// What an Android push shows. Loc keys are string resource names in the app
/// (res/values/strings*.xml), looked up on the phone in its own language.
export interface AndroidAlert {
  titleLocKey: string;
  bodyLocKey: string;
  /// The notification channel the app created for it.
  channelId: string;
}

export interface FCMClient {
  /// Sends one notification; "gone" means FCM no longer knows the token and
  /// the caller should delete the device row.
  push(deviceToken: string, alert: AndroidAlert, data?: Record<string, string>): Promise<PushResult>;
}

function configFromEnv(secretName: string): FcmConfig | null {
  const raw = Deno.env.get(secretName);
  if (!raw) return null;
  try {
    const account = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    if (!account.project_id || !account.client_email || !account.private_key) return null;
    return { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key };
  } catch {
    console.error(`${secretName} is not valid JSON`);
    return null;
  }
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function makeFCM(config: { secretPrefix: string }): FCMClient {
  const secretName = `${config.secretPrefix}_FCM_SERVICE_ACCOUNT`;
  // Google's tokens last an hour; one per warm isolate, refreshed at 50 minutes.
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(fcm: FcmConfig): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && now < cached.expiresAt) return cached.token;
    const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claims = b64url(utf8(JSON.stringify({
      iss: fcm.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })));
    const key = await importPkcs8(fcm.privateKey);
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claims}`)));
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${b64url(signature)}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`FCM auth ${response.status}: ${await response.text().catch(() => "")}`);
    }
    const { access_token: token } = await response.json() as { access_token: string };
    cached = { token, expiresAt: now + 50 * 60 };
    return token;
  }

  return {
    async push(deviceToken, alert, data) {
      const fcm = configFromEnv(secretName);
      if (!fcm) return "skipped";
      let token: string;
      try {
        token = await accessToken(fcm);
      } catch (error) {
        console.error("fcm auth failed", error);
        return "failed";
      }
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`, {
        method: "POST",
        headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            // A tapped notification hands `data` to the app as its launch intent's extras.
            ...(data ? { data } : {}),
            android: {
              priority: "high",
              notification: {
                title_loc_key: alert.titleLocKey,
                body_loc_key: alert.bodyLocKey,
                channel_id: alert.channelId,
              },
            },
          },
        }),
      });
      if (response.ok) {
        await response.body?.cancel();
        return "ok";
      }
      const error = (await response.json().catch(() => ({})) as {
        error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
      }).error;
      const code = error?.details?.find((d) => d.errorCode)?.errorCode ?? error?.status;
      // Only FCM's own word that the token is gone deletes the row: 404
      // UNREGISTERED, or 400 INVALID_ARGUMENT naming the token. Anything else
      // keeps it — deleting live tokens on a bad request would silence a phone.
      if (
        (response.status === 404 && code === "UNREGISTERED") ||
        (response.status === 400 && code === "INVALID_ARGUMENT" && /registration token/i.test(error?.message ?? ""))
      ) {
        return "gone";
      }
      console.error(`fcm push failed ${response.status} ${code ?? ""} for ${deviceToken.slice(0, 8)}…`);
      return "failed";
    },
  };
}
