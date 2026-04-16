import http from "k6/http";
import encoding from "k6/encoding";
import exec from "k6/execution";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.KOKO_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const uploadFilePath = __ENV.KOKO_UPLOAD_FILE;
if (!uploadFilePath) {
  throw new Error("缺少 KOKO_UPLOAD_FILE；请传入要压测的大视频文件路径。");
}

const fileBytes = open(uploadFilePath, "b");
const fileByteLength = fileBytes.byteLength;
const fileName = (() => {
  const parts = uploadFilePath.split(/[\\/]/);
  return parts[parts.length - 1] || "bench.mp4";
})();
const mimeType = __ENV.KOKO_UPLOAD_MIME_TYPE || "video/mp4";
const vus = Number(__ENV.KOKO_BENCH_VUS || "1");
const iterationsPerVu = Number(__ENV.KOKO_BENCH_ITERATIONS_PER_VU || "1");
const requestTimeout = __ENV.KOKO_REQUEST_TIMEOUT || "30m";

const bootstrapDuration = new Trend("bootstrap_duration_ms");
const prepareDuration = new Trend("prepare_duration_ms");
const tusCreateDuration = new Trend("tus_create_duration_ms");
const tusPatchDuration = new Trend("tus_patch_duration_ms");
const completeDuration = new Trend("complete_duration_ms");
const endToEndDuration = new Trend("end_to_end_duration_ms");
const uploadedBytes = new Counter("uploaded_bytes");
const uploadCompleteSuccess = new Rate("upload_complete_success");

