# 扣扣的家：可实施设计契约（2026-08-31评审稿）

## 阅读边界与确认来源

本稿补齐设计，不代表功能已开发、已上线或已通过用户验收。明确区分三类信息：U=用户已明确提出；E=乙方工程方案，供评审；V=当前源码可证明的事实。E类不得写成用户已确认。没有新增账本、费用分摊、家务积分或实时定位。

U01：服务夫妻、家人，朋友使用普通账号并由管理员按需授权点菜或露营。U02：账号可叠加角色，厨师属于餐饮子角色。U03：分类菜谱结构化记录食材、调料、图片；调料不填用量，不填难度和忌口。U04：各自选择某餐，汇总待做菜单与食材；家中库存全部展示并用颜色辅助判断。U05：非即时购物愿望与下次超市清单。U06：中国地图、目的地、节点、路线、酒店、交通和状态线型。U07：行李模板由用户自己命名并填写物品，不存在系统烧烤模块。U08：与朋友协作，可以不同家庭负责不同物品。U09：非行程成员不可进入，历史参与者可查看历史行程；旅中和旅后可以加照片。U10：家庭待办有负责人和提醒。U11：日历能创建餐点并聚合纪念日、行程等事件。U12：收藏灵感、家庭档案、非财务数据看板。U13：代码Git托管、Docker部署，单域名pp6v4.com通过/api/反向代理，后续支持Web/App。

V：源码包含登录、家庭、菜谱、餐点、库存、购物、日历、行程和行李模板模块。当前只有访问令牌，没有refresh接口；当前模块权限表不等于所有服务都已实施模块鉴权。下文未实现接口均为目标契约，不是现网API清单。

## D01 统一导航与视觉交互

沿用pages.json五个页签及顺序：日历、吃什么、去露营、买东西、我的家。日历是首页，不另增一个与它并列的首页。我的家收纳成员与权限、家庭待办、收藏灵感、家庭档案、数据看板、通知设置；不把日历主入口藏入我的家。

E：清新可爱、温暖家庭感，奶油底色#FFFDF7、背景#F7F3E8、主色#4E9C78、文字#283D32、缺料#B86512、未知#68736B。所有颜色状态同时有文字或图标；正文至少28rpx，触控区域至少88rpx。地图保留供应商底图与署名，不自行绘制不准确国界。页面必须覆盖加载、空列表、无权限、请求失败重试、提交中、提交成功六种状态；无权限不使用“暂无数据”掩盖。

## D02 认证、家庭隔离与权限算法

外部Base URL为https://pp6v4.com/api/v1，内部Nest前缀/v1。业务请求携带Bearer令牌及X-Household-Id；缺少、空白或格式不合法的家庭头在查询数据库前返回400，禁止undefined条件导致越界查询。所有资源查询使用id+householdId联合条件。客户端隐藏按钮仅为体验，不能代替后端授权。

E：登录使用wx.login的code；服务端换取微信身份后签发15分钟访问令牌。刷新采用30天轮换的随机令牌，数据库只存哈希，重复使用旧刷新令牌撤销整个会话族；退出撤销当前会话。当前版本只实现访问令牌，刷新设计属于待开发内容。openid/session_key不返回为业务授权凭证，不写日志。微信请求超时返回502，客户端重新取code；code有效性不确定时不盲目重复同一个code。

E：平台账号、家庭成员、行程成员分层。一个User可有多个Membership，但这只是架构可扩展性，不要求一期做完整多家庭切换运营系统。角色默认权限取并集；成员显式覆盖按模块替换默认值；effect=DENY优先于任何角色。VIEW<EDIT<MANAGE只在同一模块内比较，禁止跨模块推导。每次请求读取当前成员状态和权限版本，停用后立即拒绝；不依赖JWT里旧角色。

