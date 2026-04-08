"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCommitHashesInput = parseCommitHashesInput;
exports.promptPromote = promptPromote;
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const promote_constants_1 = require("../utils/promote-constants");
const BRANCH_NAME_RE = /^[a-zA-Z0-9/_.-]+$/;
/** Separa por espacios, comas o punto y coma; sin duplicados, conserva orden. */
function parseCommitHashesInput(raw) {
    const seen = new Set();
    const out = [];
    const tokens = raw
        .split(/[\s,;]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    for (const t of tokens) {
        if (seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}
function validateBranchName(name) {
    const t = name.trim();
    if (t.length === 0)
        return "El nombre de la rama no puede estar vacío.";
    if (!BRANCH_NAME_RE.test(t)) {
        return "Usa solo letras, números, /, _, . y -.";
    }
    return true;
}
async function promptPromote(branches) {
    if (branches.length < 2) {
        throw new Error("Se requieren al menos dos ramas locales para promover un commit.");
    }
    const { sourceBranch } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "sourceBranch",
            message: chalk_1.default.blue("Rama origen (contexto del commit):"),
            choices: branches,
            pageSize: 15,
        },
    ]);
    const targetChoices = branches.filter((b) => b !== sourceBranch);
    if (targetChoices.length === 0) {
        throw new Error("No hay otra rama local distinta del origen.");
    }
    const { targetBranch } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "targetBranch",
            message: chalk_1.default.blue("Rama destino:"),
            choices: targetChoices,
            pageSize: 15,
        },
    ]);
    const { commitHashesRaw } = await inquirer_1.default.prompt([
        {
            type: "input",
            name: "commitHashesRaw",
            message: chalk_1.default.blue("Hash(es) de commit (uno o varios, separados por espacio o coma):"),
            validate: (input) => {
                const list = parseCommitHashesInput(input);
                if (list.length === 0)
                    return "Indica al menos un hash de commit.";
                return true;
            },
        },
    ]);
    const commitHashes = parseCommitHashesInput(commitHashesRaw);
    const targetIsProtected = (0, promote_constants_1.isDirectPushForbiddenBranch)(targetBranch);
    if (targetIsProtected) {
        console.log(chalk_1.default.yellow("\nLa rama destino es de integración (release / development / master / main): no se permite push directo; hace falta una rama de trabajo y un PR.\n"));
        const { newBranchName } = await inquirer_1.default.prompt([
            {
                type: "input",
                name: "newBranchName",
                message: chalk_1.default.blue("Nombre de la rama de trabajo (desde el destino):"),
                validate: validateBranchName,
            },
        ]);
        return {
            sourceBranch,
            targetBranch,
            commitHashes,
            createNewBranch: true,
            newBranchName: newBranchName.trim(),
        };
    }
    const { createNewBranch } = await inquirer_1.default.prompt([
        {
            type: "confirm",
            name: "createNewBranch",
            message: chalk_1.default.blue("Do you want to create a new branch from target?"),
            default: false,
        },
    ]);
    let newBranchName;
    if (createNewBranch) {
        const ans = await inquirer_1.default.prompt([
            {
                type: "input",
                name: "newBranchName",
                message: chalk_1.default.blue("Nombre de la nueva rama:"),
                validate: validateBranchName,
            },
        ]);
        newBranchName = ans.newBranchName.trim();
    }
    return {
        sourceBranch,
        targetBranch,
        commitHashes,
        createNewBranch,
        newBranchName,
    };
}
