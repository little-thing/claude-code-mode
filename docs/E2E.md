# 真实 DSH 浏览器验收

产品代码、功能场景和 Issue 回归由本仓库维护。本地、插件 PR CI 和私有自动化项目使用同一个 `pnpm test:e2e` 入口；E2B 调度、模型调用、修复循环及 GitHub 管理属于独立自动化项目。

## 运行

需要 Node.js **24.9.0 或更新版本**、pnpm 11.7.0 和 Chrome。测试不需要模型、E2B 或 GitHub 凭据。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chrome
pnpm test
pnpm test:e2e --dsh-version 0.2.2-rc.1 --suite core --output /tmp/ccm-core
pnpm test:e2e --dsh-version 0.2.2-rc.1 --scenario split-open-refresh-close --output /tmp/ccm-split
pnpm test:e2e --dsh-version 0.2.2-rc.1 --suite full --output /tmp/ccm-full
```

`--dsh-version` 必须是精确版本，不接受 `latest` 或版本范围。测试会在临时目录安装指定 DSH，构建插件并打成 npm tarball，安装到临时 `DSH_HOME` 的 Web profile，使用随机本地端口启动真实宿主，然后运行无头 Chrome。原有会话和个人 profile 不参与测试。完成或失败后关闭浏览器、宿主及其子进程。

已有对应版本的 DSH 时，可通过绝对路径 `CCM_DSH_BIN` 复用；实际版本必须严格匹配。`CCM_BROWSER_CHANNEL` 默认 `chrome`，也接受已经安装的 `chromium`。浏览器和被测宿主不继承 GitHub、E2B 或模型 API key。高级参数 `--repo /绝对路径` 可指定隔离的目标源码副本。

## 场景和隔离

场景唯一清单为 `test/e2e/scenarios.mjs`，含功能、PARITY 编号、数据、操作、断言与平台。

| 场景 | core | 验证内容 |
| --- | --- | --- |
| `sidebar-mounted` | 是 | 插件侧栏、合成会话和布局尺寸 |
| `title-rename` | 是 | 标题 Enter 保存、Esc 取消、侧栏同步 |
| `fork-tree-and-collapse` | 是 | 真实 fork、父子树、折叠摘要 |
| `split-open-refresh-close` | 是 | 两屏身份、尺寸、刷新恢复和关闭 |
| `theme-light-and-dark` | 是 | 深浅主题令牌、可见性与截图证据 |
| `preferences-disable-split-and-skin` | 是 | 关闭分屏及皮肤、刷新、恢复偏好 |
| `search-palette` | 否 | 搜索分类、结果、无结果、打开会话 |
| `session-pin-and-archive` | 否 | 置顶归属、归档筛选、取消归档 |
| `four-pane-grid` | 否 | 四屏 2×2、身份唯一、刷新和主屏提升 |
| `jobs-panel-session-isolation` | 否 | 后台任务菜单、空态和两屏隔离 |

`full` 运行清单中全部已实现 Web 场景和已合并 Issue 回归。它不代表整个产品已经完整覆盖：图片灯箱、浏览器 rewind、任务运行/停止输出、真实 MCP provider 往返及桌面原生操作的缺口均显式记录为 `not-covered`。深浅主题截图场景通过浏览器媒体偏好与宿主主题标记验证令牌，不覆盖原生主题设置页的交互。

每个场景使用新的浏览器 context、工作区和四个合成会话，恢复默认插件偏好。夹具通过真实 `sessionController`、`workspaceController` 和 Session API 写入有效事件，不请求模型，也不直接拼写持久化日志。某一场景失败后继续后续独立场景；安装、宿主或浏览器启动失败时，依赖场景记为 `blocked`。

## Issue 回归

新回归放在 `test/e2e/issue-N.spec.mjs`，导出一个函数：

```js
export async function run({ page, expect, baseURL, repo, outputDir, fixtures }) {
  const first = fixtures.sessions[0]
  const row = page.locator(`[data-ct-wb-session="${first.id}"]`)
  await expect(row).toBeVisible()
  // 执行对应 Issue 的用户操作，再断言可见结果。
}
```

`page` 已连接真实 DSH，`expect` 来自 Playwright，`fixtures` 含 `workspaceId` 和 `sessions: [{id, title}]`。使用传入的对象，无需额外导入 Playwright；可使用 Node 内置模块。回归应针对用户可观察行为，避免根据源码文本、分支名或网络偶然状态推断成败。

```sh
pnpm test:e2e --dsh-version 0.2.2-rc.1 --regression test/e2e/issue-42.spec.mjs --only-regression --output /tmp/ccm-issue-42
```

`--only-regression` 只运行指定回归及必要的环境前置检查。普通 core/full 运行自动发现已合并的 `issue-N.spec.mjs`；`--scenario` 单跑指定注册场景，不额外运行其他回归。回归报告中的检查名固定为 `regression:test/e2e/issue-N.spec.mjs`，供私有执行器在原代码和候选代码上使用同一用例证明修复。

## 报告

`--output` 使用绝对路径，默认 `.e2e-output/`。输出含 `report.json`、`report.md`、脱敏宿主日志，以及每个场景目录内的截图、失败现场和 `trace.zip`。trace 可能带已销毁实例的本地访问 token；测试环境不含个人会话或模型凭据。

JSON 保留 `passed`、`dshVersion`、`checks: [{name, passed, detail?}]`，并提供：

- `suite`：`core` 或 `full`。
- `scenarios`：各项 `passed`、`failed`、`blocked` 或 `not-covered`，附功能、操作和断言等元数据。
- `summary`：上述四种状态的数量；`notCovered` 不计作已验证。
- `visual`：当前视觉环境、每个场景的截图比较结果。
- `status`：`passed`、`failed` 或 `review-required`。行为通过但缺少匹配的已审核基线时为 `review-required`，CLI 仍返回 0；行为或已审核像素比较失败返回非 0。
- `failure.kind`：失败时区分 `product`、`environment` 和 `visual-review`，后者不能自动通过更新基线来消除。

## 已审核视觉基线

工具只比较人工审核过的预期图，不提供自动批准或更新基线的命令。

```sh
pnpm test:e2e --dsh-version 0.2.2-rc.1 --suite core \
  --visual-baselines /绝对路径/已审核基线 \
  --visual-environment 精确模板构建标识 \
  --output /tmp/ccm-visual