| 模块代码 | VIEW | EDIT | MANAGE |
| --- | --- | --- | --- |
| recipes | 浏览已发布菜谱和所需材料 | 厨师录入、修改、发布与下架 | 分类维护和管理全部菜谱 |
| meals | 查看获准餐点 | 创建餐点、添加/撤回本人想吃的菜 | 确认菜单、推进烹饪状态、修改他人选择 |
| inventory | 查看库存数量与位置 | 手工入库、调整 | 调整标准食材、归并记录 |
| shopping | 查看清单 | 增加、编辑、勾选本人或共享清单项 | 归档清单和管理全部项 |
| trips | 在已加入行程内查看 | 创建行程或编辑已加入且canEdit=true的行程 | 管理该行程成员仍需tripRole=OWNER |
| packing_templates | 浏览家庭共享模板 | 创建模板、编辑本人模板 | 管理家庭内所有模板 |
| tasks | 查看获准家庭待办 | 创建、更新本人负责待办 | 分配和管理全部待办 |
| favorites | 查看家庭共享收藏 | 创建、维护本人收藏并转换草稿 | 管理家庭全部收藏 |
| archive | 查看字段ACL允许的内容 | 编辑ACL允许的字段 | 管理字段定义与ACL，不自动扩大行程访问权 |
| dashboard | 查看本人有权来源的聚合 | 不使用 | 不使用 |
| members | 查看最小成员目录 | 不使用 | 邀请、角色授权、停用、转让管理员 |

E：朋友来点菜建议授予recipes:VIEW、meals:EDIT，不授予inventory或members:MANAGE。餐点显示菜谱用料并不自动暴露家庭库存数量、存放位置；库存比对只给inventory:VIEW成员。只来露营的朋友建议trips:VIEW或EDIT，且必须另有该趟TripMember；不授予全家庭模板浏览，行程中仍可看已经复制的物品。

管理员管理成员不等于能读取未加入行程。家人初始角色和朋友初始角色均为可编辑预设，不擅自给朋友全部功能。

## D03 邀请、授权与退出

E：管理员创建随机至少128bit邀请码，数据库保存SHA-256摘要，不把角色或householdId信任地放在二维码参数里。默认有效48小时、单次兑换，管理员可调整或撤销。用户微信登录后提交code兑换；事务检查expiresAt、revokedAt、uses<maxUses及成员状态，创建Membership、MemberRole和PermissionOverride；同一个用户重试返回既有成员，不重复消耗次数。并发最后一次兑换只允许一个成功。

已经登录但未加入的账号可以经本人提交邀请或管理员确认加入；不以手机号、昵称或猜测openid搜索授权。权限修改需要版本号，旧版本409。最后一个有效ADMIN无法退出/停用；转让时事务中先授予新管理员再移除旧管理员。授予人不能授出高于自己管理权限的资源。

| 目标接口 | 输入 | 输出/异常 |
| --- | --- | --- |
| POST /households/:id/invitations | roleCodes[], grants[], expiresAt, maxUses=1 | invitationId, code仅创建时返回, expiresAt；403/409 |
| POST /invitations/redeem | code | membershipId, household, effectivePermissions；过期410 |
| DELETE /invitations/:id | version | revoked=true；已兑换不自动移除成员 |
| GET /members | cursor, limit | 最小成员目录，不返回openid |
| PATCH /members/:id/permissions | version, roleCodes[], overrides[] | version+1, effectivePermissions；409冲突 |
| PATCH /members/:id/status | version, ACTIVE或DISABLED | 更新状态及审计；禁止停用最后ADMIN |
| POST /households/:id/transfer-admin | targetMembershipId, version | 新管理员信息；目标须本家庭ACTIVE |

## D04 菜谱、标准食材与图片

菜谱编辑字段：name必填1~80字，categoryId可空，ingredients至少1项；每项ingredientId或新名称、quantity可空、unit必填，quantity用正数十进制字符串最多3位小数；seasonings仅名称数组；steps按顺序的非空文本；coverAssetId及步骤图片指向已确认MediaAsset。不含difficulty/allergy/nutrition。提交时trim后再校验，拒绝全空格名称；调料去重，但不随意把生抽、老抽合并。

E：保存为DRAFT时允许缺封面；发布PUBLISHED前要求食材、做法和至少一张已确认成品图。已有无图片发布菜谱不自动删除，应标注待补齐。归档菜不再进入新餐点选择，但历史快照不变。分类删除改为归档，既有菜谱仍可展示分类历史名称。

| 目标接口 | 输入 | 输出/约束 |
| --- | --- | --- |
| GET /recipes | q, categoryId, status, cursor, limit | 普通账号只看PUBLISHED；厨师看可维护范围 |
| GET /recipes/:id | 无 | 分类、食材、调料、步骤、图片；无权404 |
| POST /recipes | 完整草稿字段 | recipeId, status=DRAFT, version=1 |
| PATCH /recipes/:id | version及更新字段 | version+1；409不覆盖他人修改 |
| PATCH /recipes/:id/status | status, version | 发布前校验图片；归档保留历史 |
| POST/PATCH /recipes/categories | name, sortOrder, version | 分类维护；家庭内归一化名称唯一 |

