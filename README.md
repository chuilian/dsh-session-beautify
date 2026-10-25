# dsh-session-beautify

**会话美化插件** — 给 DeepSeek Harness (DSH) 侧边栏的会话行加自定义外观。

给每个会话单独设置标题的**颜色 / 文字发光 / 字体粗细 / 字体阴影**。样式保存在本机浏览器里，刷新不丢。

---

## 它做什么

- 右键任意会话行 → 菜单里多一项 **「自定义外观」**
- 弹窗里选颜色（预设色板 / 取色器 / RGB 三通道）、拖发光强度、选字重、开阴影，底部有实时预览
- 点「完成」立刻生效；「清除自定义」一键还原
- 样式**按会话分别保存**，互不影响
- 样式表持久化在浏览器 `localStorage`（键 `dsh.sessionBeautify.styling.v1`），刷新、重启 DSH 都在

## 怎么做到的

DSH 侧边栏的会话行是**宿主自己画的**。这个插件不替换侧栏、不重画树，只做三件事：

1. 在宿主的会话菜单座位（`sidebar.workspaces.session.menu.item`）注册一个菜单项
2. 弹窗挂在 `shell.overlay` 座位（不能挂在菜单行里 —— 菜单行会随菜单卸载）
3. 把样式写进**宿主行元素**的 inline style

第 3 步靠宿主给每行留的稳定句柄：

```
div.sessionRow[data-row-key="session:<id>"]
  ├─ [0] 状态灯
  ├─ [1] 标题      ← 样式写在这里
  ├─ [2] 时间
  ├─ [3] 置顶标记
  └─ [4] 操作区
```

只写标题，不写整行 —— 这样时间戳和状态灯保留自己的颜色，不会被染色。

宿主重绘侧栏时会替换行元素、丢掉 inline style，所以插件挂了一个 `MutationObserver`，
只在**会话行进入 DOM** 时补涂，没自定义过任何会话时完全不做事。

## 安装

```bash
dsh plugin add /absolute/path/to/dsh-session-beautify
```

装完重启 DSH（Web profile 或桌面端）即生效。

也可以直接挂载（不用 CLI）：

```yaml
# profile 的 cordis.patch.yml
- insert:
    - id: session-beautify
      name: 'dsh-session-beautify'
```

## 使用

1. 在侧栏里右键任意一个会话
2. 菜单里点「自定义外观」
3. 调颜色 / 发光 / 粗细 / 阴影，下方预览实时更新
4. 点「完成」

## 明确不做

| 不做 | 原因 |
|---|---|
| 图标 | 会话行首格是官方状态灯（待交互 / 运行中 / 完成），没有图标位 |
| 字体描边 | 描边会溢出到旁边的时间戳，需要额外 CSS 才能压住，收益不抵麻烦 |
| 主题自适应配色 | 存的是固定 hex，深浅主题切换后颜色不变 |
| 全局默认外观 | 每个会话要么有自己的外观，要么没有，不做兜底 |
| 跨端同步 | 样式表刻意留在浏览器本地，两台设备各管各的 |

## 开发

```bash
npm test        # 31 个用例：外观模型（纯逻辑）+ bundle 契约（vm 沙箱）
```

测试分两层：

- `tests/core.test.js` —— 纯逻辑：样式模型、归一化规则、颜色换算、往 DOM 上写样式
- `tests/bundle.test.js` —— bundle 契约：只 require 白名单里的平台模块、座位形状正确、服务缺失时不崩

## 许可

[MIT](./LICENSE)
