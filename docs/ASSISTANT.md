# 宠物助手：连接自己的模型

Pawprint 只提供宠物性格、文字对话界面和受限操作工具，不再打包推理引擎、聊天模型或语音识别模型，也不申请麦克风权限。助手默认关闭，选择外部模型服务并手动开启后才使用。

## 本机模型：单独安装与下载

### Ollama

1. 从 [Ollama 官网](https://ollama.com/download) 安装并运行。
2. 可先试 [Qwen3 8B](https://ollama.com/library/qwen3:8b)：

   ```sh
   ollama pull qwen3:8b
   ```

3. 内存充足且更重视质量时，可试 [Qwen3 14B](https://ollama.com/library/qwen3:14b)。响应速度和效果需要在自己的电脑上验证，不承诺达到云端旗舰模型水平。
4. 在 Pawprint 选择 Ollama，地址填 `http://127.0.0.1:11434/v1`，模型填实际下载的名称，通常无需 key。保存并测试连接。

### LM Studio

从 [LM Studio 官网](https://lmstudio.ai/download) 安装。自行下载、加载模型并开启本地服务器，在 Pawprint 填写服务器地址和模型标识。模型文件由 Ollama / LM Studio 管理，Pawprint 不下载或删除它们。

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

Text requests are sent only when you submit a message or test the connection. “End conversation” cancels the active request and clears the current pet’s context; “Turn off now” disables the assistant. Pet personalities and encrypted provider keys are preserved during migration. Old app-managed built-in model caches are removed, without touching external model stores.
