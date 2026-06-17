#!/usr/bin/env python3
"""
chat2api-go 代理轮换监控脚本 v3
切换前先测试节点能不能连chatgpt.com
"""

import json
import time
import random
import subprocess
import os
import sys
from datetime import datetime

LOG_FILE = "/home/ubuntu/chat2api-go/data/logs.jsonl"
MIHOMO_API = "http://127.0.0.1:9090"
ROTATE_GROUP = "Rotate"
FAIL_THRESHOLD = 2
COOLDOWN_SECONDS = 30
CHECK_INTERVAL = 3
MAX_TEST_NODES = 15  # 最多测试15个节点找可用的

FAIL_KEYWORDS = [
    "status=403", "Unusual activity",
    "SSL_ERROR", "SSL_connect",
    "curl-impersonate failed", "EOF",
    "Connection refused", "Connection reset",
    "timed out", "no available",
]

EXCLUDE_KEYWORDS = ["🇭🇰", "HK", "香港", "free", "Farah", "EbraSha", "DeltaKronecker", "OpenRay", "米贝"]

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def curl_get(url, timeout=10):
    try:
        r = subprocess.run(
            ["curl", "-s", "--connect-timeout", str(timeout), url],
            capture_output=True, text=True, timeout=timeout+5
        )
        return r.stdout
    except:
        return ""

def curl_put(url, data, timeout=10):
    try:
        r = subprocess.run(
            ["curl", "-s", "-X", "PUT", "--connect-timeout", str(timeout),
             "-d", json.dumps(data), url],
            capture_output=True, text=True, timeout=timeout+5
        )
        return r.stdout
    except:
        return ""

def curl_test_proxy(timeout=15):
    """通过当前代理测试能否连chatgpt.com"""
    try:
        r = subprocess.run(
            ["curl", "-s", "--proxy", "http://127.0.0.1:7891",
             "--connect-timeout", str(timeout), "-o", "/dev/null",
             "-w", "%{http_code}", "https://chatgpt.com"],
            capture_output=True, text=True, timeout=timeout+5
        )
        code = r.stdout.strip()
        return code in ("200", "301", "302", "304", "403")  # 403也算能连上（不是网络错误）
    except:
        return False

def get_rotate_nodes():
    resp = curl_get(f"{MIHOMO_API}/proxies/{ROTATE_GROUP}")
    try:
        d = json.loads(resp)
        nodes = d.get("all", [])
        filtered = [n for n in nodes if not any(kw in n for kw in EXCLUDE_KEYWORDS)]
        return filtered if filtered else nodes
    except:
        return []

def get_current_node():
    resp = curl_get(f"{MIHOMO_API}/proxies/{ROTATE_GROUP}")
    try:
        return json.loads(resp).get("now", "?")
    except:
        return "?"

def set_node(name):
    curl_put(f"{MIHOMO_API}/proxies/{ROTATE_GROUP}", {"name": name})

def find_working_node(exclude_current=None):
    """找到一个能连chatgpt.com的节点"""
    nodes = get_rotate_nodes()
    if not nodes:
        log("⚠️ 没有可用节点")
        return None

    if exclude_current and exclude_current in nodes and len(nodes) > 1:
        nodes = [n for n in nodes if n != exclude_current]

    random.shuffle(nodes)
    tested = 0

    for node in nodes[:MAX_TEST_NODES]:
        tested += 1
        set_node(node)
        time.sleep(1)  # 等节点生效

        if curl_test_proxy():
            log(f"✅ 节点可用: {node} (测试了{tested}个)")
            return node
        else:
            log(f"  ⏭️ 不可用: {node}")

    log(f"⚠️ 测试了{tested}个节点都不可用")
    return None

def switch_node(exclude_current=None):
    """切换到一个可用节点"""
    current = get_current_node()
    log(f"🔍 正在寻找可用节点 (排除: {current})...")

    new_node = find_working_node(exclude_current=current)
    if new_node:
        log(f"🔄 已切换到: {new_node}")
        return True
    else:
        # 没找到可用节点，随便切一个
        nodes = get_rotate_nodes()
        if nodes:
            fallback = random.choice([n for n in nodes if n != current] or nodes)
            set_node(fallback)
            log(f"⚠️ 没找到可用节点，随机切到: {fallback}")
        return False

def is_failure(error):
    if not error:
        return False
    return any(kw in error for kw in FAIL_KEYWORDS)

def tail_log(offset=0):
    lines = []
    try:
        with open(LOG_FILE, "r") as f:
            f.seek(0, 2)
            size = f.tell()
            if offset >= size:
                return [], offset
            f.seek(offset)
            for line in f:
                line = line.strip()
                if line:
                    try:
                        lines.append(json.loads(line))
                    except:
                        pass
            return lines, f.tell()
    except FileNotFoundError:
        return [], 0

def main():
    log("🚀 代理轮换监控 v3 启动")
    log(f"   阈值: 连续{FAIL_THRESHOLD}次 | 冷却: {COOLDOWN_SECONDS}s | 最多测{MAX_TEST_NODES}个节点")

    offset = 0
    try:
        with open(LOG_FILE, "r") as f:
            f.seek(0, 2)
            offset = f.tell()
    except:
        pass

    consecutive_fails = 0
    last_switch_time = 0
    last_log_id = None

    while True:
        try:
            entries, new_offset = tail_log(offset)
            offset = new_offset

            for entry in entries:
                detail = entry.get("detail", {})
                status = detail.get("status", "")
                entry_id = entry.get("id", "")
                error = detail.get("error", "")
                log_time = entry.get("time", "")

                if entry_id == last_log_id:
                    continue
                last_log_id = entry_id

                if status == "failed" and is_failure(error):
                    consecutive_fails += 1
                    log(f"❌ 失败 (连续{consecutive_fails}次) [{log_time}] {error[:60]}")

                    if consecutive_fails >= FAIL_THRESHOLD:
                        now = time.time()
                        if now - last_switch_time >= COOLDOWN_SECONDS:
                            log(f"⚠️ 连续{consecutive_fails}次失败，开始切换...")
                            if switch_node():
                                last_switch_time = now
                                consecutive_fails = 0
                                time.sleep(2)
                        else:
                            remaining = int(COOLDOWN_SECONDS - (now - last_switch_time))
                            log(f"⏳ 冷却中，{remaining}秒后可切换")

                elif status == "success":
                    if consecutive_fails > 0:
                        log(f"✅ 恢复成功！之前连续失败{consecutive_fails}次")
                    consecutive_fails = 0

            time.sleep(CHECK_INTERVAL)

        except KeyboardInterrupt:
            log("👋 监控停止")
            break
        except Exception as e:
            log(f"⚠️ 异常: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
