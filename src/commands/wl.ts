import { Command } from "commander";
import fs from "fs";
import path from "path";
import os from "os";
import yaml from "yaml";
import mysql from "mysql2/promise";
import { execSync } from "child_process";
import { createSimplePullRequest } from "../services/codecommit-service";
import chalk from "chalk";
import readline from "readline";

const CONFIG_FILE_PATH = path.join(os.homedir(), ".g66-config.json");

interface DbConfig {
    host: string;
    user: string;
    password: string;
    database: string;
}

function mapEnvToBranch(env: string): string {
    if (env === "dev") return "development";
    if (env === "ci") return "master";
    if (env === "prod") return "release";
    throw new Error(`❌ Entorno no soportado: ${env}`);
}

async function getCompanyIdByEmail(email: string, dbConfig: DbConfig): Promise<number> {
    const connection = await mysql.createConnection(dbConfig);
    const [rows]: any = await connection.execute(
        "SELECT company_id FROM company.user WHERE email = ? LIMIT 1",
        [email]
    );
    await connection.end();

    if (!rows.length) {
        throw new Error(`❌ No se encontró companyId para el email: ${email}`);
    }

    return rows[0].company_id;
}

async function updateAuthServerYaml(configRepoPath: string, companyId: number): Promise<void> {
    const filePath = path.join(configRepoPath, "auth-server.yml");
    const raw = fs.readFileSync(filePath, "utf-8");
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
        if (indent <= excludeIndent) break;

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
        console.log(chalk.yellow("⚠️ El companyId ya existe en white-list.exclude.user-ids. No se realizaron cambios."));
        return;
    }

    userIds.push(String(companyId));
    lines[userIdsIndex] = `${key}: ${userIds.join(",")}`;

    fs.writeFileSync(filePath, lines.join("\n"));
    console.log(chalk.green("✅ Se agregó el companyId a white-list.exclude.user-ids sin alterar el formato YAML."));
}




const wl = new Command("wl")
    .description("🔐 Agrega un companyId al campo user-ids del archivo auth-server.yml")
    .requiredOption("-e, --email <email>", "Email del usuario para buscar companyId")
    .requiredOption("--env <env>", "Entorno: dev | ci | prod")
    .action(async (options) => {
        const { email, env } = options;
        const cwd = process.cwd();

        const configContent = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
        const config = JSON.parse(configContent);

        if (!config.configRepoPath) {
            throw new Error("❌ No se encontró configRepoPath en .g66-config.json");
        }

        const configRepoPath = config.configRepoPath;
        const branch = mapEnvToBranch(env);

        const dbConfig: DbConfig = config.db?.[env];
        if (!dbConfig) {
            throw new Error(`❌ No hay configuración de base de datos para el entorno: ${env}`);
        }

        const companyId = await getCompanyIdByEmail(email, dbConfig);
        const newBranch = `cv/${env}/${companyId}`;

        execSync(`git checkout ${branch}`, { cwd: configRepoPath, stdio: "inherit" });
        execSync(`git pull`, { cwd: configRepoPath, stdio: "inherit" });
        execSync(`git checkout -b ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });

        await updateAuthServerYaml(configRepoPath, companyId);

        execSync(`git add auth-server.yml`, { cwd: configRepoPath });
        execSync(`git commit -m "[wl] ${companyId}"`, { cwd: configRepoPath });
        execSync(`git push -u origin ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });

        await createSimplePullRequest(
            "ms-config-properties",
            newBranch,
            branch,
            `[wl] ${companyId}`
        );

        //🧹 Eliminar rama local y volver a la original
        try {
            console.log(chalk.gray(`🔄 Volviendo a la rama original '${branch}'...`));
            execSync(`git checkout ${branch}`, { cwd: configRepoPath, stdio: "inherit" });
            execSync(`git branch -D ${newBranch}`, { cwd: configRepoPath, stdio: "inherit" });
            console.log(chalk.green(`🧹 Rama '${newBranch}' eliminada localmente.`));
        } catch (err) {
            console.error(chalk.red("❌ Error al eliminar la rama local o volver a la original:"), err);
        }


        console.log(chalk.green("🎉 PR creado correctamente en AWS CodeCommit."));

        // 🔁 Reinicio de pipeline en ms-auth-server
        if (!config.authServerRepoPath) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            config.authServerRepoPath = await new Promise<string>((resolve) =>
                rl.question("📁 Ingresa el path local del repo ms-auth-server: ", (answer) => {
                    rl.close();
                    resolve(answer.trim());
                })
            );

            fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
        }

        const authRepoPath = config.authServerRepoPath;
        const authBranch = mapEnvToBranch(env);
        const restartBranch = newBranch;
        const authFilePath = path.join(authRepoPath, "src", "test", "resources", "application.yml");

        execSync(`git checkout ${authBranch}`, { cwd: authRepoPath, stdio: "inherit" });
        execSync(`git pull`, { cwd: authRepoPath, stdio: "inherit" });
        execSync(`git checkout -b ${restartBranch}`, { cwd: authRepoPath, stdio: "inherit" });

        const authYamlRaw = fs.readFileSync(authFilePath, "utf-8");
        const authYamlDoc = yaml.parseDocument(authYamlRaw);

        const dummyReloadPath = ["http-client", "dummy-reload"];
        const currentDummyReload = authYamlDoc.getIn(dummyReloadPath);

        if (typeof currentDummyReload === "number") {
            const newValue = currentDummyReload === 30 ? 31 : 30;
            authYamlDoc.setIn(dummyReloadPath, newValue);
            fs.writeFileSync(authFilePath, authYamlDoc.toString());
            console.log(chalk.green(`🔁 dummy-reload cambiado de ${currentDummyReload} a ${newValue}`));
        } else {
            authYamlDoc.setIn(dummyReloadPath, 30);
            fs.writeFileSync(authFilePath, authYamlDoc.toString());
            console.log(chalk.green(`✅ dummy-reload creado con valor 30`));



            execSync(`git add ${path.relative(authRepoPath, authFilePath)}`, { cwd: authRepoPath });
            execSync(`git commit -m "[wl] restart pipeline ${companyId}"`, { cwd: authRepoPath });
            execSync(`git push -u origin ${restartBranch}`, { cwd: authRepoPath, stdio: "inherit" });

            await createSimplePullRequest(
                "ms-auth-server",
                restartBranch,
                authBranch,
                `[wl] restart pipeline ${companyId}`
            );

            console.log(chalk.green("🚀 PR para reiniciar pipeline creado en ms-auth-server."));
        }

        try {
            console.log(chalk.gray(`🔄 Volviendo a la rama original '${branch}'...`));
            execSync(`git checkout ${branch}`, { cwd: authRepoPath, stdio: "inherit" });
            execSync(`git branch -D ${newBranch}`, { cwd: authRepoPath, stdio: "inherit" });
            console.log(chalk.green(`🧹 Rama '${newBranch}' eliminada localmente.`));
        } catch (err) {
            console.error(chalk.red("❌ Error al eliminar la rama local o volver a la original:"), err);
        }


    });

export default wl;