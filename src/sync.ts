import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { log } from "console";

interface SyncParams {
  configRepoPath: string;
  serviceName: string;
  env: "dev" | "ci";
  cwd: string;
  serverPort?: number;
}

function transformYamlContent(content: string, opts?: { serverPort?: number }): string {
  // Reemplazo de lb-<env>-private → lb-<env>
  content = content.replace(/https:\/\/lb-ci-private\.global66\.com/g, "https://lb-ci.global66.com");
  content = content.replace(/https:\/\/lb-dev-private\.global66\.com/g, "https://lb-dev.global66.com");

  // Eliminar cualquier valor cifrado que contenga {cipher}
  content = content.replace(/(\s+token:\s+)"\{cipher\}[^"]*"/g, `$1""`);

  // Preparar bloque de config
  const springConfigBlock = "spring:\n  cloud:\n    config:\n      enabled: false\n\n";

  // Si ya existe 'spring:', insertamos solo el bloque cloud.config.enabled
  if (content.includes("spring:")) {
    content = content.replace(
      /spring:\s*/g,
      `spring:\n  cloud:\n    config:\n      enabled: false\n  `
    );
    // Si ya existe toda la estructura, no hacemos nada
  } else {
    // Insertar todo el bloque spring al inicio
    content = springConfigBlock + content;
  }

  // ✅ Reemplazo condicional de `port: 8080`
  if (opts?.serverPort) {
    const before = content;
    content = content.replace(/^(\s*)port:\s*8080\s*$/m, `$1port: ${opts.serverPort}`);
    if (before === content) {
      console.warn(`⚠️  No se encontró 'port: 8080'. No se aplicó ningún cambio de puerto.`);
    }
  }

  return content;
}



export async function syncConfigFile({ configRepoPath, serviceName, env, cwd, serverPort }: SyncParams): Promise<void> {
  const branch = env === "dev" ? "development" : "master";
  const fileName = `${serviceName}.yml`;
  const sourceFile = path.join(configRepoPath, fileName);
  const targetFile = path.join(cwd, "src", "main", "resources", `application-${env}.yml`);

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`❌ No se encontró el archivo: ${sourceFile}`);
  }

  // Cambiar de rama en el repositorio ms-config-properties
  execSync(`git checkout ${branch}`, { cwd: configRepoPath, stdio: "inherit" });
  execSync(`git pull`, { cwd: configRepoPath, stdio: "inherit" });


  // Leer contenido y transformar
  const rawContent = fs.readFileSync(sourceFile, "utf-8");
  const transformed = transformYamlContent(rawContent, { serverPort });


  // Guardar archivo final
  fs.writeFileSync(targetFile, transformed, "utf-8");
}
