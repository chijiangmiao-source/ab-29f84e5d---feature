/**
 * 基于 BigInt 的精确有理数运算。
 * 不变式：d > 0，gcd(|n|, d) = 1；零统一表示为 0/1。
 * 全部运算均为精确运算，不引入任何浮点近似。
 */
export interface Rat {
  n: bigint;
  d: bigint;
}

const absBig = (x: bigint): bigint => (x < 0n ? -x : x);

export const gcdBig = (a: bigint, b: bigint): bigint => {
  a = absBig(a);
  b = absBig(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
};

/** 构造并规范化一个有理数。分母为零时抛错。 */
export const rat = (n: bigint, d: bigint = 1n): Rat => {
  if (d === 0n) throw new Error('有理数分母不能为零');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { n: 0n, d: 1n };
  const g = gcdBig(n, d);
  return { n: n / g, d: d / g };
};

export const ZERO: Rat = { n: 0n, d: 1n };
export const ONE: Rat = { n: 1n, d: 1n };

export const fromBigInt = (x: bigint): Rat => ({ n: x, d: 1n });

export const add = (a: Rat, b: Rat): Rat =>
  rat(a.n * b.d + b.n * a.d, a.d * b.d);

export const sub = (a: Rat, b: Rat): Rat =>
  rat(a.n * b.d - b.n * a.d, a.d * b.d);

export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);

export const div = (a: Rat, b: Rat): Rat => {
  if (b.n === 0n) throw new Error('有理数除法除以零');
  return rat(a.n * b.d, a.d * b.n);
};

export const neg = (a: Rat): Rat => ({ n: -a.n, d: a.d });

export const abs = (a: Rat): Rat => ({ n: absBig(a.n), d: a.d });

export const isZero = (a: Rat): boolean => a.n === 0n;

export const sign = (a: Rat): -1 | 0 | 1 =>
  a.n > 0n ? 1 : a.n < 0n ? -1 : 0;

/** a < b 返回 -1，a == b 返回 0，a > b 返回 1。 */
export const cmp = (a: Rat, b: Rat): -1 | 0 | 1 => {
  const lhs = a.n * b.d;
  const rhs = b.n * a.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
};

export const eq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;

/** 精确分式形式，如 "-3/2"、"5"。 */
export const toString = (a: Rat): string =>
  a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;

/**
 * 十进制近似（截断到 digits 位），仅用于界面展示，
 * 不参与任何判定；所有判定都基于精确有理数。
 */
export const toDecimal = (a: Rat, digits = 6): string => {
  const negative = a.n < 0n;
  let rem = absBig(a.n);
  const intPart = rem / a.d;
  rem %= a.d;
  let frac = '';
  for (let i = 0; i < digits; i++) {
    rem *= 10n;
    frac += (rem / a.d).toString();
    rem %= a.d;
  }
  const body = digits > 0 ? `${intPart}.${frac}` : intPart.toString();
  return (negative ? '-' : '') + body;
};
