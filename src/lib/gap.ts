/**
 * 相邻实根间距与正有理阈值的精确比较（间距风险审计的核心算法）。
 *
 * 设 α < β 为 p 的两个按数值相邻的不同实根，分别由隔离区间
 * (l1, r1)、(l2, r2) 确定（每段恰含一个根），t 为正有理安全间距。
 * 记间距 d = β − α，则恒有严格夹逼
 *   l2 − r1 < d < r2 − l1 。
 *
 * 严格大小（d < t / d > t）的证明：以既有 BigInt 有理数运算持续
 * 二分收缩两段隔离区间，一旦
 *   r2 − l1 ≤ t  ⟹  d < t（严格小于），或
 *   l2 − r1 ≥ t  ⟹  d > t（严格大于），
 * 即得结论。全部比较均为精确有理数比较，不使用任何小数近似、
 * 显示精度或采样距离作为判据。
 *
 * 恰等边界（d == t）：若 d == t，收缩永远不能分离（恒有
 * l2 − r1 < t < r2 − l1），此时以多项式与其有理平移后的精确公因子
 *   h(x) = gcd(p(x), p(x + t))
 * 判定：d == t 当且仅当 h 在开区间
 *   (max(l1, l2 − t), min(r1, r2 − t))
 * 内有根（该区间端点处 h 必非零：端点为 l1/r1 时因 p 在其上非零，
 * 端点为 l2 − t / r2 − t 时因 p 在 l2/r2 非零而 h 的根须同时是
 * p(x) 与 p(x + t) 的根）。h 的根数由 h 的 Sturm 链精确计数。
 */
import * as P from './poly';
import * as R from './rational';
import { buildSturmChain, evalChain, IsoError } from './sturm';

export type GapRelation = 'less' | 'equal' | 'greater';

export interface GapCompareResult {
  relation: GapRelation;
  /** 判定成立时（可能经收缩）的两段隔离区间。 */
  l1: R.Rat;
  r1: R.Rat;
  l2: R.Rat;
  r2: R.Rat;
  /** 间距 d 的严格下界 l2 − r1 与严格上界 r2 − l1（可复算证据）。 */
  lower: R.Rat;
  upper: R.Rat;
  /** relation 为 equal 时：精确公因子 h(x) 及其有根的交集区间。 */
  gcdFactor: P.Poly | null;
  equalLo: R.Rat | null;
  equalHi: R.Rat | null;
}

/** 二项式系数 C(n, k)，BigInt 精确计算。 */
const binom = (n: number, k: number): bigint => {
  let res = 1n;
  for (let i = 0; i < k; i++) {
    res = (res * BigInt(n - i)) / BigInt(i + 1);
  }
  return res;
};

/**
 * 有理平移：返回 p(x + t)，t 为精确有理数。
 * p(x + t) = Σ_i c_i · (x + t)^i = Σ_j ( Σ_{i≥j} c_i·C(i,j)·t^(i−j) )·x^j。
 */
export const translate = (p: P.Poly, t: R.Rat): P.Poly => {
  const n = P.degree(p);
  if (n < 0) return P.ZERO;
  const out: R.Rat[] = [];
  for (let j = 0; j <= n; j++) out.push(R.ZERO);
  for (let i = 0; i <= n; i++) {
    // (x + t)^i 展开：j 从 i 递减到 0，tPow 依次为 t^0, t^1, …, t^i
    let tPow = R.ONE;
    for (let j = i; j >= 0; j--) {
      const term = R.mul(p.c[i], R.mul(R.fromBigInt(binom(i, j)), tPow));
      out[j] = R.add(out[j], term);
      tPow = R.mul(tPow, t);
    }
  }
  return P.poly(out);
};

/** 有理数域上的首一最大公因子（欧几里得算法，全部精确）。 */
export const gcdMonic = (a: P.Poly, b: P.Poly): P.Poly => {
  let x = a;
  let y = b;
  for (let guard = 0; !P.isZero(y); ) {
    if (++guard > 64) {
      throw new IsoError('INTERNAL', '多项式公因子计算超出迭代上限');
    }
    const r = P.remainder(x, y);
    x = y;
    y = r;
  }
  if (P.isZero(x)) return x;
  const lc = P.leadingCoeff(x);
  if (R.eq(lc, R.ONE)) return x;
  return P.poly(x.c.map((c) => R.div(c, lc)));
};

/** 收缩不能分离时允许的最大二分轮数，超过后转入公因子判定。 */
const SHRINK_ROUNDS_BEFORE_GCD = 64;
/** 绝对迭代上限（d ≠ t 时二分必然终止，此为防御性兜底）。 */
const HARD_SHRINK_LIMIT = 100_000;

interface Shrinker {
  /** (l, r) 恰含 p 的一个根（V(l) − V(r) = 1），返回收缩后的子区间。 */
  shrink: (l: R.Rat, r: R.Rat) => { l: R.Rat; r: R.Rat };
}

