import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBotUpdate, mockHasModel } = vi.hoisted(() => ({
  mockBotUpdate: vi.fn(),
  mockHasModel: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  db: { bot: { update: mockBotUpdate } },
  hasModel: mockHasModel,
}));

vi.mock('@/lib/trading-policy', () => ({
  enforceInternalAuth: vi.fn(() => null),
  logSecurityEvent: vi.fn(),
}));

import { POST } from '@/app/api/trading/engine/report/route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/trading/engine/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('Phase 2E engine reporting statistics boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockBotUpdate.mockResolvedValue({ id: 'bot-1' });
  });

  it('does not increment totalTrades when an order is opened', async () => {
    const res = await POST(request({ botId: 'bot-1', tradeType: 'opened' }));
    expect(res.status).toBe(200);
    expect(mockBotUpdate).toHaveBeenCalledTimes(1);
    const data = mockBotUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('totalTrades');
    expect(data).not.toHaveProperty('winTrades');
    expect(data).not.toHaveProperty('lossTrades');
    expect(data).not.toHaveProperty('totalPnl');
  });

  it('rejects legacy closed reports before any database mutation', async () => {
    const res = await POST(request({
      botId: 'bot-1',
      tradeType: 'closed',
      pnl: 100,
      isWin: true,
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('DURABLE_CLOSE_REQUIRED');
    expect(mockBotUpdate).not.toHaveBeenCalled();
  });

  it('still persists engine errors without touching trade counters', async () => {
    const res = await POST(request({
      botId: 'bot-1',
      tradeType: 'error',
      reason: 'provider unavailable',
    }));
    expect(res.status).toBe(200);
    const data = mockBotUpdate.mock.calls[0][0].data;
    expect(data.lastError).toBe('provider unavailable');
    expect(data).not.toHaveProperty('totalTrades');
  });
});
