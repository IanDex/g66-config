"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const yaml_1 = __importDefault(require("yaml"));
const promise_1 = __importDefault(require("mysql2/promise"));
const child_process_1 = require("child_process");
const codecommit_service_1 = require("../services/codecommit-service");
const chalk_1 = __importDefault(require("chalk"));
const readline_1 = __importDefault(require("readline"));
const CONFIG_FILE_PATH = path_1.default.join(os_1.default.homedir(), ".g66-config.json");
function mapEnvToBranch(env) {
    if (env === "dev")
        return "development";
    if (env === "ci")
        return "master";
    if (env === "prod")
        return "release";
    throw new Error(`❌ Entorno no soportado: ${env}`);
}
async function getCompanyIdByEmail(email, dbConfig) {
    const connection = await promise_1.default.createConnection(dbConfig);
    const [rows] = await connection.execute("SELECT company_id FROM company.user WHERE email = ? LIMIT 1", [email]);
    await connection.end();
    if (!rows.length) {
        throw new Error(`❌ No se encontró companyId para el email: ${email}`);
    }
    return rows[0].company_id;
}
async function updateAuthServerYaml(configRepoPath, companyId) {
    const filePath = path_1.default.join(configRepoPath, "auth-server.yml");
    const raw = fs_1.default.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    // Buscar el índice de la línea que contiene 'exclude:'
    const excludeIndex = lines.findIndex(line => line.trim().startsWith("exclude:"));
    if (excludeIndex === -1) {
        throw new Error("❌ No se encontró el bloque 'exclude:' en auth-server.yml");
    }
    // Buscar línea 'user-ids:' después de 'exclude:' y con más indentación
    let userIdsIndex = -1;
    const excludeIndent = lines[excludeIndex].match(/^(\s*)/)?.[1]?.length ?? 0;
    for (let i = excludeIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
        // Si ya se salió del bloque exclude (menos indent), salimos del bucle
        if (indent <= excludeIndent)
            break;
        if (line.trim().startsWith("user-ids:")) {
            userIdsIndex = i;
            break;
        }
    }
    if (userIdsIndex === -1) {
        throw new Error("❌ No se encontró el campo 'user-ids:' dentro de 'white-list.exclude'");
    }
    const userIdsLine = lines[userIdsIndex];
    const [key, value] = userIdsLine.split(":");
    const userIds = value.split(",").map(s => s.trim()).filter(Boolean);
    if (userIds.includes(String(companyId))) {
        console.log(chalk_1.default.yellow("⚠️ El companyId ya existe en white-list.exclude.user-ids. No se realizaron cambios."));
        return;
    }
    userIds.push(String(companyId));
    lines[userIdsIndex] = `${key}: ${userIds.join(",")}`;
    fs_1.default.writeFileSync(filePath, lines.join("\n"));
    console.log(chalk_1.default.green("✅ Se agregó el companyId a white-list.exclude.user-ids sin alterar el formato YAML."));
}
const wl = new commander_1.Command("wl")
    .description("🔐 Agrega un companyId al campo user-ids del archivo auth-server.yml")
    .requiredOption("-e, --email <email>", "Email del usuario para buscar companyId")
    .requiredOption("--env <env>", "Entorno: dev | ci | prod")
    .action(async (options) => {
    const { email, env } = options;
    const cwd = process.cwd();
    const configContent = fs_1.default.readFileSync(CONFIG_FILE_PATH, "utf-8");
    const config = JSON.parse(configContent);
    if (!config.configRepoPath) {
        throw new Error("❌ No se encontró configRepoPath en .g66-config.json");
    }
    const configRepoPath = config.configRepoPath;
    const branch = mapEnvToBranch(env);
    const dbConfig = config.db?.[env];
    if (!dbConfig) {
        throw new Error(`❌ No hay configuración de base de datos para el entorno: ${env}`);
    }
    const companyId = await getCompanyIdByEmail(email, dbConfig);
    const newBranch = `cv/${env}/${companyId}`;
    (0, child_process_1.execSync)(`git checkout ${branch}`, { cwd: configRepoPath, stdio: "inherit" });
    (0, child_process_1.execSync)(`git pull`, { cwd: configRepoPath, stdio: "inherit" });
    (0, child_process_1.execSync)(`git checkout -b ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });
    await updateAuthServerYaml(configRepoPath, companyId);
    (0, child_process_1.execSync)(`git add auth-server.yml`, { cwd: configRepoPath });
    (0, child_process_1.execSync)(`git commit -m "[wl] ${companyId}"`, { cwd: configRepoPath });
    (0, child_process_1.execSync)(`git push -u origin ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });
    await (0, codecommit_service_1.createSimplePullRequest)("ms-config-properties", newBranch, branch, `[wl] ${companyId}`);
    //🧹 Eliminar rama local y volver a la original
    try {
        console.log(chalk_1.default.gray(`🔄 Volviendo a la rama original '${branch}'...`));
        (0, child_process_1.execSync)(`git checkout ${branch}`, { cwd: configRepoPath, stdio: "inherit" });
        (0, child_process_1.execSync)(`git branch -D ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });
        console.log(chalk_1.default.green(`🧹 Rama '${newBranch}' eliminada localmente.`));
    }
    catch (err) {
        console.error(chalk_1.default.red("❌ Error al eliminar la rama local o volver a la original:"), err);
    }
    console.log(chalk_1.default.green("🎉 PR creado correctamente en AWS CodeCommit."));
    // 🔁 Reinicio de pipeline en ms-auth-server
    if (!config.authServerRepoPath) {
        const rl = readline_1.default.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        config.authServerRepoPath = await new Promise((resolve) => rl.question("📁 Ingresa el path local del repo ms-auth-server: ", (answer) => {
            rl.close();
            resolve(answer.trim());
        }));
        fs_1.default.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
    }
    const authRepoPath = config.authServerRepoPath;
    const authBranch = mapEnvToBranch(env);
    const restartBranch = newBranch;
    const authFilePath = path_1.default.join(authRepoPath, "src", "test", "resources", "application.yml");
    (0, child_process_1.execSync)(`git checkout ${authBranch}`, { cwd: authRepoPath, stdio: "inherit" });
    (0, child_process_1.execSync)(`git pull`, { cwd: authRepoPath, stdio: "inherit" });
    (0, child_process_1.execSync)(`git checkout -b ${restartBranch}`, { cwd: authRepoPath, stdio: "inherit" });
    const authYamlRaw = fs_1.default.readFileSync(authFilePath, "utf-8");
    const authYamlDoc = yaml_1.default.parseDocument(authYamlRaw);
    const dummyReloadPath = ["http-client", "dummy-reload"];
    const currentDummyReload = authYamlDoc.getIn(dummyReloadPath);
    if (typeof currentDummyReload === "number") {
        const newValue = currentDummyReload === 30 ? 31 : 30;
        authYamlDoc.setIn(dummyReloadPath, newValue);
        fs_1.default.writeFileSync(authFilePath, authYamlDoc.toString());
        console.log(chalk_1.default.green(`🔁 dummy-reload cambiado de ${currentDummyReload} a ${newValue}`));
    }
    else {
        authYamlDoc.setIn(dummyReloadPath, 30);
        fs_1.default.writeFileSync(authFilePath, authYamlDoc.toString());
        console.log(chalk_1.default.green(`✅ dummy-reload creado con valor 30`));
        (0, child_process_1.execSync)(`git add ${path_1.default.relative(authRepoPath, authFilePath)}`, { cwd: authRepoPath });
        (0, child_process_1.execSync)(`git commit -m "[wl] restart pipeline ${companyId}"`, { cwd: authRepoPath });
        (0, child_process_1.execSync)(`git push -u origin ${restartBranch}`, { cwd: authRepoPath, stdio: "inherit" });
        await (0, codecommit_service_1.createSimplePullRequest)("ms-auth-server", restartBranch, authBranch, `[wl] restart pipeline ${companyId}`);
        console.log(chalk_1.default.green("🚀 PR para reiniciar pipeline creado en ms-auth-server."));
    }
    try {
        console.log(chalk_1.default.gray(`🔄 Volviendo a la rama original '${branch}'...`));
        (0, child_process_1.execSync)(`git checkout ${branch}`, { cwd: authRepoPath, stdio: "inherit" });
        (0, child_process_1.execSync)(`git branch -D ${newBranch}`, { cwd: authRepoPath, stdio: "inherit" });
        console.log(chalk_1.default.green(`🧹 Rama '${newBranch}' eliminada localmente.`));
    }
    catch (err) {
        console.error(chalk_1.default.red("❌ Error al eliminar la rama local o volver a la original:"), err);
    }
});
exports.default = wl;
