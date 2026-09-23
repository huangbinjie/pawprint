# 爪印 · Pawprint

[English](README.md) · [简体中文](README.zh-CN.md) · [主页](https://huangbinjie.github.io/pawprint/zh/) · [下载](https://github.com/huangbinjie/pawprint/releases/latest)

一只住在 Apple 芯片 Mac 桌面的宠物。领养宠物蛋，遇见有自己基因外貌和技能的猫咪，让日常使用 Codex 的过程慢慢成为成长奖励。爪印在本机运行；同事的小伙伴可通过局域网串门和繁育。

![爪印的奶油色虎斑猫咪](site/pet.png)

## 安装

从 [Releases](https://github.com/huangbinjie/pawprint/releases/latest) 下载最新 Mac 压缩包，解压并把 `Pawprint.app` 放进「应用程序」。当前内测版未签名，macOS 首次打开时可能需要手动允许。在「偏好设置 → 应用更新」可检查新版本，点击「下载并安装」后，应用会校验并更新。

## 开发

需要 Node.js 22.12+；桌面版面向 macOS。

```sh
npm ci
npm run dev
```

`npm test` 运行核心检查，`npm run package` 在本机打包 Apple 芯片版本。推送版本 tag 后，GitHub Actions 自动发布 Mac 安装包；`site/` 更新后自动部署 GitHub Pages。

爪印读取本机 Codex 使用记录来估算奖励，宠物数据保存在本机。局域网配对不共享聊天内容或使用记录。目前没有账号、云同步、现金充值或在线交易。

版本历史见 [更新记录](CHANGELOG.md)，详细规则见 [产品说明](docs/PRODUCT.md)。
