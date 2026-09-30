# Astrix · 太空殖民

零构建（原生 HTML/CSS/JS + ES Modules，无 npm/打包器）太空殖民模拟游戏。

## 在线游玩

- **GitHub Pages**：https://jerrygriffin.github.io/astrix-online/
- 镜像：https://astrix.app.workbuddy.host/

## 本地运行

仓库即站点，任意静态服务器指向根目录即可，例如：

```
npx serve .          # 或
python -m http.server 8080
```

## 版本与缓存

- 版本号唯一来源：`js/version.js`（对外 VERSION 与缓存击穿 REVISION/CACHE_TAG 分离）。
- 所有模块引用带 `?v=` 串；改代码后运行 `node docs/bump_imports.mjs` 统一补串。

## 目录结构

```
index.html        入口
js/core/          算法层（state / shop / auction / population / fleet ...）
js/data/          纯数据表（materials / techs / buildings / upgrades ...）
js/ui/            渲染层（planet / fleet / inventory / research ...）
docs/             自检脚本（selfcheck_*）与施工图（TODO_*）
```

详细设计决策见 `docs/DECISIONS.md`。
