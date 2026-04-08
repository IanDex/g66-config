import inquirer from "inquirer";
import chalk from "chalk";
import { isDirectPushForbiddenBranch } from "../utils/promote-constants";

export interface PromotePromptAnswers {
  sourceBranch: string;
  targetBranch: string;
  /** Hashes en el orden indicado por el usuario (uno o varios). */
  commitHashes: string[];
  createNewBranch: boolean;
  newBranchName?: string;
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9/_.-]+$/;

/** Separa por espacios, comas o punto y coma; sin duplicados, conserva orden. */
export function parseCommitHashesInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function validateBranchName(name: string): boolean | string {
  const t = name.trim();
  if (t.length === 0) return "El nombre de la rama no puede estar vacío.";
  if (!BRANCH_NAME_RE.test(t)) {
    return "Usa solo letras, números, /, _, . y -.";
  }
  return true;
}

export async function promptPromote(
  branches: string[],
): Promise<PromotePromptAnswers> {
  if (branches.length < 2) {
    throw new Error(
      "Se requieren al menos dos ramas locales para promover un commit.",
    );
  }

  const { sourceBranch } = await inquirer.prompt<{ sourceBranch: string }>([
    {
      type: "list",
      name: "sourceBranch",
      message: chalk.blue("Rama origen (contexto del commit):"),
      choices: branches,
      pageSize: 15,
    },
  ]);

  const targetChoices = branches.filter((b) => b !== sourceBranch);
  if (targetChoices.length === 0) {
    throw new Error("No hay otra rama local distinta del origen.");
  }

  const { targetBranch } = await inquirer.prompt<{ targetBranch: string }>([
    {
      type: "list",
      name: "targetBranch",
      message: chalk.blue("Rama destino:"),
      choices: targetChoices,
      pageSize: 15,
    },
  ]);

  const { commitHashesRaw } = await inquirer.prompt<{ commitHashesRaw: string }>(
    [
      {
        type: "input",
        name: "commitHashesRaw",
        message: chalk.blue(
          "Hash(es) de commit (uno o varios, separados por espacio o coma):",
        ),
        validate: (input: string) => {
          const list = parseCommitHashesInput(input);
          if (list.length === 0) return "Indica al menos un hash de commit.";
          return true;
        },
      },
    ],
  );

  const commitHashes = parseCommitHashesInput(commitHashesRaw);

  const targetIsProtected = isDirectPushForbiddenBranch(targetBranch);
  if (targetIsProtected) {
    console.log(
      chalk.yellow(
        "\nLa rama destino es de integración (release / development / master / main): no se permite push directo; hace falta una rama de trabajo y un PR.\n",
      ),
    );
    const { newBranchName } = await inquirer.prompt<{ newBranchName: string }>(
      [
        {
          type: "input",
          name: "newBranchName",
          message: chalk.blue("Nombre de la rama de trabajo (desde el destino):"),
          validate: validateBranchName,
        },
      ],
    );
    return {
      sourceBranch,
      targetBranch,
      commitHashes,
      createNewBranch: true,
      newBranchName: newBranchName.trim(),
    };
  }

  const { createNewBranch } = await inquirer.prompt<{
    createNewBranch: boolean;
  }>([
    {
      type: "confirm",
      name: "createNewBranch",
      message: chalk.blue(
        "Do you want to create a new branch from target?",
      ),
      default: false,
    },
  ]);

  let newBranchName: string | undefined;
  if (createNewBranch) {
    const ans = await inquirer.prompt<{ newBranchName: string }>([
      {
        type: "input",
        name: "newBranchName",
        message: chalk.blue("Nombre de la nueva rama:"),
        validate: validateBranchName,
      },
    ]);
    newBranchName = ans.newBranchName.trim();
  }

  return {
    sourceBranch,
    targetBranch,
    commitHashes,
    createNewBranch,
    newBranchName,
  };
}
