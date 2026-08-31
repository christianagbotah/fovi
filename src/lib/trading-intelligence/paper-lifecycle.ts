// ============================================================
// Phase 2F — Persisted Paper Lifecycle Attestation
// ------------------------------------------------------------
// Pure helpers for proving that an open paper Position is backed by the
// deterministic filled opening Order that created it. This is used during
// engine restart hydration so orphan/corrupt exposure fails closed instead
// of being silently omitted or treated as zero exposure.
// ============================================================

import {
  EXECUTION_CONTRACT_VERSION,
  LEGACY_EXECUTION_CONTRACT_VERSION,
  buildLegacyPaperPositionId,
  buildPaperPositionId,
  nearlyEqual,
} from './execution-contract';

export const PAPER_LIFECYCLE_ATTESTATION_VERSION = 'phase2f-paper-lifecycle-v1';

export interface PaperLifecycleOpeningOrder {
  id: string;
  accountId: string;
  botId: string | null;
  symbol: string;
  side: string;
  qty: number;
  filledQty: number;
  filledPrice: number | null;
  status: string;
  aiGenerated: boolean;
  reason: string | null;
}

export interface PaperLifecycleOpenPosition {
  id: string;
  accountId: string;
  botId: string | null;
  symbol: string;
  side: string;
  qty: number;
  avgEntryPrice: number;
  status: string;
}

export type PaperLifecycleAttestation =
  | { valid: true; lifecycle: 'phase2f-v2' | 'legacy-phase2d-v1'; openingOrderId: string }
  | {
      valid: false;
      code:
        | 'OPENING_ORDER_INVALID'
        | 'OPENING_ORDER_AUDIT_INVALID'
        | 'OPENING_ORDER_POSITION_ID_MISMATCH'
        | 'OPENING_ORDER_POSITION_MISMATCH';
      reason: string;
    };

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function parseAudit(reason: string | null): Record<string, unknown> | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function validatePaperOpeningOrderForPosition(
  order: PaperLifecycleOpeningOrder,
  position: PaperLifecycleOpenPosition,
): PaperLifecycleAttestation {
  if (
    !order.id.startsWith('pxi_') ||
    !order.botId ||
    order.status !== 'filled' ||
    order.aiGenerated !== true ||
    !Number.isFinite(order.qty) || order.qty <= 0 ||
    !Number.isFinite(order.filledQty) || order.filledQty <= 0 ||
    order.filledPrice === null || !Number.isFinite(order.filledPrice) || order.filledPrice <= 0
  ) {
    return {
      valid: false,
      code: 'OPENING_ORDER_INVALID',
      reason: 'Opening order is not valid deterministic filled paper execution truth.',
    };
  }

  const audit = parseAudit(order.reason);
  const contractVersion = audit?.executionContractVersion;
  if (
    audit?.executionEnvironment !== 'paper' ||
    (contractVersion !== EXECUTION_CONTRACT_VERSION && contractVersion !== LEGACY_EXECUTION_CONTRACT_VERSION)
  ) {
    return {
      valid: false,
      code: 'OPENING_ORDER_AUDIT_INVALID',
      reason: 'Opening order does not contain an accepted paper execution audit envelope.',
    };
  }

  const expectedPositionId = contractVersion === EXECUTION_CONTRACT_VERSION
    ? buildPaperPositionId({ executionIntentId: order.id })
    : buildLegacyPaperPositionId({
        accountId: order.accountId,
        botId: order.botId,
        symbol: order.symbol,
      });

  if (position.id !== expectedPositionId) {
    return {
      valid: false,
      code: 'OPENING_ORDER_POSITION_ID_MISMATCH',
      reason: 'Open paper position ID is not the deterministic position identity for its opening order.',
    };
  }

  if (contractVersion === EXECUTION_CONTRACT_VERSION) {
    const auditedPositionId = audit?.positionId;
    if (typeof auditedPositionId !== 'string' || auditedPositionId !== position.id) {
      return {
        valid: false,
        code: 'OPENING_ORDER_AUDIT_INVALID',
        reason: 'Phase 2F opening order audit does not attest the persisted position ID.',
      };
    }
  }

  const expectedSide = order.side === 'buy' ? 'long' : order.side === 'sell' ? 'short' : null;
  const auditReferencePrice = Number(audit?.referencePrice);
  if (
    position.status !== 'open' ||
    position.accountId !== order.accountId ||
    position.botId !== order.botId ||
    normalizeSymbol(position.symbol) !== normalizeSymbol(order.symbol) ||
    !expectedSide || position.side !== expectedSide ||
    !nearlyEqual(position.qty, order.qty) ||
    !nearlyEqual(position.qty, order.filledQty) ||
    !nearlyEqual(position.avgEntryPrice, order.filledPrice) ||
    !Number.isFinite(auditReferencePrice) ||
    !nearlyEqual(position.avgEntryPrice, auditReferencePrice)
  ) {
    return {
      valid: false,
      code: 'OPENING_ORDER_POSITION_MISMATCH',
      reason: 'Open paper position fields do not match its persisted opening order/audit truth.',
    };
  }

  return {
    valid: true,
    lifecycle: contractVersion === EXECUTION_CONTRACT_VERSION ? 'phase2f-v2' : 'legacy-phase2d-v1',
    openingOrderId: order.id,
  };
}
