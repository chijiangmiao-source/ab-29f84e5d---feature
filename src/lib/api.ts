/**
 * 输入解析、隔离入口与可序列化结果（DTO）组装。
 * 该模块被 Web Worker 与单元测试共同使用，保证页面计算路径可测试。
 */
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
