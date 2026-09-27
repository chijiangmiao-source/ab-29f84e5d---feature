/**
 * 相邻实根间距的风险审计。
 *
 * 在隔离结果之上，对开区间内按数值相邻的每对不同实根
 * ξ_i < ξ_{i+1}，判定其间距 d = ξ_{i+1} − ξ_i 与正有理安全
 * 阈值 t 的大小关系，结论分为小于、恰等于、大于三档，
 * 仅「小于或等于」被标记为风险。
 *
 * 判定方法（全部为 BigInt 有理数精确运算，不使用浮点近似、
 * 显示精度或采样距离作为判据）：
 *
 *  - 严格不等：持续二分收缩两根的隔离段 L ∋ ξ_i、U ∋ ξ_{i+1}。
 *    恒有 d ∈ (U.l − L.r, U.r − L.l)；一旦该开区间不再覆盖 t，
 *    即得严格结论——上界 U.r − L.l ≤ t ⇒ d < t；
 *    下界 U.l − L.r ≥ t ⇒ d > t。d ≠ t 时收缩必在有限步内分离。
 *
 *  - 恰等边界：d = t 时收缩永不分离，改用精确公因子判定。
 *    d = t 当且仅当 ξ_i 是 g = gcd(p(x), p(x + t)) 的根
 *    （此时 ξ_i 与 ξ_i + t 同为 p 的根）。以 Sturm 计数确认 g
 *    在 L 内有根后，继续收缩 L 直至平移段 L + t 严格落入
 *    ξ_{i+1} 的（冻结的）初始隔离段 U₀；因 U₀ 内恰含 p 的一个
 *    根，即证 ξ_i + t = ξ_{i+1}。注意包含判定必须对冻结的 U₀
 *    进行：若 U 也同步收缩，两侧同时趋于 ξ_{i+1}，包含关系
 *    可能永不成立。
 */
import * as P from './poly';
import * as R from './rational';
import {
  buildSturmChain,
  evalChain,
  IsoError,
  type ChainEval,
  type IsolationResult,
} from './sturm';

export type GapRelation = 'less' | 'equal' | 'greater';

export interface ShrunkInterval {
  l: R.Rat;
  r: R.Rat;
}

export interface GapPairAudit {
  /** 相邻对左侧根的序号（按数值升序从 1 起）；比较第 index 与第 index+1 个根。 */
  index: number;
  /** 间距 d 与阈值 t 的关系：小于 / 恰等于 / 大于。 */
  relation: GapRelation;
  /** 风险标记：仅当间距小于或等于阈值（less / equal）时为 true。 */
  risk: boolean;
  /** 得出判定所用的隔离段收缩步数。 */
  steps: number;
  /** 判定时刻的精确界限：恒有 lower < d < upper。 */
  lower: R.Rat;
  upper: R.Rat;
  /** 判定时刻两根的（已收缩）隔离段，与界限一起构成可复算证据。
   *  relation 为 equal 时 right 为 ξ_{i+1} 的初始隔离段（包含判定对其冻结）。 */
  left: ShrunkInterval;
  right: ShrunkInterval;
  /** relation 为 equal 时的证据：p(x) 与 p(x + t) 的精确公因子。 */
  gcdFactor: P.Poly | null;
}

const MAX_AUDIT_STEPS = 4096;

/** 构造带缓存的 Sturm 链求值器，键为规范化分式串。 */
const makeEvaluator = (chain: P.Poly[]) => {
  const cache = new Map<string, ChainEval>();
  return (x: R.Rat): ChainEval => {
    const key = R.toString(x);
    let hit = cache.get(key);
    if (!hit) {
      hit = evalChain(chain, x);
      cache.set(key, hit);
    }
    return hit;
  };
};

/**
 * 将恰含一个根的隔离段二分收缩一半，保持根在段内。
 * 分割点须不是 p 的根：依次尝试 1/2, 1/4, 3/4, 1/8, …，
 * p 的实根有限，必在有限次内命中非根点。
 */
const shrinkInterval = (
  p: P.Poly,
  evalAt: (x: R.Rat) => ChainEval,
  iv: ShrunkInterval,
): ShrunkInterval => {
  const width = R.sub(iv.r, iv.l);
  for (let k = 1; k <= 16; k++) {
    const den = 1n << BigInt(k);
    for (let m = 1n; m < den; m += 2n) {
      const x = R.add(iv.l, R.mul(width, R.rat(m, den)));
      if (!R.isZero(P.evalRat(p, x))) {
        const leftCount = evalAt(iv.l).variations - evalAt(x).variations;
        return leftCount === 1 ? { l: iv.l, r: x } : { l: x, r: iv.r };
      }
    }
  }
  throw new IsoError('INTERNAL', '间距审计收缩时未能在隔离段内找到非根分割点');
};

