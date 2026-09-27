/**
 * 间距风险审计单元测试。覆盖需求要求的回归场景：
 *   1) 严格风险（间距严格小于阈值，由持续收缩隔离段证明）
 *   2) 精确等距（间距恰等于阈值，由精确公因子判定）
 *   3) 无可比较根（区间内不同实根不足两个）
 *   4) 原有端点根拒绝
 * 另覆盖：大于阈值（安全）、多对相邻根、混合结论、阈值格式非法、
 * 大系数精确性（不以小数近似为判据）、重根多项式、证据自洽性。
 */
import { describe, expect, it } from 'vitest';
import { parseThreshold, runGapAudit } from '../src/lib/api';
import { compareGap, gcdMonic, translate } from '../src/lib/gap';
import * as P from '../src/lib/poly';
import * as R from '../src/lib/rational';
import { IsoError, isolateRoots } from '../src/lib/sturm';

/** (x−1)(x−2) = x^2 − 3x + 2，根 1 与 2，间距 1。 */
const QUADRATIC = '1, -3, 2';

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

/** 把 DTO 中的精确分式字符串解析回有理数（测试辅助）。 */
const parseRat = (s: string): R.Rat => {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s);
  if (!m) throw new Error(`不是合法分式字符串：${s}`);
  return R.rat(BigInt(m[1]), BigInt(m[2] ?? '1'));
};

describe('阈值解析：正有理数，非法格式拒绝', () => {
  it('接受整数、分数与有限小数并精确转换', () => {
    expect(R.eq(parseThreshold('2'), R.rat(2n, 1n))).toBe(true);
    expect(R.eq(parseThreshold('3/2'), R.rat(3n, 2n))).toBe(true);
    expect(R.eq(parseThreshold(' 1 / 2 '), R.rat(1n, 2n))).toBe(true);
    expect(R.eq(parseThreshold('0.5'), R.rat(1n, 2n))).toBe(true);
    expect(R.eq(parseThreshold('.5'), R.rat(1n, 2n))).toBe(true);
    expect(R.eq(parseThreshold('+3'), R.rat(3n, 1n))).toBe(true);
    // 有限小数是精确有理数：2 + 10^-30
    expect(
      R.eq(
        parseThreshold('2.000000000000000000000000000001'),
        R.rat(2n * 10n ** 30n + 1n, 10n ** 30n),
      ),
    ).toBe(true);
  });

  it('拒绝空串、非数字、非正数、零分母与畸形输入', () => {
    for (const bad of ['', '   ', 'abc', '1.5.2', '1/', '/2', '1 2', '1/0']) {
      expectIsoError(() => parseThreshold(bad), 'BAD_THRESHOLD', /.+/);
    }
    for (const nonPositive of ['0', '0.0', '-1', '-3/2', '-0.5']) {
      expectIsoError(
        () => parseThreshold(nonPositive),
        'BAD_THRESHOLD',
        /正有理数/,
      );
    }
  });
});

describe('场景一：严格风险（间距小于阈值，收缩证明）', () => {
  it('(x−1)(x−2) 间距 1 < 3/2，标为风险且证据自洽', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '3/2');
    expect(audit.rootCount).toBe(2);
    expect(audit.pairCount).toBe(1);
    expect(audit.riskCount).toBe(1);
    const [pair] = audit.pairs;
    expect(pair.relation).toBe('less');
    expect(pair.risk).toBe(true);
    expect(pair.gcdFactor).toBeNull();
    // 证据：d < upperBound ≤ t，且区间端点精确夹逼两根
    const upper = parseRat(pair.upperBound);
    expect(R.cmp(upper, R.rat(3n, 2n))).toBeLessThanOrEqual(0);
    expect(R.cmp(parseRat(pair.l1), R.fromBigInt(1n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(1n), parseRat(pair.r1))).toBeLessThan(0);
    expect(R.cmp(parseRat(pair.l2), R.fromBigInt(2n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(2n), parseRat(pair.r2))).toBeLessThan(0);
  });

  it('间距 1 < 2（整数阈值）同样判为小于', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '2');
    expect(audit.pairs[0].relation).toBe('less');
    expect(audit.pairs[0].risk).toBe(true);
  });
});

describe('场景二：精确等距（收缩不能分离，公因子判定恰等）', () => {
  it('(x−1)(x−2) 间距恰为 1：relation = equal，公因子为 x − 1', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '1');
    const [pair] = audit.pairs;
    expect(pair.relation).toBe('equal');
    expect(pair.risk).toBe(true);
    expect(pair.gcdFactor).toBe('x − 1');
    // 恰等边界证据：公因子在交集区间内有根，根 1 落在其中
    expect(pair.equalLo).not.toBeNull();
    expect(pair.equalHi).not.toBeNull();
    expect(
      R.cmp(parseRat(pair.equalLo!), parseRat(pair.equalHi!)),
    ).toBeLessThan(0);
    expect(R.cmp(parseRat(pair.equalLo!), R.fromBigInt(1n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(1n), parseRat(pair.equalHi!))).toBeLessThan(0);
  });

  it('等距也标为风险（小于或等于阈值即风险）', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '1');
    expect(audit.riskCount).toBe(1);
  });

  it('重根多项式 (x−1)^2(x−3)：不同根 1 与 3 间距恰为 2', () => {
    // (x−1)^2 (x−3) = x^3 − 5x^2 + 7x − 3
    const audit = runGapAudit('1, -5, 7, -3', '0', '5', '2');
    expect(audit.rootCount).toBe(2);
    const [pair] = audit.pairs;
    expect(pair.relation).toBe('equal');
    expect(pair.gcdFactor).toBe('x − 1');
  });
});

