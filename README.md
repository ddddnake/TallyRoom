# 牌友记账

一个用于牌局/聚会记账的微信小程序示例项目。项目基于微信小程序 + 云开发，支持创建房间、加入房间、记录分数、查看结算方案和历史记录。

这个仓库适合作为小程序记账类项目的参考，也可以直接 Fork 后改成自己的应用。

## 主要功能

- 创建记账房间，并生成房间码。
- 通过房间码加入已有房间。
- 维护参与成员和每轮分数。
- 自动汇总成员得分。
- 生成尽量少转账次数的结算方案。
- 查看历史房间记录。
- 设置用户昵称和头像。

## 技术栈

- 微信小程序原生框架
- 微信云开发
- 云函数：Node.js
- UI 组件：Vant Weapp
- 测试：Jest

## 目录结构

```text
.
├── miniprogram/              # 小程序前端代码
│   ├── pages/                # 页面：首页、资料设置、房间详情、历史记录
│   ├── utils/                # 通用工具函数
│   └── images/               # 小程序图片资源
├── cloudfunctions/           # 微信云函数
│   ├── room/                 # 房间、记分、结算、历史相关逻辑
│   ├── user/                 # 用户资料相关逻辑
│   └── code/                 # 其他云函数
├── docs/                     # 设计文档和计划文档
├── scripts/                  # 图片生成等辅助脚本
├── project.config.json       # 微信开发者工具项目配置
└── README.md
```

## 本地运行

### 1. 克隆项目

```bash
git clone https://github.com/ddddnake/TallyRoom.git
cd TallyRoom
```

### 2. 使用微信开发者工具打开

在微信开发者工具中导入项目，选择仓库根目录。

项目配置里已经指定：

- 小程序目录：`miniprogram/`
- 云函数目录：`cloudfunctions/`

如果你要复用到自己的小程序，请把 `project.config.json` 里的 `appid` 改成自己的 AppID。

### 3. 安装小程序依赖

进入 `miniprogram` 目录安装依赖：

```bash
cd miniprogram
npm install
```

安装后，在微信开发者工具里执行“工具 -> 构建 npm”。

### 4. 安装云函数依赖

分别进入需要部署的云函数目录安装依赖：

```bash
cd cloudfunctions/room
npm install

cd ../user
npm install
```

也可以根据实际使用情况，为 `cloudfunctions/code` 安装依赖。

### 5. 配置云开发环境

在微信开发者工具中开通云开发，并选择你的云环境。

代码中使用：

```js
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
```

所以云函数会使用当前部署环境。复用项目时，一般不需要在代码里写死环境 ID。

### 6. 上传并部署云函数

在微信开发者工具中右键云函数目录，上传并部署：

- `cloudfunctions/room`
- `cloudfunctions/user`

部署完成后，重新编译小程序即可体验。

## 测试

云函数目录里包含 Jest 测试。

测试 `room` 云函数：

```bash
cd cloudfunctions/room
npm test -- --runInBand
```

测试 `user` 云函数：

```bash
cd cloudfunctions/user
npm test -- --runInBand
```

`--runInBand` 表示单进程运行测试，在部分 Windows 或沙箱环境中更稳定。

## 复用建议

如果你想基于这个项目开发自己的版本，可以优先修改这些地方：

- `project.config.json`：替换为自己的微信小程序 AppID。
- `miniprogram/app.json`：调整页面、导航标题和 tabBar。
- `miniprogram/images/`：替换品牌图片和页面插画。
- `cloudfunctions/room/handlers.js`：调整房间、计分、结算等业务规则。
- `miniprogram/pages/`：修改页面文案和交互样式。

本仓库已经忽略以下本地配置文件，请不要提交它们：

- `.claude/`
- `project.private.config.json`
- `skills-lock.json`
- `node_modules/`
- `miniprogram_npm/`

## 常见问题

### 为什么打开后组件样式不对？

通常是没有构建 npm。请先在 `miniprogram` 下执行 `npm install`，再在微信开发者工具里执行“构建 npm”。

### 为什么云函数调用失败？

请检查：

- 是否已经开通云开发。
- 是否部署了 `room` 和 `user` 云函数。
- 当前微信开发者工具选择的云环境是否正确。
- 云函数依赖是否已经安装。

### 可以直接上线吗？

建议先替换 AppID、图片资源、项目名称和必要的业务文案，再根据自己的业务规则检查计分和结算逻辑。

## 许可

当前项目未单独声明开源许可证。复用前请先确认作者授权或自行补充合适的 LICENSE 文件。
