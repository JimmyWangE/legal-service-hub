========================================
诊断结果和修复建议
========================================

根据代码分析，发现了问题所在：

## 🔴 问题诊断

你的 server.mjs 默认监听配置：
- HOST: 127.0.0.1 (只能本机访问)
- PORT: 4173 (而不是189)

但预发布环境需要：
- HOST: 0.0.0.0 或 172.22.3.76 (允许外部访问)
- PORT: 189

## ✅ 解决方案

### 方案1: 修改systemd服务配置（推荐）

编辑前端服务文件:
```bash
sudo nano /etc/systemd/system/legal-service-hub.service
```

确保Environment部分包含:
```ini
[Service]
Environment="HOST=0.0.0.0"
Environment="PORT=189"
Environment="API_UPSTREAM=http://127.0.0.1:8000"
```

然后重新加载并重启:
```bash
sudo systemctl daemon-reload
sudo systemctl restart legal-service-hub
```

### 方案2: 使用环境变量文件

创建 `/home/lawsft/legal-service-hub/.env`:
```bash
cat > /home/lawsft/legal-service-hub/.env << 'EOF'
HOST=0.0.0.0
PORT=189
API_UPSTREAM=http://127.0.0.1:8000
EOF
```

修改systemd服务添加:
```ini
EnvironmentFile=/home/lawsft/legal-service-hub/.env
```

### 方案3: 直接启动测试（临时）

停止systemd服务后手动启动:
```bash
sudo systemctl stop legal-service-hub
cd /home/lawsft/legal-service-hub
HOST=0.0.0.0 PORT=189 API_UPSTREAM=http://127.0.0.1:8000 node server.mjs
```

在另一个终端测试:
```bash
curl http://172.22.3.76:189/
```

如果成功，按Ctrl+C停止，然后应用方案1。

## 🔍 验证步骤

1. 检查端口监听:
```bash
netstat -tlnp | grep 189
# 应该看到: 0.0.0.0:189 或 :::189
```

2. 测试本地访问:
```bash
curl -I http://127.0.0.1:189/
```

3. 测试外部访问:
```bash
curl -I http://172.22.3.76:189/
```

4. 在浏览器打开:
```
http://172.22.3.76:189/
```

## 📋 完整诊断

运行诊断脚本查看详细信息:
```bash
chmod +x /home/lawsft/legal-service-hub/diagnose-and-fix.sh
/home/lawsft/legal-service-hub/diagnose-and-fix.sh
```

## 🆘 如果还是无法访问

检查防火墙:
```bash
# 检查防火墙状态
sudo firewall-cmd --list-all 2>/dev/null || sudo ufw status

# 如果需要开放189端口
sudo firewall-cmd --add-port=189/tcp --permanent
sudo firewall-cmd --reload
# 或
sudo ufw allow 189/tcp
```

检查后端是否正常:
```bash
curl http://127.0.0.1:8000/api/v1/health/live
curl http://127.0.0.1:8000/api/v1/health/ready
```

查看完整日志:
```bash
sudo journalctl -u legal-service-hub -f
sudo journalctl -u legal-service-hub-api -f
```

========================================
