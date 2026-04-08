"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECT_PUSH_FORBIDDEN_BRANCHES = void 0;
exports.isDirectPushForbiddenBranch = isDirectPushForbiddenBranch;
/**
 * Ramas donde no se permite push directo; el flujo debe ser rama de trabajo + PR.
 */
exports.DIRECT_PUSH_FORBIDDEN_BRANCHES = [
    "development",
    "master",
    "release",
    "main",
];
function isDirectPushForbiddenBranch(branchName) {
    const t = branchName.trim();
    return exports.DIRECT_PUSH_FORBIDDEN_BRANCHES.some((b) => b === t);
}
