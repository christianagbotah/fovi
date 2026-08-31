import { PLATFORM_MAX_RISK_PER_TRADE_PCT } from './risk-engine';
import { isCanonicalStrategy } from './strategy-engine';

export const AUTOMATED_BOT_VERIFIED_TIMEFRAME = '4h' as const;

export type BotPolicyCode =
  | 'UNSUPPORTED_STRATEGY'
  | 'UNSUPPORTED_VERIFIED_TIMEFRAME'
  | 'INVALID_ALLOCATION'
  | 'ALLOCATION_EXCEEDS_BALANCE'
  | 'INVALID_RISK_PER_TRADE'
  | 'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP'
  | 'INVALID_MAX_POSITIONS';

export interface BotPolicyInput {
  strategy: string;
  timeframe: string;
  allocationAmount: number;
  riskPerTrade: number;
  maxPositions: number;
  accountBalance: number;
}

export type BotPolicyResult =
  | { valid: true }
  | { valid: false; code: BotPolicyCode; reason: string };

function invalid(code: BotPolicyCode, reason: string): BotPolicyResult {
  return { valid: false, code, reason };
}

export function validateAutomatedBotConfiguration(input: BotPolicyInput): BotPolicyResult {
  if (!isCanonicalStrategy(input.strategy)) {
    return invalid('UNSUPPORTED_STRATEGY', `Unsupported automated strategy: ${input.strategy}`);
  }
  if (input.timeframe.trim().toLowerCase() !== AUTOMATED_BOT_VERIFIED_TIMEFRAME) {
    return invalid(
      'UNSUPPORTED_VERIFIED_TIMEFRAME',
      `Automated bots currently require verified ${AUTOMATED_BOT_VERIFIED_TIMEFRAME} market data.`,
    );
  }
  if (!Number.isFinite(input.accountBalance) || input.accountBalance <= 0) {
    return invalid('INVALID_ALLOCATION', 'A positive verified account balance is required.');
  }
  if (!Number.isFinite(input.allocationAmount) || input.allocationAmount <= 0) {
    return invalid('INVALID_ALLOCATION', 'allocationAmount must be a positive finite amount.');
  }
  if (input.allocationAmount > input.accountBalance) {
    return invalid('ALLOCATION_EXCEEDS_BALANCE', 'Bot allocation cannot exceed the account balance.');
  }
  if (!Number.isFinite(input.riskPerTrade) || input.riskPerTrade <= 0) {
    return invalid('INVALID_RISK_PER_TRADE', 'riskPerTrade must be a positive finite percentage.');
  }
  if (input.riskPerTrade > PLATFORM_MAX_RISK_PER_TRADE_PCT) {
    return invalid(
      'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP',
      `riskPerTrade cannot exceed ${PLATFORM_MAX_RISK_PER_TRADE_PCT}%.`,
    );
  }
  if (!Number.isInteger(input.maxPositions) || input.maxPositions <= 0) {
    return invalid('INVALID_MAX_POSITIONS', 'maxPositions must be a positive integer.');
  }
  return { valid: true };
}
