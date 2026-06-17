# Chat2API-Go 代理配置参考
# 生成时间: 2026-06-16

## 1. config.json 中的代理设置
```json
{
  "proxy": "http://127.0.0.1:7891"
}
```
- 代理地址: mihomo HTTP 代理 (端口 7891)
- mihomo mixed-port (7890) 也支持 SOCKS5
- 代理通过管理面板 POST /api/proxy 可热更新

## 2. systemd 服务环境变量
```ini
[Service]
Environment=CHATGPT2API_ADDR=:3000
Environment=CHATGPT2API_UPSTREAM_TRANSPORT=curl
```

传输模式说明:
- `curl` 或 `curl-impersonate`: 使用 curl-impersonate 子进程 (当前使用)
- `tls-client`: 使用 bogdanfinn/tls-client 纯 Go 库 (进程内)
- 不设置: 默认用账号指纹中的 impersonate 字段

**当前推荐: curl 模式** — tls-client 模式通过代理连接时会被 Cloudflare 403 拦截

## 3. curl-impersonate 二进制路径
```
/home/ubuntu/chat2api-go/data/bin/curl-impersonate/curl_edge101  (实际是 chrome116 指纹)
```

**重要**: 默认的 `edge101` 指纹已被 Cloudflare 识别并封禁，必须替换为 `chrome116`：
```bash
cp data/bin/curl-impersonate/curl_chrome116 data/bin/curl-impersonate/curl_edge101
```
原版 edge101 备份在 `curl_edge101.bak`

支持的 TLS 指纹: chrome101, chrome116, edge101 等
**当前推荐: chrome116** (Cloudflare 暂未识别)

## 4. mihomo 代理配置 (/home/ubuntu/mihomo/config.yaml)
关键配置:
- port: 7891 (HTTP)
- mixed-port: 7890 (HTTP+SOCKS5)
- OpenAI 专用节点组: 自动测速选 US/SG/JP/KR/TW 节点
- 域名规则: chatgpt.com/openai.com → OpenAI 节点组
- DNS: fake-ip 模式，排除 yugold.top/oraclecloud.com

## 5. 代理测试
```bash
# 测试 HTTP 代理连通性
curl -s --proxy http://127.0.0.1:7891 https://chatgpt.com/robots.txt

# 测试 SOCKS5 代理
curl -s --proxy socks5://127.0.0.1:7890 https://chatgpt.com/robots.txt

# 查看出口 IP
curl -s --proxy http://127.0.0.1:7891 https://api.ipify.org

# 通过 chat2api-go API 测试
curl -s http://127.0.0.1:3000/api/proxy/test -X POST -H "Authorization: Bearer Ty20070218@" -H "Content-Type: application/json" -d '{"url":"http://127.0.0.1:7891"}'
```

## 6. 已修复的问题
- bootstrap 403 fallback: chatgpt.com 首页返回非 2xx 时，使用默认 PoW 脚本继续
  (修改: internal/app/upstream.go bootstrap 函数)
