const FIELD_CAP_BYTES = 2 * 1024 * 1024;
export function isPositiveIntegerTurn(turn) {
    return typeof turn === 'number' && Number.isInteger(turn) && turn > 0 && turn <= 999_999;
}
export function safeSessionId(id) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))
        return undefined;
    if (id.includes('..'))
        return undefined;
    return id;
}
/** 从最近一条同号 turn/start 切到下一条 turn/start 之前。找不到则返回 undefined。 */
export function sliceTurn(events, turn) {
    let start = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'turn/start' && sameTurn(event.data?.turn, turn)) {
            start = index;
            break;
        }
    }
    if (start < 0)
        return undefined;
    let end = events.length;
    for (let index = start + 1; index < events.length; index += 1) {
        if (events[index]?.type === 'turn/start') {
            end = index;
            break;
        }
    }
    return events.slice(start, end);
}
export function sessionTitleFromEvents(events) {
    let title = '';
    for (const event of events) {
        if (event?.type !== 'session/title')
            continue;
        const raw = event.data?.title;
        if (typeof raw !== 'string')
            continue;
        const collapsed = collapseLine(raw);
        if (collapsed)
            title = collapsed;
    }
    return title || '未命名会话';
}
export function projectTurn(events, turn) {
    const slice = sliceTurn(events, turn);
    if (!slice)
        return undefined;
    const users = [];
    const assistants = [];
    const calls = [];
    const results = [];
    for (const event of slice) {
        if (event?.type === 'user/message') {
            const message = userRecord(event.data);
            if (!message)
                continue;
            const source = record(message.source);
            if (source?.kind !== 'user')
                continue;
            const body = renderContent(message.content);
            if (!body)
                continue;
            users.push({ body });
            continue;
        }
        if (event?.type === 'assistant/message') {
            const data = record(event.data);
            if (!data || !sameTurn(data.turn, turn))
                continue;
            const message = record(data.message);
            if (!message)
                continue;
            const body = renderContent(message.content);
            if (!body)
                continue;
            const step = integerStep(data.step);
            assistants.push(step === undefined ? { body } : { body, step });
            continue;
        }
        if (event?.type === 'tool/call') {
            const data = record(event.data);
            if (!data || !turnMatchesWhenPresent(data.turn, turn))
                continue;
            const callId = textField(data.callId);
            calls.push({
                callId,
                name: collapseLine(textField(data.name)) || '未命名工具',
                arguments: capField(argumentText(data.arguments)),
            });
            continue;
        }
        if (event?.type === 'tool/result') {
            const data = record(event.data);
            if (!data || !turnMatchesWhenPresent(data.turn, turn))
                continue;
            results.push({
                callId: resultCallId(data),
                body: capField(renderToolResult(data)),
            });
        }
    }
    const used = new Set();
    const tools = calls.map((call) => {
        const match = results.findIndex((result, index) => !used.has(index) && result.callId !== '' && result.callId === call.callId);
        if (match < 0)
            return { name: call.name, callId: call.callId, arguments: call.arguments };
        used.add(match);
        return { name: call.name, callId: call.callId, arguments: call.arguments, result: results[match]?.body ?? '' };
    });
    const unpaired = results.filter((_, index) => !used.has(index));
    return { users, assistants, tools, unpaired };
}
export function turnHasContent(turn) {
    return turn.users.length > 0 || turn.assistants.length > 0 || turn.tools.length > 0 || turn.unpaired.length > 0;
}
function sameTurn(value, turn) {
    return value === turn;
}
function turnMatchesWhenPresent(value, turn) {
    if (value === undefined)
        return true;
    return value === turn;
}
function integerStep(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
        return undefined;
    return value;
}
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    return value;
}
function userRecord(data) {
    const direct = record(data);
    if (!direct)
        return undefined;
    if (record(direct.source) || Array.isArray(direct.content))
        return direct;
    return record(direct.message);
}
function textField(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function argumentText(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined || value === null)
        return '';
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return '';
    }
}
function resultCallId(data) {
    const message = record(data.message);
    const source = record(message?.source);
    return textField(source?.callId) || textField(data.callId);
}
function renderToolResult(data) {
    const message = record(data.message);
    const content = message?.content ?? data.content;
    return renderContent(content);
}
function renderContent(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const lines = [];
    for (const block of content) {
        const row = record(block);
        if (!row)
            continue;
        const type = typeof row.type === 'string' ? row.type : '';
        if (type === 'text' && typeof row.text === 'string') {
            if (row.text.length > 0)
                lines.push(row.text);
            continue;
        }
        if (type === 'tool-result') {
            const inner = renderContent(row.content);
            if (inner)
                lines.push(inner);
            else if (typeof row.content === 'string' && row.content.length > 0)
                lines.push(row.content);
            continue;
        }
        if (type)
            lines.push(`非文本：${type}`);
    }
    return lines.join('\n');
}
function collapseLine(value) {
    return value.replace(/[\u0000-\u001f`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
function capField(text) {
    const clipped = clampUtf8(text, FIELD_CAP_BYTES);
    if (!clipped.truncated)
        return clipped.text;
    const note = '\n\n已截断\n';
    const room = FIELD_CAP_BYTES - Buffer.byteLength(note);
    return clampUtf8(clipped.text, Math.max(0, room)).text + note;
}
export function clampUtf8(text, maxBytes) {
    if (maxBytes <= 0)
        return { text: '', truncated: text.length > 0 };
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.length <= maxBytes)
        return { text, truncated: false };
    let end = maxBytes;
    while (end > 0 && (buffer[end] & 0xc0) === 0x80)
        end -= 1;
    return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}
