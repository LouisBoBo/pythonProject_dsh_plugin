export function requireToolAgent(exec, family = 'knowledge tools') {
    if (exec.agent === undefined)
        throw new Error(`${family} require a calling DSH agent`);
    return exec.agent;
}
export function toolRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('tool arguments must be an object');
    return value;
}
export function requiredToolString(value, name, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error(`${name} must be a non-empty string`);
    const result = value.trim();
    if (result.length > maxLength)
        throw new Error(`${name} must contain at most ${maxLength} characters`);
    return result;
}
export function optionalToolInteger(value, name, min, max) {
    if (value === undefined)
        return undefined;
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return Number(value);
}
//# sourceMappingURL=tool-input.js.map