/**
 * Web Worker：在独立线程中以 BigInt 有理数构造 Sturm 链并完成实根隔离，
 * 或在隔离结果之上执行相邻根间距风险审计，避免阻塞页面交互。
 * 主线程通过 requestId 关联请求与响应；
 * 取消或重新提交时主线程会直接 terminate 本 Worker，
 * 因此过期计算不可能再投递消息。
 */
import {
  runGapAudit,
  runIsolation,
  type AuditResultDTO,
  type ResultDTO,
} from '../lib/api';
import { IsoError, type IsoErrorCode } from '../lib/sturm';

export interface IsolateRequest {
  type: 'isolate';
  requestId: number;
  coeffs: string;
  a: string;
  b: string;
}

export interface AuditRequest {
  type: 'audit';
  requestId: number;
  coeffs: string;
  a: string;
  b: string;
  threshold: string;
}

export type WorkerRequest = IsolateRequest | AuditRequest;

export interface IsolateResultMessage {
  type: 'result';
  requestId: number;
  result: ResultDTO;
}

export interface AuditResultMessage {
  type: 'audit-result';
  requestId: number;
  audit: AuditResultDTO;
}

export interface IsolateErrorMessage {
  type: 'error';
  requestId: number;
  error: { code: IsoErrorCode; message: string };
}

export type WorkerResponse =
  | IsolateResultMessage
  | AuditResultMessage
  | IsolateErrorMessage;

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (!msg) return;
  try {
    if (msg.type === 'isolate') {
      const result = runIsolation(msg.coeffs, msg.a, msg.b);
      ctx.postMessage({ type: 'result', requestId: msg.requestId, result });
    } else if (msg.type === 'audit') {
      const audit = runGapAudit(msg.coeffs, msg.a, msg.b, msg.threshold);
      ctx.postMessage({
        type: 'audit-result',
        requestId: msg.requestId,
        audit,
      });
    }
  } catch (err) {
    const code: IsoErrorCode = err instanceof IsoError ? err.code : 'INTERNAL';
    const message =
      err instanceof Error ? err.message : '计算过程中发生未知错误';
    ctx.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: { code, message },
    });
  }
};
