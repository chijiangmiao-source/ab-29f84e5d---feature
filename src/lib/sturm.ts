/**
 * Sturm 定理的精确实根隔离。
 *
 * 数学依据（广义 Sturm 定理）：设 p 为实系数多项式，Sturm 链
 *   p0 = p, p1 = p', p_{i+1} = −rem(p_{i−1}, p_i)
 * 终止于零余式。对任意不是 p 的根的有理数 x，记 V(x) 为链在 x 处
 * 符号序列（忽略 0）的变号数，则开区间 (l, r) 内 p 的不同实根数
 * 恰为 V(l) − V(r)（端点均非根时）。重根不影响该计数。
 *
 * 全部计算使用 BigInt 有理数，符号判定完全精确，
 * 不存在浮点近似导致的相邻根合并或遗漏。
 */
import * as P from './poly';
import * as R from './rational';

export type IsoErrorCode =
  | 'DEGREE_RANGE'
  | 'LEADING_ZERO'
  | 'BAD_INTERVAL'
  | 'ENDPOINT_ROOT'
  | 'BAD_FORMAT'
  | 'INTERNAL';

export class IsoError extends Error {
  readonly code: IsoErrorCode;
  constructor(code: IsoErrorCode, message: string) {
    super(message);
    this.name = 'IsoError';
    this.code = code;
  }
}

export const MIN_DEGREE = 1;
export const MAX_DEGREE = 12;

/** 构造 Sturm 链：p, p′, 随后逐项取负余式，直至余式为零。 */
export const buildSturmChain = (p: P.Poly): P.Poly[] => {
  if (P.isZero(p) || P.degree(p) < 1) {
    throw new IsoError('INTERNAL', 'Sturm 链要求多项式次数至少为 1');
  }
  const chain: P.Poly[] = [p, P.derivative(p)];
  for (let guard = 0; guard < 64; guard++) {
    const rem = P.remainder(chain[chain.length - 2], chain[chain.length - 1]);
    if (P.isZero(rem)) return chain;
    chain.push(P.neg(rem));
  }
  throw new IsoError('INTERNAL', 'Sturm 链构造超出预期长度');
};

/** 链中各多项式在有理点 x 处的精确符号序列（−1 / 0 / +1）。 */
export const signSequence = (chain: P.Poly[], x: R.Rat): number[] =>
  chain.map((p) => P.signAt(p, x));

/** 符号序列的变号数（跳过 0 项）。 */
export const variations = (signs: number[]): number => {
  let count = 0;
  let prev = 0;
  for (const s of signs) {
    if (s === 0) continue;
    if (prev !== 0 && s !== prev) count++;
    prev = s;
  }
  return count;
};

export interface ChainEval {
  signs: number[];
  variations: number;
}

export const evalChain = (chain: P.Poly[], x: R.Rat): ChainEval => {
  const signs = signSequence(chain, x);
  return { signs, variations: variations(signs) };
};

export interface IsolatingInterval {
  /** 区间端点（有理数，均非 p 的根），根严格落在 (l, r) 内。 */
  l: R.Rat;
  r: R.Rat;
  /** Sturm 证据：V(l) 与 V(r)，恒有 vL − vR = 1。 */
  vL: number;
  vR: number;
  signsL: number[];
  signsR: number[];
}

export interface IsolationResult {
  chain: P.Poly[];
  /** 开区间 (a, b) 内不同实根的总数。 */
  totalRoots: number;
  vA: number;
  vB: number;
  signsA: number[];
  signsB: number[];
  /** 按数值升序、两两互不相交（端点严格分离）的隔离区间。 */
  intervals: IsolatingInterval[];
}

const MAX_BISECTION_STEPS = 100_000;
const MAX_REFINE_STEPS = 10_000;

/**
 * 精确隔离整数系数多项式在开区间 (a, b) 内的全部不同实根。
 *
 * @param coeffsAsc 整数系数，coeffsAsc[i] 为 x^i 的系数，长度 2..13
 * @throws IsoError 端点为根 / 首项为零 / 次数越界 / 区间端点次序错误
 */