## D05 同餐点菜、需求快照与库存比对

E：同家庭同日期同餐别默认一张餐点；目标增加localDate(YYYY-MM-DD)及mealType=BREAKFAST/LUNCH/DINNER/OTHER，唯一(householdId,localDate,mealType)。OTHER另设可选slotKey避免多顿加餐冲突。scheduledAt用于提醒，不当作同餐唯一键。

各成员选择表示“想吃”，不是默认每人做一份。同一道菜多人选择只生成一道待做菜；cookMultiplier由厨师确定，默认1。需求量=菜谱默认量×cookMultiplier，不乘投票人数。可查看每道菜有哪些人想吃。确认餐点时保存菜谱名称、材料名、数量、单位、调料快照，之后编辑菜谱不改历史。

E：DRAFT允许成员增删自己的选择；CONFIRMED后仅meals:MANAGE通过显式重新打开或调整并生成新snapshotVersion；COOKING停止普通改单；COMPLETED只读。取消记录保留。库存扣减必须由用户勾选确认，不是完成餐点即强制扣减。

| 比对情形 | 返回状态 | 显示与算式 |
| --- | --- | --- |
| 相同ingredientId、同单位且有明确数量 | ENOUGH/SHORT | available>=required为绿色，否则橙色且shortage=required-available |
| 无记录、单位不同或数量未填 | UNKNOWN | 灰色“待确认”；shortage=null，不假定库存为零 |
| 调料明确标记有/无/未知 | PRESENT/ABSENT/UNKNOWN | 只比有无；quantity和单位均不强制，不能精确扣减 |
| 库存过期但未核实 | NEEDS_CHECK | 不计为可靠可用量，保留显示并提醒确认，不自动认定安全可食用 |

E：quantity使用Decimal运算并按3位小数返回字符串；不做g/kg、个/克自动换算，避免伪精度。同食材不同单位分两行。用户确认无库存时可以显式availability=ABSENT，才可按0计算缺口。所有食材和调料都展示，不仅显示缺的。

具体设计样例：番茄炒蛋300g番茄+2个鸡蛋，番茄汤200g番茄+1个鸡蛋，同一餐各做1份；无论2人都选番茄炒蛋还是1人选，总需求500g番茄、3个鸡蛋。库存350g番茄、4个鸡蛋，缺150g番茄，鸡蛋充足；库存若为0.35kg且未启用转换则番茄为UNKNOWN，不能把不同单位相减误算499.65g。生抽仅标“有/无/未知”。

| 目标接口 | 输入 | 返回/副作用 |
| --- | --- | --- |
| POST /meals | localDate, mealType, scheduledAt? | 既有同餐返回原记录或409，客户端跳转原记录 |
| POST /meals/:id/items | recipeId, note? | 幂等记录当前成员想吃；不提升菜份数 |
| DELETE /meals/:id/items/:recipeId | 无 | 默认只删除当前成员的选择 |
| PATCH /meals/:id/dishes/:recipeId | cookMultiplier, version | 厨师调整实际份数 |
| POST /meals/:id/confirm | expectedVersion | 锁定快照并写日历投影 |
| POST /meals/:id/recalculate | snapshotVersion | 全部材料、状态、缺口和匹配原因，不修改库存 |
| POST /meals/:id/complete | deductInventory, confirmedDeductions[], expectedVersion | 完成及人工确认的扣减，同事务防止重复扣库存 |

## D06 库存与下次超市清单

库存：Ingredient增加kind=FOOD/SEASONING；InventoryItem为批次/存放位置，food需明确quantity或unknown标志；seasoning可仅availability，不强迫填0.001。调料和菜谱调料用同一标准名称ID匹配，名称相近但不同不得自动合并。STOCK_IN/CONSUME/ADJUST/EXPIRE流水记录actorMembershipId、sourceType、sourceId、before/after、quantityDelta、操作时间。手工修改是绝对值调整，流水存差值。

