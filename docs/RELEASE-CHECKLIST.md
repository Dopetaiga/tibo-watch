# 发布检查清单

1. 执行 `npm ci`、`npm run research:verify`、`npm run verify`。
2. 使用组织信任的代码签名证书构建。electron-builder 从当前进程的 `CSC_LINK` 与 `CSC_KEY_PASSWORD` 读取证书位置和密码；不要把证书、密码或对应命令写入仓库、日志或 shell 历史。
3. 执行 `npm run dist:win`，生成 NSIS 安装版，然后立即清除当前进程中的签名环境变量。
4. 执行 `npm run verify:signing`。安装器和 `win-unpacked/Tibo Watch.exe` 必须全部显示 `Valid`；组织策略是否信任该发布者仍需在目标 Windows 主机实测。
5. 执行 `npm run test:installer`、`npm run verify:release`。
6. 确认 `release/SHA256SUMS.txt` 与安装版版本一致。
7. 在隔离测试目录验证首次启动、退出恢复、升级、卸载以及用户数据保留。
8. 创建 GitHub Release 草稿，附签名发布者、SmartScreen 说明、变更摘要和 SHA-256；经用户批准后才能公开。

真实 DeepSeek 与 webhook 测试只能使用用户明确提供并授权的目标。测试完成后检查日志、导出和发布包均不含秘密。

若 `verify:signing` 返回 `NotSigned`、`UnknownError` 或其他非 `Valid` 状态，停止发布。不要通过关闭 Windows Defender Application Control、Code Integrity 或 Electron sandbox 来让构建通过；应确认签名证书链受到目标组织信任，或请管理员正式审核并放行。
