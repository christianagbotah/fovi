// ============================================================
// deterministic-simulator.ts — Deterministic broker execution
// simulator for testing execution flows end-to-end
//
// ⚠️  THIS IS A SIMULATOR — NEVER USE IN PRODUCTION ⚠️
//
// DESIGN PRINCIPLES:
//   1. FULLY DETERMINISTIC: Uses a seeded Linear Congruential
//      Generator (LCG) PRNG. Same seed + same config = same
//      results every time. No Math.random() anywhere.
//   2. CLEARLY SEPARATED FROM PRODUCTION: All responses carry
//      provenance.environment = 'simulator' and isSynthetic = true.
//      The IS_SIMULATOR const can be checked at runtime.
//   3. NEVER CONNECTS EXTERNALLY: No network calls, no real
//      broker transport, no WebSocket, no HTTP. This simulator
//      is the ONLY way to test execution flows without a live
//      broker.
//   4. CONFIGURABLE CHAOS: SimConfig controls acceptance rate,
//      rejection rate, partial fills, delays, duplicate events,
//      out-of-order delivery, disconnects, timeouts, and
//      slippage. This enables deterministic testing of every
//      failure mode the reconciliation engine must handle.
// ============================================================

import type {
  BrokerAdapter,
  BrokerAdapterError,
  BrokerAccountMetadata,
  BrokerConnectionState,
  BrokerHealthStatus,
  BrokerOrder,
  BrokerPosition,
  PlaceOrderParams,
  ModifyOrderParams,
  CancelOrderParams,
  ClosePositionParams,
  PartialCloseParams,
  UpdateProtectionParams,
  Quote,
} from '@/lib/broker-execution/types';
import {
  BrokerProviderType,
  BrokerConnectionState as ConnectionStateEnum,
  EXECUTION_DISABLED,
} from '@/lib/broker-execution/types';
import type { ProviderCapabilitySet } from '@/lib/broker-execution/types/capabilities';
import type {
  ExecutionCommand,
  OrderSide,
} from '@/lib/broker-execution/types';
import {
  CommandType,
  OrderSide as OrderSideEnum,
} from '@/lib/broker-execution/types';
import { v4 as uuidv4 } from 'uuid';

// ── Runtime sentinel ──

/**
 * Runtime sentinel that can be checked to confirm this adapter
 * is a simulator and not a real broker transport. All production
 * code paths should check this before trusting any data from
 * this adapter.
 */
export const IS_SIMULATOR = true as const;

// ── Provenance marker ──

/**
 * Provenance marker attached to ALL simulator responses.
 * This makes it impossible to accidentally treat simulator
 * data as production data.
 */
const SIMULATOR_PROVENANCE = {
  environment: 'simulator' as const,
  isSynthetic: true as const,
  source: 'deterministic-simulator',
  observedAt: new Date().toISOString(),
};

// ── Simulation configuration ──

/**
 * Configuration for the deterministic simulator.
 *
 * All rates are 0–1. All times are in milliseconds.
 * The seed controls the PRNG — same seed always produces
 * the same sequence of "random" decisions.
 *
 * Defaults are "happy path" — 100% acceptance, 0% chaos.
 * Increase chaos rates to test specific failure modes.
 */
export interface SimConfig {
  /** PRNG seed. Same seed = same results. Default: 42 */
  seed: number;
  /** Probability that a command is accepted (0–1). Default: 1.0 */
  acceptanceRate: number;
  /** Probability that a command is rejected (0–1). Default: 0.0 */
  rejectionRate: number;
  /** Probability of partial fill instead of full fill (0–1). Default: 0.0 */
  partialFillRate: number;
  /** Simulated processing delay in ms. Default: 0 */
  delayMs: number;
  /** Probability of emitting duplicate fill events (0–1). Default: 0.0 */
  duplicateEvents: number;
  /** Probability of delivering events out of order (0–1). Default: 0.0 */
  reorderEvents: number;
  /** Probability of broker disconnection per operation (0–1). Default: 0.0 */
  disconnectProbability: number;
  /** Probability of broker timeout per operation (0–1). Default: 0.0 */
  timeoutProbability: number;
  /** Slippage in basis points applied to fill prices. Default: 0 */
  slippageBps: number;
}

const DEFAULT_CONFIG: SimConfig = {
  seed: 42,
  acceptanceRate: 1.0,
  rejectionRate: 0.0,
  partialFillRate: 0.0,
  delayMs: 0,
  duplicateEvents: 0.0,
  reorderEvents: 0.0,
  disconnectProbability: 0.0,
  timeoutProbability: 0.0,
  slippageBps: 0,
};

// ── Seeded PRNG: Linear Congruential Generator ──

