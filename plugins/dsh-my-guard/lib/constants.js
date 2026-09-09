/** 告警存储上限（FIFO 淘汰）。 */
export const MAX_ALERTS = 500;
/** 护栏模式：observe=只读观察+告警（默认）；ask=触发审批确认；deny=直接拦截。 */
export const GUARD_MODES = ['observe', 'ask', 'deny'];
/** 告警严重级别（由低到高）。 */
export const SEVERITY_LEVELS = ['low', 'medium', 'high'];
/** 同类型告警通知冷却默认值（毫秒，issue #88 防刷屏）。 */
export const DEFAULT_NOTIFY_COOLDOWN_MS = 60000;
/**
 * 破坏性命令模式（对 bash 工具 command 参数匹配）。
 * 每个模式：id + 正则 + 消息模板（{cmd} 会被替换为截断的命令）。
 */
export const DESTRUCTIVE_PATTERNS = [
    {
        id: 'rm-root',
        // CodeQL js/redos 修复：原 `(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+` 中 `[a-zA-Z]` 与 `[rf]`
        // 字符集重叠（r/f ∈ a-zA-Z），`+` 内嵌 `*` 可致指数回溯。
        // 新写法把选项拆成「非 r/f 字母前缀 + 单个 [rf] + 任意字母后缀」，前缀字符类
        // `[a-eg-qs-zA-EG-QS-Z]`（a-z 排除 r/f、A-Z 排除 R/F）与 `[rf]` 不相交 →
        // 每个选项只有唯一拆分、整体线性匹配，语义不变（仍要求每个选项含小写 r/f）。
        re: /\brm\s+(?:-[a-eg-qs-zA-EG-QS-Z]*[rf][a-zA-Z]*\s+)+(?:\/|\/\*|~\/?|\$HOME)(?:\s|$)/,
        message: '删除根目录/家目录（rm -rf / 等）',
    },
    {
        id: 'mkfs',
        re: /\bmkfs(\.\w+)?\s+/,
        message: '格式化磁盘（mkfs）',
    },
    {
        id: 'dd-device',
        re: /\bdd\s+[^|]*if=\/dev\/(zero|urandom)[^|]*of=\/dev\//,
        message: '直接写块设备（dd 到 /dev/）',
    },
    {
        id: 'fork-bomb',
        re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
        message: 'fork 炸弹',
    },
    {
        id: 'chmod-root',
        re: /\bchmod\s+(-R\s+)?777\s+(\/|\/\*)(\s|$)/,
        message: '根目录全权限（chmod 777 /）',
    },
    {
        id: 'chown-recursive',
        re: /\bchown\s+-R\s+\w+(\s|$)/,
        message: '递归修改属主（chown -R）',
    },
    {
        id: 'shutdown',
        re: /\b(shutdown|reboot|halt|poweroff)\b/,
        message: '关机/重启',
    },
    {
        id: 'write-device',
        re: /[>»]\s*\/dev\/(sda|sdb|disk)/,
        message: '重定向写块设备',
    },
    {
        id: 'download-exec',
        re: /\b(curl|wget)\b[^|;]*\|\s*(ba)?sh\b/,
        message: '下载并执行脚本（curl|sh）',
    },
];
/**
 * 提示注入检测规则（对用户消息文本匹配）。
 * 规则 + 启发式：每条规则 = id + 正则 + 严重度 + 消息。
 *  - explain：规则一句话说明（面板展示，让用户理解为什么会告警）；
 *  - discussable：是否为"上下文敏感"规则（如"越狱"两字出现在普通提问/
 *    讨论里也会命中正则）。discussable = true 时，若整条消息是元讨论
 *    （讨论/询问护栏、告警、规则本身）且无强令词，则豁免（防误报）。
 */
