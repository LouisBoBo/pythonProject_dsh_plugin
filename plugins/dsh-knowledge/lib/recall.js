import { formatAutomaticRecall, formatMountCatalog, resolveKnowledgeMounts, resolveRecallMounts, searchMountedKnowledge, selectAutomaticRecallHits, } from './retrieval.js';
import { createRecallMessage, messageText, } from './runtime.js';
import { fetchCompanySharedRecall, mergeLocalAndCompanyRecall, } from './company-shared-recall.js';
/**
 * Sanitize prior plugin surface messages, then perform bounded first-step
 * retrieval for the current direct user request. The injected recall snapshot
 * is discarded from later model steps and never becomes write-back evidence.
 *
 * WorkBuddy：本机挂载召回 + 公司共享库旁路自动合并（全员可读公司库时生效）。
 */
export function registerKnowledgeRecall(ctx, provider, config, codec) {
    return ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        const messages = decision.messages.filter(message => !isKnowledgeSurfaceMessage(message));
        const sanitized = messages.length === decision.messages.length
            ? decision
            : { kind: 'enter', messages };
        if (config.autoRecallLimit === 0)
            return sanitized;
        const query = automaticRecallQuery(payload, sanitized);
        if (!shouldRecall(query))
            return sanitized;
        try {
            let localText = '';
            const mounts = await resolveRecallMounts(provider, payload.agent, payload.signal);
            if (mounts.length > 0) {
                const searched = await searchMountedKnowledge(provider, payload.agent, mounts, query, Math.min(config.autoRecallLimit * 3, 20), codec, payload.signal);
                const hits = selectAutomaticRecallHits(searched, config.autoRecallLimit, config.autoRecallMinScore);
                localText = formatAutomaticRecall(hits, config.recallMaxChars);
            }
            const companyText = await fetchCompanySharedRecall(query, config, payload.signal);
            const text = mergeLocalAndCompanyRecall(localText, companyText, config.recallMaxChars);
            if (text.length === 0)
                return sanitized;
            return { kind: 'enter', messages: [...messages, createRecallMessage(text)] };
        }
        catch (error) {
            if (!payload.signal.aborted) {
                ctx.logger.warn(`dsh-knowledge: automatic recall failed open: ${error instanceof Error ? error.message : String(error)}`);
            }
            return sanitized;
        }
    });
}
/** Add a bounded, per-agent knowledge map through DSH's official prompt assembly waterfall. */
export function registerKnowledgeCatalog(ctx, provider, config) {
    return ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const transformed = await next();
        if (context.agent === undefined)
            return transformed;
        try {
            const [mounts, settings] = await Promise.all([
                resolveKnowledgeMounts(provider, context.agent, context.signal),
                provider.getSettings(context.signal),
            ]);
            let text = formatMountCatalog(mounts, Math.min(config.recallMaxChars, 6000), settings.writebackPolicy);
            if (config.workbuddyCompanyCite !== false) {
                const tip = 'WorkBuddy：公司共享库免挂载，任意会话/项目均可召回（管理员自动双源；成员用 mes_company_knowledge）。本机库仍按挂载。上传目标（本机/公司）仅管理员可选。';
                text = text.length === 0 ? tip : `${text}\n\n${tip}`;
            }
            if (text.length === 0)
                return transformed;
            return {
                ...transformed,
                contexts: [
                    ...transformed.contexts.filter(item => item.name !== 'dsh-knowledge:mounts'),
                    { name: 'dsh-knowledge:mounts', text },
                ],
            };
        }
        catch (error) {
            if (!context.signal?.aborted) {
                ctx.logger.warn(`dsh-knowledge: mounted-base catalog failed open: ${error instanceof Error ? error.message : String(error)}`);
            }
            return transformed;
        }
    });
}
function isKnowledgeSurfaceMessage(message) {
    return message.source.kind === 'plugin'
        && message.source.plugin === 'dsh-knowledge'
        && (message.source.form === 'notice' || message.source.form === 'recall');
}
function automaticRecallQuery(payload, decision) {
    if (payload.step !== 1)
        return '';
    return decision.messages
        .filter(message => message.source.kind === 'user')
        .map(messageText)
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000);
}
function shouldRecall(query) {
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    if (normalized.length < 2)
        return false;
    return !/^(?:你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|ok|okay|好的|在吗)[!！,.，。?？\s]*$/iu.test(normalized);
}
//# sourceMappingURL=recall.js.map
