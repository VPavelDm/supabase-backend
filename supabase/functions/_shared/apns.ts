// APNs alerts over HTTP/2 with a provider token (ES256 JWT), parameterized
// per app: each app passes its bundle-id topic and its secret prefix. Apple's
// newer keys are restricted to one environment each, so an app holds a pair:
//   supabase secrets set <PREFIX>_APNS_TEAM_ID=... \
//     <PREFIX>_APNS_KEY_ID=... <PREFIX>_APNS_PRIVATE_KEY="$(cat prod.p8)" \
//     <PREFIX>_APNS_SANDBOX_KEY_ID=... <PREFIX>_APNS_SANDBOX_PRIVATE_KEY="$(cat sandbox.p8)"
// A missing key skips pushes for that environment silently — callers keep
// working.

export interface Device {
  device_token: string;
  environment: "sandbox" | "production";
  locale: string;
}

export type PushResult = "ok" | "gone" | "failed" | "skipped";

/// Either the text itself, or keys the app looks up in its own strings so
/// the push arrives in the phone's language.
export type Alert =
  | { title: string; body: string }
  | { "title-loc-key": string; "loc-key": string; "loc-args"?: string[] };

export interface APNsClient {
  /// Sends one alert; "gone" means APNs no longer knows the token and the
  /// caller should delete the device row.
  push(
    device: Device,
    alert: Alert,
    extra?: Record<string, string>,
  ): Promise<PushResult>;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function makeAPNs(config: { topic: string; secretPrefix: string }): APNsClient {
  // Apple allows a provider JWT to live up to an hour; reuse it across
  // invocations of a warm function instance.
  const cachedJWT: Partial<
    Record<Device["environment"], { value: string; issuedAt: number }>
  > = {};

  async function providerJWT(environment: Device["environment"]): Promise<string | null> {
    const teamID = Deno.env.get(`${config.secretPrefix}_APNS_TEAM_ID`);
    const prefix = environment === "sandbox"
      ? `${config.secretPrefix}_APNS_SANDBOX`
      : `${config.secretPrefix}_APNS`;
    const keyID = Deno.env.get(`${prefix}_KEY_ID`);
    const pem = Deno.env.get(`${prefix}_PRIVATE_KEY`);
    if (!teamID || !keyID || !pem) return null;
    const cached = cachedJWT[environment];
    if (cached && Date.now() - cached.issuedAt < 45 * 60 * 1000) {
      return cached.value;
    }

    const der = Uint8Array.from(
      atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
      (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const encode = (value: unknown) =>
      base64url(new TextEncoder().encode(JSON.stringify(value)));
    const unsigned = `${encode({ alg: "ES256", kid: keyID })}.${
      encode({ iss: teamID, iat: Math.floor(Date.now() / 1000) })
    }`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    );
    const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;
    cachedJWT[environment] = { value: jwt, issuedAt: Date.now() };
    return jwt;
  }

  return {
    async push(device, alert, extra = {}) {
      const jwt = await providerJWT(device.environment);
      if (!jwt) return "skipped";

      const host = device.environment === "sandbox"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com";
      const res = await fetch(`https://${host}/3/device/${device.device_token}`, {
        method: "POST",
        headers: {
          "authorization": `bearer ${jwt}`,
          "apns-topic": config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        body: JSON.stringify({
          aps: { alert, sound: "default" },
          ...extra,
        }),
      });
      if (res.ok) return "ok";

      const body = await res.json().catch(() => ({}));
      console.error("apns push failed", res.status, body?.reason);
      const gone = res.status === 410 ||
        ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]
          .includes(body?.reason);
      return gone ? "gone" : "failed";
    },
  };
}
