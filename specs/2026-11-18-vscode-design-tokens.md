# Vibeyard × VS Code 设计 token 规格

日期：2026-11-18
状态：待批准
阶段：UI 重设计 第 2 步（第 1 步 VS Code 设计语言调研已完成，第 3 步改界面在此批准后进行）

## 1. 目标与非目标

**目标**：把 Vibeyard 的视觉底层换成 VS Code 的语言——单一蓝色强调、三档灰表面、1px 分隔线、近直角、13px/22px 的高密度节奏、系统 UI 字体——并且**换成 VS Code 的骨架**（48px Activity Bar + 22px Status Bar + 35px tab 条）。

**非目标**：不逐像素复刻 VS Code 的组件实现；不引入 codicon 字体（沿用现有内联 SVG 图标，按 token 着色）；不改任何业务逻辑。

**反目标**：把 VS Code 的色值抄进来却保留我们原来的圆角、间距和紫色 accent（那会变成"穿 VS Code 衣服的旧界面"）；或者为了"像"而给每个组件写死颜色，绕开 token。

## 2. 双层 token 架构

```
L1  --vscode-*      与 VS Code 的 color id 1:1 同名同义（--vscode-editor-background …）
L2  --app-*         本项目的语义层，只引用 L1（--app-surface-canvas: var(--vscode-editor-background) …）
L3  --bg-* / --text-* / --accent-*   现有变量名，改为 L2 的别名，5,434 行既有 CSS 继续工作
```

**为什么三层**：L1 让"VS Code 出了新值"可以逐条对上；L2 让我们能表达 VS Code 没有的概念（会话状态、成本告警）；L3 是迁移期的桥——**第 3 步改界面时不需要一次性重写 5,434 行 CSS**，可以按文件逐步从 L3 迁到 L2/L1，迁完再删 L3。

**命名规则**：L1 严格照抄 VS Code（含大小写，如 `--vscode-sideBar-background`，便于 grep 官方文档）；L2 一律 kebab-case 全小写。

**弃用路径**：第 3 步结束后，L3 只剩"没人再引用"的空壳，删除时若 grep 命中即说明还有文件没迁完。

## 3. 颜色 token

### 3.1 L1 基础色板（深色 = Dark Modern，浅色 = Light Modern）

全部取自 VS Code 主题源码，未标注即为**核实值**。

| L1 token | 深色 | 浅色 |
|---|---|---|
| `--vscode-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-descriptionForeground` | `#9D9D9D` | `#3B3B3B` |
| `--vscode-disabledForeground` | `#6E7681` | `#BDBDBD` |
| `--vscode-errorForeground` | `#F85149` | `#E51400` |
| `--vscode-icon-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-focusBorder` | `#0078D4` | `#005FB8` |
| `--vscode-editor-background` | `#1F1F1F` | `#FFFFFF` |
| `--vscode-editor-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-editorLineNumber-foreground` | `#6E7681` | `#6E7681` |
| `--vscode-sideBar-background` | `#181818` | `#F8F8F8` |
| `--vscode-sideBar-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-sideBar-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-sideBarSectionHeader-background` | `#181818` | `#F8F8F8` |
| `--vscode-activityBar-background` | `#181818` | `#F8F8F8` |
| `--vscode-activityBar-foreground` | `#D7D7D7` | `#1F1F1F` |
| `--vscode-activityBar-inactiveForeground` | `#868686` | `#616161` |
| `--vscode-activityBar-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-activityBarBadge-background` | `#0078D4` | `#005FB8` |
| `--vscode-activityBarBadge-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--vscode-titleBar-activeBackground` | `#181818` | `#F8F8F8` |
| `--vscode-titleBar-activeForeground` | `#CCCCCC` | `#1E1E1E` |
| `--vscode-titleBar-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-statusBar-background` | `#181818` | `#F8F8F8` |
| `--vscode-statusBar-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-statusBar-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-editorGroupHeader-tabsBackground` | `#181818` | `#F8F8F8` |
| `--vscode-tab-activeBackground` | `#1F1F1F` | `#FFFFFF` |
| `--vscode-tab-activeForeground` | `#FFFFFF` | `#3B3B3B` |
| `--vscode-tab-inactiveBackground` | `#181818` | `#F8F8F8` |
| `--vscode-tab-inactiveForeground` | `#9D9D9D` | `#616161` |
| `--vscode-tab-activeBorderTop` | `#0078D4` | `#005FB8` |
| `--vscode-tab-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-panel-background` | `#181818` | `#F8F8F8` |
| `--vscode-panel-border` | `#2B2B2B` | `#E5E5E5` |
| `--vscode-panelTitle-activeBorder` | `#0078D4` | `#005FB8` |
| `--vscode-editorWidget-background` | `#202020` | `#F8F8F8` |
| `--vscode-widget-border` | `#313131` | `#CECECE` |
| `--vscode-input-background` | `#313131` | `#FFFFFF` |
| `--vscode-input-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-input-border` | `#3C3C3C` | `#CECECE` |
| `--vscode-dropdown-background` | `#313131` | `#FFFFFF` |
| `--vscode-dropdown-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-dropdown-border` | `#3C3C3C` | `#CECECE` |
| `--vscode-button-background` | `#0078D4` | `#005FB8` |
| `--vscode-button-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--vscode-button-hoverBackground` | `#026EC1` | `#0258A8` |
| `--vscode-button-secondaryBackground` | `#00000000`（透明） | `#00000000` |
| `--vscode-button-secondaryForeground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-badge-background` | `#616161` | `#CCCCCC` |
| `--vscode-badge-foreground` | `#F8F8F8` | `#3B3B3B` |
| `--vscode-menu-background` | `#1F1F1F` | `#FFFFFF` |
| `--vscode-menu-selectionBackground` | `#0078D4` | `#005FB8` |
| `--vscode-menu-selectionForeground` | `#FFFFFF` | `#FFFFFF` |
| `--vscode-quickInput-background` | `#222222` | `#F8F8F8` |
| `--vscode-quickInput-foreground` | `#CCCCCC` | `#3B3B3B` |
| `--vscode-textLink-foreground` | `#4DAAFC` | `#005FB8` |
| `--vscode-terminal-foreground` | `#CCCCCC` | `#3B3B3B` |

