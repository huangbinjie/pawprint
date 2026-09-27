# 宠物助手：连接自己的模型

Pawprint 只提供宠物性格、文字对话界面和受限操作工具，不再打包推理引擎、聊天模型或语音识别模型，也不申请麦克风权限。助手默认关闭，选择外部模型服务并手动开启后才使用。

## 本机模型：单独安装与下载

### Ollama：应用内选择、下载并使用

首次从 [Ollama 官网](https://ollama.com/download) 安装一次。之后在 Pawprint 选择 Ollama，就能看到推荐模型和已有模型列表。

- Qwen3 4B：约 2.5 GB，建议至少 8 GB 内存。
- Qwen3 8B：约 5.2 GB，建议至少 16 GB 内存，优先推荐日常使用。
- Qwen3 14B：约 9.3 GB，建议至少 24 GB 内存，通常更慢。

点击“下载并使用”后，Pawprint 会连接或启动已安装的 Ollama、显示下载进度、试运行模型，再自动保存连接并开启文字助手。不需要复制地址或输入命令。下载可取消，再次点击由 Ollama 继续处理；已安装的模型可以直接点击“使用”。试运行失败不会切换你的聊天模型。

若需要连接非默认地址，可展开高级连接设置。模型大小为近似值，运行内存还取决于上下文和其他应用占用。

### LM Studio

从 [LM Studio 官网](https://lmstudio.ai/download) 安装。自行下载、加载模型并开启本地服务器，在 Pawprint 填写服务器地址和模型标识。模型文件由 Ollama / LM Studio 管理，Pawprint 通过 Ollama 的本机接口发起下载，不打包推理引擎，也不删除外部模型。

## 云端 API

支持 OpenAI、小米 MiMo、DeepSeek 和自定义 Chat Completions 兼容服务。填写自己的 API key、模型名称和地址，保存后测试。执行操作还需要模型支持工具调用。

- [小米 MiMo 平台](https://platform.xiaomimimo.com/)
- [DeepSeek 平台](https://platform.deepseek.com/)
- [OpenAI 平台](https://platform.openai.com/)

key 经 Electron safeStorage 加密，拒绝明文降级，不返回渲染进程，不放进游戏存档导出。只有用户发送文字或主动测试连接时才发起模型请求。所选服务会收到角色资料及当前对话上下文，并按该服务规则计费。

## 聊天与停止

每只宠物单独保存性格。输入文字聊天，或在允许操作后输入“帮我打开推特”。支持 HTTPS 网站、网页搜索、默认浏览器、计算器，以及 macOS 的备忘录、日历和音乐。

“结束聊天”会取消当前请求、清除当前宠物的会话上下文和回复；“立即关闭助手”还会禁用助手。没有自动追问、自动语音监听、任意 shell、文件删除或消息发送能力。

## 旧版本迁移

原来使用内置模型的连接会关闭并清空模型选择，需要用户重新选择自己的服务；已配置的外部服务、加密 key 和宠物性格保留。迁移只清理 Pawprint 自己下载的 Whisper base 和 Qwen3 0.6B 缓存，不触碰 Ollama、LM Studio 或其他自定义模型目录。

## English

Pawprint now connects to your own model service. It includes no model weights, inference runtime, speech recognition or microphone access. Install Ollama or LM Studio separately and download a suitable model, or configure your own MiMo, DeepSeek, OpenAI or compatible API key.

The Ollama catalog can download, test and automatically connect a model after you click Download and use. A one-time Ollama installation is required. Text requests are sent when you submit a message, test a connection or test a downloaded model. “End conversation” cancels the active request and clears the current pet’s context; “Turn off now” disables the assistant. Pet personalities and encrypted provider keys are preserved during migration. Old app-managed built-in model caches are removed, without touching external model stores.
