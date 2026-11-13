# 行为对标表 · Claude Code ⇄ DSH

本表是「操作一模一样」的唯一进度事实源。每一行只回答三件事：
Claude Code 怎么做、DSH 现在怎么做、我们这个插件做到哪了。

**状态必须真实。** 没做过就写未做，不确定就写待复现，不许写「应该没问题」。

图例：✅ 已完成｜🟡 部分完成｜⬜ 未开始｜➖ 由 DSH 原生提供，本插件复用

> 2026-11-07 插件由 `claude-theme` 更名为 `claude-code-mode`（包名、路由、存储键已同步）。
> 更名前的记录里，旧名指同一个插件；「`claude-theme` 分组」是当时的项目分组名，不是插件名。

## 会话工作区

| # | 能力 | Claude Code 行为 | DSH 现状 | 插件状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 工作区分组与折叠 | 工作区按目录分组，行头可折叠 | 原生支持 | ✅ | 自绘列表保留了分组与折叠，展开状态在内存；只有点分组头才收起，归档/关闭当前会话不会把分组收起来 |
| 2 | 会话行：标题 + 相对时间 | 标题 + 相对时间 + 状态；标题接近 75% 墨色，列表行比分组标题更实 | 原生支持 | ✅ | 自绘行；时间按分钟/小时/天。标题只取持久化 title，缺失时显示「未命名会话」/「新会话」，不用项目目录名兜底；标题色/字重由皮肤 `--ct-wb-row-text`（78% 墨色）和 `--ct-wb-title-weight`（500）控制，缺皮肤时回退主文字色/400；另一个宿主进程新建的会话标题由 `sessions.refreshProjections` 在后台补齐，刷新后不需要点一下才恢复 |
| 3 | fork 子会话缩进 | 父行下最多两级；孙级 fork 也直接挂在根会话下 | 平铺 | ✅ | 深度只有 0 / 1；数据来自 `sessions.list.parentId`。DSH 0.2.2 起普通 fork 不再写 `header.parentSession`，宿主交互点已补回；升级前的历史 fork 用父标题 + 切点事件校验回填，只在唯一匹配时采用 |
| 4 | 连接线 | 一棵树一条连续树干，延伸到最后一个子行中心；只有末端子行有横向连接线 | 无 | ✅ | 行伪元素画树干，`is-last-child` 在 50% 处接横线 |
| 5 | 父行展开 / 折叠 | 父行带展开器；折叠只隐藏后代，父行留在原地，并保留一条可点击的「N 个嵌套会话」摘要 | 无 | 🟡 | 摘要行已接；折叠状态只在内存，刷新丢失 |
| 6 | 祖先链高亮 | 悬停子行时高亮父链 | 无 | ⬜ | 自绘列表尚未接回 |
| 7 | 子行紧跟父行 | 父行后紧跟这一支的所有后代 | 按最近活动排序 | ✅ | 自绘列表按 group 内 parentId 建树，先根后后代 |
| 8 | 新建会话 | 工作区行提供新会话入口 | 原生 | ✅ | 工作区行 `+` |
| 9 | 重命名 | 行操作菜单进入 | 原生 | 🟡 | 菜单项已接；输入目前是 `window.prompt` |
| 10 | 分叉（fork） | 行操作菜单分叉 | 原生 | ✅ | `uiWorkspace.forkSession`；宿主包装 `sessionController.fork` + `agents.create`，给 seeded 子会话补 `meta.parentSession`（0.2.2 丢掉的 0.2.1 语义） |
| 11 | 归档 / 取消归档 | 更多菜单里归档，无确认；归档当前会话后回到新会话界面 | 原生归档会 `clearMain` 并显示新会话 hero | ✅ | 自绘菜单直接归档；运行中自动 `stopActivity: true`；归档当前会话（含分屏主壳）后主区回原生新会话界面，归档非当前会话主区不动 |
| 12 | 置顶 | 只有 fork 树 root（父会话）可置顶；整棵 fork 树移到顶部「已置顶」分组，取消置顶整树回工作区 | 原生只做标记/组内排序 | ✅ | 子会话不显示置顶菜单，拖动不响应落点；以 tree root 为单位 pin |
| 13 | 删除会话 | 待复现 | 原生无可靠删除 | ⬜ | 需要宿主能力 |
| 14 | 搜索 | 标题/内容搜索 | 原生 | 🟡 | 本地标题/工作区匹配 + `sessions.search` 内容结果合并；当前环境无内容命中，待真实索引验证 |
| 15 | 排序：最近活动 | 不支持手动排序；项目内按最近活动倒序 | 原生 | ✅ | 每个 fork 树按 root + 后代的最新 `updatedAt` 排序，最新在最上面；子会话按自身更新时间排序 |
| 16 | 批量 / 多选 | 待复现 | 未见 | ⬜ | |
| 17 | 快捷键 | `⌘K` 搜索、`⌘N` 新建；动作无全局键 | 部分原生 | 🟡 | 已接 Claude 的 `⌘K`/`⌘N`；不使用 DSH 的 `⌥⌘A` 等 |
| 18 | 状态徽标（运行/未读/错误） | 运行/等待/未读 | 部分原生 | 🟡 | 已接 `useSessionStatus` 的 running / pendingInteraction / completionUnread；错误态未覆盖 |
| 19 | 右键菜单结构 | 待复现 | 原生菜单 | ✅ | 会话行/工作区行右键打开自绘菜单，动作与更多一致 |
| 20 | 空状态 / 首屏 | 无会话时提示 | 原生 | ✅ | 自绘空态 / 暂无匹配 |
| 21 | 「展开其余 N 个会话」 | Claude 没有这个折叠，直接展示全部会话 | 原生 watermark：每工作区先显示 5 条 | ✅ | 自绘列表直接从 store 渲染全部会话，不依赖原生 watermark |
| 22 | fork 展开器位置 / 点击区 / 提示 | 标题文字后紧跟 chevron；父行常显；hover 有「隐藏/显示嵌套会话」气泡 | 无 | ✅ | 自绘行内 flex 布局，chevron 20px，hover 显示气泡 |
| 23 | 归档 / 置顶入口 | 行内只露出「更多」；归档、置顶在菜单里 | 行内直接露出归档、置顶按钮 | ✅ | 自绘行只有 chevron + 时间 + 更多；动作全在菜单 |
| 24 | 悬浮预览 | 悬停会话行显示卡片 | 原生有 | ✅ | 预览卡 700ms |
| 25 | 拖拽归属 | 父会话可在置顶、分区、普通分组之间拖动；拖入分区会取消置顶；拖入普通分组会取消置顶并从分区移出；子会话可拖但不响应落点；会话不可手动排序 | DSH 无对应拖拽 | ✅ | `dragState.pinnable` 只对 tree root 为 true；拖拽提示跟随指针；会话顺序仍按最近活动，不写 `insertSessionBefore` |
| 26 | 已置顶分组 | 工作区上方常驻、可折叠；整棵 fork 树显示在分组内 | 无 | ✅ | pinned root 的整棵树从工作区移入；取消置顶后整树回原工作区；会话行不显示更新时间 |
| 27 | 视图选项 | 分组依据/排序方式/显示 | 原生只有分组方式和排序 | ✅ | 两级菜单：主行 + 右侧子菜单；每个分组头用 ↑↓「分组和排序」按钮打开，悬停有深色气泡提示；新建按钮只出现在项目/分区；设置本地持久化；分组头菜单只走右键 |
| 28 | 分区 | 主列表同级、拖拽入分区、删除回项目；新建部分只在视图菜单；分区菜单右键打开 | 无 | 🟡 | 新建用自绘 dialog；重命名/删除也用 dialog；组头无更多按钮；新建会话自动归属待补 |
| 29 | 日期/状态/无分组 | 分区置顶，项目消失，按日期/状态/平铺 | 无 | ✅ | 日期桶、状态组、flat 已接；fork 树不拆 |
| 30 | 查看全部 | 右侧完整会话页，活跃/已归档 tabs | 无 | ✅ | 注册 main keyed panel；搜索/新建/关闭可用 |
| 31 | 环境 / 删除所有会话 | 菜单可见 | 无环境元数据/无删除 API | ⬜ | 按确认禁用 |
| 32 | 新会话草稿 | 未发送的新会话草稿在切换会话后保留；从其他项目新建时草稿跟随当前项目 | DSH 原生每次新建都会开新空白，草稿丢失 | ✅ | 左上角新建、项目新建按钮、⌘N 共用草稿逻辑；复用源草稿或按 workspace-switch 迁移文字/引用/附件 |
| 33 | 分区独立视图 | 分区在置顶下、会话分组上，按创建时间排列；每个分区有自己的分组/排序/显示，不能按项目分组 | 无 | ✅ | 分区 view 持久化；分区内支持无/日期/状态；全局分组独立 |
| 34 | 搜索弹窗 | 点击搜索或快捷键打开全局搜索面板，可分类型切换 | 原生侧栏搜索 | ✅ | 全部/会话/项目/自动化任务/操作五个 tab；本地+Host 搜索；自动化目录接 schedule/catalog；键盘导航；打开会话/展开项目/自动化任务页/新建等动作 |
| 35 | 拖拽分屏（每个 pane 带右侧栏） | 把会话从侧栏拖到主内容区：按落点向右/向下分屏，最多左右两列、上下两行共 4 屏；只有真实空位（原生下方、overlay 区域外侧）才新增分屏，其余落点替换目标屏；网格已满后全部落点只替换，不出现第三列/第三行；会话 pane 自带 details/file 面板 | 无 | ✅ | 原生 main+rightbar 作为左/上屏（50%），其余会话是 `shell.overlay` 的 overlay；每个 overlay 通过捕获的 main/rightbar `renderSlot`，在 pane 的 SessionProvider 下渲染完整 `main.conversation` 子 slot + `rightbar.session`，即真实主屏组件；原生左屏可再拆出下方一屏（native bottom），overlay 区域只沿正交方向再分一屏（row→上下、column→左右）；落点预览只有空位显示分屏，满格显示「在此打开 / 分屏已满（左右两列 · 上下两行）· 替换当前分屏」；旧版持久化的 3+ overlay 叶在恢复时压平裁剪到 2 叶 |
| 36 | 分屏打开与切换 | 右键会话「Open in → Split view」；分屏内点侧栏会话替换当前聚焦屏；点已在别的屏里的会话只聚焦那一屏 | 无 | ✅ | 自绘菜单「在分屏中打开」；聚焦屏高亮、其他屏变暗；每个 pane 的右栏随自己的聚焦/pane 独立，overlay 聚焦不影响原生右栏；同一会话不重复打开 |
| 37 | 关闭分屏 | 每屏有独立头部与关闭；关闭到只剩一屏后回到单屏；`⌘\` 关闭聚焦分屏 | DSH 无分屏 | 🟡 | 关闭按钮只在分屏时包进原生 session header corner（右栏开关之后，最右侧），文案统一：overlay/native bottom 关闭 pane；分屏 native 左/上屏没有可删 pane 时走和「新会话」同一个入口（含草稿），回同项目新会话；单屏不显示、不去新会话；不先关右栏。关右侧最后一个 overlay 时若左侧有 native bottom，保留并切成整宽上下两屏；再关 native bottom 才退出。侧栏不再显示「退出分屏」按钮，关闭 pane 即退出；未接 `⌘\` |
| 38 | 分屏内容 | 分屏内是完整会话 pane：chat、diff、文件等 | main 只能渲染一个会话 | ✅ | overlay 通过 `main` 入口的 renderSlot 渲染完整原生 `main.conversation` 子 slot：原生根（高度/flex/phase 规则）、session header（模型/视图页签/更多/右栏开关）、正文、composer、滚动、状态栏；再加原生 `rightbar.session` seat。每屏独立 SessionProvider / 输入 / 滚动 / 右栏 tab；同一会话不重复 |
| 39 | 分屏布局持久化与比例 | 可拖动 pane 边缘调整比例；布局随窗口保存 | 无 | ✅ | mode/native/tree/nativeBottom/focus + native/column/bottom share 写入 localStorage v2，刷新恢复；`.ct-split-resizer` 拖拽 native/overlay、native top/bottom、右侧上下分屏边界 |
| 40 | 每个分屏的右侧栏 | 每个 session pane 可以有自己的 details/file 面板 | 公开 API 里右侧栏是单个 root 列，`RightbarRoot` 只为选中 Session 渲染可见的 `rightbar.session` surface | ✅ | 包装 rightbar 入口捕获 `renderSlot`，在每个 overlay 的 SessionProvider 里渲染 `rightbar.session` seat；per-session store/tab/终端独立。分栏/全屏/收起按钮都保留；全屏只填当前 pane；240px 下分栏可能被原生 canSplit 判 disabled；收起后宽度归零，原生 header 的 ExpandButton 重开；非公开 API |
| 41 | 分屏侧栏多选与选中 hover | 分屏时侧栏显示所有已打开 pane 的会话；聚焦屏是当前项，其余是选中项；hover 选中项时颜色应在选中底色上叠加 | 无 | ✅ | `splitSelectedIds` 汇总 native + overlay + native bottom 的 session；行同时渲染 `is-current`/`is-selected`；`.is-selected` 用 hover 底色，`:hover` 叠 7% label 色，避免和普通 hover 一样替换底色 |
| 45 | DSH 0.2.2 AppFrame 兼容 | 0.2.2 在 main slot 外新增 `.mainPanel` 后，分屏仍应正常打开 | 无 | ✅ | `readSplitFrame` 改为从 main slot 向上找持有 `[data-shell-bottom]`/`[data-shell-overlay]` 的 frame，再取 frame 下包含 main 的直接子列；0.2.2 真实浏览器验证 row 分屏 overlay 正常 |
| 46 | 分屏持久化与右栏归属 | 刷新后分屏布局应保持；分屏 pane 右栏应取该会话自己的状态，主屏状态不串 | 无 | ✅ | splitView 写 localStorage，sessions ready 后恢复 mode/native/tree/nativeBottom/focus；各 pane 右栏只用自己 sessionId 的 store，不强制 setExpanded；0.2.2 实测刷新后 A/B 分屏和两边右栏状态都恢复 |
| 47 | 分屏 overlay 多会话历史与滚动 | overlay 正文必须按自己 pane 的会话加载历史，滚动/composer 与单屏一致；同一会话在单屏正常，放进 overlay 也不能报错/卡在载入 | 无 | ✅ | 0.2.2 实测：同一会话单屏正常；直接渲染捕获的 main/root 作用域 `main.conversation` 组件会沿用主屏 props，gateway 报 `Maximum call stack size exceeded`；只渲染 `conversation.header` + `conversation.content` child slot 会丢原生根，pane 不能滚动、composer 不吸底。改为捕获 `main` 入口的 renderSlot，在 pane 的 SessionProvider 下调用 `renderSlot('main.conversation')`，由 SlotOutlet 按当前 scope 重新解析完整原生根；0.2.2 web 实测两屏历史、header、滚动、sticky composer、右栏、刷新恢复都正常 |
| 48 | 分屏刷新后的历史/关闭 | 分屏刷新后 overlay 历史应正常加载；关闭按钮应关闭当前 pane，不应关到残留 pane | 无 | ✅ | retain reference 的 `ready` settle 后再 emit，避免历史卡在“载入历史”；closeSession 只从当前 overlayTree/native bottom 找 pane，emit 前 syncPanes 清理残留；pane session context 保证关闭的是 overlay 自己；0.2.2 web 实测刷新后历史正常、关闭生效 |
| 49 | 关闭原生/主屏 | 关闭 main 时不应直接新会话；只要还有其它 pane，就把它提升为新的 main；最后只剩一个才新会话 | 无 | ✅ | closeSession 对 native 先找当前 tree/native bottom 的其它 pane，ui.openSession 提升并移除原 pane；ego 实测关闭 native 后剩余 pane 变主屏、split 退出；最后一个走 newSession |
| 50 | 分屏关闭方向与 active 边框 | 关闭上/下屏时相邻屏应扩展；关闭左/右屏时该方向消失；active 边框应覆盖右侧抽屉；无 overlay 时不留右列空白 | 无 | ✅ | closeSession 优先提升 native bottom；overlayTree 空时归一 column、overlayW 归零；active 边框改 `::after` 覆盖右栏；ego 实测 3 屏关 native top：native bottom 顶上来、右侧 overlay 保留、右列无空白、边框完整 |
| 51 | 分屏分割线与拖拽调整大小 | 分屏之间只用和原生一致的细分割线，不要黑色聚焦描边；hover 竖/横分割线可拖拽调整 pane 大小，比例刷新后保持；侧栏不再显示“退出分屏”按钮 | 无 | ✅ | active 描边/非聚焦透明度移除，overlay pane 用 border-l2；`.ct-split-resizer` 在 native/overlay、native bottom 边界拖拽，share 写入 v2 persist 并参与 measure；ego 实测 native 604→734、native top 485→585；侧栏 exit 按钮已删 |
| 52 | 右侧上下分屏与左右对齐 | 右侧 overlay 的上下分屏也要有可拖拽分割线；与左侧 native bottom 使用同一高度，拖动一侧两侧同步变化 | 无 | ✅ | computeOverlayRects 的 column split 用 bottomShare（与 native bottom 同比例）；overlay 根为 column split 时加右侧 horizontal 手柄；ego 4 屏实测拖右侧横线：两侧 handle 同步 482→572，左右上下屏高度同步 485→575/394 |
| 53 | 已打开会话拖拽分屏 | 会话已在主视图/pane 时，拖拽不应出现分屏落点框，也不应弹“已经是当前主视图”错误；菜单不提供分屏入口 | 无 | ✅ | split.isSessionOpen 在 dragOver/drop/drop-layer 三处短路；openInSplit 直接 return；菜单项对已打开会话隐藏；删除 same/focus toast |
| 53 | 消息回退（退回到此处） | 悬停用户消息，动作行出现「退回到此处」；从该消息开始移除消息，原消息回到输入框 | 没有公开的会话截断/回退 API | ✅ | 整行动作默认隐藏（含时间/用量），hover 用户消息才显示复制/回退/分支，助手 action 行由同一轮非用户消息 hover 显示；三个用户动作统一用原生 Tooltip；时间统一走 `shared/time.js` 相对格式；隐藏回退范围内的消息行，原文字放回 composer；模型侧包装 `Session.deriveMessages`，不改 append-only 日志 |
| 54 | 回退时还原文件 | 回退段改过项目文件时询问是否一起还原；当前文件已不是会话最后写出的版本时只回退消息 | 无 | ✅ | 文件工具参数在 `tools/pre-execute` 捕获 before，`turn/end` 捕获 after；只有当前文件等于最后 after 才弹确认；`bash` 改动按 `workspaceChanges` 摘要视为未捕获，只回退消息 |
| 55 | 撤销回退 | 新消息提交前可恢复本次移除的消息；提交后不可撤销；撤销不动文件 | 无 | ✅ | 会话滚动内容末尾（最后一条可见消息之后）显示「已回退到此处 / 撤销回退」，随历史一起滚动，不固定在输入框上方；`canUndo` 由新用户消息事件判定；文件保持回退后的状态 |
| 56 | 会话内图片弹窗与缩略图 | 工具调用摘要行/分组行右侧显示缩略图，图片名和缩略图都可点开原图；消息里的图片文件链接也开原图弹窗，不打开右侧抽屉 | 工具行只有文件名，点击走右侧文件预览；交付图片卡已单独拦截 | ✅ | 新增 `features/image-preview`：在 `conversation.view` 入口统一拦截 `openFile`，图片改开原生 `ImageLightbox`；`read`/`read_image` 工具行、`turn-process` 折叠摘要行、`[data-step-process]` 分组行显示文件名 + 32px 缩略图；同一轮图片登记一次，主屏/分屏共用；非图片仍开右侧抽屉 |
| 57 | 图片预览的统一观感 | 所有会话内图片入口用同一个弹窗；改一次背景/遮罩，原生消息图片、输入框附件、工具行缩略图、交付图片一起变 | 各处各自实现，交付图片卡单独建灯箱 | ✅ | 唯一 `openImagePreview()` store + 唯一 `shell.overlay` 宿主；`skin.css` 的 `--ct-image-preview-mask` 通过 `[role=dialog]:has(> div > img)` 同时命中原生 `ImageLightbox` 和插件弹窗；调用方只传 `{path, src, name}` |
| 58 | 会话名后的操作下拉 | 会话标题后一个下拉按钮，菜单里含「打开方式」与会话导出/反馈等动作 | DSH 原生把「更多」（复制 Markdown / 下载日志 / 反馈）与「打开方式」放在 header 右上角 utilities：前者来自 `dsh-session-log-export` 的按钮+菜单，后者来自 `dsh-client-ui-open-in-app` 的分裂按钮 | ✅ | 新增 `features/conversation-header-menu`：在 `conversation.session.header.actions`（标题旁）注册下拉按钮；菜单项复用原生能力（`api/session.markdown`、`sessionLogDownload`、`feedbackUi`）；打开方式的应用清单来自宿主 `open-in-app/apps`、动作 POST `open-in-app/open`，文案复用原生 `session-log-download`/`open-in-app` 字典；原生 utilities 的 ⋯ 与打开方式按钮用 CSS 隐藏；「删除会话」仍未做（DSH 无删除 API） |
| 59 | 会话名就地编辑 | 会话 header 顶部的会话名可点击改名；Enter/失焦保存、Esc 取消 | 标题是纯文本 span，重命名入口只在侧栏行菜单 | ✅ | 未在 Claude Code 内复现，按通用 inline edit 标准实现（点击进入、自动全选、Enter/失焦保存、Esc 取消、空值/未改动不提交）； 新增 `features/conversation-title-edit`：点击标题在原生位置覆盖内联输入框（同字体同高度、自动全选），保存走原生 `session.rename`，标题/侧栏/分屏同步；空标题、未改动、输入法组合期间不提交；只接管普通会话标题（subagent 自绘标题不接管）；分屏每个 pane 各自独立；编辑时标题旁的会话菜单下拉按钮暂时隐藏、失焦/取消后恢复；桌面端只让出标题文字这一小块窗口拖拽区 |
| 60 | 项目分组拖拽排序 | 侧栏按项目分组时，拖动项目标题可调整项目在列表中的先后；拖动中显示插入线，松手后整组会话跟着移动 | 原生支持 `workspaces.insertBefore`，自绘列表此前没有接 | ✅ | 只在 `groupBy === 'folder'`、真实工作区（非置顶/分区/未分组）上启用；拖动标题行（按钮除外）时按分组上下半区显示插入线；落点写 `workspaces.insertBefore(workspaceId, anchorId)`，刷新后保持；会话本身不可拖拽排序 |
| 61 | 分组头按钮与提示 | 项目/分组标题悬停显示 ↑↓「分组和排序」和「新建会话」两个按钮，提示是深色气泡，且不会被列表区域遮挡 | 自绘分组头原有漏斗图标 + 新建按钮 | ✅ | 改为 ↑↓ 图标；提示改用原生 `Tooltip`（`side: 'top'`、`portal: true`，浮层挂到 body，`position: fixed`、`z-index: 1100`），不再用 `::after` 伪元素，因此不会被滚动容器裁剪或被下一分组盖住；点击仍打开分组依据/排序方式/显示菜单；新建按钮不变 |
| 62 | 滚动列表上下分隔线 | 侧栏会话区离开顶部时出现顶部分隔线，回到顶部消失；底部分隔线常驻；分隔线属于滚动容器而不是某一行 | 自绘列表没有 | ✅ | `installSidebarShell` 监听真正的 `[data-ct-sidebar-scroll]`，滚动位置 > 0 时给侧栏根加 `data-ct-sidebar-scrolled`；顶部 1px 透明边框只换颜色，底部 1px 边框常驻，避免滚动时布局跳动；颜色用 `--dsw-alias-border-l1` |
| 63 | 侧栏滚动条可见性 | 侧栏使用 8px 滚动条；拇指为 20% 墨色，悬停提到 35%，两端圆角；轨道接近透明 | DSH 全局 5px 滚动条，拇指用很浅的 scrollbar token，侧栏内几乎看不见 | ✅ | 侧栏滚动容器覆盖 `--dsh-scrollbar-width: 8px`、`--dsh-scrollbar-thumb-border: 1px`，拇指色由皮肤 `--ct-wb-scrollbar-thumb`（20% 墨色）/`--ct-wb-scrollbar-thumb-hover`（35%）提供，缺皮肤时回退 DSH 滚动条令牌；实测 6px 可见宽度，与 Claude 截图一致 |
| 65 | 会话壳与分屏解耦 | Claude 的多窗格是独立会话 pane，pane 内逻辑不感知窗格位置 | 无（分屏此前用原生 main + overlay 两套渲染） | ✅ | 每个会话一个 `SessionShell`（`SessionProvider → main.conversation + rightbar.session`），分屏只输出壳 rect；`rightbar.session` 的 `syncPresentation`/`openTab`/`splitPane`/`toggleFullscreen` 等窗口级注入全部 no-op，右栏宽度由壳内 store 决定；主壳会话用 split 的 `nativeSessionId` 与窗口 `mainView` 解耦，聚焦壳时同步窗口选中会话，快捷键按选中屏工作；旧 overlay/frame 渲染代码已删除 |
| 64 | 后台任务入口与面板 | Claude 应用在右上角 view menu 勾选「后台任务」，内容进右侧 side pane；任务按运行中/已完成分组，可展开输出、停止、清空已完成 | 原生把 jobs 触发器放在会话 header actions（会话名旁），下拉里是任务列表 | ✅ | 新增 `conversation-side-panel/jobs-panel.js`：自绘右栏 tab（`kind: ct-jobs`），**不声明 `guide`**，所以不进 header 入口条，只从会话 header 最右「更多」进入；「更多」常驻，菜单 = 后台任务 toggle + 溢出的右栏入口；数据/动作走 `ctx.jobs`；原生 header jobs 触发器按 slot 注册项 id `job-list` 渲染为 `null`。未做：Claude 的 task chip / loading indicator 入口、子智能体作为 tasks pane 内子视图 |
| 71 | 新会话页的右栏入口 | Claude 新建会话、还没发第一轮时，右上角就有一排面板入口（终端 / 浏览器 / 文件…），不需要先提交消息 | DSH 把「新会话」做成 blank session（有 sessionId），但 `conversation.header` 在 blank 阶段给 `conversation.session.header` 传 `hideChrome: true`，只渲染 corner，utilities 入口条不出现 | ✅ | `conversation-side-panel` 包装 `conversation.session.header.corner`：订阅 `sessions.list`，会话仍是 blank 时在 corner 渲染同一套入口条（`variant: 'blank'`）；后台任务等必须绑定会话内容的入口不渲染；「更多」只在入口溢出时出现；提交第一轮后 blank=false，入口条自动回到原生 utilities。真正的无会话 hero（冷启动未选工作区 / 归档当前会话）没有 corner，不渲染入口条 |
| 72 | 右栏控件尺度统一 | 面板头、tab chip、图标按钮和弹出菜单与 header 入口按钮同一套观感（尺寸/字重一致） | pane 头 36px、tab 12px/400/26px、图标 13px，菜单行 32px/400，和 header 入口（30px、20px 图标）不一致 | ✅ | pane 头 43px；tab 30px 高、13px/500、16px 图标、圆角 8；图标按钮 30px、18px 图标；溢出菜单行 36px、13px/500、18px 图标、最小宽 220；jobs 面板的分区/停止/复制按钮同步放大。菜单 portal 到 body，尺寸写死（不依赖 `.ct-sp-root` 变量），颜色仍只用 DSH 令牌 |
| 44 | 分屏 pane 右栏归属 | 分屏 pane 的右栏应取该 pane 自己 session 的状态；原本开就开、原本关就关；主屏状态不串 | 无 | ✅ | 去掉强制 `setExpanded(false)`；seat 只 materialize；每个 pane 用自己 sessionId 的 rightbar store；0.2.2 实测 A/B 两边各自保持自己的右栏状态 |
| 43 | 分屏右栏全屏后收起 | 右栏全屏后收起侧栏，pane 应恢复显示会话主内容 | 无 | ✅ | 全屏 fill/hide 的 `:has` 选择器要求 `data-ct-overlay-rightbar-open="true"`；收起后 conversation 恢复 `display:flex`，右栏宽度归零 |
| 42 | 分屏右栏归属与关闭入口 | 分屏 pane 的右栏取自己 session 的状态；关闭按钮在右上角最右，只在分屏出现，所有分屏屏都有 | 无 | ✅ | 不做全局默认收起，右栏状态跟随各自 session；关闭按钮包进原生 header corner（右栏开关之后）；`closeSession` 统一：overlay 关 pane，分屏 native 没有可删 pane 时走和「新会话」同一个入口；单屏不渲染关闭按钮 |
| 65 | 侧栏开关固定位置 | 开关在窗口标题栏最左（macOS 交通灯之后），侧栏展开/收起时位置不变；`⌘B` 切换 | 展开时在侧栏右上，收起时在 `shell.leading`（left 88）；两处不是同一 DOM | ✅ | 新增 `features/window-chrome`：固定 chrome 注册进 `shell.overlay`，portal 到 body，left 88/top 11（全屏/Web left 12）；原生 `[data-sidebar-toggle]` 只隐藏不删，`[data-shell-leading]` 隐藏；Web 实测展开/收起/抽屉三种状态的按钮 rect 都是 `{x:12,y:11,w:100,h:28}`；桌面窗口待安装后复验 |
| 66 | 顶栏后退/前进（导航 undo/redo） | 顶栏 `<` `>` 是导航历史 Back/Forward（`⌘[`/`⌘]`），无历史时置灰 | 没有导航历史，也没有按钮 | 🟡 | 记录主视图会话（`retainedBy.mainView`）；用户切换入 back、清空 forward；后退/前进调用 `uiWorkspace.openSession`；用 pending 抑制程序性切换；目标不存在时跳过。Web 实测 A→B→C 后 back 两次到 A、forward 两次回 C，栈分别为 back 2/1/2/3、forward 1/2/1/0，按钮置灰同步；未接快捷键，桌面待复验 |
| 67 | 抽屉与顶栏按钮解耦 | 左侧抽屉开合不影响顶栏开关与导航按钮 | 抽屉打开时 `shell.leading` 被 inert，抽屉列 z-index 71、遮罩 70 会盖住顶部 | ✅ | chrome 在 body、z-index 90，只按钮区域可点；700px 视口实测抽屉开/关时按钮位置不变，`elementFromPoint` 命中 chrome 按钮而不是遮罩；抽屉开关统一由 chrome 的开关调用 `ctx.layout.toggleSidebar()` |
| 68 | 收起后 hover 浮出侧栏 | 用户要求的「悬浮弹出、不占位、离开收回」；Claude 运行窗口的实际 hover 未实测（辅助访问权限被拒） | 桌面收起列宽 0（无 rail）；Web 收起是 56px 图标 rail；没有浮层 | ✅ | 包装 `sidebar` 入口，peek 打开时覆盖 `collapsed:false / width:280`；CSS 把原生侧栏列临时 `position:absolute; left:0; width:280; z-index:60`，列宽不变、主内容不位移。浮层背景用 `--dsw-specific-sidebar-fill` 实底，压过 darwin 的 vibrancy 玻璃，不会透出主内容。Web 端收起列宽压成 0（`window-chrome/rail.js`，React 重写 grid 后再压），与桌面一致。1120px 实测收起 0 → peek 280 实底 → 收起 0，frame grid 始终 `0px 1140px 0px`、主内容 x 不变；离开开关/浮层后 120ms 收回（倒计时只在离开那一下启动，指针继续在外部移动不会延长；60ms 内回到浮层会取消），Esc 与指针离开窗口立即收回；900px 自动收起与 700px 抽屉都正常。未做滑入动画（实测 ego 动画时间线会把首帧停在 -100%），当前是瞬时弹出 |
| 69 | 右栏面板最大化 | 面板头上的最大化让当前面板铺满整个会话区域、盖住会话历史，再次点击还原；分屏时只铺满所在 pane | 无右侧面板 | ✅ | `conversation-side-panel` 自绘最大化/还原按钮，按会话持久化；`.ct-sp-root[data-ct-sp-maximized]` 作为功能间 DOM 契约，`workspace-browser.css` 用 `.ct-shell:has(...)` 把该壳的右栏容器改为绝对定位铺满、主区 `visibility:hidden`（保留 DOM 与滚动位置），左侧列表与其它分屏壳不受影响；还原后恢复原宽度与分栏。3099 隔离宿主实测单屏、双 pane、overlay 分屏、刷新恢复、还原。最大化时原生 header（含分屏关闭按钮）被盖住，需先还原面板再关闭分屏 |
| 70 | 深浅两套主题的皮肤适配 | Claude 桌面端深色主题下，侧栏分组图标、展开 chevron、行操作按钮、时间戳、描边和悬停底色都按深色底给值，不会沿用浅色的墨色 | DSH 用 `body[data-ds-dark-theme]` 切换整套 `--dsw-*` 别名令牌 | ✅ | 皮肤所有文字/描边/悬停令牌都从 `--ct-ink` 派生（`color-mix`），深色块只按深色底重算 alpha；功能层不引用 DSH 没定义的令牌（`label-quaternary`/`label-error`/`bg-elevated`），菜单阴影与错误文本也走令牌。回归测试 `test/theme/theme-adaptation.test.mjs` 守着这两条；深色下输入框/问答卡（DSH 原生 `QuestionComposer`）的抬升面也按画布重算，修复「卡片与页面同色」 |

## MCP 工具加载

| # | 能力 | Claude Code 行为 | DSH 现状 | 插件状态 | 备注 |
|---|---|---|---|---|---|
| 1 | MCP 连接层 | Claude 自己拉起/重连 MCP server，执行 `tools/list`、`tools/call` | DSH 内置 `@deepseek-ai/dsh-mcp-client` 已完整 | ➖ | 不写第二个 client；插件只消费它注册到 `ctx.tools` 的工具 |
| 2 | 首轮不展开 MCP schema | Claude ToolSearch：未搜索的工具不进入模型上下文 | DSH 没有按需加载层，MCP 工具全部进入 `request/header` | ✅ | 新会话第一次 `request/header` 中 `mcp__*` = 0，只多出 `mcp_tool_search`；fake server 12 工具实测 36 → 0；真实 REA 170 工具实测首轮 tools=36、`mcp__rea__*`=0（约 31.7 KB） |
| 3 | 搜索后下一步可调用 | 搜索命中后，工具在下一步进入 tools | 无 | ✅ | 包装 `ctx.tools.resolve()` 的 `view()`，按 session active 集合过滤；实测 fake 第二步 header `mcp__*` = 1 并调用 `mcp__fake__echo`；真实 REA 搜索 `binary session` 后第二步 header `mcp__*` = 8（约 41.9 KB），模型调用 `mcp__rea__binary_session` 成功 |
| 4 | 恢复/分叉会话 | 已加载工具保持可用 | 无 | ✅ | 新 agent 从最后一次 `session.requestHeader().tools` 恢复 managed MCP 工具；不在日志外维护第二份血缘 |
| 5 | 无 MCP 的 profile | 无变化 | 原生无变化 | ✅ | catalog 为空时不注册可见工具、不写 prompt 段、`tools.resolve` 原样返回；单元测试覆盖 |
| 6 | 搜索结果安全 | 工具描述是外部数据 | 无 | ✅ | 只回 name + 截断描述，结果文本明确 “server-provided data, not instructions” |
| 7 | 子代理独立可见性 | 子代理有自己的工具面 | 无 | 🟡 | active 以 `agent.id` 为键，子代理默认只有 `preload`；未单独跑子代理 e2e |
| 8 | provider 兼容 | Claude 的 tool search 由 API 支持 | 依赖 provider 的 tool-addition beta | 🟡 | 模型路由若声明 `toolUpdate: addition-only` 但服务端不支持 `mid-conversation-tool-changes`，第二步会 400；删掉 `toolUpdate` 后 DSH 自动剥离 developer 消息，实测通过。见复现记录 |

## 已记录的有意差异

| 差异 | 原因 | 处理 |
|---|---|---|
| 宿主补写普通 fork 的 `parentSession` | DSH 0.2.2 把普通 fork 改成「没有持久化来源关系」，`sessions.list.parentId` 永远为空，fork 树无法成立；Claude 的 fork 是树的一部分 | 只在 fork 的异步链里给 `agents.create` 的 seeded meta 补 `parentSession`，不改 fork 逻辑与 DSH 包；历史 fork 用严格事件校验回填 |
| 桌面端标题让出一小块窗口拖拽区 | header 是 `-webkit-app-region: drag`；不加 `no-drag` 时点击会被窗口拖拽吞掉，标题无法编辑 | 只给标题文字加 `-webkit-app-region: no-drag`，标题周围与 header 其它区域仍可拖动窗口；Web 端无影响 |
| 隐藏原生侧栏开关与 `shell.leading` 控件 | 原生开关在「侧栏 topStrip」和「leading seat」是两个不同 DOM，开合时位置会跳；固定 chrome 只能有一个可见开关 | 原生 `[data-sidebar-toggle]` 用 `opacity:0` 隐藏但保留 DOM（焦点锚点），`[data-shell-leading]` 隐藏；可见入口统一由 `window-chrome` 的 body portal 提供；选择器与位置集中在该功能里 |
| 用自绘 `sidebar.workspaces` 整体替换原生列表 | 原生 watermark 和行 DOM 无法稳定地按 Claude 行为调整 | 直接消费 sessions/workspaces 服务；不再点原生按钮，也不再有「展开其余」 |
| 隐藏会话 header 右上角的原生 ⋯ 与打开方式按钮 | Claude 的会话操作入口在标题旁，而不是右上角；两个原生按钮都是 DSH 自带插件自绘在 utilities，没有可撤下注册的公开 API | 用 CSS 隐藏这两处 utilities（只命中 `header[data-window-drag]`），新菜单复用同一组原生行为与数据；文件树/会话行/右栏的打开方式不受影响 |
| 工作区重命名/删除使用 `prompt/confirm` | 第一阶段先打通操作入口；原生对话框尚未迁回 | 下一步换成自绘确认框 |
| 列表目前只覆盖核心操作 | 原生重命名对话框、部分状态、第三方 slot 仍待迁 | 见 README「已知限制」和「下一步」 |
| Web 收起态不保留原生 56px 图标 rail | 原生 rail 是「没有窗口开关」的平台在收起侧栏后的唯一入口；本插件已在 Web 上提供同一个固定开关和 hover 浮层，rail 成了多余的一列，和桌面端不一致 | `window-chrome/rail.js` 在非 darwin / 非 Windows 标题栏平台把 frame 内联 `grid-template-columns` 的第一段轨道压成 0，React 重写内联样式后再压一次；功能关闭或插件卸载时还原成 React 写的值。抽屉模式（`data-sidebar-drawer`）不动 |
| 第三方 session slot 暂时不能复用 | shadow `sidebar.workspaces` 后再声明其子 slot 会被 DSH 判为 `slot already declared` | 自绘菜单先覆盖核心动作；等 DSH 支持 shadow 父组件继承 children 声明 |
| 工具摘要行保留 DSH 的「已完成 / 已读取图片」文案 | DSH 的 `turn-process` 是通用过程摘要，改成 Claude 的「已读取 N 个文件」会侵入 DSH 自己的过程语义 | 文案不动；在「已完成」摘要行和「已读取图片」分组行右侧补文件名 + 缩略图，点击统一弹窗 |
| 每个 overlay 通过捕获 main/rightbar 入口的 renderSlot 渲染完整原生主屏 | DSH 公开的 `main` 是 keyed single slot、右侧栏是单个 root 列；但 `main` 入口组件的 props 里带有 `main.conversation` 的 renderSlot 绑定，`rightbar` 入口组件带有 `rightbar.session` 的绑定；在任意 SessionProvider 下调用时，SlotOutlet 会按当前 scope 重新解析 | 包装入口捕获绑定，为每个 overlay 渲染完整 `main.conversation` 子 slot + `rightbar.session`；per-session store/tab；overlay 会话的 `syncPresentation`/`openTab`/`splitPane`/`toggleFullscreen` 改 per-session；这不是稳定 API |
| 分屏时所有 pane 的右栏统一 240px，全屏只填当前 pane | 多个 seat 同时汇报窗口 layout 会互相打架；pane 宽度有限，240px 让左/右的内部布局一致 | 原生和 overlay 右栏都 240px；分栏/全屏/收起都保留；全屏用 per-session mode 填满当前 pane；收起/展开由原生 header ExpandButton 管理 |
| overlay 右栏的 tab 右键菜单/全局右栏快捷键不保证 | 这些入口仍绑定窗口级 `views`/controller 的 mounted session，overlay seat 不在 SessionViews 里 | 主要交互（打开文件/终端/浏览器、关闭 tab）走 seat 自己的 per-session action；其余等 DSH 公开 per-session surface |
| 分屏时原生右栏 240px，隐藏原生右栏全屏按钮 | 原生屏要同时放会话和右栏；原生右栏全屏会盖住整个分屏 | 原生右栏收起/展开继续可用；overlay/native bottom 右栏的全屏只填自己的 pane；退出分屏恢复原宽度和位置 |
| 原生屏固定在左/上 50%，默认只上下再拆 | 原生屏是 AppFrame 的 main+rightbar，右侧栏必须留在它的子 rect 里 | 原生左屏可拆出 native bottom（左栏上下两屏）；右侧 overlay 全关后左屏变整宽上下两屏，此时可从左上屏右缘再加回右侧一屏；最多 4 屏 |
| 关闭按钮包进原生 header corner | 原生主屏没有 pane close；关闭需要同时处理右栏和会话/pane，且要在最右侧 | 包装 corner 的 ExpandButton，在原按钮后渲染关闭按钮；所有屏幕都有；单屏关闭到同项目新会话；分屏右栏开着先关右栏，右栏关掉后关 pane/native 屏关闭到新会话；原生 header 其它按钮保留 |
| 文件/终端不能作为独立分屏 | DSH 的右栏 dockkit 只接受 tab body，不接受会话，也没有 main 里的通用 dock | 文件/终端仍在原生屏右栏 |
| 同一会话不重复出现在两个分屏 | 同一会话的输入 shell 与草稿只有一份，重复挂载会互相干扰 | 拖拽或点击已打开的会话时只聚焦已有分屏 |
| 后台任务改从会话 header 最右「更多」进入，并屏蔽原生 header 触发器 | Claude 的入口在标题栏 view menu/按钮，DSH 原生入口是会话名旁一个触发器 + 下拉，没法和「更多」统一；需求明确只从「更多」进入 | 右栏 tab 不注册 `guide`；原生 `job-list` 注册渲染为 `null`（按 slot entry id，不猜 DOM）；任务数据/动作仍走 `ctx.jobs`，不复制一份状态 |
| 新会话入口条包进原生 header corner | blank 阶段 `conversation.session.header` 的 title/actions/utilities 全被 `hideChrome` 关掉，只有 corner 仍然渲染；就地复用 corner 不新增 header 行，也不改原生布局 | 包装 corner 注册项：先渲染原生组件（右栏开关 / 分屏关闭），再在会话 blank 时追加入口条；用 `cornerState.live` 防止 HMR 旧包装重复渲染；正常会话里追加部分渲染 `null` |
| 空白会话不提供后台任务入口 | 后台任务天然绑定某个会话的运行记录；新会话窗口在用户看来还没有会话上下文，需求明确按「不支持」处理 | toolbar 的 `variant: 'blank'` 不渲染 jobs 菜单项、也不订阅该会话的花名册；等提交第一轮（blank=false）后随 utilities 入口条一起出现 |

## 安全护栏

Claude Code 用「硬编码判定 + 受保护路径 + 分类器」三层挡住危险操作，其中前两层是确定性的，分类器无权放行。
本插件在 DSH 里补的是同一角色的确定性层：命中规则直接拒绝，审批与 auto-review 都翻不了案。

判定口径对照本机 Claude Code 2.1.322（`~/.local/share/claude/versions/2.1.322`，Bun 单文件）里的
错误消息与正则表，逐条对齐；对不上的地方在表里如实标出。

| # | 能力 | Claude Code 行为 | DSH 现状 | 插件状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 关键路径删除 | 目标是 `/`、`~`、工作目录及其上级、盘根、挂载盘时**要求显式批准**；任何 allow 规则与 hook 都批不了 | 无 | ✅ | 判定走 `tools/pre-execute`（链首）；命中后向用户要一次 `allowed-once`，批准只对那次调用有效。`tools.guard` 保持单调兜底，只放行刚被批准的那一次；目标先解析真实路径，符号链接绕不过 |
| 2 | 系统目录子树 | `rm -rf /etc/passwd`、`/System/Library` 与删 `/etc` 同等对待 | 无 | ✅ | 系统目录按整棵子树判；`/tmp` → `/private/tmp` 等临时目录例外 |
| 3 | 顶层目录 | 根下一层路径算关键路径 | 无 | ✅ | `/^\/[^/]*$/` |
| 4 | 挂载盘范围 | `/Volumes` 0–2 层、`/mnt/x` 与 `/mnt/c/x`、`/media` 0–3 层 | 无 | ✅ | 用它的范围，不是简单的单层前缀 |
| 5 | 变量正向证明 | 只拦「能证明变量为空时会落到 `/` 或顶层目录」的目标；`${VAR:?}`、`${VAR:-def}`、同命令内赋值都放行 | 无 | ✅ | 见下「变量语义」；这是误报率的关键 |
| 6 | 命令替换输出 | 目标来自 `$(...)`／反引号时拒绝 | 无 | ✅ | 执行前拿不到值，无法证明安全 |
| 7 | 命令替换数量 | 超过阈值时按「无法分析」拒绝（`tooManySubstitutions`） | 无 | ✅ | 阈值 8；另有嵌套深度上限 8 |
| 8 | 提权与命名空间 | `sudo`/`unshare`/`nsenter`/`pkexec`/`runuser`/`su` 之后继续判；带值选项（`-u root`、`-t 1`）要跳过 | 无 | ✅ | 之前漏跳过带值选项，命令名被吃掉导致整段判定失效 |
| 9 | 内联脚本 | `bash -c`／`-lc`／`-ec` 的脚本文本要再判一次 | 无 | ✅ | 只对 shell 递归；`python -c`／`node -e` 不递归（见差异表） |
| 10 | 函数定义 | 函数体在调用时执行，要判到 | 无 | ✅ | 取 `{ ... }` 内容递归，嵌套上限 4 |
| 11 | 变量赋值成命令 | `X=rm; $X -rf ~` 这类 | 无 | ✅ | 判定为 `rm-via-variable` |
| 12 | `trap`／`eval` | 字符串里的删除命令 | 无 | ✅ | `trap "$(rm -rf ~)"` 拦；`eval` 的内容递归判 |
| 13 | `IFS` 改写 | 出现 `IFS` 赋值时按解析不可信处理 | 无 | ✅ | 涉及删除才拦，普通 `IFS=/ && ls` 放行 |
| 14 | shell 选项 | `set -o`／`bash -o` 改变展开行为（`dotglob`/`globstar`/`nullglob`/`noglob`/`posix`…）时保守 | 无 | ✅ | bash 收到合法字符集之外的短选项也拦 |
| 15 | 超长／控制字符 | 命令过长的字符集歧义按「无法静态验证」处理 | 无 | ✅ | 阈值 8000 字符 |
| 16 | Windows／Git Bash 路径 | 纯反斜杠是盘根；盘符根与 Windows 系统目录直接拒 | 无 | ✅ | macOS 上同样判，宁可保守 |
| 17 | PowerShell | `Remove-Item` 系列打盘根、`$env:USERPROFILE`、`$HOME` 直接拒 | 无 | ✅ | `pwsh` 走独立判定，不与 POSIX 规则混用 |
| 18 | 受保护路径 | `.git`、`~/.zshrc`、`~/.ssh`、`.mcp.json` 等即使在工作目录内也绕不过 | 无 | ✅ | 同时覆盖 bash 重定向、`tee`/`cp`/`mv`/`install`/`ln`/`rsync`、`sed -i` |
| 19 | 强制推送与历史改写 | 分类器处理（`soft_deny`） | 无 | ✅ | 本插件写死：`git push --force`、`git clean -fdx`、`git filter-branch`、`rsync --delete`、`terraform/pulumi/cdk destroy`、`curl \| bash`、`dd of=/dev/*`、`mkfs` |
| 20 | 分类器替代审批 | 两阶段 transcript classifier | DSH 有 `dsh-experimental-auto-review` | ➖ | 本插件排在它前面：命中即短路，它不会被调用；未命中才交给它 |
| 21 | 连续拒绝后降级 | 分类器拒绝超限时 `falling back to prompting`；连续拒绝提示看 transcript；`denyInsteadOfPrompting` 下 `ending the turn` | 无 | 🟡 | 连续 5 次拦截在审计状态里置位、写 warn 日志、在设置页面板给出提示。**不改变拦截行为**——硬规则按次数放行等于把守卫耗穿；Claude 的熔断也是「回落到人工/停止」而不是放行 |
| 22 | 「最近被拦」面板 | Recently blocked 列表 | 无 | ✅ | 设置页「安全护栏」只读列表，数据来自审计路由 |
| 23 | 附加工作目录 | 保护「工作目录 + `--add-dir` 的附加目录 + 它们的上级」 | 只有单个 `workspaceRoot` | ⬜ | **DSH 没有附加目录的概念**，无法等价实现；当前保护 cwd 及其所有上级 |
| 24 | OS 沙箱兜底 | bubblewrap／seatbelt 限制文件与网络 | 依赖 DSH 沙箱；`auto` 预设下是 full access | ⬜ | DSH 的 `auto` 固定 full access，沙箱不是本插件能改的 |
| 25 | 解析失败的命令 | 只在「危险删除分析无法完成」时升级为显式审批（`the shell may read it differently than it was parsed`）；普通命令照常走权限流 | 无 | ✅ | 引号不平衡本身不触发审批；只有文本里出现危险动作（删除类命令、受保护路径、提权、内联/远程脚本、`xargs`、破坏性 git、递归改权限）才按「无法确认」要授权。依据 Claude Code 2.1.322 的 `parseForSecurity` / `hasParserLexingDifferential` 与 `This requires explicit approval` 文案 |

### 变量语义

| 写法 | 结果 | 理由 |
|---|---|---|
| `rm -rf "${DIR:?}"/*` | 放行 | 为空时 shell 报错退出，删除不会执行 |
| `rm -rf "${DIR:-/tmp/build}"/*` | 放行 | 用默认值求值 |
| `DIR=/tmp/build && rm -rf "$DIR"/*` | 放行 | 同命令内赋值可确定 |
| `rm -rf ./$DIR/build` | 放行 | 空展开是 `./build` |
| `rm -rf $DIR/build` | 拦 | 空展开是 `/build`，顶层目录 |
| `rm -rf "$DIR"/*` | 拦 | 空展开是 `/*`，根下通配 |
| `rm -rf "$HOME"/*` | 拦 | 家目录下的通配等于清空家目录 |
| `rm -rf "$(pwd)"` | 拦 | 命令替换的输出执行前拿不到 |

### 开关

设置页「功能」分组里有「安全护栏」开关（默认开启，与其它功能一样只存「被关掉的集合」）。

| 状态 | 行为 |
|---|---|
| 开（默认） | 安装守卫：`tools.guard` + `tools/pre-execute` + 三个 fs 瀑布，命中规则要授权 |
| 关 | **完全卸载**：不判定、不记审计、不拦任何操作，审计路由也一并撤掉 |

部署方还可以用 `dangerGuard.enabled: false` 硬关掉，两者是「与」关系。

关掉开关有个坑值得记：`stabilize` 走 `queueMicrotask` 重排链首，如果「别人注册 pre-execute → 排队重排」与「关掉开关 → 卸载」落在同一 tick，排队的重排会在卸载之后执行、把监听器装回来——表现是路由已经没了、命令却仍然被拦。现在用 `disposed` 标志挡住，并有回归测试。

### 批准语义

命中硬规则不是「无条件拒绝」，而是**要一次显式授权**，与 Claude 的 `requires explicit approval` 对齐：

| 情形 | 结果 |
|---|---|
| 审批策略 `ask`，用户点「允许一次」 | `allowed-once`，**只执行这一次**，不持久、不跨调用 |
| 审批策略 `ask`，用户点「拒绝」 | 拒绝，审计记 `refused` |
| 审批策略 `never`（无人值守 / `-p`） | 不弹窗，自动拒绝（fail closed），并在理由里说明本会话不询问审批与后续出路 |
| 没有审批服务 / 请求抛错 | 按拒绝处理（fail closed） |
| 连续拦截 5 次 | 只在设置页提示，**不放行** |

`tools.guard` 的位置不变：它是审批之后的最后一道闸，只放行刚刚被 `allowed-once` 批准的那一次调用。

### 为什么不为守卫单独做弹窗

never 策略的语义是「需要审批的一律拒绝」，不是「什么都批准」——它比默认模式更严格。
守卫在 never 下拒绝与用户设置一致，不是缺陷。

做一个绕过 approval 服务的自有弹窗技术上可行，但代价是：丢掉 DSH 的审批审计、
自己处理超时与取消、而且一旦开了「插件可以无视用户不要问我」的先例，后面每个
插件都能这么干。无人值守场景（-p、CI）本来也没人点，弹了同样超时。

所以选的是「拒绝 + 讲清出路」：理由里写明本会话不询问审批、可换会话或手动执行，
并提示模型不要重复尝试同一条命令——否则它会换个写法反复重试，刷出一屏拦截记录。

### 与 Claude Code 的差异

| 差异 | 原因 |
|---|---|
| 比它多拦一批非 `rm` 操作（`git push --force`、`git clean`、`curl \| bash`、基础设施 destroy…） | Claude 把这些交给分类器与沙箱；DSH 的 `auto` 预设没有沙箱兜底，只能把确定性边界写死 |
| 不对 `python -c`／`node -e` 的内联脚本递归判定 | 这两种解释器里几乎可以做任何事，静态判定没有意义；强行解析只会把「脚本里恰好出现 `rm` 字样」的正常命令误判成危险操作。Claude 覆盖的也是 shell `-c` |
| `$HOME`／`$PWD`／`$TMPDIR` 用实际值展开，不做空展开 | 这些变量在真实环境里几乎不会为空，空展开会让 `rm -rf "$HOME"/x` 这类正常操作被误拦 |
| 连续拒绝只告警、不结束本轮 | DSH 的工具管线没有「结束 turn」的原语；Claude 的 `ending the turn` 落在它的 agent loop 里。本插件用审计告警 + 设置页提示表达同一件事，拦截行为不变 |
| 不做跨会话的「永久放行」授权 | Claude 有 permission rules 让用户显式加白；本插件没有规则层，绕过方式只能是改配置或改代码 |

## 复现记录

### 深色下问答卡与输入框贴平背景（2026-11-10）

- 现象：深色下问答卡（插件提问后出现的选项卡）和底部输入框看不清，卡片与页面几乎同色，只有文字浮着。
- 归属判断：组件是 **DSH 原生**的（`ui-user-questions` 的 `QuestionComposer` / `AskQuestionCard`），不是插件渲染的；但数值是我们的皮肤造成的——卡片底面是 `--dsw-specific-input-major`，DSH 深色给 `#2c2c2e`，那是按近黑画布 `#151517` 算出的 23 级抬升；皮肤把画布换成 Claude 的暖灰 `#262624` 后，同一个值只剩 6 级。
- 修复：深色块把 `--dsw-specific-input-major` 按画布重算：`color-mix(in srgb, var(--ct-ink) 11%, var(--ct-canvas))` ≈ `#3d3c3a`；浅色显式保持 `#ffffff`（与 DSH 原生一致），浅色观感不变。
- 验证（独立 `DSH_HOME=/tmp/dsh-theme-audit` + web profile 副本，插件 link 到工作树，端口 55792，ego-browser）：
  - 深色实测：页面 `rgb(34,34,33)`、输入框 `rgb(53,53,51)`（修复前 `rgb(39,39,41)`，差 5 级 → 19 级，DSH 原生 23 级）；用与卡片同款 chrome（`input-major` 底 + `--dsw-elevation-panel` 阴影 + `--dsw-elevation-stroke-color` 细描边）的探针复核，卡片与页面同样差 19 级。
  - 浅色实测：`--dsw-specific-input-major: #ffffff`，输入框/页面观感与修复前一致（`elev-final-light.png`）。
  - 证据：`/tmp/dsh-theme-audit/shots/elev-final-dark.png`、`elev-final-probe.png`、`elev-swatches.png`（8%/11%/14% 三档对比）、`elev-final-light.png`。
- 未验证：真实问答卡只在桌面端由提问触发；本次用同款 chrome 探针 + 令牌实测覆盖，未在隔离实例里真跑一次提问。

### 深色主题下分组图标 / chevron / 操作按钮消失（2026-11-10）

- 现象：深色主题下侧栏分组头只剩分组名。文件夹图标、展开 chevron、「分组和排序」↑↓、「新建会话」+ 几乎看不见；切回浅色正常。
- 根因：皮肤在共享块里把 4 个 DSH 别名令牌写成了**浅色绝对色值**，深色块没有重新声明，深色主题继续解析成浅色墨色：
  `--dsw-alias-label-tertiary: rgb(95 93 85 / 72%)`、`--dsw-alias-label-caption: rgb(95 93 85 / 62%)`、
  `--dsw-alias-border-l2: rgb(20 20 19 / 16%)`、`--dsw-alias-interactive-bg-hover: rgb(20 20 19 / 5%)`。
  实测深色侧栏底 `#1f1e1d`：分组图标 1.9:1，chevron 叠加 0.6 透明度后 1.4:1（浅色分别是 3.1:1 / 2.1:1）。
- 顺带查出的同类问题（全插件 CSS 审计 11 个文件、38 个 `--dsw-*` 引用）：
  - `conversation-header-menu.css` 引用了 DSH 0.2.2-rc.1 **根本没有定义**的 `--dsw-alias-label-quaternary`、`--dsw-alias-label-error`、`--dsw-alias-bg-elevated`，深色下一直吃浅色回退值：禁用项近乎不可见、危险项是暗红 `#b3261e`。DSH 自己的包里也有同样的悬空引用，所以不能靠「DSH 用了就存在」推断。
  - `side-panel.css` 的入口菜单用 `--dsw-alias-bg-overlay`：浅色 `#e9ecf2` 尚可，深色是 `#61666b` 中灰，浮在近黑界面上突兀；插件其它菜单都是 `bg-layer-1`。
  - 两处菜单阴影写死 `rgba(20, 20, 19, …)`（`side-panel.css`、`conversation-header-menu.css`），分屏错误边界写死 `#cf222e`（`workspace-browser/index.js`）。
  - 皮肤定义了侧栏底色 `--ct-sidebar`，却没接到 DSH 的 `--dsw-specific-sidebar-fill`，侧栏实际一直是 DSH 的冷灰（浅色 `#f9fafb`），Claude 的暖色侧栏从未生效。
- 修复：
  - 皮肤改成「一套色相、两档 alpha」：`--dsw-alias-label-tertiary/-caption`、`--dsw-alias-border-l2`、`--dsw-alias-interactive-bg-hover` 一律 `color-mix(in srgb, var(--ct-ink) N%, transparent)`，墨色在深色主题翻白，令牌跟着翻；浅色 48% / 39% / 16% / 5%（与修复前观感一致），深色块按深色底重算 56% / 44% / 18% / 8%（对应 5.6:1 / 4.0:1 / 1.6:1 描边 / 8% 悬停底）。
  - 侧栏底色接上 `--dsw-specific-sidebar-fill: var(--ct-sidebar)`（浅色 `#f0eee6`、深色 `#1f1e1d`）。
  - 功能层换用真实令牌：`label-caption`（禁用项）、`state-error-primary`（危险项 / 错误文本）、`bg-layer-1`（header 菜单抬升面、入口菜单）、`bg-mask-1`（菜单阴影）、`--ds-font-family-code`（后台任务输出等宽字体，跟随用户的代码字体设置）。
  - 新增回归防线：`test/theme/theme-adaptation.test.mjs`（4 条断言）+ `test/theme/dsh-tokens.json`（DSH 0.2.2-rc.1 的 416 个 `--dsw-*` 快照）。断言：插件引用的 `--dsw-*` 必须真实存在；皮肤共享块里的绝对色值必须在深色块重新声明（或进 `BOTH_THEMES` 白名单并写理由）；深色块不能有孤儿令牌；皮肤不能凭空声明 DSH 别名令牌。用修复前的文件跑会精确点出这 4 个令牌，用修复前的中文 header 菜单 CSS 跑会点出 3 个悬空令牌。CI 已加跑 `test/theme/*.test.mjs`。
- 验证环境：独立 `DSH_HOME=/tmp/dsh-theme-audit` + `web` profile 副本（插件 `link:` 到工作树），端口 55791；分别以 `preference: dark` / `preference: light` 真实启动两次，ego-browser 1120×867。证据在 `/tmp/dsh-theme-audit/shots/`：
  - 深色修复前/后裁剪对比 `crop-before-dark.png` / `crop-after-dark.png`：分组文件夹图标、chevron、当前行 `…` 从不可见变为可见；computed 值 folder/chevron `rgba(245,244,239,0.56)`、caption `0.44`、`border-l2` `0.18`、`hover` `0.08`。
  - 深色逐面：分组「分组和排序」菜单（`bg #232324`、边框 18% 墨、文字 `#f5f4ef`、阴影 `rgba(0,0,0,0.5)`）、会话行菜单、会话 header「更多」菜单、CodeMode 设置页、右栏后台任务面板（面板底 `#262624`、空态文字 `#b7b5ad`）、「查看全部」页、重命名 dialog、悬停预览卡、路径 Tooltip。
  - 浅色：同一批界面重跑全部正常；侧栏底色实测 `rgb(238,235,227)`（`#f0eee6`），分组图标/chevron/操作按钮、菜单、设置页、右栏面板无回归。
- 未验证：桌面端 vibrancy 玻璃（`data-platform=darwin`）下的实际观感；分屏壳内各 pane 与消息回退弹窗、图片灯箱的深色截图（这些样式只引用令牌，已由静态断言覆盖，但没有逐屏目视）。


### 分屏概念命名统一（2026-11-10）

- 代码重命名（无行为变化）：`NATIVE_PANE_ID`→`ROOT_CELL_ID`（值 `native`→`root`）、`paneId`→`cellId`、`nativeBottomPaneId`→`bottomCellId`、`focusedPaneId`→`focusedCellId`、`overlayTree`→`extraTree`、`panes`→`cells`、`split.pane()`→`split.cell()`、`splitOverlay`/`replaceOverlay`/…→`*Extra*`、`SplitPaneSessionContext`→`ShellCellSessionContext`、cell id 前缀 `pane-`→`cell-`。
- 持久化 JSON 字段仍用 `nativeSessionId`/`overlayTree`/`nativeBottomSessionId`/`focusedSessionId`，兼容已有分屏，避免刷新丢布局。
- 概念命名：Shell（会话壳）/ Cell（壳位）/ Split Layout（分屏布局）/ Shell Grid（壳网格）/ Dock Pane（右栏内部分栏）。
- 验证：独立 `DSH_HOME` + 3099 上分屏（root + cell-1）、拖拽新增/替换、分割线拖拽、壳内右栏拖拽、焦点同步、后台任务面板、刷新恢复；47 个测试通过。主进程 3080 刷新后 root cell 正常。

### 会话壳网格（2026-11-10）

- 隔离开发：`git worktree /tmp/ct-shell-dev`（分支 `feat/session-shell`），独立 `DSH_HOME=/tmp/ct-verify` + 3099 验收；主仓库与主进程在合并前保持旧版。
- 验收：单屏（header/正文/composer/滚动）、原生 rightbar 列为 0、右栏开关（展开按钮→空态右栏→收起）、2/3/4 屏、每屏右栏独立（后台任务/终端）、分割线拖拽比例、关闭主屏壳提升、刷新恢复、每屏「更多→后台任务」、插件页不套壳、壳内标题编辑。
- 焦点同步：点 overlay 壳 → 窗口选中会话切到该壳，native 壳会话不变；`Meta+Alt+P` 打开文件只落在聚焦壳；点 native 壳切回。刷新恢复后窗口选中会话对齐到聚焦屏。
- 删除旧代码后 main slot 曾因 `SplitResizeHandle` 未定义崩溃；`ShellErrorBoundary` 暴露栈后修复。现在 ShellGrid 外保留错误边界用于诊断。
- 未验证：查看全部（`main` key `ct-sessions`）、图片灯箱、消息回退在壳内。

### 右栏面板最大化铺满会话屏（2026-11-10）

- 问题：面板头的最大化此前只在右栏内部隐藏其它 pane、右栏宽度不变，看起来只在右侧那一列里放大。Claude 的语义是当前面板铺满整个会话区域、盖住会话历史。
- 实现：`side-panel.js` 仍负责最大化状态（按会话持久化、渲染单个 pane），`data-ct-sp-maximized` 写在 `.ct-sp-root` 上作为 DOM 契约；`workspace-browser.css` 用 `.ct-shell:has(> .ct-shell-rightbar .ct-sp-root[data-ct-sp-maximized])` 把该壳的右栏容器改为 `position:absolute; inset:0`，主区 `visibility:hidden`（保留 DOM/滚动），并隐藏壳内右栏拖拽把手。
- 验证（`DSH_HOME=/tmp/ct-verify dsh web --port 3099`，link: profile 加载工作树）：单屏文件面板 337px → 最大化后 `.ct-shell-rightbar` = 壳 840×867，`.ct-shell-main` visibility hidden；还原后回 337px、主区恢复。文件+终端双 pane：最大化终端后右栏只渲染终端并铺满壳，还原后上下分栏恢复。分屏（native 左 420px + overlay 右 420px）：最大化 overlay 右栏后只覆盖 overlay 壳（700,0,420,867），native 壳与左栏 280px 不变；刷新后 overlay 仍保持最大化。最大化时原生 header（含分屏关闭按钮）不可见，需先还原面板才能关闭分屏。
- 主题：新规则只改结构与可见性，颜色继续用 DSH 令牌，无新增色值。

### 后台任务面板与「更多」菜单（2026-11-09）

- 实现：`features/conversation-side-panel/jobs-panel.js`（tab 类型 + body）+ `header-toolbar.js`（常驻「更多」+ 后台任务 toggle + 溢出入口）+ `index.js`（tab 注册、`job-list` 屏蔽、`jobs` 注入）。
- 数据：`ctx.jobs.state.rows[sessionId]`（`watchRows`）、`state.observed[jobId]`（`observe`）、`kill`；行内状态/时长/终止原因来自 `JobView`。
- 验证环境：独立 `DSH_HOME=/tmp/ct-verify` + `dsh --profile web --port 3099`（profile 副本，`claude-code-mode` 指向仓库）。未触碰正在运行的 3080 web 进程与桌面进程。
- 菜单：入口条只有 `files` / `terminal` / `dsh-git-panel` 三个工具，**没有后台任务**；「更多」常驻；菜单第一项是 `menuitemcheckbox`「后台任务」，打开→收起两次后 `aria-checked` false → true → false；数量徽标显示运行中数量（1）；菜单打开时「更多」的 Tooltip 禁用，不再遮挡第一项。
- 原生触发器：有真实后台任务时 DOM 里 **没有** `[data-job-count]`（运行版本与本地 checkout 不一致），按 CSS 猜类名无效；改为把 `conversation.session.header.actions` 的 `job-list` entry 渲染成 `null` 后，页面里不再出现「N 个后台任务运行中」按钮。
- 面板：真实 `sleep 240` 任务显示在「进行中 1」，时长每秒增长；展开后输出区显示「（暂无输出）」；两段式停止第一次变「确认停止」，第二次调用 `kill`，任务落入「已完成」并显示 `signal: SIGTERM; cancelled by the user` 与 1 分 16 秒；点「清空」后面板回到「没有后台任务」。
- 组件 harness（`.dsh/harness/`，单独静态页）：mock 4 条任务验证已完成分组、`gapBefore`/输出错误提示、复制反馈、清空、`aria-checked`；两段式停止调用 `kill`；入口条不含 jobs。
- 未验证：分屏 overlay 内的后台任务面板（同一套 seats，未单独跑）；浅色/深色两套主题的视觉对比；Claude 的 task chip / loading indicator 入口。

### 分屏 + 后台任务面板：右栏占位与点击无效（2026-11-10）

- 现象：分屏与后台任务面板一起用之后，偶尔「面板关闭但对应会话右侧占位仍在」「点后台任务没打开面板」；热重载后出现 store 认为面板开着（菜单勾选、jobs 面板存在）但原生右栏列宽是 0 的状态。
- 复现（ego 接管 3080 实时页面）：刷新前 `[data-rightbar-col]` 的 frame 带 `data-rightbar-collapsed`、grid 第三列 0，同时菜单 `aria-checked=true`、`[data-ct-jobs-panel]` 存在；刷新后恢复 4 屏且右栏正常。说明是运行时状态失步，不是布局数据本身坏。
- 根因与修复：
  1. `split.isOverlaySession` 只看 `panes` 记录。退出分屏/热重载后残留 pane 会让该会话的 `syncPresentation` 永久变成 no-op，原生 frame 不再跟随展开/收起。改为只认当前 `overlayTree` / `nativeBottomPaneId` 里的 pane。
  2. `openPanel` 在右栏 store 未 materialize 时退回窗口级 `sbr.openTab`。它作用于当前选中的会话，在分屏 overlay 里表现为「点了没反应」或把面板开到别的屏。改为先 `actions.open(sessionId)` materialize，再按 20×50ms 重试放置；不再触碰窗口级 `openTab`。
  3. SidePanel 增加 presentation 自愈：观察原生 frame 的 `data-rightbar-collapsed`，与当前 `shown` 不一致时按当前状态重新上报，覆盖分屏退出/热重载后 frame 与 per-session store 失步。
- 验证（独立 `DSH_HOME` + `dsh --profile web --port 3099`）：overlay 首次打开后台任务（该会话右栏 store 未 materialize）→ 自动打开并显示空态；关闭 → 占位归零；再次打开正常；关闭 overlay 退出分屏 → 原生右栏恢复到 525px；刷新后分屏与两屏右栏状态恢复。主页面（3080）刷新后同样验证 overlay 打开后台任务正常。

### 分组「分组和排序」提示被滚动区遮挡（2026-11-09）

- 现象：分组头悬停的「分组和排序」气泡用 `.ct-wb-icon-btn[data-tip]::after` 画在滚动容器里，气泡越过行边界时会被滚动区/下一分组压住一部分。
- 根因：伪元素的 `z-index: 30` 只在所在滚动容器的层叠上下文内生效；气泡仍是容器内容，受 `overflow` 与后续分组绘制顺序影响。
- 修复：分组按钮改用原生 `Tooltip`（`side: 'top'`、`align: 'center'`、`delayMs: 200`、`portal: true`）。实测浮层挂在 `body` 下，`position: fixed`、`z-index: 1100`，`role="tooltip"`，背景 `rgb(44,44,44)`、白字；删除 `data-tip` 伪元素样式。
- 验证：临时 DSH_HOME + Web profile 副本，ego-browser 悬停分组按钮，提示完整显示在列表上方，不再被滚动区裁切；点击按钮仍能打开分组菜单。
- 落地位置：`src/client/features/workspace-browser/index.js`（原生 `Tooltip` 包装）、`workspace-browser.css`（删除 `data-tip` 伪元素规则）。

### 侧栏滚动条与会话标题对比度（2026-11-09）

- 参考：用户提供的 Claude Desktop 截图：侧栏右侧有一条明显的圆角滚动条；会话列表标题比当前 DSH 版本更黑、更清晰，接近加粗。
- Claude 静态证据：`ion-dist.asar` 的全局滚动条规则为 `::-webkit-scrollbar{width:8px;height:8px}`、拇指 `--cds-alpha-3`（20% 墨色）+ `border:2px transparent` + `border-radius:9999px`、hover 用 `--cds-alpha-4`（35%）；会话行使用 `text-secondary`，浅色主题为 `#000000bf`（约 75% 墨色）；分组标签单独使用 `--cds-text-muted`，因此比会话标题浅。
- 修复前（临时 DSH_HOME + Web profile 副本，真实会话数据）：会话行取 `--dsw-alias-label-secondary`，实际约 `#5c5c5c`；滚动条沿用 DSH 全局 5px 宽、`--dsw-alias-scrollbar-bg-l1` 的浅色拇指，侧栏截图中几乎不可见。
- 修复：
  - `.ct-wb-row` 改用 `--ct-wb-row-text`，Claude 皮肤定义为 `color-mix(in srgb, var(--ct-ink) 78%, transparent)`；`.ct-wb-title` 用 `--ct-wb-title-weight: 500`。分组标题仍用次级灰，形成层级。
  - 侧栏滚动容器覆盖 `--dsh-scrollbar-width: 8px`、`--dsh-scrollbar-thumb-border: 1px`、`--dsh-scrollbar-thumb`/`--dsh-scrollbar-thumb-hover`；皮肤提供 20%/35% 墨色，缺皮肤回退 DSH 令牌。
- 验证（ego-browser，1067×855 视口，`scrollHeight=1026 > clientHeight=765`）：
  - 普通会话行 computed color `color(srgb 0.078 0.078 0.075 / 0.78)`，标题 computed `font-weight: 500`；截图中的文字明度从约 96 降到约 70，肉眼可见更清晰。
  - 滚动条实际可见宽度 6px（截图列 269–274，颜色 `rgb(202,202,202)` 在浅色底上），悬停变量切到 35% 墨色。
  - 临时模拟 `data-ds-dark-theme`：行文字解析为 `#f5f4ef` 78%，滚动条为浅色墨 20%，深色底上仍可见。
- 偏离：Claude CSS 的拇指透明边框是 2px（4px 可见），按用户截图和“看不清”的反馈改为 1px（6px 可见）；颜色仍保持 Claude 的 20%/35% 墨色。
- 落地位置：`src/skins/claude/skin.css`（`--ct-wb-row-text`、`--ct-wb-title-weight`、`--ct-wb-scrollbar-*`）、`workspace-browser.css`（`.ct-wb-row`、`.ct-wb-title`、`[data-ct-sidebar-scroll]` 的滚动条变量）。

### 项目分组拖拽排序、分组头按钮与滚动分隔线（2026-11-09）

- 参考：用户提供的 Claude Desktop 截图：项目分组头悬停显示 ↑↓「分组和排序」+ 新建；列表滚动后顶部出现分隔线、底部分隔线常驻；项目分组可拖拽改变顺序。Claude 的 `ion-dist.asar` 内确认侧栏按钮文案为 `Group and sort`、图标名为 `Filter`，与截图的 ↑↓ 图标一致。
- 验证环境：dsh 0.2.2-rc.1 Web（`http://127.0.0.1:3080/`，web profile 以链接方式指向本仓库），ego-browser 真实 Chromium；使用真实工作区数据做排序验证，验证后已拖回原顺序。
- 复现步骤与结果：
  1. 分组头悬停：出现 ↑↓ 与 +；↑↓ 按钮 `aria-label`/`data-tip` 均为「分组和排序」，悬停时上方出现深色气泡；按钮点击仍打开分组依据/排序方式/显示菜单。
  2. 项目排序：用真实鼠标把 `claude-theme` 拖到 `fix-paper` 上半区，DOM 出现 `ct-wb-group is-workspace-drop-before` 插入线；松开后顺序从 `… 文献综述, fix-paper, claude-theme, dsh-default …` 变为 `… 文献综述, claude-theme, fix-paper, dsh-default …`；再拖到 `fix-paper` 下半区恢复原顺序。
  3. 滚动分隔线：`[data-ct-sidebar-scroll]` 的 `scrollTop` 为 41.5 / 17 时根节点带 `data-ct-sidebar-scrolled`，顶部边框 `rgba(0, 0, 0, 0)` → `rgba(0, 0, 0, 0.07)`；回 0 后属性移除、顶部恢复透明；底部边框始终保持 `rgba(0, 0, 0, 0.07)`。
  4. 边界：拖到自己或相邻位置时 `commitWorkspaceReorder` 直接 return，不写 Host；置顶、分区、日期/状态/无分组分组不参与项目排序；拖拽经过置顶/分区只清落点和高亮，不影响会话拖拽。
- 未覆盖：深色皮肤下的实际颜色对比（只确认走 `--dsw-alias-border-l1` / `--dsw-alias-state-business-primary` 令牌）；Claude 桌面端真实拖拽手势未在本机复现，交互边界以用户截图和 DSH 原生 `workspaces.insertBefore` 语义为准。
- 落地位置：`src/client/features/workspace-browser/index.js`（`startWorkspaceDrag` / `commitWorkspaceReorder` / `iconSort` / `installSidebarShell` 的 `syncScrollEdge`）、`workspace-browser.css`（插入线、`data-tip` 气泡、滚动区上下边框）。

### 分屏网格上限：左右两列、上下两行（2026-11-09）

- 需求：会话分屏最多左右两列、上下两行，总共四屏；再多只能替换已有的屏幕。
- 修复前现象：overlay 树允许 `splitOverlay(paneId, sessionId, direction)` 按调用方方向插入。右列上下两屏（3 屏）时，聚焦 overlay 后从菜单「在分屏中打开」或拖到 overlay 右缘，会再插一层 row split，出现第三列；上下两行（上 1 下 2）时拖下排下缘还能长出第三行。
- 复现环境：独立 `DSH_HOME=/tmp/ct-split-home` + web profile 副本（插件构建产物，`dsh --profile web --port 63901 --no-open`；复制真实 `sessions/` 与 `storages/`，验证后清理），ego-browser 操作。
- 修复前 DOM 证据：主屏 424px + 右列上半 `left 704 top 0 w 378` + 右列下半被拆成 `left 704 w 189` 与 `left 893 w 189` 两个 pane → 3 列 2 行。
- 修复：① `splitOverlay` 改为按 `mode` 强制正交方向（row→column、column→row），overlay 区域最多 2 叶，达到上限直接 `replaceOverlay`；② `addOverlayForMenu` 在 overlay 已满时优先补左列 native bottom，否则替换聚焦屏/主屏；③ `resolveSplitDropTarget` 用 `readSplitGrid(snapshot)` 计算容量，只有真实空位（native bottom、右列/下排第二屏）给分屏落点，其余一律 `replace`，满格提示「分屏已满（左右两列 · 上下两行）· 替换当前分屏」；④ restore 展平旧树、只保留前两个合法 leaf（排除与主屏重复的会话），按最终 mode 重建正交方向。
- 验证（ego-browser，DOM 坐标/文本断言）：
  - 4 屏 2x2（row）：native 左列上、native bottom 左列下、overlay 右列上下；`cols=[280,675]`、`rows=[0,400]`，无第三列。
  - 4 屏时拖入新会话到右列下半：预览 `data-zone=replace`、预览矩形等于目标 pane、提示「分屏已满（左右两列 · 上下两行）· 替换当前分屏」；drop 后 pane 数不变、目标 pane 标题更新。
  - 3 屏（左2右1）拖到右缘：`zone=replace`，替换右列、不产生第三列；拖到右列下方：新增第二 overlay，形成 2x2。
  - column 3 屏（上1下2）：拖下排下缘 → `zone=replace`（不产生第三行）；拖上排 native 右缘 → `zone=replace`（替换主屏）。
  - 刷新：2 屏、3 屏（row 与 column）、4 屏 2x2 都能恢复，4 屏布局与刷新前一致。
  - 旧数据归一化：写入 3 叶 column 树 → 恢复为 2 叶右列上下；写入 3 叶 + native bottom（5 屏）→ 裁剪为 4 屏 2x2；写入含主屏会话的 overlay → 只恢复另一叶（主屏不重复）。
- 发布：仓库 build 后把 `lib/` 同步到 `~/.dsh/profiles/web/node_modules/claude-code-mode/`（file: 复制安装）；desktop profile 是 link，构建产物由 client-hmr 直接加载。

### 会话名点击就地编辑（2026-11-09）

- 环境：dsh 0.2.2-rc.1，`dsh web`（web profile，`file:` 安装，端口 3080），ego-browser。
- 验证：点击 header 标题出现同位置输入框并全选（value=原标题、selection=[0,15]、focused=true）；输入新名按 Enter 后标题与侧栏同步更新；Esc 取消、清空后失焦都不改变标题；未改动按 Enter 不发请求；分屏两个 pane 的标题各自编辑、互不影响；刷新后标题持久化；超长中文标题被宿主截断到 80 字节（26 个汉字）后恢复原标题；标题 hover 有底色、cursor=text；编辑框右缘不遮挡标题旁的下拉按钮；操作期间页面无 error/unhandledrejection。
- HMR：改 `lib/client.js` 并同步到 web profile 后，未刷新页面即看到插件重新加载（临时标记先出现后消失），编辑功能重新绑定可用。
- 编辑态让位：点击标题后同一 header 的 `[data-ct-header-menu]` computed visibility=hidden，另一分屏的按钮仍 visible；失焦与 Esc 后属性移除、按钮恢复 visible。
- 未覆盖：桌面窗口内的点击未能自动验证（系统未授予辅助功能权限，CGEvent 点击被丢弃）；subagent 自绘标题的实机场景（代码按 lineage 前兄弟判定，分隔符与自绘内容不接管）；`rename` 失败提示未人为制造失败。

### 分屏时侧栏分割线拖不动（2026-11-09）

- 现象：单屏时左侧会话列表与主内容区之间的分割线可以拖动缩放；只要进入分屏（≥2 屏），分割线还能拖、光标也变成 `col-resize`，但侧栏、会话区和 overlay 都不缩放。
- 复现环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/tmp/dsh-splitfix-home` + web profile 副本（插件 link 到仓库，端口 58011；复制本机会话数据，验证后已删除），ego-browser 从会话行菜单「在分屏中打开」形成两屏。
- DOM 证据（修复前）：从 280px 向右拖 80px 后，原生 frame 内联 `grid-template-columns` 变成 `360px ...`、原生 handle 的 `left` 从 280 移到 356，但 `--ct-split-cols` 仍是 `280px 426.5px 0px 426.5px`，`[data-ct-split-sidebar]` 宽 280、center `left` 280、overlay pane `left` 706.5。
- 根因：分屏用 `[data-ct-split-frame]{grid-template-columns:var(--ct-split-cols)!important}` 接管了 frame 网格，而 `measureSplitFrame` 的 sidebarW 取 `center.left - frame.left`。网格被接管后 center 位置被冻结，ResizeObserver 观察 frame/center/sidebar 都收不到尺寸变化；原生侧栏拖拽只重写被 `!important` 压住的内联 grid，于是只有 handle 在动。
- 修复：`readNativeSidebarWidth()` 从 frame 内联 `grid-template-columns` 第一段读原生侧栏宽度，作为 `measureSplitFrame` 的输入；新增 MutationObserver 盯 frame 的内联 `style`，原生网格变化时重新测量并重写 `--ct-split-cols`，侧栏/原生屏/overlay 一起重排。
- 验证（同一环境，ego-browser）：拖动后 280 → 350，`--ct-split-cols` 同步为 `350px 391.5px 0px 391.5px`，`[data-ct-split-sidebar]` 350、center `left` 350、overlay pane `left` 742 宽 392；反向拖动、折叠到 56 / 展开都跟随；分屏 resizer 仍只改 native/overlay 比例（350 → 332/451）；关闭 overlay 退出分屏后原生 grid 恢复 350px，侧栏保持拖动后的宽度；静置 1.5s 布局不再变化。
- 落地位置：`src/client/features/workspace-browser/index.js` 的 `readNativeSidebarWidth` / `measureSplitFrame` / `createSplitOverlay`。

### 分屏 pane 不能滚动（2026-11-07）

- 现象：单屏打开长会话能正常滚动；从会话行菜单「在分屏中打开」分出新 pane 后，新 pane 的内容停在顶部，滚轮/滚动条都不动；原生左/上屏仍能滚动。刷新后问题仍在。
- 复现环境：临时独立 `DSH_HOME=/Users/dtstack/.dsh-splittest` + `splitverify` web profile（端口 57901，复制真实会话数据；验证后已删除），ego-browser 打开「会话分屏拖拽布局」，再从「问候」行菜单选「在分屏中打开」。
- DOM 证据：overlay 的 `[data-conversation-scroll]` clientHeight=2229.5、scrollHeight=2229.5，而所在 pane 高 969；自定义外层 `.ct-split-native-conversation` 被内容撑到 2305.5px，pane 只是 `overflow:hidden` 裁掉。原生屏的 scrollBody 是 893/4921，正常。
- 根因：1b5756f 为了避免直接复制 `main.conversation` 的主屏 props，在 overlay 里自己包了一个 `.ct-split-native-conversation`，只渲染 `conversation.header` + `conversation.content` child slot。但原生 `ConversationRoot` 的根节点（`.wSkVaW_root`：`height:100%`、flex column，以及 `[data-phase=active]` 下的 viewArea 高度和 sticky composer 规则）被漏掉了；自定义根是 block/auto 高度，`.body`/`.scrollBody` 的 `flex:1` 没有确定高度，内容把根撑高，滚动容器自然没有可滚动范围。
- 修复：不再自己拼根。`installRightbarSurface` 只捕获 `main` 入口的 `renderSlot`（`ClaudeThemeMainCapture`），overlay 在 pane 的 `SessionProvider` 下调用 `mainSurface.renderSlot('main.conversation', {})`；`SlotOutlet` 会用当前 pane 的 scope binding 重新解析完整的 `main.conversation`，原生根/header/content/composer/滚动/phase 全部由 DSH 组件产出。删除 `main.conversation` 入口捕获和 child-slot 拼接（`mainConversationPanel` / `sessionBlank`）。注意不是直接渲染捕获到的组件——那样会沿用主屏 props，历史仍会串。
- 验证：同一环境分屏后 overlay scrollBody 变为 892/2230，滚轮使 scrollTop 从 1337.5 变 537.5，composer 保持 `position:sticky`、bottom 0；刷新后 3 个原生根（main + 2 overlay）各自 session 正确、scrollHeight 4921/19748/72757，无 `[data-slot-error]`、无 console exception；两个 overlay 同时存在时各自独立滚动。
- 发布注意：Web profile 是 `file:` 复制安装，只 `pnpm build` 仓库时 3080 仍加载 06:59 的旧 bundle（DOM 里还有 `.ct-split-native-conversation`，block 高度被撑到 2329.5px）；把 `lib/` 和清单同步到 `~/.dsh/profiles/web/node_modules/claude-code-mode` 后，3080 的 overlay 也变成两个原生根（scrollH 880/2254、composer sticky），滚轮 scrollTop 1373.5 → 673.5。桌面 profile 是 `link:`，构建后由 client-hmr 自动更新。

### 跨宿主进程的会话可见性（2026-11-07）

- 现象：桌面端和 3080 的 `dsh web` 各分叉了一次「会话分屏拖拽布局」，两边侧栏都只能看到自己分出来的 fork；网页端刷新也看不到另一边的。
- 根因：DSH 桌面端和 `dsh web` 是两个宿主进程，共用 `~/.dsh` 的会话/工作区文件，但各自在启动时把 `workspace.sessionIds` 读进内存，跨进程没有事件推送；新 fork 的会话 header 和日志已经落盘，另一个进程的 `sessions.list` 也能列出来，但它不在本进程的 `workspace.sessionIds` 里，客户端只能把它放进默认折叠的「未分组」，看起来像没挂上。更糟的是两端同时写 `workspace.json` 会把对方刚加的 `sessionIds` 覆盖掉。
- 修复：客户端在窗口聚焦 / 页面可见 / 每 30 秒调用 `sessions.refresh()` 拉一次宿主基线；`buildGroups` 对未被任何工作区记账的会话，用 header `cwd` 与 `workspace.path` 归一化匹配后补回对应项目分组，父会话在同一组时沿用正常 fork 树嵌套。不改 `workspace.json`，避免和 DSH 存储域抢写。
- 验证：临时 web 宿主（端口 30990，同一 `DSH_HOME`）启动后，桌面端两个新 fork 在「未分组」里；修复后刷新页面，三个 fork 全部作为子行挂在 `会话分屏拖拽布局` 下，「未分组」不再包含它们。
- 限制：跨进程的归档/置顶/workspace 写入仍可能互相覆盖；同一个 `DSH_HOME` 建议只运行一个宿主进程。

### fork 树挂载回归（2026-11-07）

- 现象：0.2.2 下从会话行菜单点「分叉会话」，新会话是平铺行，不挂在父会话下。
- 根因：DSH 0.2.1 的 `session.fork` 给子会话传 `meta.parentSession`；0.2.2-rc.1 删除该字段（`fork` 只做 seed 复制）。子会话 header 没有 `parentSession`，`sessions.list.parentId` 为空，`buildTree` 只能把它当 root。
- 修复：宿主包装 `sessionController.fork` 与 `agents.create`（AsyncLocalStorage 标记本次 fork 的源会话），对 `meta.isSeeded === true` 且没有 `parentSession` 的创建补回源 id；新 fork 的 header 恢复 `"parentSession":"<source>"`。升级前已产生的 fork 由宿主回填：先按 DSH 的 `increasedForkTitle` 反推源标题（`X (1)` 反推 `X`，`X (2)` 反推 `X (1)`）精确找候选，找不到才退回「去掉 `(N)` 尾巴」的宽松候选，最后要求继承前缀切点事件 seq/time/type/data 全等且唯一；客户端只在原生 `parentId` 缺失时使用该兜底。
- 验证：独立 `DSH_HOME` + web profile 副本（端口 54600），复制真实会话数据；修复前 `会话分屏拖拽布局 (1)` 的 `parent:null`，重启后回填为 `parent:session-68259223...`，侧栏显示父行 chevron + 子行缩进；再从行菜单分叉「问候」，新会话 header 写入 `parentSession`，`/claude-code-mode/lineage.json` 返回 `parent: session-f67239c0...`，树中「问候 (1)」紧跟「问候」。

### 消息回退、文件回滚与图片灯箱（2026-11-07）

- 参考环境：Claude Code 桌面端；用户提供的截图：用户消息动作行的「退回到此处」、回退后的「已回退到此处 / 撤销回退」、交付图片卡。
- 验证环境：dsh 0.2.2-rc.1，独立 `DSH_HOME` + `web` profile 副本（端口 55124）做文件回滚/模型历史等破坏性验证；用户指定的真实 `web` 进程 `http://127.0.0.1:3080/`（ego-browser 真实 Chromium）做回退/撤销/图片灯箱复验。真实实例只隐藏再撤销了一轮消息，没有改会话日志。
- 复现步骤：
  1. 打开一个会话，默认整行动作（含时间/用量）全部隐藏（`/tmp/ct-rw-final3-default.png`）；悬停用户消息整行出现，时间显示相对值「2小时前」，复制/回退/分支同时出现（`/tmp/ct-rw-final3-user-hover.png`；短会话验证「半小时前」：`/tmp/ct-rw-final3-short-hover.png`）；悬停回退按钮显示原生单行 Tooltip「退回到此处」（`role=tooltip`、class `_bubble_44yfq_1`、`data-side=bottom`，与复制/分支同一组件；ego 自动化页面不触发该原生组件的 ResizeObserver/入场动画，所以截图里看不到气泡，DOM 断言已验证）。悬停助手正文/同一轮非用户消息时只显示该轮助手的整行动作（`/tmp/ct-rw-final3-assistant-tail-hover2.png`），悬停用户行不会显示助手动作。时间格式由 `src/client/shared/time.js` 统一：刚刚 / N分钟前 / 半小时前 / N小时前 / N天前 / N个月前 / N年前；单元测试覆盖 30s、5min、30min、59min、1h、2h、1d、3d、45d、400d，全部通过。
  2. 点击回退（无文件改动）：该消息及其后的行隐藏，原文字回到输入框，会话滚动内容的末尾显示「已回退到此处 / 撤销回退 / 发送新消息后将无法撤销」（`/tmp/ct-rw-after2.png`；撤销按钮的 tooltip 已改为与复制/分支相同的原生 Tooltip，旧的 `/tmp/ct-rw-dock-tooltip2.png` 是自绘版本，不再代表当前实现）。撤销后消息恢复、dock 消失。2026-11-10 起提示条从输入框上方移入滚动内容，向上翻历史时会一起滚走，见下一节。
  3. 让 Agent 把 `.ct-rewind-test3.txt` 从「第五版」改成「第六版」后再回退：弹窗列出该文件与两个操作按钮（`/tmp/ct-rw-file-dialog2.png`）；选择「回退消息并还原文件」后文件内容回到「第五版」，dock 显示「同时还原了 1 个文件」。
  4. 撤销回退后当前文件已不是 checkpoint 的 after 版本，再次回退：不弹窗、只回退消息，toast「这些文件已被其它操作改过，本次只回退了消息」，文件保持「第五版」。
  5. 回退后发送新消息：dock/撤销立即消失；模型回答「在这次对话里，我只看到过一条用户消息，就是你当前发来的这条」——证明隐藏范围没有进入下一次请求（`/tmp/ct-rw-after-submit.png`）。
  6. 刷新页面/重启宿主后，未撤销的回退仍然生效；撤销回退仍可用（宿主状态文件持久化）。
  7. 在真实 3080 实例展开 `claude-theme` 分组，打开「归档会话导致分组异常收起」，点击 `ct-verify-after-archive-old.png`：出现「图片预览」灯箱，图片 naturalWidth=1476；右侧栏保持关闭（`aria-hidden=true`、`left=-670px`），未打开右侧抽屉；卡片 aria-label 已变为「预览 /private/tmp/...」（`/tmp/ct-rw-3080-lightbox.png`）。
  8. 真实 `http://127.0.0.1:3080/` Web 实例上重复步骤 2 和撤销：隐藏 5 行、dock 出现、撤销后恢复 4 行，无报错；宿主 `claude-code-mode` 插件在桌面 profile 通过 plugin_manager 重新启用后保持 active。
- 边界：回退范围内文件来自 `bash` → 不弹窗；宿主重启 → 只能回退消息；锚点被上下文压缩移出 surface → 拒绝回退；消息带图片/附件 → 只回退文字；同一会话在多个宿主进程同时打开时状态文件不是热同步的。
- DSH 差异：DSH Session 日志 append-only，插件不改日志，只在 `deriveMessages` 和对话渲染层应用回退范围；文件检查点在宿主内存；图片灯箱只接管交付图片卡（助手正文图片块本来就有原生灯箱）。
- 落地位置：`src/client/features/conversation-rewind/index.js`、`conversation-rewind.css`、`src/host/index.js`、`src/client/index.js`、`build.mjs`。

### 回退提示条移入会话滚动内容（2026-11-10）

- 现象：回退后「已回退到此处 / 撤销回退」通过 `conversation.input.dock` 注册，被钉在输入框上方；它在滚动容器外，向上翻历史时始终不动，看起来不像会话内容的一部分。
- 根因：DSH 的聊天列只有 `conversation.chat.flow` 一个会话内容插槽，没有尾部插槽；`conversation.input.dock` 属于 composer 栈（`[data-composer-seat]`），天然脱离滚动内容。
- 修复：不再注册 input.dock。`installDock` 包装 single slot `conversation.chat.flow` 的渲染器，在原 flow（消息行数组）之后渲染 `RewindDock`；两者都落在 `[data-slot="conversation.chat.flow"]` 内，dock 是聊天列的直接子元素。输入框联动改由 `conversation.input.shell(sessionId)` 的 state/actions 提供（提交后收起、撤销后清掉回填草稿），不再依赖 input.dock 的注入 props。`scrollConversationToBottom` 优先使用 dock 最近的 `[data-conversation-scroll]`，分屏时不会滚错 pane。
- 验证环境：按插件开发模式跑独立实例——worktree `fix-rewind-dock-in-scroll`、独立 `DSH_HOME=/tmp/ct-rewind-verify/home`（复制主 DSH 的 `sessions`/`storages`）、独立 profile `web-rewind`、端口 55031；ego lite 打开实例打印的带 token URL。验证后已删除测试实例与临时目录。
- 复现步骤：
  1. 单屏打开「修复回退撤销文案位置」，回退最后一轮：该轮隐藏，dock 出现在滚动内容的最后一条可见消息之后；DOM 断言 `dock.closest('[data-chat-flow]')` 为真、`dock.closest('[data-composer-seat]')` 为假，dock 是 `[data-slot="conversation.chat.flow"]` 的最后一个子元素（`.dsh/testing-evidence/rewind-dock-in-scroll-1-single.png`）。
  2. 打开长会话「参考规范化改造方案2继续」，回退最后一轮：滚动容器 2981px / 视口 483px；`dock.offsetTop=2788` 固定在内容里；滚到顶部后 `dock.getBoundingClientRect().top` 从 382.5 变为 2880（滚出视口），滚回底部恢复 382.5——提示条随历史一起滚动（`.dsh/testing-evidence/rewind-dock-in-scroll-2-long-bottom.png`、`-3-long-after.png`）。
  3. 撤销回退：消息恢复、dock 消失，页面回到滚动底部。
  4. 分屏：从会话行菜单「在分屏中打开」右侧会话，在右屏回退：只有右屏的 flow 内出现 dock（`dockIsLast=true`），左屏无 dock；右屏滚到顶部后 dock rect.top 从 382.5 变为 4124，证明每个 pane 的提示条属于各自的滚动内容（`.dsh/testing-evidence/rewind-dock-in-scroll-4-split.png`）。
- DSH 差异：包装 `conversation.chat.flow` 的 `entry.component`，与项目里已有的 keyed node 包装同一做法；`ChatFlow` 返回数组，包一层 Fragment 不新增 DOM 父节点，消息行的直接子元素关系和滚动定位不变。


### 数据驱动工作区：两级树、折叠、菜单（2026-11-06）

- 参考环境：用户提供的 Claude Code 截图（未在本机启动 Claude Code 做交互复现）。
- 验证环境：DSH Desktop 2.0.18 / dsh 0.2.1-rc.2，真实浏览器里逐项点击。
- 复现步骤：
  1. 刷新页面，确认侧栏由自绘列表渲染；展开 `vlifa`，28 行全部出现，depth 只有 0 和 1。
  2. 确认页面没有「展开其余 N 个会话」，也没有原生 watermark 按钮。
  3. 点击根行 `生成界面的鼠标焦点和选框动画` 的 chevron，确认只隐藏两个后代，根行仍在；再点恢复。
  4. 点击会话行能打开对应会话；行尾「更多」菜单包含置顶/重命名/分叉/归档/复制 Session ID。
  5. 标题搜索 `agent`，确认只剩匹配会话；搜索请求已合并 `sessions.search` 内容结果（当前环境无内容命中）；归档筛选切到「仅显示已归档」显示空态。
  6. 工作区行 hover 出现新建会话和更多菜单；更多菜单包含重命名/删除工作区。
  7. 会话行右键、工作区行右键都能打开自绘菜单；运行中会话显示状态点。
  8. 拖动父会话，确认「已置顶」分组整体蓝色高亮（无虚线框），落点后整棵 fork 树移动到分组；取消置顶后整树回原工作区。子会话可拖动但分组不高亮、不能落点；工作区不可拖拽排序。
  9. 确认项目内会话按最近活动倒序：当前对话（刚更新）在项目最上面，fork 树按整棵树的最新活动排序；悬停 700ms 出现预览卡；`⌘K` 聚焦搜索。
- 边界情况：当前会话在其它工作区时自动展开对应分组；分支折叠；归档行不可打开；搜索时所有匹配分组展开；窄侧栏。
- 观察结果：列表不再依赖原生行 DOM；两级树、折叠、chevron、菜单、搜索、归档筛选都工作；工作区展开状态刷新重置。
- DSH 差异：DSH 原生列表有 watermark、自绘列表没有；这是本次有意覆盖。
- 落地位置：`src/client/features/workspace-browser/index.js`、`workspace-browser.css`。

### 分屏视图：每个 pane 都是原生主屏 + 独立右侧栏（2026-11-06）

- 参考环境：用户提供的 Claude Code 桌面端截图（右侧栏在每屏里、四屏布局）；Claude Code Desktop 文档「work across sessions / arrange panes」；本地 DSH 源码 `packages/client/ui-layout`、`packages/client/ui-conversation`、`packages/client/ui-sidebar-right`、`packages/client/ui-dockkit`。
- 验证环境：DSH Desktop 2.0.18 / dsh 0.2.1-rc.2，真实 Chromium 页面；真实鼠标拖拽 + DragEvent 复核分屏/替换。
- 复现步骤：
  1. 原生会话「问候」并打开右侧栏；从侧栏把另一个会话拖到主内容区右侧：原生 main+rightbar 留在左侧 50%，overlay 在右侧 50%；overlay 内部是**原生 main.conversation**（原生 session header + 原生内容）和它自己的**原生 rightbar.session** seat。
  2. DOM 中同时有 2 个 `[data-slot="main.conversation"]` 和 2 个 `[data-sidebar-right-panel]`；两个 pane 的 header 都有原生「问候 / 模型 / 对话轨迹 Git / …」，overlay 不再自绘标题栏。
  3. 单屏原生 header 只在 corner 显示右栏开关；进入分屏后 corner 多出「关闭会话」。overlay pane 点一次关闭 pane；分屏 native 左/上屏关完后进入同项目新会话界面。关闭按钮不再先关右栏，右栏用原生 header 的右栏开关。关右侧最后一个 overlay 时，若左侧有 native bottom，左屏保留并切成整宽上下两屏；再关 native bottom 才退出并恢复 670px 单右栏。单屏关闭则在右上角「关闭会话」，退出当前会话到同项目的新会话界面。
  4. 右栏自己的「收起右侧边栏」也把 overlay 右栏宽度归零；原生 header 的「打开右侧边栏」重新展开；两个方向都不影响原生 pane 的右栏。
  5. 把第三个会话拖到**左栏底部**：出现 left-bottom 预览，松开后原生左屏上下各一屏（native top + native bottom），右侧 overlay 仍占 50% 全高；左右 pane 各 604px，内部都是 364px 会话 + 240px 右栏。
  6. 右栏的「全屏」只把当前 overlay 右栏铺满该 pane（原生主内容隐藏），按钮变成「退出全屏」；再点恢复。
  6. 在 overlay 右栏点「新建终端」/「工作区文件」：zsh/文件树只出现在该 overlay，原生右栏仍是「开始」；原生 pane 和另一个 overlay 都不受影响。
  7. 三屏时 DOM 中同时有 3 个 `[data-slot="main.conversation"]` 和 3 个右栏；每个 overlay 的 header/模型/视图页签/右栏按钮各自独立。
  8. 把已有会话拖到原生区域：预览整个原生屏并显示「在此打开」，松开只替换原生会话；overlay 保持。
  9. 继续在 overlay 区域分到 3 个（总共 4 屏）：之后所有落点只替换；侧栏显示「退出分屏 · 4 屏」；点它或逐个关 overlay 都能退出。
- 边界情况：右栏本来展开/收起；overlay 会话的右栏没有打开过（强制 open/expanded）；overlay 右栏 240px 下分栏被原生 canSplit 判 disabled；原生右栏全屏隐藏；窗口宽度不足时右栏自动收起；运行中会话；fork 子会话；空白会话；归档会话。
- 观察结果：每个 pane 都是真实主屏组件（原生 header/content/右栏），不是自绘 imitation；关闭按钮位于原生 header corner 最右侧，所有屏幕都有；单屏关闭到同项目新会话；分屏右栏/会话两态语义正确；overlay 右栏的终端/文件只影响自己的 pane；没有 slot/factory 错误；退出后 frame/右栏完全恢复。
- DSH 差异：每 pane 原生主屏通过包装 main/rightbar 入口捕获 renderSlot 实现（内部绑定，非公开 API）；分屏时所有右栏统一 240px、原生右栏全屏隐藏；原生左屏固定 50% 且只能上下再拆；分屏布局不持久化、overlay 区域等分；tab 右键菜单/全局右栏快捷键仍指向窗口右栏。
- 落地位置：`src/client/features/workspace-browser/index.js`、`workspace-browser.css`。

### 归档当前会话不收起项目分组（2026-11-07）

- 参考环境：Claude Code 桌面端；用户反馈的规则「不是主动点击收起，分组不应该自己收起来」。
- 验证环境：dsh 0.2.2-rc.1，独立 `DSH_HOME` + `web` profile 副本，`dsh --profile verify --port 55123`；ego-browser 打开带 token 的 Web GUI；会话/工作区数据从本机复制一份，不碰真实数据。
- 复现步骤：
  1. 打开 GUI，确认 `claude-theme` 项目分组展开、当前会话行高亮。
  2. 点当前会话行的「更多」→「归档会话」，等 toast「会话已归档」。
  3. 观察分组头 `aria-expanded` 与该分组行数。
- 边界情况：当前会话是分组里唯一未归档会话；归档后没有新的当前会话（currentId 变 undefined）。
- 观察结果：
  - 修复前：归档后所有项目分组 `aria-expanded=false`、行数 0（截图 `/tmp/ct-verify-after-archive-old.png`）。
  - 修复后：`claude-theme` 分组仍 `aria-expanded=true`，剩 11 行；当前会话为 none，toast 正常（截图 `/tmp/ct-verify-after-archive-fixed.png`）。
  - 修复后在分组头上点两次：先收起（行数 0）再展开（行数 11），显式点击仍然有效。
- 原因：`expandedGroups === null` 时展开状态由 `currentGroupKey` 现算；归档当前会话让 current 消失，默认值退化成「只展开置顶/分区」，所有项目分组跟着收起。此前那次「物化」因为 `return previous`（previous 仍是 null）没有真正写进 state。
- 修复：默认展开集合只在视图建立时写进 state 一次；之后自动展开当前分组只加不减，收起只来自点分组头；`groupBy` 切换时重新物化。新建分区显式补进展开集合，保持默认展开。
- 落地位置：`src/client/features/workspace-browser/index.js`。

### 会话内图片缩略图与统一弹窗（2026-11-07）

- 参考环境：Claude Code 桌面端（用户提供的截图：工具调用摘要行右侧带缩略图，文件名/缩略图都可点开原图）。本机未再跑一遍 Claude Code，行为按截图对齐；DSH 侧的可见结果全部实测。
- 验证环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/Users/dtstack/.dsh-imgtest`，复制真实会话数据后新建 `imgtest` web profile，`dsh --profile imgtest --port 57888`；ego-browser 打开带 token 的 Web GUI。真实 profile 不参与验证。
- 测试会话：让测试会话里的 Agent 调用 `read_image` 读取 `/tmp/ct-imgtest/e-F2-book-doctor.png`，再让它在正文里输出一个指向同一文件的 Markdown 链接和一个指向 `README.md` 的非图片链接。
- 复现步骤与观察：
  1. 进程摘要行「已完成，用时 5 秒」折叠时，右侧出现 32px 缩略图（`[data-ct-turn-image-thumbs] button`，src=`/api/file?path=...`）；点击后出现 `[role=dialog][aria-label=图片预览]`，遮罩 `rgba(0, 0, 0, 0.72)`，右侧抽屉宽度仍为 0，进程保持折叠。
  2. 展开进程组后，摘要行缩略图隐藏，`[data-step-process]` 的「已读取图片」行右侧出现文件名 `e-F2-book-doctor.png` + 缩略图；点文件名或缩略图都开同一个弹窗，分组 `aria-expanded` 不变（不会误触折叠），右侧抽屉宽度仍为 0。同一轮读两张图片时，摘要行显示 2 个缩略图，分组行显示第一个文件名 + 2 个缩略图；点第二个缩略图打开的是 `e-F2-book-doctor-2.png`，不是第一张。
  3. 展开工具行后点 `read_image` 的文件链接，开弹窗而不是右侧抽屉。
  4. 点助手正文里的图片 Markdown 链接（渲染为文件 mention `图像`），开弹窗，右侧抽屉宽度 0。
  5. 点同一段正文里的非图片链接（`README.md`），仍打开右侧文件抽屉（宽度 670），不出现弹窗。
  6. 在输入框添加同一张图片，点「查看原图」，原生灯箱遮罩也是 `rgba(0, 0, 0, 0.72)`；说明 skin 的 `--ct-image-preview-mask` 同时控制原生消息图片/输入框附件和插件弹窗。
- 边界：非图片文件、无缩略图的普通工具行、`read` 文本行不受影响；缩略图 `img` 加载失败时按钮自动移除；同一会话主屏和分屏复用同一 turn 图片 store，按挂载次数计数。
- 证据：`/tmp/ct-imgtest/final-verified-group.png`（最终构建、新会话：分组行文件名 + 缩略图）、`/tmp/ct-imgtest/final-multi-summary.png`（折叠摘要行 2 个缩略图）、`/tmp/ct-imgtest/final-multi-group.png`（分组行文件名 + 2 个缩略图）、`/tmp/ct-imgtest/final-modal.png`（弹窗）、`/tmp/ct-imgtest/modal-filelink.png`（文件名点开弹窗）、`/tmp/ct-imgtest/modal-markdown-link.png`（正文图片链接）、`/tmp/ct-imgtest/nonimage-drawer.png`（非图片仍开右侧抽屉）、`/tmp/ct-imgtest/composer-modal.png`（输入框附件原生灯箱同一遮罩）。
- DSH 差异：折叠摘要行仍显示 DSH 的「已完成，用时 X」，不是 Claude 的「已读取 N 个文件」；图片文件名和缩略图放在可展开的「已读取图片」分组行与摘要行右侧。选择不改 DSH 的 process 文案，避免侵入 DSH 的通用过程语义。
- 落地位置：`src/client/features/image-preview/index.js`、`image-preview.css`、`src/client/shared/image-preview.js`、`src/skins/claude/skin.css`；`conversation-rewind` 的交付图片改为复用同一入口。

### MCP 工具按需加载与 provider tool-addition 兼容（2026-11-08）

- 验证环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/tmp/dsh-mcp-verify-home`（验证后删除），`mcp-verify-web` web profile（端口 3099，`dsh --profile mcp-verify-web --port 3099 --no-open`）；profile 挂 `claude-code-mode`（link）+ 内置 `@deepseek-ai/dsh-mcp-client`，MCP server 是 `test/servers/fake-mcp.mjs`（12 个工具，纯 stdio JSON-RPC）；ego-browser 打开带 token 的 Web GUI。
- 第一次尝试（保留 `llm-deepseek` 模型定义的 `toolUpdate: addition-only`）：
  1. 首轮 `request/header`：tools=36，`mcp__fake__*`=0，`mcp_tool_search`=true；模型调用 `mcp_tool_search("echo")`，结果命中 `mcp__fake__echo`。
  2. 第二步 `request/header`：tools=37，`mcp__fake__*`=1；DSH 按 tool 变化追加 `developer/message` 的 `tool-addition`，请求返回 400 `INVALID_REQUEST`，会话 `turn/end` 报错。
  3. 直接对同一 MaaS 路由发 Messages 请求：带 `tool_addition` 块（含 `mid-conversation-tool-changes-2026-07-01` beta）返回 400 `InvalidParameter: Request body format invalid`；同样的消息去掉 `tool-addition`、只新增 tools 列表项返回 200。确认是 provider 不支持 tool-addition，不是插件搜索/目录逻辑。
- 修复与复验（删掉 `toolUpdate: addition-only`）：
  1. 新建会话首轮 `request/header`：tools=36，`mcp__fake__*`=0，`mcp_tool_search`=true；system prompt 出现 “12 MCP tools from "fake" are not loaded”。
  2. 模型调用 `mcp_tool_search("echo")`，搜索结果 “Found 1 MCP tool … 11 still deferred”；下一步 `request/header`：tools=37，`mcp__fake__*`=1。
  3. DSH 的 `projectToolUpdates` 在模型未声明 `toolUpdate` 时自动剥离 developer 消息（会话日志里仍有 `developer/message`，但实际请求不带 `tool_addition`）；模型调用 `mcp__fake__echo`，结果 `echo:hello-from-e2e`，1 轮 3 步完成。
  4. 重启隔离宿主后打开同一会话继续问 “Call mcp__fake__echo again … Do not call mcp_tool_search”：首轮 `request/header` 的 reason=`resume`、tools=37、`mcp__fake__*`=1、`mcp_tool_search`=true；模型直接调用 `mcp__fake__echo` 返回 `echo:resumed-turn`，没有重新搜索。active 集合从 `session.requestHeader()` 恢复的路径成立。
  5. 关闭 `mcp-fake` 后新建会话：首轮 `request/header` tools=32、`mcp__*`=0、`mcp_tool_search`=false；`system/message` 不含 “Deferred MCP tools”。没有 MCP 的 profile 不注册可见工具、不写 prompt 段。
- 证据：`/tmp/ct-mcp-search-evidence/success.png`（Web GUI 最终结果）、`/tmp/ct-mcp-search-evidence/session-success.jsonl`（成功会话事件流，seq 12/25 两个 `request/header`）、`/tmp/ct-mcp-search-evidence/session-success-resumed.jsonl`（含重启后 seq 43 的 resume header）、`/tmp/ct-mcp-search-evidence/session-no-mcp.jsonl`（无 MCP 对照）、`/tmp/ct-mcp-search-evidence/session-with-toolUpdate-addition-only.jsonl`（400 失败会话事件流）、`test/servers/fake-mcp.mjs`（测试 server）。
- 真实 REA 复验（2026-11-08）：`rea@6.4.0`，`rea mcp doctor --json` 报 170/170 tools、6/6 prompts healthy；隔离 `DSH_HOME=/tmp/dsh-rea-verify-home` + `rea-verify-web` profile（端口 3098）挂同一个 `mcp-rea` 条目：
  1. 首轮 `request/header`：tools=36，`mcp__rea__*`=0，`mcp_tool_search`=true，tools 序列化约 31.7 KB。
  2. 模型调用 `mcp_tool_search("binary session")`；下一步 `request/header`：tools=44，`mcp__rea__*`=8，tools 序列化约 41.9 KB。
  3. 模型调用 `mcp__rea__binary_session`（`{}`），`isError=false`，结果约 49,932 字符；1 轮 3 步完成。说明不是只在 fake server 上成立，170 工具规模同样首轮为 0。
- 证据（真实 REA）：`/tmp/ct-mcp-search-evidence/rea-session.jsonl`（seq 12/25 两个 header）、`/tmp/ct-mcp-search-evidence/rea-success.png`、`/tmp/ct-mcp-search-evidence/rea-mcp-doctor.json`。
- 结论：插件侧只补目录/搜索/可见性；provider 是否支持中途 tool-addition 属于模型路由能力。路由不支持时不要声明 `toolUpdate: addition-only`，工具列表变更本身仍被接受（已用 curl 与真实 DSH 请求双重确认）。
- desktop 宿主实测（2026-11-08）：desktop profile 加入 `mcp-rea` 后 `plugin_manager` 显示 `include:mcp-rea` active；`Tool/listTools` 返回 170 个 `mcp__rea__*` + `mcp_tool_search`。当前桌面会话的事件流：`request/header` reason=change tools=40、`mcp__rea__*`=0、`mcp_tool_search`=true；调用 `mcp_tool_search("binary session", limit 3)` 后下一步 header tools=43、`mcp__rea__*`=3；调用 `mcp__rea__binary_session` 返回 `isError=false`。这证明运行中的 desktop 宿主也走通了，不只是隔离 web。
- 未验证：子代理独立 active 集合；分叉会话恢复 active（代码路径与恢复会话相同，未单独跑 e2e）。

### 侧栏中间滚动、头尾排除、去品牌与新建行统一（2026-11-09）

- 需求：Claude 的左侧栏滚动区域要排除顶部 header（折叠按钮行）和底部账户卡片；从「新建 → 面板 → 搜索 → 会话列表」这一段的滚动条独立，头尾完全不参与滚动；顶部没有品牌 logo；新建与下面搜索/面板菜单项同款。
- DSH 现状：运行时侧栏根的直接子是 `logoRow → button.newSession → nav.panelList → .regionArea(内部列表滚动) → .footArea`；只有 `.regionArea` 里的会话列表自己滚，新建/面板固定，且没有中间滚动容器。
- 修复：`installSidebarShell()` 在展开态创建一个 `data-ct-sidebar-scroll` 中间容器（插在 header 之后、foot 之前），把 newSession、panelList、regionArea 移进去作为它唯一的三个子项；侧栏根 `overflow: hidden` 不再滚，中间容器 `flex:1; min-height:0; overflow-y:auto` 是唯一滚动容器；折叠态（根宽 < 120px）中间容器 `display: contents`，三个座位回到原生 rail 布局。header 与 foot 在容器外固定占位。newSession 仍用原生按钮，只覆盖样式；插件卸载时把三个节点移回根并移除容器。
- 复现环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/tmp/dsh-verify-home` + `verify` web profile 副本（端口 50595，插件 link 到仓库；验证后删除），ego-browser 打开带 token 的 Web GUI。
- 观察（视口 1133×811）：
  1. 结构：root `overflow: hidden`、`padding-top: 0`；中间容器 rect x=8 y=42 w=264 h=711，`display:flex`、`overflow-y:auto`，子项顺序 `BUTTON / NAV / DIV(region)`；header x=0 y=0 w=280 h=42；foot x=8 y=753 w=264 h=52；wrapper scrollHeight 2408 / clientHeight 711。
  2. 滚轮 800：wrapper.scrollTop=800；header 仍 y=0 h=42、foot 仍 y=753 h=52（rect 完全不变）；newSession y 42→-758、搜索 y 200→-600，滚出 wrapper 顶部后被裁剪，不会经过 header 或 footer。
  3. 刷新页面：wrapper 重建、三个子项顺序正确；依次打开「插件」面板、展开分组、折叠、展开后 `window.__ctErrors=[]`，全页仍只有 1 个 `[data-ct-sidebar-root]` 和 1 个 `[data-ct-sidebar-scroll]`。
  4. 折叠：root 宽 55、`data-ct-sidebar-collapsed=true`、overflow visible；wrapper `display: contents`；header y=18、newSession 36×36、foot 54 高，原生 rail 布局；展开后 wrapper 恢复 flex、scrollHeight 1184 / clientHeight 711。
  5. 深色/顶部无透出、内容不足时头尾固定（同前一轮 sticky 版本已覆盖，布局位置一致）。
- 证据：`/tmp/inner-scroll-fixed.png`（结构）、`/tmp/inner-scroll-scrolled.png`（滚动 800，头尾不动）、`/tmp/inner-scroll-collapsed.png`（折叠 rail）、`/tmp/inner-scroll-actions-expanded.png`（面板/分组/折叠交错操作后）、`/tmp/inner-scroll-initial.png`。
- 桌面端：desktop profile 是 `link:`，构建后 client-hmr 自动更新（截图时未重启宿主）；`/tmp/desktop-inner-scroll.png` 显示顶部 header 固定、无 logo、新建/插件/自动化任务同款、底部账户卡片固定。桌面滚动未用 osascript 复验（System Events 辅助访问被系统拒绝），滚动行为与 Web 共用同一实现。
- 发布：真实 web profile 是 `file:` 复制安装，已把 `lib/` 同步到 `~/.dsh/profiles/web/node_modules/claude-code-mode`（client.js md5 与仓库一致）；桌面 profile 由 link 自动。

### Claude 式右侧面板与 header 入口条（2026-11-08）

- 需求：右侧面板像 Claude 一样多块并排、每块有自己的标题栏与关闭；会话右上角把内置面板入口排开，放不下的收进「更多」。
- Claude 行为（参考会话逆向）：右栏是 tile 树，每列最多 2 个、第 3 个向右开新列；pane 头是图标 + 标题 + 工具 + 关闭；header 右上角固定一排入口，窗口变窄时多余入口进「more」。
- DSH 现状与硬限制：原生 `rightbar.session` 由 `DockLayout` 渲染，`TabLayout.tsx` 只接受「1 个 pane 或 2 个水平 pane」，第 3 格直接 `throw`；store 的 `splitPane` 在 `dockPaneIds >= 2` 时放弃；`dropTab` 对 `top`/`bottom` 直接返回空（上下分栏没有入口）。插件不能改这些源码。
- 方案：接管 `rightbar.session` 席位的**渲染**（wrap 注册条目，保留原生 props：`sessionId`/`renderSlot`/`store`/`occurrence`/`useTabTypes`/`useTabNavigation`/`syncPresentation`），布局自绘；tab 内容仍走原生 `sidebar.right.pane.tab` slot，文件树/终端/浏览器/Git/文档都不用重写。布局状态继续写原生 store（`openContent` 的 `preferNewPane` 不受两格限制，因为不再经过 `TabLayout`）。
- 打开语义：第一次打开占用 guide 所在 pane（避免留下不可见的 guide 列）；之后每次开新列；新列出现后把根 split 均分。guide 常驻 tab，只在没有其他面板时显示。
- 入口条：从 `sidebarRightTabs.guide()` 读已注册入口（含第三方 Git），按 header 行实际宽度计算可放数量，放不下的进「更多」菜单；菜单 portal 到 body，避开 header 的 `overflow: clip`。
- 差异与限制：pane 只能左右排列（上下分栏被 store 拒绝）；pane 内多个 tab 只显示 active 一个（切回入口走 header 按钮）；收起/全屏/关闭在 pane 头自绘；右栏宽度仍由 frame 决定。
- 验证环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/Users/dtstack/.dsh-sidetest` + `sidetest` web profile 副本（端口 58877，插件 file: 安装后同步 lib），ego-browser 打开带 token 的 Web GUI。
- 观察（最终版，独立实例 58877，构建产物与主 DSH 同一份）：
  1. 打开「工作区文件」+「新建终端」+「Git」后出现 3 个 pane，均分 223/223/223；每列标题栏为图标 + 标题 + 全屏/收起/关闭；文件树、终端、Git body 都正常渲染，无 `data-slot-error`（`/tmp/final-9-even.png`）。
  2. 拖动第一根分隔条（x=1038）右移 60px：预览 0.62/0.13/0.25，松手后文件 282 / 终端 163 / Git 223，`resizeSplit` 已写回 store（`/tmp/final-10-drag.png`）。
  3. 关闭终端 pane：剩文件 + Git 两列，空 pane 被原生 `planSettle` 合并，无错误（`/tmp/final-11-close.png`）。
  4. 刷新：两列（335/335）从原生 store 恢复，入口条 3 个，无错误（`/tmp/final-14-restored.png`）。
  5. 窄窗口 900px：`data-ct-sp-budget=0`，入口全收进「更多」；点开后菜单 3 项（工作区文件/新建终端/Git）可见（`/tmp/final-12-narrow.png`）。
  6. 收起右栏后原生 corner 出现「打开右侧边栏」；pane 头「收起右侧边栏」让右栏宽度归零（`/tmp/sp-17.png`）。
  7. 全屏：面板 fixed 覆盖 1488×969 视口，退出恢复 670px（`/tmp/sp-full4.png`）。
  8. 深色：root 背景 `rgb(21,21,23)`、pane `rgb(35,35,36)`、标题文字 `rgb(249,250,251)`、分隔线 `rgba(255,255,255,0.12)`，全部来自 DSH 令牌（`/tmp/sp-dark2.png`、`/tmp/sp-dark3.png`）。
  9. 分屏（overlay）下刷新：主屏与 overlay 的右栏 seat 都渲染自绘面板，overlay 右栏 240px 显示 guide，无 slot 错误（`/tmp/sp-split-2.png`）。
- 证据文件：`/tmp/final-1-header.png`（入口条）、`/tmp/final-5-single.png`（单 pane 文件）、`/tmp/final-9-even.png`（三列）、`/tmp/final-10-drag.png`（拖拽）、`/tmp/final-11-close.png`（关闭）、`/tmp/final-12-narrow.png`（窄屏更多）、`/tmp/final-14-restored.png`（刷新恢复）、`/tmp/sp-full4.png`（全屏）、`/tmp/sp-dark3.png`（深色）。
- 主 DSH 发布：`web` profile 是 `file:` 复制安装，已同步 `lib/client.js`（md5 `12a1824a5c4d43d296efd0a83cdd1f41` 与仓库一致）与清单文件；desktop profile 是 `link:` 到仓库，client-hmr 自动更新，桌面窗口已确认 header 入口条渲染。
- 原生入口与原生抽屉的清理（2026-11-08）：
  1. 原生 guide（「开始」卡片页）不再渲染：右栏只有 guide 时显示自绘空态（`data-ct-sp-empty-state`，文案「右侧面板 / 从会话右上角的图标打开文件、终端或 Git」），在独立实例上关闭全部面板后复验：`roots[0].text` 为自绘文案，不含「工作区文件/新建终端/Git」卡片。
  2. 原生 header corner 的「打开右侧边栏」按钮被 CSS 停用（`[data-sidebar-right-expand] { display: none }`）；收起右栏后该按钮 `display:none`，入口条（files/terminal/git）仍在，点击入口可重新展开（664px）。
  3. 自绘面板补回原生 DOM 标记 `data-sidebar-right-panel` / `data-sidebar-right-open` / `data-sidebar-right-session`：分屏后两个右栏（主屏 + overlay）都是 240px，`open=true`，`workspace-browser` 的 `readSplitFrame` 能识别，无 slot 错误。
  4. 分屏右栏 240px 下 `data-ct-sp-compact=true`，只渲染当前一个 pane（Git 或 guide 空态），不再出现多列挤成图标条。
### Claude 式右栏第二轮：落位、多开、最大化与分屏独立（2026-11-08）

- 需求：1) 面板全关后右栏应收起；2) 新面板要有上下分行；3) 终端可多开；4) 去掉 pane 头的「收起」按钮，抽屉开合看有没有面板；5) pane 头固定「最大化 + 关闭」，其余自定义；6) 最大化是当前面板而不是整栏；7) 分屏时每个屏幕的右栏独立。
- 实现：`layout.js` 直接编辑 `LayoutState`（DSH 的 `planSplitPane` 固定 row、`dropTab` 拒绝 top/bottom，所以绕过公开 split，用 `ctpane*` / `ctsplit*` 前缀避免与原生 mint 冲突），再写回原生 store；`side-panel.js` 改为 pane 级渲染：tab chips、`+` 多开、最大化按钮、关闭按钮，无面板时 effect 收起。
- 验证（独立实例 58877，ego-browser）：
  1. 依次打开文件、终端：`column[文件, 终端]`，各 478 高（上下）——`/tmp/v2-5-three.png`。
  2. 再打开 Git：`row[column[文件,终端], Git]`，第三块整列 957 高（新列）。
  3. 再打开终端：`row[column[文件,终端], column[Git,终端]]`，四块 2×2——`/tmp/v2-13-four.png`。
  4. 终端 pane 头「+」：同一 pane 内出现两个「终端」chip（`cttab*` 两个记录）。
  5. 「最大化面板」：只渲染当前 pane（664×957），按钮变「还原面板」，再点恢复上下两 pane。
  6. 关闭全部面板：右栏自动收起（`[data-ct-sp-root]` 消失、两个 `[data-sidebar-right-panel]` 宽度 0），不再停在空态；刷新后保持收起。
  7. 上下分隔条拖拽：pane 高 478/478 → 358/598，写回 store。
  8. 分屏（主屏 + overlay）：两边右栏各自 240px、`data-sidebar-right-open=true`、各自渲染一个 pane；关闭两边全部面板后两个右栏都收起；无 slot 错误——`/tmp/v3-6-main-open.png`。
- 分屏右栏与入口交互（2026-11-08 第三轮）：
  1. 分屏后 overlay 右栏默认没有：根因是「无面板自动收起」的 effect 在 overlay 初始 guide 时就 `setExpanded(false)`，把 workspace-browser 初始化出来的右栏收掉了。改为只在「用户关闭最后一块面板」这个动作里收起（`closePaneTab` / `closeKind` 里判断 `shouldCollapse`），渲染时不再抢收起。验证：分屏后两个 `[data-sidebar-right-panel]` 各 240px、`data-sidebar-right-open=true`，overlay 右栏 241px，两个 header 入口条各 3 项。
  2. header 入口加选中态：按钮按当前会话布局里是否存在该 kind 的 tab 标 `data-active`（面板打开时高亮，和左侧会话列表选中语义一致）。
  3. header 入口改为 toggle：点击已打开的入口走 `closeKind(kind)` 关闭该面板（验证：`__ctClose.found=1, nextKinds=[]`，按钮取消高亮）；未打开则照旧打开。
- 分屏宽度、入口选中与分割线（2026-11-08 第四轮）：
  1. 分屏右栏宽度从固定 240px 改为按屏宽比例：主屏 `RIGHTBAR_OVERLAY_WIDTH` 下限 + `SPLIT_RIGHTBAR_SHARE = 0.4`；overlay 右栏 CSS `flex: 0 0 40%`（`min-width: 240px`）。实测 overlay 右栏 241px（分屏 pane 约 600px 时）。
  2. 窄宽下不再把所有 pane 收成一个：只有布局里出现 `axis: 'row'` 的分列时才 `compact` 收单块，纯上下排列（文件/终端）在分屏右栏里保留多块。
  3. 入口选中样式补进 CSS：`data-active` 用 `color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent)` 派生浅底，深浅色都可见；实测 computed `background: color(srgb 0.078 0.078 0.074 / 0.1)`。
  4. 右栏与聊天区之间补 1px 左边框（`var(--dsw-alias-border-l2)`）；分屏 overlay 容器自带左边框，收起态/全屏不重复画。实测 `border-left-width: 1px`。
- 分屏右栏收起态空白（2026-11-08）：给 overlay 右栏加 `min-width: 240px` 后，收起态 `width: 0` 被 min-width 撑住，overlay 右栏收起时仍占 240px，表现为右侧一大片空白。补 `[data-ct-overlay-rightbar-open="false"] { min-width: 0 }` 后实测：展开 241px → 收起 0px → 再展开 241px。
- 分屏与屏内右栏解耦（2026-11-08）：原则是「分屏只决定屏的尺寸和位置，屏内右栏按屏宽比例自适应」。去掉了右栏 240px 硬下限：主屏 `rightbarW = max(180, round(nativeW * 0.4))`（`nativeW >= 480` 才显示），overlay 右栏 `flex: 0 0 40%`（`min-width: 180px`，收起时 `min-width: 0`）。实测单屏右栏 646px 不受影响；分屏后主屏右栏 231px、overlay 右栏 232px（约 nativeW 的 40%），右栏内打开的面板状态不变。
- 按 Claude 栏内逻辑收敛（2026-11-08 第五轮）：新增 `src/client/shared/panel-widths.js`，按逆向结论实现类型权重——宽面板（files/file/preview/artifact/diff/pr/cr/watercolor/mcpapp/document）默认 flex 3、其余（terminal 等）flex 1、chat 固定 2，面板占比 `flex/(2+flex)`（宽面板 60%、终端 33%）。分屏时主屏右栏宽度按当前 active pane 的 kind 计算，overlay 右栏通过 `--ct-overlay-rightbar-share` 变量应用同一比例；面板内部的 split 列/行加了 Claude 的最小尺寸（列 280px、行 100px，空间不足时按均分下限压缩，避免溢出）。
- 与 Claude 仍存在的差距：单屏右栏宽度仍由 DSH frame 决定（ui-layout 没有公开的 `setRightbar`，插件改不了 track 宽度），所以单屏不随 kind 变化；「按类型记住上次拖过的宽度」未做（拖动只改本会话比例，没写回类型记忆）；关闭时的 slot 记录/恢复未做（重开按规则重新落位）；拖 pane 改结构（split/wrap/insert）未做（只支持拖分隔线改比例）。
- REA 求证与 slot 恢复（2026-11-08）：直接读本地逆向产物 `claude-reverse/unpacked/ion/assets/v1/`，确认了 `Ts()`（宽面板 flex 3 / 其余 1 / chat 2、`last.kind` 决定上下还是新列）、宽度记忆公式 `2 * tile.flex / chat.flex`、以及 `closedPaneSlotsBySession[sessionId][kind]` + `St/Pt` 的关闭位置记录/恢复。按用户选择保留 rightbar 列，补齐了关闭 slot 恢复：关闭 tab/pane 时把 `{ paneId, index }` 记进会话级持久化，重开同类面板时如果原 pane 还在就插回原 index；会话存储里多了一个 `slots` 字段（旧数据缺省为空，兼容）。
- 纯函数验证（node 直接 import `layout.js` / `panel-widths.js`）：slot 恢复到 index 0 → `['tab3','tab1']` 且 active=tab3；关闭 tab1 后 `['tab3']`；`paneShare` files=0.6、terminal=0.333、document=0.6；`activePaneKind` 返回 terminal。
- 仍不做（有明确原因）：单屏右栏宽度按 kind（frame 的 inline grid track，无 `setRightbar` 公开 API）；类型记忆（DSH 没有「右栏 vs chat」分隔条，拖动的分屏分隔改的是屏宽，不是面板宽度，记忆没有落点）；拖 pane 改结构 `split/wrap/insert`（只支持拖分隔线改比例）。
- 加列时的尺寸重分配（2026-11-08 第六轮）：读 `c9543da06` 的 `yo()` 并与 Claude 一致地移植到 `panel-widths.js` 的 `distribute(weights, mins, avail)`——先按权重分、低于最小尺寸的锁定为最小值、空间不足时按最小尺寸比例整体压缩。面板 split 渲染改为用 `distribute` 计算列/行权重（列 min 280、行 min 100），不再是简单等分。
- 加列压缩 chat：新增 `panelRowShare(layout)`——根 row 每列按 active kind 的 flex 求和，`share = Σflex/(2+Σflex)`，加列时总 flex 变大 → 右栏变宽、会话被压缩。分屏主屏与 overlay 右栏宽度都改用它（overlay 通过 `--ct-overlay-rightbar-share`）。
- 纯函数证据：1 列 files share=0.600、2 列（files+terminal）=0.667、3 列（+git）=0.714；屏宽 1200 时右栏 720→800→857；`distribute([0.6,0.4],[280,280],700)` 返回 [1.2,0.8]（像素 420/280，第二列正好最小）。
- 单屏限制：frame 右栏列宽固定，`panelRowShare` 只作用于分屏；单屏加列时只能压缩右栏内部列（`distribute` 的 min 兜底），chat 不变。
- 窄宽不再隐藏分栏（2026-11-08 第七轮）：复盘了三种「窄宽隐藏」的来源——1) 我们的 `compact`（右栏 < 320 且含左右列时只渲染一个 pane）；2) 我们的分屏阈值 `nativeW >= 480`（否则主屏右栏宽度 0）；3) DSH `ui-layout/columns.ts` 的 `canShow`（`available < RIGHTBAR_MIN(300)` 时右栏列宽 0，单屏窄窗口自动收起，插件改不了）。按 Claude「放不下只压缩、不减少列/不隐藏 pane」的口径修掉前两处：`compact` 只保留 `data-ct-sp-compact` 标记、不再收 pane；分屏主屏右栏只要 `rightbarOpen` 就按比例显示（`max(180, nativeW*share)`，上限 `nativeW-1`）。
- 实测（独立实例 58884，窄视口 900×800）：单屏右栏 444px、两个 pane（文件/终端）都保留；分屏后主屏右栏 347px、overlay 右栏 231px，都 `data-sidebar-right-open=true`，主屏两个 pane 仍各 346×478，无 slot 错误。证据：`/tmp/v17-3-narrow.png`、`/tmp/v17-4-narrow-split.png`。
- 右栏打开改由「是否有面板」决定（2026-11-09 第八轮）：不再用独立的 `expanded` 值占位——渲染时 `shown = 有展开 && 布局里有非 guide 面板`；没有面板时只渲染隐藏节点（保留 ref），不再显示空态，原生 track 上报 false，frame/overlay 宽度自动释放。overlay（分屏）里的无面板右栏额外写回 `expanded=false`，让 workspace-browser 的开关同步收起；主屏不写回（避免误清用户已打开的面板）。
- 实测（独立实例 58888，清掉旧持久化后）：无面板时两个右栏宽度 0、root 不渲染；打开文件后主屏 295 显示；分屏时无面板的 overlay 右栏 0、不出现空态；关闭分屏后主屏 568 保留已打开的文件面板；插件页右栏列宽 8px（不占位）、overlay 全宽 1262。
- 注意：之前「无面板就收起」写回 `expanded=false` 的版本会误清主屏已打开的面板（分屏瞬间主屏布局短暂为 guide-only），已去掉主屏写回，只保留渲染层判断与 overlay 写回。
- 未验证：桌面窗口内的点击/拖拽（System Events 辅助访问被拒）；第三方面板的 header 自定义按钮（没有公开注册点）。主 web profile 已同步 `client.js` md5 `7e6e28424817a333f7984df596af5134`。
- 布局与最大化持久化（2026-11-08）：原生 `dsh.sidebar-right.v1` 的 `persistence.ts` 只接受 `paneN/splitN/tabN` id、根 split 必须是 `row` + 恰好 2 个孩子，我们的多列/上下结构会被 `validateReferences` 判非法并 `clearSidebarLayout`（实测刷新后布局丢失、最大化状态被连带清掉）。改为插件自己的会话级持久化，key 形如 `ct.sidePanel.session.v1.<sessionId>`，值 `{ version, layout, maximized }`——与 DSH `@deepseek-ai/dsh-client-store` 的 `defineStore({ persist: name })` + `create(scopeKey)` 惯例一致（该包不在插件可 require 的种子包里，只能按同形状自实现）；旧的大 map / 两个分开的 key 会在首次读取时一次性迁移并删除。内存里布局仍以原生 session store 为唯一真相，最大化按会话同 key 存、渲染时校验目标 pane。实测：最大化后刷新仍只显示该 pane（664×957、按钮为「还原面板」）；还原后刷新回到上下两块 478/478；localStorage 里只剩每会话一个 `ct.sidePanel.session.v1.*` key。
- 落地位置：`src/client/features/conversation-side-panel/`。

- 会话名后的下拉菜单（2026-11-09）：先确认 DSH 里「更多」和「打开方式」不是第三方插件，而是自带包 `@deepseek-ai/dsh-session-log-export` 与 `@deepseek-ai/dsh-client-ui-open-in-app` 注册在 `conversation.session.header.utilities` 上的按钮（前者自绘 ⋯ 菜单：复制 Markdown / 下载日志 / 反馈；后者是主按钮 + chevron 的分裂按钮），菜单不是 `contextMenus` 贡献，没有可直接搬走的槽位。实现改为：在 `conversation.session.header.actions`（标题旁）注册下拉按钮，菜单自绘但动作复用原生 `api/session.markdown`、`sessionLogDownload`、`feedbackUi` 与宿主 `open-in-app/apps`/`open`；原生两处按钮用 CSS 隐藏（`header[data-window-drag]` 内）。
- 验证环境：`DSH_HOME=/tmp/ct-hdr-home` + `web` profile 副本（`dsh-profile-hdrverify`，`claude-code-mode` link 到仓库），`dsh --profile hdrverify --port 54600 --no-open`，ego lite 打开 stdout 的 token URL。断言：菜单文本 `打开方式 / 复制会话为 Markdown / 下载 Session 日志 / 反馈`；子菜单 `访达 / Cursor / Zed / Xcode / IntelliJ IDEA / PyCharm / WebStorm / Ghostty / 终端`；复制后剪贴板以 `# 会话栏菜单原生还是插件能力` 开头并出现「Session 已复制为 Markdown」；下载弹出「Session 导出已开始下载」；反馈弹出「提交反馈」；打开方式 POST `open-in-app/open` 200 并提示「已在访达中打开」，强制 500 时提示「打开失败」；页面加载前注入空 apps 时菜单项 `disabled`；Esc 与点击外部都关闭菜单。证据 `/tmp/ct-hdr-web-12-copy.png`、`/tmp/ct-hdr-web-13-submenu.png`、`/tmp/ct-hdr-web-17-download.png`、`/tmp/ct-hdr-web-18-feedback.png`、`/tmp/ct-hdr-web-19-open-with-success.png`、`/tmp/ct-hdr-web-20-open-with-failure.png`、`/tmp/ct-hdr-web-22-empty-apps.png`。
- 未验证：桌面应用窗口（57269）没有收到 client-hmr 的 rebuilt——同一份产物在 Web 宿主正常，桌面窗口仍是旧 UI；桌面端「刷新页面」只在 development 构建的菜单里，辅助功能权限被拒（osascript -1719），需重启应用后才能看到。桌面 profile 的 `cordis.patch.yml` 追加注释触发重算也未使页面重载。
- 子菜单悬停收回（2026-11-09，用户反馈后修正）：二级菜单原来 hover 打开后不会因失焦/移开而收回。改为父项 `mouseenter` 打开、`mouseleave` 200ms 延迟关闭；子菜单 `pointerenter/mouseenter` 取消关闭、`pointerleave/mouseleave` 延迟关闭；移到其它菜单项也关闭；点父项可切换。实测：hover 打开 ✓、进入子菜单保持 ✓、移回父项保持 ✓、移开 500ms 内收回 ✓、hover 其它项收回 ✓、点父项切换关闭 ✓。证据 `/tmp/ct-hdr-web-25-submenu-fixed.png`、`/tmp/ct-hdr-web-26-toggle.png`。

- 桌面端 HMR 排查（2026-11-09）：通道本身正常——用皮肤 `--ct-canvas` 探针（`#faf9f5` → `#ffcccc`）构建，桌面窗口在前台 6 秒内变红、切到 Cursor 后台构建后 12 秒内也变红，还原后自动恢复。之前「每次都要重启」不是通道问题，而是插件重载失败后页面保留旧实例：日志里有 `client-modules: duplicate factory registration for "claude-code-mode" (bundle executed twice without invalidate?)` 与 `slot entry crashed in 'rightbar.session': TypeError: renderSlot is not a function`，DSH 的 entries.replace 失败后不会自动补载，桌面打包版又没有「刷新页面」菜单，只能重启应用。
- 加重该问题的插件侧原因：`conversation-side-panel` 与 `workspace-browser` 对原生 slot entry 的 `component` 补丁在 teardown 时无条件写回原组件；热重载时新实例先包一层、旧实例后卸载，会把新包装覆盖掉（右栏自绘/关闭按钮丢失，并可能触发 slot 崩溃）。已改为只在 `entry.component === 自己的 wrapper` 时恢复（与 rewind/image-preview 一致）。其余 patch 点（`conversation-rewind`、`image-preview`）原本就有该保护。
- 复测：改完再构建，桌面窗口 6 秒内从探针色恢复、标题后的下拉按钮仍在；Web 宿主同样正常（`/tmp/ct-hmr-probe-desktop-1.png`、`/tmp/ct-hmr-background-1.png`、`/tmp/ct-hmr-restored-1.png`）。

### 窗口 chrome、导航历史与 hover 浮层（2026-11-10）

- 实现：`src/client/features/window-chrome/`（固定 chrome、导航历史、peek），合并 `main` 的会话壳重构后提交 `ad254df` + merge `69e67d4`；Windows 标题栏不接管，提交 `942969e`。
- 独立验收环境：`DSH_HOME=/tmp/ccm-accept/home`（profile 副本，`claude-code-mode` link 到 worktree）+ `dsh --profile web --no-open --port 0`（62150），未触碰主 web/桌面进程；复制 3 个会话以验证导航历史。
- 固定位置：展开/收起/700px 抽屉三种状态 chrome rect 都是 `{x:12,y:11,w:100,h:28}`；强制 `data-platform=darwin` 并触发 resize 后为 `{x:88,y:11}`（收起列宽 0、leading seat 隐藏）；`data-fullscreen` 时 `x:12`。
- peek：收起列宽 56 → hover 后列 280.5，frame grid 始终 `56px 1137px 0px`，离开 200ms 后回 56；Esc 关闭；拖拽会话时保持，`dragend` 后关闭；抽屉模式下不打开。
- 导航历史：A→B→C 后 back 两次到 A、forward 两次回 C，中间栈为 `back 2/forward 1`、`back 1/forward 2`；无历史与到顶时按钮禁用；真实鼠标点击后退/前进也通过。
- 抽屉：700px 视口下抽屉开/关，chrome 位置不变，`elementFromPoint` 命中 chrome 按钮而不是遮罩；`console` 无异常、chrome 单实例。
- 安装：合并到 `main` 后 `pnpm build`；主 web（3080）刷新后同样出现 chrome，收起/peek/抽屉复测通过；桌面窗口截图确认红黄绿后 x≈88 处三个按钮。
- 未验证/限制：桌面窗口的实际点击/悬浮受辅助访问权限限制（`osascript`/REA `accessibility-denied`，CGEvent 点击不生效），只确认静态位置；桌面全屏、Windows、分屏与 peek 同时存在未单独复测；测试 profile 缺 `dsh-theme-codex`，不影响功能。
- 证据：`/tmp/ccm-accept/final-clean-peek.png`、`final-clean-drawer.png`、`merged-history.png`、`darwin-peek-noanim.png`、`main-web.png`、`main-web-peek.png`、`desktop-final2-top.png`（临时目录）。

### 侧栏浮层透底与 Web 收起残留 rail（2026-11-10）

- 现象：
  1. 桌面端收起侧栏后 hover「展开侧边栏」，浮出的侧栏抽屉是玻璃质感，盖在主内容上时透出下面的正文，读不清。
  2. Web 端收起侧栏后右侧仍留一列 56px 图标 rail（新会话/自动化/历史/插件/搜索/项目图标），桌面端收起后没有这一列。
- 根因：
  1. 桌面端的侧栏列背景是 DSH 的 vibrancy 玻璃（`AppFrame.module.css` 里 darwin 的 `.sidebarCol` 是 `color-mix(... 40%, transparent)` 渐变），peek 把列临时改成 280px 的绝对定位浮层后，半透明背景直接叠在主内容上。
  2. DSH `AppFrame` 给收起态的宽度是 `drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED`（56px）：Web 没有窗口级开关，原生要靠 rail 顶部的面板图标重新打开侧栏；本插件已经把同一个开关和 hover 浮层固定到窗口左上角，rail 就成了多余的一列，且与桌面端不一致。
- 修复：
  - `window-chrome.css` 的 peek 规则给浮层列加 `background: var(--dsw-specific-sidebar-fill)`（实底），选择器带 `html:not([data-windows-titlebar])` 前缀，特异性高过 darwin 深色主题的玻璃规则。
  - 新增 `src/client/features/window-chrome/rail.js`：在非 darwin、非 Windows 标题栏平台，收起且非抽屉时把 frame 内联 `grid-template-columns` 的第一段轨道换成 `0px`，其余两段原样保留；`MutationObserver` 跟随 React 重写（展开/收起/右栏变化），插件卸载时还原成 React 最后写的值。
  - 收起态去掉 `.sidebarCol` 的 0.5px 右边框（Web 没有 darwin 的 `border-right: none`），否则 0 宽列还留一条竖线。
  - Web 收起态 `--dsh-frame-leading-clearance: 120px`，会话 header 标题行让开 chrome 的三个按钮（12 + 28 + 8 + 28 + 8 + 28 + 8）。
- 验证：独立 `DSH_HOME=/tmp/dsh-test-sidebar-rail` + `web-rail` profile 副本（`claude-code-mode` link 到 worktree，端口 55710），未触碰主 web（57052）与桌面进程；ego lite。
  - 1120 视口、有会话：收起后 frame grid `0px minmax(0px, 1fr) minmax(0px, 0px)`，`.sidebarCol` 0×867 且 `border-right: 0px none`；主内容 header x=0、标题行 `padding-inline-start: 100px`（内容从 120 起，chrome 右缘 112）；展开回 `280px`，再收起回 0，无残留。
  - hover 开关：`.sidebarCol` absolute 280 高 867，`backgroundColor = rgb(247, 247, 247)`（不透明），主内容 titleRow x 保持 20 不动；移开后恢复 0 宽。强制 `data-platform='darwin'` 重测，浮层仍是实色 `rgb(247, 247, 247)`，DSH 的玻璃渐变被覆盖。
  - React 重写：把 grid 写成 `56px minmax(0px,1fr) minmax(0px,0px)`，120ms 内变回 `0px ...`；写成 `56px ... minmax(0px,360px)` 后保留右栏 360px，只压第一段。
  - 900px 视口（自动收起）：grid 0、`.sidebarCol` 0、标题行 padding 100；700px（抽屉）：grid 0、侧栏 `translateX(-100%)` 隐藏、peek 不打开，chrome rect 仍是 `{x:12,y:11,w:100,h:28}`。
  - 可摘除：PUT `{"disabled":["window-chrome"]}` 后刷新，chrome 消失、原生 `[data-sidebar-toggle]` 恢复 `opacity:1`，原生收起 grid 回到 `56px ...`；恢复 `disabled: []` 后 chrome 回来、收起重新压成 0。
- 未验证：真实桌面窗口里的 hover 浮层（辅助访问权限受限），只在 web 实例用 `data-platform='darwin'` 模拟验证；Windows 标题栏平台不接管。
- 证据：`/tmp/rail-final-collapsed-1120.png`、`/tmp/rail-test-peek.png`、`/tmp/rail-test-peek-darwin-sim.png`、`/tmp/rail-test-narrow-900.png`、`/tmp/rail-test-narrow-700.png`、`/tmp/rail-test-feature-off-collapsed2.png`。

### hover 浮层收回延迟（2026-11-10）

- 现象：hover「展开侧边栏」弹层后，指针离开要等一会儿才收回；离开后继续移动指针，几乎不收。
- 根因：`peek.js` 的 `onPointerMove` 每次在开关/浮层外移动都调 `scheduleClose()`，而它是 `clearTimeout` 后重新 `setTimeout(200)`。于是指针每动一次就把 200ms 倒计时清零重来，只有「停下 200ms」后才真正开始收；固定 200ms 的延迟再叠加重置，观感就是「走了半天才收」。
- 通用做法：hover 面板是「打开延迟 + grace period」——打开延迟过滤误触；关闭倒计时只在指针离开可交互区域的那一下启动一次，外部继续移动不延长，回到面板立即取消；指针离开窗口直接收。
- 修复：`peek.js` 加 `pointerInside` 状态机，只有跨越「开关/浮层」边界时才启动或取消关闭；`scheduleClose()` 幂等（已有倒计时不重置）；关闭延迟 200 → 120ms；`documentElement` 的 `pointerleave` 改为立即 `close()`。拖拽（`pointerDown`）与 Esc 行为不变。
- 验证（独立 `DSH_HOME=/tmp/dsh-test-sidebar-rail` + `web-rail` profile 副本，端口 55710，ego lite；页面内 `MutationObserver` 记录 `data-ct-sidebar-peek` 变化时间）：
  - 合成连续 `pointermove`（14 次 / 326ms）离开浮层：首次移动后 127ms 收起，远早于最后一次移动；旧实现会等最后一次移动 + 200ms。
  - 单次离开后静止：121ms 收起（`CLOSE_DELAY_MS = 120`）。
  - 离开 60ms 内回到浮层：保持打开。
  - 指针离开窗口（`pointerleave`）与 Esc：同一帧内收起。
  - 拖拽会话期间保持打开，松手在浮层外 120ms 后收起；真实鼠标从开关滑入浮层不会误收。
  - 页面无 `[data-slot-error]`，chrome 正常。
- 未验证：真实桌面窗口内的悬停（辅助访问权限受限），时序在 web 实例用同样代码路径验证。
- 证据：`/tmp/peek-close-final.png`（测试页面状态）、页面内事件时间戳见上。

### Web 侧栏顶部空白（2026-11-10）

- 现象：Web 展开侧栏时，「新会话」和窗口按钮之间有一大块空白；桌面端没有。
- 现场（用户 3080 实例，ego 接管其 space 只读测量）：侧栏根 `padding-top: 38px`（给 chrome 按钮让位）；第一个子元素是 SidebarRoot 的「品牌行」（y=38、42px 高，`data-ct-sidebar-logo="toggle"`），里面原生开关已被 chrome 以 `opacity:0` 隐藏、品牌按钮被 workspace-browser 隐藏，整行没有可见内容；滚动区从 y=80 开始，「新会话」y=81，chrome 按钮底 39 → 按钮到内容 42px 纯空白。
- 根因：桌面端顶部有 topStrip 52px 承载交通灯和窗口按钮，品牌行紧贴其下，视觉上像工具栏的一部分；Web 没有 topStrip，38px 让位里只有三个按钮，空品牌行直接裸露成空白。另外 peek 浮层打开时侧栏会重新挂载，`data-ct-sidebar-logo` 标记还没跟上，按标记隐藏会漏掉这一行。
- 修复：Web 顶部让位 38 → 44px（按钮底 39 + 5px 呼吸）；用结构选择器隐藏展开态的第一行品牌行——`[data-ct-sidebar-root][data-ct-sidebar-collapsed='false'] > :first-child[data-window-drag]`，另加一条 `[data-ct-sidebar-peek]` 条件下的同款规则覆盖浮层重挂载；折叠态（rail 的 logoRow 就是展开按钮）不受影响。
- 验证（隔离实例 55710，ego）：展开态 `padding-top 44`、首行 `display:none`、滚动区 y=44、新会话 y=45，chrome 底到内容 6px；收起态 grid `0px`、rail 仍被裁剪；peek 浮层首行同样隐藏、新会话 y=45；页面无 `[data-slot-error]`。
- 证据：`/tmp/user-3080-sidebar-gap.png`（修复前现场）、`/tmp/web-gap-fixed2-expanded.png`、`/tmp/web-gap-fixed2-peek.png`。

### 分屏关闭：关右侧 overlay 后回到主壳会话（2026-11-10）

- 现象：左右两屏时点右屏 header 最右的关闭 ×，右屏消失，但全屏留下的是右屏会话；用户看到的是「关闭右侧分屏，反而左侧被关掉」。
- 复现：独立 `DSH_HOME=/tmp/dsh-closefix-home` + `closefix` web profile（`claude-code-mode` link 到 worktree，端口 57901），ego lite 用会话行菜单「在分屏中打开」形成左右两屏（root=`session-5c6dbbfb…`，overlay=`session-0f69b0f7…`），再点 overlay 的关闭按钮。修复前单屏只剩 overlay 会话，修复后单屏回到 root 会话。
- 根因：`closeCell` 关掉最后一个 overlay 后只清 `extraTree`/`bottomCellId`，没有把窗口级选中会话从刚关闭的 overlay 切回 `rootSessionId`；单屏壳按窗口 `mainView` 渲染，于是显示被关闭的那一屏。退出分屏也没有清 `rootSessionId`，下次分屏会沿用旧主屏；关闭主壳提升 overlay 时 `rootSessionId` 未更新，分屏还在时原生壳会继续显示被关闭的主屏会话。
- 修复：`createSplitController` 增加 `syncWindowSession` 与 `focusedPaneSessionId`；`closeCell` 每个分支在 emit 前把窗口选中会话对齐到新的聚焦屏，关闭最后一个 pane 时先切回主壳会话再清 `rootSessionId`；关闭主壳提升 overlay 时把 `rootSessionId` 更新为被提升的会话，窗口选中跟随聚焦屏。
- 验证：关闭右侧 overlay → 剩 root 单屏；上下两屏关闭下屏 → 回上屏；三屏（root + native bottom + 右侧 overlay）关闭右侧 → 保留左上 + 左下整宽上下两屏、焦点左下；关闭左下 native bottom → 回 root 单屏；刷新恢复后关闭右侧 → 回 root；关闭未聚焦的右侧 → 回聚焦的 root；关闭主屏 → 右侧 overlay 提升为 root，三屏时 native bottom 提升为新 root 且右侧 overlay 保留并聚焦；退出后重新分屏主壳是当前单屏会话。页面无 `[data-slot-error]`。
- 主仓库复验：修复提交 `bdff6af` 合并到 `main` 后 `pnpm build`（`lib/client.js` md5 `978e6f6773cc06b83f8ccd2ee6ea59c0`），把独立实例的 profile link 指回主仓库重装复验：刷新恢复左右两屏后关闭右侧，单屏留下 root 会话、窗口标题与侧栏高亮同步，split 持久化被清空。桌面 profile 与 web profile 都是 `link:`，client-hmr 已把新 bundle 推到桌面窗口，截图确认插件界面与会话运行正常。
- 证据：`/tmp/ct-before-close.png`、`/tmp/ct-after-close.png`（修复前）、`/tmp/ct-after-fix-close-right.png`（修复后）、`/tmp/ct-after-fix-close-bottom.png`、`/tmp/ct-after-fix-close-right-3pane.png`、`/tmp/ct-after-fix-close-bottom-3pane.png`、`/tmp/ct-after-fix-promote-3pane.png`、`/tmp/ct-after-fix-close-restored.png`、`/tmp/ct-reopen-after-close.png`、`/tmp/ct-mainrepo-after-close-right.png`、`/tmp/desktop-after-merge.png`。
- 未验证：桌面窗口内用鼠标实际点关闭（`osascript` 辅助访问被拒，-1719）；桌面窗口仅确认 HMR 后插件正常渲染，行为验证在独立 DSH Web 进程完成。

### 归档当前会话回到新会话界面（2026-11-10）

- 参考环境：DSH 原生 web（禁用插件的对照实例）归档当前会话后主区回到 `data-phase="hero"` 的新会话界面；用户确认这是 DSH 默认行为。
- 复现环境：dsh 0.2.2-rc.1，独立 `DSH_HOME=/tmp/dsh-archive-verify` + `archiveverify` web profile 副本（`claude-code-mode` link 到仓库，端口 51771）；对照实例 `DSH_HOME=/tmp/dsh-native-verify`（端口 52080，`--patch` 禁用插件）。真实桌面宿主与真实 profile 未参与验证。
- 复现步骤：打开一个已有会话 → 会话行「更多」→「归档会话」。
- 观察结果：
  - 修复前：主区完全空白——`[data-ct-shell-grid]` 子节点为 0，`[data-slot="main.conversation"]` 不存在，连原生 hero 都被吞掉（截图 `/tmp/ct-archive-04-after-archive.png`）。
  - 对照实例（无插件）：归档后 `[data-phase="hero"]`，显示「探索未至之境」，与用户确认的默认行为一致（`/tmp/ct-native-03-archive-clean.png`）。
  - 修复后：归档当前会话 → `[data-ct-shell-grid][data-ct-shell-empty]`，`[data-phase="hero"]`，主区回到新会话界面（`/tmp/ct-archive-14-fixed-guard.png`）。
- 边界情况（均实测）：
  - 归档非当前会话：主区保持当前会话（`/tmp/ct-archive-07-other-archived.png`）。
  - 分屏归档 overlay：只移除该屏，主壳保留、窗口选中会话回到主壳（`/tmp/ct-archive-09-overlay-archived.png`）。
  - 分屏归档主壳：退出分屏后主区回新会话界面（`/tmp/ct-archive-10-native-archived.png`、`/tmp/ct-archive-16-native-after-split.png`）。
  - 归档空白新会话：同样回 hero；从 hero 点左上「新会话」可正常新建（`/tmp/ct-archive-12-blank-archived.png`）。
  - 从 hero 打开已有会话：壳重新挂载，cell 尺寸 840×867，不是 0。
  - 会话间切换：rAF 采样 `data-ct-shell-empty` 出现 0 帧（不闪空态）。
  - 控制台：修复前每次归档都有两条 `Session reference "session-…" is released`（堆栈落在原生 `ScopeAreaProvider` → `UiSession.bindingSource`）；修复后无该错误，无 `[data-slot-error]`。
- 根因（两个）：
  1. `installMainShell` 把 `main` 的 `conversation` 入口整体换成 `ShellGrid`；主壳会话为空时 `ShellGrid` 只渲染空 div，原生 `main.conversation`（hero）根本没被渲染。
  2. 归档会让会话引用立即失效，而 `useRetainedSession` 的 state 要到 effect 之后才清空；中间这一帧仍把旧 reference 交给 `SessionProvider`，原生 `ScopeAreaProvider` 渲染时调用已释放引用的 `binding` 抛错。
- 修复：
  - `ShellGrid` 在主壳为空时回退渲染原生 `main.conversation` 入口（`fallback` prop 传 `h(originalComponent, props)`），容器保留 `data-ct-shell-grid` 与 `data-ct-shell-empty`，并复用同一个 `rootRef`，从空态切回有壳时 ResizeObserver 继续有效。
  - `ShellGrid` 只在 `held.sessionId === nativeId` 时才挂壳，避免归档帧把已释放引用交给 `SessionProvider`。
- 落地位置：`src/client/features/workspace-browser/index.js`（`ShellGrid`、`installMainShell`）。
- 遗留噪声：分屏时控制台会报 `ResizeObserver loop completed with undelivered notifications.`（与本次归档修复无关的既有布局测量噪声，功能不受影响）。

### 新会话页右栏入口与右栏控件尺度（2026-11-10）

- 参考：用户提供的 Claude 新建会话截图：会话还没开始时，右上角已经有终端 / 浏览器 / 文件等面板入口；这些入口和 header 按钮同一尺度。用户要求把会话右侧弹出的菜单面板与 header 入口按钮的大小/粗细统一。
- DSH 现状：`ConversationHeader` 在会话仍是 blank 时给 `conversation.session.header` 传 `hideChrome: true`，标题、actions、utilities 都不渲染，只有 corner 保留；`conversation-side-panel` 的入口条注册在 utilities，因此新会话页看不到入口。右栏 pane 头是 36px、tab 12px/400/26px、图标 13px，菜单行 32px/400，和 header 入口（30px / 20px 图标）不一致。
- 实现：
  - `src/client/features/conversation-side-panel/index.js`：注入 `sessions`，用 `sessions.list` 订阅 `blank`；包装 `conversation.session.header.corner`，blank 时渲染 `<Toolbar variant="blank">`；座位未挂载时用 `sbr.openTabIn` 兜底；`cornerState.live` 防止 HMR 旧包装重复渲染入口条。
  - `header-toolbar.js`：`variant: 'blank'` 模式下按整行宽度算入口预算（没有标题要预留、不扣 corner 自身），不渲染 jobs 菜单项、不订阅花名册；「更多」只在溢出时出现；入口开合统一走 `toggleKind`；右栏 seat 还没挂载时先把 kind 排队，seat 出现后补开，2s 后再退回原生 `openTabIn`。
  - `side-panel.css` / `jobs-panel.css` / `side-panel.js`：pane 头 43px；tab 30px / 13px / 500 / 16px 图标；图标按钮 30px / 18px 图标；菜单行 36px / 13px / 500 / 18px 图标；jobs 面板分区、停止、复制按钮同步放大。
- 验证环境：独立 `DSH_HOME=/tmp/ccm-sidepanel-home` + web profile 副本（复制真实 sessions/workspaces；`claude-code-mode` link 到 worktree `new-session-side-panel`），`dsh web --port 55601 --no-open`，ego-browser 打开带 token 的 URL；主 DSH（桌面宿主 / 3080）未重启、未同步产物。
- 实测结果：
  1. 新会话 hero：header corner 出现 files / terminal / dsh-git-panel 三个入口（30×30），`data-ct-sp-budget=23`，全部放得下时没有「更多」；`[data-ct-sp-variant="blank"]` 只有 1 个。
  2. 点击 files：右栏展开 335px，文件面板正常渲染；tab 实测 30px 高 / `13px` / `500` / 16px 图标 / 圆角 8；pane 头 43px；最大化、关闭按钮 30×30 / 18px 图标。再点 terminal：真实终端面板打开（会话内 2 个 pane）。
  3. 关闭面板：右栏收起、入口选中态清空；blank 入口条保留。
  4. 已有会话：`[data-ct-sp-variant="blank"]` 为 0，原生 utilities 入口条仍是 3 个入口 +「更多」；「更多」菜单行高 36 / 标签 `13px`/`500` / 图标 18；后台任务项可打开 jobs 面板（空态「没有后台任务」）。
  5. 强制窄 header（临时把 frame 的 main 列压到 360px，仅测试页）：`data-ct-sp-budget=0`，菜单出现「后台任务 + 工作区文件 + 新建终端 + Git」四行；点击「新建终端」打开终端面板，验证菜单项走 `onToggleKind` 正常。
  6. 提交第一轮（输入 `transition test` 发送）：header 从 blank 切到正常，blank 入口条数量 0，utilities 入口条出现 3 个入口，无重复。
  7. 归档当前会话回到无会话 hero：`header.wSkVaW_headerBlank` 只有空 titleRow，没有 corner，入口条不渲染；重新选择工作区创建 blank session 后入口条恢复（3 个入口）。
  8. 深色：`body[data-ds-dark-theme]` 下 pane 头、tab、图标按钮、菜单均按 DSH 令牌着色，无新增色值；`data-ct-sp-error` 全程为 0。
- 证据：`/tmp/ct-sp-blank-header.png`（新会话 header 入口）、`/tmp/ct-sp-blank-panel.png`（新会话打开文件面板）、`/tmp/ct-sp-conversation-panel.png`（已有会话右栏）、`/tmp/ct-sp-more-menu.png`（更多菜单）、`/tmp/ct-sp-dark-panel.png`（深色）。
- 边界与未做：无会话 hero（冷启动未选工作区 / 归档当前会话）没有 corner，入口条不渲染——此时没有 session/cwd，面板本身也没有可绑定内容；后台任务在 blank 会话按需求隐藏；分屏 240px 右栏下的新尺寸未单独复验（同一套 CSS，pane 头 43px 在 240px 内仍可放下 1 个 tab + 3 个图标按钮）。

## 复现记录模板

每条 Claude 行为在实现前先补一条：

```
### <能力名>
- Claude Code 版本：
- 复现步骤：
- 边界情况：
- 观察结果：
- DSH 差异：
- 落地位置：
```

## 维护规则

- 改任何交互前后都要动这张表：先登记，再实现，最后改状态。
- 新增行按「用户做一件事」的粒度，不按代码模块拆。
- 状态变 ✅ 的条件是：真实浏览器里完成过该操作，且边界情况与 Claude 一致。
