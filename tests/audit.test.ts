/**
 * 间距风险审计单元测试。verify 回归要求的四个场景：
 *   1) 严格风险：收缩隔离段证明间距严格小于 / 大于阈值；
 *   2) 精确等距：公因子判定间距恰等于阈值；
 *   3) 无可比较根：区间内不同实根不足两个；
 *   4) 原有端点根拒绝：审计路径同样拒绝端点为根。
 * 另覆盖：阈值格式、多项式 gcd / 有理平移、混合根对、
 * 大数近距根、DTO 可序列化。
 */
import { describe, expect, it } from 'vitest';
import { auditGaps, type GapPairAudit } from '../src/lib/audit';
import {
  parsePositiveRational,
  runGapAudit,
} from '../src/lib/api';
import * as P from '../src/lib/poly';
import * as R from '../src/lib/rational';
import { IsoError, isolateRoots } from '../src/lib/sturm';

/** x^2 − 3x + 2 = (x−1)(x−2)，升幂系数。 */
const QUADRATIC = [2n, -3n, 1n];
/** x^3 − 3x^2 + 2x = x(x−1)(x−2)，根 0、1、2。 */
const CUBIC = [0n, 2n, -3n, 1n];
/** x^3 − 4x^2 + 3x = x(x−1)(x−3)，根 0、1、3。 */
const MIXED = [0n, 3n, -4n, 1n];

const expectIsoError = (fn: () => unknown, code: string, pattern: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(IsoError);
    expect((err as IsoError).code).toBe(code);
    expect((err as IsoError).message).toMatch(pattern);
    return;
  }
  throw new Error(`应当抛出 ${code} 错误，但未抛出`);
};

/** 直接对升幂系数与阈值串执行审计，返回精确判定。 */
const auditOf = (
  coeffsAsc: bigint[],
  a: bigint,
  b: bigint,
  t: string,
): GapPairAudit[] => {
  const res = isolateRoots(coeffsAsc, a, b);
  return auditGaps(res, P.fromBigInts(coeffsAsc), parsePositiveRational(t));
};

describe('场景一：严格风险——收缩隔离段证明严格大小', () => {
  it('间距严格小于阈值被标记为风险：(x−1)(x−2) 间距 1 < 3/2', () => {
    const [pair] = auditOf(QUADRATIC, 0n, 5n, '3/2');
    expect(pair.relation).toBe('less');
    expect(pair.risk).toBe(true);
    // 可复算证据：d < upper ≤ t，全部精确有理数
    expect(R.cmp(pair.upper, R.rat(3n, 2n))).toBeLessThanOrEqual(0);
    expect(R.cmp(pair.lower, pair.upper)).toBeLessThan(0);
    expect(pair.gcdFactor).toBeNull();
    expect(pair.steps).toBeGreaterThan(0);
  });

  it('间距严格大于阈值则不标风险：(x−1)(x−2) 间距 1 > 1/2', () => {
    const [pair] = auditOf(QUADRATIC, 0n, 5n, '1/2');
    expect(pair.relation).toBe('greater');
    expect(pair.risk).toBe(false);
    // 可复算证据：d > lower ≥ t
    expect(R.cmp(pair.lower, R.rat(1n, 2n))).toBeGreaterThanOrEqual(0);
    expect(pair.gcdFactor).toBeNull();
  });

  it('无理根间距同样由收缩判定：x^2 − 2x − 1 的两根相距 2√2', () => {
    // 根 1±√2，间距 2√2 ≈ 2.828；t = 2 → 大于；t = 3 → 小于
    const coeffs = [-1n, -2n, 1n];
    const [p1] = auditOf(coeffs, -2n, 4n, '2');
    expect(p1.relation).toBe('greater');
    expect(p1.risk).toBe(false);
    const [p2] = auditOf(coeffs, -2n, 4n, '3');
    expect(p2.relation).toBe('less');
    expect(p2.risk).toBe(true);
  });
});

