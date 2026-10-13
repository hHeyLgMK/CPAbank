# Android 3.3.0 启动白屏修复

用户提供的 APK 与 GitHub `fce510be7cd9e65e77a43650be618f6dd9444f0d` 发布的 3.3.0 完全一致：SHA-256 为 `87d3ec99f45d7ebd3ad42630ba9c324d7c04aa60819b72384b22b7f3a63a341e`，包名 `cn.cpa26.workbook`，版本码 38。ZIP、DEX 和 APK v2/v3 签名校验通过。

## 实际复现

使用官方 Android 8.0 / API 26 Google APIs x86 模拟器，WebView 提供方为 Chrome `69.0.3497.100`。原 APK 能启动 Activity，但等待约 90 秒后仍为纯白；WebView 没有 HTML 子节点，未出现 JavaScript 控制台错误。

| 对照包 | 结果 |
| --- | --- |
| 原 Java 加载方式 + 原 APK 页面（15,258,448 字节） | 白屏 |
| 原 Java 加载方式 + 兼容处理后的完整页面 | 白屏 |
| 原 Java 加载方式 + 357 字节简单页面 | 显示页面，脚本执行与触摸按钮成功 |
| 原 Java 加载方式 + 15,258,812 字节简单页面，无现代脚本语法 | 白屏 |
| 流式加载 + 原 APK 页面 | 页面显示，但报 `Uncaught SyntaxError: Unexpected token .`，五科仍显示“载入题库” |
| 流式加载 + 兼容处理后的页面 | 六科全部载入，可以进入题目 |

因此，本次测试环境存在两个独立问题：大页面通过 `loadDataWithBaseURL` 注入时无法载入，以及旧 WebView 无法解析原脚本的现代语法。单独补 JavaScript 兼容不能消除白屏。

## 修复

- `MainActivity.java` 通过限定 HTTPS 域名和页面路径的 `shouldInterceptRequest` 返回 APK 资产流，使用 `loadUrl` 加载主文档。保留 `https://appassets.androidplatform.net/` 存储来源和原生同步桥接。
- 共用网页构建将最终脚本转换到 Chrome 58，并补齐旧 WebView 缺少的 `flatMap`、`replaceChildren`、`Object.hasOwn`、`replaceAll`。
- 原生网页 CSS 为旧引擎补充菜单与遮罩定位、面板尺寸、标题、卡片与弹窗滚动的基本回退。
- 构建依赖锁定版本；运行应用不需要额外 npm 服务。题库标识仍为 `75c67c3a8f514ff79dff67085511352664fbffe5e7dc29a68f126d972be3cfc4`。

## 验证

- 49 项 Node 测试全部通过，包含旧浏览器 API 缺失时的真实应用初始化、六科切换、判分、练习层级、计算器及恢复。
- 模拟器中六科均通过实际触摸进入题目，共 4,593 题。
- 会计第一题选择 C 并提交，显示回答正确；点击下一题，选择 A 并保留未提交状态。
- 强制停止后，以相同测试签名覆盖安装最终样式修复包：题号、会话 ID、已提交答案、未提交答案及已练次数逐字段一致。
- 最终包再次单独强制停止并重启，以上状态仍逐字段一致。
- 实际触摸打开菜单和设备同步弹窗，原生桥接返回“已就绪”。未进行手机与电脑热点互通测试。
- 将隔离模拟器视口临时缩小，设备同步弹窗出现实际溢出；触摸滑动使 `scrollTop` 从 0 增至 89，之后恢复正常显示尺寸。

开发验证命令（仓库根目录）：

```bash
npm ci --prefix native --ignore-scripts
node native/build-web.mjs
node windows/build-offline.mjs
node --test tests/*.test.mjs
```

本次 Android 临时包使用 API 26 平台编译，并经 D8 与 apksigner 验证。为检查页面状态，临时副本开启了 WebView 调试；正式 Java 源码没有开启调试。

## 正式安装包状态

正式 Android 3.3.1 / 版本码 39 沿用原签名证书，APK v2/v3 签名验证通过。正式包没有开启 WebView 调试。

模拟器从原签名 3.3.0 测试页面写入已有进度后，以 `install -r` 升级为正式 3.3.1；安装成功，恢复到 `ACC-00002`，已练次数仍为 `1 / 2431`。

`downloads/peer/` APK、发布版本与校验记录已更新；Windows 安装包仍为 3.3.0.0。签名密钥没有加入源码或安装包。
