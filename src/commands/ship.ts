import { execSync } from "child_process";
import chalk from "chalk";
import inquirer from "inquirer";

export async function ship() {
  const { hu, desc } = await inquirer.prompt([
    {
      type: "input",
      name: "hu",
      message: chalk.blue("🔖 Ingresa el código de la HU (ej: ACME-123):"),
      validate: (input) => input.trim() !== "" || "El código de la HU no puede estar vacío",
    },
    {
      type: "input",
      name: "desc",
      message: chalk.blue("✏️  Ingresa una descripción corta del cambio:"),
      validate: (input) => input.trim() !== "" || "La descripción no puede estar vacía",
    },
  ]);

  try {
    console.log(chalk.yellow("\n🚀 Revirtiendo cambios en el archivo de configuración..."));
    execSync("g66 config revert", { stdio: "inherit" });

    console.log(chalk.yellow("\n🧹 Ejecutando spotless..."));
    execSync("mvn spotless:apply", { stdio: "inherit" });

    console.log(chalk.yellow("\n📦 Haciendo commit..."));
    execSync("git add .", { stdio: "inherit" });
    execSync(`git commit -m "[${hu}] ${desc}"`, { stdio: "inherit" });

    console.log(chalk.yellow("\n📤 Haciendo push..."));
    execSync("git push", { stdio: "inherit" });

    console.log(chalk.green("\n✅ ¡Código enviado correctamente!"));
  } catch (error) {
    console.error(chalk.red("\n❌ Error al ejecutar el proceso automático."));
  }
}
