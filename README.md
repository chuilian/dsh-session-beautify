# dsh-session-beautify

**会话与工作区美化插件** — 给 DeepSeek Harness (DSH) 侧边栏的会话行和工作区行加自定义外观。

给每个会话的标题、每个工作区的名称单独设置**颜色 / 文字发光 / 字体粗细 / 字体阴影**。样式保存在本机浏览器里，刷新不丢。

---

## 它做什么

- 右键任意会话行 → 菜单里多一项 **「自定义外观」**
- 右键任意工作区行（侧栏里的项目目录）→ 同一个菜单项、同一个弹窗
- 弹窗里选颜色（预设色板 / 取色器 / RGB 三通道）、拖发光强度、选字重、开阴影，底部有实时预览
- 点「完成」立刻生效；「清除自定义」一键还原
- 样式**按会话、按工作区分别保存**，互不影响（按 id 存，工作区改名不丢色）
- 样式表持久化在浏览器 `localStorage`（键 `dsh.sessionBeautify.styling.v1`），刷新、重启 DSH 都在

## 怎么做到的

DSH 侧边栏的行是**宿主自己画的**。这个插件不替换侧栏、不重画树，只做四件事：

1. 在宿主的会话菜单座位（`sidebar.workspaces.session.menu.item`）注册一个菜单项
2. 在宿主的共享右键菜单能力（`contextMenus`，target `workspace`）注册工作区菜单项
3. 弹窗挂在 `shell.overlay` 座位（不能挂在菜单行里 —— 菜单行会随菜单卸载）
4. 把样式写进**宿主行元素**的 inline style

第 4 步靠宿主给每行留的稳定句柄。两种行的结构不一样，标题位置也不同：

```
div.sessionRow[data-row-key="session:<id>"]        div.projectRow[data-row-key="workspace:<workspaceId>"]
  ├─ [0] 状态灯                                       ├─ [0] 文件夹图标
  ├─ [1] 标题      ← 会话样式写这里                    ├─ [1] 展开箭头
  ├─ [2] 时间                                         ├─ [2] 名称容器 > [0] 名称  ← 工作区样式写这里
  ├─ [3] 置顶标记                                     └─ [3] 操作区
  └─ [4] 操作区
```

只写标题 / 名称，不写整行 —— 这样时间戳、状态灯、文件夹图标保留自己的颜色，不会被染色。

宿主重绘侧栏时会替换行元素、丢掉 inline style，所以插件挂了一个 `MutationObserver`，
只在**会话行或工作区行进入 DOM** 时补涂，没自定义过任何行时完全不做事。

工作区菜单项在 `order: 250`，排在「重命名」(100)、「在应用中打开」(200) 之后、「删除」(300) 之前。
`contextMenus` 是**嵌套注入**的独立依赖：宿主没有这个服务时，只丢工作区菜单项，会话上色照常工作。

## 安装

> ⚠️ **不要用 `dsh plugin add`，装完也不要跑 `pnpm install`。**
> 本机的插件管理器命令会报 `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`；
> 而 `pnpm install` 会按 lock 重算 `node_modules`，把 `link:` 软链顶回 registry 版本。

### 手工登记（三处，漏一处都会被下次 `pnpm install` 顶掉）

**1. `~/.dsh/profiles/<profile>/package.json`** —— 两处都要改：

```json
{
  "dependencies": {
    "dsh-session-beautify": "link:/absolute/path/to/dsh-session-beautify"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...原有的 bundle 保持不变...",
        "dsh-session-beautify"
      ]
    }
  }
}
```

**2. `~/.dsh/profiles/<profile>/pnpm-lock.yaml`** 的 `importers` 段：

```yaml
      dsh-session-beautify:
        specifier: link:/absolute/path/to/dsh-session-beautify
        version: link:../../plugins/dsh-session-beautify
```

**3. `~/.dsh/profiles/<profile>/node_modules/dsh-session-beautify`** —— 指向工作区的**相对**软链：

```bash
cd ~/.dsh/profiles/desktop/node_modules
ln -s ../../../plugins/dsh-session-beautify dsh-session-beautify
```

然后重启 DSH。**不跑 `pnpm install`。**

### 安装后验证

1. 刷新页面。
2. 任意会话行的右键菜单中应出现 **「自定义外观」**。
3. 选一个颜色点「完成」，该会话标题应变色；刷新页面后仍在。
4. 右键侧栏里的**工作区行**（如 `工作` / `投资`），菜单里同样有「自定义外观」，选中后该工作区名称变色。

若页面显示 "Failed to load plugins"，通常是上面三处只改了一处。

## 使用

1. 在侧栏里右键任意一个会话，或任意一个工作区行
2. 菜单里点「自定义外观」
3. 调颜色 / 发光 / 粗细 / 阴影，下方预览实时更新
4. 点「完成」（「清除自定义」还原）

## 明确不做

| 不做 | 原因 |
|---|---|
| 图标 | 会话行首格是官方状态灯（待交互 / 运行中 / 完成），没有图标位 |
| 字体描边 | 描边会溢出到旁边的时间戳，需要额外 CSS 才能压住，收益不抵麻烦 |
| 主题自适应配色 | 存的是固定 hex，深浅主题切换后颜色不变 |
| 全局默认外观 | 每个会话要么有自己的外观，要么没有，不做兜底 |
| 跨端同步 | 样式表刻意留在浏览器本地，两台设备各管各的 |
| 工作区整行底色 | 只染名称，避免和宿主的 hover/选中底色打架 |

## 开发

```bash
npm test        # 44 个用例：外观模型（纯逻辑）+ bundle 契约（vm 沙箱）
```

测试分两层：

- `tests/core.test.js` —— 纯逻辑：样式模型、归一化规则、颜色换算、往 DOM 上写样式
- `tests/bundle.test.js` —— bundle 契约：只 require 白名单里的平台模块、座位形状正确、服务缺失时不崩

## 许可

[MIT](./LICENSE)
