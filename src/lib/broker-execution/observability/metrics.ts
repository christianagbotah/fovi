// ============================================================
// metrics.ts — Lightweight metrics collection for broker-execution
//
// SAFETY CONSTRAINT (mirrors trading-policy.ts & telemetry.ts):
//   - No credentials in metric labels or values
//   - Labels are validated via redactForTelemetry() before
//     recording to prevent accidental credential leakage
//   - Metric names follow Prometheus naming conventions
//
// METRIC TYPES:
//   Counter  — Monotonically increasing (e.g., request count)
//   Gauge    — Point-in-time value (e.g., active connections)
//   Histogram — Distribution of observations (e.g., latency)
//
// PRE-REGISTERED METRICS:
//   All broker-execution subsystem metrics are pre-registered
//   on the `metrics` singleton for immediate use. Additional
//   metrics can be registered at runtime if needed.
//
// USAGE:
//   import { metrics } from '@/lib/broker-execution/observability/metrics';
//   metrics.increment('broker_connection_total', { provider: 'demo' });
//   metrics.set('broker_connection_active', 3, { provider: 'demo' });
//   metrics.observe('execution_latency_ms', 42.5, { operation: 'placeOrder' });
// ============================================================

import { redactForTelemetry } from './telemetry';

// ── Label type ──

/**
 * Metric labels for dimensional data.
 * Keys and values are strings. All labels are redacted
 * via redactForTelemetry() before recording to prevent
 * credential leakage.
 */
export type MetricLabels = Record<string, string>;

// ── Label key for map entries ──

/**
 * Create a stable cache key from labels.
 * Labels are sorted by key for deterministic ordering.
 */
function labelsKey(labels: MetricLabels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join(',');
}

// ── Counter ──

/**
 * A monotonically increasing counter.
 * Use for: request counts, error counts, event totals.
 *
 * Values can only increase (increment) or be reset to zero.
 * Decrementing is not supported.
 */
class Counter {
  readonly type = 'counter' as const;
  private values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly description: string,
  ) {}

  /**
   * Increment the counter by a positive amount.
   * @throws if amount is negative or zero
   */
  increment(labels: MetricLabels, amount: number = 1): void {
    if (amount <= 0) {
      throw new Error(`Counter ${this.name}: increment amount must be positive, got ${amount}`);
    }
    const key = labelsKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + amount);
  }

  /**
   * Get the current value for the given labels.
   */
  value(labels: MetricLabels): number {
    return this.values.get(labelsKey(labels)) ?? 0;
  }

  /**
   * Get all label-value pairs.
   */
  all(): Array<{ labels: MetricLabels; value: number }> {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      labels: this.parseKey(key),
      value,
    }));
  }

  /**
   * Reset the counter to zero for all label combinations.
   */
  reset(): void {
    this.values.clear();
  }

  private parseKey(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    for (const part of key.split(',')) {
      const eq = part.indexOf('=');
      if (eq >= 0) {
        labels[part.substring(0, eq)] = part.substring(eq + 1);
      }
    }
    return labels;
  }
}

// ── Gauge ──

/**
 * A point-in-time value that can increase or decrease.
 * Use for: active connections, queue depth, current temperature.
 *
 * Values can be set to any number (positive, negative, zero).
 */
class Gauge {
  readonly type = 'gauge' as const;
  private values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly description: string,
  ) {}

  /**
   * Set the gauge to a specific value.
   */
  set(labels: MetricLabels, value: number): void {
    this.values.set(labelsKey(labels), value);
  }

  /**
   * Get the current value for the given labels.
   */
  value(labels: MetricLabels): number {
    return this.values.get(labelsKey(labels)) ?? 0;
  }

  /**
   * Get all label-value pairs.
   */
  all(): Array<{ labels: MetricLabels; value: number }> {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      labels: this.parseKey(key),
      value,
    }));
  }

  /**
   * Reset the gauge (remove all label combinations).
   */
  reset(): void {
    this.values.clear();
  }

  private parseKey(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    for (const part of key.split(',')) {
      const eq = part.indexOf('=');
      if (eq >= 0) {
        labels[part.substring(0, eq)] = part.substring(eq + 1);
      }
    }
    return labels;
  }
}

