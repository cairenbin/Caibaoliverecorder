# 菜播·录包机 Linux 版许可与修改声明

本版本由 [cairenbin/Caibaoliverecorder](https://github.com/cairenbin/Caibaoliverecorder) 维护，基于 [kk12091209/Caibaoliverecorder](https://github.com/kk12091209/Caibaoliverecorder) 上游项目。上游及第三方组件的版权和许可声明随附保留。

**修改日期：2026-11-24。** 本 fork 增加了 Linux x86_64 的 DEB、AppImage 和 RPM 打包、浏览器启动器和手动发布流程，并为工作台的「打开文件夹」功能添加了 Linux 支持。

本项目及上述修改依 GNU 通用公共许可证第 3 版（GPLv3）发布。许可证全文见源码根目录的 `LICENSE`，或安装包内的 `usr/share/doc/caibo-recorder/copyright`。独立分发的第三方组件适用其各自的许可证，随包声明见同目录下的 `THIRD_PARTY_NOTICES.md` 和相应许可文件。

在 [本 fork 的 Releases](https://github.com/cairenbin/Caibaoliverecorder/releases) 中，可免费下载与 Linux 安装包同版的 `Caibo-v<版本>-linux-source.tar.gz`。归档包含应用源码、Linux 修改和打包脚本。`upstream.tsv` 记录对应的上游提交。`SOURCES.txt` 列出发行包中 FFmpeg、所附库及运行时的确切源码入口。AppImage 内的 `usr/share/doc/caibo-recorder/ffmpeg/ubuntu-sources.tsv` 列出所附媒体组件的源包及版本。RPM 内的 `usr/share/doc/caibo-recorder/ffmpeg/rpm-media-sources.tsv` 列出 RPM 所附媒体组件对应的源码。
