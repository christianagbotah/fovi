// ============================================================
// Fovi Position Sizing Engine
// Kelly Criterion, Fixed Fractional, Volatility-based
// ============================================================

export interface SizingRequest {
  method: 'kelly' | 'fixed_fractional' | 'volatility' | 'fixed';
  accountBalance: number;
  allocationAmount: number; // amount allocated to this bot
  entryPrice: number;
  stopLossPrice: number;
  riskPerTrade?: number; // % risk (for fixed_fractional)
  winRate?: number; // for kelly
  avgWinLossRatio?: number; // for kelly
  atr?: number; // for volatility
  fixedAmount?: number; // for fixed
  maxPositionPct?: number; // max % of allocation
}

export interface SizingResult {
  method: string;
  positionSize: number; // dollar amount to invest
   quantity: number; // units/shares/coins to buy
   riskAmount: number; // dollars at risk
   riskPercent: number; // % of allocation at risk
   reason: string;
}

export function calculatePositionSize(req: SizingRequest): SizingResult {
  const balance = Math.min(req.allocationAmount, req.accountBalance);
  if (balance <= 0 || req.entryPrice <= 0) {
    return { method: req.method, positionSize: 0, quantity: 0, riskAmount: 0, riskPercent: 0, reason: 'Invalid inputs' };
  }

  const priceRisk = req.stopLossPrice > 0 ? Math.abs(req.entryPrice - req.stopLossPrice) / req.entryPrice : 0.02;

  let result: SizingResult;

  switch (req.method) {
    case 'kelly':
      result = kellySizing(req, balance, priceRisk);
      break;
    case 'volatility':
      result = volatilitySizing(req, balance, priceRisk);
      break;
    case 'fixed':
      result = fixedSizing(req, balance);
      break;
    case 'fixed_fractional':
    default:
      result = fixedFractionalSizing(req, balance, priceRisk);
      break;
  }

  // Cap at maxPositionPct
  if (req.maxPositionPct && req.maxPositionPct > 0) {
    const maxDollars = balance * (req.maxPositionPct / 100);
    if (result.positionSize > maxDollars) {
      result.positionSize = maxDollars;
      result.quantity = maxDollars / req.entryPrice;
      result.riskAmount = result.quantity * Math.abs(req.entryPrice - (req.stopLossPrice || req.entryPrice * (1 - priceRisk)));
      result.riskPercent = balance > 0 ? (result.riskAmount / balance) * 100 : 0;
    }
  }

  return result;
}

function kellySizing(req: SizingRequest, balance: number, priceRisk: number): SizingResult {
  const w = req.winRate ?? 0.55;
  const r = req.avgWinLossRatio ?? 1.5;
  const kelly = w - ((1 - w) / r); // Kelly %
  // Use half-Kelly for safety
  const safeKelly = Math.max(kelly * 0.5, 0.01);
  const positionSize = balance * safeKelly;
  const quantity = positionSize / req.entryPrice;
  const stopPrice = req.stopLossPrice || req.entryPrice * (1 - priceRisk);
  const riskAmount = quantity * Math.abs(req.entryPrice - stopPrice);

  return {
    method: 'kelly',
    positionSize, quantity,
    riskAmount, riskPercent: balance > 0 ? (riskAmount / balance) * 100 : 0,
    reason: `Half-Kelly: ${((safeKelly) * 100).toFixed(1)}% of ${balance.toLocaleString()} (win rate ${(w * 100).toFixed(0)}%, R:R ${r.toFixed(1)})`,
  };
}

function fixedFractionalSizing(req: SizingRequest, balance: number, priceRisk: number): SizingResult {
  const riskPct = (req.riskPerTrade ?? 2) / 100;
  const riskDollars = balance * riskPct;
  const stopPrice = req.stopLossPrice || req.entryPrice * (1 - priceRisk);
  const priceDiff = Math.abs(req.entryPrice - stopPrice);
  const quantity = priceDiff > 0 ? riskDollars / priceDiff : 0;
  const positionSize = quantity * req.entryPrice;

  return {
    method: 'fixed_fractional',
    positionSize, quantity: Math.floor(quantity * 10000) / 10000,
    riskAmount: riskDollars, riskPercent: riskPct * 100,
    reason: `${req.riskPerTrade ?? 2}% risk = $${riskDollars.toFixed(0)}, stop distance ${((priceRisk) * 100).toFixed(1)}%`,
  };
}

function volatilitySizing(req: SizingRequest, balance: number, priceRisk: number): SizingResult {
  const atrVal = req.atr || (req.entryPrice * priceRisk);
  const riskDollars = balance * 0.02; // 2% default risk
  const quantity = atrVal > 0 ? riskDollars / atrVal : 0;
  const positionSize = quantity * req.entryPrice;
  const stopPrice = req.stopLossPrice || (req.entryPrice - 2 * atrVal);
  const riskAmount = quantity * Math.abs(req.entryPrice - stopPrice);

  return {
    method: 'volatility',
    positionSize, quantity: Math.floor(quantity * 10000) / 10000,
    riskAmount, riskPercent: balance > 0 ? (riskAmount / balance) * 100 : 0,
    reason: `ATR-based: 1 ATR risk ($${atrVal.toFixed(2)}), 2% of balance = $${riskDollars.toFixed(0)}`,
  };
}

function fixedSizing(req: SizingRequest, balance: number): SizingResult {
  const amount = Math.min(req.fixedAmount ?? balance * 0.1, balance);
  const quantity = amount / req.entryPrice;
  const stopPrice = req.stopLossPrice || req.entryPrice * 0.98;
  const riskAmount = quantity * Math.abs(req.entryPrice - stopPrice);

  return {
    method: 'fixed',
    positionSize: amount, quantity: Math.floor(quantity * 10000) / 10000,
    riskAmount, riskPercent: balance > 0 ? (riskAmount / balance) * 100 : 0,
    reason: `Fixed amount: $${amount.toFixed(0)}`,
  };
}