// ── Histogram ──

/**
 * A distribution of observed values.
 * Use for: latency, request sizes, response sizes.
 *
 * Tracks count, sum, min, max, and configurable percentile
 * buckets. Default buckets follow Prometheus conventions
 * for latency histograms (in milliseconds).
 */
class Histogram {
  readonly type = 'histogram' as const;
  private observations = new Map<string, {
    count: number;
    sum: number;
    min: number;
    max: number;
    buckets: Map<number, number>; // upper bound → count
  }>();

  constructor(
    readonly name: string,
    readonly description: string,
    readonly bucketBounds: number[],
  ) {}

  /**
   * Observe a value.
   * Increments the appropriate bucket(s), count, and sum.
   */
  observe(labels: MetricLabels, value: number): void {
    const key = labelsKey(labels);
    let obs = this.observations.get(key);
    if (!obs) {
      obs = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map(this.bucketBounds.map((b) => [b, 0])),
      };
      this.observations.set(key, obs);
    }

    obs.count++;
    obs.sum += value;
    obs.min = Math.min(obs.min, value);
    obs.max = Math.max(obs.max, value);

    // Increment all buckets where value <= upper bound
    for (const bound of this.bucketBounds) {
      if (value <= bound) {
        obs.buckets.set(bound, (obs.buckets.get(bound) ?? 0) + 1);
      }
    }
  }

  /**
   * Get the current statistics for the given labels.
   */
  value(labels: MetricLabels): {
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    buckets: Array<{ upperBound: number; count: number }>;
  } {
    const key = labelsKey(labels);
    const obs = this.observations.get(key);
    if (!obs) {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        mean: 0,
        buckets: this.bucketBounds.map((b) => ({ upperBound: b, count: 0 })),
      };
    }
    return {
      count: obs.count,
      sum: obs.sum,
      min: obs.min === Infinity ? 0 : obs.min,
      max: obs.max === -Infinity ? 0 : obs.max,
      mean: obs.count > 0 ? obs.sum / obs.count : 0,
      buckets: this.bucketBounds.map((b) => ({
        upperBound: b,
        count: obs.buckets.get(b) ?? 0,
      })),
    };
  }

  /**
   * Get all label-observation pairs.
   */
  all(): Array<{ labels: MetricLabels; value: ReturnType<Histogram['value']> }> {
    return Array.from(this.observations.entries()).map(([key, _obs]) => ({
      labels: this.parseKey(key),
      value: this.value(this.parseKey(key)),
    }));
  }

  /**
   * Reset the histogram (remove all observations).
   */
  reset(): void {
    this.observations.clear();
  }

  private parseKey(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    for (const part of key.split(',')) {
      const eq = part.indexOf('=');
      if (eq >= 0) {
        labels[part.substring(0, eq)] = part.substring(eq + 1);
      }
    }
    return labels;
  }
}

// ── Metric union type ──

type Metric = Counter | Gauge | Histogram;

// ── Default histogram buckets ──

/** Default bucket bounds for latency histograms (milliseconds) */
const DEFAULT_LATENCY_BUCKETS = [
  1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/** Default bucket bounds for general histograms */
const DEFAULT_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100];

// ── Metrics registry ──

/**
 * Metrics registry for the broker-execution subsystem.
 * Pre-registers all broker-execution metrics.
 *
 * SAFETY:
 *   - Labels are redacted via redactForTelemetry() before
 *     recording to prevent credential leakage
 *   - No credential values can appear in metric data
 */
class MetricsRegistry {
  private registry = new Map<string, Metric>();

  /**
   * Register a counter metric.
   * @throws if a metric with the same name already exists
   */
  registerCounter(name: string, description: string): Counter {
    if (this.registry.has(name)) {
      throw new Error(`Metric ${name} is already registered`);
    }
    const counter = new Counter(name, description);
    this.registry.set(name, counter);
    return counter;
  }

