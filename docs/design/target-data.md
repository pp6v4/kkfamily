# 扣扣的家：目标字段字典与迁移约束（2026-08-31）

## 模型命名与范围

这是待开发的目标模型，不是已经执行的DDL。现有Prisma没有@@map，物理表为带引号的PascalCase（例如"TripPackingItem"），并非旧文档列出的snake_case小写表。新增模型维持相同命名，避免迁移误新建重复表。本文B=Boolean、I=Integer、S=String、D=Decimal(12,3)、T=UTC时间、J=JSONB；?表示nullable；ID为cuid字符串。所有tenant实体householdId必填，version默认1，用于乐观锁。

所有未完成表先在隔离环境迁移，不直接拿本字典向生产执行建表。变更遵循新增可空字段→回填校验→补约束→切服务→观察→清理旧字段；旧字段删除须另列清单评审。

标识约定：除User/AuthSession使用userId外，家庭业务新增createdById/updatedById均指Membership.id，actorMembershipId同义。当前CalendarEvent.createdById保存的是User.id，迁移必须按householdId+userId解析唯一Membership，再写新createdByMembershipId；不直接把旧值当成员外键。旧操作者无法解析时保留原始来源并设新字段为空，不伪造用户。T类型统一以UTC写入，API必须解析带时区字符串；不因为数据库字段叫timestamp就假定已经消除时区差异。

## 身份、邀请和授权

| 模型 | 字段与约束 | 索引/事务 |
| --- | --- | --- |
| User（扩展） | status:S=ACTIVE/DISABLED, permissionVersion:I, updatedAt:T；openid只服务端使用 | 当前openId唯一不变 |
| Membership（扩展） | version:I, updatedAt:T, disabledAt:T?；保留householdId/userId/status | UNIQUE(householdId,userId)；同家庭关联用复合外键或事务校验 |
| RolePermission（新增） | roleId, module:S, level:VIEW/EDIT/MANAGE | UNIQUE(roleId,module)；替代散落的role code判断 |
| ModulePermission（扩展） | effect:ALLOW/DENY；DENY时level可空 | UNIQUE(membershipId,module)；覆盖角色默认，不叠加成提权 |
| Invitation（新增） | id,householdId,codeHash:S,createdById,expiresAt:T,maxUses:I,usedCount:I=0,revokedAt:T?,grantsSnapshot:J,version:I | UNIQUE(codeHash)；CHECK(usedCount>=0且usedCount<=maxUses) |
| InvitationRedemption（新增） | invitationId,userId,membershipId,redeemedAt:T | UNIQUE(invitationId,userId)；兑换时锁Invitation再写成员 |
| AuthSession（新增） | id,userId,refreshHash:S,familyId:S,expiresAt:T,consumedAt:T?,revokedAt:T?,rotatedToId? | UNIQUE(refreshHash)；旧令牌重用撤销同familyId会话 |
| AuditLog（新增） | id,householdId,actorMembershipId?,action:S,resourceType:S,resourceId:S,requestId:S,diffRedacted:J,createdAt:T | INDEX(householdId,createdAt,id)；日志追加不可普通修改 |

权限写入与审计同事务，禁用最后ADMIN在锁定家庭管理员集合后判断。成员profile和目录不返回openid、令牌或他人的邀请摘要。deleted/disabled用户不是依赖清空JWT声明完成撤权。

## 餐饮、库存与购物增量

