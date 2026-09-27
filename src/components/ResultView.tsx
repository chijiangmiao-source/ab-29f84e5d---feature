import type { ResultDTO } from '../lib/api';

/** 只呈现与当前提交对应的结果 DTO；任何过期数据在 App 层即被拦截。 */
export function ResultView({ result }: { result: ResultDTO }) {
  return (
    <section className="card result" aria-live="polite">
      <h2>结果</h2>

      <div className="summary-grid">
        <div className="summary-item">
          <span className="summary-label">多项式</span>
          <code className="mono">p(x) = {result.polynomial}</code>
        </div>
        <div className="summary-item">
          <span className="summary-label">考察开区间</span>
          <code className="mono">
            ({result.a}, {result.b})
          </code>
        </div>
        <div className="summary-item highlight">
          <span className="summary-label">开区间内不同实根数</span>
          <code className="mono big">{result.totalRoots}</code>
        </div>
        <div className="summary-item">
          <span className="summary-label">整体 Sturm 证据</span>
          <code className="mono">
            V({result.a}) = {result.vA}，V({result.b}) = {result.vB}，V(
            {result.a}) − V({result.b}) = {result.totalRoots}
          </code>
        </div>
      </div>

      <details className="chain">
        <summary>Sturm 链（{result.chain.length} 个多项式，BigInt 有理数精确构造）</summary>
        <ol>
          {result.chain.map((s, i) => (
            <li key={i}>
              <code className="mono">
                p<sub>{i}</sub>(x) = {s}
              </code>
            </li>
          ))}
        </ol>
        <p className="mono small">
          端点符号序列：S({result.a}) = [{result.signsA}]，S({result.b}) = [
          {result.signsB}]
        </p>
      </details>

      {result.intervals.length === 0 ? (
        <p className="empty">该开区间内无实根，无需隔离区间。</p>
      ) : (
        <table className="intervals">
          <thead>
            <tr>
              <th>#</th>
              <th>隔离区间 [l, r]（精确有理数）</th>
              <th>十进制近似</th>
              <th>V(l)</th>
              <th>V(r)</th>
              <th>变号差</th>
            </tr>
          </thead>
          <tbody>
            {result.intervals.map((iv, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="mono">
                  [{iv.l}, {iv.r}]
                </td>
                <td className="mono">
                  ≈ [{iv.lDec}, {iv.rDec}]
                </td>
                <td className="mono">{iv.vL}</td>
                <td className="mono">{iv.vR}</td>
                <td className="mono ok">{iv.vL - iv.vR}（恰含 1 个根）</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result.intervals.length > 0 && (
        <details className="chain">
          <summary>各隔离区间端点处的 Sturm 符号序列证据</summary>
          <table className="intervals">
            <thead>
              <tr>
                <th>#</th>
                <th>S(l)</th>
                <th>S(r)</th>
              </tr>
            </thead>
            <tbody>
              {result.intervals.map((iv, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="mono">[{iv.signsL}]</td>
                  <td className="mono">[{iv.signsR}]</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
