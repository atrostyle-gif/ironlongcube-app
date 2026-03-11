/**
 * DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN から
 * access token を取得する。
 * POST https://api.dropbox.com/oauth2/token
 * grant_type=refresh_token, Basic auth with app key:secret
 */
export async function getDropboxAccessToken(): Promise<string> {
  const appKey =
    process.env.DROPBOX_APP_KEY ?? process.env["DROPBOX_APP_KEY"];
  const appSecret =
    process.env.DROPBOX_APP_SECRET ?? process.env["DROPBOX_APP_SECRET"];
  const refreshToken =
    process.env.DROPBOX_REFRESH_TOKEN ??
    process.env["DROPBOX_REFRESH_TOKEN"];

  if (!appKey || !appSecret || !refreshToken) {
    const missing: string[] = [];
    if (!appKey) missing.push("DROPBOX_APP_KEY");
    if (!appSecret) missing.push("DROPBOX_APP_SECRET");
    if (!refreshToken) missing.push("DROPBOX_REFRESH_TOKEN");
    throw new Error(`Dropbox env missing: ${missing.join(", ")}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const basic = Buffer.from(`${appKey}:${appSecret}`, "utf-8").toString(
    "base64"
  );

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    console.error("dropbox oauth2/token error:", res.status, data);
    throw new Error(
      data?.error_description ?? data?.error ?? `Token request failed (${res.status})`
    );
  }

  if (!data.access_token) {
    console.error("dropbox oauth2/token: no access_token in response", data);
    throw new Error("No access_token in Dropbox token response");
  }

  return data.access_token;
}
