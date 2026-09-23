# 爪印 · Pawprint

[English](README.md) · [简体中文](README.zh-CN.md) · [主页](https://huangbinjie.github.io/pawprint/zh/) · [下载](https://github.com/huangbinjie/pawprint/releases/latest)

爪印是一款独立开发的 Codex 桌面宠物，适用于 Apple 芯片 Mac。它把本机 Codex 活动和 GPT 模型 token 用量化作一点点成长陪伴；同事的小伙伴还可以在局域网串门和繁育。

![爪印的奶油色虎斑猫咪](site/pet.png)

## 主要功能

- **悬浮宠物：** 常驻桌面，能感知本机 Codex 会话的工作与结束状态，也会眨眼、玩耍；外貌由基因决定。
- **Codex 用量：** 从本机记录显示 token、按模型估算的费用，以及有每日上限的宠物币奖励；估算值不是订阅账单。
- **菜单栏额度：** 有近期本机快照时，在图标旁显示 Codex 每周和 5 小时剩余额度；不是实时账号查询。
- **基因与技能：** 领养宠物蛋、查看基因概率、培养技能，与其他宠物繁育新组合。
- **附近的小屋：** 在局域网邀请同事串门，不分享聊天正文或使用记录。

爪印是独立应用，与 OpenAI 没有官方关联。

## 安装

从 [Releases](https://github.com/huangbinjie/pawprint/releases/latest) 下载最新 Mac 压缩包，解压并把 `Pawprint.app` 放进「应用程序」。当前内测版未签名，macOS 首次打开时可能需要手动允许。在「偏好设置 → 应用更新」可检查新版本，点击「下载并安装」后，应用会校验并更新。

## 开发

需要 Node.js 22.12+；桌面版面向 macOS。

```sh
npm ci
npm run dev
```

`npm test` 运行核心检查，`npm run package` 在本机打包 Apple 芯片版本。推送版本 tag 后，GitHub Actions 自动发布 Mac 安装包；`site/` 更新后自动部署 GitHub Pages。

宠物数据保存在本机。目前没有账号、云同步、现金充值或在线交易。

版本历史见 [更新记录](CHANGELOG.md)，详细规则见 [产品说明](docs/PRODUCT.md)。