describe('场景二：精确等距——公因子判定恰等边界', () => {
  it('(x−1)(x−2) 间距恰为 1：t = 1 判为恰等且标风险', () => {
    const [pair] = auditOf(QUADRATIC, 0n, 5n, '1');
    expect(pair.relation).toBe('equal');
    expect(pair.risk).toBe(true);
    // 公因子证据：gcd(p(x), p(x+1)) = x − 1
    expect(pair.gcdFactor).not.toBeNull();
    expect(P.toString(pair.gcdFactor!)).toBe('x − 1');
    // 恰等判定的包含证据：L + t 严格落入相邻初始隔离段
    const t = R.ONE;
    expect(R.cmp(R.add(pair.left.l, t), pair.right.l)).toBeGreaterThan(0);
    expect(R.cmp(R.add(pair.left.r, t), pair.right.r)).toBeLessThan(0);
    // 恰等时收缩无法分离：lower < t < upper 恒成立
    expect(R.cmp(pair.lower, t)).toBeLessThan(0);
    expect(R.cmp(pair.upper, t)).toBeGreaterThan(0);
  });

  it('x(x−1)(x−2) 的两对相邻根间距均恰为 1', () => {
    const pairs = auditOf(CUBIC, -1n, 3n, '1');
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.relation).toBe('equal');
      expect(pair.risk).toBe(true);
    }
    // gcd(p(x), p(x+1)) = x(x−1) = x^2 − x
    expect(P.toString(pairs[0].gcdFactor!)).toBe('x^2 − x');
  });

  it('公因子存在但间距更小时仍判小于：x(x−1)(x−2) 在 t = 2 下两对均小于', () => {
    // gcd(p(x), p(x+2)) = x 以 ξ₁ = 0 为根，但 ξ₁ + 2 = 2 ≠ ξ₂ = 1；
    // 恰等候选不成立时必须回落到收缩证明的严格小于。
    const pairs = auditOf(CUBIC, -1n, 3n, '2');
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.relation).toBe('less');
      expect(pair.risk).toBe(true);
      expect(pair.gcdFactor).toBeNull();
      expect(R.cmp(pair.upper, R.rat(2n))).toBeLessThanOrEqual(0);
    }
  });

  it('混合间距：根 0、1、3 在 t = 2 下依次为小于与恰等', () => {
    const pairs = auditOf(MIXED, -1n, 4n, '2');
    expect(pairs).toHaveLength(2);
    expect(pairs[0].relation).toBe('less');
    expect(pairs[0].risk).toBe(true);
    expect(pairs[1].relation).toBe('equal');
    expect(pairs[1].risk).toBe(true);
    expect(P.toString(pairs[1].gcdFactor!)).toBe('x − 1');
  });

  it('混合间距：根 0、1、3 在 t = 1 下依次为恰等与大于', () => {
    const pairs = auditOf(MIXED, -1n, 4n, '1');
    expect(pairs[0].relation).toBe('equal');
    expect(pairs[0].risk).toBe(true);
    expect(pairs[1].relation).toBe('greater');
    expect(pairs[1].risk).toBe(false);
  });

  it('大数近距根恰等：10^12±1 的两根间距恰为 2', () => {
    const k = 10n ** 12n;
    const coeffs = [k * k - 1n, -2n * k, 1n];
    const [eq] = auditOf(coeffs, 0n, 2n * k, '2');
    expect(eq.relation).toBe('equal');
    expect(eq.risk).toBe(true);
    const [lt] = auditOf(coeffs, 0n, 2n * k, '5/2');
    expect(lt.relation).toBe('less');
    expect(lt.risk).toBe(true);
    const [gt] = auditOf(coeffs, 0n, 2n * k, '3/2');
    expect(gt.relation).toBe('greater');
    expect(gt.risk).toBe(false);
  });
});

describe('场景三：无可比较根——不足两个不同实根', () => {
  it('区间内无实根：x^2 + 1 在 (−10, 10)', () => {
    expectIsoError(
      () => runGapAudit('1, 0, 1', '-10', '10', '1'),
      'INSUFFICIENT_ROOTS',
      /不足两个/,
    );
  });

  it('区间内仅一个实根：(x−1)(x−5) 在 (0, 3)', () => {
    expectIsoError(
      () => runGapAudit('1, -6, 5', '0', '3', '1'),
      'INSUFFICIENT_ROOTS',
      /不足两个/,
    );
  });

  it('auditGaps 对单根隔离结果同样抛出 INSUFFICIENT_ROOTS', () => {
    const res = isolateRoots([5n, -6n, 1n], 0n, 3n);
    expect(res.totalRoots).toBe(1);
    expectIsoError(
      () => auditGaps(res, P.fromBigInts([5n, -6n, 1n]), R.ONE),
      'INSUFFICIENT_ROOTS',
      /不足两个/,
    );
  });
});

describe('场景四：原有端点根拒绝在审计路径保持有效', () => {
  it('左端点为根：审计拒绝', () => {
    expectIsoError(
      () => runGapAudit('1, -3, 2', '1', '5', '1'),
      'ENDPOINT_ROOT',
      /左端点.*根/,
    );
  });

  it('右端点为根：审计拒绝', () => {
    expectIsoError(
      () => runGapAudit('1, -3, 2', '0', '2', '1'),
      'ENDPOINT_ROOT',
      /右端点.*根/,
    );
  });
});

