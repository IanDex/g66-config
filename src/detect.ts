import simpleGit, { SimpleGit } from "simple-git";
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
  const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();

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