  /**
   * Register a gauge metric.
   * @throws if a metric with the same name already exists
   */
  registerGauge(name: string, description: string): Gauge {
    if (this.registry.has(name)) {
      throw new Error(`Metric ${name} is already registered`);
    }
    const gauge = new Gauge(name, description);
    this.registry.set(name, gauge);
    return gauge;
  }

  /**
   * Register a histogram metric.
   * @throws if a metric with the same name already exists
   */
  registerHistogram(
    name: string,
    description: string,
    buckets: number[] = DEFAULT_BUCKETS,
  ): Histogram {
    if (this.registry.has(name)) {
      throw new Error(`Metric ${name} is already registered`);
    }
    const histogram = new Histogram(name, description, buckets);
    this.registry.set(name, histogram);
    return histogram;
  }

  /**
   * Get a metric by name.
   * @throws if the metric doesn't exist
   */
  get<T extends Metric>(name: string): T {
    const metric = this.registry.get(name);
    if (!metric) {
      throw new Error(`Metric ${name} is not registered`);
    }
    return metric as T;
  }

  // ── Convenience methods ──

  /**
   * Increment a counter metric.
   * Labels are redacted before recording (safety).
   *
   * @param name - Metric name
   * @param labels - Dimensional labels
   * @param amount - Increment amount (default: 1)
   */
  increment(name: string, labels: MetricLabels = {}, amount: number = 1): void {
    const safeLabels = redactForTelemetry(labels) as MetricLabels;
    const counter = this.get<Counter>(name);
    counter.increment(safeLabels, amount);
  }

  /**
   * Set a gauge metric.
   * Labels are redacted before recording (safety).
   *
   * @param name - Metric name
   * @param value - The value to set
   * @param labels - Dimensional labels
   */
  set(name: string, value: number, labels: MetricLabels = {}): void {
    const safeLabels = redactForTelemetry(labels) as MetricLabels;
    const gauge = this.get<Gauge>(name);
    gauge.set(safeLabels, value);
  }

  /**
   * Observe a value on a histogram metric.
   * Labels are redacted before recording (safety).
   *
   * @param name - Metric name
   * @param value - The observed value
   * @param labels - Dimensional labels
   */
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const safeLabels = redactForTelemetry(labels) as MetricLabels;
    const histogram = this.get<Histogram>(name);
    histogram.observe(safeLabels, value);
  }

  /**
   * Get a snapshot of all current metric values.
   * Returns a structured object suitable for exposition
   * (Prometheus text format, JSON, etc.).
   *
   * No credentials appear in the snapshot.
   */
  snapshot(): MetricsSnapshot {
    const counters: MetricsSnapshot['counters'] = {};
    const gauges: MetricsSnapshot['gauges'] = {};
    const histograms: MetricsSnapshot['histograms'] = {};

    const entries = Array.from(this.registry.entries());
    for (const [name, metric] of entries) {
      switch (metric.type) {
        case 'counter': {
          const counterAll = metric.all();
          counters[name] = {
            description: metric.description,
            values: counterAll.map((entry) => ({ labels: entry.labels, value: entry.value })),
          };
          break;
        }
        case 'gauge': {
          const gaugeAll = metric.all();
          gauges[name] = {
            description: metric.description,
            values: gaugeAll.map((entry) => ({ labels: entry.labels, value: entry.value })),
          };
          break;
        }
        case 'histogram': {
          const histAll = metric.all();
          histograms[name] = {
            description: metric.description,
            values: histAll.map((entry) => ({ labels: entry.labels, value: entry.value })),
          };
          break;
        }
      }
    }

    return { counters, gauges, histograms, timestamp: new Date().toISOString() };
  }

  /**
   * Reset all metrics to their initial state.
   * Primarily for testing — do not call in production.
   */
  reset(): void {
    const metricValues = Array.from(this.registry.values());
    for (const metric of metricValues) {
      metric.reset();
    }
  }
}

// ── Snapshot type ──

/**
 * A point-in-time snapshot of all metric values.
 * Suitable for exposition to monitoring systems.
 */
