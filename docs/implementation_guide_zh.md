# 智能微电网平台实施指南

本指南面向缺乏编程背景的业务负责人，帮助您基于 MyEMS 开源平台一步步落地前述“智能微电网平台”规划。整体流程划分为四个阶段：准备环境 → 部署底座 → 配置数据 → 定制功能。每个阶段都提供“目标、操作步骤、交付物”三部分说明。

## 阶段 0：理解整体架构

- **目标**：明确 MyEMS 的核心组成、与规划功能的映射关系。
- **操作步骤**：
  1. 阅读 `README_CN.md` 中的架构图，熟悉数据采集、处理、服务、展示各层含义。
  2. 对照下表，将平台规划的一级菜单映射到 MyEMS 组件：

     | 规划功能域 | MyEMS 组件 | 说明 |
     | --- | --- | --- |
     | 首页看板、项目运营、投资分析、配电/光伏/储能/充电、智慧能碳 | `myems-web` | 提供数据看板、趋势、排名、地理可视化以及自定义页面。 |
     | 站点档案、设备档案、权限、告警、运维 | `myems-admin` | 负责站点/设备/角色/菜单/告警配置与运维流程管理。 |
     | 实时与历史数据、收益/碳排/费用统计、策略配置接口 | `myems-api` | 统一 REST API 与 WebSocket，可对接前端、策略、第三方系统。 |
     | 数据采集 (光伏、储能、负荷、充电) | `myems-modbus-tcp` | 通过 Modbus TCP 采集现场设备数据，也可扩展其它协议。 |
     | 数据质量保障 (清洗、规范化、汇总) | `myems-cleaning`、`myems-normalization`、`myems-aggregation` | 保障指标质量，生成多维度统计结果。 |
     | 数据存储 | `database` 目录下的 13 个数据库 | 覆盖配置、历史、计费、碳排、运维等数据域。 |

- **交付物**：一份功能与组件映射表，为后续部署做准备。

## 阶段 1：准备基础环境

- **目标**：搭建统一的服务器环境，安装必要依赖。
- **操作步骤**：
  1. 选择一台运行 Ubuntu 20.04 LTS 或更新版本的服务器（建议 8 核 CPU / 16GB 内存 / 200GB SSD）。
  2. 安装系统依赖：

     ```bash
     sudo apt update
     sudo apt install -y git docker.io docker-compose python3 python3-venv redis-server
     ```

  3. 为数据库准备 Docker 网络：

     ```bash
     sudo docker network create myems-net
     ```

  4. 克隆代码仓库：

     ```bash
     git clone https://github.com/MyEMS/myems.git
     cd myems
     ```

  5. 使用 `docs/images` 中的架构图进行团队培训，确保运维/业务/数据团队理解各组件职责。

- **交付物**：完成环境准备、代码下载与团队培训记录。

## 阶段 2：部署 MyEMS 底座

- **目标**：启动数据库、后端 API、前端应用，形成可访问的基础平台。
- **操作步骤**：
  1. **部署数据库**：按照 `database/README.md` 逐库执行初始化脚本；若使用 Docker，可参考下述命令启动 PostgreSQL 与 TimescaleDB：

     ```bash
     sudo docker run -d --name myems-postgres --network myems-net \
       -e POSTGRES_PASSWORD=StrongPassword123 \
       -e POSTGRES_DB=myems_system_db \
       -v /opt/myems/postgres-data:/var/lib/postgresql/data \
       postgres:14
     ```

     对于计量历史等大容量数据，推荐使用 TimescaleDB；脚本位于 `database/timescaledb` 目录。

  2. **配置并启动 API**：
     - 进入 `myems-api` 目录，复制示例配置：

       ```bash
       cd myems-api
       cp myems-api.env.example myems-api.env
       ```

     - 根据实际数据库地址/用户名/密码修改 `myems-api.env`。
     - 创建并激活虚拟环境，安装依赖：

       ```bash
       python3 -m venv venv
       source venv/bin/activate
       pip install -r requirements.txt
       ```

     - 启动 API 服务：

       ```bash
       python3 wsgi.py
       ```

     - 通过浏览器访问 `http://<服务器IP>:8000/swagger` 验证 API 是否可用。

  3. **启动 Web 可视化与管理前端**：
     - `myems-web` (React)：

       ```bash
       cd ../myems-web
       cp .env.example .env.local
       npm install
       npm run start
       ```

       修改 `.env.local` 中的 `REACT_APP_API_BASE_URL` 以指向 API。

     - `myems-admin` (AngularJS)：

       ```bash
       cd ../myems-admin
       npm install
       npm run start
       ```

       默认端口分别为 3000（Web）与 4200（Admin）。

  4. **注册网关与采集服务**：
     - 在 `myems-modbus-tcp` 中配置采集点：

       ```bash
       cp config.example.json config.json
       # 编辑 config.json，写入设备 IP、寄存器地址、采集频率
       python3 app.py
       ```

     - 采集数据会写入 `myems_historical_db`，可在 Admin 中查看实时点位。