| 模型 | 字段与约束 | 数据迁移策略 |
| --- | --- | --- |
| Ingredient（扩展） | kind:FOOD/SEASONING,nameNormalized:S,defaultUnit:S? | 现有默认FOOD；调料标准化由用户确认映射，不按模糊名强合并 |
| RecipeSeasoning（扩展） | ingredientId?，保留name快照 | 逐步回填标准调料，不添加quantity |
| Recipe（扩展） | version:I,coverAssetId?,archivedAt:T? | 现有coverObjectKey经对象核验后关联MediaAsset |
| InventoryItem（扩展） | quantity:D?,availability:KNOWN/ABSENT/UNKNOWN,kind:FOOD/SEASONING,version:I | 旧数量转KNOWN；调料可以quantity=null，不把null当0 |
| InventoryTransaction（扩展） | actorMembershipId?,sourceType?,sourceId?,beforeQuantity:D?,afterQuantity:D?,requestKey:S? | 原历史操作者未知保持null，不伪造；新写必填操作者 |
| Meal（扩展） | localDate:DATE,mealType枚举,slotKey:S='',createdById?,version:I,snapshotVersion:I=0,completedAt:T? | 由scheduledAt按Asia/Shanghai回填；重复餐点先生成冲突报告，人工确认归并 |
| MealDish（新增） | id,mealId,recipeId,cookMultiplier:D=1 | UNIQUE(mealId,recipeId)；用户选择与实际烹饪份数分离 |
| MealSnapshot（新增） | id,mealId,version:I,confirmedById,confirmedAt:T,recipeSnapshots:J | UNIQUE(mealId,version)，写后不可变 |
| MealRequirement（新增） | id,snapshotId,ingredientId?,nameSnapshot:S,kind:S,quantity:D?,unit:S?,sourceRecipeIds:J | INDEX(snapshotId)；quantity=null明确表示未知或无用量调料 |
| ShoppingItem（扩展） | ingredientId?,sourceVersion:I?,sourceItemKey:S?,purchasedAt:T?,purchasedById?,previousItemId?,version:I,archivedAt:T? | 来源键以列表+来源+版本+项唯一；新项不覆盖已购买历史 |
| ShoppingPurchase（新增） | id,itemId,actorMembershipId,purchasedAt:T,quantity:D?,unit:S?,stockInTransactionId? | 用于购买后入库关联，不增加价格/预算字段 |

库存扣减将唯一(sourceType,sourceId,sourceVersion,ingredientId,unit)或DeductionOperation幂等记录作为最终防线；锁定同单位库存批次后核实非负再写流水与汇总。失败全部回滚，不产生已完成餐点但半扣库存。过期、未知和不兼容单位不自动扣减。

## 行程、成员、小组与节点

| 模型 | 字段与约束 | 索引/校验 |
| --- | --- | --- |
| Trip（扩展） | createdById?,version:I,updatedAt:T,completedAt:T?,archivedAt:T? | CHECK(endsAt为空或endsAt>=startsAt)；按成员过滤列表 |
| TripMember（扩展） | tripRole:OWNER/MEMBER,status:ACTIVE/HISTORY/REVOKED,photoAdd:B=false,leftAt:T?,version:I | PK(tripId,membershipId)不变；历史规则R02待确认 |
| TripPreparationGroup（新增） | id,tripId,name:S,sortOrder:I,version:I,archivedAt:T? | UNIQUE(tripId,name)；“谁家准备”只在本行程有效 |
| TripPreparationGroupMember（新增） | groupId,tripId,membershipId | PK(groupId,membershipId)；FK(tripId,membershipId)到TripMember |
| TripStop（新增） | id,tripId,title:S,stopType:S,latitude:Decimal(9,6),longitude:Decimal(9,6),coordSystem:S,arriveAt:T?,leaveAt:T?,sortOrder:I,note:S?,version:I,archivedAt:T? | CHECK纬度[-90,90]/经度[-180,180]；INDEX(tripId,sortOrder,id) |
| TripLeg（新增） | id,tripId,fromStopId,toStopId,mode:S,routeKind:S,geometryJson:J?,coordSystem:S,provider:S?,distanceMeters:I?,durationSeconds:I?,version:I | 首尾节点同trip且不同；CHECK距离/时长>=0；保存路线来源和示意标志 |
| Accommodation（新增） | id,tripId,stopId?,name:S,address:S?,checkInDate:DATE,checkOutDate:DATE,contact:S?,reservationNoteCiphertext:S?,version:I,archivedAt:T? | CHECK(checkOutDate>checkInDate)；不含金额 |