**未在主题 JSON 中声明、由代码注册的默认值**（标 `*`，采自 VS Code 图表色板 `chartsColors.ts`，实现时以截图目视为准）：
`--vscode-charts-blue` 深 `#3794FF` / 浅 `#0066BF`、`--vscode-charts-yellow` 深 `#CCA700` / 浅 `#BF8803`、`--vscode-charts-red` 深 `#F85149` / 浅 `#E51400`。

**已核实**的图表色：`charts.orange` 深 `#D18616` / 浅 `#AB5A00`；`charts.green` 深 `#89D185` / 浅 `#388A34`；`charts.purple` 深 `#B180D7` / 浅 `#652D90`。

### 3.2 L2 语义层（只引用 L1）

```css
:root {
  /* 三档表面 —— VS Code 的全部层次就这三档 */
  --app-surface-canvas:   var(--vscode-editor-background);      /* 终端/主内容 */
  --app-surface-panel:    var(--vscode-sideBar-background);     /* 侧栏/活动栏/状态栏/tab 条 */
  --app-surface-raised:   var(--vscode-editorWidget-background);/* 模态、悬浮卡、菜单 */
  --app-surface-input:    var(--vscode-input-background);        /* 输入框/下拉 */

  /* 文本 */
  --app-text:            var(--vscode-foreground);
  --app-text-secondary:  var(--vscode-descriptionForeground);
  --app-text-disabled:   var(--vscode-disabledForeground);
  --app-text-on-accent:  var(--vscode-button-foreground);

  /* 线（VS Code 用线不用影） */
  --app-line:            var(--vscode-panel-border);            /* 部件之间的 1px 分隔 */
  --app-line-subtle:     var(--vscode-tab-border);              /* 部件内部更弱的线 */
  --app-line-input:      var(--vscode-input-border);

  /* 强调色 —— 全应用只有一个 */
  --app-accent:          var(--vscode-focusBorder);
  --app-accent-hover:    var(--vscode-button-hoverBackground);
  --app-accent-fill:     var(--vscode-button-background);
  --app-selection-bg:    var(--vscode-menu-selectionBackground);
  --app-selection-fg:    var(--vscode-menu-selectionForeground);
  --app-hover-bg:        var(--vscode-list-hoverBackground, #2A2D2E);

  /* 会话状态（本应用特有，取 VS Code 图表色） */
  --app-status-working:   var(--vscode-charts-blue);
  --app-status-waiting:   var(--vscode-charts-yellow);
  --app-status-input:     var(--vscode-charts-orange);
  --app-status-completed: var(--vscode-charts-green);
  --app-status-idle:      var(--vscode-disabledForeground);

  /* 告警 */
  --app-danger:  var(--vscode-errorForeground);
  --app-warning: var(--vscode-charts-yellow);

  /* 焦点环 */
  --app-focus-ring: 1px solid var(--vscode-focusBorder);
}
```

