/**
 * Worker 消息层集成测试：模拟 self 全局，验证
 * 请求/响应的 requestId 对应关系与错误消息映射。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../src/worker/sturmWorker';

interface SelfMock {
  onmessage: ((e: { data: WorkerRequest }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

const setupWorker = async (): Promise<SelfMock> => {
  vi.resetModules();
  const selfMock: SelfMock = {
    onmessage: null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', selfMock);
  await import('../src/worker/sturmWorker');
  return selfMock;
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Worker 消息处理', () => {
  it('正常输入返回 result 消息且 requestId 一致', async () => {
    const selfMock = await setupWorker();
    expect(selfMock.onmessage).toBeTypeOf('function');

    selfMock.onmessage!({
      data: { type: 'isolate', requestId: 7, coeffs: '1, -3, 2', a: '0', b: '5' },
    });

    expect(selfMock.postMessage).toHaveBeenCalledTimes(1);
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('result');
    expect(msg.requestId).toBe(7);
    if (msg.type === 'result') {
      expect(msg.result.totalRoots).toBe(2);
      expect(msg.result.intervals).toHaveLength(2);
    }
  });

  it('端点为根返回 error 消息且 code 为 ENDPOINT_ROOT', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: { type: 'isolate', requestId: 9, coeffs: '1, -3, 2', a: '1', b: '5' },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('error');
    expect(msg.requestId).toBe(9);
    if (msg.type === 'error') {
      expect(msg.error.code).toBe('ENDPOINT_ROOT');
      expect(msg.error.message).toMatch(/根/);
    }
  });

  it('系数格式错误返回 error 消息且 code 为 BAD_FORMAT', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: { type: 'isolate', requestId: 3, coeffs: '1, x, 2', a: '0', b: '5' },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.error.code).toBe('BAD_FORMAT');
    }
  });

  it('无实根情形返回 totalRoots = 0 的 result 消息', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: { type: 'isolate', requestId: 4, coeffs: '1, 0, 1', a: '-10', b: '10' },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('result');
    if (msg.type === 'result') {
      expect(msg.result.totalRoots).toBe(0);
      expect(msg.result.intervals).toHaveLength(0);
    }
  });
});

describe('Worker 间距风险审计消息', () => {
  it('审计请求返回 audit-result 消息且 requestId 一致', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: {
        type: 'audit',
        requestId: 11,
        coeffs: '1, -3, 2',
        a: '0',
        b: '5',
        threshold: '3/2',
      },
    });
    expect(selfMock.postMessage).toHaveBeenCalledTimes(1);
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('audit-result');
    expect(msg.requestId).toBe(11);
    if (msg.type === 'audit-result') {
      expect(msg.audit.rootCount).toBe(2);
      expect(msg.audit.pairs).toHaveLength(1);
      expect(msg.audit.pairs[0].relation).toBe('less');
      expect(msg.audit.pairs[0].risk).toBe(true);
      expect(msg.audit.riskCount).toBe(1);
    }
  });

  it('间距恰等于阈值时经公因子判定返回 equal', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: {
        type: 'audit',
        requestId: 12,
        coeffs: '1, -3, 2',
        a: '0',
        b: '5',
        threshold: '1',
      },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('audit-result');
    if (msg.type === 'audit-result') {
      expect(msg.audit.pairs[0].relation).toBe('equal');
      expect(msg.audit.pairs[0].gcdFactor).toBe('x − 1');
      expect(msg.audit.pairs[0].risk).toBe(true);
    }
  });

  it('不同实根不足两个返回 TOO_FEW_ROOTS 错误消息', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: {
        type: 'audit',
        requestId: 13,
        coeffs: '1, -1',
        a: '0',
        b: '5',
        threshold: '1',
      },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('error');
    expect(msg.requestId).toBe(13);
    if (msg.type === 'error') {
      expect(msg.error.code).toBe('TOO_FEW_ROOTS');
      expect(msg.error.message).toMatch(/不足两个/);
    }
  });

  it('阈值格式非法返回 BAD_THRESHOLD 错误消息', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: {
        type: 'audit',
        requestId: 14,
        coeffs: '1, -3, 2',
        a: '0',
        b: '5',
        threshold: '-1',
      },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.error.code).toBe('BAD_THRESHOLD');
    }
  });

  it('审计路径同样拒绝端点为根', async () => {
    const selfMock = await setupWorker();
    selfMock.onmessage!({
      data: {
        type: 'audit',
        requestId: 15,
        coeffs: '1, -3, 2',
        a: '1',
        b: '5',
        threshold: '1',
      },
    });
    const msg = selfMock.postMessage.mock.calls[0][0] as WorkerResponse;
    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.error.code).toBe('ENDPOINT_ROOT');
    }
  });
});
