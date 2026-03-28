# VibeAround Feishu Plugin

Feishu/Lark channel plugin for VibeAround. Communicates with the Rust host via stdio JSON-RPC 2.0.

## Architecture

```
Feishu User ←→ WebSocket (Lark SDK) ←→ Plugin (Node.js) ←→ stdio JSON-RPC ←→ Rust Host
```

The plugin runs as a child process of the host. Messages are exchanged over stdin/stdout:
- Host → Plugin: `initialize`, `send_text`, `edit_message`, `send_interactive`, `add_reaction`, etc.
- Plugin → Host: `on_message`, `on_reaction`, `on_callback` notifications

## Features

- 22 Feishu message type parsers (text, post, image, file, audio, video, sticker, card, merge forward, etc.)
- **Block-based card rendering**: each contiguous run of the same variant (thinking, tool use, text) becomes a separate interactive card. When the variant changes, the current card is sealed and a new one starts.
- **sendChain message ordering**: all `flushBlock` calls are serialized via a promise chain to prevent out-of-order card delivery
- **Emoji await before prompt**: `addReaction()` is awaited before calling `prompt()`, ensuring the indicator is visible before the agent turn can complete
- Send, edit, reply, and quote messages
- Emoji reactions
- Interactive cards (Markdown cards, streaming cards, button actions)
- File/image upload and download
- @mention parsing (auto-strips bot self-mentions)
- Message deduplication (12h TTL, prevents WebSocket reconnect replay)
- Group chat support (responds only when bot is @mentioned)
- `/help` slash command returns cached agent commands + system commands

## Project Structure

```
src/
├── main.ts                          # Entry point, JSON-RPC router
├── stdio.ts                         # JSON-RPC 2.0 transport
├── protocol.ts                      # Host ↔ Plugin protocol types
├── lark-client.ts                   # Lark SDK wrapper
├── gateway.ts                       # WebSocket event listener
├── card/
│   ├── builder.ts                   # Card construction
│   └── markdown-style.ts            # Markdown style optimizer
└── messaging/
    ├── types.ts                     # Message type definitions
    ├── converters/                  # 22 message type parsers
    │   ├── index.ts                 # Registry
    │   ├── content-converter.ts     # Dispatch + @mention resolution
    │   ├── text.ts / post.ts / image.ts / file.ts
    │   ├── audio.ts / video.ts / sticker.ts
    │   ├── merge-forward.ts         # Merge forward (recursive expansion)
    │   ├── interactive/             # Card message parser
    │   └── ...
    └── inbound/
        ├── dedup.ts                 # Message deduplication
        └── mention.ts              # @mention utilities
```

## Development

```bash
npm install
npm run build

# Watch mode
npm run dev
```

## Configuration

Add to VibeAround's `settings.json`:

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

### Feishu Developer Console Setup

1. Create an enterprise self-built app, obtain App ID and App Secret
2. Events & Callbacks → Subscription mode → Select "Receive events through persistent connection"
3. Add event: `im.message.receive_v1`
4. Optional: Add `card.action.trigger` callback for card button clicks

## Manual Testing

```bash
npm run build
node test-harness.mjs
# Send a message to the bot in Feishu — the terminal will show received messages and auto-reply
```

## Protocol

JSON-RPC 2.0 over stdio, newline-delimited. See `src/protocol.ts` for details.

## Acknowledgements

Message parsers adapted from [openclaw-lark](https://github.com/nicepkg/openclaw-lark) (MIT License).
