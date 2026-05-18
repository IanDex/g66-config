"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
const LOGI = path.join(__dirname, "..", "..", "logi", "cli.py");
function pyJson(args) {
    const result = (0, child_process_1.spawnSync)("python", [LOGI, ...args], { encoding: "utf-8" });
    if (result.status !== 0)
        throw new Error(result.stderr || "Error en CLI logi");
    return JSON.parse(result.stdout.trim());
}
function runToken(args) {
    const cmd = `python "${LOGI}" token ${args.join(" ")}`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
}
function runFindUser(args) {
    const cmd = `python "${LOGI}" find-user ${args.join(" ")}`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
}
async function askEnv() {
    const { env } = await inquirer_1.default.prompt([
        { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
    ]);
    return env;
}
async function pickUser(env, companyId) {
    console.log(chalk_1.default.dim("  Cargando usuarios..."));
    const userList = pyJson([
        "users", "--env", env, "--company-id", String(companyId), "--json",
    ]);
    if (!userList.length) {
        console.log(chalk_1.default.yellow("Sin usuarios activos en esa compañía."));
        process.exit(0);
    }
    if (userList.length === 1) {
        console.log(chalk_1.default.dim(`  Usuario: ${userList[0].email}`));
        return userList[0].email;
    }
    const { email } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "email",
            message: "👤 Usuario:",
            choices: userList.map((u) => ({
                name: `${u.email}${u.is_legal_representative ? "  ★ rep legal" : ""}`,
                value: u.email,
            })),
        },
    ]);
    return email;
}
const KYC_STAGES = ["APPROVED", "UPLOADED_MANUAL", "UPLOADED_PARTNER", "REQUESTED_MANUAL", "REQUESTED_EMAIL", "REQUESTED_PARTNER"];
async function interactiveToken(extraFlags) {
    const env = await askEnv();
    const { kycStage } = await inquirer_1.default.prompt([
        { type: "list", name: "kycStage", message: "🔎 Estado KYC:", choices: KYC_STAGES, default: "APPROVED" },
    ]);
    console.log(chalk_1.default.dim("  Cargando países..."));
    const countries = pyJson(["countries", "--env", env, "--json"]);
    const { country } = await inquirer_1.default.prompt([
        { type: "list", name: "country", message: "🌎 País:", choices: ["(todos)", ...countries] },
    ]);
    const countryFilter = country === "(todos)" ? null : country;
    console.log(chalk_1.default.dim("  Cargando compañías..."));
    const companyArgs = ["companies", "--env", env, "--status", kycStage, "--json"];
    if (countryFilter)
        companyArgs.push("--country", countryFilter);
    const companyList = pyJson(companyArgs);
    if (!companyList.length) {
        console.log(chalk_1.default.yellow("Sin compañías para ese filtro."));
        process.exit(0);
    }
    const { companyId } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "companyId",
            message: "🏢 Compañía:",
            choices: companyList.map((c) => ({
                name: `${c.name}  [${c.country || "?"}]  id=${c.company_id}  ${c.compliance_status || ""}`,
                value: c.company_id,
            })),
            pageSize: 15,
        },
    ]);
    const email = await pickUser(env, companyId);
    runToken(["--env", env, "--email", email, "--status", kycStage, ...extraFlags]);
}
const token = new commander_1.Command("token")
    .description("🔑 Obtiene idToken B2B directo desde Cognito")
    .option("-e, --env <env>", "Entorno: dev | ci")
    .option("-c, --country <country>", "Filtro de país (ej: CO, CL, MX)")
    .option("--company-id <id>", "ID de compañía")
    .option("--email <email>", "Email directo")
    .option("-p, --password <password>", "Password (default: Global66)")
    .option("-s, --status <status>", "kyc_stage_1 filter (default: APPROVED)")
    .option("--find <email>", "Busca usuario por email y hace login")
    .option("--no-copy", "No copiar idToken al clipboard")
    .option("--decode", "Mostrar JWT claims decodificados")
    .action(async (opts) => {
    const extraFlags = [];
    if (opts.decode)
        extraFlags.push("--decode");
    // --find: busca por email y hace login
    if (opts.find) {
        const env = opts.env ?? (await askEnv());
        runFindUser(["--env", env, "--email", opts.find, "--login", ...extraFlags]);
        return;
    }
    // Solo company-id → preguntar env si falta, seleccionar usuario
    if (opts.companyId && !opts.country && !opts.email) {
        const env = opts.env ?? (await askEnv());
        const email = await pickUser(env, Number(opts.companyId));
        runToken(["--env", env, "--email", email, ...extraFlags]);
        return;
    }
    // Sin args → interactivo completo
    if (!opts.env && !opts.country && !opts.companyId && !opts.email && !opts.find) {
        await interactiveToken(extraFlags);
        return;
    }
    // Args explícitos → directo a Python
    const args = [];
    if (opts.env)
        args.push("--env", opts.env);
    if (opts.country)
        args.push("--country", opts.country);
    if (opts.companyId)
        args.push("--company-id", opts.companyId);
    if (opts.email)
        args.push("--email", opts.email);
    if (opts.password)
        args.push("--password", opts.password);
    if (opts.status)
        args.push("--status", opts.status);
    runToken([...args, ...extraFlags]);
});
exports.default = token;