### 3.3 L3 迁移别名（现有变量名，值换成 L1，不改一行既有 CSS）

```css
:root {
  --bg-primary:   var(--app-surface-canvas);
  --bg-secondary: var(--app-surface-panel);
  --bg-tertiary:  var(--app-surface-raised);
  --bg-hover:     var(--app-hover-bg);
  --text-primary:   var(--app-text);
  --text-secondary: var(--app-text-secondary);
  --text-muted:     var(--app-text-disabled);
  --accent:      var(--app-accent);
  --accent-dim:  var(--app-accent-hover);
  --accent-soft: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent);
  --accent-fg:   var(--app-text-on-accent);
  --accent-text: var(--app-text-on-accent);
  --border:        var(--app-line);
  --border-subtle: var(--app-line-subtle);
  --border-strong: var(--vscode-widget-border);
  --status-working:   var(--app-status-working);
  --status-waiting:   var(--app-status-waiting);
  --status-input:     var(--app-status-input);
  --status-completed: var(--app-status-completed);
  --color-warning:  var(--app-warning);
  --color-critical: var(--app-danger);
  --bookmark:       var(--vscode-charts-yellow);
  --tab-active:     var(--vscode-tab-activeBackground);
  --tab-inactive:   var(--vscode-tab-inactiveBackground);
  --pane-focus:     var(--vscode-focusBorder);
  --pane-unfocus:   var(--app-line);
}
```

## 4. 排版 token

VS Code 不打包字体：UI 走系统栈，编辑器/终端走等宽系统栈。**删掉自托管的 Hanken Grotesk 与 JetBrains Mono**（`src/renderer/assets/fonts/*.woff2`、`base.css` 里的两个 `@font-face`、`copy-assets.js` 里的字体拷贝），顺带减重。

```css
:root {
  --app-font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans',
    Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
  --app-font-mono: 'SF Mono', Monaco, Menlo, Consolas, 'Ubuntu Mono',
    'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace;

  --app-font-size-base: 13px;   /* VS Code UI 基准 */
  --app-font-size-sm:   12px;   /* 状态栏、次要标签 */
  --app-font-size-xs:   11px;   /* 徽标、计数、快捷键提示 */
  --app-font-size-lg:   16px;   /* 模态标题 */
  --app-font-size-terminal: 13px; /* 终端与代码阅读器 */

  --app-line-height-base: 1.4;  /* 13px × 1.4 = 18.2，落在 22px 行高内 */
  --app-line-height-tight: 1.2;

  --app-font-weight-normal: 400;
  --app-font-weight-medium: 500;
  --app-font-weight-bold:   600;
}
```

规则：选项卡、树节点、列表项、菜单项一律 `13px/1.4`；状态栏 `12px`；徽标与计数 `11px`；标题用 `weight 600`，不用字号放大。

## 5. 尺寸与间距 token

VS Code 的垂直节奏是 4px 栅格 + 固定结构高度。

```css
:root {
  /* 结构高度 —— 与 VS Code 对齐 */
  --app-activitybar-width: 48px;
  --app-statusbar-height:  22px;
  --app-titlebar-height:   35px;
  --app-tab-height:        35px;
  --app-row-height:        22px;   /* 树节点、列表项、菜单项 */
  --app-section-header-height: 22px;
  --app-toolbar-height:    35px;
  --app-sidebar-default-width: 300px;
  --app-sidebar-min-width:     170px;

  /* 4px 栅格 */
  --app-space-1: 2px;
  --app-space-2: 4px;
  --app-space-3: 6px;
  --app-space-4: 8px;
  --app-space-5: 12px;
  --app-space-6: 16px;
  --app-space-7: 24px;

  /* 内边距惯例 */
  --app-pad-row:    0 8px;    /* 树/列表行 */
  --app-pad-control: 4px 8px; /* 按钮/输入 */
  --app-pad-menu-item: 4px 10px;
  --app-pad-panel:  8px;

  /* 圆角 —— VS Code 近乎全直角 */
  --app-radius-part:    0;    /* 面板/tab/侧栏/状态栏 */
  --app-radius-control: 2px;  /* 按钮/输入/下拉/徽标 */
  --app-radius-overlay: 6px;  /* 模态/快速输入/悬浮卡 */

  /* 线 */
  --app-line-width: 1px;

  /* 滚动条：VS Code 是叠加式细条 */
  --app-scrollbar-size: 10px;
  --app-scrollbar-thumb: rgba(121, 121, 121, 0.4);
  --app-scrollbar-thumb-hover: rgba(100, 100, 100, 0.7);

  /* 层级 */
  --app-z-sticky: 10;
  --app-z-dropdown: 100;
  --app-z-modal: 1000;
  --app-z-toast: 1100;
}
```

