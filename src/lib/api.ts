/**
 * 输入解析、隔离入口与可序列化结果（DTO）组装。
 * 该模块被 Web Worker 与单元测试共同使用，保证页面计算路径可测试。
 */
import { auditGaps, type GapRelation } from './audit';
import * as P from './poly';
import * as R from './rational';
import { IsoError, isolateRoots, MAX_DEGREE, MIN_DEGREE } from './sturm';

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

/**
 * 解析正有理安全间距阈值：接受整数或 p/q 形式（p、q 为整数，q ≠ 0），
 * 结果必须为正。非法格式或非正数值抛出 BAD_THRESHOLD。
 */
export const parsePositiveRational = (raw: string): R.Rat => {
  const t = raw.trim();
  const m = /^([+-]?\d+)(?:\/(\d+))?$/.exec(t);
  if (!m) {
    throw new IsoError(
      'BAD_THRESHOLD',
      `安全间距阈值“${t || '(空)'}”不是合法有理数，请使用整数或 p/q 形式（p、q 为整数，q ≠ 0）`,
    );
  }
  const num = BigInt(m[1]);
  const den = m[2] !== undefined ? BigInt(m[2]) : 1n;
  if (den === 0n) {
    throw new IsoError('BAD_THRESHOLD', '安全间距阈值的分母不能为零');
  }
  const value = R.rat(num, den);
  if (value.n <= 0n) {
    throw new IsoError(
      'BAD_THRESHOLD',
      `安全间距阈值必须为正有理数（收到 ${R.toString(value)}）`,
    );
  }
  return value;
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

export interface AuditPairDTO {
  /** 相邻对左侧根序号（从 1 起）；比较第 index 与第 index+1 个根。 */
  index: number;
  /** 间距与阈值的关系：less 小于 / equal 恰等于 / greater 大于。 */
  relation: GapRelation;
  /** 仅小于或等于阈值时为 true。 */
  risk: boolean;
  /** 判定所用的隔离段收缩步数。 */
  steps: number;
  /** 判定时刻的精确界限（分式串），恒有 lower < d < upper。 */
  lower: string;
  upper: string;
  /** 十进制近似（仅展示用）。 */
  lowerDec: string;
  upperDec: string;
  /** 判定时刻两根的（已收缩）隔离段端点，可复算证据。 */
  leftL: string;
  leftR: string;
  rightL: string;
  rightR: string;
  /** relation 为 equal 时：p(x) 与 p(x + t) 的精确公因子。 */
  gcdFactor: string | null;
}

export interface AuditResultDTO {
  polynomial: string;
  a: string;
  b: string;
  /** 正有理安全间距阈值（精确分式）与十进制近似（仅展示）。 */
  threshold: string;
  thresholdDec: string;
  totalRoots: number;
  /** 间距小于或等于阈值的相邻对个数。 */
  riskCount: number;
  pairs: AuditPairDTO[];
}

/**
 * 间距风险审计入口：解析 → 精确隔离（冻结本次曲线与开区间）→
 * 对按数值相邻的不同实根对逐一判定间距与阈值的大小关系。
 * 所有错误以 IsoError 抛出，由调用方（Worker）转成消息。
 */
export const runGapAudit = (
  coeffRaw: string,
  aRaw: string,
  bRaw: string,
  thresholdRaw: string,
): AuditResultDTO => {
  const coeffsDesc = parseCoefficients(coeffRaw);
  const a = parseInteger(aRaw, '左端点');
  const b = parseInteger(bRaw, '右端点');
  const threshold = parsePositiveRational(thresholdRaw);
  const coeffsAsc = [...coeffsDesc].reverse();

  const res = isolateRoots(coeffsAsc, a, b);
  const p = P.fromBigInts(coeffsAsc);
  const pairs = auditGaps(res, p, threshold);

  return {
    polynomial: P.toString(p),
    a: a.toString(),
    b: b.toString(),
    threshold: R.toString(threshold),
    thresholdDec: R.toDecimal(threshold, 6),
    totalRoots: res.totalRoots,
    riskCount: pairs.filter((pr) => pr.risk).length,
    pairs: pairs.map((pr) => ({
      index: pr.index,
      relation: pr.relation,
      risk: pr.risk,
      steps: pr.steps,
      lower: R.toString(pr.lower),
      upper: R.toString(pr.upper),
      lowerDec: R.toDecimal(pr.lower, 6),
      upperDec: R.toDecimal(pr.upper, 6),
      leftL: R.toString(pr.left.l),
      leftR: R.toString(pr.left.r),
      rightL: R.toString(pr.right.l),
      rightR: R.toString(pr.right.r),
      gcdFactor: pr.gcdFactor ? P.toString(pr.gcdFactor) : null,
    })),
  };
};
