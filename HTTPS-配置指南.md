# HTTP → HTTPS 配置与排错指南

本文记录 `www.imcuer.com` 从「裸 HTTP」升级到「受浏览器信任的 HTTPS」的完整过程，
以及过程中踩过的坑和排查方法。**以后给别的站点做同样的升级，照着这篇做即可。**

最终状态：

| 项目 | 值 |
|------|-----|
| 站点地址 | `https://www.imcuer.com/` |
| 证书签发机构 | Let's Encrypt（免费） |
| 服务器 | `156.233.225.26`（Ubuntu 22.04，nginx） |
| SSH 端口 | `58865` |
| 证书目录 | `/etc/letsencrypt/live/www.imcuer.com/` |
| Web 根目录 | `/var/www/hugo` |
| nginx 配置 | `/etc/nginx/sites-available/hugo` |

---

## 一、前置条件

升级 HTTPS 之前，必须先满足这三条，否则后面一定会卡住：

1. **有一个域名**，并且已解析到服务器
   ```
   类型 A    主机记录 @    记录值 服务器IP     ← 让 imcuer.com 可访问
   类型 A    主机记录 www  记录值 服务器IP     ← 让 www.imcuer.com 可访问
   ```
   验证：`nslookup www.imcuer.com 8.8.8.8` 应返回你的服务器 IP。

2. **服务器上已装 Web 服务器（nginx）**，且站点能用 `http://域名` 打开
   ```bash
   apt update && apt install -y nginx
   nginx -v
   ```

3. **80 端口对外可访问**
   > 关键：Let's Encrypt 的签发校验（HTTP-01）会从公网访问你服务器的 **80 端口**去取一个验证文件。
   > 如果 80 端口被防火墙/安全组挡住，签发必然失败。
   ```bash
   # 云服务商的安全组也要放行 80 和 443
   ufw allow 80,443/tcp      # 如果启用了 ufw
   ```

---

## 二、签发证书（certbot）

```bash
apt update
apt install -y certbot python3-certbot-nginx

# 一条命令：自动申请证书 + 自动改 nginx 配置 + 自动配 80 跳转到 443
certbot --nginx -d www.imcuer.com --redirect
```

过程中会问你邮箱（用于到期提醒）和是否同意条款，按提示输入即可。

**结果**：

```
/etc/letsencrypt/live/www.imcuer.com/
├── cert.pem        # 站点证书（只有叶子证书）
├── chain.pem        # 中间证书
├── fullchain.pem    # 叶子 + 中间（nginx 要用这个！）
└── privkey.pem      # 私钥
```

> **nginx 必须用 `fullchain.pem`，不要用 `cert.pem`** —— 用后者会缺中间证书，
> 部分客户端（尤其旧安卓、Java、部分浏览器）会报"证书链不完整"。

**一次覆盖多个域名**（比如同时要 `www` 和裸域名）：

```bash
certbot --nginx -d www.imcuer.com -d imcuer.com --redirect
# 已有证书想追加域名：
certbot --nginx -d www.imcuer.com -d imcuer.com --expand --redirect
```

---

## 三、nginx 配置

certbot 会自动帮你改配置，改完大致长这样（`/etc/nginx/sites-available/hugo`）：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name www.imcuer.com;

    # certbot 加的：所有 HTTP 请求 301 跳到 HTTPS
    if ($host = www.imcuer.com) {
        return 301 https://$host$request_uri;
    }

    location /.well-known/acme-challenge/ { root /var/www/html; }   # 续期校验用
    location / { return 404; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.imcuer.com;

    ssl_certificate     /etc/letsencrypt/live/www.imcuer.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.imcuer.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    root  /var/www/hugo;
    index index.html;

    location / { try_files $uri $uri/ =404; }
}
```

再手动加了几条加固（可选，但建议）：

```nginx
ssl_protocols TLSv1.2 TLSv1.3;              # 只留 TLS 1.2/1.3
ssl_ciphers HIGH:!aNULL:!MD5;               # 禁用弱加密套件
ssl_prefer_server_ciphers off;
```

启用配置并重载：

```bash
ln -sf /etc/nginx/sites-available/hugo /etc/nginx/sites-enabled/hugo
nginx -t && systemctl reload nginx     # -t 必须先跑，检查语法
systemctl enable nginx                 # 开机自启
```

---

## 四、站点配置也要改（容易漏）

HTTPS 生效后，**站点自己的配置也得跟着改**，否则页面能打开但链接全指错：

- 静态站点（如 Hugo）的 `baseURL` 从 `http://...` 改成 `https://www.imcuer.com/`
  否则 canonical、RSS、sitemap 里全是 `http://` 或旧域名。
