import simpleGit from "simple-git";
import path from "path";

type Env = "dev" | "ci";

interface ServiceInfo {
  serviceName: string;
  branch: string;
  baseBranch: string;
  env: Env;
}

export async function detectServiceInfo(cwd: string): Promise<ServiceInfo> {
  const serviceDirName = path.basename(cwd); // ej: ms-company
  const serviceName = serviceDirName.replace(/^ms-/, ""); // ej: company

  const git = simpleGit({ baseDir: cwd });

  let branch: string;

  try {
    branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  } catch (error: any) {
    if (error.message.includes("not a git repository")) {
      console.error("\n🚫 Este directorio no es un repositorio Git válido.");
      console.error("🔁 Por favor, ejecuta este comando dentro de un microservicio con control de versiones (Git).\n");
      process.exit(1);
    } else {
      console.error("\n❌ Error inesperado al detectar la rama de Git:", error.message);
      process.exit(1);
    }
  }

  // 💡 Determinar entorno basado en el nombre de la rama
  let env: Env = "ci";
  let baseBranch = "master";

  if (branch === "development") {
    env = "dev";
    baseBranch = "development";
  } else if (branch === "master") {
    env = "ci";
    baseBranch = "master";
  } else if (branch.includes("/dev/")) {
    env = "dev";
    baseBranch = "development";
  } else if (branch.includes("/ci/")) {
    env = "ci";
    baseBranch = "master";
  }

  return {
    serviceName,
    branch,
    baseBranch,
    env,
  };
}
