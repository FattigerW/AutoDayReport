# AutoDayReport

泰时系统自动化日报工具：采集 Git 提交记录 → 调用 Qwen 大模型生成日报 → Puppeteer 自动登录并填报工时。

## 功能概览

- **网络检测** — 检查内网可达性；可自动启动 SecoClient VPN，或仅轮询等待手动连接
- **Git 采集** — 扫描配置目录下的仓库，收集目标日期的提交记录
- **LLM 生成** — 使用通义千问（OpenAI 兼容 API）生成格式化日报
- **浏览器自动化** — 登录泰时系统并填写/提交工时表单
- **验证码 OCR** — 自动识别登录验证码（ddddocr-node，可选 Python 备用）
- **定时调度** — 常驻 scheduler 进程，按配置时间每日自动执行

---

## 快速开始（一键部署）

### Windows

以管理员身份打开 PowerShell，进入项目根目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

仅安装依赖、不注册开机自启：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipDaemon
```

### macOS

```bash
chmod +x scripts/setup.sh scripts/install-daemon.sh scripts/uninstall-daemon.sh
./scripts/setup.sh
```

跳过自启注册：

```bash
./scripts/setup.sh --skip-daemon
```

setup 脚本会自动：检查 Node 18+ → `npm install` → 复制 `config.example.json`（若不存在）→ `npm run build` → 可选安装 Python `ddddocr` → 注册开机/登录自启。

**安装后请务必编辑 `config/config.json`**，填入账号、Git 扫描路径、API Key 等。

---

## 手动安装

### 前置条件

| 依赖 | 说明 |
|------|------|
| Node.js 18+ | [https://nodejs.org/](https://nodejs.org/) |
| Git | 用于采集提交记录 |
| SecoClient VPN | 访问内网（路径因平台而异，见下方） |
| Qwen API Key | 阿里云 DashScope 或兼容 OpenAI 的接口 |

### 步骤

```bash
npm install
copy config\config.example.json config\config.json   # Windows
# cp config/config.example.json config/config.json   # macOS/Linux
# 编辑 config/config.json
npm run build
```

---

## 运行方式

### 手动执行（CLI）

**日常使用：直接运行即可，默认采集当天 Git、生成日报并填报，无需参数。**

```bash
npm start
```

可选参数：

```bash
# 仅生成日报文本，不打开浏览器
npm start -- --dry-run

# 指定日期（补报）
npm start -- --date 2026-07-01

# 跳过 Git/LLM，仅用已保存报告或占位内容填表（调试浏览器）
npm start -- --fill-only