节点重排在事务中验证传入id集合与现有节点一致，再写sortOrder；若唯一顺序约束启用，采用临时偏移值或延迟约束避免中间态冲突。照片节点归档时把stopId置空保留tripId，不级联删除整个相册。

## 自定义行李的历史补强

现有模型：PackingTemplate、PackingTemplateItem、TripPackingItem已落库。以下新增字段避免“模板内容独立，但来源名还随模板变化”的局部快照问题。

| 模型 | 新字段 | 不变量 |
| --- | --- | --- |
| PackingTemplate | version:I | name只是用户输入，不参与代码分支 |
| PackingTemplateItem | archivedAt:T?,version:I | 差量编辑保留id；移除采用归档而非物理删 |
| TripPackingItem | sourceTemplateNameSnapshot:S?,sourceItemNameSnapshot:S?,groupId?,excludedAt:T?,version:I | 来源名、物品名、数量、单位、备注在套用时复制；归档不联动 |
| PackingApplication（建议） | id,tripId,templateId,templateVersion,actorMembershipId,createdAt | 审计谁套用哪个版本；不是另一份强耦合物品引用 |

保留UNIQUE(tripId,sourceTemplateItemId)。excludedAt不删除唯一来源键，所以再次套用默认跳过已移除项；用户选择“重新加入”才清excludedAt。旧数据来源ID已经SET NULL者无法可靠自动恢复关联，保留快照并标来源未知，禁止按同名猜测绑定。

负责人校验用TripMember，groupId必须同trip，若同时指定人和组，人必须在组内。数据库建议增加(tripId,id)复合唯一键以及相应复合外键；Prisma不支持的CHECK用迁移SQL维护。单一Membership外键不能证明“该人参加了这趟行程”。

## 媒体与附件

| 模型 | 字段 | 约束 |
| --- | --- | --- |
| UploadIntent | id,householdId,actorMembershipId,ownerType,ownerId,objectKey,mime,maxBytes,expiresAt,status,createdAt | UNIQUE(objectKey)；必须先有业务所有权再签名 |
| MediaAsset | id,householdId,intentId,objectKey,thumbnailKey?,mime,sizeBytes,checksum,width?,height?,status,createdById,createdAt,deletedAt? | UNIQUE(intentId),UNIQUE(objectKey)；不保存永久签名URL |
| TripPhoto | id,tripId,assetId,stopId?,caption:S?,takenAt:T?,uploadedById,version:I,deletedAt:T? | UNIQUE(tripId,assetId)；INDEX(tripId,takenAt,id) |
| MediaReference | id,assetId,ownerType,ownerId | UNIQUE(assetId,ownerType,ownerId)；避免仍被引用对象误删 |

多态ownerId无数据库FK时由资源服务检查并在事务内建立引用，异步确认再次验证所有权。未知或不匹配对象状态不得进入READY。签名不进审计内容，用户撤权后的最迟失效由签名TTL决定，无法承诺已下载照片回收。

## 日历、待办与收藏

| 模型 | 字段与规则 | 约束 |
| --- | --- | --- |
| CalendarEvent（扩展） | sourceVersion:I,occurrenceKey:S,allDay:B,timezone:S,visibility:S,version:I | UNIQUE(householdId,sourceType,sourceId,occurrenceKey)；无来源事件可单独id |
| Anniversary | id,householdId,title,month:I,day:I,recurrence:YEARLY/NONE,leapPolicy:S,localDate?,note?,createdById,version | 月日合法；一期公历，不自动宣称农历支持 |
| EventException | id,anniversaryId,occurrenceDate:DATE,action:CANCEL/RESCHEDULE,newDate? | UNIQUE(anniversaryId,occurrenceDate) |
| Task | id,householdId,type:TODO/REQUEST,title,description?,assigneeMembershipId?,dueAt?,priority,status,reminderAt?,createdById,completedById?,completedAt?,version,archivedAt? | INDEX(householdId,status,dueAt,id)；负责人同家庭 |
| TaskHistory | id,taskId,actorMembershipId,fromStatus?,toStatus?,comment?,createdAt | 不可普通更新；字段脱敏 |
| Favorite | id,householdId,type,title,text?,sourceUrl?,tags:J,visibility,createdById,version,archivedAt? | 网址只允许http/https，不后台自动抓取 |
| FavoriteConversion | id,favoriteId,targetType,targetId,actorMembershipId,idempotencyKey,createdAt | UNIQUE(actorMembershipId,idempotencyKey)；源收藏不删除 |

