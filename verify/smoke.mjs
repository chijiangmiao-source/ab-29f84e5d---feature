/**
 * HTTP 冒烟测试：确认 app 服务的健康检查端点与首页可用。
 * 失败时进程以非零码退出。
 */
const base = (process.env.APP_URL || 'http://app:80').replace(/\/$/, '');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(path, attempts = 20) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(base + path);
      const body = await res.text();
      return { status: res.status, body };
    } catch (err) {
      lastErr = err;
      await wait(1500);
    }
  }
  throw lastErr ?? new Error(`无法连接 ${base}${path}`);
}

async function main() {
  // 1. 健康检查端点
  const health = await fetchWithRetry('/healthz');
  if (health.status !== 200) {
    throw new Error(`/healthz 返回 ${health.status}，期望 200`);
  }
  console.log(`OK  GET /healthz -> ${health.status} (${health.body.trim()})`);

  // 2. 首页可达且包含挂载点
  const home = await fetchWithRetry('/');
  if (home.status !== 200) {
    throw new Error(`/ 返回 ${home.status}，期望 200`);
  }
  if (!home.body.includes('id="root"')) {
    throw new Error('首页缺少 React 挂载点 <div id="root">');
  }
  console.log(`OK  GET / -> ${home.status}，包含 #root 挂载点`);

  // 3. 首页引用的 JS 资源可加载（构建产物确实被托管）
  const assetMatch = home.body.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!assetMatch) {
    throw new Error('首页未引用构建后的 JS 资源');
  }
  const asset = await fetchWithRetry(assetMatch[1]);
  if (asset.status !== 200) {
    throw new Error(`${assetMatch[1]} 返回 ${asset.status}，期望 200`);
  }
  console.log(`OK  GET ${assetMatch[1]} -> ${asset.status}`);

  console.log('SMOKE PASSED');
}

main().catch((err) => {
  console.error(`SMOKE FAILED: ${err.message}`);
  process.exit(1);
});