## 6. 交互 token

```css
:root {
  /* VS Code 几乎不做过渡：只有颜色有 100ms，位置/尺寸是瞬时的 */
  --app-duration-color: 100ms;
  --app-duration-none: 0ms;
  --app-ease: ease-in-out;

  /* 焦点：1px 蓝描边，不是发光、不是 box-shadow */
  --app-focus: 1px solid var(--vscode-focusBorder);
  --app-focus-offset: -1px;   /* 内描边，避免撑开布局 */
}

/* 全局基线 */
:focus-visible { outline: var(--app-focus); outline-offset: var(--app-focus-offset); }
```

显式禁止：`box-shadow` 做层次（菜单/模态用 `--app-line-width solid var(--app-line)`）、`transform: scale()` 做悬停动效、渐变面（除现有的 `--app-accent` 填充）、发光效果。

## 7. 组件几何映射

| 组件 | 高度 | 字号 | 圆角 | 底色 | 分隔 |
|---|---|---|---|---|---|
| Activity Bar | 全高 | — | 0 | `surface-panel` | 右侧 1px `line` |
| Activity Bar 项 | 48×48 | — | 0 | 透明 / 激活 `surface-panel` | 激活项左侧 2px `accent` |
| 徽标（badge） | 16px | 11px | 2px | `activityBarBadge` | — |
| 标题栏 | 35px | 13px | 0 | `titleBar-activeBackground` | 下侧 1px `line` |
| 侧栏 | 全高（默认 300px 宽） | 13px | 0 | `surface-panel` | 右侧 1px `line` |
| 侧栏区段头 | 22px | 11px + 大写 + 字距 | 0 | 同侧栏 | 下侧 1px `line-subtle` |
| 树节点 | 22px | 13px | 0 | 悬停 `hover-bg` / 选中 `selection-bg` | — |
| Tab 条 | 35px | 13px | 0 | `editorGroupHeader-tabsBackground` | 下侧 1px `line` |
| Tab | 35px | 13px | 0 | 激活 `tab-active` / 非激活 `tab-inactive` | 激活项顶部 1px `tab-activeBorderTop` |
| 终端区 | 剩余空间 | 13px mono | 0 | `surface-canvas` | — |
| Status Bar | 22px | 12px | 0 | `statusBar-background` | 上侧 1px `line` |
| Status Bar 项 | 22px | 12px | 0 | 透明，悬停 `hover-bg` | 内边距 `0 5px` |
| 按钮（主） | 26px | 13px | 2px | `button-background` | — |
| 按钮（次） | 26px | 13px | 2px | 透明 + 1px `line` | — |
| 输入/下拉 | 26px | 13px | 2px | `input-background` | 1px `input-border`，聚焦转 `focusBorder` |
| 菜单 | — | 13px | 2px | `menu-background` | 1px `widget-border` |
| 菜单项 | 22px | 13px | 0 | 悬停 `selection-bg` | 内边距 `4px 10px` |
| 模态 | — | 13px | 6px | `surface-raised` | 1px `widget-border` |
| 滚动条 | 10px 宽 | — | 0 | 滑块 `scrollbar-thumb` | — |

## 8. 要删除的东西

1. `src/renderer/assets/fonts/hanken-grotesk.woff2`、`jetbrains-mono.woff2` 及 `base.css` 里的两个 `@font-face`、`scripts/copy-assets.js` 里的字体目录拷贝、`index.html` 的 `font-src 'self'` 无需改（仍合规）。
2. 旧圆角档位 `--radius-sm: 7px / md: 10px / lg: 13px` → 换成 `--app-radius-*`。
3. 紫色 accent `#8588F2` 及其所有派生（`--accent-dim #6d70e6`、`rgba(133,136,242,…)`）。
4. `box-shadow` 层次（菜单、模态、悬浮卡）→ 1px 描边。
5. 各文件里写死的语义色（`#34a853`、`#f4b400`、`#e67e22`、`#e94560`、`#4285f4` 等）→ 换成 `--app-status-*` / `--app-danger` / `--app-warning`。

## 9. 验收标准

