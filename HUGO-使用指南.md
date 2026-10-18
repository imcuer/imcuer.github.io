# Hugo 站点使用指南

本站基于 **Hugo v0.168.0 (extended)** + **Stack 主题** 搭建。

## 一、环境说明

| 项目 | 位置 |
|------|------|
| Hugo 程序 | `D:\Workbench\web\hugo\hugo.exe`（已加入 PATH，可直接用 `hugo` 命令） |
| 网站根目录 | `D:\Workbench\web\new-site` |
| 主题 | `themes\hugo-theme-stack-4.0.3`（当前启用）、`themes\hugo-theme-dream-3.17.0`（备用） |

> **重要**：必须使用 **extended** 版本的 Hugo（主题需要编译 SCSS）。
> 当前 PATH 中的 hugo.exe 已是 extended 版，用 `hugo version` 验证，输出中带 `+extended` 即正确。
> 旧的非 extended 版备份在 `D:\Workbench\web\hugo\hugo-old-dev.exe`。

## 二、日常命令

所有命令都在网站根目录 `D:\Workbench\web\new-site` 下执行：

```powershell
cd D:\Workbench\web\new-site

# 启动本地预览（含草稿，浏览器打开 http://localhost:1313，改文件自动刷新）
hugo server --buildDrafts

# 新建一篇文章（会生成 content/post/文章名/index.md）
hugo new post/文章名/index.md

# 构建正式版（输出到 public/ 目录，用于部署）
hugo --gc --minify
```

## 三、目录结构

```
new-site/
├── hugo.toml          # 站点主配置（标题、主题、菜单、参数都在这里改）
├── content/           # 所有内容（Markdown）
│   ├── post/          # 博客文章（每篇文章一个文件夹，图片和 index.md 放一起）
│   │   └── hello-world/
│   │       └── index.md
│   └── page/          # 独立页面
│       ├── about/     # 关于页 → /about/
│       ├── archives/  # 归档页 → /archives/
│       └── search/    # 搜索页 → /search/
├── assets/img/        # 头像等需要处理的图片（avatar.png）
├── static/            # 原样复制的静态文件（如 favicon.ico、robots.txt）
├── themes/            # 主题目录
├── public/            # 构建输出（不要手动改，部署时上传这里的内容）
└── resources/         # Hugo 缓存（不要手动改）
```

## 四、写文章

### 1. 新建

```powershell
hugo new post/my-first-note/index.md
```

### 2. 填写 Front Matter（文件顶部的元信息）

```markdown
---
title: "文章标题"
description: "一句话简介（显示在列表卡片上）"
date: 2026-10-19T06:00:00+08:00   # 注意带时区，未来时间的文章默认不会发布
slug: "my-first-note"            # URL 别名，最终地址 /p/my-first-note/
draft: false                     # true = 草稿，正式构建时不发布
categories:
    - 随笔
tags:
    - Hugo
    - 教程
image: cover.jpg                 # 可选，封面图，和 index.md 放同一文件夹
---
```

### 3. 正文

直接写 Markdown。图片放进文章自己的文件夹，用文件名引用：

```markdown
![说明文字](cover.jpg)
```

## 五、常用自定义（都在 hugo.toml）

| 想改什么 | 改哪里 |
|----------|--------|
| 站点标题 | `title = "我的站点"` |
| 左侧边栏头像/副标题/emoji | `[params.sidebar]` 下的 `avatar` / `subtitle` / `emoji` |
| 页脚起始年份 | `[params.footer]` 的 `since` |
| 右侧小部件及顺序 | `[params.widgets]` 的 `homepage` 列表 |
| 左侧导航菜单 | `[[menu.main]]` 各条目（weight 越小越靠前） |
| 每页文章数 | `[pagination]` 的 `pagerSize` |
| 开启评论 | `[params.comments]`，支持 giscus / waline / twikoo 等，参考主题文档 |
| 部署后的正式域名 | `baseURL`（上线前必改，否则 RSS/sitemap 链接不对） |

菜单可用图标：`home`、`user`、`archives`、`search`、`link`、`brand-github`、`brand-twitter` 等（见主题 `assets/icons` 目录）。

## 六、切换主题

themes 目录里还有 Dream 主题，想试试只需两步：

1. 把 `hugo.toml` 里的 `theme = "hugo-theme-stack-4.0.3"` 改为 `theme = "hugo-theme-dream-3.17.0"`
2. 两个主题参数不通用，需参照 `themes\hugo-theme-dream-3.17.0\hugo.example.toml` 调整 `[params]`

改回 Stack 把主题名换回来即可。

## 七、部署

```powershell
hugo --gc --minify
```

把生成的 `public/` 目录里**所有文件**上传到任何静态托管即可：
GitHub Pages / Cloudflare Pages / Netlify / Vercel / 自己的 Nginx 都行。

## 八、遇到问题

| 症状 | 原因与解决 |
|------|-----------|
| 构建报 SCSS/extended 相关错误 | hugo 不是 extended 版，`hugo version` 检查，确认带 `+extended` |
| 文章本地能看到、构建后没有 | ① `draft: true` 没改成 false ② `date` 是未来时间（记得带 `+08:00` 时区） |
| 页面样式全丢 | 删掉 `resources/` 缓存目录后重新构建 |
| 端口 1313 被占用 | `hugo server --port 1314` 换个端口 |
| 主题示例参考 | `themes\hugo-theme-stack-4.0.3\demo\` 是官方完整示例（配置、文章写法都有） |
