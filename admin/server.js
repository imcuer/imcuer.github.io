/**
 * Hugo 站点后台管理（零依赖，Node.js 内置模块实现）
 * 启动：node admin/server.js   然后浏览器打开 http://127.0.0.1:3210
 * 仅监听本机回环地址，不对外暴露。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');          // 站点根目录
const CONTENT = path.join(ROOT, 'content');
const PORT = 3210;

// 服务器默认值（密码不落盘，发布时由前端传入；前端可覆盖以下全部字段）
const DEFAULT_SERVER = { host: '156.233.225.26', port: 58865, user: 'root', webRoot: '/var/www/hugo' };

/* ---------------- SSE 日志广播 ---------------- */
const sseClients = [];
function broadcast(source, line) {
    const msg = `data: ${JSON.stringify({ source, line, time: Date.now() })}\n\n`;
    sseClients.forEach(res => { try { res.write(msg); } catch (e) { /* 忽略断开的连接 */ } });
}

/* ---------------- Front Matter 解析（YAML，仅处理本站用到的字段） ---------------- */
const KNOWN_KEYS = ['title', 'description', 'date', 'slug', 'draft', 'image'];

function parseFrontMatter(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { fm: {}, extra: [], body: raw };
    const lines = m[1].split(/\r?\n/);
    const fm = {};
    const extra = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv && (kv[1] === 'categories' || kv[1] === 'tags')) {
            const list = [];
            while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
                i++;
                list.push(lines[i].replace(/^\s+-\s+/, '').replace(/^"|"$/g, '').trim());
            }
            fm[kv[1]] = list;
        } else if (kv && KNOWN_KEYS.includes(kv[1])) {
            let v = kv[2].replace(/^"|"$/g, '').trim();
            fm[kv[1]] = kv[1] === 'draft' ? v === 'true' : v;
        } else if (line.trim() !== '') {
            extra.push(line);   // 不认识的行原样保留
        }
    }
    return { fm, extra, body: raw.slice(m[0].length) };
}

function buildFrontMatter(fm, extra) {
    const q = s => `"${String(s).replace(/"/g, '\\"')}"`;
    const out = ['---'];
    if (fm.title) out.push(`title: ${q(fm.title)}`);
    if (fm.description) out.push(`description: ${q(fm.description)}`);
    if (fm.date) out.push(`date: ${fm.date}`);
    if (fm.slug) out.push(`slug: ${q(fm.slug)}`);
    if (fm.draft !== undefined) out.push(`draft: ${!!fm.draft}`);
    if (fm.image) out.push(`image: ${q(fm.image)}`);
    ['categories', 'tags'].forEach(k => {
        if (Array.isArray(fm[k]) && fm[k].length) {
            out.push(`${k}:`);
            fm[k].forEach(item => out.push(`    - ${q(item)}`));
        }
    });
    (extra || []).forEach(l => { if (String(l).trim()) out.push(l); });
    out.push('---', '');
    return out.join('\n');
}

/* ---------------- 内容扫描 ---------------- */
function scanType(type) {
    const dir = path.join(CONTENT, type);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            const md = path.join(dir, d.name, 'index.md');
            if (!fs.existsSync(md)) return null;
            const { fm } = parseFrontMatter(fs.readFileSync(md, 'utf8'));
            return {
                type,
                slug: d.name,
                rel: path.relative(ROOT, md),
                title: fm.title || d.name,
                date: fm.date || '',
                draft: !!fm.draft
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ---------------- 路径安全：必须落在 content/ 内 ---------------- */
function safeContentPath(rel) {
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(CONTENT + path.sep)) throw new Error('非法路径');
    return abs;
}

/* ---------------- 子进程执行并实时广播输出 ---------------- */
function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        broadcast(opts.tag || 'cmd', `$ ${cmd} ${args.join(' ')}`);
        const child = spawn(cmd, args, {
            cwd: ROOT,
            shell: opts.shell !== false,   // ssh/scp 等用 shell:false，参数原样传递
            env: { ...process.env, ...(opts.env || {}) }
        });
        const onData = tag => data => String(data).split(/\r?\n/).filter(Boolean).forEach(l => broadcast(tag, l));
        child.stdout.on('data', onData(opts.tag || 'cmd'));
        child.stderr.on('data', onData(opts.tag || 'cmd'));
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
    });
}

