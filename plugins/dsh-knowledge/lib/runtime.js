import { randomUUID } from 'node:crypto';
export function messageText(message) {
    return message.content
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text ?? '')
        .join('\n')
        .trim();
}
export function createKnowledgeSurfaceMessage(text, form) {
    return {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin:dsh-knowledge', form },
    };
}
export function createRecallMessage(text) {
    return createKnowledgeSurfaceMessage(text, 'recall');
}
//# sourceMappingURL=runtime.js.map