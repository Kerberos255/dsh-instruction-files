# 指令文件与角色

在 DSH 中管理工作区提示词、角色与 Markdown 指令文件。配置由宿主保存至插件目录的 `config.json`，通过 DSH 插件详情页修改。

「agent模式」以当前 Session 工作区为准，增加一组可独立控制的系统提示词区块。总开关为 `workspacePromptEnabled`（默认关闭）；`identityAsIdentity` 开启时仅用根目录 `IDENTITY.md` 替换原生 `harness:identity`，缺失、空白或超过 8 KiB 则回退 DSH 原生身份。其余为**插件自定义区块（非 DSH 原生）**：`SOUL.md → harness:soul`、`AGENTS.md → harness:agent`、`TOOLS.md → harness:tools`、`USER.md → harness:user`、`MEMORY.md → harness:memory`，分别由 `soulEnabled`、`agentsEnabled`、`toolsEnabled`、`userEnabled`、`memoryEnabled` 控制（默认关闭）。关闭总开关时全部回到 DSH 原生身份且不额外注入 Markdown；关闭单项只关闭对应文件，不改变其它文件。

同一文件只进入一个区块：根目录匹配的文件进入命名区块；官方发现的全局、祖先、子目录指令继续进入 `workspace:instructions`，关闭 AGENTS 等对应开关时相关文件也不从其他区块漏入。只在具备权限时注入 MEMORY，始终沿用现有 Channel Core 身份过滤与 Memory 自动召回去重，不自动创建/修改用户文件。

工作区指令**始终热更新**：每次模型步骤组装时检查官方文件版本，发生修改就在下一步生效，未变化则复用缓存正文。热更新始终开启，配置中不再保留 `autoRefresh` 字段。已经开始的模型请求使用其发起时的上下文。

复用官方 Agent Instructions 的目录发现与缓存、文件系统 provider，另外将 `TOOLS.md` 加入候选文件（不改 DSH 原生配置文件）；根目录五个自定义区块共享原工作区 64 KiB 文本预算。文件按字面加载，`{{...}}` 不会被求值；已经加载的内容不再以 user 消息重复注入。DSH 原生工具定义、审批、权限和会话提示词投影保持不变。

系统提示词及其更新、压缩后的恢复由 DSH 原生投影处理。缓存按会话隔离，不新增文件轮询、常驻计时器或模型调用。设置组件停用时采用默认自动检查。

角色设置复用原生 Workspace Registry、Session Controller 和 Preset Registry。设置页可以添加、修改或删除角色；默认 `agent` 角色保留，不能删除。每个自定义角色克隆当前原生 agent 组成，拥有所选工作区、新会话默认模型与权限。删除后停止提供该角色的新会话入口，已打开的会话通过原生退役机制保留。

角色名称是界面标签，不自动加入系统提示词；身份名称与职责写在 `IDENTITY.md`，性格、价值观和表达习惯写在 `SOUL.md`。工作区应为已存在的目录，六份 Markdown 由用户维护。默认模型下拉框列出官方“设置 → 模型”已配置的模型，选择时一起保存提供方与模型；留空沿用官方默认值。权限同样可沿用官方设置。

配置保存至同一文件的 `profiles` 数组。设置页保存后可点击“新建会话”，按已保存的工作区和预设创建原生会话；尚未保存的改动或外部版本冲突会阻止创建。删除角色不会删除用户的工作区文件、技能或会话历史。

模型与权限默认值只应用于匹配工作区、未开始首轮的新会话。已有会话、恢复会话和用户选择保持原生记录；预设默认模型不改全局模型。第一步组装与请求之间发生的模型切换按原生下一步机制保持一致。配置变化只影响后续新会话，不自动改写已有角色文件。

`agent.js` 是预设注册适配器，`workspace-prompt.js` 提供 system 段落和版本缓存。标准模式等其他预设沿用官方配置。卸载插件前，将目标预设的指令行恢复为 `@deepseek-ai/dsh-agent-instructions`；它恢复为官方的 user 消息加载方式。

更新 JavaScript 后，请完整退出并重新启动 DSH 客户端以加载新的插件代码。


已接入 Dream & Memory：已发布受管事实通过记忆插件按需召回，不再重复出现在工作区通用指令中。私人渠道只有经 Channel Core 核验为 Memory 设置中主人身份的私聊 Session，才会加载人工维护的 MEMORY.md；其他私聊和群聊不能访问。
