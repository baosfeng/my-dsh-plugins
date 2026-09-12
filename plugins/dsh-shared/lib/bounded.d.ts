/**
 * dsh-shared — 有界容器原语（issue #198 第二批）。
 *
 * 审计缺口：各插件的字典/数组上限是**各写各的**，或者干脆没有——
 *  - dsh-my-context 的 bySession 会话数无上限（splice 只截断每会话数组）；
 *  - 各插件重复写 push + splice(0, len - max) 的样板，淘汰条数不可观测。
 *
 * 本模块把「上限 + 淘汰语义 + 淘汰计数」收敛为两个原语：
 *
 *  - {@link boundedMap}：Map 形态的有界字典，默认 LRU（get/set 都算使用），
 *    `policy: 'fifo'` 时只按插入顺序淘汰；`toJSON()` 输出普通对象，
 *    替换既有 Record 字段**不改变磁盘 JSON 形态**；`evicted` / `stats()`
 *    暴露淘汰计数（资源观测），`onEvict` 回调供挂钩告警。
 *  - {@link boundList}：FIFO 有界列表，`items()` 零拷贝返回内部数组
 *    （JSON.stringify 得到普通数组，替换既有数组字段不改变持久化形态）；
 *    数组不做 LRU——「访问即移动」对数组是 O(n)，需要 LRU 请用 boundedMap。
 *
 * ⚠️ 适用边界与反例（务必先读）：
 *  - 适用：内存态字典/列表要**有上界**（会话表、路径表、失败记录、最近 N 条明细）；
 *  - 不适用：**事件流 / 审计日志**——淘汰即丢数据，应落 jsonlAppender
 *    （lib/jsonl.ts）+ 自身条目上限，不要在内存里"转圈"；
 *  - 不适用：需要全量历史做统计的结构（淘汰会改变统计结果，应先聚合再淘汰）；
 *  - 淘汰是**静默丢数据**的语义，因此上限必须显式（默认值只是兜底，不是设计值），
 *    且接入插件的资源影响栏要写明「上限 × 单条大小 = 内存上界」。
 */
/** 淘汰策略：lru = 最近最少使用；fifo = 先进先出（插入序）。 */
export type BoundedPolicy = 'lru' | 'fifo';
/** boundedMap 选项。 */
export interface BoundedMapOptions<K, V> {
    /** 上限（正整数，必填语义）：超过即淘汰最旧；默认 {@link DEFAULT_BOUND_MAP_SIZE}。 */
    maxSize?: number;
    /** 淘汰策略，默认 'lru'。 */
    policy?: BoundedPolicy;
    /** 初始条目（按最终上限裁剪）。 */
    entries?: Iterable<readonly [K, V]>;
    /** 淘汰回调（同步，携带被淘汰键值）。 */
    onEvict?: (key: K, value: V) => void;
}
/** boundedMap 统计快照。 */
export interface BoundedMapStats {
    size: number;
    maxSize: number;
    evicted: number;
}
/** 字典默认上限（兜底值；生产接入应显式声明语义上限）。 */
export declare const DEFAULT_BOUND_MAP_SIZE = 1000;
/** 列表默认上限（兜底值）。 */
export declare const DEFAULT_BOUND_LIST_SIZE = 1000;
/**
 * 有界 Map：超上限立刻淘汰最旧条目并计数。
 * - LRU（默认）：get / set 都算「使用」，刷新为最新；
 * - FIFO：只有 set 刷新顺序（淘汰最早插入）。
 * 覆盖已有 key 只更新值，不触发淘汰。
 */
export declare class BoundedMap<K, V> extends Map<K, V> {
    readonly maxSize: number;
    readonly policy: BoundedPolicy;
    private readonly evictCallback;
    private evictedCount;
    constructor(options?: BoundedMapOptions<K, V>);
    /** 累计淘汰条数（只增不减，clear 也不重置）。 */
    get evicted(): number;
    /** 统计快照（资源观测）。 */
    stats(): BoundedMapStats;
    /** 普通对象形态（JSON.stringify 兼容：磁盘格式与 Record 字段一致）。 */
    toJSON(): Record<string, V>;
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    /** 超上限则从最旧端淘汰（Map 迭代序 = 插入序，LRU 下由 get 维护）。 */
    private trim;
}
/** 创建有界 Map（见 {@link BoundedMap}）。 */
export declare function boundedMap<K, V>(options?: BoundedMapOptions<K, V>): BoundedMap<K, V>;
/** boundList 选项。 */
export interface BoundedListOptions<T> {
    /** 上限（正整数）：超过即淘汰最旧；默认 {@link DEFAULT_BOUND_LIST_SIZE}。 */
    maxSize?: number;
    /** 初始条目（超出上限时保留尾部，与 splice(-max) 语义一致）。 */
    items?: readonly T[];
    /** 淘汰回调（同步，携带本次淘汰条数）。 */
    onEvict?: (evicted: number) => void;
}
/** 有界列表句柄（FIFO）。 */
export interface BoundedList<T> {
    push: (item: T) => void;
    pushAll: (items: readonly T[]) => void;
    /** 内部数组引用（零拷贝；返回给外部读取时请自行复制）。 */
    items: () => T[];
    toJSON: () => T[];
    clear: () => void;
    readonly size: number;
    /** 累计淘汰条数（只增不减，clear 也不重置）。 */
    readonly evicted: number;
}
/**
 * 有界列表（FIFO）：push 超限立刻淘汰最旧并计数。
 * items() 返回内部数组引用——可直接被 JSON.stringify 序列化为普通数组，
 * 因此替换既有数组字段不改变持久化格式；需要独立副本时用 [...list.items()]。
 */
export declare function boundList<T>(options?: BoundedListOptions<T>): BoundedList<T>;
