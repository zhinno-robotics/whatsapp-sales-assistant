# AI Sales Copilot — 发布指南

## 前置准备

### 1. 隐私政策页面（已完成 ✅）

隐私政策已托管在 GitHub Pages：
- **中文**: https://zhinno-robotics.github.io/whatsapp-sales-assistant/privacy.html
- （页面右上角可切换中英文）

### 2. 商店截图（已完成 ✅）

5 张 1280×800 截图已自动生成：
- `store/screenshots/screenshot-1.png` — 设置弹窗（32 KB）
- `store/screenshots/screenshot-2.png` — 聊天列表界面（40 KB）
- `store/screenshots/screenshot-3.png` — AI 翻译 + 5 种回复建议（76 KB）
- `store/screenshots/screenshot-4.png` — 自定义 AI 回复弹窗（58 KB）
- `store/screenshots/screenshot-5.png` — 回复编辑弹窗（60 KB）

> 如需重新生成：运行 `node store/screenshots/take-screenshots.js`

### 3. 扩展打包（已完成 ✅）
2. 按 `F11` 全屏（分辨率设为 1280×800 或更高）
3. 浏览器缩放设置为 100%（Ctrl+0）
4. 依次截取 5 个 Frame（用浏览器截图工具或系统截图）：
   - **Frame 1**: 设置弹窗
   - **Frame 2**: 聊天列表界面
   - **Frame 3**: AI 翻译 + 回复建议
   - **Frame 4**: 自定义 AI 回复
   - **Frame 5**: 回复编辑弹窗
5. 每个截图必须为 **1280×800** 或 **1280×800 比例**
6. 保存为 PNG 或 JPEG

> **更好的做法**：在 WhatsApp Web 上实际使用扩展，截取真实场景截图会更可信。每个截图用 Chrome DevTools 的设备模式调整为 1280×800。

---

### 3. 打包扩展

```bash
# 在项目目录中，将所有文件（除了 store/ 和 .claude/）打包为 .zip
# 确保不包含 .git 文件夹
```

手动操作：
1. 在文件资源管理器中打开项目目录
2. 选中以下文件/文件夹：
   - `manifest.json`
   - `background.js`
   - `content.js`
   - `page-script.js`
   - `sidepanel.html`
   - `sidepanel.js`
   - `popup.html`
   - `popup.js`
   - `icons/`
   - `README.md`
3. 右键 → 压缩到 .zip 文件
4. 重命名为 `whatsapp-sales-assistant-v2.2.0.zip`

---

## Chrome Web Store 发布步骤

### Step 1: 注册开发者
1. 访问 https://chrome.google.com/webstore/devconsole
2. 支付一次性 $5 USD 注册费
3. 填写开发者信息

### Step 2: 提交新项目
1. 点击"New Item"
2. 上传 `.zip` 包
3. 填写以下信息：

| 字段 | 内容 |
|------|------|
| **Store listing language** | Chinese (Simplified) + English |
| **Title** | AI Sales Copilot — AI 翻译与智能回复 |
| **Short description** | WhatsApp Web 上的 AI 销售助手：实时翻译、5 种回复建议、自定义话术生成 |
| **Detailed description** | 见 `store/listing.md` 中的中文详细描述 |
| **Category** | Productivity |
| **Language** | Chinese (中文) + English |

4. 上传 5 张截图（至少 1 张）
5. 上传图标（已有 128×128）
6. **Privacy practices → 填写说明**：
   - Single purpose: "AI-powered sales communication tools for WhatsApp Web"
   - Data usage: 选择 "No personal data collected or shared"
   - 但需要声明：扩展会向用户配置的第三方 AI API 发送消息文本以生成翻译/建议

### Step 3: 隐私合规声明
在 Privacy 标签页：
- **Privacy policy URL**: 填入你在 GitHub Pages 上托管的隐私政策地址
- **Data collection**: 勾选需要声明的权限用途：
  - `storage` — 本地存储用户设置和聊天缓存
  - `tabs` — 检测 WhatsApp Web 标签页
  - `sidePanel` — 侧边栏显示扩展界面
  - Host permissions — 向用户配置的 AI API 发送文本请求

### Step 4: 提交审核
- 点击 "Submit for Review"
- 审核周期：1-3 个工作日
- 审核通过后即可在 Chrome Web Store 上线

---

## Edge Add-ons 同步发布（推荐）

Edge 浏览器在国内用户中占有率高，且加载扩展无需翻墙。

### Step 1: 注册
访问 https://partner.microsoft.com/dashboard → 注册 Microsoft 开发者账号（免费）

### Step 2: 提交
1. 进入 https://partner.microsoft.com/dashboard/microsoftedge
2. 点击 "Create new extension"
3. 上传同一个 `.zip` 包（**无需任何代码修改**）
4. 填写与 Chrome Web Store 相同的描述文案
5. 提交审核

---

## 版本更新流程

每次发布新版本时：

1. 修改 `manifest.json` 中的 `version` 字段（如 `2.2.0` → `2.2.1`）
2. 重新打包为 `.zip`
3. 在各商店后台 → 编辑项目 → 上传新版 .zip
4. 填写更新说明（changelog）
5. 提交审核

---

## 命名版本建议

| 版本号 | 变更类型 |
|--------|----------|
| 2.2.x | Bug 修复、小优化 |
| 2.3.0 | 新功能 |
| 3.0.0 | 重大更新 |

---

## 文件结构确认

```
whatsapp-sales-extension/
├── manifest.json          ← 上传
├── background.js          ← 上传
├── content.js             ← 上传
├── page-script.js         ← 上传
├── sidepanel.html         ← 上传
├── sidepanel.js           ← 上传
├── popup.html             ← 上传
├── popup.js               ← 上传
├── icons/                 ← 上传
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── README.md              ← 上传
└── store/                 ← 不上传（仅本地参考）
    ├── listing.md
    ├── privacy.html
    └── screenshots.html
```