/* ---------------- hugo server 预览进程管理 ---------------- */
let previewProc = null;
function startPreview() {
    if (previewProc) return { status: 'already-running' };
    previewProc = spawn('hugo', ['server', '--buildDrafts'], { cwd: ROOT, shell: true });
    const onData = data => String(data).split(/\r?\n/).filter(Boolean).forEach(l => broadcast('preview', l));
    previewProc.stdout.on('data', onData);
    previewProc.stderr.on('data', onData);
    previewProc.on('close', () => { previewProc = null; broadcast('preview', '[预览已停止]'); });
    broadcast('preview', '[预览启动中] http://localhost:1313');
    return { status: 'started' };
}
function stopPreview() {
    if (!previewProc) return { status: 'not-running' };
    // Windows 下 shell:true 产生的进程树需要用 taskkill 清理
    spawn('taskkill', ['/pid', String(previewProc.pid), '/f', '/t'], { shell: true });
    previewProc = null;
    return { status: 'stopped' };
}

/* ---------------- 发布流程 ---------------- */
let publishing = false;
async function publish({ targetServer, targetGithub, password, commitMsg, server }) {
    if (publishing) throw new Error('已有发布任务进行中');
    publishing = true;
    const srv = { ...DEFAULT_SERVER, ...(server || {}) };
    try {
        broadcast('publish', '==== 开始发布 ====');
        await run('hugo', ['--gc', '--minify'], { tag: 'publish' });
        broadcast('publish', '[1/3] 构建完成');

        if (targetServer) {
            const useKey = srv.authType !== 'password';
            if (!useKey && !password) throw new Error('密码认证方式需要填写 SSH 密码');
            broadcast('publish', `目标服务器: ${srv.user}@${srv.host}:${srv.port} → ${srv.webRoot}（认证: ${useKey ? 'SSH 密钥' : '密码'}）`);
            const pkg = path.join(os.tmpdir(), 'site.tar.gz');
            await run('tar', ['-czf', pkg, '-C', 'public', '.'], { tag: 'publish' });
            const remoteCmd = `rm -rf ${srv.webRoot}/* && tar -xzf /tmp/site.tar.gz -C ${srv.webRoot} && chown -R www-data:www-data ${srv.webRoot}`;

            if (useKey) {
                // 系统 OpenSSH 客户端：优先用指定的密钥文件，否则自动使用 ~/.ssh/ 下的默认密钥
                const keyArgs = srv.keyFile ? ['-i', srv.keyFile] : [];
                await run('scp', [...keyArgs, '-P', String(srv.port), '-o', 'BatchMode=yes', pkg, `${srv.user}@${srv.host}:/tmp/site.tar.gz`], { tag: 'publish', shell: false });
                await run('ssh', [...keyArgs, '-p', String(srv.port), '-o', 'BatchMode=yes', `${srv.user}@${srv.host}`, remoteCmd], { tag: 'publish', shell: false });
            } else {
                // 密码方式：走 Posh-SSH
                const ps1 = path.join(os.tmpdir(), 'hugo-deploy.ps1');
                fs.writeFileSync(ps1, [
                    `$pw = ConvertTo-SecureString $env:DEPLOY_PW -AsPlainText -Force`,
                    `$cred = New-Object System.Management.Automation.PSCredential('${srv.user}', $pw)`,
                    `Set-SCPItem -ComputerName '${srv.host}' -Port ${srv.port} -Credential $cred -AcceptKey -Path '${pkg.replace(/\\/g, '\\\\')}' -Destination '/tmp/' -Force`,
                    `$s = New-SSHSession -ComputerName '${srv.host}' -Port ${srv.port} -Credential $cred -AcceptKey`,
                    `Invoke-SSHCommand -Index $s.SessionId -Command '${remoteCmd}' | Select-Object -ExpandProperty Output`,
                    `Remove-SSHSession -Index $s.SessionId`,
                    `Write-Output '服务器部署完成'`
                ].join('\r\n'));
                await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
                    tag: 'publish',
                    env: { DEPLOY_PW: password }
                });
                try { fs.unlinkSync(ps1); } catch (e) {}
            }
            broadcast('publish', '[2/3] 服务器发布完成');
        }

        if (targetGithub) {
            await run('git', ['add', '-A'], { tag: 'publish' });
            const msg = (commitMsg || '更新站点（后台管理）').replace(/["`$]/g, '');
            try {
                await run('git', ['commit', '-m', msg], { tag: 'publish' });
            } catch (e) {
                broadcast('publish', '无变更可提交，跳过 commit');
            }
            await run('git', ['push'], { tag: 'publish' });
            broadcast('publish', '[3/3] 已推送 GitHub，Actions 自动部署中 → https://imcuer.github.io/');
        }

        broadcast('publish', '==== 发布成功 ====');
        return { ok: true };
    } catch (e) {
        broadcast('publish', `==== 发布失败: ${e.message} ====`);
        throw e;
    } finally {
        publishing = false;
    }
}