购物：WISHLIST（以后想买）、NEXT_TRIP（下次超市）、REPLENISH（常备补货）、PURCHASED（已买）。支持分组、勾选、撤销勾选和复购。购买记录保留purchasedBy/At；再次购买生成新项并引用previousItemId，不能抹掉历史购买。勾选后可选择“加入库存”，必须确认标准食材、单位、数量，不自动声称家庭已经入库。

E：缺料导入输入mealId、snapshotVersion和selectedRequirementIds，后端按快照重算，不信任客户端任意缺口数。唯一(listId,sourceType,sourceId,sourceVersion,sourceItemKey)使重试不重复。跨餐点同食材先并列显示来源、用户确认再合并；不同单位不合并。导入新快照不得静默覆盖已购买项。

当前路由保留/shopping-lists及/next-trip/items，目标不为设计美观任意改成/shopping；用GET /shopping-lists、POST /shopping-lists、PATCH /shopping-lists/:id、POST /shopping-lists/:id/items、PATCH /shopping-lists/items/:id、POST /shopping-lists/items/:id/repeat补齐CRUD。归档清单代替批量物理删除。

## D07 行程访问、历史与多家庭分工

Trip的创建者自动为tripRole=OWNER、canEdit=true；其余成员必须显式邀请入行程。OWNER可管理该行程，家庭ADMIN未加入时不获得内容读取特权。列表、详情、日历投影、照片、模板来源、看板计数均先按TripMember过滤后分页，不能只保护详情而从日历泄露标题、地点和出发日期。

E：TripMember增加tripRole=OWNER/MEMBER、status=ACTIVE/HISTORY/REVOKED、leftAt、version。完成行程时保留参与关系；历史账号仍在本家庭有效且为ACTIVE或HISTORY时可读并上传本人照片。REVOKED为主动撤销，不保留读取权；家庭停用优先拒绝。主动移除与历史访问冲突的产品选择见未决项R02，当前不得擅自认为“只要曾参加永远可见”。

U08需要“不同家庭准备不同东西”，不能只做一个人负责人。E：每次行程创建准备小组TripPreparationGroup，例如“我们家”“朋友A家”；小组只包含该行程成员，不读取朋友真实家庭档案，也不要求朋友先创建另一个完整家庭系统。行李项可以分配groupId及该组的responsibleMembershipId，组为承担方、人为联系人。按组和按人筛选未准备物品。移出成员前显示其未完成责任并要求重分配或显式置空，不能无声丢失责任。

| 目标接口 | 字段 | 权限与效果 |
| --- | --- | --- |
| GET/POST /trips | title, startsAt, endsAt?, destination? | 按成员过滤；创建需trips:EDIT |
| GET/PATCH /trips/:id | version及基础信息 | 读需成员，写需canEdit；版本冲突409 |
| POST /trips/:id/members | membershipId, canEdit, groupId? | OWNER；目标本家庭ACTIVE，朋友可为受限GUEST |
| PATCH /trips/:id/members/:memberId | canEdit, status, version | OWNER；不得移除最后一个OWNER |
| GET/POST/PATCH /trips/:id/preparation-groups | name, members[], version | OWNER管理小组；名称仅行程内唯一 |
| PATCH /trips/:id/status | status, expectedVersion | OWNER；完成保留成员，更新日历和路线状态 |

## D08 自定义行李模板与独立快照

用户创建任意模板，名称必填1~80字、物品至少1项，name/quantity?/unit?/note?/sortOrder组成物品。不自动提供烧烤物品，不根据中文名称套固定业务。模板创建者或有packing_templates:MANAGE者可改；其它有VIEW者只能套用。

套用到行程时复制快照；一个行程可选多个模板，也能手工加项。去重只按来源模板项ID，不按物品名称：两个模板都含“水”应保留两个来源，提醒用户自行合并，避免错把两家各带的一份当重复。重复套用同一模板，已有项保留数量、负责人和状态，新增加的模板项可以追加；不得同步覆盖。明确返回addedCount/skippedCount及items。

E：删除模板项采用archivedAt逻辑归档保留稳定ID；已应用清单保存sourceTemplateNameSnapshot和sourceItemNameSnapshot。模板改名/归档不改历史展示。当前实现来源项删除SET NULL且模板名实时关联，尚未覆盖这两个历史边界，需后续迁移。用户从行程移除后再套同一模板是否恢复，建议一期“显式移除保存excludedAt，默认重复套用不复活；恢复需选择重新加入”。这是工程建议，不标注成当前行为。