export const options = {
  scenarios: {
    media_upload: {
      executor: "per-vu-iterations",
      vus,
      iterations: iterationsPerVu,
      maxDuration: __ENV.KOKO_BENCH_MAX_DURATION || "60m",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    upload_complete_success: ["rate==1"],
  },
};

function jsonHeaders(extra = {}) {
  return {
    headers: {
      "Content-Type": "application/json",
      ...extra,
    },
    timeout: requestTimeout,
  };
}

function buildTusMetadata(metadata) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${encoding.b64encode(String(value), "std")}`)
    .join(",");
}

function resolveTusLocation(tusEndpoint, location) {
  if (location.startsWith("http://") || location.startsWith("https://")) {
    return location;
  }
  if (location.startsWith("/")) {
    const origin = tusEndpoint.replace(/\/files\/?$/, "");
    return `${origin}${location}`;
  }
  return `${tusEndpoint.replace(/\/+$/, "")}/${location}`;
}

function mustParseJson(response, context) {
  try {
    return response.json();
  } catch (error) {
    throw new Error(`${context} 返回了非 JSON 响应: ${error}`);
  }
}

function summarizeTrend(metrics, name) {
  const values = metrics[name]?.values;
  if (!values) {
    return null;
  }
  return {
    avg: values.avg,
    min: values.min,
    med: values.med,
    p90: values["p(90)"] ?? values.p90,
    p95: values["p(95)"] ?? values.p95,
    max: values.max,
  };
}

export default function () {
  const startedAt = Date.now();
  const tokenSuffix = `${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${startedAt}`;

  const bootstrapResponse = http.post(
    `${baseUrl}/api/session/bootstrap`,
    JSON.stringify({
      device_anonymous_token: `bench-media-upload-${tokenSuffix}`,
    }),
    jsonHeaders(),
  );
  bootstrapDuration.add(bootstrapResponse.timings.duration);
  check(bootstrapResponse, {
    "bootstrap 返回 200": (response) => response.status === 200,
  });
  const bootstrapBody = mustParseJson(bootstrapResponse, "bootstrap");
  const sessionId = bootstrapBody.session_id;

  const prepareResponse = http.post(
    `${baseUrl}/api/media/video/prepare`,
    JSON.stringify({
      session_id: sessionId,
      file_name: fileName,
      mime_type: mimeType,
      byte_size: fileByteLength,
    }),
    jsonHeaders(),
  );
  prepareDuration.add(prepareResponse.timings.duration);
  check(prepareResponse, {
    "prepare 返回 200": (response) => response.status === 200,
  });
  const prepareBody = mustParseJson(prepareResponse, "prepare");

  const createResponse = http.request("POST", prepareBody.tus_endpoint, null, {
    headers: {
      "Tus-Resumable": "1.0.0",
      Authorization: prepareBody.tus_headers.Authorization,
      "Upload-Length": String(fileByteLength),
      "Upload-Metadata": buildTusMetadata(prepareBody.tus_metadata),
    },
    redirects: 0,
    timeout: requestTimeout,
  });
  tusCreateDuration.add(createResponse.timings.duration);
  check(createResponse, {
    "tus create 返回 201": (response) => response.status === 201,
    "tus create 带 Location": (response) => Boolean(response.headers.Location),
  });
  const uploadUrl = resolveTusLocation(prepareBody.tus_endpoint, createResponse.headers.Location);

  const patchResponse = http.request("PATCH", uploadUrl, fileBytes, {
    headers: {
      "Tus-Resumable": "1.0.0",
      Authorization: prepareBody.tus_headers.Authorization,
      "Upload-Offset": "0",
      "Content-Type": "application/offset+octet-stream",
    },
    timeout: requestTimeout,
  });
  tusPatchDuration.add(patchResponse.timings.duration);
  check(patchResponse, {
    "tus patch 返回 204": (response) => response.status === 204,
    "tus patch offset 对齐文件大小": (response) =>
      Number(response.headers["Upload-Offset"] || "0") === fileByteLength,
  });
  uploadedBytes.add(fileByteLength);

  const completeResponse = http.post(
    `${baseUrl}/api/media/${prepareBody.attachment_id}/complete`,
    JSON.stringify({ session_id: sessionId }),
    jsonHeaders(),
  );
  completeDuration.add(completeResponse.timings.duration);
  const completeBody = mustParseJson(completeResponse, "complete");
  const completeSucceeded = completeResponse.status === 200 && completeBody.status === "ready";
  uploadCompleteSuccess.add(completeSucceeded);
  check(completeResponse, {
    "complete 返回 200": (response) => response.status === 200,
    "complete 返回 ready": () => completeSucceeded,
  });

  endToEndDuration.add(Date.now() - startedAt);
}

export function handleSummary(data) {
  const output = {
    scenario: {
      vus,
      iterations_per_vu: iterationsPerVu,
      total_iterations: data.metrics.iterations?.values?.count ?? 0,
    },
    upload_file: {
      path: uploadFilePath,
      file_name: fileName,
      byte_size: fileByteLength,
      mime_type: mimeType,
    },
    aggregate: {
      uploaded_bytes: data.metrics.uploaded_bytes?.values?.count ?? 0,
      uploaded_mib:
        Math.round(((data.metrics.uploaded_bytes?.values?.count ?? 0) / (1024 * 1024)) * 100) /
        100,
      http_req_failed_rate: data.metrics.http_req_failed?.values?.rate ?? null,
      checks_rate: data.metrics.checks?.values?.rate ?? null,
      complete_success_rate: data.metrics.upload_complete_success?.values?.rate ?? null,
    },
    timings_ms: {
      bootstrap: summarizeTrend(data.metrics, "bootstrap_duration_ms"),
      prepare: summarizeTrend(data.metrics, "prepare_duration_ms"),
      tus_create: summarizeTrend(data.metrics, "tus_create_duration_ms"),
      tus_patch: summarizeTrend(data.metrics, "tus_patch_duration_ms"),
      complete: summarizeTrend(data.metrics, "complete_duration_ms"),
      end_to_end: summarizeTrend(data.metrics, "end_to_end_duration_ms"),
    },
  };

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const result = { stdout: serialized };
  if (__ENV.KOKO_BENCH_SUMMARY_FILE) {
    result[__ENV.KOKO_BENCH_SUMMARY_FILE] = serialized;
  }
  return result;
}