/* ---------------- HTTP 服务 ---------------- */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > 10 * 1024 * 1024) req.destroy(); });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const json = (obj, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
    };
    try {
        // 静态页面
        if (url.pathname === '/' || url.pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
            return;
        }
        // SSE 日志流
        if (url.pathname === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write('data: {"source":"sys","line":"日志通道已连接"}\n\n');
            sseClients.push(res);
            req.on('close', () => sseClients.splice(sseClients.indexOf(res), 1));
            return;
        }
        // 内容列表
        if (url.pathname === '/api/list' && req.method === 'GET') {
            json({ posts: scanType('post'), pages: scanType('page') });
            return;
        }
        // 读取单个文件
        if (url.pathname === '/api/file' && req.method === 'GET') {
            const abs = safeContentPath(url.searchParams.get('path'));
            const { fm, extra, body } = parseFrontMatter(fs.readFileSync(abs, 'utf8'));
            json({ fm, extra: extra.join('\n'), body });
            return;
        }
        // 保存
        if (url.pathname === '/api/save' && req.method === 'POST') {
            const { path: rel, fm, extra, body } = await readBody(req);
            const abs = safeContentPath(rel);
            fs.writeFileSync(abs, buildFrontMatter(fm, extra ? extra.split('\n') : []) + body.replace(/^\r?\n+/, ''));
            broadcast('sys', `已保存 ${rel}`);
            json({ ok: true });
            return;
        }
        // 新建
        if (url.pathname === '/api/new' && req.method === 'POST') {
            const { type, slug, title } = await readBody(req);
            if (!['post', 'page'].includes(type)) throw new Error('type 只能是 post 或 page');
            if (!/^[\w-]+$/.test(slug)) throw new Error('slug 只能包含字母、数字、下划线、连字符');
            const dir = path.join(CONTENT, type, slug);
            if (fs.existsSync(dir)) throw new Error('同名目录已存在');
            fs.mkdirSync(dir, { recursive: true });
            const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00').slice(0, 19) + '+08:00';
            const fm = { title: title || slug, date: now, slug, draft: true };
            fs.writeFileSync(path.join(dir, 'index.md'), buildFrontMatter(fm, []) + '\n在这里开始写作……\n');
            broadcast('sys', `已新建 ${type}/${slug}`);
            json({ ok: true, rel: path.relative(ROOT, path.join(dir, 'index.md')) });
            return;
        }
        // 删除
        if (url.pathname === '/api/delete' && req.method === 'POST') {
            const { path: rel } = await readBody(req);
            const abs = safeContentPath(rel);
            const dir = path.dirname(abs);
            if (!dir.startsWith(CONTENT + path.sep) || dir === CONTENT) throw new Error('非法路径');
            fs.rmSync(dir, { recursive: true, force: true });
            broadcast('sys', `已删除 ${path.relative(ROOT, dir)}`);
            json({ ok: true });
            return;
        }
        // hugo 命令行接口（如 "version" / "new post/x/index.md" / "--gc --minify"）
        if (url.pathname === '/api/hugo' && req.method === 'POST') {
            const { args } = await readBody(req);
            if (!args || /[;&|<>$`]/.test(args)) throw new Error('参数含非法字符');
            run('hugo', args.split(/\s+/), { tag: 'hugo' }).catch(e => broadcast('hugo', `错误: ${e.message}`));
            json({ ok: true });
            return;
        }
        // 预览控制
        if (url.pathname === '/api/preview' && req.method === 'POST') {
            const { action } = await readBody(req);
            json(action === 'stop' ? stopPreview() : startPreview());
            return;
        }
        // 一键发布
        if (url.pathname === '/api/publish' && req.method === 'POST') {
            const body = await readBody(req);
            publish(body).then(() => {}).catch(() => {});
            json({ ok: true, started: true });
            return;
        }
        json({ error: 'Not Found' }, 404);
    } catch (e) {
        json({ error: e.message }, 400);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Hugo 后台管理已启动: http://127.0.0.1:${PORT}`);
});
