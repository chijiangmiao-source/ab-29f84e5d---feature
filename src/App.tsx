import { useCallback, useEffect, useRef, useState } from 'react';
import { IsoError } from './lib/sturm';
import {
  parseCoefficients,
  parseInteger,
  parsePositiveRational,
} from './lib/api';
import type { AuditResultDTO, ResultDTO } from './lib/api';
import type {
  AuditRequest,
  IsolateRequest,
  WorkerResponse,
} from './worker/sturmWorker';
import { ResultView } from './components/ResultView';
import { AuditPanel, type AuditStatus } from './components/AuditPanel';
import { ERROR_CODE_LABEL } from './components/errorLabels';

type Status = 'idle' | 'computing' | 'done' | 'error' | 'cancelled';

interface ErrorInfo {
  code: string;
  message: string;
}

const toErrorInfo = (err: unknown): ErrorInfo =>
  err instanceof IsoError
    ? { code: err.code, message: err.message }
    : { code: 'INTERNAL', message: String(err) };

export default function App() {
  const [coeffInput, setCoeffInput] = useState('1, -3, 2');
  const [aInput, setAInput] = useState('0');
  const [bInput, setBInput] = useState('5');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ResultDTO | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [editedSinceResult, setEditedSinceResult] = useState(false);

  // 间距风险审计状态：依附于已冻结的隔离结果。
  const [thresholdInput, setThresholdInput] = useState('1');
  const [audit, setAudit] = useState<AuditResultDTO | null>(null);
  const [auditError, setAuditError] = useState<ErrorInfo | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuditStatus>('idle');

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  /** 本次隔离结果对应的输入快照：审计须冻结本次曲线和开区间。 */
  const frozenRef = useRef<{ coeffs: string; a: string; b: string } | null>(
    null,
  );

  const killWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => killWorker, [killWorker]);

  /** 清除审计显示（隔离结果失效或阈值变更时调用）。 */
  const clearAudit = useCallback(() => {
    setAudit(null);
    setAuditError(null);
    setAuditStatus('idle');
  }, []);

  /** 任一输入被编辑：作废旧请求、清除旧结论与审计，页面不再呈现过期结果。 */
  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
    killWorker();
    setResult(null);
    setError(null);
    setStatus('idle');
    setEditedSinceResult(true);
    frozenRef.current = null;
    clearAudit();
  }, [killWorker, clearAudit]);

  const onCoeffChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCoeffInput(e.target.value);
    invalidate();
  };
  const onAChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAInput(e.target.value);
    invalidate();
  };
  const onBChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBInput(e.target.value);
    invalidate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 先终止旧 Worker 并使旧 requestId 失效，旧消息绝不会覆盖本次提交。
    killWorker();
    const requestId = ++requestIdRef.current;
    setResult(null);
    setError(null);
    setEditedSinceResult(false);
    frozenRef.current = null;
    clearAudit();

    // 提交前做一次同步解析，格式类错误立即反馈，无需进入 Worker。
    try {
      parseCoefficients(coeffInput);
      parseInteger(aInput, '左端点');
      parseInteger(bInput, '右端点');
    } catch (err) {
      setError(toErrorInfo(err));
      setStatus('error');
      return;
    }

    // 冻结本次曲线与开区间，供后续间距审计使用。
    frozenRef.current = { coeffs: coeffInput, a: aInput, b: bInput };
    setStatus('computing');
    const worker = new Worker(
      new URL('./worker/sturmWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      // 仅接受与当前请求对应的消息，过期消息一律丢弃。
      if (msg.requestId !== requestIdRef.current) return;
      killWorker();
      if (msg.type === 'result') {
        setResult(msg.result);
        setStatus('done');
      } else if (msg.type === 'error') {
        setError(msg.error);
        setStatus('error');
      }
    };
    worker.onerror = (ev) => {
      if (requestIdRef.current !== requestId) return;
      killWorker();
      setError({
        code: 'INTERNAL',
        message: ev.message || 'Worker 执行失败',
      });
      setStatus('error');
    };

    const req: IsolateRequest = {
      type: 'isolate',
      requestId,
      coeffs: coeffInput,
      a: aInput,
      b: bInput,
    };
    worker.postMessage(req);
  };

  const handleCancel = () => {
    // 取消：终止 Worker、作废旧请求、清除旧结论与审计并明确反馈。
    requestIdRef.current += 1;
    killWorker();
    setResult(null);
    setError(null);
    setStatus('cancelled');
    frozenRef.current = null;
    clearAudit();
  };

  /** 阈值被编辑：旧审计结论与进行中的审计一并作废。 */
  const onThresholdChange = (value: string) => {
    setThresholdInput(value);
    if (auditStatus !== 'idle' || audit || auditError) {
      requestIdRef.current += 1;
      killWorker();
      clearAudit();
    }
  };

  const handleAuditSubmit = () => {
    // 无冻结的隔离结果（已被编辑/取消作废）时不可审计。
    const frozen = frozenRef.current;
    if (!result || !frozen) return;
    // 终止可能仍在运行的旧请求，旧审计消息凭 requestId 无法覆盖新页面。
    killWorker();
    const requestId = ++requestIdRef.current;
    setAudit(null);
    setAuditError(null);

    // 同步校验：阈值格式与可比较根数，非法即清除审计显示并给出原因。
    try {
      parsePositiveRational(thresholdInput);
      if (result.totalRoots < 2) {
        throw new IsoError(
          'INSUFFICIENT_ROOTS',
          `当前开区间内不同实根数为 ${result.totalRoots}，不足两个，没有可比较的相邻根对`,
        );
      }
    } catch (err) {
      setAuditError(toErrorInfo(err));
      setAuditStatus('error');
      return;
    }

    setAuditStatus('computing');
    const worker = new Worker(
      new URL('./worker/sturmWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      // 重新隔离、编辑系数或取消后到达的旧审计消息一律丢弃。
      if (msg.requestId !== requestIdRef.current) return;
      killWorker();
      if (msg.type === 'audit-result') {
        setAudit(msg.audit);
        setAuditStatus('done');
      } else if (msg.type === 'error') {
        setAuditError(msg.error);
        setAuditStatus('error');
      }
    };
    worker.onerror = (ev) => {
      if (requestIdRef.current !== requestId) return;
      killWorker();
      setAuditError({
        code: 'INTERNAL',
        message: ev.message || 'Worker 执行失败',
      });
      setAuditStatus('error');
    };

    const req: AuditRequest = {
      type: 'audit',
      requestId,
      coeffs: frozen.coeffs,
      a: frozen.a,
      b: frozen.b,
      threshold: thresholdInput,
    };
    worker.postMessage(req);
  };

  const handleAuditCancel = () => {
    // 仅取消审计：隔离结论（根数、隔离段与 Sturm 证据）保持可用。
    requestIdRef.current += 1;
    killWorker();
    setAudit(null);
    setAuditError(null);
    setAuditStatus('cancelled');
  };

  const computing = status === 'computing';

  return (
    <div className="page">
      <header className="header">
        <h1>精确实根隔离</h1>
        <p className="subtitle">
          同步辐射站增益曲线零点校准 · Sturm 链 · BigInt 有理数精确运算
        </p>
      </header>

      <form className="card form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">
            整数系数（降幂，逗号或空格分隔，次数 1–12）
          </span>
          <input
            type="text"
            value={coeffInput}
            onChange={onCoeffChange}
            placeholder="例如：1, -3, 2 表示 x^2 − 3x + 2"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <div className="endpoint-row">
          <label className="field">
            <span className="field-label">区间左端点 a（整数）</span>
            <input
              type="text"
              value={aInput}
              onChange={onAChange}
              placeholder="0"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">区间右端点 b（整数）</span>
            <input
              type="text"
              value={bInput}
              onChange={onBChange}
              placeholder="5"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="btn primary" disabled={computing}>
            {computing ? '计算中…' : '精确隔离'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleCancel}
            disabled={!computing}
          >
            取消
          </button>
        </div>
      </form>

      {status === 'computing' && (
        <div className="notice info" role="status">
          正在 Worker 中以 BigInt 有理数构造 Sturm 链并二分隔离…
        </div>
      )}

      {status === 'cancelled' && (
        <div className="notice warn" role="status">
          计算已取消，旧结论已清除，不会保留或展示过期结果。
        </div>
      )}

      {editedSinceResult && status === 'idle' && (
        <div className="notice muted" role="status">
          输入已修改，先前的隔离结论与间距审计已作废；请重新提交以获取与当前输入对应的结果。
        </div>
      )}

      {status === 'error' && error && (
        <div className="notice error" role="alert">
          <strong>
            {ERROR_CODE_LABEL[error.code] ?? '错误'}：
          </strong>
          {error.message}
        </div>
      )}

      {status === 'done' && result && (
        <>
          <ResultView result={result} />
          <AuditPanel
            polynomial={result.polynomial}
            a={result.a}
            b={result.b}
            totalRoots={result.totalRoots}
            threshold={thresholdInput}
            onThresholdChange={onThresholdChange}
            onSubmit={handleAuditSubmit}
            onCancel={handleAuditCancel}
            status={auditStatus}
            audit={audit}
            error={auditError}
          />
        </>
      )}

      <footer className="footer">
        全部符号判定、二分隔离与间距审计均在浏览器 Worker 内以 BigInt
        有理数精确完成，不引入浮点近似，相邻阈值不会被合并或遗漏。
      </footer>
    </div>
  );
}
