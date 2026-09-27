/**
 * 输入解析、隔离入口与可序列化结果（DTO）组装。
 * 该模块被 Web Worker 与单元测试共同使用，保证页面计算路径可测试。
 */
import * as P from './poly';
import * as R from './rational';
import { compareGap, type GapRelation } from './gap';
import { IsoError, isolateRoots, MAX_DEGREE, MIN_DEGREE } from './sturm';

export type { GapRelation } from './gap';

/** 解析单个整数（允许前导符号与空白），非法格式抛出 BAD_FORMAT。 */
export const parseInteger = (raw: string, label: string): bigint => {
  const t = raw.trim();
  if (!/^[+-]?\d+$/.test(t)) {
    throw new IsoError('BAD_FORMAT', `${label}“${raw.trim() || '(空)'}”不是合法整数`);
  }
  return BigInt(t);
};

/**
 * 解析系数串：按逗号、空白或分号分隔，降幂输入（最高次在前）。
 * 返回降幂排列的整数系数数组。
 */
export const parseCoefficients = (raw: string): bigint[] => {
  const parts = raw
    .trim()
    .split(/[,，;；\s]+/)
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new IsoError('BAD_FORMAT', '请输入多项式系数（降幂、以逗号或空格分隔）');
  }
  const coeffs = parts.map((s) => parseInteger(s, '系数'));
  if (coeffs.length < MIN_DEGREE + 1 || coeffs.length > MAX_DEGREE + 1) {
    throw new IsoError(
      'DEGREE_RANGE',
      `系数个数为 ${coeffs.length}，对应次数 ${coeffs.length - 1}；次数须在 ${MIN_DEGREE} 至 ${MAX_DEGREE} 之间`,
    );
  }
  return coeffs;
};

export interface IntervalDTO {
  /** 有理端点精确分式。 */
  l: string;
  r: string;
  /** 十进制近似（仅展示用）。 */
  lDec: string;
  rDec: string;
  /** Sturm 证据：V(l)、V(r)，恒有 vL − vR = 1。 */
  vL: number;
  vR: number;
  signsL: string;
  signsR: string;
}

export interface ResultDTO {
  polynomial: string;
  degree: number;
  a: string;
  b: string;
  chain: string[];
  totalRoots: number;
  vA: number;
  vB: number;
  signsA: string;
  signsB: string;
  intervals: IntervalDTO[];
}

export const formatSigns = (signs: number[]): string =>
  signs.map((s) => (s > 0 ? '+' : s < 0 ? '−' : '0')).join(' ');

/**
 * 解析正有理安全间距阈值。支持三种精确形式：
 *   整数 "2"、分数 "3/2"（分母非零）、有限小数 "0.5"。
 * 有限小数按精确有理数转换（0.5 = 1/2），不引入任何近似；
 * 结果必须严格为正，否则抛出 BAD_THRESHOLD。
 */
export const parseThreshold = (raw: string): R.Rat => {
  const t = raw.trim();
  if (t.length === 0) {
    throw new IsoError(
      'BAD_THRESHOLD',
      '请输入正有理数安全间距（整数、分数 a/b 或有限小数）',
    );
  }
  const fail = (): never => {
    throw new IsoError(
      'BAD_THRESHOLD',
      `安全间距“${t}”不是合法的正有理数（支持整数、分数 a/b、有限小数）`,
    );
  };
  const frac = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(t);
  let value: R.Rat;
  if (frac) {
    const den = BigInt(frac[2]);
    if (den === 0n) {
      throw new IsoError('BAD_THRESHOLD', `安全间距“${t}”的分母不能为零`);
    }
    value = R.rat(BigInt(frac[1]), den);
  } else {
    const dec = /^([+-]?)(\d+)(?:\.(\d+))?$|^([+-]?)\.(\d+)$/.exec(t);
    if (!dec) return fail();
    if (dec[1] !== undefined) {
      // 整数或 "整数.小数" 形式
      const intPart = dec[2];
      const fracPart = dec[3] ?? '';
      const num = BigInt(intPart + fracPart);
      const den = 10n ** BigInt(fracPart.length);
      value = R.rat(dec[1] === '-' ? -num : num, den);
    } else {
      // ".5" 形式
      const fracPart = dec[5];
      const num = BigInt(fracPart);
      const den = 10n ** BigInt(fracPart.length);
      value = R.rat(dec[4] === '-' ? -num : num, den);
    }
  }
  if (value.n <= 0n) {
    throw new IsoError(
      'BAD_THRESHOLD',
      `安全间距必须为正有理数（收到“${t}”）`,
    );
  }
  return value;
};

/**
 * 完整计算入口：解析 → 精确隔离 → 组装可序列化结果。
 * 所有错误以 IsoError 抛出，由调用方（Worker）转成消息。
 */