```

也可通过 `CCM_VISUAL_ENVIRONMENT_ID` 指定视觉环境标识。该标识应固定系统镜像、字体、浏览器安装方式等环境，例如精确 E2B 模板构建 ID。`report.visual.environment` 提供当前平台、Chrome 版本、语言和视口。只有这些字段与基线逐项匹配才执行比较。GitHub runner 与 E2B 使用不同字体或系统镜像时，不共享同一已审核标识。

基线目录中的 `APPROVED.json` 格式如下。图像按场景 ID 分目录存放；示例字段值应由真实运行环境填写，并通过代码审核确认。

```json
{
  "schemaVersion": 1,
  "approved": true,
  "reviewedBy": "维护者 GitHub 账号",
  "reviewedAt": "2026-11-18T00:00:00Z",
  "environment": {
    "environmentId": "精确模板构建标识",
    "platform": "linux",
    "browserVersion": "实际 Chrome 版本",
    "locale": "zh-CN",
    "viewport": { "width": 1440, "height": 1000, "deviceScaleFactor": 1 }
  },
  "images": {
    "sidebar-mounted/sidebar.png": { "maxDiffPixels": 0, "threshold": 0.2 }
  }
}
```

缺基线、未批准、缺少某张图或环境不匹配，都标为 `review-required`，不会把刚生成的本机截图当作已审核基线。已审核比较失败保存实际图、`visual-expected-*` 和 `visual-diff-*`，供维护者判断行为退化与有意的样式变化。当前仓库尚未提交已审核像素基线。
