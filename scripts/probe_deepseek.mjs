#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';

// Tests a user-owned DeepSeek key without putting it in source, command arguments or logs.
// This is an upstream smoke test, not the public OneAPI gateway.
const keyFile = join(homedir(), '.local', 'share', 'oneapi', 'deepseek-test-key');
const baseUrl = 'https://api.deepseek.com';
const modelId = 'deepseek-flash';

async function readKey() {
  const stat = await lstat(keyFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error('测试 Key 文件必须是当前用户持有的普通文件，权限为 0600。');
  }
  const key = (await readFile(keyFile, 'utf8')).trim();
  if (!key || key.includes('\n') || key.includes('\r')) throw new Error('测试 Key 文件内容无效。');
  return key;
}

async function request(path, key, bodyObject = null) {
  const body = bodyObject ? JSON.stringify(bodyObject) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(baseUrl + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: 30000,
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        raw += chunk;
        if (raw.length > 1_000_000) response.destroy(new Error('响应超过安全大小限制。'));
      });
      response.on('end', () => {
        // Never log raw upstream response bodies; they may contain request details.
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${path} 返回 HTTP ${response.statusCode}。`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`${path} 返回的 JSON 无效。`)); }
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`${path} 请求超时。`)));
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

try {
  const key = await readKey();
  const listing = await request('/models', key);
  const ids = Array.isArray(listing.data) ? listing.data.map(item => item.id).filter(id => typeof id === 'string') : [];
  console.log('DeepSeek /models 可用型号：', ids.length ? ids.join(', ') : '响应中没有型号列表');
  if (!ids.includes(modelId)) throw new Error(`账户没有列出 ${modelId}；未执行付费调用。`);
  const result = await request('/chat/completions', key, {
    model: modelId,
    messages: [{ role: 'user', content: '只回复 OK' }],
    thinking: { type: 'disabled' },
    max_tokens: 16,
    stream: false,
  });
  const choice = result.choices?.[0];
  const output = choice?.message?.content;
  console.log('真实调用：', typeof output === 'string' && output.trim() ? '已返回内容' : '未返回正文');
  console.log('结束原因：', choice?.finish_reason ?? '未知');
  console.log('上游用量：', JSON.stringify({
    input_tokens: result.usage?.prompt_tokens ?? null,
    output_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
  }));
  if (typeof output !== 'string' || !output.trim()) process.exitCode = 2;
} catch (error) {
  const message = error?.code === 'ENOENT'
    ? '尚未保存测试 Key。请先在本机终端运行 scripts/save_deepseek_test_key.sh。'
    : error instanceof Error ? error.message : '未知错误';
  console.error('DeepSeek 探测失败：', message);
  process.exitCode = 1;
}