export const runIsolation = (
  coeffRaw: string,
  aRaw: string,
  bRaw: string,
): ResultDTO => {
  const coeffsDesc = parseCoefficients(coeffRaw);
  const a = parseInteger(aRaw, '左端点');
  const b = parseInteger(bRaw, '右端点');
  const coeffsAsc = [...coeffsDesc].reverse();

  const res = isolateRoots(coeffsAsc, a, b);
  const p = P.fromBigInts(coeffsAsc);

  return {
    polynomial: P.toString(p),
    degree: P.degree(p),
    a: a.toString(),
    b: b.toString(),
    chain: res.chain.map((q) => P.toString(q)),
    totalRoots: res.totalRoots,
    vA: res.vA,
    vB: res.vB,
    signsA: formatSigns(res.signsA),
    signsB: formatSigns(res.signsB),
    intervals: res.intervals.map((iv) => ({
      l: R.toString(iv.l),
      r: R.toString(iv.r),
      lDec: R.toDecimal(iv.l, 6),
      rDec: R.toDecimal(iv.r, 6),
      vL: iv.vL,
      vR: iv.vR,
      signsL: formatSigns(iv.signsL),
      signsR: formatSigns(iv.signsR),
    })),
  };
};

/** 一对相邻根间距审计结论（DTO，全部精确分式字符串，可复算）。 */
export interface GapPairDTO {
  /** 相邻对序号（按根数值升序，1 起）。 */
  index: number;
  /** 左、右根在根序列中的序号（1 起）。 */
  leftRoot: number;
  rightRoot: number;
  /** 间距与阈值的关系：小于 / 恰等于 / 大于。 */
  relation: GapRelation;
  /** 仅小于或等于阈值时标为风险。 */
  risk: boolean;
  /** 判定成立时（可能经收缩）的两段隔离区间端点。 */
  l1: string;
  r1: string;
  l2: string;
  r2: string;
  /** 间距 d 的严格下界 l2 − r1 与严格上界 r2 − l1。 */
  lowerBound: string;
  upperBound: string;
  /** relation 为 equal 时：精确公因子 h(x) 及其有根的交集区间。 */
  gcdFactor: string | null;
  equalLo: string | null;
  equalHi: string | null;
}

/** 间距风险审计结果（DTO）：冻结本次曲线与开区间的快照。 */
export interface GapAuditDTO {
  polynomial: string;
  degree: number;
  a: string;
  b: string;
  /** 正有理安全间距阈值（精确分式）与十进制近似（仅展示）。 */
  threshold: string;
  thresholdDec: string;
  rootCount: number;
  pairCount: number;
  riskCount: number;
  pairs: GapPairDTO[];
}

/**
 * 间距风险审计入口：解析 → 精确隔离 → 逐对比较相邻实根间距与阈值。
 * 冻结本次曲线与开区间（按请求参数重新精确隔离，确定性算法保证与
 * 页面既有结果一致），只比较按数值相邻的不同实根。
 *
 * @throws IsoError 阈值格式非法（BAD_THRESHOLD）、区间内不同实根
 *         不足两个（TOO_FEW_ROOTS），以及隔离阶段的全部既有错误。
 */
export const runGapAudit = (
  coeffRaw: string,
  aRaw: string,
  bRaw: string,
  thresholdRaw: string,
): GapAuditDTO => {
  const coeffsDesc = parseCoefficients(coeffRaw);
  const a = parseInteger(aRaw, '左端点');
  const b = parseInteger(bRaw, '右端点');
  const t = parseThreshold(thresholdRaw);
  const coeffsAsc = [...coeffsDesc].reverse();

  const res = isolateRoots(coeffsAsc, a, b);
  if (res.totalRoots < 2) {
    throw new IsoError(
      'TOO_FEW_ROOTS',
      `开区间 (${a}, ${b}) 内只有 ${res.totalRoots} 个不同实根，不足两个，没有可比较的相邻根对，间距审计无法进行`,
    );
  }
  const p = P.fromBigInts(coeffsAsc);

  const pairs: GapPairDTO[] = [];
  for (let i = 0; i + 1 < res.intervals.length; i++) {
    const cmp = compareGap(p, res.chain, res.intervals[i], res.intervals[i + 1], t);
    pairs.push({
      index: i + 1,
      leftRoot: i + 1,
      rightRoot: i + 2,
      relation: cmp.relation,
      risk: cmp.relation !== 'greater',
      l1: R.toString(cmp.l1),
      r1: R.toString(cmp.r1),
      l2: R.toString(cmp.l2),
      r2: R.toString(cmp.r2),
      lowerBound: R.toString(cmp.lower),
      upperBound: R.toString(cmp.upper),
      gcdFactor: cmp.gcdFactor ? P.toString(cmp.gcdFactor) : null,
      equalLo: cmp.equalLo ? R.toString(cmp.equalLo) : null,
      equalHi: cmp.equalHi ? R.toString(cmp.equalHi) : null,
    });
  }

  return {
    polynomial: P.toString(p),
    degree: P.degree(p),
    a: a.toString(),
    b: b.toString(),
    threshold: R.toString(t),
    thresholdDec: R.toDecimal(t, 6),
    rootCount: res.totalRoots,
    pairCount: pairs.length,
    riskCount: pairs.filter((pair) => pair.risk).length,
    pairs,
  };
};