/** 判定一对相邻根的间距与阈值的关系。 */
const decidePair = (
  p: P.Poly,
  evalAt: (x: R.Rat) => ChainEval,
  gcdFactor: P.Poly,
  gcdEval: ((x: R.Rat) => ChainEval) | null,
  left0: ShrunkInterval,
  right0: ShrunkInterval,
  t: R.Rat,
  index: number,
): GapPairAudit => {
  let L: ShrunkInterval = { l: left0.l, r: left0.r };
  let U: ShrunkInterval = { l: right0.l, r: right0.r };

  // d = t 的必要条件：ξ_i 是 g 的根。隔离段端点不是 p 的根，
  // 而 g | p，故端点也不是 g 的根，Sturm 计数 V(l) − V(r) 合法。
  // 收缩不改变「ξ_i 在 L 内」这一事实，该判定只需做一次。
  const equalityPossible =
    gcdEval !== null &&
    gcdEval(L.l).variations - gcdEval(L.r).variations > 0;

  for (let steps = 0; ; steps++) {
    if (steps > MAX_AUDIT_STEPS) {
      throw new IsoError('INTERNAL', '间距审计的隔离段收缩超出迭代上限');
    }
    // d = ξ_{i+1} − ξ_i ∈ (lower, upper)，两端均为精确有理数。
    const lower = R.sub(U.l, L.r);
    const upper = R.sub(U.r, L.l);
    if (R.cmp(upper, t) <= 0) {
      // d < upper ≤ t ⇒ d < t（严格小于，由收缩证明）
      return {
        index,
        relation: 'less',
        risk: true,
        steps,
        lower,
        upper,
        left: L,
        right: U,
        gcdFactor: null,
      };
    }
    if (R.cmp(lower, t) >= 0) {
      // d > lower ≥ t ⇒ d > t（严格大于，由收缩证明）
      return {
        index,
        relation: 'greater',
        risk: false,
        steps,
        lower,
        upper,
        left: L,
        right: U,
        gcdFactor: null,
      };
    }
    if (
      equalityPossible &&
      R.cmp(R.add(L.l, t), right0.l) > 0 &&
      R.cmp(R.add(L.r, t), right0.r) < 0
    ) {
      // ξ_i 是 g 的根 ⇒ ρ = ξ_i + t 也是 p 的根；平移段 L + t 严格
      // 落入冻结的初始隔离段 U₀，而 U₀ 内恰含 p 的一个根 ξ_{i+1}
      // ⇒ ρ = ξ_{i+1}，即 d = t（恰等边界，公因子判定）。
      // 对 d ≠ t 的情形该包含关系不可能成立：若成立则 ρ ∈ U₀，
      // 与 U₀ 内唯一根 ξ_{i+1} = ξ_i + d ≠ ρ 矛盾。
      return {
        index,
        relation: 'equal',
        risk: true,
        steps,
        lower,
        upper,
        left: L,
        right: { l: right0.l, r: right0.r },
        gcdFactor,
      };
    }
    L = shrinkInterval(p, evalAt, L);
    U = shrinkInterval(p, evalAt, U);
  }
};

/**
 * 对隔离结果中按数值升序的相邻根对逐一审计间距。
 * 要求开区间内至少有两个不同实根，否则抛出 INSUFFICIENT_ROOTS。
 */
export const auditGaps = (
  isolation: IsolationResult,
  p: P.Poly,
  threshold: R.Rat,
): GapPairAudit[] => {
  const ivs = isolation.intervals;
  if (ivs.length < 2) {
    throw new IsoError(
      'INSUFFICIENT_ROOTS',
      `开区间内不同实根数为 ${ivs.length}，不足两个，没有可比较的相邻根对`,
    );
  }
  const evalAt = makeEvaluator(isolation.chain);

  // p(x) 与其有理平移 p(x + t) 的精确公因子：只取决于曲线与阈值，
  // 与具体根对无关，全部根对共用一次计算。
  const gcdFactor = P.gcd(p, P.shift(p, threshold));
  const gcdEval =
    P.degree(gcdFactor) >= 1 ? makeEvaluator(buildSturmChain(gcdFactor)) : null;

  const pairs: GapPairAudit[] = [];
  for (let i = 0; i + 1 < ivs.length; i++) {
    pairs.push(
      decidePair(
        p,
        evalAt,
        gcdFactor,
        gcdEval,
        ivs[i],
        ivs[i + 1],
        threshold,
        i + 1,
      ),
    );
  }
  return pairs;
};
