// What each subscription in Lyncil's App Store group buys, by its level in
// the group (Pavel, 2026-10-18): level 1 is the songs plans; every other
// level is lyrics only: 2 for the lyrics plans on sale, 3 and beyond for
// the ones no longer offered. The levels and billing periods come from the App Store Connect
// API and are kept in lyncil.store_products, so a song check reads a table,
// not Apple.
//
// The whole table is refreshed when it is 30 days old, or when a product is
// missing from it (a new plan), at most every 10 minutes so a stray id can't
// send every request to Apple. A refresh that fails leaves the table as it
// was; the caller falls back to the lists in song-quota.ts.
//
// Needs an App Store Connect API key that can read the app's subscriptions
// (the most limited role that can; it never writes):
//   LYNCIL_ASC_KEY_ID, LYNCIL_ASC_ISSUER_ID, LYNCIL_ASC_PRIVATE_KEY (the .p8's PEM text)

import { sql } from "../_shared/db.ts";

/// "Lyncil Subscriptions" in App Store Connect.
const SUBSCRIPTION_GROUP_ID = "21261761";
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const UNKNOWN_REFRESH_AFTER_MS = 10 * 60 * 1000;
/// Any number, shared by every function instance, so one refresh runs at a time.
const REFRESH_LOCK = 72_026_101;

export const SONGS_LEVEL = 1;

export interface StoreProduct {
  productId: string;
  groupLevel: number;
  /// App Store Connect's subscriptionPeriod: ONE_WEEK, ONE_MONTH, ONE_YEAR…
  period: string | null;
}

/// The product's level and period, refreshing the table first when it is
/// due. Null when the product isn't in the group, or Apple couldn't be asked
/// and the table doesn't have it.
export async function storeProduct(productId: string, now = new Date()): Promise<StoreProduct | null> {
  let { product, refreshedAt } = await lookup(productId);
  const age = refreshedAt ? now.getTime() - refreshedAt.getTime() : Infinity;
  if (age > REFRESH_AFTER_MS || (!product && age > UNKNOWN_REFRESH_AFTER_MS)) {
    try {
      await refresh();
      ({ product } = await lookup(productId));
    } catch (error) {
      console.error("store products refresh failed", error);
    }
  }
  return product;
}

async function lookup(productId: string): Promise<{ product: StoreProduct | null; refreshedAt: Date | null }> {
  const rows = await sql`
    select
      (select max(refreshed_at) from lyncil.store_products) as refreshed_at,
      p.product_id, p.group_level, p.period
    from (select 1) one
    left join lyncil.store_products p on p.product_id = ${productId}`;
  const row = rows[0];
  return {
    product: row?.product_id
      ? { productId: row.product_id, groupLevel: Number(row.group_level), period: row.period }
      : null,
    refreshedAt: row?.refreshed_at ? new Date(row.refreshed_at) : null,
  };
}

/// Replaces the table with what App Store Connect lists now. A refresh
/// already running elsewhere is left to finish instead.
async function refresh(): Promise<void> {
  const products = await fetchGroup();
  if (products.length === 0) throw new Error("App Store Connect listed no subscriptions");
  await sql.begin(async (tx) => {
    const [{ locked }] = await tx`select pg_try_advisory_xact_lock(${REFRESH_LOCK}) as locked`;
    if (!locked) return;
    await tx`delete from lyncil.store_products`;
    for (const product of products) {
      await tx`
        insert into lyncil.store_products (product_id, group_level, period, state, refreshed_at)
        values (${product.productId}, ${product.groupLevel}, ${product.period}, ${product.state}, now())`;
    }
  });
  console.log(`store products refreshed: ${products.length}`);
}

interface ListedProduct extends StoreProduct {
  state: string | null;
}

async function fetchGroup(): Promise<ListedProduct[]> {
  const token = await ascToken();
  const products: ListedProduct[] = [];
  let url: string | null = `https://api.appstoreconnect.apple.com/v1/subscriptionGroups/${SUBSCRIPTION_GROUP_ID}` +
    "/subscriptions?limit=200&fields[subscriptions]=productId,groupLevel,subscriptionPeriod,state";
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`App Store Connect returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body: { data?: { attributes?: Record<string, unknown> }[]; links?: { next?: string } } = await res.json();
    for (const item of body.data ?? []) {
      const a = item.attributes ?? {};
      if (typeof a.productId !== "string" || typeof a.groupLevel !== "number") continue;
      products.push({
        productId: a.productId,
        groupLevel: a.groupLevel,
        period: typeof a.subscriptionPeriod === "string" ? a.subscriptionPeriod : null,
        state: typeof a.state === "string" ? a.state : null,
      });
    }
    url = body.links?.next ?? null;
  }
  return products;
}

/// A 10-minute App Store Connect token, signed ES256 with the API key.
async function ascToken(): Promise<string> {
  const keyId = Deno.env.get("LYNCIL_ASC_KEY_ID");
  const issuer = Deno.env.get("LYNCIL_ASC_ISSUER_ID");
  const pem = Deno.env.get("LYNCIL_ASC_PRIVATE_KEY");
  if (!keyId || !issuer || !pem) throw new Error("LYNCIL_ASC_KEY_ID, LYNCIL_ASC_ISSUER_ID or LYNCIL_ASC_PRIVATE_KEY not set");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({
    iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1",
  })}`;
  // WebCrypto's ECDSA signature is already the r||s pair a JWT wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
