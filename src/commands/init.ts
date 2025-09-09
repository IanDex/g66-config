// src/commands/init.ts

import fs from "fs";
import path from "path";
import os from "os";
import inquirer from "inquirer";

const CONFIG_PATH = path.join(os.homedir(), ".g66config.json");

export async function runInit() {
  const questions = [
    {
      type: "input",
      name: "author",
      message: "👤 Nombre del desarrollador:",
      validate: (input: string) => input.trim() !== "" || "Este campo es obligatorio.",
    },
    {
      type: "input",
      name: "email",
      message: "✉️  Email del desarrollador (opcional):",
    },
    {
      type: "input",
      name: "defaultBranchPrefix",
      message: "🏷️  Prefijo default para ramas (ej. PAC-, ACME-):",
    },
    {
      type: "input",
      name: "jiraUrl",
      message: "🌐 URL base de Jira (opcional):",
      default: "https://global66.atlassian.net/browse/",
    },
    {
      type: "confirm",
      name: "autoPush",
      message: "🚀 ¿Deseas hacer `git push` automáticamente después del commit?",
      default: true,
    },
  ];

  const config = await inquirer.prompt(questions);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log("\n✅ Configuración guardada exitosamente en:");
  console.log(CONFIG_PATH);
}
