// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Configuration Value
// ─────────────────────────────────────────────────────────────────────────────
export var ConfigurationValueType;
(function (ConfigurationValueType) {
    ConfigurationValueType["STANDARD"] = "STANDARD";
    ConfigurationValueType["SECRET"] = "SECRET";
    ConfigurationValueType["OPTIONAL"] = "OPTIONAL";
    ConfigurationValueType["OPTIONAL_SECRET"] = "OPTIONAL_SECRET";
})(ConfigurationValueType || (ConfigurationValueType = {}));
export function isSecret(cv) {
    return cv.type === ConfigurationValueType.SECRET || cv.type === ConfigurationValueType.OPTIONAL_SECRET;
}
export function resolveValue(cv) {
    if (cv.value != null)
        return isSecret(cv) ? '*********' : cv.value;
    return cv.default ?? null;
}
export function resolveUnmaskedValue(cv) {
    return cv.value ?? cv.default ?? null;
}