/**
 * Minimal Standard LCG (Park–Miller).
 *
 *   X(n+1) = (a * X(n)) mod m
 *   a = 16807, m = 2^31 - 1 = 2147483647
 *
 * Period: 2^31 - 2 (over 2 billion values).
 * NOT cryptographically secure — fine for deterministic tests.
 */
class SeededPRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is in [1, m-1]
    this.state = (Math.abs(seed) % 2147483646) + 1;
  }

  /**
   * Return next pseudo-random integer in [1, m-1].
   */
  nextInt(): number {
    // Park–Miller: a = 16807, m = 2147483647
    this.state = (16807 * this.state) % 2147483647;
    return this.state;
  }

  /**
   * Return next pseudo-random float in [0, 1).
   */
  next(): number {
    return (this.nextInt() - 1) / 2147483646;
  }

  /**
   * Return next pseudo-random integer in [min, max] inclusive.
   */
  nextIntRange(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Return next pseudo-random float in [min, max).
   */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Bernoulli trial: returns true with the given probability.
   */
  bernoulli(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * Shuffle an array in-place using Fisher–Yates with this PRNG.
   * Returns the same array reference for convenience.
   */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextIntRange(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Get current state (for snapshotting / restoring).
   */
  getState(): number {
    return this.state;
  }

  /**
   * Restore PRNG to a specific state.
   */
  setState(state: number): void {
    this.state = state;
  }
}

// ── Simulator fill event ──

/**
 * A fill event produced by the simulator.
 * Includes the provenance marker and sequence number
 * for reconciliation testing.
 */
export interface SimFillEvent {
  /** Fill ID (deterministic) */
  fillId: string;
  /** Broker order ID this fill belongs to */
  brokerOrderId: string;
  /** Symbol */
  symbol: string;
  /** Side */
  side: 'BUY' | 'SELL';
  /** Filled quantity */
  fillQty: number;
  /** Fill price (may include slippage) */
  fillPrice: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Sequence number for ordering */
  sequence: number;
  /** Provenance marker */
  provenance: {
    environment: 'simulator';
    isSynthetic: true;
    source: string;
    observedAt: string;
  };
}

// ── Simulator rejection event ──

export interface SimRejectionEvent {
  /** Broker order ID (simulated) */
  brokerOrderId: string;
  /** Symbol */
  symbol: string;
  /** Side */
  side: 'BUY' | 'SELL';
  /** Rejection reason */
  reason: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Provenance marker */
  provenance: {
    environment: 'simulator';
    isSynthetic: true;
    source: string;
    observedAt: string;
  };
}

// ── Simulator state ──

export interface SimState {
  /** Current connection state */
  connectionState: BrokerConnectionState;
  /** Open positions by position ID */
  positions: Map<string, BrokerPosition>;
  /** Orders by order ID */
  orders: Map<string, BrokerOrder>;
  /** Fill events in sequence */
  fills: SimFillEvent[];
  /** Rejection events */
  rejections: SimRejectionEvent[];
  /** All events in time order (fills + rejections) */
  events: Array<SimFillEvent | SimRejectionEvent>;
  /** Monotonic sequence counter for event ordering */
  sequenceCounter: number;
  /** Monotonic order ID counter */
  orderIdCounter: number;
  /** Monotonic fill ID counter */
  fillIdCounter: number;
  /** Monotonic position ID counter */
  positionIdCounter: number;
  /** Simulated account balance */
  balance: number;
  /** Simulated equity */
  equity: number;
  /** Seen fill IDs for duplicate detection */
  seenFillIds: Set<string>;
  /** Whether a disconnect is currently active */
  isDisconnected: boolean;
  /** Whether a timeout is currently active */
  isTimedOut: boolean;
}

// ── Simulation result ──

export interface SimExecutionResult {
  /** The broker order (if created) */
  order: BrokerOrder | null;
  /** Fill events produced (0 or more) */
  fills: SimFillEvent[];
  /** Rejection event (if rejected) */
  rejection: SimRejectionEvent | null;
  /** Whether a disconnect was simulated */
  disconnected: boolean;
  /** Whether a timeout was simulated */
  timedOut: boolean;
  /** Whether duplicate fills were emitted */
  hadDuplicateFills: boolean;
  /** Whether events were reordered */
  hadReorderedEvents: boolean;
  /** Provenance marker */
  provenance: {
    environment: 'simulator';
    isSynthetic: true;
    source: string;
    observedAt: string;
  };
}

// ── DeterministicSimulator class ──

/**
 * Deterministic simulator for the broker-execution boundary.
 *
 * This is the ONLY way to test execution flows end-to-end
 * without a live broker. It implements the BrokerAdapter
 * interface so it can be used anywhere a real adapter is
 * expected, but all responses are synthetic and carry
 * the simulator provenance marker.
 *
 * ⚠️  NEVER USE IN PRODUCTION ⚠️
 *
 * Usage:
 * ```ts
 * const sim = new DeterministicSimulator({
 *   seed: 12345,
 *   acceptanceRate: 0.8,
 *   rejectionRate: 0.1,
 *   partialFillRate: 0.2,
 *   slippageBps: 5,
 * });
 *
 * const result = sim.simulateExecution(command);
 * console.log(result.fills);
 * console.log(sim.getState());
 * ```
 */
export class DeterministicSimulator implements BrokerAdapter {
  readonly providerType: BrokerProviderType = BrokerProviderType.REST_WS;
  readonly providerId = 'simulator';

  private config: SimConfig;
  private prng: SeededPRNG;
  private state: SimState;

  // Base prices for simulation (deterministic per symbol)
  private basePrices: Map<string, number> = new Map();

  constructor(config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prng = new SeededPRNG(this.config.seed);
    this.state = this.createInitialState();
  }

  // ── Private: create initial state ──

  private createInitialState(): SimState {
    return {
      connectionState: ConnectionStateEnum.DISCONNECTED,
      positions: new Map(),
      orders: new Map(),
      fills: [],
      rejections: [],
      events: [],
      sequenceCounter: 0,
      orderIdCounter: 1000,
      fillIdCounter: 1,
      positionIdCounter: 1,
      balance: 100000,
      equity: 100000,
      seenFillIds: new Set(),
      isDisconnected: false,
      isTimedOut: false,
    };
  }

  // ── Private: get deterministic price for symbol ──

  private getSimPrice(symbol: string): number {
    if (!this.basePrices.has(symbol)) {
      // Deterministic base price from PRNG: [10, 100000]
      const base = this.prng.nextRange(10, 100000);
      this.basePrices.set(symbol, base);
    }
    const base = this.basePrices.get(symbol)!;
    // Small deterministic walk from base
    const walk = this.prng.nextRange(-0.005, 0.005);
    return base * (1 + walk);
  }

  // ── Private: apply slippage ──

  private applySlippage(price: number, side: 'BUY' | 'SELL'): number {
    if (this.config.slippageBps === 0) return price;
    const slippage = price * (this.config.slippageBps / 10000);
    // BUY fills slip up (worse), SELL fills slip down (worse)
    return side === 'BUY' ? price + slippage : price - slippage;
  }

  // ── Private: simulate delay ──

  private async simulateDelay(): Promise<void> {
    if (this.config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }
  }

  // ── Private: check for disconnection ──

  private checkDisconnect(): boolean {
    if (this.state.isDisconnected) return true;
    if (this.prng.bernoulli(this.config.disconnectProbability)) {
      this.state.isDisconnected = true;
      this.state.connectionState = ConnectionStateEnum.DISCONNECTED;
      return true;
    }
    return false;
  }

  // ── Private: check for timeout ──

  private checkTimeout(): boolean {
    if (this.state.isTimedOut) return true;
    if (this.prng.bernoulli(this.config.timeoutProbability)) {
      this.state.isTimedOut = true;
      return true;
    }
    return false;
  }

  // ── Private: next sequence number ──

  private nextSequence(): number {
    return ++this.state.sequenceCounter;
  }

  // ── Private: make provenance ──

  private makeProvenance() {
    return {
      environment: 'simulator' as const,
      isSynthetic: true as const,
      source: 'deterministic-simulator',
      observedAt: new Date().toISOString(),
    };
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC: Simulation methods (the core API for testing)
  // ══════════════════════════════════════════════════════════

  /**
   * Process an execution command deterministically.
   *
   * Based on config rates and PRNG state, the command may:
   *   - Be accepted → generate fill(s)
   *   - Be rejected → generate rejection event
   *   - Trigger a disconnect
   *   - Trigger a timeout
   *   - Generate duplicate fills
   *   - Deliver events out of order
   *
   * The result is fully deterministic for the same seed + config.
   */
  simulateExecution(command: ExecutionCommand): SimExecutionResult {
    const provenance = this.makeProvenance();
    const now = new Date().toISOString();

    // Check disconnect
    const disconnected = this.checkDisconnect();
    if (disconnected) {
      return {
        order: null,
        fills: [],
        rejection: null,
        disconnected: true,
        timedOut: false,
        hadDuplicateFills: false,
        hadReorderedEvents: false,
        provenance,
      };
    }

    // Check timeout
    const timedOut = this.checkTimeout();
    if (timedOut) {
      return {
        order: null,
        fills: [],
        rejection: null,
        disconnected: false,
        timedOut: true,
        hadDuplicateFills: false,
        hadReorderedEvents: false,
        provenance,
      };
    }

    // Determine outcome based on rates
    const roll = this.prng.next();
    const isRejected = roll < this.config.rejectionRate;
    const isAccepted = !isRejected && roll < this.config.rejectionRate + this.config.acceptanceRate;

    if (isRejected || !isAccepted) {
      // Rejection path
      const rejection = this.simulateRejection(command);
      return {
        order: null,
        fills: [],
        rejection,
        disconnected: false,
        timedOut: false,
        hadDuplicateFills: false,
        hadReorderedEvents: false,
        provenance,
      };
    }

    // Acceptance path — derive symbol/side/size from command
    const { symbol, side, size } = this.extractOrderParams(command);
    const brokerOrderId = `SIM_ORD_${++this.state.orderIdCounter}`;

    // Create the broker order
    const order: BrokerOrder = {
      id: brokerOrderId,
      symbol,
      side,
      type: command.commandType === CommandType.PLACE_MARKET ? 'MARKET' : 'LIMIT',
      size,
      price: this.getSimPrice(symbol),
      stopLoss: null,
      takeProfit: null,
      status: 'PENDING',
      fillSize: 0,
    };

    this.state.orders.set(brokerOrderId, order);

    // Generate fill(s)
    const fills = this.simulateFill(order);

    // Check for duplicate fills
    let hadDuplicateFills = false;
    if (this.prng.bernoulli(this.config.duplicateEvents) && fills.length > 0) {
      const duplicate = this.simulateDuplicateFill(fills[fills.length - 1]);
      fills.push(duplicate);
      hadDuplicateFills = true;
    }

    // Check for event reordering
    let hadReorderedEvents = false;
    if (this.prng.bernoulli(this.config.reorderEvents) && fills.length > 1) {
      this.simulateOutOfOrder(fills);
      hadReorderedEvents = true;
    }

    return {
      order,
      fills,
      rejection: null,
      disconnected: false,
      timedOut: false,
      hadDuplicateFills,
      hadReorderedEvents,
      provenance,
    };
  }

  /**
   * Generate fill(s) for an order based on partialFillRate
   * and slippageBps.
   *
   * If partialFillRate triggers, the order is partially filled
   * (random fill ratio from PRNG). Otherwise, full fill.
   */
  simulateFill(order: BrokerOrder): SimFillEvent[] {
    const now = new Date().toISOString();
    const fills: SimFillEvent[] = [];
    const price = this.getSimPrice(order.symbol);
    const fillPrice = this.applySlippage(price, order.side);

    if (this.prng.bernoulli(this.config.partialFillRate)) {
      // Partial fill: random fill ratio [0.1, 0.9]
      const fillRatio = this.prng.nextRange(0.1, 0.9);
      const partialQty = Math.max(0.01, order.size * fillRatio);

      // Round to 2 decimal places
      const fillQty = Math.round(partialQty * 100) / 100;

      const partialFill: SimFillEvent = {
        fillId: `SIM_FILL_${++this.state.fillIdCounter}`,
        brokerOrderId: order.id,
        symbol: order.symbol,
        side: order.side,
        fillQty,
        fillPrice,
        timestamp: now,
        sequence: this.nextSequence(),
        provenance: this.makeProvenance(),
      };

      fills.push(partialFill);
      this.state.fills.push(partialFill);
      this.state.events.push(partialFill);
      this.state.seenFillIds.add(partialFill.fillId);

      // Update order state
      const updatedOrder: BrokerOrder = {
        ...order,
        status: 'PARTIALLY_FILLED',
        fillSize: order.fillSize + fillQty,
      };
      this.state.orders.set(order.id, updatedOrder);

      // Generate the remaining fill (completes the order)
      const remainingQty = Math.max(0.01, order.size - fillQty);
      const remainingFill: SimFillEvent = {
        fillId: `SIM_FILL_${++this.state.fillIdCounter}`,
        brokerOrderId: order.id,
        symbol: order.symbol,
        side: order.side,
        fillQty: remainingQty,
        fillPrice,
        timestamp: now,
        sequence: this.nextSequence(),
        provenance: this.makeProvenance(),
      };

      fills.push(remainingFill);
      this.state.fills.push(remainingFill);
      this.state.events.push(remainingFill);
      this.state.seenFillIds.add(remainingFill.fillId);

      // Update order to FILLED
      const filledOrder: BrokerOrder = {
        ...updatedOrder,
        status: 'FILLED',
        fillSize: order.size,
      };
      this.state.orders.set(order.id, filledOrder);
    } else {
      // Full fill
      const fill: SimFillEvent = {
        fillId: `SIM_FILL_${++this.state.fillIdCounter}`,
        brokerOrderId: order.id,
        symbol: order.symbol,
        side: order.side,
        fillQty: order.size,
        fillPrice,
        timestamp: now,
        sequence: this.nextSequence(),
        provenance: this.makeProvenance(),
      };

      fills.push(fill);
      this.state.fills.push(fill);
      this.state.events.push(fill);
      this.state.seenFillIds.add(fill.fillId);

      // Update order to FILLED
      const filledOrder: BrokerOrder = {
        ...order,
        status: 'FILLED',
        fillSize: order.size,
      };
      this.state.orders.set(order.id, filledOrder);
    }

    // Update or create position
    this.updatePosition(order, fills);

    return fills;
  }

  /**
   * Generate a deterministic rejection event for a command.
   */
  simulateRejection(command: ExecutionCommand): SimRejectionEvent {
    const now = new Date().toISOString();
    const { symbol, side } = this.extractOrderParams(command);
    const brokerOrderId = `SIM_REJ_${++this.state.orderIdCounter}`;

    // Deterministic rejection reason based on PRNG
    const reasons = [
      'Insufficient margin',
      'Market closed',
      'Invalid order size',
      'Price not available',
      'Order rejected by broker',
      'Position limit exceeded',
    ];
    const reasonIdx = this.prng.nextIntRange(0, reasons.length - 1);

    const rejection: SimRejectionEvent = {
      brokerOrderId,
      symbol,
      side,
      reason: reasons[reasonIdx],
      timestamp: now,
      provenance: this.makeProvenance(),
    };

    this.state.rejections.push(rejection);
    this.state.events.push(rejection);

    return rejection;
  }

  /**
   * Simulate broker disconnection.
   * Sets connection state to DISCONNECTED.
   */
  simulateDisconnect(): void {
    this.state.isDisconnected = true;
    this.state.connectionState = ConnectionStateEnum.DISCONNECTED;
  }

  /**
   * Simulate reconnection with state recovery.
   * Resets disconnection flag and restores connection state.
   * In a real broker, this would re-synchronize positions/orders.
   * In the simulator, positions and orders are preserved in-memory.
   */
  simulateReconnect(): void {
    this.state.isDisconnected = false;
    this.state.isTimedOut = false;
    this.state.connectionState = ConnectionStateEnum.CONNECTED;
  }

  /**
   * Simulate broker timeout.
   * Sets timeout flag. Operations will fail until reconnect.
   */
  simulateTimeout(): void {
    this.state.isTimedOut = true;
  }

  /**
   * Reorder events deterministically using the PRNG.
   * Fisher–Yates shuffle ensures deterministic permutation.
   */
  simulateOutOfOrder<T extends { sequence: number }>(events: T[]): T[] {
    // Shuffle the events
    this.prng.shuffle(events);
    // Reassign sequence numbers to reflect new order
    for (let i = 0; i < events.length; i++) {
      events[i].sequence = this.nextSequence();
    }
    return events;
  }

  /**
   * Create a duplicate fill event from an existing fill.
   * The duplicate has a new fill ID but identical data.
   */
  simulateDuplicateFill(fill: SimFillEvent): SimFillEvent {
    const duplicate: SimFillEvent = {
      ...fill,
      fillId: `SIM_FILL_DUP_${++this.state.fillIdCounter}`,
      sequence: this.nextSequence(),
      timestamp: new Date().toISOString(),
      provenance: this.makeProvenance(),
    };

    this.state.fills.push(duplicate);
    this.state.events.push(duplicate);
    // Note: we do NOT add to seenFillIds — this is a duplicate
    // that the reconciliation engine should detect

    return duplicate;
  }

  // ── Private: extract order params from command ──

  private extractOrderParams(command: ExecutionCommand): {
    symbol: string;
    side: 'BUY' | 'SELL';
    size: number;
  } {
    switch (command.commandType) {
      case CommandType.PLACE_MARKET: {
        const cmd = command as ExecutionCommand & { symbol: string; side: OrderSide; size: number };
        return {
          symbol: cmd.symbol,
          side: cmd.side,
          size: cmd.size,
        };
      }
      case CommandType.PLACE_PENDING: {
        const cmd = command as ExecutionCommand & { symbol: string; side: OrderSide; size: number };
        return {
          symbol: cmd.symbol,
          side: cmd.side,
          size: cmd.size,
        };
      }
      case CommandType.CLOSE_POSITION:
      case CommandType.PARTIAL_CLOSE: {
        // Look up the position to determine symbol/side/size
        const cmd = command as ExecutionCommand & { brokerPositionId: string; closeSize?: number };
        const pos = this.state.positions.get(cmd.brokerPositionId);
        if (pos) {
          return {
            symbol: pos.symbol,
            side: pos.side === 'BUY' ? 'SELL' : 'BUY',
            size: cmd.closeSize ?? pos.size,
          };
        }
        // Fallback: deterministic defaults
        return { symbol: 'UNKNOWN', side: 'SELL', size: 0.01 };
      }
      case CommandType.MODIFY:
      case CommandType.CANCEL:
      case CommandType.UPDATE_PROTECTION:
        // These don't create new positions — return placeholder
        return { symbol: 'N/A', side: 'BUY', size: 0 };
      default:
        return { symbol: 'N/A', side: 'BUY', size: 0 };
    }
  }

  // ── Private: update position after fill ──

  private updatePosition(order: BrokerOrder, fills: SimFillEvent[]): void {
    const totalFillQty = fills.reduce((sum, f) => sum + f.fillQty, 0);
    if (totalFillQty === 0) return;

    const avgFillPrice = fills.reduce((sum, f) => sum + f.fillPrice * f.fillQty, 0) / totalFillQty;

    // Find existing position for this symbol
    let existingPosId: string | null = null;
    for (const [id, pos] of this.state.positions) {
      if (pos.symbol === order.symbol) {
        existingPosId = id;
        break;
      }
    }

    const positionId = existingPosId ?? `SIM_POS_${++this.state.positionIdCounter}`;

    if (existingPosId) {
      const existing = this.state.positions.get(existingPosId)!;
      if (existing.side === order.side) {
        // Same direction — increase position
        const newSize = existing.size + totalFillQty;
        const newEntry = (existing.entryPrice * existing.size + avgFillPrice * totalFillQty) / newSize;
        const currentPrice = this.getSimPrice(order.symbol);
        const pnl = order.side === 'BUY'
          ? (currentPrice - newEntry) * newSize
          : (newEntry - currentPrice) * newSize;

        this.state.positions.set(positionId, {
          ...existing,
          size: newSize,
          entryPrice: newEntry,
          currentPrice,
          pnl,
        });
      } else {
        // Opposite direction — reduce or reverse
        const closeQty = Math.min(existing.size, totalFillQty);
        const remainingExisting = existing.size - closeQty;
        const newEntry = totalFillQty - closeQty;

        if (remainingExisting > 0.001) {
          // Partial close — reduce existing position
          const currentPrice = this.getSimPrice(order.symbol);
          const pnl = existing.side === 'BUY'
            ? (currentPrice - existing.entryPrice) * remainingExisting
            : (existing.entryPrice - currentPrice) * remainingExisting;
          this.state.positions.set(positionId, {
            ...existing,
            size: remainingExisting,
            currentPrice,
            pnl,
          });
        } else if (newEntry > 0.001) {
          // Full close + open new position
          const currentPrice = this.getSimPrice(order.symbol);
          const pnl = order.side === 'BUY'
            ? (currentPrice - avgFillPrice) * newEntry
            : (avgFillPrice - currentPrice) * newEntry;
          this.state.positions.set(positionId, {
            id: positionId,
            symbol: order.symbol,
            side: order.side,
            size: newEntry,
            entryPrice: avgFillPrice,
            currentPrice,
            pnl,
            swap: 0,
          });
        } else {
          // Exact close — remove position
          this.state.positions.delete(positionId);
        }
      }
    } else {
      // New position
      const currentPrice = this.getSimPrice(order.symbol);
      const pnl = order.side === 'BUY'
        ? (currentPrice - avgFillPrice) * totalFillQty
        : (avgFillPrice - currentPrice) * totalFillQty;

      this.state.positions.set(positionId, {
        id: positionId,
        symbol: order.symbol,
        side: order.side,
        size: totalFillQty,
        entryPrice: avgFillPrice,
        currentPrice,
        pnl,
        swap: 0,
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC: State access
  // ══════════════════════════════════════════════════════════

  /**
   * Get current simulator state snapshot.
   * Returns copies of internal data structures for safety.
   */
  getState(): {
    connectionState: BrokerConnectionState;
    positions: BrokerPosition[];
    orders: BrokerOrder[];
    fills: SimFillEvent[];
    rejections: SimRejectionEvent[];
    events: Array<SimFillEvent | SimRejectionEvent>;
    balance: number;
    equity: number;
    isDisconnected: boolean;
    isTimedOut: boolean;
    seenFillIds: string[];
    prngState: number;
  } {
    return {
      connectionState: this.state.connectionState,
      positions: Array.from(this.state.positions.values()),
      orders: Array.from(this.state.orders.values()),
      fills: [...this.state.fills],
      rejections: [...this.state.rejections],
      events: [...this.state.events],
      balance: this.state.balance,
      equity: this.state.equity,
      isDisconnected: this.state.isDisconnected,
      isTimedOut: this.state.isTimedOut,
      seenFillIds: Array.from(this.state.seenFillIds),
      prngState: this.prng.getState(),
    };
  }

  /**
   * Reset simulator to initial state.
   * Reinitializes PRNG with current seed.
   */
  reset(): void {
    this.prng = new SeededPRNG(this.config.seed);
    this.state = this.createInitialState();
    this.basePrices.clear();
  }

  /**
   * Update simulation configuration.
   * If seed changes, the PRNG is re-seeded.
   */
  setConfig(config: Partial<SimConfig>): void {
    const seedChanged = config.seed !== undefined && config.seed !== this.config.seed;
    this.config = { ...this.config, ...config };
    if (seedChanged) {
      this.prng = new SeededPRNG(this.config.seed);
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): SimConfig {
    return { ...this.config };
  }

  // ══════════════════════════════════════════════════════════
  //  BrokerAdapter interface implementation
  //
  //  These methods implement the BrokerAdapter interface
  //  so the simulator can be used anywhere a real adapter
  //  is expected. ALL responses carry simulator provenance.
  // ══════════════════════════════════════════════════════════

  readonly capabilities: ProviderCapabilitySet = {
    providerId: 'simulator',
    providerType: BrokerProviderType.REST_WS,
    capabilities: new Map(),
    discoveredAt: new Date().toISOString(),
  };

  async discover(): Promise<ProviderCapabilitySet> {
    return this.capabilities;
  }

  async connect(): Promise<BrokerConnectionState> {
    this.state.connectionState = ConnectionStateEnum.CONNECTED;
    this.state.isDisconnected = false;
    this.state.isTimedOut = false;
    return ConnectionStateEnum.CONNECTED;
  }

  async disconnect(): Promise<void> {
    this.state.connectionState = ConnectionStateEnum.DISCONNECTED;
    this.state.isDisconnected = true;
  }

  async reconnect(): Promise<BrokerConnectionState> {
    this.simulateReconnect();
    return ConnectionStateEnum.CONNECTED;
  }

  async getAccountMetadata(): Promise<BrokerAccountMetadata> {
    await this.simulateDelay();
    return {
      balance: this.state.balance,
      equity: this.state.equity,
      margin: this.state.equity * 0.1,
      freeMargin: this.state.equity * 0.9,
      marginLevel: 1000,
      currency: 'USD',
      leverage: 100,
    };
  }

  async getQuote(symbol: string): Promise<Quote> {
    await this.simulateDelay();
    const price = this.getSimPrice(symbol);
    const spread = price * 0.0002; // 2 pip spread
    return {
      bid: price - spread / 2,
      ask: price + spread / 2,
      spread,
      timestamp: new Date().toISOString(),
      provenance: this.makeProvenance(),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    await this.simulateDelay();
    return Array.from(this.state.positions.values());
  }

  async getOrders(): Promise<BrokerOrder[]> {
    await this.simulateDelay();
    return Array.from(this.state.orders.values());
  }

  health(): BrokerHealthStatus {
    return {
      isHealthy: !this.state.isDisconnected && !this.state.isTimedOut,
      latencyMs: this.config.delayMs,
      lastQuoteAt: this.state.events.length > 0
        ? this.state.events[this.state.events.length - 1].timestamp
        : null,
      lastPingAt: new Date().toISOString(),
      errorRate: this.state.isDisconnected ? 1 : 0,
      reconnectCount: 0,
    };
  }

  latency(): number {
    return this.config.delayMs;
  }

  normalizeError(error: unknown): BrokerAdapterError {
    if (error instanceof Error) {
      return {
        code: error.name || 'SIM_ERROR',
        message: error.message,
        isTransient: this.state.isDisconnected || this.state.isTimedOut,
        isRateLimit: false,
        isAuthFailure: false,
      };
    }
    return {
      code: 'SIM_UNKNOWN_ERROR',
      message: String(error),
      isTransient: false,
      isRateLimit: false,
      isAuthFailure: false,
    };
  }

  // ── Execution methods ──

  async placeOrder(params: PlaceOrderParams): Promise<BrokerOrder> {
    await this.simulateDelay();

    if (this.checkDisconnect()) {
      throw new Error('[Simulator] Broker disconnected — cannot place order');
    }
    if (this.checkTimeout()) {
      throw new Error('[Simulator] Broker timeout — cannot place order');
    }

    const orderId = `SIM_ORD_${++this.state.orderIdCounter}`;
    const price = this.getSimPrice(params.symbol);

    // Determine outcome
    const roll = this.prng.next();
    if (roll < this.config.rejectionRate) {
      const order: BrokerOrder = {
        id: orderId,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        size: params.size,
        price: params.price ?? price,
        stopLoss: params.stopLoss ?? null,
        takeProfit: params.takeProfit ?? null,
        status: 'REJECTED',
        fillSize: 0,
      };
      this.state.orders.set(orderId, order);
      return order;
    }

    // Accepted — create and fill
    const fillPrice = this.applySlippage(price, params.side);

    const order: BrokerOrder = {
      id: orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      size: params.size,
      price: params.price ?? price,
      stopLoss: params.stopLoss ?? null,
      takeProfit: params.takeProfit ?? null,
      status: 'FILLED',
      fillSize: params.size,
    };

    this.state.orders.set(orderId, order);

    // Create fill event
    const fill: SimFillEvent = {
      fillId: `SIM_FILL_${++this.state.fillIdCounter}`,
      brokerOrderId: orderId,
      symbol: params.symbol,
      side: params.side,
      fillQty: params.size,
      fillPrice,
      timestamp: new Date().toISOString(),
      sequence: this.nextSequence(),
      provenance: this.makeProvenance(),
    };
    this.state.fills.push(fill);
    this.state.events.push(fill);
    this.state.seenFillIds.add(fill.fillId);
    this.updatePosition(order, [fill]);

    return order;
  }

  async modifyOrder(params: ModifyOrderParams): Promise<BrokerOrder> {
    await this.simulateDelay();
    const existing = this.state.orders.get(params.brokerOrderId);
    if (!existing) {
      throw new Error(`[Simulator] Order ${params.brokerOrderId} not found`);
    }

    const modified: BrokerOrder = {
      ...existing,
      price: params.newPrice ?? existing.price,
    };
    this.state.orders.set(params.brokerOrderId, modified);
    return modified;
  }

  async cancelOrder(params: CancelOrderParams): Promise<void> {
    await this.simulateDelay();
    const existing = this.state.orders.get(params.brokerOrderId);
    if (!existing) {
      throw new Error(`[Simulator] Order ${params.brokerOrderId} not found`);
    }

    const cancelled: BrokerOrder = {
      ...existing,
      status: 'CANCELLED',
    };
    this.state.orders.set(params.brokerOrderId, cancelled);
  }

  async closePosition(params: ClosePositionParams): Promise<BrokerOrder> {
    await this.simulateDelay();
    const pos = this.state.positions.get(params.brokerPositionId);
    if (!pos) {
      throw new Error(`[Simulator] Position ${params.brokerPositionId} not found`);
    }

    const closeSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
    const orderId = `SIM_ORD_${++this.state.orderIdCounter}`;
    const price = this.getSimPrice(pos.symbol);

    const order: BrokerOrder = {
      id: orderId,
      symbol: pos.symbol,
      side: closeSide,
      type: 'MARKET',
      size: pos.size,
      price,
      stopLoss: null,
      takeProfit: null,
      status: 'FILLED',
      fillSize: pos.size,
    };

    this.state.orders.set(orderId, order);
    this.state.positions.delete(params.brokerPositionId);

    return order;
  }

  async partialClose(params: PartialCloseParams): Promise<BrokerOrder> {
    await this.simulateDelay();
    const pos = this.state.positions.get(params.brokerPositionId);
    if (!pos) {
      throw new Error(`[Simulator] Position ${params.brokerPositionId} not found`);
    }

    const closeSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
    const orderId = `SIM_ORD_${++this.state.orderIdCounter}`;
    const price = this.getSimPrice(pos.symbol);
    const closeSize = Math.min(params.closeSize, pos.size);

    const order: BrokerOrder = {
      id: orderId,
      symbol: pos.symbol,
      side: closeSide,
      type: 'MARKET',
      size: closeSize,
      price,
      stopLoss: null,
      takeProfit: null,
      status: 'FILLED',
      fillSize: closeSize,
    };

    this.state.orders.set(orderId, order);

    // Reduce position
    const newSize = pos.size - closeSize;
    if (newSize > 0.001) {
      this.state.positions.set(params.brokerPositionId, {
        ...pos,
        size: newSize,
      });
    } else {
      this.state.positions.delete(params.brokerPositionId);
    }

    return order;
  }

  async updateProtection(params: UpdateProtectionParams): Promise<BrokerPosition> {
    await this.simulateDelay();
    const pos = this.state.positions.get(params.brokerPositionId);
    if (!pos) {
      throw new Error(`[Simulator] Position ${params.brokerPositionId} not found`);
    }

    // In a real adapter, this would set SL/TP on the broker.
    // The simulator just returns the position unchanged
    // (BrokerPosition doesn't have SL/TP fields).
    return pos;
  }
}
