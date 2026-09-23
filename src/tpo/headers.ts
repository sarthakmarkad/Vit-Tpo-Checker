/**
 * Exact, ordered, browser-identical header set shared by the login flow and
 * every API request. Order and completeness matter: the server fingerprints
 * requests, so login and subsequent calls must present identical shapes.
 */

export interface BrowserHeaderArgs {
  auth: {
    epsUid: string;
    epsTenant: string;
    deviceSignature: string | null;
    requestTimestamp: string | null;
    cookieHeader: string | null;
  };
  routerPath: string;
  hasBody: boolean;
  userAgent?: string;
}

export const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/**
 * Returns headers as an ordered array of [name, value] so the wire order is
 * deterministic and identical between the login request and API requests.
 */
export function buildOrderedHeaders(args: BrowserHeaderArgs): Array<[string, string]> {
  const { auth, routerPath, hasBody } = args;
  const ua = args.userAgent ?? CHROME_UA;
  const headers: Array<[string, string]> = [
    ["accept", "application/json, text/plain, */*"],
    ["accept-language", "en-US,en;q=0.9"],
    ["eps-purpose", "API Call"],
    ["eps-tenant", auth.epsTenant],
    ["eps-uid", auth.epsUid],
    ["origin", "https://tpo.vierp.in"],
    ["priority", "u=1, i"],
    ["referer", "https://tpo.vierp.in/"],
    ["router-path", routerPath],
    ["sec-ch-ua", '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"'],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-platform", '"macOS"'],
    ["sec-fetch-dest", "empty"],
    ["sec-fetch-mode", "cors"],
    ["sec-fetch-site", "same-site"],
    ["user-agent", ua],
  ];
  if (auth.deviceSignature) {
    headers.push(["x-device-signature", auth.deviceSignature]);
  }
  if (auth.requestTimestamp) {
    headers.push(["x-request-timestamp", auth.requestTimestamp]);
  }
  if (auth.cookieHeader) {
    headers.push(["cookie", auth.cookieHeader]);
  }
  if (hasBody) {
    headers.push(["content-type", "application/json;charset=UTF-8"]);
  }
  return headers;
}
