import { useCallback, useEffect, useRef, useState } from 'react';
import { IsoError } from './lib/sturm';
import { parseCoefficients, parseInteger } from './lib/api';
import type { ResultDTO } from './lib/api';
import type {
  IsolateRequest,
  WorkerResponse,
} from './worker/sturmWorker';
import { ResultView } from './components/ResultView';

type Status = 'idle' | 'computing' | 'done' | 'error' | 'cancelled';

interface ErrorInfo {
  code: string;
  message: string;
}

const ERROR_CODE_LABEL: Record<string, string> = {
  DEGREE_RANGE: '次数越界',
  LEADING_ZERO: '首项为零',
  BAD_INTERVAL: '区间端点错误',
  ENDPOINT_ROOT: '端点为根',
  BAD_FORMAT: '系数格式错误',
  INTERNAL: '内部错误',
};

export default function App() {
  const [coeffInput, setCoeffInput] = useState('1, -3, 2');
  const [aInput, setAInput] = useState('0');
  const [bInput, setBInput] = useState('5');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ResultDTO | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [editedSinceResult, setEditedSinceResult] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  const killWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => killWorker, [killWorker]);

  /** 任一输入被编辑：作废旧请求、清除旧结论，页面不再呈现过期结果。 */
  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
    killWorker();
    setResult(null);
    setError(null);
    setStatus('idle');
    setEditedSinceResult(true);
  }, [killWorker]);

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

    // 提交前做一次同步解析，格式类错误立即反馈，无需进入 Worker。
    try {
      parseCoefficients(coeffInput);
      parseInteger(aInput, '左端点');
      parseInteger(bInput, '右端点');
    } catch (err) {
      const info: ErrorInfo =
        err instanceof IsoError
          ? { code: err.code, message: err.message }
          : { code: 'INTERNAL', message: String(err) };
      setError(info);
      setStatus('error');
      return;
    }

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
      } else {
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
    // 取消：终止 Worker、作废旧请求、清除旧结论并明确反馈。
    requestIdRef.current += 1;
    killWorker();
    setResult(null);
    setError(null);
    setStatus('cancelled');
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
          输入已修改，先前结论已作废；请重新提交以获取与当前输入对应的结果。
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

      {status === 'done' && result && <ResultView result={result} />}

      <footer className="footer">
        全部符号判定与二分隔离均在浏览器 Worker 内以 BigInt
        有理数精确完成，不引入浮点近似，相邻阈值不会被合并或遗漏。
      </footer>
    </div>
  );
}
