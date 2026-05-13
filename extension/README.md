# WhatsApp Sales Assistant — Browser Extension

将助手嵌入 Edge/Chrome 侧边栏，与 WhatsApp Web 同屏使用。

## 安装

1. 打开 Edge 或 Chrome，地址栏输入 `edge://extensions/` 或 `chrome://extensions/`
2. 开启右上角 **开发者模式** (Developer mode)
3. 点击 **加载解压缩的扩展** (Load unpacked)
4. 选择本 `extension/` 目录
5. 扩展图标会出现在工具栏

## 使用

- **方式一**：点击工具栏扩展图标 → 自动打开侧边栏
- **方式二**：访问 `web.whatsapp.com` → 页面右下角出现绿色浮动按钮 → 点击打开侧边栏
- **方式三**：访问 WhatsApp Web 时自动弹出侧边栏（可在侧边栏顶部切换 `auto`）

## 前提

必须先启动本地服务：

```bash
npm start
```

服务运行在 `http://localhost:3000`，侧边栏会自动检测连接状态。
