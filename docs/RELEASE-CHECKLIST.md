# 发布检查清单

1. 执行 `npm ci`、`npm run research:verify`、`npm run verify`。
2. 执行 `npm run dist:win`，生成 NSIS 安装版和便携版。
3. 执行 `npm run test:installer`、`npm run test:portable`、`npm run verify:release`。
4. 确认 `release/SHA256SUMS.txt`、安装版、便携版版本一致。
5. 在隔离测试目录验证首次启动、退出恢复、升级、卸载以及用户数据保留。
6. 创建 GitHub Release 草稿，附 SmartScreen 说明、变更摘要和 SHA-256；经用户批准后才能公开。

真实 DeepSeek 与 webhook 测试只能使用用户明确提供并授权的目标。测试完成后检查日志、导出和发布包均不含秘密。
