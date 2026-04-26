/**
 * Phase 7 observability: Prometheus metrics without the prom-client dep.
 *
 * We emit the text-exposition format (Prometheus 0.0.4 spec) directly.
 * Adding prom-client as a dependency was rejected because it pulls in a
 * runtime HTTP server by default, which conflicts with Cortex's single-port
 * MCP stdio transport. Our emitter covers the subset of metric types we
 * actually need (counter, histogram, gauge).
 *
 * Metrics exposed:
 *   cortex_tool_calls_total{tool, status}
 *     Counter — successful vs failed tool calls per tool name.
 *
 *   cortex_tool_duration_seconds{tool}
 *     Histogram — per-tool call latency (buckets: 0.01, 0.05, 0.1, 0.5, 1,
 *     5, 10, 30, 60, +Inf). Wired from safeHandler.
 *
 *   cortex_memories_total
 *     Gauge — current memory count.
 *
 *   cortex_pool_checkouts_total{pool}
 *     Counter — successful connection acquisitions per pool.
 *
 *   cortex_pool_timeouts_total{pool}
 *     Counter — acquisition timeouts per pool.
 *
 * source: Prometheus text format 0.0.4:
 *   https://prometheus.io/docs/instrumenting/exposition_formats/
 * source: docs/program/phase-5-pool-admission-design.md §7.
 *
 * Port of: mcp_server/observability/metrics.py
 */

// Histograms — per-tool bucket tallies. Upper bounds in seconds.
const BUCKETS: readonly number[] = [0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0];

// Counters keyed by "<name>\x00<labelsKey>" → count
const counters = new Map<string, number>();
// Gauges keyed by "<name>\x00<labelsKey>" → value
const gauges = new Map<string, number>();
// Histogram bucket counts: "<name>\x00<labelsKey>\x00<upperBound>" → count
const histBuckets = new Map<string, number>();
// Histogram sums: "<name>\x00<labelsKey>" → sum
const histSums = new Map<string, number>();

function labelsKey(labels: Readonly<Record<string, string>> | null | undefined): string {
  if (!labels) return "";
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function metricKey(name: string, labels?: Readonly<Record<string, string>> | null): string {
  return `${name}\x00${labelsKey(labels)}`;
}

/** Increment a counter by `value` (default 1). */
export function incCounter(
  name: string,
  labels?: Readonly<Record<string, string>> | null,
  value = 1,
): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + value);
}

/** Set a gauge to the given value. */
export function setGauge(
  name: string,
  value: number,
  labels?: Readonly<Record<string, string>> | null,
): void {
  gauges.set(metricKey(name, labels), value);
}

/** Record one observation into the histogram for `name`. */
export function observeHistogram(
  name: string,
  valueSeconds: number,
  labels?: Readonly<Record<string, string>> | null,
): void {
  const lk = labelsKey(labels);
  const sumKey = `${name}\x00${lk}`;
  histSums.set(sumKey, (histSums.get(sumKey) ?? 0) + valueSeconds);
  for (const b of BUCKETS) {
    if (valueSeconds <= b) {
      const bk = `${name}\x00${lk}\x00${b}`;
      histBuckets.set(bk, (histBuckets.get(bk) ?? 0) + 1);
    }
  }
  const infKey = `${name}\x00${lk}\x00Inf`;
  histBuckets.set(infKey, (histBuckets.get(infKey) ?? 0) + 1);
}

/** Context object that observes elapsed wall time into a histogram on stop(). */
export class Timer {
  private readonly name: string;
  private readonly labels: Readonly<Record<string, string>> | null;
  private t0: number = 0;

  constructor(name: string, labels?: Readonly<Record<string, string>> | null) {
    this.name = name;
    this.labels = labels ?? null;
  }

  start(): this {
    this.t0 = performance.now();
    return this;
  }

  stop(): void {
    observeHistogram(this.name, (performance.now() - this.t0) / 1000, this.labels);
  }
}

// ── Exposition ───────────────────────────────────────────────────────────────

function renderLabels(lk: string): string {
  if (!lk) return "";
  const pairs = lk.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    return `${k}="${v}"`;
  });
  return `{${pairs.join(",")}}`;
}

/**
 * Render all metrics in Prometheus text format 0.0.4.
 *
 * Returns a string suitable for writing to an HTTP response whose
 * Content-Type is `text/plain; version=0.0.4; charset=utf-8`.
 *
 * source: Prometheus text format 0.0.4:
 *   https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function render(): string {
  const lines: string[] = [];

  // Counters
  const counterNames = new Set<string>();
  for (const key of counters.keys()) counterNames.add(key.split("\x00")[0] ?? "");
  for (const name of Array.from(counterNames).sort()) {
    lines.push(`# TYPE ${name} counter`);
    for (const [key, v] of counters) {
      const [n, lk] = key.split("\x00") as [string, string];
      if (n === name) lines.push(`${name}${renderLabels(lk)} ${v}`);
    }
  }

  // Gauges
  const gaugeNames = new Set<string>();
  for (const key of gauges.keys()) gaugeNames.add(key.split("\x00")[0] ?? "");
  for (const name of Array.from(gaugeNames).sort()) {
    lines.push(`# TYPE ${name} gauge`);
    for (const [key, v] of gauges) {
      const [n, lk] = key.split("\x00") as [string, string];
      if (n === name) lines.push(`${name}${renderLabels(lk)} ${v}`);
    }
  }

  // Histograms
  const histNames = new Set<string>();
  for (const key of histBuckets.keys()) histNames.add(key.split("\x00")[0] ?? "");
  for (const name of Array.from(histNames).sort()) {
    lines.push(`# TYPE ${name} histogram`);
    const labelSets = new Set<string>();
    for (const key of histBuckets.keys()) {
      const parts = key.split("\x00");
      if (parts[0] === name) labelSets.add(parts[1] ?? "");
    }
    for (const lk of Array.from(labelSets).sort()) {
      for (const b of [...BUCKETS, Infinity]) {
        const bStr = b === Infinity ? "Inf" : String(b);
        const count = histBuckets.get(`${name}\x00${lk}\x00${bStr}`) ?? 0;
        const le = b === Infinity ? "+Inf" : String(b);
        const bucketLabels = lk ? `${lk},le="${le}"` : `le="${le}"`;
        lines.push(`${name}_bucket{${bucketLabels.replace(/"/g, '"')}} ${count}`);
      }
      lines.push(`${name}_sum${renderLabels(lk)} ${histSums.get(`${name}\x00${lk}`) ?? 0}`);
      const total = histBuckets.get(`${name}\x00${lk}\x00Inf`) ?? 0;
      lines.push(`${name}_count${renderLabels(lk)} ${total}`);
    }
  }

  lines.push(""); // trailing newline per Prometheus spec
  return lines.join("\n");
}

/** Drop all metrics. For tests only. */
export function reset(): void {
  counters.clear();
  gauges.clear();
  histBuckets.clear();
  histSums.clear();
}