- 重新构建并部署后，**强刷**浏览器（`Ctrl+F5`）验证。

```powershell
cd D:\Workbench\web\new-site
hugo --gc --minify
```

---

## 五、验证（四层校验，缺一不可）

| 检查 | 命令 | 期望结果 |
|------|------|----------|
| ① 证书链完整 | `echo \| openssl s_client -connect 127.0.0.1:443 -servername www.imcuer.com 2>/dev/null \| grep -E "s:\|i:\|Verify return code"` | 打印**三层**（叶子→中间→根），`Verify return code: 0 (ok)` |
| ② HTTP 自动跳转 | `curl -I http://www.imcuer.com/` | `301` + `Location: https://...` |
| ③ 证书有效期 | `certbot certificates` | 有效期 ~90 天，域名正确 |
| ④ 外部独立评级 | 浏览器打开 [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=www.imcuer.com) | 评级 **A** 或 A+，Chain Issues 为空 |

补充几个本机就能跑的：

```powershell
# 校验证书是否被本机信任（不加 -k，校验失败 curl 会报错）
curl.exe -s -o NUL -w "status=%{http_code} ssl_verify=%{ssl_verify_result}\n" https://www.imcuer.com/

# 看证书里到底签了哪些域名（SAN）
openssl s_client -connect www.imcuer.com:443 -servername www.imcuer.com </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
```

---

## 六、自动续期

Let's Encrypt 证书**只有 90 天**，必须确认自动续期已生效：

```bash
systemctl list-timers | grep certbot      # 应能看到 certbot.timer 的下次执行时间
certbot renew --dry-run                   # 干跑一次，确认续期流程通畅
```

certbot 安装时已自带 `certbot.timer`，一般无需额外配置。**续期成功后 nginx 需要重载才会读新证书**，
certbot 的 nginx 插件会自动处理；若是 standalone 方式则需手动 `systemctl reload nginx`。

---

## 七、踩坑记录与排错

### 坑 1：没有域名怎么办 → 只能用自签名证书

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/ssl/private/self.key -out /etc/ssl/certs/self.crt \
  -subj "/CN=156.233.225.26" \
  -addext "subjectAltName=IP:156.233.225.26"
```

**关键结论**：Let's Encrypt **不给纯 IP 签证书**（必须有域名）。用 IP 访问 `https://156.233.225.26/`
永远会提示"证书不受信任"，只能靠域名。自签名证书的浏览器红线**无法消除**，属于正常现象。

### 坑 2：`www.imcuer.com` 和 `imcuer.com` 是两回事

**证书是按名字签的，不看主机指向哪台服务器。**

- 证书 SAN 里只写 `DNS:www.imcuer.com` → 访问 `https://imcuer.com` 会因为**名字不匹配**报"没有有效的证书"
  （实测：强制用 `SNI=imcuer.com` 连接，TLS 握手直接失败，curl 退出码 35）。
- 而且 `imcuer.com` 当时**没有任何 DNS 记录**，连带 www 的证书也救不了它——浏览器会先卡在域名解析。

**正确做法**：想两个都能访问，就申请**同时覆盖两个名字**的证书，并让两条 A 记录都指向同一台服务器：

```bash
certbot --nginx -d www.imcuer.com -d imcuer.com --expand --redirect
```

再让不带 www 的 301 跳到主域名，避免同一内容两个地址（影响 SEO）：

```nginx
server {
    listen 443 ssl;
    server_name imcuer.com;
    # 复用同一张证书（证书里已包含 imcuer.com）
    ssl_certificate     /etc/letsencrypt/live/www.imcuer.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.imcuer.com/privkey.pem;
    return 301 https://www.imcuer.com$request_uri;
}
```

> 想确认证书到底覆盖哪些名字，看 SAN：
> `openssl s_client -connect www.imcuer.com:443 -servername www.imcuer.com </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName`

### 坑 3：证书没问题，浏览器却仍标红「不完全安全」

**这是本次最花时间的一个坑，记下结论和方法。**

**现象**：Edge 里证书查看器显示"有效且受信任（Let's Encrypt 签发）"、连接显示 TLS 1.3，
但地址栏仍是红色「不安全」，DevTools 安全面板写着：

> 此页面不安全（HTTPS 连接断开）
> ⚠️ 资源 - 出现证书错误的活动内容：**你最近允许了加载时出现证书错误的内容（例如脚本或 iframe）在此站点上运行**