export interface MetricsSnapshot {
  timestamp: string;
  counters: Record<string, {
    description: string;
    values: Array<{ labels: MetricLabels; value: number }>;
  }>;
  gauges: Record<string, {
    description: string;
    values: Array<{ labels: MetricLabels; value: number }>;
  }>;
  histograms: Record<string, {
    description: string;
    values: Array<{ labels: MetricLabels; value: {
      count: number;
      sum: number;
      min: number;
      max: number;
      mean: number;
      buckets: Array<{ upperBound: number; count: number }>;
    } }>;
  }>;
}

// ── Create and pre-register the singleton ──

/**
 * Singleton metrics registry with pre-registered broker-execution metrics.
 *
 * Pre-registered metrics follow Prometheus naming conventions:
 *   - snake_case names
 *   - _total suffix for counters
 *   - _ms suffix for millisecond-based histograms
 *   - Unit suffixes where appropriate
 *
 * SAFETY:
 *   All label values are redacted via redactForTelemetry()
 *   before recording. No credentials can appear in metric data.
 */
const registry = new MetricsRegistry();

// ── Connection metrics ──
registry.registerCounter(
  'broker_connection_total',
  'Total number of broker connection attempts',
);
registry.registerGauge(
  'broker_connection_active',
  'Number of currently active broker connections',
);
registry.registerCounter(
  'broker_connection_errors',
  'Total number of broker connection errors',
);

// ── Execution metrics ──
registry.registerCounter(
  'execution_commands_total',
  'Total number of execution commands submitted',
);
registry.registerCounter(
  'execution_commands_blocked',
  'Total number of execution commands blocked by policy',
);
registry.registerCounter(
  'execution_commands_approved',
  'Total number of execution commands approved for execution',
);

// ── Latency metrics ──
registry.registerHistogram(
  'execution_latency_ms',
  'Execution latency in milliseconds',
  DEFAULT_LATENCY_BUCKETS,
);

// ── Gate decision metrics ──
registry.registerCounter(
  'execution_gate_decisions',
  'Total number of policy gate decisions',
);

// ── Idempotency metrics ──
registry.registerCounter(
  'idempotency_hits_total',
  'Total number of idempotency key lookups',
);
registry.registerCounter(
  'idempotency_duplicates_total',
  'Total number of duplicate commands rejected by idempotency',
);

// ── Reconciliation metrics ──
registry.registerCounter(
  'reconciliation_runs_total',
  'Total number of reconciliation runs',
);
registry.registerCounter(
  'reconciliation_discrepancies_total',
  'Total number of discrepancies detected during reconciliation',
);

// ── Kill switch metrics ──
registry.registerCounter(
  'kill_switch_activations_total',
  'Total number of kill switch activations',
);
registry.registerCounter(
  'kill_switch_deactivations_total',
  'Total number of kill switch deactivations',
);

// ── Quote freshness metrics ──
registry.registerHistogram(
  'quote_freshness_ms',
  'Quote age in milliseconds (freshness)',
  DEFAULT_LATENCY_BUCKETS,
);

// ── Adapter error metrics ──
registry.registerCounter(
  'adapter_errors_total',
  'Total number of broker adapter errors',
);

/**
 * Pre-registered metrics singleton for the broker-execution subsystem.
 *
 * Usage:
 *   import { metrics } from '@/lib/broker-execution/observability/metrics';
 *
 *   // Increment a counter
 *   metrics.increment('broker_connection_total', { provider: 'demo' });
 *
 *   // Set a gauge
 *   metrics.set('broker_connection_active', 3, { provider: 'demo' });
 *
 *   // Observe a histogram value
 *   metrics.observe('execution_latency_ms', 42.5, { operation: 'placeOrder' });
 *
 *   // Get a snapshot of all metrics
 *   const snapshot = metrics.snapshot();
 *
 *   // Reset all metrics (testing only)
 *   metrics.reset();
 */
export const metrics = registry;

// ── Export metric types for external use ──

export type { Counter, Gauge, Histogram };
