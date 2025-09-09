import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";
import { detectServiceInfo } from "../detect";

export async function revertConfig() {
  const cwd = process.cwd();
  const { env } = await detectServiceInfo(cwd);
  const fileToRevert = path.join(
    cwd,
    "src",
    "main",
    "resources",
    `application-${env}.yml`
  );

  try {
    execSync(`git checkout -- "${fileToRevert}"`, { stdio: "inherit" });
    console.log(chalk.green(`\n✅ Archivo restaurado: ${fileToRevert}`));
  } catch (error) {
    console.error(chalk.red("\n❌ Error al intentar revertir el archivo."));
    console.error(error);
  }
}
