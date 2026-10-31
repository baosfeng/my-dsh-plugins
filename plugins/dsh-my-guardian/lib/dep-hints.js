/**
 * dsh-my-guardian — 依赖预检的出口层：宿主命名空间判定（#407）、可执行安装建议（#410）
 * 与缺失 / 版本不满足文案（#503）。
 *
 * 为什么单独成文件：dep-precheck.ts 已贴着 400 行 TS 尺寸门禁，而这里全是纯函数
 * （包名归约 / 命名空间 / 建议 / 文案），与「怎么解析、怎么比版本」无关。分离之后
 * 出口文案只有一个落点，判定与文案不会再各写一套。
 *
 * #503 的教训：判据与文案必须同源。此前 missingSentence() 只看 `@deepseek-ai/` 前缀就
 * 断言「由宿主运行时供给，无需安装」，而判缺失用的是「磁盘三段根 + 宿主清单都没命中」
 * ——同一条 issue 因此出现「缺失徽标 + 无需安装正文 + 建议升级 DSH」三重矛盾。现在缺失
 * 项由 dep-precheck 显式标注它是不是「宿主命名空间却没有任何证据命中」
 * （missingHostNamespace），文案只据这一份标注成句。
 */
// Base package of a specifier: 'pkg' -> 'pkg', '@scope/pkg' -> '@scope/pkg',
// 'pkg/sub' -> 'pkg', '@scope/pkg/sub' -> '@scope/pkg'. Peer specs are package
// roots today, but resolving the base keeps the lookup correct for any spec.
export function basePackage(spec) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
/** 宿主（DSH 安装）自带的包：装进 profile 只会多出一份拷贝并可能遮蔽宿主版本（#407）。 */
const HOST_PACKAGE_NAMES = new Set(['react', 'react-dom']);
/**
 * 该依赖是否属宿主命名空间（宿主 runtime 供给的 @deepseek-ai/*、宿主前端注入的
 * react / react-dom），即「装进 profile 修不了、只会多一份拷贝并遮蔽宿主版本」（#407）。
 * 对这类包给出 `dsh plugin add …` 建议 = 把宿主自有包的另一份拷贝装进 profile（#407/#410）。
 *
 * ⚠️ 这里只回答「能不能靠装进 profile 修」，不回答「宿主有没有提供」——后者只有一个
 * 入口：host-inventory 的宿主清单 / 安装目录（#503）。
 */
export function isHostProvided(spec) {
    const base = basePackage(spec);
    return base.startsWith('@deepseek-ai/') || HOST_PACKAGE_NAMES.has(base);
}
/**
 * 声明范围能否直接拼进 `dsh plugin add <name>@<range>`：只接受单一 ^ / ~ / 精确
 * 版本。含空格、管道、比较符或空版本的范围（`^18.2.0 || ^19.3.0`）拼出来的命令
 * 在 shell 里无法执行（#410：畸形 installHint），一律不生成命令。
 */
const INSTALLABLE_RANGE = /^[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/;
function installableRange(range) {
    return typeof range === 'string' && INSTALLABLE_RANGE.test(range) ? range : null;
}
/**
 * 可执行的修复命令（#410）：宿主命名空间的包不给命令；版本不满足只在声明范围本身
 * 可安全拼进命令时给出钉住版本的命令，否则不给（宁缺勿畸形）。
 */
export function buildSuggestions(missing, mismatched) {
    const suggestions = [];
    for (const dep of missing) {
        if (isHostProvided(dep))
            continue;
        suggestions.push(`dsh plugin add ${dep}`);
    }
    for (const item of mismatched) {
        if (item.source === 'host')
            continue;
        const range = installableRange(item.expected);
        if (range !== null)
            suggestions.push(`dsh plugin add ${item.name}@${range}`);
    }
    return suggestions;
}
/**
 * 缺失一句（#503）：判缺失 === 磁盘三段根与宿主安装目录/清单都没命中。宿主命名空间的包
 * 因此只能陈述这一件事——既不能说「请先安装」（会诱导装出双实例），也不能说「由宿主供给、
 * 无需安装」（与缺失徽标矛盾），更不能把锅甩给「宿主版本过旧」（版本根本没参与判定）。
 */
function missingSentence(dep, hostNamespace) {
    if (!hostNamespace)
        return `缺少依赖 ${dep}（请先安装）`;
    return `缺少依赖 ${dep}（属 DSH 宿主包，但未在宿主安装目录 / 宿主清单中找到；请确认 DSH 安装完整，装进 profile 只会遮蔽宿主版本）`;
}
/** 版本不满足一句：单独成句，绝不复用「缺少依赖（请先安装）」文案（#410）。 */
function mismatchSentence(item) {
    const sentence = `依赖版本不满足 ${item.name}：声明 ${item.expected}，当前 ${item.found}`;
    if (item.source === 'host')
        return `${sentence}（由 DSH 宿主内置，请升级 DSH；装进 profile 只会遮蔽宿主版本）`;
    return sentence;
}
/**
 * Build the message recorded for a failed pre-check. 缺失与版本不满足是两种结论，
 * 各自成句（#410）：此前二者被合并渲染成「缺少依赖 X（请先安装）」，把「装着但
 * 版本不在声明范围」误诊成缺失，并诱导用户把宿主自有包装进 profile。
 */
export function buildDependencyMessage(result) {
    const missing = Array.isArray(result.missing) ? result.missing : [];
    const mismatched = Array.isArray(result.mismatched) ? result.mismatched : [];
    const hostNamespace = new Set(Array.isArray(result.missingHostNamespace) ? result.missingHostNamespace : []);
    const sentences = [
        ...missing.map((dep) => missingSentence(dep, hostNamespace.has(dep))),
        ...mismatched.map(mismatchSentence),
    ];
    if (sentences.length === 0)
        return '依赖预检失败';
    return sentences.join('；');
}