- **交付物**：API、Web、Admin 均可访问；采集服务运行并写入数据。

## 阶段 3：配置业务数据与权限

- **目标**：按照平台规划录入项目、站点、设备、角色等基础数据。
- **操作步骤**：
  1. 登录 Admin 前端，使用默认超级管理员账号（可在 `myems-system_db` 的 `users` 表中查看）。
  2. 在“系统管理 → 角色管理”创建运营方、投资方、项目方角色，并分配菜单权限。
  3. 在“平台/项目管理”模块中按层级配置“平台运营公司 → 投资方 → 项目 → 站点 → 设备”。
  4. 在“数据字典”维护指标、设备类型、电价方案、通知类型；这些配置会影响前端展示和算法参数。
  5. 在“运维管理”中配置告警、通知、工单模板，确保告警能够触发短信/邮件/站内信。
  6. 定义地图坐标与项目优先级，用于首页看板的地理分布与收藏功能。

- **交付物**：角色权限生效，所有项目与设备档案完整，基础字典数据配置完毕。

## 阶段 4：定制功能与迭代优化

- **目标**：针对智能微电网的高级需求进行二次开发与配置。
- **操作步骤**：
  1. **数据分析拓展**：
     - 在 `myems-aggregation` 中新增自定义聚合任务（例如功率因数影响、需量管理）。
     - 通过修改 `aggregation/tasks` 下的 Python 脚本，实现新的统计逻辑。
  2. **优化策略配置**：
     - 在 `myems-api` 中新增策略接口（如 `controllers/strategies.py`），接收前端提交的光储充策略参数。
     - 将策略参数存入数据库（可新建 `strategies` 表），并调用外部优化服务执行。
  3. **能源流向与大屏**：
     - 在 `myems-web/src/pages` 下创建自定义页面，利用 ECharts/SVG 展示能源流向。
     - 通过 WebSocket（可在 `myems-api` 扩展）实现实时刷新。
  4. **运维闭环**：
     - 配置 `myems-admin` 的工单模板与巡检计划，结合 `myems-api` 的告警推送实现闭环。
     - 可选地集成钉钉/企微，实现通知联动。
  5. **安全与日志**：
     - 启用 HTTPS（Nginx 反向代理），限制关键接口访问。
     - 在 `myems-api` 中配置操作日志、登录日志，定期审计。
  6. **持续交付**：
     - 编写部署脚本（如 Ansible/CI）自动化更新。
     - 建议每两周回顾指标，调整模型与配置。

- **交付物**：满足业务定制需求的大屏、策略模块、运维流程，以及持续迭代机制。

## 附录：常见问题与参考资料

- MyEMS 官方文档：https://myems.io/docs
- 部署视频与课程（中文）：https://space.bilibili.com/518847906
- 技术支持社群：加入 README 中提供的 QQ/微信群。
- 若需与电力交易平台或调度系统对接，可在 `myems-api` 新增 REST/WebSocket/消息队列适配器。

> 建议以“阶段”作为项目里程碑，完成一个阶段后再进入下一阶段。这样既能保证系统逐步上线，也方便非编程人员与技术团队协作。
