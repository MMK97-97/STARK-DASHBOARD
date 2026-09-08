/*
  Secure UPS + FedEx tracking proxy for Cloudflare Workers.

  Required secrets:
    UPS_CLIENT_ID
    UPS_CLIENT_SECRET
    FEDEX_CLIENT_ID
    FEDEX_CLIENT_SECRET

  Recommended variable:
    ALLOWED_ORIGIN=https://mmk97-97.github.io

  Optional variable:
    CARRIER_ENV=production   (use "sandbox" only while testing)
*/

const tokenCache = {
  UPS: null,
  FEDEX: null
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/track") {
      return json({ error: "Not found." }, 404, cors);
    }

    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed." }, 403, cors);
    }

    try {
      const body = await request.json();
      const carrier = String(body.carrier || "").toUpperCase();
      const trackingNumber = cleanTrackingNumber(body.trackingNumber);

      if (!['UPS', 'FEDEX'].includes(carrier)) {
        return json({ error: "Carrier must be UPS or FEDEX." }, 400, cors);
      }
      if (trackingNumber.length < 8 || trackingNumber.length > 35) {
        return json({ error: "Enter a valid tracking number." }, 400, cors);
      }

      const result = carrier === "UPS"
        ? await trackUps(trackingNumber, env)
        : await trackFedEx(trackingNumber, env);

      return json(result, 200, cors);
    } catch (error) {
      const status = Number(error.status) || 502;
      return json({ error: safeError(error) }, status, cors);
    }
  }
};

function corsHeaders(origin, allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || origin || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}

function cleanTrackingNumber(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 35);
}

function isSandbox(env) {
  return String(env.CARRIER_ENV || "production").toLowerCase() === "sandbox";
}

async function carrierToken(carrier, env) {
  const cached = tokenCache[carrier];
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;

  let response;
  if (carrier === "UPS") {
    requireSecrets(env, ["UPS_CLIENT_ID", "UPS_CLIENT_SECRET"]);
    const host = isSandbox(env) ? "https://wwwcie.ups.com" : "https://onlinetools.ups.com";
    response = await fetch(`${host}/security/v1/oauth/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${env.UPS_CLIENT_ID}:${env.UPS_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: "grant_type=client_credentials"
    });
  } else {
    requireSecrets(env, ["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET"]);
    const host = isSandbox(env) ? "https://apis-sandbox.fedex.com" : "https://apis.fedex.com";
    response = await fetch(`${host}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.FEDEX_CLIENT_ID,
        client_secret: env.FEDEX_CLIENT_SECRET
      })
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw carrierError(payload, response.status, `${carrier} authorization failed.`);
  }

  tokenCache[carrier] = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3300) * 1000
  };
  return payload.access_token;
}