1. `grep` 全仓 CSS 中不再出现 `#8588F2`、`#e94560`、`#34a853`、`#f4b400`、`#e67e22`、`font-family: 'Hanken Grotesk'`、`radius-sm: 7px`。
2. 深色与浅色各截一次图，逐项对照本文档第 7 节的几何表（高度/字号/圆角/底色）。
3. `npm test` 全绿（`preferences-modal.test.ts` 与 `title-bar.test.ts` 断言了部分 DOM 结构，改动 `index.html` 后需同步）。
4. 标题栏高度改为 35px 后，`src/main/main.ts` 的 `titleBarOverlay.height` 必须同步为 35，否则 Windows 右上角系统按钮会错位。
5. 终端字号 13px 下，80 列宽度仍落在合理窗口宽度内（终端布局不出现横向滚动）。

## 10. 留给实现者

- Activity Bar 的入口分组：现有 sidebar 里的「项目 / 文件 / git / 会话历史 / Active Sessions」如何映射成图标项（我建议：Files、Git、Sessions、Projects 四个视图 + 底部设置齿轮）。
- Status Bar 显示什么：分支名、同步状态、会话成本、上下文占用、provider。建议 V1 只放分支 + 会话状态 + 成本。
- 现有 `ProjectPanel`（history/files/git 三 tab）在 Activity Bar 体系下是保留为侧栏内 tab，还是拆成三个独立视图。
- 深浅色切换时 `titleBarOverlay` 的 `color`/`symbolColor` 需要跟随主题（目前 `main.ts` 里写死 `#101116`）。
- `styles.css` 的 18 个 `@import` 是否合并（VS Code 本身不合并，保留分文件更好维护）。

## 11. 落地记录（第 3 步实施后的实际结果）

**重要修正**：初版曾把左侧改成 VS Code 的 Activity Bar 骨架（48px 图标栏 + 底部状态栏、Explorer 移到左侧）。
实施后确认这条路是错的——本软件是"一个工具里管理多个项目"，左侧本就该只负责项目管理；引入图标栏后同一功能出现两条入口，操作逻辑混乱。
**已回退**：不存在 Activity Bar，不存在底部 Status Bar，Explorer 回到右侧，分支指示器回到 tab 栏，项目卡片的三个人口按钮（Sessions / Files / Git）保留。
**本次只做视觉层替换**：配色、字体、圆角、字号、阴影、语义色。布局与操作路径保持原样。

已落地的视觉规则：

1. **三档表面**：`#181818` 面板 / `#1F1F1F` 画布 / `#313131` 输入；部件之间用 1px `#2B2B2B` 分隔。
2. **单一蓝色强调** `#0078D4`（浅色 `#005FB8`）：只用于主 CTA、焦点框、当前项指示。项目头像与侧栏 "+" 改为中性灰，不再整块刷蓝。
3. **"当前项目"用左侧 2px 蓝线 + 中性选中底** `#37373D` 标记，不用整行蓝底（原 `#04395E` 被判定为"太突兀"）。
4. **系统字体**：删掉自托管的 Hanken Grotesk / JetBrains Mono（woff2 一并删除，`copy-assets` 同步移除）。
5. **圆角 0 / 2 / 6**：面板 0、控件 2、浮层 6；全部 elevation 阴影删除，改用 1px 描边（保留 4 处 `inset` 拖拽指示线）。
6. **项目卡片**：头像 22px，行内边距 4px/10px，三个入口按钮 22×22、图标 16px、左对齐到卡片内容列，Git 计数徽标贴图标右上角。
7. **文件树图标**改为单色 SVG（原 emoji 图标带系统彩色，与扁平 chrome 冲突）。
8. **`.vibeyardignore`** 不再出现在文件树与 git 变更列表（它是应用自己的配置，写进用户项目根目录）。

### 调试方式

改样式不再重启 Electron：`npm run dev:web:watch` 在 `http://localhost:5173` 提供带 mock 桥的渲染层，改完自动刷新；
`node dev/shot.js out.png` 用 headless Chrome 截图并回显页面报错。详见 `dev/README.md`。

### 验收方式（无截图环境）

用 DevTools Protocol 读真实计算样式：侧栏 300px、侧栏头 22px、标题栏/tab 栏 35px、主按钮 26px/2px 圆角/字重 400、正文系统字体 13px；
亮色主题下 chrome 全为 `#F8F8F8`、按钮 `#005FB8`；加载期控制台零报错；`npm test` 98 文件 / 1423 通过；渲染层 `tsc` 0 错误。