# 开发模式（tsx 直接运行）
npm run dev
```

### 后台调度（调试）

```bash
npm run schedule
```

启动常驻 scheduler 进程，读取 `config.json` 中的 `schedule` 配置，到点自动执行。日志写入 `logs/scheduler.log`。

将 `schedule.enabled` 设为 `false` 时，scheduler 启动后立即退出（便于调试）。

### 开机/登录自启

| 平台 | 安装命令 | 卸载 |
|------|----------|------|
| Windows | `.\scripts\install-daemon.ps1` | 任务计划程序删除 `AutoDayReport-Scheduler` |
| macOS | `./scripts/install-daemon.sh` | `./scripts/uninstall-daemon.sh` |

- **Windows**：用户登录时启动 `node dist/scheduler.js`（任务名 `AutoDayReport-Scheduler`）
- **macOS**：LaunchAgent `com.autodayreport.scheduler`，`RunAtLoad` + `KeepAlive`

> **注意**：`scripts/install-task.ps1` 已废弃，请改用 `install-daemon.ps1` 或 `setup.ps1`。

---

## 配置文件完整说明

复制 `config/config.example.json` 为 `config/config.json` 后按需修改。以下逐段说明。

### network — 网络与 VPN

| 字段 | 类型 | 说明 |
|------|------|------|
| `checkUrl` | string | 用于检测内网是否可达的 URL |
| `secoclientPath` | string | SecoClient 可执行文件路径；**留空则不会自动启动 VPN**，仅轮询 `checkUrl` 直到超时（适合已手动连 VPN） |
| `connectTimeoutMs` | number | 等待网络连通的最长时间（毫秒），默认 120000 |
| `pollIntervalMs` | number | 轮询间隔（毫秒），默认 3000 |

**平台路径示例：**

| 平台 | secoclientPath 示例 |
|------|---------------------|
| Windows | `C:\\Program Files (x86)\\SecoClient\\SecoClient.exe` |
| macOS | `/Applications/SecoClient.app` |

macOS 下 `.app` 路径会通过 `open -a` 启动，无需指向内部可执行文件。

### login — 泰时登录

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 登录页 URL |
| `username` | string | 用户名 |
| `password` | string | 密码 |
| `captchaMaxRetries` | number | 验证码 OCR 最大重试次数（默认 5） |
| `captchaDebug` | boolean | 为 true 时保存 OCR 调试文件到 `reports/captcha-debug/` |
| `captchaOcrEngine` | string | OCR 引擎：`auto`（Node + Python 备用）、`ddddocr`、`python` |
| `captchaOcrMode` | string | OCR 模型：`default` 或 `beta` |
| `selectors.username` | string | 用户名输入框选择器（可选） |
| `selectors.password` | string | 密码输入框选择器（可选） |
| `selectors.submit` | string | 登录按钮选择器（可选） |
| `selectors.successIndicator` | string | 登录成功判定元素（可选） |
| `selectors.captchaInput` | string | 验证码输入框（默认 `input[placeholder*="验证码"]`） |
| `selectors.captchaImage` | string | 验证码图片（可选，未配置则自动在输入框附近查找） |

**验证码 OCR 说明：**

1. 检测验证码输入框 → 截图 → ddddocr-node 识别
2. `auto` 模式下 Node OCR 失败会回退 Python ddddocr（需 `pip install ddddocr`）
3. 识别结果非 4 位则刷新验证码重试
4. 首次运行 ddddocr-node 会下载 ONNX 模型，需联网

macOS 安装 Python OCR：`python3 -m pip install ddddocr`（setup.sh 会尝试自动安装）

### report — 工时表单

| 字段 | 类型 | 说明 |
|------|------|------|
| `pageUrl` | string | 工时填报页面 URL |
| `departmentName` | string | 部门名称 |
| `project1` | string | 项目1（下拉框，支持部分匹配） |
| `project2` | string | 项目2 |
| `productLine` | string | 产品线类别 |
| `workStatus` | string | 工作状态，如「上班」 |
| `workTime` | string | 工时，如「1天」 |
| `workLocation` | string | 工作地点 |
| `overwriteExisting` | boolean | 是否覆盖已有填报 |
| `submitAfterFill` | boolean | 填完后是否点击提交 |

### git — Git 仓库扫描

| 字段 | 类型 | 说明 |
|------|------|------|
| `scanRoot` | string | 扫描根目录 |
| `maxDepth` | number | 最大递归深度 |
| `author` | string | 作者过滤（空字符串 = 所有作者） |

**路径格式示例：**

| 平台 | scanRoot 示例 |
|------|----------------|
| Windows | `D:\\company` |
| macOS | `/Users/xxx/code` |

### qwen — 大模型 API

| 字段 | 类型 | 说明 |
|------|------|------|
| `apiUrl` | string | Chat Completions 接口 URL |
| `apiKey` | string | API Key |
| `model` | string | 模型名称，如 `qwen-plus` |

### schedule — 定时调度

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | `false` 时 scheduler 启动后立即退出 |
| `runTime` | string | 每日执行时间，24 小时制，如 `"18:00"` |
| `reportDate` | string | `"today"` 或 `"yesterday"` — 相对**触发时刻**的日历日 |
| `timezone` | string | 时区，默认 `Asia/Shanghai` |

**修改执行时间或 yesterday 策略：** 编辑 `config.json` 后重启 scheduler 进程即可，无需重装开机自启任务。

### puppeteer — 浏览器

| 字段 | 类型 | 说明 |
|------|------|------|
| `headless` | boolean | `true` 无头模式（生产推荐）；填表调试时改 `false` 可观察浏览器 |
| `defaultTimeout` | number | 页面操作超时（毫秒） |

---

## 平台差异汇总

| 项目 | Windows | macOS |
|------|---------|-------|
| VPN 路径 | `SecoClient.exe` 完整路径 | `/Applications/SecoClient.app` |
| Git 路径 | 反斜杠转义 `D:\\code` | Unix 路径 `/Users/xxx/code` |
| 验证码 OCR 备用 | `python -m pip install ddddocr` | `python3 -m pip install ddddocr` |
| 开机自启 | 任务计划程序 `AtLogon` | LaunchAgent 用户级 |
| 一键部署 | `scripts/setup.ps1` | `scripts/setup.sh` |

---

## 常用运维

| 操作 | 方法 |
|------|------|
| 改执行时间 | 编辑 `schedule.runTime` → 重启 scheduler |
| 改填报日期策略 | 编辑 `schedule.reportDate`（today/yesterday）→ 重启 scheduler |
| 查看调度日志 | `logs/scheduler.log` |
| 查看 launchd 日志（Mac） | `logs/launchd.log` |
| 立即运行一次 | `npm start` 或 `npm start -- --date YYYY-MM-DD` |
| 重装自启任务 | 重新运行 `install-daemon.ps1` / `install-daemon.sh` |

---

## 输出与调试

- LLM 失败时，原始提交记录会保存到 `reports/YYYY-MM-DD.txt`
- 控制台会打印生成的日报全文
- 填表失败时调试截图保存到 `reports/fill-debug/`
- 验证码调试：`captchaDebug: true` → `reports/captcha-debug/`

---

## 故障排查

| 问题 | 处理建议 |
|------|----------|
| 网络超时 | 手动连接 VPN 后重试；或将 `secoclientPath` 留空仅轮询 |
| 登录失败 | 检查账号密码；在 `login.selectors` 中补充自定义选择器 |
| 验证码识别失败 | 开启 `captchaDebug: true` 查看截图；调整 `captchaInput` / `captchaImage` |
| 填表异常 | 设 `headless: false` 观察浏览器；用 `--fill-only` 跳过 Git/LLM 单独调试填表 |
| 未采集到提交 | 检查 `git.scanRoot`、`git.author` 是否正确 |
| scheduler 未触发 | 确认 `schedule.enabled: true`；查看 `logs/scheduler.log`；Windows 确认任务计划程序中进程在运行 |

---

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── run-job.ts            # 单次执行编排（CLI 与 scheduler 共用）
├── scheduler.ts          # 定时调度常驻进程
├── config.ts             # 配置加载
├── network.ts            # VPN/网络检测
├── git-collector.ts      # Git 提交扫描
├── llm.ts                # Qwen API 集成
├── report-formatter.ts   # 日报 prompt/解析
└── browser/
    ├── captcha.ts        # 验证码 OCR
    ├── login.ts          # Puppeteer 登录
    └── fill-report.ts    # 表单填写

scripts/
├── setup.ps1 / setup.sh           # 一键部署
├── install-daemon.ps1 / .sh       # 注册开机/登录自启
├── uninstall-daemon.sh            # macOS 卸载
└── install-task.ps1               # 已废弃，转发到 install-daemon.ps1

config/
├── config.example.json   # 配置模板（含 schedule）
└── config.json           # 本地配置（不提交 Git）

logs/                     # 调度日志（不提交 Git）
reports/                  # 日报与调试输出（不提交 Git）
```