async function trackUps(trackingNumber, env) {
  const token = await carrierToken("UPS", env);
  const host = isSandbox(env) ? "https://wwwcie.ups.com" : "https://onlinetools.ups.com";
  const query = new URLSearchParams({
    locale: "en_US",
    returnSignature: "false",
    returnMilestones: "false",
    returnPOD: "false"
  });
  const response = await fetch(`${host}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?${query}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "transId": crypto.randomUUID(),
      "transactionSrc": "stark-premium-dashboard"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw carrierError(payload, response.status, "UPS tracking is unavailable.");
  return normalizeUps(payload, trackingNumber);
}

async function trackFedEx(trackingNumber, env) {
  const token = await carrierToken("FEDEX", env);
  const host = isSandbox(env) ? "https://apis-sandbox.fedex.com" : "https://apis.fedex.com";
  const response = await fetch(`${host}/track/v1/trackingnumbers`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-locale": "en_US"
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw carrierError(payload, response.status, "FedEx tracking is unavailable.");
  return normalizeFedEx(payload, trackingNumber);
}

function normalizeUps(payload, fallbackNumber) {
  const shipment = payload?.trackResponse?.shipment?.[0] || {};
  const parcel = shipment?.package?.[0] || {};
  const activities = Array.isArray(parcel.activity) ? parcel.activity : [];
  const deliveryDates = Array.isArray(parcel.deliveryDate) ? parcel.deliveryDate : [];
  const scheduled = deliveryDates.find(item => item.type === "SDD" || item.type === "DEL") || deliveryDates[0];
  const delivered = deliveryDates.find(item => item.type === "DEL");

  const events = activities.map(activity => ({
    date: upsDateTime(activity.date, activity.time),
    description: activity?.status?.description || activity?.status?.type || "Carrier scan",
    location: formatAddress(activity?.location?.address)
  })).filter(event => event.date || event.description);

  return {
    carrier: "UPS",
    trackingNumber: parcel.trackingNumber || fallbackNumber,
    status: parcel?.currentStatus?.description || activities[0]?.status?.description || "Status unavailable",
    statusCode: parcel?.currentStatus?.code || activities[0]?.status?.code || "",
    estimatedDelivery: upsDateTime(scheduled?.date, scheduled?.time),
    actualDelivery: upsDateTime(delivered?.date, delivered?.time),
    lastUpdated: events[0]?.date || null,
    service: shipment?.service?.levelDescription || shipment?.service?.description || "UPS",
    origin: formatAddress(shipment?.shipFrom?.address || shipment?.pickupDate),
    destination: formatAddress(shipment?.shipTo?.address),
    events
  };
}

function normalizeFedEx(payload, fallbackNumber) {
  const result = payload?.output?.completeTrackResults?.[0]?.trackResults?.[0] || {};
  const status = result.latestStatusDetail || {};
  const dates = Array.isArray(result.dateAndTimes) ? result.dateAndTimes : [];
  const scans = Array.isArray(result.scanEvents) ? result.scanEvents : [];
  const findDate = types => dates.find(item => types.includes(item.type))?.dateTime || null;

  const events = scans.map(scan => ({
    date: scan.date || null,
    description: scan.eventDescription || scan.derivedStatus || scan.eventType || "Carrier scan",
    location: formatAddress(scan.scanLocation)
  })).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return {
    carrier: "FEDEX",
    trackingNumber: result?.trackingNumberInfo?.trackingNumber || fallbackNumber,
    status: status.statusByLocale || status.description || status.code || "Status unavailable",
    statusCode: status.code || "",
    estimatedDelivery: findDate(["ESTIMATED_DELIVERY", "COMMITMENT", "ACTUAL_TENDER"]),
    actualDelivery: findDate(["ACTUAL_DELIVERY"]),
    lastUpdated: events[0]?.date || findDate(["ACTUAL_PICKUP"]),
    service: result?.serviceDetail?.description || result?.serviceDetail?.shortDescription || "FedEx",
    origin: formatAddress(result?.originLocation?.locationContactAndAddress?.address || result?.shipperInformation?.address),
    destination: formatAddress(result?.destinationLocation?.locationContactAndAddress?.address || result?.recipientInformation?.address),
    events
  };
}

function upsDateTime(date, time) {
  if (!date) return null;
  const text = String(date).replace(/\D/g, "");
  if (text.length !== 8) return date;
  const clock = String(time || "000000").replace(/\D/g, "").padEnd(6, "0");
  return `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}T${clock.slice(0,2)}:${clock.slice(2,4)}:${clock.slice(4,6)}`;
}

function formatAddress(address) {
  if (!address || typeof address !== "object") return "";
  const city = address.city || address.cityName;
  const state = address.stateProvince || address.stateProvinceCode;
  const country = address.countryCode || address.countryName;
  return [city, state, country].filter(Boolean).join(", ");
}

function requireSecrets(env, names) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) {
    const error = new Error(`Server configuration is missing ${missing.join(" and ")}.`);
    error.status = 503;
    throw error;
  }
}

function carrierError(payload, status, fallback) {
  const message = payload?.response?.errors?.[0]?.message ||
    payload?.errors?.[0]?.message ||
    payload?.errors?.[0]?.code ||
    payload?.error_description ||
    payload?.error ||
    fallback;
  const error = new Error(message);
  error.status = status >= 400 && status < 500 ? status : 502;
  return error;
}

function safeError(error) {
  const message = String(error?.message || "Tracking service is temporarily unavailable.");
  return message.slice(0, 240);
}