**原因**：服务器早先还在用**自签名证书**时，页面上的子资源触发了证书错误，用户点了「允许」，
浏览器把这个"允许"记在了**当前会话的内存**里。证书换成正式的之后，这条残留许可还在，于是浏览器继续判定页面"不完全安全"。

**排查动作与结论**（顺带证明了服务端完全没问题）：

| 检查 | 结果 |
|------|------|
| `Preferences` → `ssl_cert_decisions` | **空** |
| `Preferences` → `mixed_script`（不安全内容） | **空** |
| `Preferences` → `http_allowed` / `secure_network_sites` | **空** |
| `Secure Preferences` / `Local State` 全文搜域名 | **无记录** |
| `ServerCertificate`（证书例外库） | 无明文记录 |

→ 全都为空 ⇒ 这条许可**根本没写进磁盘，是运行时内存状态**。

**解决**：**彻底重启浏览器**（不是关窗口，而是结束所有进程）：

```powershell
taskkill /f /im msedge.exe      # 确认残留 0 个进程
# 然后再打开 Edge
```

浏览器重启后内存状态清空，红线消失。

> 补充两条出路：
> ① 图形界面里删：地址栏输入 `edge://settings/content/insecureContent`，把该站点从「允许」列表移除；
>   或点地址栏图标 → 「此网站的权限」→「不安全的内容」→ 改为「阻止」/「重置权限」。
> ② 若重启无效，说明存在持久化记录，可关掉 Edge 后清空
>   `User Data\Default\ServerCertificate`（先备份）。注意 Edge 的「启动加速」会让它关掉后秒速自启抢锁，
>   需要先在设置里关掉。

**关键教训**：判断"到底是服务端还是客户端问题"，看 **Edge/Chrome 的 F12 → 「安全」面板顶部那句结论**，
它会明确区分是"证书无效""混合内容"还是"残留的例外许可"，比问浏览器要猜半天高效得多。

### 通用排错顺序

遇到"证书报错"，按这个顺序逐层排除，能快速定位责任方：

```powershell
# ① 服务端 TLS 是否正常（本机直连，绕开代理和 DNS）
curl.exe -s -o NUL -w "ssl_verify=%{ssl_verify_result} status=%{http_code}\n" https://www.imcuer.com/

# ② 证书链是否完整、有效期是否正常
openssl s_client -connect www.imcuer.com:443 -servername www.imcuer.com </dev/null 2>/dev/null | openssl x509 -noout -dates -ext subjectAltName

# ③ 证书是否被 Windows 证书库信任（用 .NET 校验证书链，等价于浏览器判断）
#    见下文"一句话判断证书是否被系统信任"

# ④ 证书透明性 SCT 是否存在（curl/.NET 不校验，只有 Chrome/Edge 强制校验）
openssl x509 -in /etc/letsencrypt/live/www.imcuer.com/cert.pem -noout -text | grep -A1 "CT Precertificate SCTs"

# ⑤ 本机与服务器时钟是否一致（时钟偏差会导致"证书尚未生效"）
Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
```

**一句话判断证书是否被系统信任**（PowerShell，直连 IP + 指定 SNI，绕开代理/DNS 干扰）：

```powershell
$c = New-Object System.Net.Sockets.TcpClient('156.233.225.26', 443)
$ss = New-Object System.Net.Security.SslStream($c.GetStream(), $false, { param($a,$b,$ch,$e) $global:err = $e; $true })
$ss.AuthenticateAsClient('www.imcuer.com')
"证书校验结果: $global:err"     # 期望输出 None ；其它值即为不信任
```

`证书校验结果: None` 就说明这张证书在系统层面完全被信任——此时若浏览器仍报错，
那百分之百是浏览器本地状态或网络中间设备的问题，与服务器无关。

---

## 八、速查命令

| 目的 | 命令 |
|------|------|
| 签发证书 | `certbot --nginx -d www.imcuer.com --redirect` |
| 追加域名 | `certbot --nginx -d a.com -d b.com --expand --redirect` |
| 查看已有证书 | `certbot certificates` |
| 测试自动续期 | `certbot renew --dry-run` |
| 查看续期定时器 | `systemctl list-timers \| grep certbot` |
| 检查配置语法 | `nginx -t` |
| 重载配置 | `systemctl reload nginx` |
| 看证书覆盖的域名 | `openssl s_client -connect www.imcuer.com:443 -servername www.imcuer.com </dev/null 2>/dev/null \| openssl x509 -noout -ext subjectAltName` |
| 看证书有效期 | `openssl x509 -in /etc/letsencrypt/live/www.imcuer.com/cert.pem -noout -dates` |
| 上传站点到服务器 | 见 [HUGO-使用指南.md](HUGO-使用指南.md) 第七章 |
