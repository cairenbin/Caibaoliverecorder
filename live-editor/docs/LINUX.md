# Linux x86_64 打包与安装

在 Linux x86_64 上，从包含完整 Git 历史的项目检出目录运行。宿主机需要 Docker、Bash、curl、flock 和常见的 coreutils。构建环境使用 Ubuntu 24.04，应用包含 Node.js 24 和自包含的 .NET 8 录制核心。构建会下载工具、恢复 npm 和 NuGet 依赖。源码在容器中只读挂载，构建在临时目录进行，AppImage 工具缓存在仓库的 `.tools/linux/`。

```bash
./live-editor/scripts/build-linux.sh
./live-editor/scripts/build-linux.sh /tmp/caibo-linux-deb deb
./live-editor/scripts/build-linux.sh /tmp/caibo-linux-appimage appimage
```

默认输出到 `release/linux/`。包名和校验文件包含应用版本或构建修订号。已有同名输出时请选择另一个目录。每个包生成后会在构建容器中解包验证。验证包括 FFmpeg 渲染字幕、H.264 编码、FFprobe 读取、工作台鉴权、真实录制核心启动和安全退出。

## 安装

目标基线为 Ubuntu 24.04 x86_64。其他 Debian 系发行版需满足包内声明的系统库版本。AppImage 也需要兼容的 glibc、OpenSSL、ICU、CA 证书和桌面环境。

- **DEB**。执行 `sudo apt install ./caibo-recorder_<版本>_amd64.deb`，再从应用菜单打开「菜播·录包机」，或在终端执行 `caibo-recorder`。FFmpeg 和中文字体由系统包提供。
- **AppImage**。在终端执行 `chmod +x ./Caibo-<版本>-linux-x86_64.AppImage`，然后执行该文件。AppImage 内含 FFmpeg 和 FFprobe。系统应安装字体配置组件和中文字体（如 Ubuntu 的 `fontconfig` 和 `fonts-noto-cjk`），用于导出含中文的弹幕。遇到 FUSE 不可用时，使用 `./Caibo-<版本>-linux-x86_64.AppImage --appimage-extract-and-run`。

启动器通过默认浏览器打开本机工作台。浏览器提示登录时，用户名为 `caibao`，密码显示在启动终端中。运行录制或导出时请保持启动终端打开。通过同一启动命令加 `--status` 查看运行地址，加 `--stop` 请求后台保存状态并退出。服务器环境可以用 `--no-browser` 启动。

用户数据默认位于 `${XDG_DATA_HOME:-$HOME/.local/share}/caibo-recorder`，导出默认在数据目录的「导出视频」内。可通过 `EDITOR_DATA` 和 `EDITOR_EXPORT_ROOT` 指定其他路径。换包前先执行 `--stop`。DEB 用 apt 安装新版，AppImage 停止后替换文件。卸载软件包或删除 AppImage 不会清理用户数据。

Linux 版本通过浏览器提供工作台。平台 Cookie 的系统级安全保存和应用内更新目前需要 Linux 平台适配。构建产物适用于本地验证。对外分发时请随版本提供对应应用源码，并按 AppImage 内 `usr/share/doc/caibo-recorder/ffmpeg/ubuntu-sources.tsv` 的源包和版本提供所附 FFmpeg 及库的对应源码。

## 跟随上游发布

`./live-editor/scripts/follow-upstream-linux.sh --check` 记录上游分支和版本标签变动。`--build` 在临时检出目录构建最新稳定标签，保留当前工作区和 Linux 改动。每个版本的产物位于 `release/linux/upstream/v<版本>/`，构建日志位于 `.tools/upstream-linux/`。构建前校对标签和源码版本，构建后检查安装包和 SHA-256。上游有新提交时只更新追踪记录，有新稳定标签时才构建。

`--publish` 使用 GitHub CLI 登录态发布到 `cairenbin/Caibaoliverecorder`。先在本机运行 `gh auth login --hostname github.com --git-protocol https --web`，或为 GitHub CLI 提供对该 fork 有 Contents 写权限的令牌。使用项目内工具时，将命令中的 `gh` 换成 `.tools/upstream-linux/bin/gh`。远端发布使用 `linux-v<版本>` 标签。构建通过后先上传到草稿，再公开发布。若上传中断，再运行同一命令可继续；已公开的 Release 会核对校验文件。

### 手动发布批处理

把仓库中的 Linux 打包脚本和 `.github/workflows/linux-release.yml` 提交到 fork 的默认分支。打开 fork 的 **Actions → Linux release batch → Run workflow**。标签留空时选择上游最新稳定标签，也可填入 `v0.4.7` 这类稳定标签。任务会跳过已经公开发布的版本。GitHub runner 负责构建和上传，发布使用工作流的 `GITHUB_TOKEN`。

也可以在本机手动运行 `./live-editor/scripts/follow-upstream-linux.sh --publish v0.4.7`。省略标签时使用上游最新稳定标签。
