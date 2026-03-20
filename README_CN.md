# VibeAround Feishu Plugin

飞书/Lark 频道插件，通过 stdio JSON-RPC 2.0 与 VibeAround Host 通信。

## 架构

```
飞书用户 ←→ WebSocket (Lark SDK) ←→ Plugin (Node.js) ←→ stdio JSON-RPC ←→ Rust Host
```

Plugin 作为 Host 的子进程运行，通过 stdin/stdout 交换 JSON-RPC 消息：
- Host → Plugin：`initialize`、`send_text`、`edit_message`、`send_interactive`、`add_reaction` 等
- Plugin → Host：`on_message`、`on_reaction`、`on_callback` 通知

## 功能

- 22 种飞书消息类型解析（text、post、image、file、audio、video、sticker、card、合并转发等）
- 消息发送、编辑、回复、引用
- Emoji reaction
- 卡片消息（Markdown 卡片、流式卡片、按钮交互）
- 文件/图片上传下载
- @提及解析（自动过滤 bot 自身的 @）
- 消息去重（12h TTL，防 WebSocket 重连重放）
- 群聊支持（仅响应 @bot 的消息）

## 项目结构

```
src/
├── main.ts                          # 入口，JSON-RPC 路由
├── stdio.ts                         # JSON-RPC 2.0 transport
├── protocol.ts                      # Host ↔ Plugin 协议类型定义
├── lark-client.ts                   # Lark SDK 封装
├── gateway.ts                       # WebSocket 事件监听
├── card/
│   ├── builder.ts                   # 卡片构建
│   └── markdown-style.ts            # Markdown 样式优化
└── messaging/
    ├── types.ts                     # 消息类型定义
    ├── converters/                  # 22 种消息类型解析器
    │   ├── index.ts                 # 注册表
    │   ├── content-converter.ts     # 转换调度 + @mention 解析
    │   ├── text.ts / post.ts / image.ts / file.ts
    │   ├── audio.ts / video.ts / sticker.ts
    │   ├── merge-forward.ts         # 合并转发（递归展开）
    │   ├── interactive/             # 卡片消息解析
    │   └── ...
    └── inbound/
        ├── dedup.ts                 # 消息去重
        └── mention.ts              # @提及工具函数
```

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run build

# 监听模式开发
npm run dev
```

## 配置

在 VibeAround 的 `settings.json` 中配置：

```json
{
  "channels": {
    "feishu": {
      "app_id": "cli_xxx",
      "app_secret": "xxx"
    }
  }
}
```

### 飞书开发者后台配置

1. 创建企业自建应用，获取 App ID 和 App Secret
2. 事件与回调 → 订阅方式 → 选择「使用长连接接收事件」
3. 添加事件：`im.message.receive_v1`（接收消息）
4. 可选：添加 `card.action.trigger` 回调（卡片按钮点击）

## 手动测试

```bash
npm run build
node test-harness.mjs
# 然后在飞书给 bot 发消息，终端会显示收到的消息并自动回复
```

## 协议

JSON-RPC 2.0 over stdio，换行分隔。详见 `src/protocol.ts`。

## 致谢

消息解析器部分参考了 [openclaw-lark](https://github.com/nicepkg/openclaw-lark)（MIT License）。
