/** 错误码 → 界面标签，App 与 AuditPanel 共用。 */
export const ERROR_CODE_LABEL: Record<string, string> = {
  DEGREE_RANGE: '次数越界',
  LEADING_ZERO: '首项为零',
  BAD_INTERVAL: '区间端点错误',
  ENDPOINT_ROOT: '端点为根',
  BAD_FORMAT: '系数格式错误',
  BAD_THRESHOLD: '阈值格式错误',
  INSUFFICIENT_ROOTS: '可比较根不足',
  INTERNAL: '内部错误',
};