一期状态PENDING/PACKED；状态写入仍要求canEdit=true，负责人身份单独不授予编辑权限。两人同时改数量或负责人用version乐观锁；前端重复点选按请求锁防抖。归档/移除前提示目标和影响，不物理清理历史业务。

| 操作 | 关键不变量 | 预期错误 |
| --- | --- | --- |
| 新建/改模板 | trim后非空；差量编辑保持已有项ID；拒绝重复项ID | 400/409 |
| 套用 | 同家庭模板+行程编辑权；数据库唯一键抵御并发重复 | 403/404 |
| 手工新增 | sourceTemplateId和sourceTemplateItemId为空 | 400 |
| 改负责人 | 人属于行程，若有小组还须属于小组 | 400 |
| 修改快照 | 不更新PackingTemplate或PackingTemplateItem | 409旧版本 |
| 删除/归档 | 保留快照、来源名称及操作历史 | 403只读 |

## D09 地图、路线、交通与住宿

选择位置可用微信原生选点，不强制定位权限；拒绝定位仍可手工填地点。服务端/maps/search和/maps/routes代理腾讯位置服务，业务API仍只用pp6v4.com/api/。若采用小程序SDK直接检索需额外登记apis.map.qq.com，不能把“单业务域名”误写成“任何第三方都不需要域名配置”。腾讯位置服务SDK官方入口说明其基于WebServiceAPI并受配额限制：[官方说明](https://lbs.qq.com/miniProgram/jsSdk/jsSdkGuide/jsSdkOverview)。

E：供应商返回坐标标记coordSystem=GCJ02、provider=TENCENT，接口统一lat/lng，几何数组统一[lng,lat]。不把GCJ-02原样标记为EPSG:4326/WGS84写入geography。初期JSONB存路线几何+坐标系；需要空间计算时再使用经验证转换或同坐标体系计算。完整保留地图署名，未拿到Key/配额和实机效果前不能称地图已验收。

TripStop字段：id、title、stopType(MEETING/WAYPOINT/CAMPSITE/ATTRACTION/HOTEL/RETURN)、latitude、longitude、coordSystem、arriveAt?、leaveAt?、sortOrder、note、version。TripLeg连接前后两个有效节点：fromStopId、toStopId、mode(DRIVING/RAIL/FLIGHT/WALKING/OTHER)、routeKind(PLANNED/SCHEMATIC)、geometryJson、distanceMeters?、durationSeconds?。酒店住宿为Accommodation：stopId?、name、address、checkInDate、checkOutDate、contact?、reservationNote?，不记录账单金额。

路线规划失败或交通不支持时保留节点连线并明确标“示意线，非导航路线”，距离/时长为空而不是估造数据。路线供应商结果按节点版本缓存，节点变更后失效，等待响应时保留旧路线并标记过期。

待出行显示虚线闪烁；已完成显示实线箭头；出行中强调实线。动画仅前台、只有可见选中路线更新，onHide清定时器，不在后台继续耗电。低版本不支持时静态虚线+状态标签，不能降级成假称有动画。原生polyline详细能力的微信文档本轮无法读取，须实机验证后冻结性能参数。

接口：GET/POST/PATCH/DELETE /trips/:id/stops；POST /trips/:id/stops/reorder（完整id序列+version，事务校验不漏不重）；GET/POST/PATCH/DELETE /trips/:id/legs；GET/POST/PATCH/DELETE /trips/:id/accommodations。删除节点前列出受影响路段和住宿，用户确认后事务归档；不悄悄删除关联照片，照片退回行程级归属。

## D10 图片上传、隐私与历史相册

E：照片一期只允许JPEG/PNG/WebP，单张不大于10MiB，一批最多9张；这些是可配置工程上限，非平台限制。用户选择后可压缩，失败允许原图在上限内重试；不主动采集位置，EXIF GPS默认剥离，拍摄地点由用户选择。允许进行中与已完成行程的有效/历史成员添加本人照片。只读成员可有独立photoAdd=true能力，不因此获得行程编辑权。

POST /media/upload-intents输入ownerType(RECIPE/TRIP/FAVORITE/ARCHIVE)、ownerId、filename、mime、size、stopId?，先按所属资源鉴权，后创建intent和随机objectKey。返回intentId、限对象权限的上传凭证、expiresAt、允许大小与类型。客户端直传COS后POST /media/assets/confirm仅提交intentId、objectKey、checksum，后端HEAD核验大小/MIME/键归属并处理图像校验，PENDING→PROCESSING→READY，异常REJECTED。上传意图过期后拒绝确认，孤儿对象24小时后由受限后台清理，不扫描删除任意桶路径。

图片访问先通过业务权限换取短时读地址。有效预签名URL持有者可直接读取，这是能力链接而非每次业务鉴权；撤权后已签发URL不能承诺立刻失效。E：普通行程图URL有效期60秒，客户端登出清缓存；家庭档案敏感附件经鉴权代理读取、不发直链。需更强撤销时使用每次鉴权代理并评估3Mbps带宽，不以私有桶等同完全防转发。[腾讯云预签名说明](https://intl.cloud.tencent.com/zh/document/product/436/45228)。

业务api走pp6v4.com/api/；COS直传/下载实际使用桶域名，必须独立登记小程序对应uploadFile/downloadFile域名。后续Web浏览器默认域名预览限制、CORS及受控代理需另验证，不增加购买新根域名的要求。[腾讯云小程序预签名文档](https://cloud.tencent.com/document/product/436/36162)。

GET /trips/:id/photos支持日期游标和节点筛选；PATCH /photos/:id更新caption、takenAt、stopId，原作者或OWNER可改；DELETE先归档、写审计，异步删除遵守保留期。照片必须重新验证真实业务归属，不接受客户端把他人objectKey绑定到自己行程。

## D11 日历与待办/工单

日历为主入口，from包含、to不含。区间相交条件startsAt<to且(endsAt为空按点事件判断，或endsAt>from)，不能只查开始时间，否则漏掉跨月露营。全天日期以家庭Asia/Shanghai解释；时间点存UTC，禁止裸本地字符串。餐点、行程、待办、纪念日为来源真数据，CalendarEvent是可重建投影。来源创建/修改/取消与outbox同事务；投影唯一(sourceType,sourceId,occurrenceKey)，不产生重复提醒。

聚合先验证来源权限，不对无权事件返回标题、地点、总数或红点。用户只能直接创建纪念日/普通日程，不能任意sourceType=TRIP并伪造sourceId。从日历创建某餐复用POST /meals，禁止另建一份假餐点事件。

E：纪念日一期公历年度重复，2月29日非闰年默认2月28日、可配置；农历生日属于待确认增强，不假装已支持。取消某次重复用EventException，而非删除整个系列。

待办字段title(1~120)、description(<=2000)、assigneeMembershipId、dueAt?、priority(LOW/NORMAL/HIGH)、status(PENDING/IN_PROGRESS/COMPLETED/CANCELLED)、reminderAt?、createdById、version。示例“清洗空调”是普通待办，不做周期家务排班或积分。E：工单作为待办的一种type=REQUEST，共用处理记录，支持问题描述、附件、受理、处理、完成；若用户期待软件反馈工单，应另评审不混淆。

任务负责人或tasks:MANAGE可推进状态，创建者可改未开始任务；只有管理权限可重新分配。截止日前后提醒不改变完成状态；完成写completedAt/completedBy，重新打开需原因，TaskHistory保留。GET/POST /tasks；GET/PATCH /tasks/:id；PATCH /tasks/:id/status；POST /tasks/:id/comments。删除使用归档并取消待发提醒。

## D12 收藏灵感、档案和看板

收藏字段type(TEXT/IMAGE/LINK)、title、text?、sourceUrl?、assetIds[]、tags[]、visibility(PRIVATE/HOUSEHOLD)、createdById、version。E：一期不自动抓取网页，不绕过网站限制；手工粘贴链接与封面即可，复杂度来自转换而非收藏本身。未来抓取须防SSRF（阻止内网IP、重定向内网、异常协议）。POST /favorites/:id/convert输入targetType和用户确认字段，返回targetId/status=DRAFT；幂等键防止重试建多份。转换为菜谱时不凭一条收藏自动补造食材或做法；来源收藏仍保留。

档案采用可配置字段，key、label、valueType(TEXT/DATE/CONTACT/ADDRESS)、sensitive、visibility(MANAGERS/MEMBERS/SELECTED)、allowedMembershipIds、valueCiphertext、keyVersion、updatedById、version。默认仅管理者可读写，新成员和朋友不默认继承。敏感值应用层AES-GCM加密，随机nonce、认证标签，密钥不进数据库/镜像/Git；搜索不支持密文模糊查询。普通列表不返回敏感值，读/改有审计。第一批字段见评审项R03，不自作主张收身份证或银行卡信息。

| 看板指标 | 口径 | 权限与范围 |
| --- | --- | --- |
| 已发布菜谱数 | 当前PUBLISHED且未归档Recipe数量 | recipes:VIEW |
| 已完成餐次 | 时间范围内COMPLETED Meal数，不以选菜项数替代 | meals:VIEW |
| 常选菜 | 去重(mealId,recipeId)的出现次数 | 只展示菜，不评价或排名家庭成员 |
| 当前购物待购数 | WISHLIST/NEXT_TRIP/REPLENISH未归档项数，另分组 | shopping:VIEW |
| 行程数及待备行李 | 当前用户可访问行程数及PENDING未排除项数 | 每趟按TripMember过滤 |
| 待办完成情况 | 指定范围创建的未取消任务中COMPLETED/总任务，分母0返回null | tasks:VIEW，显示分子分母 |

看板GET /dashboard/summary输入from,to；先按权限查来源后聚合，缓存key含userId、householdId、permissionVersion和范围。源数据变化失效；无权限指标隐藏，不显示他人数据为0。禁止金额、预算、费用分摊和人员勤劳排名。

## D13 通知、幂等与失败降级

站内Inbox为可靠主记录，微信订阅消息为经授权的辅助通道。用户点击明确提醒操作再调用订阅API；“开启提醒”不是永久无限发送许可。平台模板ID、资格、一次性授权实际额度需管理员在微信后台确认，不在设计里捏造。订阅结果accept不等同发送成功，send API成功也不等同用户已读。

E：任务临期/行程前1天/行李检查/食材临期可配置，安静时段22:00~08:00。NotificationJob唯一(recipient,eventType,sourceId,scheduleVersion,channel)。事务outbox写入事件，worker发送前重新鉴权并确认业务未取消；重试1/5/15分钟最多3次，仅重试明确可重试失败，未知结果按通道幂等能力处理并记录UNKNOWN，避免盲目重复通知。拒绝授权或额度不足只保留站内提醒，不能一直弹授权框。

GET /inbox、PATCH /inbox/:id/read、GET/PATCH /notification-preferences、POST /subscriptions/receipts。收件箱内容也走来源权限；撤权后隐藏失效条目而非继续泄露任务/行程标题。

## D14 通用写入、异常与发布门槛

输入未知字段拒绝或白名单过滤并记录；金额功能无输入。Decimal统一字符串；时间ISO8601带时区；trim后长度校验；更新version不匹配返回409，保留客户端草稿。关键接口幂等键作用域为actor+route+key，保存bodyHash，相同key不同请求返回409；完成餐点、邀请兑换、模板套用、购物导入、媒体确认按事务和唯一约束防双写。

列表limit默认20最大100，排序createdAt+id或sortOrder+id稳定。401只代表未认证；403无模块权；404隐藏资源；409冲突；422业务状态不允许；429含重试信息。生产日志携带requestId而不含令牌、openid全值、签名URL和敏感档案值。

源码发布门槛：缺X-Household-Id必须失败；所有聚合入口包括日历和看板均通过资源权限；Docker构建排除.env、.git、私钥与本地依赖；API须有受控外网出口才能调用微信/COS，而不是只接internal:true网络；生产数据库/Redis仍不映射公网端口。上述是从源码发现的待开发或待验证项，本次不把它们写成已经解决。

## D15 待用户评审的产品选择

R01：确认餐点后如何改单。建议确认前本人撤回，确认后厨师或餐点管理者修改并保存新快照。

R02：主动移除成员与历史访问如何取舍。建议完成时保留历史参与关系；安全性主动撤销优先停止访问。用户原话确认了历史成员可看，但没明确撤销例外，仍待评审。

R03：家庭档案首批字段和工单用途。建议地址、联系人、自定义非高敏字段；工单暂作为请求型待办，不默认收集身份证等信息。

R04：微信订阅模板和地图Key等外部配置。配置未提供不妨碍本稿接口设计，但会阻塞对应平台联调，不能将其标为已验收。

这四项不是让项目停止：与它们无关的模板、页面、接口与数据结构继续开发；涉及不可逆隐私/历史权限的动作，在评审前不对真实成员执行。
