# 精确实根隔离（Sturm 链 · BigInt 有理数）

面向同步辐射站增益曲线零点校准场景的 Web 工具：在指定开区间内，对整数系数
多项式（次数 1–12）做**精确**的不同实根计数与隔离，避免浮点近似把相邻的
危险阈值合并或遗漏。

## 功能

- 输入：降幂整数系数（逗号/空格分隔，2–13 个，即次数 1–12）与两个整数区间端点 `a < b`。
- 输出：
  - 开区间 `(a, b)` 内的**不同实根数**（重根只计一次）；
  - 按数值升序、两两互不相交（端点严格分离）的**有理隔离区间**；
  - 每段区间恰含一个根的 **Sturm 变号数证据**（`V(l) − V(r) = 1` 及符号序列）。
- 计算全部在浏览器 **Web Worker** 中进行：以 **BigInt 有理数**构造 Sturm 链，
  通过精确符号判定与二分完成隔离，主线程不阻塞。
- 明确的错误反馈：端点为根、首项为零、系数格式错误、次数越界、区间次序错误、
  计算中取消；任何情况下旧结论都会被清除。
- 编辑任一输入、重新提交或取消后，过期 Worker 消息（`requestId` 校验 +
  Worker 终止）不会覆盖当前草稿，页面只呈现与当前输入对应的结果。

## 数学方法

Sturm 定理：对 `p0 = p, p1 = p′, p_{i+1} = −rem(p_{i−1}, p_i)` 构成的 Sturm 链，
记 `V(x)` 为链在有理点 `x` 处符号序列（忽略 0）的变号数，则开区间 `(a, b)`
内不同实根数为 `V(a) − V(b)`（要求端点非根，提交时会精确校验并拒绝）。
二分过程中以 `V` 值差递归拆分区间，直至每段恰含一个根；随后对相邻端点
相接的区间继续收缩，保证输出区间两两严格分离。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # 单元测试（vitest）
npm run build      # 类型检查 + 生产构建
```

## Docker 部署

```bash
# 构建并启动应用（默认端口 8080，可用 APP_PORT 覆盖）
APP_PORT=9090 docker compose up --build app

# 健康检查
curl http://localhost:9090/healthz   # -> ok
```

容器内 nginx 监听 80 端口，`docker-compose.yml` 将宿主机端口
`${APP_PORT:-8080}` 映射到容器 80 端口；Dockerfile 与 Compose 均配置了
针对 `/healthz` 的健康检查。

## 验证服务（verify）

`verify` 服务依次执行并以退出码报告结果（0 通过，非 0 失败）：

1. **单元测试**：两个实根、无实根、端点根拒绝，以及首项为零、格式错误、
   重根、近距根不合并、Worker 消息路径等场景；
2. **构建检查**：`tsc --noEmit` 类型检查 + `vite build` 生产构建；
3. **HTTP 冒烟**：对 `app` 服务检查 `/healthz`、首页与构建产物资源。

```bash
docker compose up --build --exit-code-from verify
echo $?   # 0 表示全部通过
```

## 项目结构

```
src/
  lib/
    rational.ts   # BigInt 有理数精确运算
    poly.ts       # 有理数域多项式：求值、导数、带余除法
    sturm.ts      # Sturm 链、变号数、二分隔离（核心算法）
    api.ts        # 输入解析 + 结果序列化（Worker 与测试共用）
  worker/
    sturmWorker.ts  # Web Worker 消息处理
  components/ResultView.tsx
  App.tsx           # 表单、Worker 生命周期、过期消息防护
tests/              # vitest 单元测试与 Worker 集成测试
verify/             # verify 服务脚本（测试 + 构建 + 冒烟）
Dockerfile          # 应用镜像（构建 + nginx 托管 + 健康检查）
Dockerfile.verify   # 验证服务镜像
docker-compose.yml  # app + verify 编排，端口可配置
```
