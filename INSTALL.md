# 安装 / Install

## 前提

- 已安装 DeepSeek Harness（桌面端或 CLI 均可），版本 `>= 0.2.1-rc.5`
  （本版在 `0.2.2-rc.1` 上验证过）。
- 本机有 Node.js 20+（安装脚本用它，不需要联网、不装依赖）。

## 三步装好

```bash
# 1. 解压（目录名随意，下面以 dsh-config-guard 为例）
unzip dsh-config-guard-0.2.0.zip

# 2. 装进你的 DSH profile（把 desktop 换成你自己的 profile 名）
node dsh-config-guard/install.mjs --profile desktop

# 3. 重启 DSH，打开 设置 → 配置继承守卫
```

不确定 profile 名？看 `~/.dsh/profiles/` 下有哪些目录，通常就是 `desktop`。

先看会做什么、不写盘：

```bash
node dsh-config-guard/install.mjs --profile desktop --dry-run
```

卸载：

```bash
node dsh-config-guard/install.mjs --profile desktop --uninstall
```

## 它会动你什么

| | |
|---|---|
| 读 | `cordis.patch.yml`、profile 清单、合并后的配置（经宿主 `configEditor`）、资产目录体积、会话活动缓存里的工具调用计数、桌面端 cookie 库（只读聚合查询） |
| 写 | **不写业务配置**。安装脚本只做三件事：把插件复制到 `profiles/<name>/vendor/`、在 `node_modules/` 建链接、在 profile 的 `package.json` 里登记依赖与 bundle（改动前备份） |
| 网络 | 无出站请求；页面只调两个同源 GET 接口 |
| 状态文件 | 不落任何状态文件 |

## 自检

解压后的目录里可以直接跑（不需要安装依赖）：

```bash
cd dsh-config-guard
node --test test/*.test.js     # 49 项
node test/smoke.mjs            # 只读冒烟：GET 通过、非 GET 405、profile 目录零新增
```

## 遇到问题

- 卡片没出现：确认 profile 的 `package.json` 里 `dsh.profile.bundles` 有 `dsh-config-guard`，
  且 DSH 已重启。
- 打开报错：设置环境变量 `DSH_CONFIG_GUARD_TRACE=/tmp/config-guard.log` 后重启，日志会记录
  snapshot 的每一步（不记录配置内容）。

---

## Install (English)

```bash
unzip dsh-config-guard-0.2.0.zip
node dsh-config-guard/install.mjs --profile desktop      # add --dry-run to preview
# restart DSH → Settings → Config inheritance guard
```

Requires DeepSeek Harness `>= 0.2.1-rc.5` and Node.js 20+. The installer only copies the plugin
into `profiles/<name>/vendor/`, links it into `node_modules/` and registers the dependency and bundle
(backing up `package.json` first). The plugin itself writes no configuration, keeps no state file and
makes no outbound requests.
