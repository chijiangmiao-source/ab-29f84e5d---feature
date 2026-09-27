/**
 * 有理数域上的单变量多项式，系数为精确有理数（BigInt）。
 * c[i] 表示 x^i 的系数；规范化后不含高位零系数，零多项式为 []。
 */
import * as R from './rational';

export interface Poly {
  c: R.Rat[];
}

/** 去掉高位零系数，得到规范化多项式。 */
export const poly = (c: R.Rat[]): Poly => {
  const arr = [...c];
  while (arr.length > 0 && R.isZero(arr[arr.length - 1])) arr.pop();
  return { c: arr };
};

export const ZERO: Poly = { c: [] };

/** 由整数系数构造，cs[i] 为 x^i 的系数。 */
export const fromBigInts = (cs: bigint[]): Poly =>
  poly(cs.map((x) => R.fromBigInt(x)));

export const isZero = (p: Poly): boolean => p.c.length === 0;

/** 零多项式次数约定为 -1。 */
export const degree = (p: Poly): number => p.c.length - 1;

export const leadingCoeff = (p: Poly): R.Rat =>
  isZero(p) ? R.ZERO : p.c[p.c.length - 1];

export const neg = (p: Poly): Poly => ({ c: p.c.map(R.neg) });

export const add = (a: Poly, b: Poly): Poly => {
  const len = Math.max(a.c.length, b.c.length);
  const out: R.Rat[] = [];
  for (let i = 0; i < len; i++) {
    const ca = i < a.c.length ? a.c[i] : R.ZERO;
    const cb = i < b.c.length ? b.c[i] : R.ZERO;
    out.push(R.add(ca, cb));
  }
  return poly(out);
};

export const sub = (a: Poly, b: Poly): Poly => {
  const len = Math.max(a.c.length, b.c.length);
  const out: R.Rat[] = [];
  for (let i = 0; i < len; i++) {
    const ca = i < a.c.length ? a.c[i] : R.ZERO;
    const cb = i < b.c.length ? b.c[i] : R.ZERO;
    out.push(R.sub(ca, cb));
  }
  return poly(out);
};

export const mul = (a: Poly, b: Poly): Poly => {
  if (isZero(a) || isZero(b)) return ZERO;
  const out: R.Rat[] = new Array<R.Rat>(a.c.length + b.c.length - 1).fill(
    R.ZERO,
  );
  for (let i = 0; i < a.c.length; i++) {
    if (R.isZero(a.c[i])) continue;
    for (let j = 0; j < b.c.length; j++) {
      out[i + j] = R.add(out[i + j], R.mul(a.c[i], b.c[j]));
    }
  }
  return poly(out);
};

export const derivative = (p: Poly): Poly => {
  const out: R.Rat[] = [];
  for (let i = 1; i < p.c.length; i++) {
    out.push(R.mul(p.c[i], R.fromBigInt(BigInt(i))));
  }
  return poly(out);
};

/** 在有理点 x 处精确求值（Horner 法）。 */
export const evalRat = (p: Poly, x: R.Rat): R.Rat => {
  let acc = R.ZERO;
  for (let i = p.c.length - 1; i >= 0; i--) {
    acc = R.add(R.mul(acc, x), p.c[i]);
  }
  return acc;
};

export const signAt = (p: Poly, x: R.Rat): -1 | 0 | 1 =>
  R.sign(evalRat(p, x));

/** 有理数域上的多项式带余除法：返回 a mod b。 */
export const remainder = (a: Poly, b: Poly): Poly => {
  if (isZero(b)) throw new Error('多项式除法的除式为零多项式');
  let r = a;
  const db = degree(b);
  const lb = leadingCoeff(b);
  let guard = 0;
  while (!isZero(r) && degree(r) >= db) {
    if (++guard > 256) throw new Error('多项式除法超出迭代上限');
    const k = degree(r) - db;
    const factor = R.div(leadingCoeff(r), lb);
    // r ← r − factor · x^k · b
    const t: R.Rat[] = new Array<R.Rat>(k).fill(R.ZERO);
    for (let i = 0; i < b.c.length; i++) t.push(R.mul(b.c[i], factor));
    r = sub(r, { c: t });
  }
  return r;
};

/** 首一化：各系数同除以首项系数（零多项式原样返回）。 */
export const monic = (p: Poly): Poly => {
  if (isZero(p)) return p;
  const lc = leadingCoeff(p);
  return { c: p.c.map((c) => R.div(c, lc)) };
};

/**
 * 有理数域上的多项式最大公因子（欧几里得算法，结果首一化）。
 * 全部系数运算为 BigInt 有理数精确运算。
 */
export const gcd = (a: Poly, b: Poly): Poly => {
  let x = a;
  let y = b;
  let guard = 0;
  while (!isZero(y)) {
    if (++guard > 128) throw new Error('多项式最大公因子超出迭代上限');
    const r = remainder(x, y);
    x = y;
    y = r;
  }
  return monic(x);
};

/**
 * 有理平移：返回 p(x + t)，t 为精确有理数。
 * 以 Horner 法在多项式环内对 (x + t) 展开，不引入任何近似。
 */
export const shift = (p: Poly, t: R.Rat): Poly => {
  const linear: Poly = { c: [t, R.ONE] }; // x + t
  let acc: Poly = ZERO;
  for (let i = p.c.length - 1; i >= 0; i--) {
    acc = add(mul(acc, linear), { c: [p.c[i]] });
  }
  return acc;
};

const termBody = (coefAbs: R.Rat, i: number, varName: string): string => {
  const coefStr = R.toString(coefAbs);
  if (i === 0) return coefStr;
  const x = i === 1 ? varName : `${varName}^${i}`;
  const isOne = coefAbs.n === 1n && coefAbs.d === 1n;
  return isOne ? x : `${coefStr}·${x}`;
};

/** 降幂排版，如 "x^2 − 3·x + 2"。 */
export const toString = (p: Poly, varName = 'x'): string => {
  if (isZero(p)) return '0';
  let out = '';
  for (let i = degree(p); i >= 0; i--) {
    const c = p.c[i];
    if (R.isZero(c)) continue;
    const negative = c.n < 0n;
    const body = termBody(R.abs(c), i, varName);
    if (out === '') {
      out = negative ? `− ${body}` : body;
    } else {
      out += negative ? ` − ${body}` : ` + ${body}`;
    }
  }
  return out === '' ? '0' : out;
};
