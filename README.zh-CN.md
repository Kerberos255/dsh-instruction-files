# DSH 指令文件与角色

[English](README.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [安全说明](SECURITY.md)

在 DSH 中管理**工作区提示词、Agent 身份、角色预设及新会话默认模型/权限**，不用替换官方 Agent 或重新实现会话系统。

## 主要功能

- 分别管理 `IDENTITY.md`、`SOUL.md`、`AGENTS.md`、`TOOLS.md`、`USER.md`、`MEMORY.md`。
- 可单独开启工作区提示词和各段落；`IDENTITY.md` 可选替换原生身份，其他 `harness:...` 为插件自定义区块，**不是 DSH 官方内置区块**。
- Markdown 修改后在下一次模型步骤热更新，不重复注入；不修改原生工具定义与权限。
- 角色可以指定工作区、新会话默认模型及权限，老会话不跟随修改。
- 与 Dream、Channel Core 协作，限制私聊记忆来源和重复注入。

## 安装与配置

环境和依赖参考 [package.json](package.json)：

```sh
dsh plugin --profile desktop add github:Kerberos255/dsh-instruction-files
```

在「设置 → 插件 → 指令文件与角色」开启总开关（默认关闭），再单独开启需要的文件。首次安装或更新插件代码要重新打开客户端。

## 工作区结构示例

```text
workspace/
  IDENTITY.md    # 身份与职责
  SOUL.md        # 风格、原则和表达习惯
  AGENTS.md      # Agent 工作约定
  TOOLS.md       # 工具使用说明
  USER.md        # 用户协作偏好
  MEMORY.md      # 人工维护的长期记忆
```

工作区文件由用户自行创建和维护。文件按字面加载，`{{...}}` 不执行变量替换。未开启的区块不额外注入；关闭总开关则使用官方默认身份和指令体系。

## 会话边界和安全

- 默认模型与权限只影响匹配角色后续创建的新会话，不覆盖正在进行的会话。
- `MEMORY.md` 涉及私人数据；渠道会话必须由 Channel Core 验证为有权限的主人才能参与对应记忆载入。
- Dream 已发布的受管事实通过相关事实召回；避免再把整份记忆重复塞进系统提示词。
- 用户删除角色不会删除原始工作区文件、技能或会话历史。

## 测试

`npm test` 用于验证提示词与记忆过滤逻辑，角色/预设 UI 仍建议实际检查。配置模板：[config.example.json](config.example.json)。

相关：[Dream 与长期记忆](https://github.com/Kerberos255/dsh-memory-dreaming) · [Channel Core](https://github.com/Kerberos255/dsh-channel-core)。许可证：[MIT](LICENSE)。
