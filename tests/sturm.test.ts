/**
 * 核心算法单元测试。verify 服务要求的三个场景：
 *   1) 两个实根  2) 无实根  3) 端点为根拒绝
 * 另覆盖：首项为零、系数格式错误、次数越界、区间次序、
 * 重根（非平方自由）、二分恰好命中根、隔离区间互不相交与 Sturm 证据。
 */
import { describe, expect, it } from 'vitest';
import { runIsolation } from '../src/lib/api';
import * as P from '../src/lib/poly';
import * as R from '../src/lib/rational';
import {
  buildSturmChain,
  IsoError,
  isolateRoots,
  variations,
} from '../src/lib/sturm';

/** x^2 − 3x + 2 = (x−1)(x−2)，升幂系数。 */
const QUADRATIC = [2n, -3n, 1n];

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

describe('场景一：两个实根 (x−1)(x−2) 在 (0, 5)', () => {
  const res = isolateRoots(QUADRATIC, 0n, 5n);

  it('开区间内不同实根数为 2', () => {
    expect(res.totalRoots).toBe(2);
    expect(res.vA - res.vB).toBe(2);
  });

  it('给出两个互不相交、严格分离且升序的隔离区间', () => {
    expect(res.intervals).toHaveLength(2);
    const [u, v] = res.intervals;
    expect(R.cmp(u.l, u.r)).toBeLessThan(0);
    expect(R.cmp(v.l, v.r)).toBeLessThan(0);
    // 升序且互不相交：右端点严格小于下一区间左端点
    expect(R.cmp(u.r, v.l)).toBeLessThan(0);
  });

  it('两个区间分别恰含根 1 与根 2', () => {
    const [u, v] = res.intervals;
    expect(R.cmp(u.l, R.fromBigInt(1n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(1n), u.r)).toBeLessThan(0);
    expect(R.cmp(v.l, R.fromBigInt(2n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(2n), v.r)).toBeLessThan(0);
  });

  it('每段均附 V(l) − V(r) = 1 的 Sturm 变号证据', () => {
    for (const iv of res.intervals) {
      expect(iv.vL - iv.vR).toBe(1);
      expect(iv.signsL).toHaveLength(res.chain.length);
      expect(iv.signsR).toHaveLength(res.chain.length);
    }
  });
});

describe('Sturm 链构造（手算对照）', () => {
  it('x^2 − 3x + 2 的链为 [x^2−3x+2, 2x−3, 1/4]', () => {
    const chain = buildSturmChain(P.fromBigInts(QUADRATIC));
    expect(chain).toHaveLength(3);
    // p1 = 2x − 3
    expect(chain[1].c[0].n).toBe(-3n);
    expect(chain[1].c[1].n).toBe(2n);
    // p2 = 1/4
    expect(chain[2].c[0].n).toBe(1n);
    expect(chain[2].c[0].d).toBe(4n);
  });
});

describe('场景二：无实根 x^2 + 1 在 (−10, 10)', () => {
  const res = isolateRoots([1n, 0n, 1n], -10n, 10n);

  it('不同实根数为 0', () => {
    expect(res.totalRoots).toBe(0);
  });

  it('隔离区间列表为空', () => {
    expect(res.intervals).toHaveLength(0);
  });
});

describe('场景三：端点为根必须拒绝', () => {
  it('左端点为根：x^2−3x+2 在 (1, 5)', () => {
    expectIsoError(
      () => isolateRoots(QUADRATIC, 1n, 5n),
      'ENDPOINT_ROOT',
      /左端点.*根/,
    );
  });

  it('右端点为根：x^2−3x+2 在 (0, 2)', () => {
    expectIsoError(
      () => isolateRoots(QUADRATIC, 0n, 2n),
      'ENDPOINT_ROOT',
      /右端点.*根/,
    );
  });

  it('runIsolation 同样拒绝端点根', () => {
    expectIsoError(() => runIsolation('1, -3, 2', '1', '5'), 'ENDPOINT_ROOT', /根/);
  });
});

describe('输入校验', () => {
  it('首项为零被拒绝', () => {
    expectIsoError(
      () => runIsolation('0, 1, 2', '0', '5'),
      'LEADING_ZERO',
      /首项/,
    );
  });

  it('系数格式错误被拒绝', () => {
    expectIsoError(
      () => runIsolation('1, abc, 2', '0', '5'),
      'BAD_FORMAT',
      /不是合法整数/,
    );
    expectIsoError(
      () => runIsolation('1.5, 2', '0', '5'),
      'BAD_FORMAT',
      /不是合法整数/,
    );
    expectIsoError(() => runIsolation('', '0', '5'), 'BAD_FORMAT', /系数/);
  });

  it('次数越界被拒绝（0 次与 13 次）', () => {
    expectIsoError(() => runIsolation('7', '0', '5'), 'DEGREE_RANGE', /次数/);
    const fourteen = new Array(14).fill('1').join(', ');
    expectIsoError(() => runIsolation(fourteen, '0', '5'), 'DEGREE_RANGE', /次数/);
  });

  it('区间端点次序错误被拒绝', () => {
    expectIsoError(() => runIsolation('1, -3, 2', '5', '0'), 'BAD_INTERVAL', /a < b/);
    expectIsoError(() => runIsolation('1, -3, 2', '3', '3'), 'BAD_INTERVAL', /a < b/);
  });

  it('端点非整数被拒绝', () => {
    expectIsoError(() => runIsolation('1, -3, 2', '0.5', '5'), 'BAD_FORMAT', /左端点/);
  });
});

describe('精确性保障', () => {
  it('重根按不同根计数：(x−1)^2·(x−2) 在 (0, 5) 有 2 个不同实根', () => {
    // (x−1)^2 (x−2) = x^3 − 4x^2 + 5x − 2
    const res = isolateRoots([-2n, 5n, -4n, 1n], 0n, 5n);
    expect(res.totalRoots).toBe(2);
    expect(res.intervals).toHaveLength(2);
    for (const iv of res.intervals) expect(iv.vL - iv.vR).toBe(1);
  });

  it('二分恰好命中根时仍能隔离：2x−1 在 (0, 1) 的根为 1/2', () => {
    const res = isolateRoots([-1n, 2n], 0n, 1n);
    expect(res.totalRoots).toBe(1);
    const [iv] = res.intervals;
    const half = R.rat(1n, 2n);
    expect(R.cmp(iv.l, half)).toBeLessThan(0);
    expect(R.cmp(half, iv.r)).toBeLessThan(0);
    expect(iv.vL - iv.vR).toBe(1);
  });

  it('相邻近根不被合并：x^2 − 2·10^12 x + (10^24−1) 的两根相距 2', () => {
    // (x − (10^12−1))(x − (10^12+1)) = x^2 − 2·10^12 x + (10^24 − 1)
    const k = 10n ** 12n;
    const res = isolateRoots([k * k - 1n, -2n * k, 1n], 0n, 2n * k);
    expect(res.totalRoots).toBe(2);
    const [u, v] = res.intervals;
    expect(R.cmp(u.r, v.l)).toBeLessThan(0);
    expect(R.cmp(u.l, R.fromBigInt(k - 1n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(k - 1n), u.r)).toBeLessThan(0);
    expect(R.cmp(v.l, R.fromBigInt(k + 1n))).toBeLessThan(0);
    expect(R.cmp(R.fromBigInt(k + 1n), v.r)).toBeLessThan(0);
  });

  it('variations 跳过符号序列中的 0', () => {
    expect(variations([1, 0, -1])).toBe(1);
    expect(variations([1, 0, 0, 1])).toBe(0);
    expect(variations([-1, 0, 1, 0, -1])).toBe(2);
    expect(variations([0, 0, 0])).toBe(0);
  });
});

describe('DTO 组装（Worker 计算路径）', () => {
  it('runIsolation 返回可序列化结果且证据自洽', () => {
    const dto = runIsolation('1, -3, 2', '0', '5');
    expect(dto.totalRoots).toBe(2);
    expect(dto.degree).toBe(2);
    expect(dto.polynomial).toContain('x^2');
    expect(dto.chain.length).toBe(3);
    expect(dto.vA - dto.vB).toBe(2);
    expect(dto.intervals).toHaveLength(2);
    for (const iv of dto.intervals) {
      expect(iv.vL - iv.vR).toBe(1);
      expect(typeof iv.l).toBe('string');
      expect(typeof iv.r).toBe('string');
    }
    // 可结构化克隆 / JSON 序列化（Worker postMessage 的前提）
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('支持中文逗号与空白混合分隔', () => {
    const dto = runIsolation('1， -3  2', '0', '5');
    expect(dto.totalRoots).toBe(2);
  });
});
