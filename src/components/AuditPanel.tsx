import type { AuditPairDTO, AuditResultDTO } from '../lib/api';
import { ERROR_CODE_LABEL } from './errorLabels';

export type AuditStatus =
  | 'idle'
  | 'computing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AuditErrorInfo {
  code: string;
  message: string;
}

interface AuditPanelProps {
  /** 冻结的曲线与开区间（来自当前隔离结果，不随草稿编辑变化）。 */
  polynomial: string;
  a: string;
  b: string;
  totalRoots: number;
  threshold: string;
  onThresholdChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  status: AuditStatus;
  audit: AuditResultDTO | null;
  error: AuditErrorInfo | null;
}

const RELATION_TEXT: Record<AuditPairDTO['relation'], string> = {
  less: '小于阈值',
  equal: '恰等于阈值',
  greater: '大于阈值',
};

const RELATION_SIGN: Record<AuditPairDTO['relation'], string> = {
  less: '<',
  equal: '=',
  greater: '>',
};

/** 每对相邻根的可复算精确证据。 */
const evidenceText = (pair: AuditPairDTO, threshold: string): string => {
  if (pair.relation === 'less') {
    return `收缩 ${pair.steps} 步：d < 上界 ${pair.upper} ≤ ${threshold}（≈ ${pair.upperDec}）`;
  }
  if (pair.relation === 'greater') {
    return `收缩 ${pair.steps} 步：d > 下界 ${pair.lower} ≥ ${threshold}（≈ ${pair.lowerDec}）`;
  }
  return `公因子 g(x) = ${pair.gcdFactor ?? '?'}，且 ξ + t 落入相邻隔离段 (${pair.rightL}, ${pair.rightR})`;
};

/**
 * 间距风险审计面板：在已冻结的隔离结果上填写正有理安全间距并发起审计；
 * 仅呈现与当前请求对应的结果，过期数据在 App 层即被拦截。
 */
export function AuditPanel(props: AuditPanelProps) {
  const {
    polynomial,
    a,
    b,
    totalRoots,
    threshold,
    onThresholdChange,
    onSubmit,
    onCancel,
    status,
    audit,
    error,
  } = props;
  const computing = status === 'computing';

  return (
    <section className="card audit" aria-live="polite">
      <h2>间距风险审计</h2>
      <p className="mono small">
        已冻结曲线 p(x) = {polynomial}，开区间 ({a}, {b})，不同实根{' '}
        {totalRoots} 个。审计仅比较其中按数值相邻的不同实根；
        间距小于或等于阈值的相邻对被标记为风险。
      </p>

      <form
        className="audit-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label className="field audit-field">
          <span className="field-label">
            正有理安全间距 t（整数或 p/q 形式，如 2 或 3/2）
          </span>
          <input
            type="text"
            value={threshold}
            onChange={(e) => onThresholdChange(e.target.value)}
            placeholder="例如：3/2"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={computing}>
            {computing ? '审计中…' : '发起间距风险审计'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={!computing}
          >
            取消审计
          </button>
        </div>
      </form>

      {computing && (
        <div className="notice info" role="status">
          正在 Worker 中以 BigInt 有理数收缩相邻根的隔离段并判定间距…
        </div>
      )}

      {status === 'cancelled' && (
        <div className="notice warn" role="status">
          间距审计已取消；上方隔离结论（根数、隔离段与 Sturm 证据）不受影响。
        </div>
      )}

      {status === 'error' && error && (
        <div className="notice error" role="alert">
          <strong>{ERROR_CODE_LABEL[error.code] ?? '错误'}：</strong>
          {error.message}
        </div>
      )}

      {status === 'done' && audit && (
        <div className="audit-result">
          <div className="summary-grid">
            <div className="summary-item">
              <span className="summary-label">安全间距阈值 t</span>
              <code className="mono">
                {audit.threshold}（≈ {audit.thresholdDec}）
              </code>
            </div>
            <div className="summary-item">
              <span className="summary-label">相邻根对</span>
              <code className="mono">{audit.pairs.length} 对</code>
            </div>
            <div className="summary-item highlight">
              <span className="summary-label">风险对（间距 ≤ t）</span>
              <code className="mono big">{audit.riskCount}</code>
            </div>
          </div>

          <table className="intervals">
            <thead>
              <tr>
                <th>相邻根对</th>
                <th>间距 d 与 t 的关系</th>
                <th>精确证据（可复算）</th>
                <th>风险</th>
              </tr>
            </thead>
            <tbody>
              {audit.pairs.map((pair) => (
                <tr key={pair.index} className={pair.risk ? 'row-risk' : ''}>
                  <td className="mono">
                    第 {pair.index} ↔ 第 {pair.index + 1} 根
                  </td>
                  <td className="mono">
                    d {RELATION_SIGN[pair.relation]} t（
                    {RELATION_TEXT[pair.relation]}）
                  </td>
                  <td className="mono small">
                    {evidenceText(pair, audit.threshold)}
                  </td>
                  <td className={pair.risk ? 'risk' : 'safe'}>
                    {pair.risk ? '风险（≤ t）' : '安全（> t）'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mono small">
            全部结论由 BigInt 有理数精确运算得出：严格不等由持续收缩的隔离段
            证明，恰等边界由 p(x) 与 p(x + t) 的精确公因子判定；
            十进制近似仅用于展示，不作为判据。
          </p>
        </div>
      )}
    </section>
  );
}
