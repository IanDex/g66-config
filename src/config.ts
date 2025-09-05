import path from "path";
import fs from "fs";
import inquirer from "inquirer";
import os from "os";

const CONFIG_FILE_PATH = path.join(os.homedir(), ".g66-config.json");

interface Config {
  configRepoPath: string;
}

export async function resolveConfigRepoPath(): Promise<string> {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    const content = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
    const config: Config = JSON.parse(content);
    if (config.configRepoPath && fs.existsSync(config.configRepoPath)) {
      return config.configRepoPath;
    }
  }

  console.log("❓ No se encontró la ruta al repositorio ms-config-properties.");
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "configRepoPath",
      message: "🛠  Ingresa la ruta absoluta local del repositorio ms-config-properties:",
      validate: (input: string) => fs.existsSync(input) || "❌ Ruta no válida",

    },
  ]);

  const config: Config = { configRepoPath: answers.configRepoPath };
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf-8");
  console.log("✅ Ruta guardada correctamente.\n");

  return config.configRepoPath;
}
