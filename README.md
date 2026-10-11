# dsh-keep-awake

DeepSeek Harness 主机保活插件：AI 任务运行时自动保持主机亮屏、防止休眠，全部任务结束后释放保活请求。

## 插件介绍

- 保活由 DSH 后端控制，支持多个会话和子 Agent；关闭网页或切换到后台不影响运行中的任务。
- 在侧边栏的**设置同一行**显示太阳图标，点击可查看状态、运行任务数量，以及开启或关闭保活。
- 使用普通用户权限的临时电源断言，不需要管理员权限，不修改全局电源设置，不模拟鼠标或键盘。
- Windows 使用 Power Request，macOS 使用 IOKit，Linux 使用 D-Bus ScreenSaver 和 logind。系统接口不可用时会显示部分生效或失败状态。
- 主机开关作用于当前 DSH 进程，重启后默认开启。插件停止或宿主退出时释放请求。

保护对象是**运行 DSH 后端的设备**。手动锁屏、合盖及系统强制策略可能覆盖保活。Linux 已实机验证；Windows 和 macOS 已实现，尚待实机验证。针对 DSH `0.2.0-rc.2` 开发。

## 安装方法

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-keep-awake
```

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:zi7tian/dsh-keep-awake
```

### 本地安装

```sh
git clone https://github.com/zi7tian/dsh-keep-awake.git
cd dsh-keep-awake
npm ci
dsh plugin --profile web add link:/absolute/path/to/dsh-keep-awake
```

将路径替换为实际插件目录，Windows 使用对应本地路径。插件依赖 Koffi，安装时会获取适合当前平台的原生组件；Linux 还需要系统提供 `libdbus-1` 及相应的会话服务。

安装或升级后，等待当前任务结束，**重启 `dsh web` 并刷新页面**。设置旁出现太阳图标即表示控制面板已加载。桌面版请通过其插件管理器安装。

### 卸载

```sh
dsh plugin --profile web remove dsh-keep-awake
```