export const INJECTION_RULES = [
    {
        id: 'ignore-previous',
        re: /忽略(之前|以上|前面).{0,20}(指令|内容|要求|规则)|ignore\s+(all\s+)?previous\s+(instructions|prompts|messages)|disregard\s+(all\s+)?previous/i,
        severity: 'high',
        message: '忽略先前指令',
        explain: '要求模型忽略此前的指令/系统提示，是典型的提示注入手法',
        discussable: false,
    },
    {
        id: 'system-override',
        re: /你是(系统|管理员|root)|override\s+(the\s+)?system\s+prompt|system\s+prompt\s+override|你现在是(系统|管理员)/i,
        severity: 'high',
        message: '系统提示词覆盖',
        explain: '声称自己是系统/管理员或要求覆盖系统提示词，试图改变模型的预设身份',
        discussable: false,
    },
    {
        id: 'jailbreak',
        re: /\b(DAN|jailbreak|do\s+anything\s+now)\b|越狱/i,
        severity: 'high',
        message: '越狱尝试',
        explain: '命中越狱关键词（DAN / jailbreak / 越狱）：要求模型突破内置约束',
        discussable: true,
    },
    {
        id: 'role-escalation',
        re: /(扮演|假装|pretend|act\s+as).{0,30}(root|管理员|admin|系统|无限制|unrestricted)/i,
        severity: 'medium',
        message: '角色越权',
        explain: '要求扮演高权限角色（root/管理员/无限制），脱离预设身份执行任务',
        discussable: true,
    },
    {
        id: 'secret-exfil',
        re: /(发送|上传|泄露|外传|curl|post|upload).{0,30}(密钥|密码|token|secret|文件内容|\/etc\/passwd)|(\/etc\/passwd|密钥|密码|token|secret|文件内容).{0,30}(发送|上传|泄露|外传)/i,
        severity: 'high',
        message: '敏感信息外传',
        explain: '指示模型发送/上传密钥、密码或敏感文件内容到外部',
        discussable: true,
    },
    {
        id: 'encoding-obfuscation',
        re: /\b(base64|rot13|hex)\b.{0,20}(解码|decode|编码|encode)/i,
        severity: 'medium',
        message: '编码混淆指令',
        explain: '要求对指令做 base64/hex 等编解码，常见于伪装注入载荷',
        discussable: true,
    },
    {
        id: 'disable-safety',
        re: /(关闭|禁用|绕过|disable|bypass|turn\s+off).{0,20}(安全|审查|限制|safety|guardrails|restrictions)/i,
        severity: 'high',
        message: '禁用安全机制',
        explain: '明确要求关闭/绕过安全审查或限制，属高危指令',
        discussable: true,
    },
];
/** package.json scripts（install/postinstall/preinstall 等）中的可疑命令模式。 */
export const SUSPICIOUS_SCRIPT_PATTERNS = [
    { id: 'download-exec', re: /\b(curl|wget)\b[^|;]*\|\s*(ba)?sh\b/, message: '下载并执行脚本' },
    { id: 'eval', re: /\beval\s*[("']/, message: 'eval 动态执行' },
    {
        id: 'base64-decode',
        re: /\bbase64\s+-d\b|\becho\s+[^|]*\|\s*base64\s+-d/,
        message: 'base64 解码执行',
    },
    { id: 'chmod-exec', re: /\bchmod\s+\+?x\b/, message: '赋予执行权限' },
    { id: 'curl-post', re: /\bcurl\b[^|;]*-X\s+POST\b/, message: 'curl POST 外传' },
    { id: 'node-eval', re: /\bnode\s+-e\b/, message: 'node -e 内联执行' },
    { id: 'python-c', re: /\bpython[23]?\s+-c\b/, message: 'python -c 内联执行' },
    { id: 'git-clone', re: /\bgit\s+clone\b/, message: '安装时克隆外部仓库' },
    { id: 'npm-install-extra', re: /\bnpm\s+(i|install)\b/, message: '安装时再装依赖' },
    { id: 'write-etc', re: /[>»]\s*\/etc\//, message: '写入 /etc' },
    { id: 'write-crontab', re: /\bcrontab\b/, message: '写 crontab' },
    { id: 'write-ssh', re: /[>»]\s*~?\/?\.ssh\//, message: '写 SSH 配置' },
];
/** 密钥/凭据模式（对包内文件内容匹配）。 */
export const SECRET_PATTERNS = [
    {
        id: 'private-key',
        re: /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+|DSA\s+|)PRIVATE\s+KEY-----/,
        message: '私钥',
    },
    { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/, message: 'AWS Access Key' },
    { id: 'github-pat', re: /\bghp_[A-Za-z0-9]{36}\b/, message: 'GitHub Personal Access Token' },
    { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/, message: 'OpenAI API Key' },
    { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, message: 'Slack Token' },
    { id: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}\b/, message: 'Google API Key' },
    {
        id: 'generic-token',
        re: /\b(token|api[_-]?key|secret|password)\s*[=:]\s*['"][A-Za-z0-9_\-.]{16,}['"]/i,
        message: '硬编码凭据',
    },
];
/** 可疑文件（按文件名匹配）。 */
export const SUSPICIOUS_FILES = [
    { id: 'binary', re: /\.(exe|dll|bin|so|dylib|jar)$/i, message: '二进制文件' },
    { id: 'shell-script', re: /\.(sh|bash)$/i, message: 'shell 脚本' },
    { id: 'windows-script', re: /\.(bat|cmd|ps1)$/i, message: 'Windows 脚本' },
];
/** 已知被投毒/恶意依赖名（npm 投毒历史事件）。 */
export const MALICIOUS_DEPENDENCIES = [
    'flatmap-stream',
    'event-stream',
    'eslint-scope',
    'ua-parser-js',
    'coa',
    'rc',
    'is-promise',
];
/** 扫描时跳过的目录/文件（node_modules、.git、测试夹具等）。 */
export const SCAN_IGNORE = new Set([
    'node_modules',
    '.git',
    '.DS_Store',
    'coverage',
    'reports',
    'assets',
    'test',
    'tests',
    'dist',
    'build',
]);
/** 扫描单文件内容上限（字节），超限截断（防超大文件拖慢扫描）。 */
export const MAX_SCAN_FILE_BYTES = 512 * 1024;
/** 扫描文件数上限，超限停止（防超大包拖慢扫描）。 */
export const MAX_SCAN_FILES = 2000;