export const isolateRoots = (
  coeffsAsc: bigint[],
  a: bigint,
  b: bigint,
): IsolationResult => {
  if (
    coeffsAsc.length < MIN_DEGREE + 1 ||
    coeffsAsc.length > MAX_DEGREE + 1
  ) {
    throw new IsoError(
      'DEGREE_RANGE',
      `多项式次数须在 ${MIN_DEGREE} 至 ${MAX_DEGREE} 之间（收到 ${coeffsAsc.length - 1} 次）`,
    );
  }
  if (coeffsAsc[coeffsAsc.length - 1] === 0n) {
    throw new IsoError('LEADING_ZERO', '首项（最高次）系数不能为零');
  }
  if (a >= b) {
    throw new IsoError('BAD_INTERVAL', `区间端点需满足 a < b（收到 a=${a}, b=${b}）`);
  }

  const p = P.fromBigInts(coeffsAsc);
  const ra = R.fromBigInt(a);
  const rb = R.fromBigInt(b);

  if (R.isZero(P.evalRat(p, ra))) {
    throw new IsoError(
      'ENDPOINT_ROOT',
      `左端点 x = ${a} 恰为多项式的根，开区间统计无意义，请调整端点`,
    );
  }
  if (R.isZero(P.evalRat(p, rb))) {
    throw new IsoError(
      'ENDPOINT_ROOT',
      `右端点 x = ${b} 恰为多项式的根，开区间统计无意义，请调整端点`,
    );
  }

  const chain = buildSturmChain(p);

  // 同一有理点的链求值结果缓存，键为规范化分式串。
  const cache = new Map<string, ChainEval>();
  const evalAt = (x: R.Rat): ChainEval => {
    const key = R.toString(x);
    let hit = cache.get(key);
    if (!hit) {
      hit = evalChain(chain, x);
      cache.set(key, hit);
    }
    return hit;
  };

  const evA = evalAt(ra);
  const evB = evalAt(rb);
  const total = evA.variations - evB.variations;

  /**
   * 在 (l, r) 内选取一个不是 p 的根的二进有理分割点。
   * 依次尝试 1/2, 1/4, 3/4, 1/8, …；p 至多 12 个实根，
   * 前 15 个候选内必命中非根点。
   */
  const findSplit = (l: R.Rat, r: R.Rat): R.Rat => {
    const width = R.sub(r, l);
    for (let k = 1; k <= 16; k++) {
      const den = 1n << BigInt(k);
      for (let m = 1n; m < den; m += 2n) {
        const x = R.add(l, R.mul(width, R.rat(m, den)));
        if (!R.isZero(P.evalRat(p, x))) return x;
      }
    }
    throw new IsoError('INTERNAL', '未能在区间内找到非根分割点');
  };

  // 二分隔离：栈中每项 (l, r, k) 满足 V(l) − V(r) = k，即 (l, r) 内恰有 k 个不同实根。
  const units: { l: R.Rat; r: R.Rat }[] = [];
  const stack: { l: R.Rat; r: R.Rat; k: number }[] = [];
  if (total > 0) stack.push({ l: ra, r: rb, k: total });

  let steps = 0;
  while (stack.length > 0) {
    if (++steps > MAX_BISECTION_STEPS) {
      throw new IsoError('INTERNAL', '二分隔离超出迭代上限');
    }
    const { l, r, k } = stack.pop()!;
    if (k === 1) {
      units.push({ l, r });
      continue;
    }
    const x = findSplit(l, r);
    const kLeft = evalAt(l).variations - evalAt(x).variations;
    const kRight = k - kLeft;
    if (kLeft > 0) stack.push({ l, r: x, k: kLeft });
    if (kRight > 0) stack.push({ l: x, r, k: kRight });
  }

  // 按数值升序排列。
  units.sort((u, v) => R.cmp(u.l, v.l));

  // 相邻区间若端点相接（r_i == l_{i+1}），继续二分收缩左侧区间，
  // 直至所有区间两两端点严格分离，保证互不相交。
  const refineOnce = (iv: { l: R.Rat; r: R.Rat }): { l: R.Rat; r: R.Rat } => {
    const x = findSplit(iv.l, iv.r);
    const kLeft = evalAt(iv.l).variations - evalAt(x).variations;
    return kLeft === 1 ? { l: iv.l, r: x } : { l: x, r: iv.r };
  };
  for (let i = 0; i + 1 < units.length; i++) {
    let guard = 0;
    while (R.cmp(units[i].r, units[i + 1].l) >= 0) {
      if (++guard > MAX_REFINE_STEPS) {
        throw new IsoError('INTERNAL', '区间分离超出迭代上限');
      }
      units[i] = refineOnce(units[i]);
    }
  }

  const intervals: IsolatingInterval[] = units.map(({ l, r }) => {
    const evL = evalAt(l);
    const evR = evalAt(r);
    return {
      l,
      r,
      vL: evL.variations,
      vR: evR.variations,
      signsL: evL.signs,
      signsR: evR.signs,
    };
  });

  return {
    chain,
    totalRoots: total,
    vA: evA.variations,
    vB: evB.variations,
    signsA: evA.signs,
    signsB: evB.signs,
    intervals,
  };
};