日历range使用区间交叉并对sourceType重新授权。索引只优化查询，不代替权限。未知sourceType或指向不属于家庭的sourceId拒绝写入；客户端不能伪造事件绕过来源服务。

## 家庭档案、通知与后台任务

| 模型 | 字段 | 约束与保留策略 |
| --- | --- | --- |
| ArchiveFieldDefinition | id,householdId,key,label,valueType,sensitive,visibility,version,archivedAt? | UNIQUE(householdId,key) |
| ArchiveFieldValue | fieldId,valueCiphertext,nonce,authTag,keyVersion,updatedById,updatedAt,version | PK(fieldId)；密钥独立环境提供 |
| ArchiveFieldGrant | fieldId,membershipId,canRead,canEdit | PK(fieldId,membershipId)；同家庭检查 |
| NotificationPreference | membershipId,eventType,enabled,leadMinutes,quietStart?,quietEnd?,version | UNIQUE(membershipId,eventType) |
| SubscriptionReceipt | id,userId,templateId,result,recordedAt,clientScene,expiresAt? | 仅记录授权结果，不伪造永久quota |
| OutboxEvent | id,eventType,aggregateType,aggregateId,version,payloadRedacted:J,status,createdAt | UNIQUE(eventType,aggregateId,version) |
| NotificationJob | id,outboxId,recipientMembershipId,channel,status,scheduledAt,attempts,lastError?,sentAt?,dedupeKey | UNIQUE(dedupeKey)；发送前检查源状态与权限 |
| InboxItem | id,recipientMembershipId,sourceType,sourceId,titleRedacted,readAt?,invalidatedAt?,createdAt | INDEX(recipientMembershipId,readAt,createdAt,id) |
| IdempotencyRecord | scope,actorId,keyHash,bodyHash,responseSummary,expiresAt | UNIQUE(scope,actorId,keyHash)；相同key不同body拒绝 |

看板初期不建独立事实表，从有权限的业务实体聚合；Redis缓存按权限版本隔离。过期提醒去重键包含本次有效期版本，不能因每天扫描重复发同一条消息。数据库备份和COS文件生命周期相互独立；媒体备份不是只备份一份签名URL。

## 迁移顺序与验证出口

M01：身份、权限覆盖、邀请和审计。出口：停用、DENY优先、跨家庭、最后管理员和并发兑换用例通过。

M02：行程OWNER/历史、小组、节点/路线/住宿、行李快照字段。出口：不同小组分工、模板重套、归档后快照、日历不泄露未加入行程。

M03：媒体上传意图、照片引用、短时URL和孤儿清理。出口：越权objectKey、超限文件、过期intent、旅后上传、撤权TTL行为。

M04：餐点标准日期、实际菜份数、需求快照、调料库存有无、购物来源幂等。出口：500g番茄/3个鸡蛋样例、同名不同单位、未知库存、重复完成不重复扣库存。

M05：日历重复与跨月、待办、收藏、档案、通知。出口：来源过滤、空分母、字段ACL、任务撤销后不发送、授权拒绝时站内提醒。

任何批次迁移前产生备份与校验值并在隔离数据库恢复演练；破坏性迁移不得只用向下DROP回滚。先添加后兼容、保留旧字段、向前修复优先；未确认迁移不用于生产。