/** 基于 Sturm 链的区间收缩器，带变号数缓存。 */
const makeShrinker = (p: P.Poly, chain: P.Poly[]): Shrinker => {
  const cache = new Map<string, number>();
  const variationsAt = (x: R.Rat): number => {
    const key = R.toString(x);
    let v = cache.get(key);
    if (v === undefined) {
      v = evalChain(chain, x).variations;
      cache.set(key, v);
    }
    return v;
  };

  /** 在 (l, r) 内选取一个不是 p 的根的二进有理分割点。 */
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

  const shrink = (l: R.Rat, r: R.Rat): { l: R.Rat; r: R.Rat } => {
    const x = findSplit(l, r);
    return variationsAt(l) - variationsAt(x) === 1
      ? { l, r: x }
      : { l: x, r };
  };

  return { shrink };
};

interface EqualWitness {
  factor: P.Poly;
  lo: R.Rat;
  hi: R.Rat;
}

/**
 * 恰等边界的精确判定：h = gcd(p(x), p(x + t))，若 h 在
 * (max(l1, l2 − t), min(r1, r2 − t)) 内有根，则两段隔离区间内的
 * 根 α < β 恰满足 β − α = t，返回 h 与该区间；否则返回 null。
 */
const equalWitness = (
  p: P.Poly,
  t: R.Rat,
  l1: R.Rat,
  r1: R.Rat,
  l2: R.Rat,
  r2: R.Rat,
): EqualWitness | null => {
  const h = gcdMonic(p, translate(p, t));
  if (P.degree(h) < 1) return null;
  const l2Shift = R.sub(l2, t);
  const r2Shift = R.sub(r2, t);
  const lo = R.cmp(l1, l2Shift) >= 0 ? l1 : l2Shift;
  const hi = R.cmp(r1, r2Shift) <= 0 ? r1 : r2Shift;
  if (R.cmp(lo, hi) >= 0) return null;
  // 端点处 h 必非零（见文件头注释），Sturm 定理直接适用。
  const hChain = buildSturmChain(h);
  const count =
    evalChain(hChain, lo).variations - evalChain(hChain, hi).variations;
  return count > 0 ? { factor: h, lo, hi } : null;
};

/**
 * 精确比较一对相邻根的间距 d 与正有理阈值 t。
 *
 * @param p      整数系数多项式
 * @param chain  p 的 Sturm 链
 * @param iv1    根 α 的隔离区间（V(l1) − V(r1) = 1）
 * @param iv2    根 β 的隔离区间（V(l2) − V(r2) = 1），且 r1 < l2
 * @param t      正有理安全间距
 */
export const compareGap = (
  p: P.Poly,
  chain: P.Poly[],
  iv1: { l: R.Rat; r: R.Rat },
  iv2: { l: R.Rat; r: R.Rat },
  t: R.Rat,
): GapCompareResult => {
  const { shrink } = makeShrinker(p, chain);
  let { l: l1, r: r1 } = iv1;
  let { l: l2, r: r2 } = iv2;
  let gcdTried = false;

  for (let round = 0; ; round++) {
    const upper = R.sub(r2, l1); // d < upper（严格）
    if (R.cmp(upper, t) <= 0) {
      // d < upper ≤ t ⟹ d < t，由收缩后的隔离段精确证明。
      return {
        relation: 'less',
        l1, r1, l2, r2,
        lower: R.sub(l2, r1),
        upper,
        gcdFactor: null,
        equalLo: null,
        equalHi: null,
      };
    }
    const lower = R.sub(l2, r1); // d > lower（严格）
    if (R.cmp(lower, t) >= 0) {
      // d > lower ≥ t ⟹ d > t，由收缩后的隔离段精确证明。
      return {
        relation: 'greater',
        l1, r1, l2, r2,
        lower,
        upper,
        gcdFactor: null,
        equalLo: null,
        equalHi: null,
      };
    }
    if (round >= HARD_SHRINK_LIMIT) {
      throw new IsoError('INTERNAL', '间距审计的区间收缩超出迭代上限');
    }
    if (round >= SHRINK_ROUNDS_BEFORE_GCD && !gcdTried) {
      // 持续收缩仍不能分离：以精确公因子判定恰等边界。
      gcdTried = true;
      const witness = equalWitness(p, t, l1, r1, l2, r2);
      if (witness) {
        return {
          relation: 'equal',
          l1, r1, l2, r2,
          lower,
          upper,
          gcdFactor: witness.factor,
          equalLo: witness.lo,
          equalHi: witness.hi,
        };
      }
      // 公因子判定否定恰等：d ≠ t，继续收缩必然分离。
    }
    const s1 = shrink(l1, r1);
    l1 = s1.l;
    r1 = s1.r;
    const s2 = shrink(l2, r2);
    l2 = s2.l;
    r2 = s2.r;
  }
};