describe('间距大于阈值：安全', () => {
  it('(x−1)(x−2) 间距 1 > 1/2，不标风险', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '1/2');
    const [pair] = audit.pairs;
    expect(pair.relation).toBe('greater');
    expect(pair.risk).toBe(false);
    expect(audit.riskCount).toBe(0);
    // 证据：d > lowerBound ≥ t
    expect(
      R.cmp(parseRat(pair.lowerBound), R.rat(1n, 2n)),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('多对相邻根：只比较数值相邻的对', () => {
  it('x(x−1)(x−2) 三根等距 1：两对均恰等于阈值 1', () => {
    const audit = runGapAudit('1, -3, 2, 0', '-1', '3', '1');
    expect(audit.rootCount).toBe(3);
    // 只有相邻两对，不比较 (根1, 根3)
    expect(audit.pairCount).toBe(2);
    expect(audit.pairs.map((p) => p.relation)).toEqual(['equal', 'equal']);
    expect(audit.pairs.map((p) => [p.leftRoot, p.rightRoot])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(audit.riskCount).toBe(2);
  });

  it('x(x−1)(x−2) 阈值 2：两对均小于；阈值 1/2：两对均大于', () => {
    const less = runGapAudit('1, -3, 2, 0', '-1', '3', '2');
    expect(less.pairs.map((p) => p.relation)).toEqual(['less', 'less']);
    const greater = runGapAudit('1, -3, 2, 0', '-1', '3', '1/2');
    expect(greater.pairs.map((p) => p.relation)).toEqual([
      'greater',
      'greater',
    ]);
    expect(greater.riskCount).toBe(0);
  });

  it('x(x−1)(x−3) 混合结论：间距 1 恰等、间距 2 大于阈值 1', () => {
    const audit = runGapAudit('1, -4, 3, 0', '-1', '4', '1');
    expect(audit.pairs.map((p) => p.relation)).toEqual(['equal', 'greater']);
    expect(audit.pairs.map((p) => p.risk)).toEqual([true, false]);
    expect(audit.riskCount).toBe(1);
  });

  it('x(x−1)(x−3) 阈值 3/2：间距 1 小于、间距 2 大于', () => {
    const audit = runGapAudit('1, -4, 3, 0', '-1', '4', '3/2');
    expect(audit.pairs.map((p) => p.relation)).toEqual(['less', 'greater']);
  });
});

describe('场景三：无可比较根（不同实根不足两个）', () => {
  it('区间内只有 1 个实根：x − 1 在 (0, 5)', () => {
    expectIsoError(
      () => runGapAudit('1, -1', '0', '5', '1'),
      'TOO_FEW_ROOTS',
      /不足两个/,
    );
  });

  it('区间内无实根：x^2 + 1 在 (−10, 10)', () => {
    expectIsoError(
      () => runGapAudit('1, 0, 1', '-10', '10', '1'),
      'TOO_FEW_ROOTS',
      /没有可比较的相邻根对/,
    );
  });
});

describe('场景四：原有端点根拒绝在审计路径同样生效', () => {
  it('左端点为根', () => {
    expectIsoError(
      () => runGapAudit(QUADRATIC, '1', '5', '1'),
      'ENDPOINT_ROOT',
      /左端点.*根/,
    );
  });

  it('右端点为根', () => {
    expectIsoError(
      () => runGapAudit(QUADRATIC, '0', '2', '1'),
      'ENDPOINT_ROOT',
      /右端点.*根/,
    );
  });
});

describe('审计路径的既有输入校验', () => {
  it('阈值非法优先于隔离计算被报告', () => {
    expectIsoError(
      () => runGapAudit(QUADRATIC, '0', '5', 'abc'),
      'BAD_THRESHOLD',
      /正有理数/,
    );
  });

  it('系数格式错误与次数越界仍然拒绝', () => {
    expectIsoError(
      () => runGapAudit('1, x, 2', '0', '5', '1'),
      'BAD_FORMAT',
      /不是合法整数/,
    );
    expectIsoError(
      () => runGapAudit('7', '0', '5', '1'),
      'DEGREE_RANGE',
      /次数/,
    );
  });

  it('区间次序错误仍然拒绝', () => {
    expectIsoError(
      () => runGapAudit(QUADRATIC, '5', '0', '1'),
      'BAD_INTERVAL',
      /a < b/,
    );
  });
});

describe('大系数精确性：不以小数近似为判据', () => {
  // (x − (10^12−1))(x − (10^12+1))，两根相距恰为 2
  const k = 10n ** 12n;
  const coeffs = `1, ${(-2n * k).toString()}, ${(k * k - 1n).toString()}`;
  const b = (2n * k).toString();

  it('间距恰为 2：阈值 2 判 equal，公因子为 x − (10^12−1)', () => {
    const audit = runGapAudit(coeffs, '0', b, '2');
    const [pair] = audit.pairs;
    expect(pair.relation).toBe('equal');
    expect(pair.gcdFactor).toBe(`x − ${(k - 1n).toString()}`);
  });

  it('阈值比间距大 10^-30：判 less（精确比较，不被显示精度吞没）', () => {
    const audit = runGapAudit(
      coeffs,
      '0',
      b,
      '2.000000000000000000000000000001',
    );
    expect(audit.pairs[0].relation).toBe('less');
    expect(audit.pairs[0].risk).toBe(true);
  });

  it('阈值比间距小 10^-30：判 greater（收缩证明严格大于）', () => {
    const audit = runGapAudit(
      coeffs,
      '0',
      b,
      '1.999999999999999999999999999999',
    );
    expect(audit.pairs[0].relation).toBe('greater');
    expect(audit.pairs[0].risk).toBe(false);
  });
});

describe('有理平移与精确公因子（底层单元）', () => {
  it('translate 精确平移：p(x+t) 在 x 处取值等于 p 在 x+t 处取值', () => {
    const p = P.fromBigInts([2n, -3n, 1n]); // x^2 − 3x + 2
    const t = R.rat(3n, 2n);
    const shifted = translate(p, t);
    for (const x of [R.ZERO, R.ONE, R.rat(-7n, 4n), R.rat(5n, 3n)]) {
      const lhs = P.evalRat(shifted, x);
      const rhs = P.evalRat(p, R.add(x, t));
      expect(R.eq(lhs, rhs)).toBe(true);
    }
  });

  it('translate(x^2, 1) = x^2 + 2·x + 1', () => {
    const shifted = translate(P.fromBigInts([0n, 0n, 1n]), R.ONE);
    expect(P.toString(shifted)).toBe('x^2 + 2·x + 1');
  });

  it('gcdMonic 给出首一公因子', () => {
    const p1 = P.fromBigInts([2n, -3n, 1n]); // (x−1)(x−2)
    const p2 = P.fromBigInts([3n, -4n, 1n]); // (x−1)(x−3)
    expect(P.toString(gcdMonic(p1, p2))).toBe('x − 1');
    // 互素时公因子为常数 1
    const q1 = P.fromBigInts([1n, 0n, 1n]); // x^2 + 1
    const q2 = P.fromBigInts([-1n, 1n]); // x − 1
    expect(P.degree(gcdMonic(q1, q2))).toBe(0);
  });
});

describe('compareGap 直接调用：证据字段完整', () => {
  it('less / greater / equal 三种结论的证据字段形态正确', () => {
    const p = P.fromBigInts([2n, -3n, 1n]);
    const res = isolateRoots([2n, -3n, 1n], 0n, 5n);
    const [u, v] = res.intervals;

    const less = compareGap(p, res.chain, u, v, R.rat(3n, 2n));
    expect(less.relation).toBe('less');
    expect(R.cmp(less.upper, R.rat(3n, 2n))).toBeLessThanOrEqual(0);
    expect(less.gcdFactor).toBeNull();

    const greater = compareGap(p, res.chain, u, v, R.rat(1n, 2n));
    expect(greater.relation).toBe('greater');
    expect(R.cmp(greater.lower, R.rat(1n, 2n))).toBeGreaterThanOrEqual(0);

    const equal = compareGap(p, res.chain, u, v, R.ONE);
    expect(equal.relation).toBe('equal');
    expect(equal.gcdFactor).not.toBeNull();
    expect(P.toString(equal.gcdFactor!)).toBe('x − 1');
    // 间距夹逼始终成立：lower < d < upper
    expect(R.cmp(equal.lower, R.ONE)).toBeLessThan(0);
    expect(R.cmp(R.ONE, equal.upper)).toBeLessThan(0);
  });
});

describe('审计 DTO 可序列化且与隔离结果一致', () => {
  it('runGapAudit 返回可 JSON 序列化结果，根数与隔离一致', () => {
    const audit = runGapAudit(QUADRATIC, '0', '5', '3/2');
    expect(() => JSON.stringify(audit)).not.toThrow();
    expect(audit.rootCount).toBe(2);
    expect(audit.polynomial).toContain('x^2');
    expect(audit.threshold).toBe('3/2');
    expect(audit.a).toBe('0');
    expect(audit.b).toBe('5');
  });
});
