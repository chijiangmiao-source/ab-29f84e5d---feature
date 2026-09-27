import type { ChangeEvent } from 'react';
import type { GapAuditDTO, GapPairDTO, GapRelation } from '../lib/api';

export type AuditStatus = 'idle' | 'computing' | 'done' | 'error';

export interface AuditErrorInfo {
  code: string;
  message: string;
}

const ERROR_CODE_LABEL: Record<string, string> = {
  BAD_THRESHOLD: '阈值格式非法',
  TOO_FEW_ROOTS: '可比较根不足',
  STALE_RESULT: '结果已过期',
  ENDPOINT_ROOT: '端点为根',
  BAD_FORMAT: '系数格式错误',
  BAD_INTERVAL: '区间端点错误',
  DEGREE_RANGE: '次数越界',
  LEADING_ZERO: '首项为零',
  INTERNAL: '内部错误',
};

const RELATION_LABEL: Record<GapRelation, string> = {
  less: '小于阈值',
  equal: '恰等于阈值',
  greater: '大于阈值',
};

/** 每对相邻根的可复算证据文本（全部由精确有理数给出）。 */
const evidenceOf = (pair: GapPairDTO, threshold: string): string => {
  const seg = `根 ${pair.leftRoot} ∈ (${pair.l1}, ${pair.r1})，根 ${pair.rightRoot} ∈ (${pair.l2}, ${pair.r2})`;
  if (pair.relation === 'less') {
    return `持续收缩隔离段：${seg}，间距 d < r₂−l₁ = ${pair.upperBound} ≤ t = ${threshold}`;
  }
  if (pair.relation === 'greater') {
    return `持续收缩隔离段：${seg}，间距 d > l₂−r₁ = ${pair.lowerBound} ≥ t = ${threshold}`;
  }
  return (
    `收缩无法分离；精确公因子 h(x) = gcd(p(x), p(x+t)) = ${pair.gcdFactor} ` +
    `在 (${pair.equalLo}, ${pair.equalHi}) 内有根 ⟹ d = t = ${threshold} 恰等`
  );
};

interface GapAuditViewProps {
  threshold: string;
  onThresholdChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onAudit: () => void;
  status: AuditStatus;
  error: AuditErrorInfo | null;
  audit: GapAuditDTO | null;
}

/**
 * 间距风险审计面板：依附于当前隔离结果，冻结本次曲线与开区间，
 * 只比较按数值相邻的不同实根；仅小于或等于阈值的相邻对被标为风险。
 */
export function GapAuditView({
  threshold,
  onThresholdChange,
  onAudit,
  status,
  error,
  audit,
}: GapAuditViewProps) {
  const computing = status === 'computing';
  return (
    <section className="card audit" aria-live="polite">
      <h2>间距风险审计</h2>
      <p className="audit-intro">
        在上述隔离结果上填写一个正有理安全间距，审计任意相邻危险阈值
        （实根）是否过近。审计冻结本次曲线与开区间，仅比较按数值相邻的
        不同实根；严格大小由 BigInt 有理数持续收缩隔离段证明，恰等边界
        由多项式与其有理平移后的精确公因子判定。
      </p>

      <div className="audit-form">
        <label className="field">
          <span className="field-label">
            安全间距阈值 t（正有理数：整数、分数 a/b 或有限小数）
          </span>
          <input
            type="text"
            value={threshold}
            onChange={onThresholdChange}
            placeholder="例如：3/2、2、0.5"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={onAudit}
            disabled={computing}
          >
            {computing ? '审计中…' : '发起间距风险审计'}
          </button>
        </div>
      </div>

      {computing && (
        <div className="notice info" role="status">
          正在 Worker 中以 BigInt 有理数持续收缩相邻根的隔离段，精确比较间距与阈值…
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
              <span className="summary-label">审计对象（已冻结）</span>
              <code className="mono">p(x) = {audit.polynomial}</code>
            </div>
            <div className="summary-item">
              <span className="summary-label">考察开区间</span>
              <code className="mono">
                ({audit.a}, {audit.b})
              </code>
            </div>
            <div className="summary-item">
              <span className="summary-label">安全间距阈值 t</span>
              <code className="mono">
                {audit.threshold}（≈ {audit.thresholdDec}）
              </code>
            </div>
            <div className="summary-item highlight">
              <span className="summary-label">
                不同实根 {audit.rootCount} 个 · 相邻根对 {audit.pairCount} 对
              </span>
              <code className="mono big">
                风险 {audit.riskCount} 对
              </code>
            </div>
          </div>

          <table className="intervals audit-table">
            <thead>
              <tr>
                <th>#</th>
                <th>相邻根对</th>
                <th>间距结论</th>
                <th>可复算证据（精确有理数）</th>
                <th>风险判定</th>
              </tr>
            </thead>
            <tbody>
              {audit.pairs.map((pair) => (
                <tr key={pair.index} className={pair.risk ? 'risk' : 'safe'}>
                  <td>{pair.index}</td>
                  <td className="mono">
                    根 {pair.leftRoot} ↔ 根 {pair.rightRoot}
                  </td>
                  <td>
                    <span className={`relation ${pair.relation}`}>
                      {RELATION_LABEL[pair.relation]}
                    </span>
                  </td>
                  <td className="mono evidence">
                    {evidenceOf(pair, audit.threshold)}
                  </td>
                  <td>
                    <span className={`badge ${pair.risk ? 'risk' : 'safe'}`}>
                      {pair.risk ? '风险' : '安全'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono small">
            判定准则：间距小于或恰等于阈值 t 的相邻对标为风险；严格大于记为安全。
          </p>
        </div>
      )}
    </section>
  );
}