describe('阈值解析：正有理数，非法格式拒绝', () => {
  it('接受整数、分数与空白', () => {
    expect(R.eq(parsePositiveRational('2'), R.rat(2n))).toBe(true);
    expect(R.eq(parsePositiveRational('3/2'), R.rat(3n, 2n))).toBe(true);
    expect(R.eq(parsePositiveRational('  5/7  '), R.rat(5n, 7n))).toBe(true);
    expect(R.eq(parsePositiveRational('+4'), R.rat(4n))).toBe(true);
    // 未约分形式规范化为最简分式
    expect(R.eq(parsePositiveRational('6/4'), R.rat(3n, 2n))).toBe(true);
  });

  it('非正数值被拒绝', () => {
    expectIsoError(() => parsePositiveRational('0'), 'BAD_THRESHOLD', /正/);
    expectIsoError(() => parsePositiveRational('-3'), 'BAD_THRESHOLD', /正/);
    expectIsoError(() => parsePositiveRational('-1/2'), 'BAD_THRESHOLD', /正/);
  });

  it('非法格式被拒绝', () => {
    expectIsoError(() => parsePositiveRational(''), 'BAD_THRESHOLD', /有理数/);
    expectIsoError(() => parsePositiveRational('abc'), 'BAD_THRESHOLD', /有理数/);
    expectIsoError(() => parsePositiveRational('1.5'), 'BAD_THRESHOLD', /有理数/);
    expectIsoError(() => parsePositiveRational('1/2/3'), 'BAD_THRESHOLD', /有理数/);
    expectIsoError(() => parsePositiveRational('1/0'), 'BAD_THRESHOLD', /分母/);
  });

  it('runGapAudit 对非法阈值给出 BAD_THRESHOLD', () => {
    expectIsoError(
      () => runGapAudit('1, -3, 2', '0', '5', '0'),
      'BAD_THRESHOLD',
      /正/,
    );
    expectIsoError(
      () => runGapAudit('1, -3, 2', '0', '5', 'xyz'),
      'BAD_THRESHOLD',
      /有理数/,
    );
  });
});

describe('多项式精确运算：gcd 与有理平移', () => {
  it('shift 精确平移：p(x+1) 展开正确', () => {
    // p = x^2 − 3x + 2 ⇒ p(x+1) = x^2 − x
    const shifted = P.shift(P.fromBigInts(QUADRATIC), R.ONE);
    expect(P.toString(shifted)).toBe('x^2 − x');
  });

  it('shift 支持有理平移量：p(x + 1/2)', () => {
    // p = x^2 ⇒ p(x + 1/2) = x^2 + x + 1/4
    const shifted = P.shift(P.fromBigInts([0n, 0n, 1n]), R.rat(1n, 2n));
    expect(P.toString(shifted)).toBe('x^2 + x + 1/4');
  });

  it('gcd 首一化且精确：(x−1)(x+1) 与 (x−1)^2 的公因子为 x − 1', () => {
    const a = P.fromBigInts([-1n, 0n, 1n]);
    const b = P.fromBigInts([1n, -2n, 1n]);
    expect(P.toString(P.gcd(a, b))).toBe('x − 1');
  });

  it('无公因子时 gcd 为常数 1', () => {
    const a = P.fromBigInts([1n, 0n, 1n]); // x^2 + 1
    const b = P.fromBigInts([-1n, 1n]); // x − 1
    const g = P.gcd(a, b);
    expect(P.degree(g)).toBe(0);
  });
});

describe('DTO 组装（Worker 审计路径）', () => {
  it('runGapAudit 返回可序列化结果且证据自洽', () => {
    const dto = runGapAudit('1, -3, 2', '0', '5', '1');
    expect(dto.totalRoots).toBe(2);
    expect(dto.threshold).toBe('1');
    expect(dto.pairs).toHaveLength(1);
    expect(dto.riskCount).toBe(1);
    const pair = dto.pairs[0];
    expect(pair.relation).toBe('equal');
    expect(pair.risk).toBe(true);
    expect(pair.gcdFactor).toBe('x − 1');
    // 可结构化克隆 / JSON 序列化（Worker postMessage 的前提）
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('风险计数只统计小于或等于阈值的相邻对', () => {
    // 根 0、1、3，t = 1：恰等（风险）+ 大于（安全）
    const dto = runGapAudit('1, -4, 3, 0', '-1', '4', '1');
    expect(dto.pairs).toHaveLength(2);
    expect(dto.riskCount).toBe(1);
    expect(dto.pairs.map((p) => p.relation)).toEqual(['equal', 'greater']);
  });
});
