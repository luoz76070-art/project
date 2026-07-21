+++
title = "第一篇博客：Hugo 博客已经搭好了"
date = 2026-04-16T14:40:00+08:00
draft = false
tags = ["Hugo", "PaperMod", "阿里云"]
categories = ["博客搭建"]
summary = "这是博客初始化后的第一篇文章，用来验证本地预览、构建和部署流程。"
+++

这篇文章用来确认整条博客链路已经通了：

1. 本地写文章
2. Hugo 生成静态页面
3. 上传 `public/` 到阿里云服务器

## 接下来你可以做什么

- 把 `hugo.yaml` 里的站点名称、域名、邮箱和 GitHub 地址改成你自己的
- 在 `content/posts/` 下继续新增文章
- 本地执行 `hugo server` 预览
- 执行 `hugo` 生成静态文件后上传到你的服务器

## 新建文章

如果本机已经安装好了 Hugo，可以直接运行：

```bash
hugo new posts/my-second-post.md
```

然后把生成文件里的 `draft = true` 改成 `false`，就可以在构建结果里看到它。
