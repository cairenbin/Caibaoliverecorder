import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const action = process.argv[2] ?? '--open';
if (!['--open', '--no-browser', '--status', '--stop'].includes(action) || process.argv.length > 3) {
  console.error('用法：caibo-recorder [--no-browser | --status | --stop]');
  process.exit(2);
}

const data = path.resolve(process.env.EDITOR_DATA);
const descriptor = path.join(data, 'desktop-service.json');
async function activeService() {
  try {
    const service = JSON.parse(await readFile(descriptor, 'utf8'));
    if (service.protocol !== 1 || service.dataPath !== await realpath(data) ||
        !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(service.origin) ||
        !/^[a-f0-9]{64}$/.test(service.token) || !/^[a-f0-9]{64}$/.test(service.uiToken)) return null;
    const response = await fetch(service.origin + '/internal/desktop', {
      headers: { 'x-caibo-instance': service.token },
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok && (await response.json()).instance === service.instance) return service;
  } catch {
    // A descriptor can be absent or stale while the backend starts or stops.
  }
  return null;
}

async function run() {
  let service = await activeService();
  if (action === '--status' || action === '--stop') {
    if (!service) {
      console.error('录播机后台未运行。');
      return action === '--status' ? 1 : 0;
    }
    if (action === '--status') {
      console.log(service.origin);
      return 0;
    }
    const response = await fetch(service.origin + '/internal/desktop', {
      method: 'POST',
      headers: { 'x-caibo-instance': service.token, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'quit', confirmed: true }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !(await response.json()).quitAccepted) throw new Error('后台退出请求失败。');
    console.log('已请求后台安全退出。');
    return 0;
  }

  let exited;
  if (!service) {
    await mkdir(data, { recursive: true, mode: 0o700 });
    const entry = fileURLToPath(new URL('./live-editor/server/index.js', import.meta.url));
    const child = spawn(process.execPath, [entry], { cwd: data, stdio: 'inherit' });
    let finished = false;
    exited = new Promise(resolve => {
      child.once('error', error => { console.error(error.message); finished = true; resolve(1); });
      child.once('exit', code => { finished = true; resolve(code ?? 1); });
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(signal, () => { if (!finished) child.kill('SIGTERM'); });
    }
    for (let attempt = 0; attempt < 240 && !service; attempt++) {
      service = await activeService();
      if (!service) await delay(250);
      if (finished && attempt > 8 && !service) return await exited || 1;
    }
    if (!service) {
      child.kill('SIGTERM');
      console.error('等待录播机后台启动超时。');
      await exited;
      return 1;
    }
  }

  console.log(`工作台：${service.origin}\n浏览器登录用户名：caibao\n密码：${service.uiToken}`);
  if (action === '--open') {
    const browser = spawn('xdg-open', [service.origin], { detached: true, stdio: 'ignore' });
    browser.on('error', () => console.error('请在浏览器中手动打开上述地址。'));
    browser.unref();
  }
  // Keep AppRun alive until the backend exits so mounted files remain available.
  return exited ? await exited : 0;
}

try { process.exitCode = await run(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
