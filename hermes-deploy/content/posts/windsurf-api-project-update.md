+++
title = "项目动态：Windsurf-api 已整理并接入博客"
date = 2026-04-20T17:00:00+08:00
draft = false
tags = ["项目动态", "Windsurf", "OpenAI API", "代理服务"]
categories = ["项目动态"]
summary = "记录 Windsurf-api 项目的地址、核心能力和当前整理结果。"
+++

今天把 `Windsurf-api` 项目整理进了总仓库，并准备作为后续持续维护的一个独立子项目。

## 项目地址

- GitHub：<https://github.com/luoz76070-art/project/tree/main/Windsurf-api>

## 项目概述

`Windsurf-api` 是一个基于 `WindsurfAPI` 整理出来的 OpenAI 兼容代理项目，主要目标是把 `Windsurf / Codeium` 的模型能力暴露成标准 API，方便直接接入常见的 OpenAI SDK、脚本和第三方客户端。

当前版本重点整理了这几类能力：

- OpenAI 兼容接口
  - 支持 `/v1/chat/completions`
  - 支持 `/v1/models`
- 多账号池
  - 支持多 Windsurf 账号接入
  - 可根据账号状态自动切换
- 后台管理
  - 可管理账号、代理、日志、统计与客户端 API Key
- 代理适配
  - 修复了 token 注册和 Language Server 出口代理问题
  - 解决了上游直连不稳定时容易出现的超时问题

## 当前状态

目前项目已经完成以下整理：

1. 已迁移到总仓库 `project`
2. 已统一目录名为 `Windsurf-api`
3. 已补充来源说明、部署文档、原理说明和使用方法
4. 已移除不应进入仓库的本机运行态文件，例如账号池、日志和密钥文件

后面如果继续迭代，我会再把这套服务的部署流程、运维经验和踩坑记录逐步整理出来。
